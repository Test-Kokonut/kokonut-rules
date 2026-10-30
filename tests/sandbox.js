// sandbox.js: what the tests share: scratch folders, git kept apart from the machine's own settings, scratch repos
// with a local "GitHub" remote, and running a hook the way Claude Code does (JSON on stdin).
// Not a test file itself: node --test only runs files named *.test.js in this folder.
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const made = [];

// The hooks also read the cloud's clones in /home/user (reminder.js, repoFile): in the tests, a folder that does not
// exist, so a test sees only the files it makes (the hooks it starts inherit this).
process.env.KOKONUT_REPOS_DIR = path.join(os.tmpdir(), `kokonut-tests-no-repos-${process.pid}`);

function scratch(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'kokonut-test-')));
  made.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of made.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* a leftover temp folder is harmless */ }
  }
}

// git in the tests (and in the hooks they start) reads no system or user settings: no signing, no hooks, no
// helpers, a fixed author.
function isolateGit() {
  const dir = scratch('kokonut-gitconfig-');
  const config = path.join(dir, 'gitconfig');
  fs.writeFileSync(config, '');
  Object.assign(process.env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_TERMINAL_PROMPT: '0',
  });
}

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function write(dir, file, text) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text === undefined ? 'x\n' : text);
  return full;
}

function commit(dir, message) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message || 'change');
}

// A checkout at <base>/<parent>/<name> on main with one commit, pushed to a bare "GitHub" repo at
// <base>/remotes/<owner>/<name>.git (so its origin names an owner and a repo, as on GitHub).
function repo(base, name, options) {
  const o = Object.assign({ owner: 'Test-Kokonut', parent: 'work' }, options || {});
  const remote = path.join(base, 'remotes', o.owner, name + '.git');
  fs.mkdirSync(remote, { recursive: true });
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const dir = path.join(base, o.parent, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  write(dir, 'app.js', 'module.exports = 1;\n');
  commit(dir, 'init');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return dir;
}

// Runs a hook script with the input JSON on stdin; returns { status, stdout, stderr }. env adds or replaces
// variables (names matched without case, as Windows does); a null value removes one.
function runHook(script, input, env) {
  const full = Object.assign({}, process.env);
  for (const [name, value] of Object.entries(env || {})) {
    for (const key of Object.keys(full)) if (key.toLowerCase() === name.toLowerCase()) delete full[key];
    if (value !== null && value !== undefined) full[name] = value;
  }
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: full,
    timeout: 30000,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

module.exports = { ROOT, scratch, cleanup, isolateGit, git, write, commit, repo, runHook };
