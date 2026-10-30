'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, write, runHook } = require('./sandbox');
const { RULEBOOK } = require('./rulebook-fixture');
const { start, clearPlaceholder, KEY_FILE, SIGNED_IN, MAP_HEAD, DASHBOARD_HEAD, NO_DASHBOARD } = require('../.claude/hooks/session-start.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'session-start.js');
const KEY = '{"type":"service_account","private_key":"-----SECRET-----"}';
after(cleanup);

// The rulebook's "Index." bullet, cut from the fixture by hand: four lines, the first and three continuations.
const RB = RULEBOOK.split('\n');
const at = RB.findIndex((l) => l.startsWith('- Index.'));
const INDEX = RB.slice(at, at + 4).join('\n');
const MAP = '# The repos of Test-Kokonut\n\n- **kokonut-temp** (private): Rules.\n';
const BOARD = '# Dashboard\n\n| Active |\n';

// A fake gcloud: records each call, answers "auth list" with the accounts given.
function fakeGcloud(accounts) {
  const calls = [];
  const run = (args, env, keep) => {
    calls.push({ args, env, keep });
    return args[0] === 'auth' && args[1] === 'list' ? accounts : '';
  };
  return { calls, run };
}

// gh's stand-ins: none reachable, or GitHub holding the files given ({ 'repo/file': text }).
const NO_GH = () => { throw new Error('gh: not reachable'); };
function github(files) {
  const asked = [];
  const run = (args) => {
    asked.push(args.join(' '));
    const m = /^repos\/Test-Kokonut\/([^/]+)\/contents\/(.+)$/.exec(args[1]);
    const text = m && files[m[1] + '/' + m[2]];
    if (text === undefined) throw new Error('HTTP 404');
    return JSON.stringify({ content: Buffer.from(text).toString('base64'), encoding: 'base64' });
  };
  return { asked, run };
}

function project(withRulebook) {
  const base = scratch();
  const dir = path.join(base, 'kokonut-upwork-sync');
  fs.mkdirSync(dir);
  if (withRulebook) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), RULEBOOK);
  return { base, dir };
}

test('the placeholder token: with CLAUDE_ENV_FILE and the variable set, one unset line goes into the file, once; the chat then runs plain gcloud', () => {
  const dir = scratch();
  const file = path.join(dir, 'env.sh');
  fs.writeFileSync(file, 'export FOO=1\n');
  const env = { CLAUDE_ENV_FILE: file, CLOUDSDK_AUTH_ACCESS_TOKEN: 'placeholder', HOME: dir };
  assert.strictEqual(clearPlaceholder(env), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'export FOO=1\nunset CLOUDSDK_AUTH_ACCESS_TOKEN\n');
  assert.strictEqual(clearPlaceholder(env), false, 'the second start appends nothing');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'export FOO=1\nunset CLOUDSDK_AUTH_ACCESS_TOKEN\n');
  start({ env, run: () => '', home: dir, projectDir: dir });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'export FOO=1\nunset CLOUDSDK_AUTH_ACCESS_TOKEN\n', 'start() writes it through the same door');
});

test('the placeholder token: no variable, or no environment file named: nothing written, nothing thrown', () => {
  const dir = scratch();
  const file = path.join(dir, 'env.sh');
  assert.strictEqual(clearPlaceholder({ CLAUDE_ENV_FILE: file }), false);
  assert.ok(!fs.existsSync(file));
  assert.strictEqual(clearPlaceholder({ CLOUDSDK_AUTH_ACCESS_TOKEN: 'placeholder' }), false);
});

test('no key: nothing printed, gcloud never called', () => {
  const { base, dir } = project();
  const g = fakeGcloud('');
  assert.deepStrictEqual(start({ env: {}, run: g.run, home: base, projectDir: dir, gh: NO_GH }), [NO_DASHBOARD]);
  assert.strictEqual(g.calls.length, 0);
});

