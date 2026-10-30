'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, isolateGit, git, write, commit, repo, runHook } = require('./sandbox');
const G = require('../.claude/hooks/guard.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'guard.js');
before(isolateGit);
after(cleanup);

// Key-shaped text, built here so this file holds none: one of each kind the guard looks for.
const KEY = {
  google: 'AI' + 'za' + 'Sy' + 'x'.repeat(33),
  pem: '-----BEGIN ' + 'PRIVATE KEY-----',
  rsa: '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  slack: 'xo' + 'xb-' + '1234567890-abcdef',
  ghp: 'gh' + 'p_' + 'a'.repeat(36),
  pat: 'github' + '_pat_' + 'b'.repeat(22),
  aws: 'AK' + 'IA' + 'Q'.repeat(16),
  sa: '"private' + '_key_id": "x"',
};
const UPWORK = "Upwork's API, login and the production /auth and /sync routes are only for the live upwork-sync service.";
const keyIn = (where) => `A key is in the change: ${where}. Keys stay in the secret store; make a fixture look fake (e.g. AIza-FAKE...)`;

// The hook's answer for a command run in dir: null when it allows it, else the reason it denies it.
function answer(command, dir) {
  const r = runHook(HOOK, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir || ROOT });
  assert.strictEqual(r.status, 0);
  if (!r.stdout.trim()) return null;
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.strictEqual(out.hookEventName, 'PreToolUse');
  assert.strictEqual(out.permissionDecision, 'deny');
  return out.permissionDecisionReason;
}

test("Upwork's API, its login pages and the service's /auth and /sync routes: refused", () => {
  for (const command of [
    'curl -s https://api.upwork.com/graphql -d @q.json',
    'curl https://www.upwork.com/api/profiles/v1/search',
    'open "https://www.upwork.com/ab/account-security/login"',
    'curl -X POST https://upwork-sync-000000000000.us-central1.run.app/auth/refresh',
    'curl https://upwork-sync-example-uc.a.run.app/sync?full=1',
    'curl https://UPWORK-SYNC-x.a.run.app/auth/start',
    'grep -rn api.upwork.com shared/',
  ]) assert.strictEqual(G.upwork(command), UPWORK, command);
  assert.strictEqual(answer('curl -s https://api.upwork.com/graphql'), UPWORK);
});

test('other Upwork and upwork-sync addresses: allowed', () => {
  for (const command of [
    'curl https://upwork-sync-000000000000.us-central1.run.app/health',
    'curl https://upwork-sync-000000000000.us-central1.run.app/xero/auth/start',
    'curl https://upwork-sync-000000000000.us-central1.run.app/upwork/messages/rooms',
    'echo https://www.upwork.com/freelancers/kokonut',
    'bq query "SELECT title FROM upwork_jobs.postings LIMIT 5"',
  ]) assert.strictEqual(G.upwork(command), '', command);
  assert.strictEqual(answer('ls -la'), null);
});

// A scratch repo with origin/main, on a side branch.
function side() {
  const dir = repo(scratch(), 'kokonut-x');
  git(dir, 'switch', '-q', '-c', '2026-10-12_side');
  return dir;
}

test('a commit whose staged change holds a key: refused, naming the file and line, never the key', () => {
  for (const [kind, key] of Object.entries(KEY)) {
    const dir = side();
    write(dir, 'src/config.js', `// config\nconst a = 1;\nconst k = '${key}';\n`);
    git(dir, 'add', '-A');
    const reason = answer('git commit -m "config"', dir);
    assert.strictEqual(reason, keyIn('src/config.js:3'), kind);
    assert.ok(!reason.includes(key), kind + ': the key is never printed');
  }
});

test('a clean commit, or a key only in an unstaged file: allowed', () => {
  const dir = side();
  write(dir, 'src/a.js', 'module.exports = 2;\n');
  git(dir, 'add', '-A');
  write(dir, 'src/b.js', `const k = '${KEY.google}';\n`);
  assert.strictEqual(answer('git commit -m "a"', dir), null);
});

test('git add then commit in one command: the files add takes are read too', () => {
  let dir = side();
  write(dir, 'notes/new.txt', `token ${KEY.slack}\n`);
  assert.strictEqual(answer('git add -A && git commit -m x', dir), keyIn('notes/new.txt:1'), 'an untracked file, git add -A');
  assert.strictEqual(answer('git add . && git commit -m x', dir), keyIn('notes/new.txt:1'), 'git add .');
  write(dir, 'src/ok.js', 'module.exports = 3;\n');
  assert.strictEqual(answer('git add src/ok.js && git commit -m x', dir), null, 'git add of other paths only');
  assert.strictEqual(answer('git add notes && git commit -m x', dir), keyIn('notes/new.txt:1'), 'git add of that folder');
  dir = side();
  write(dir, 'app.js', `module.exports = 1;\nconst k = '${KEY.aws}';\n`);
  assert.strictEqual(answer('git commit -am "x"', dir), keyIn('app.js:2'), 'commit -a: a tracked file changed');
  assert.strictEqual(answer('git commit -m "x"', dir), null, 'without -a or add, not staged: not in the commit');
});

