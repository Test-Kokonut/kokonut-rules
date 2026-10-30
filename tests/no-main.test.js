'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ROOT, scratch, cleanup, isolateGit, git, commit, runHook } = require('./sandbox');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'no-main.js');
let onMain;
let onSide;

before(() => {
  isolateGit();
  const base = scratch();
  onMain = path.join(base, 'on-main');
  onSide = path.join(base, 'on-side');
  for (const dir of [onMain, onSide]) {
    require('fs').mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'init');
  }
  git(onSide, 'switch', '-q', '-c', '2026-10-09_side');
});
after(cleanup);

// The hook's output for a command run in dir: null when it allows it, else its hookSpecificOutput.
function answer(command, dir, env) {
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
  if (dir) input.cwd = dir;
  const r = runHook(HOOK, input, env);
  assert.strictEqual(r.status, 0);
  if (!r.stdout.trim()) return null;
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.strictEqual(out.hookEventName, 'PreToolUse');
  return out;
}

// The hook's answer for a command run in dir: 'deny' or 'allow'.
function verdict(command, dir, env) {
  const out = answer(command, dir, env);
  return out ? out.permissionDecision : 'allow';
}

const DENY = [
  ['git push origin main', 'side'],
  ['git push origin HEAD:main', 'side'],
  ['git push origin HEAD:refs/heads/main', 'side'],
  ['git push --force origin feature:main', 'side'],
  ['git push', 'main'],
  ['git push origin', 'main'],
  ['git push origin HEAD', 'main'],
  ['git push -u origin HEAD', 'main'],
  ['bash -c "git push origin main"', 'side'],
  ['git -c core.x=y push origin main', 'side'],
  ['git push --all origin', 'side'],
  ['git push origin master', 'side'],
  ['git.exe push origin HEAD', 'main'],
  ['git push 2>&1 | tail -5', 'main'],
  // a branch named by a substitution or a variable: unknown
  ['git push origin $(git branch --show-current)', 'side'],
  ['git push -u origin "$(git rev-parse --abbrev-ref HEAD)"', 'side'],
  ['git push origin `git branch --show-current`', 'side'],
  ['git push origin HEAD:${BRANCH}', 'side'],
  ['git push -u origin $BRANCH', 'side'],
  ['git switch -c "$(date +%F)_x" && git push -u origin HEAD', 'side'],
  // text that runs: a shell's string, eval, PowerShell's -Command, a substitution, inline code
  ['sh -c "git push"', 'main'],
  ["bash -c 'git fetch && git push origin main'", 'side'],
  ["bash -lc 'cd . && git push origin HEAD'", 'main'],
  ['eval "git push origin main"', 'side'],
  ['pwsh -Command git push origin main', 'side'],
  ['powershell.exe -NoProfile -Command "git push origin master"', 'side'],
  ['out=$(git push origin main 2>&1)', 'side'],
  ['node -e "require(\'child_process\').execSync(\'git push origin main\')"', 'side'],
  ['node -e "const cp = require(\'child_process\'); cp.execSync(\'git push origin main\')"', 'side'],
  ['python3 -c "import os; os.system(\'git push origin master\')"', 'side'],
  // git as the command word after assignments, keywords, grouping and wrappers
  ['GIT_SSH_COMMAND="ssh -i key" git push origin main', 'side'],
  ['sudo -E git push origin main', 'side'],
  ['timeout 60 git push origin main', 'side'],
  ['if git push origin main; then echo ok; fi', 'side'],
  ['echo start & git push origin main', 'side'],
  ['(cd . && git push)', 'main'],
];

const ALLOW = [
  ['git push -u origin 2026-10-09_test', 'side'],
  ['git push', 'side'],
  ['git push origin HEAD', 'side'],
  ['git push origin --delete claude/abc', 'side'],
  ['git push origin main:feature', 'side'],
  ['git switch -c 2026-10-09_t && git push -u origin HEAD', 'main'],
  ['gh pr merge 7 --merge', 'main'],
  ['git status', 'main'],
  ['echo pushing the maintenance branch', 'main'],
  // text that only names a push: searched, printed or written down, never run
  ["grep -rn 'git push origin main' docs/", 'main'],
  ['echo never run git push origin main', 'main'],
  ['git commit -m "never git push origin main"', 'side'],
  ['node scripts/notes.js --message "git push origin main is refused"', 'side'],
  ['git push -u origin 2026-10-09_x && echo "pushed; main is next"', 'side'],
  ['bash -c "git push -u origin 2026-10-09_x"', 'side'],
  ['git push -u origin 2026-10-09_x > "$LOG" 2>&1', 'side'],
  ['git push -u origin 2026-10-09_x &>"$OUT"', 'side'],
  ['git push origin claude/abc', 'side'],
  ["zsh -c 'git push origin claude/abc'", 'side'],
];