test('key and no account: writes the key file, signs in, sets the project, prints one line', () => {
  const { base, dir } = project();
  const g = fakeGcloud('');
  const env = { KOKONUT_READER_KEY: KEY, CLOUDSDK_AUTH_ACCESS_TOKEN: 'placeholder', KEEP: '1' };
  const lines = start({ env, run: g.run, home: base, projectDir: dir, gh: NO_GH });
  assert.deepStrictEqual(lines, [SIGNED_IN, NO_DASHBOARD]);
  const file = path.join(base, KEY_FILE);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), KEY);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepStrictEqual(g.calls.map((c) => c.args), [
    ['auth', 'list', '--format=value(account)'],
    ['auth', 'activate-service-account', '--key-file=' + file, '--quiet'],
    ['config', 'set', 'project', 'kokonut-data-base', '--quiet'],
  ]);
  for (const c of g.calls) {
    assert.ok(!('CLOUDSDK_AUTH_ACCESS_TOKEN' in c.env), 'the placeholder token is removed for every gcloud call');
    assert.strictEqual(c.env.KEEP, '1');
  }
  assert.ok(!lines.join('\n').includes('SECRET'));
});

test('an account already signed in: nothing written, nothing printed', () => {
  const { base, dir } = project();
  const g = fakeGcloud('reader@kokonut-data-base.iam.gserviceaccount.com\n');
  assert.deepStrictEqual(start({ env: { KOKONUT_READER_KEY: KEY }, run: g.run, home: base, projectDir: dir, gh: NO_GH }), [NO_DASHBOARD]);
  assert.strictEqual(g.calls.length, 1);
  assert.ok(!fs.existsSync(path.join(base, KEY_FILE)));
});

test('gcloud fails: nothing printed, no error', () => {
  const { base, dir } = project();
  const run = () => { throw new Error('gcloud: not found'); };
  assert.deepStrictEqual(start({ env: { KOKONUT_READER_KEY: KEY }, run, home: base, projectDir: dir, gh: NO_GH }), [NO_DASHBOARD]);
});

test('after the sign-in, in order: the Index bullet, the repo map, the dashboard; each part after a blank line', () => {
  const { base, dir } = project(true);
  write(dir, 'REPOS.md', MAP);
  write(base, 'kokonut-status/DASHBOARD.md', BOARD);
  const g = fakeGcloud('');
  const parts = start({ env: { KOKONUT_READER_KEY: KEY }, run: g.run, home: base, projectDir: dir, gh: NO_GH });
  assert.deepStrictEqual(parts, [SIGNED_IN, INDEX, MAP_HEAD + '\n' + MAP.trim(), DASHBOARD_HEAD + '\n' + BOARD.trim()]);
  assert.match(INDEX, /^- Index\. The repos: REPOS\.md in kokonut-temp;[\s\S]*\n {2}https:\/\/drive\.google\.com\/drive\/folders\/EXAMPLE-folder-id$/);
  assert.strictEqual(MAP_HEAD, 'REPOS.md:');
  assert.strictEqual(DASHBOARD_HEAD, 'DASHBOARD.md (kokonut-status):');
});

test('the repo map: the project\'s REPOS.md, else ../kokonut-temp/REPOS.md, else kokonut-temp\'s from GitHub, else left out', () => {
  const { base, dir } = project(true);
  const g = fakeGcloud('');
  const map = (gh) => start({ env: {}, run: g.run, home: base, projectDir: dir, gh }).find((p) => p.startsWith(MAP_HEAD));
  assert.strictEqual(map(NO_GH), undefined);
  const hub = github({ 'kokonut-temp/REPOS.md': 'from GitHub\n' });
  assert.strictEqual(map(hub.run), MAP_HEAD + '\nfrom GitHub');
  assert.ok(hub.asked.includes('api repos/Test-Kokonut/kokonut-temp/contents/REPOS.md'));
  write(base, 'kokonut-temp/REPOS.md', 'beside\n');
  assert.strictEqual(map(hub.run), MAP_HEAD + '\nbeside');
  write(dir, 'REPOS.md', 'own\n');
  assert.strictEqual(map(hub.run), MAP_HEAD + '\nown');
});

test('the dashboard: ../kokonut-status/DASHBOARD.md, else from GitHub, else the one line; at most 200 lines', () => {
  const { base, dir } = project(false);
  const g = fakeGcloud('');
  const last = (gh) => start({ env: {}, run: g.run, home: base, projectDir: dir, gh }).pop();
  assert.strictEqual(last(NO_GH), 'Dashboard: attach kokonut-status and read DASHBOARD.md');
  const long = Array.from({ length: 250 }, (_, i) => 'line ' + (i + 1)).join('\n');
  const hub = github({ 'kokonut-status/DASHBOARD.md': long });
  const fromHub = last(hub.run);
  assert.strictEqual(fromHub.split('\n').length, 201);
  assert.strictEqual(fromHub.split('\n')[200], 'line 200');
  assert.ok(hub.asked.includes('api repos/Test-Kokonut/kokonut-status/contents/DASHBOARD.md'));
  write(base, 'kokonut-status/DASHBOARD.md', BOARD);
  assert.strictEqual(last(hub.run), DASHBOARD_HEAD + '\n' + BOARD.trim());
});