test('a push whose branch holds a key since origin/main: refused; a clean branch: allowed', () => {
  const dir = side();
  write(dir, 'src/a.js', 'module.exports = 2;\n');
  commit(dir, 'clean');
  assert.strictEqual(answer('git push -u origin 2026-10-12_side', dir), null);
  write(dir, 'deploy/key.pem', `${KEY.rsa}\nMIIE\n`);
  commit(dir, 'oops');
  write(dir, 'src/a.js', 'module.exports = 3;\n');
  commit(dir, 'later');
  assert.strictEqual(answer('git push -u origin 2026-10-12_side', dir), keyIn('deploy/key.pem:1'));
});

test('the folder: the hook\'s cwd, moved by cd, or git -C', () => {
  const dir = side();
  write(dir, 'src/k.js', `x = '${KEY.ghp}'\n`);
  git(dir, 'add', '-A');
  const elsewhere = scratch();
  assert.strictEqual(answer(`cd ${JSON.stringify(dir)} && git commit -m x`, elsewhere), keyIn('src/k.js:1'));
  assert.strictEqual(answer(`git -C ${JSON.stringify(dir)} commit -m x`, elsewhere), keyIn('src/k.js:1'));
  assert.strictEqual(answer('git commit -m x', elsewhere), null, 'not a repo: nothing to read');
  assert.strictEqual(answer('cd src && git commit -m x', dir), keyIn('src/k.js:1'), 'a subfolder: paths from the repo\'s top');
});

test('fixtures: a line in tests/ or test/ holding FAKE or EXAMPLE is passed over; elsewhere it is not', () => {
  const dir = side();
  write(dir, 'tests/fixture.test.js', `const k = '${KEY.google.slice(0, 4)}-FAKE-${'0'.repeat(30)}';\nconst a = '${KEY.aws.slice(0, 4)}IOSFODNN7EXAMPLE';\n`);
  write(dir, 'test/deep/x.js', `// ${KEY.ghp} FAKE\n`);
  git(dir, 'add', '-A');
  assert.strictEqual(answer('git commit -m fixtures', dir), null);
  write(dir, 'src/fixture.js', `const k = '${KEY.google.slice(0, 4)}-FAKE-${'0'.repeat(30)}';\n`);
  git(dir, 'add', '-A');
  assert.strictEqual(answer('git commit -m fixtures', dir), keyIn('src/fixture.js:1'));
  write(dir, 'tests/real.js', `const k = '${KEY.google}';\n`);
  git(dir, 'rm', '-q', '--cached', 'src/fixture.js');
  git(dir, 'add', 'tests/real.js');
  assert.strictEqual(answer('git commit -m fixtures', dir), keyIn('tests/real.js:1'), 'in tests/ without the word');
});

test('the steps read from a command line', () => {
  const here = scratch();
  const steps = G.gitSteps('git add src a.js && git commit -m "a; b" && git push -u origin x', here);
  assert.deepStrictEqual(steps.map((s) => [s.kind, s.add, s.all]), [['commit', ['src', 'a.js'], false], ['push', null, false]]);
  assert.deepStrictEqual(G.gitSteps('git commit --amend --no-edit', here).map((s) => s.kind), ['commit']);
  assert.deepStrictEqual(G.gitSteps('git commit -am x', here)[0].all, true);
  assert.deepStrictEqual(G.gitSteps('git commit --amend -m x', here)[0].all, false);
  assert.deepStrictEqual(G.gitSteps('bash -c "git push origin x"', here).map((s) => [s.kind, s.dir]), [['push', here]]);
  assert.deepStrictEqual(G.gitSteps('git status', here), []);
});

test('added(): file and line of each added line of a -U0 diff', () => {
  const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -2,0 +3,2 @@', '+one', '+two', '@@ -9 +11 @@', '-old', '+new',
    'diff --git a/gone.js b/gone.js', '--- a/gone.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye'].join('\n');
  assert.deepStrictEqual(G.added(diff), [{ file: 'x.js', line: 3, text: 'one' }, { file: 'x.js', line: 4, text: 'two' }, { file: 'x.js', line: 11, text: 'new' }]);
});

test('broken input, no command or a command without git: nothing printed, exit 0', () => {
  for (const input of ['not json', {}, { tool_input: {} }, { tool_input: { command: 'echo commit push' } }]) {
    const r = runHook(HOOK, input);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  }
  assert.strictEqual(fs.existsSync(HOOK), true);
});
