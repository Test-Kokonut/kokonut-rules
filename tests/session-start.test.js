'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, write, runHook } = require('./sandbox');
const { start, clearPlaceholder, KEY_FILE, SIGNED_IN, WHERE, PROJECTS_HEAD, NO_PROJECTS } = require('../.claude/hooks/session-start.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'session-start.js');
const KEY = '{"type":"service_account","private_key":"-----SECRET-----"}';
after(cleanup);

// A status page of a kokonut-status clone: projects/<name>.md, updated at the time given, with a Purpose.
function page(base, name, updated, purpose) {
  write(base, `kokonut-status/projects/${name}.md`, `# ${name}\nUpdated: ${updated} UTC\n\n## Purpose\n${purpose}\n## State\n- x\n`);
}
const NONE = [WHERE, NO_PROJECTS];

// A fake gcloud: records each call, answers "auth list" with the accounts given.
function fakeGcloud(accounts) {
  const calls = [];
  const run = (args, env, keep) => {
    calls.push({ args, env, keep });
    return args[0] === 'auth' && args[1] === 'list' ? accounts : '';
  };
  return { calls, run };
}

function project() {
  const base = scratch();
  const dir = path.join(base, 'kokonut-upwork-sync');
  fs.mkdirSync(dir);
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

test('no key: no sign-in line, gcloud never called', () => {
  const { base, dir } = project();
  const g = fakeGcloud('');
  assert.deepStrictEqual(start({ env: {}, run: g.run, home: base, projectDir: dir }), NONE);
  assert.strictEqual(g.calls.length, 0);
});

test('key and no account: writes the key file, signs in, sets the project, prints one line', () => {
  const { base, dir } = project();
  const g = fakeGcloud('');
  const env = { KOKONUT_READER_KEY: KEY, CLOUDSDK_AUTH_ACCESS_TOKEN: 'placeholder', KEEP: '1' };
  const lines = start({ env, run: g.run, home: base, projectDir: dir });
  assert.deepStrictEqual(lines, [SIGNED_IN, ...NONE]);
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
  assert.deepStrictEqual(start({ env: { KOKONUT_READER_KEY: KEY }, run: g.run, home: base, projectDir: dir }), NONE);
  assert.strictEqual(g.calls.length, 1);
  assert.ok(!fs.existsSync(path.join(base, KEY_FILE)));
});

test('gcloud fails: nothing printed, no error', () => {
  const { base, dir } = project();
  const run = () => { throw new Error('gcloud: not found'); };
  assert.deepStrictEqual(start({ env: { KOKONUT_READER_KEY: KEY }, run, home: base, projectDir: dir }), NONE);
});

test('after the sign-in, in order: where things are, the open projects; each part after a blank line', () => {
  const { base, dir } = project();
  page(base, '2026-10-30_example', '2026-10-30 15:20', 'George: "a short purpose"');
  const g = fakeGcloud('');
  const parts = start({ env: { KOKONUT_READER_KEY: KEY }, run: g.run, home: base, projectDir: dir });
  assert.deepStrictEqual(parts, [SIGNED_IN, WHERE, PROJECTS_HEAD + '\n- 2026-10-30_example: "a short purpose"']);
  assert.match(WHERE, /^Where things are:\n- Repo map: REPOS\.md in kokonut-temp\.\n[\s\S]*https:\/\/drive\.google\.com\/drive\/folders\/1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy\n- Rules: kokonut-rules/);
});

test('the projects: kokonut-status beside the project folder, else inside it, else in the cloud\'s folder, else the one line', () => {
  const { base, dir } = project();
  const cloud = scratch();
  const list = () => start({ env: {}, run: () => '', home: base, projectDir: dir }).pop();
  const before = process.env.KOKONUT_REPOS_DIR;
  try {
    process.env.KOKONUT_REPOS_DIR = cloud;
    assert.strictEqual(list(), NO_PROJECTS);
    page(cloud, 'cloud', '2026-10-01 10:00', 'from the cloud folder');
    assert.strictEqual(list(), PROJECTS_HEAD + '\n- cloud: from the cloud folder');
    page(dir, 'inside', '2026-10-01 10:00', 'from inside');
    assert.strictEqual(list(), PROJECTS_HEAD + '\n- inside: from inside');
    page(base, 'beside', '2026-10-01 10:00', 'from beside');
    assert.strictEqual(list(), PROJECTS_HEAD + '\n- beside: from beside');
  } finally {
    process.env.KOKONUT_REPOS_DIR = before;
  }
});

test('the projects: newest first, the first words of each Purpose, at most 40 lines and a count of the rest', () => {
  const { base, dir } = project();
  const g = fakeGcloud('');
  const list = () => start({ env: {}, run: g.run, home: base, projectDir: dir }).pop().split('\n');
  page(base, 'old', '2026-10-01 10:00', '- George, 1 Oct 2026: the oldest page');
  page(base, 'new', '2026-10-30 10:00', 'Fix the chat setup at its core: a lean start that does not drift, and continuations as good');
  write(base, 'kokonut-status/projects/bare.md', '# bare\nUpdated: 2026-10-15 10:00 UTC\n\n## State\n- x\n');
  assert.deepStrictEqual(list(), [PROJECTS_HEAD, '- new: Fix the chat setup at its core: a lean start that does not drift, and…',
    '- bare', '- old: the oldest page']);
  for (let i = 0; i < 45; i++) page(base, `p${String(i).padStart(2, '0')}`, '2026-10-20 10:00', 'x');
  const lines = list();
  assert.strictEqual(lines.length, 1 + 40 + 1);
  assert.match(lines[41], /^- and 8 more: node .*kokonut-status.scripts.status\.js list$/);
});

test('as a hook in a cloud session without kokonut-status and without a key: where things are, and the one line', () => {
  const { base, dir } = project();
  const r = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: dir }, {
    CLAUDE_CODE_REMOTE: 'true', KOKONUT_READER_KEY: null, HOME: base, CLAUDE_PROJECT_DIR: dir, PATH: scratch(),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, NONE.join('\n\n') + '\n');
});

test('as a hook with kokonut-status beside: the parts joined by blank lines', () => {
  const { base, dir } = project();
  page(base, 'website', '2026-10-30 15:20', 'A new home page');
  const r = runHook(HOOK, { hook_event_name: 'SessionStart', cwd: dir }, {
    KOKONUT_READER_KEY: null, HOME: base, CLAUDE_PROJECT_DIR: dir, PATH: scratch(),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, [WHERE, PROJECTS_HEAD + '\n- website: A new home page'].join('\n\n') + '\n');
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
  assert.strictEqual(r.stdout, [SIGNED_IN, ...NONE].join('\n\n') + '\n');
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
  assert.strictEqual(r.stdout, NONE.join('\n\n') + '\n');
  assert.ok(!r.stdout.includes('SECRET') && !r.stderr.includes('SECRET'));
});

test('loading the hook as a module leaves error exits alone: a script that requires it and throws exits non-zero', () => {
  const r = require('child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(HOOK)}); throw new Error('boom');`], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'the hook must not swallow a loader\'s own error');
  assert.match(r.stderr, /boom/);
});