test('a rulebook without "# The repos" or without its Index bullet: that part alone is left out', () => {
  const { base, dir } = project(false);
  const g = fakeGcloud('');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# The repos\n- A new repo:\n  1. Add it.\n');
  write(dir, 'REPOS.md', MAP);
  assert.deepStrictEqual(start({ env: {}, run: g.run, home: base, projectDir: dir, gh: NO_GH }), [MAP_HEAD + '\n' + MAP.trim(), NO_DASHBOARD]);
});

test('as a hook in a cloud session without kokonut-status, without a key and without gh: the dashboard line alone', () => {
  const { base, dir } = project(false);
  const r = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: dir }, {
    CLAUDE_CODE_REMOTE: 'true', KOKONUT_READER_KEY: null, HOME: base, CLAUDE_PROJECT_DIR: dir, PATH: scratch(),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, NO_DASHBOARD + '\n');
});

test('as a hook with the rulebook, the map and the dashboard beside: the parts joined by blank lines', () => {
  const { base, dir } = project(true);
  write(dir, 'REPOS.md', MAP);
  write(base, 'kokonut-status/DASHBOARD.md', BOARD);
  const r = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: dir }, {
    KOKONUT_READER_KEY: null, HOME: base, CLAUDE_PROJECT_DIR: dir, PATH: scratch(),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, [INDEX, MAP_HEAD + '\n' + MAP.trim(), DASHBOARD_HEAD + '\n' + BOARD.trim()].join('\n\n') + '\n');
});

// A stand-in gcloud on the path (gcloud.cmd on Windows): logs its arguments and whether the token was set.
function fakeGcloudOnPath() {
  const bin = scratch();
  const log = path.join(bin, 'calls.jsonl');
  fs.writeFileSync(path.join(bin, 'fake.js'),
    `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), token: process.env.CLOUDSDK_AUTH_ACCESS_TOKEN || null }) + '\\n');\n`);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'gcloud.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake.js" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, 'gcloud'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'fake.js')}" "$@"\n`, { mode: 0o755 });
  }
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { bin, calls };
}

test('as a hook with gcloud on the path and no account: signs in without the placeholder token', () => {
  const { base, dir } = project();
  const g = fakeGcloudOnPath();
  const r = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: dir }, {
    KOKONUT_READER_KEY: KEY, CLOUDSDK_AUTH_ACCESS_TOKEN: 'placeholder', PATH: g.bin, HOME: base, CLAUDE_PROJECT_DIR: dir,
    CLAUDE_CODE_REMOTE: null, // not a cloud session, wherever the tests run
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, SIGNED_IN + '\n\n' + NO_DASHBOARD + '\n');
  const file = path.join(base, KEY_FILE);
  assert.deepStrictEqual(g.calls(), [
    { args: ['auth', 'list', '--format=value(account)'], token: null },
    { args: ['auth', 'activate-service-account', '--key-file=' + file, '--quiet'], token: null },
    { args: ['config', 'set', 'project', 'kokonut-data-base', '--quiet'], token: null },
  ]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), KEY);
});

test('as a hook with no gcloud on the path: prints nothing, exits 0, never echoes the key', () => {
  const { base, dir } = project();
  const empty = scratch();
  const r = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: dir }, {
    KOKONUT_READER_KEY: KEY, PATH: empty, HOME: base, CLOUDSDK_CONFIG: empty, CLAUDE_PROJECT_DIR: dir,
    CLAUDE_CODE_REMOTE: null,
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, NO_DASHBOARD + '\n');
  assert.ok(!r.stdout.includes('SECRET') && !r.stderr.includes('SECRET'));
});

test('loading the hook as a module leaves error exits alone: a script that requires it and throws exits non-zero', () => {
  const r = require('child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(HOOK)}); throw new Error('boom');`], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'the hook must not swallow a loader\'s own error');
  assert.match(r.stderr, /boom/);
});