for (const [command, where] of DENY) {
  test(`deny on ${where}: ${command}`, () => {
    assert.strictEqual(verdict(command, where === 'main' ? onMain : onSide), 'deny');
  });
}

for (const [command, where] of ALLOW) {
  test(`allow on ${where}: ${command}`, () => {
    assert.strictEqual(verdict(command, where === 'main' ? onMain : onSide), 'allow');
  });
}

test('the reasons: push the chat\'s own branch, then a pull request; a substituted branch is unknown', () => {
  assert.strictEqual(answer('git push origin main', onSide).permissionDecisionReason,
    "Pushing to main or master is refused. Push the chat's own branch, then open a pull request to main.");
  assert.match(answer('git push origin $(git branch --show-current)', onSide).permissionDecisionReason,
    /^Pushing a branch named by a substitution or a variable .* is refused: the branch is unknown\./);
});

test('a push after cd into a checkout on main is refused; after cd into a side branch it passes', () => {
  assert.strictEqual(verdict(`cd "${onMain}" && git push`, onSide), 'deny');
  assert.strictEqual(verdict(`Set-Location "${onMain}"; git push origin HEAD`, onSide), 'deny');
  assert.strictEqual(verdict(`cd "${onSide}" && git push`, onMain), 'allow');
  assert.strictEqual(verdict(`git -C "${onMain}" push`, onSide), 'deny');
  assert.strictEqual(verdict(`bash -c 'cd "${onMain}" && git push'`, onSide), 'deny', 'a shell string is read whole');
});

test('cd targets: relative, home, and Git Bash drive paths on Windows', () => {
  const { moveTo, isGit } = require(HOOK);
  const here = path.resolve('/work/repo');
  assert.strictEqual(moveTo(here, '../other'), path.resolve('/work/other'));
  assert.strictEqual(moveTo(here, '~/x'), path.join(require('os').homedir(), 'x'));
  if (process.platform === 'win32') assert.strictEqual(moveTo(here, '/c/Users/a'), 'C:\\Users\\a');
  for (const g of ['git', 'git.exe', '/usr/bin/git', 'C:\\Program Files\\Git\\cmd\\git.exe']) assert.ok(isGit(g), g);
  for (const g of ['gh', 'digit', 'git-lfs']) assert.ok(!isGit(g), g);
});

test('words and substitutions: quotes joined and removed, what $(...) and `...` run', () => {
  const { words, substitutions } = require(HOOK);
  assert.deepStrictEqual(words('A="x y" git push origin HEAD:"feature"'), ['A=x y', 'git', 'push', 'origin', 'HEAD:feature']);
  assert.deepStrictEqual(words("grep -rn 'a b' docs/"), ['grep', '-rn', 'a b', 'docs/']);
  assert.deepStrictEqual(words(' git push)'), ['git', 'push']);
  assert.deepStrictEqual(words('git push origin main; echo "a; b" 2>&1 &>/dev/null'), ['git', 'push', 'origin', 'main', 'echo', 'a; b', '2>&1', '&>/dev/null']);
  assert.deepStrictEqual(substitutions('x=$(a $(b) c) `d` $(e'), ['a $(b) c', 'd', 'e']);
});

test('without cwd the branch is read in CLAUDE_PROJECT_DIR', () => {
  assert.strictEqual(verdict('git push', null, { CLAUDE_PROJECT_DIR: onMain }), 'deny');
  assert.strictEqual(verdict('git push', null, { CLAUDE_PROJECT_DIR: onSide }), 'allow');
});

test('broken input: no output, exit 0', () => {
  const r = runHook(HOOK, 'not json');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});
