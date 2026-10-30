#!/usr/bin/env node
// guard.js: refuses a shell command that calls Upwork's API, login or the production /auth and /sync routes, and a
// git commit or push whose change holds a key.
// Written in kokonut-rules, installed machine-wide by its setup.sh; run by the PreToolUse hook on Bash|PowerShell in
// .claude/settings.json, after no-main.js. Two refusals, each with a one-line reason:
//   Upwork (G5): the command holds api.upwork.com, upwork.com/api, www.upwork.com/ab/, or an upwork-sync*.run.app
//       address followed by /auth or /sync (any case). Text that only names one (grep, echo) is refused too.
//   A key (G4): the command holds git commit (--amend too) or git push. For a commit, the lines git diff --cached -U0
//       adds; when the same command runs git add first, or commits with -a, also the lines git diff -U0 adds and the
//       untracked files (not ignored) that add takes (git add <paths>: those paths only; -a: tracked files only).
//       For a push, the lines git diff -U0 origin/main...HEAD and git diff --cached -U0 add. Each added line is
//       searched for KEYS below; a line in a tests/ or test/ folder that holds FAKE or EXAMPLE is passed over. The
//       first key found refuses, naming its file and line, never the key.
// git runs in the folder the command runs in: the hook's cwd (else CLAUDE_PROJECT_DIR), moved by a cd, pushd or
// Set-Location earlier in the same command, or the folder of git -C. A diff git cannot make (no origin/main, not a
// repo) is passed over.
// Node only, no packages, Windows and Linux. Any internal error prints nothing and exits 0.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { words, isGit, moveTo } = require('./no-main.js');

const UPWORK = [/api\.upwork\.com/i, /upwork\.com\/api/i, /www\.upwork\.com\/ab\//i, /upwork-sync[^\s/]*\.run\.app\/(?:auth|sync)\b/i];
const REASON_UPWORK = "Upwork's API, login and the production /auth and /sync routes are only for the live upwork-sync service.";
const KEYS = [/AIza[0-9A-Za-z_-]{35}/, /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, /xox[abprs]-[0-9A-Za-z-]{10,}/,
  /ghp_[0-9A-Za-z]{36}/, /github_pat_[0-9A-Za-z_]{22,}/, /AKIA[0-9A-Z]{16}/, /"private_key_id"\s*:/];
const FIXTURE_FOLDER = /(?:^|\/)tests?\//;
const FIXTURE_MARK = /FAKE|EXAMPLE/;
const GIT_OP = /\bgit\b[^;&|\n]*?\b(commit|push)\b/;
const CHANGE_DIR = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
const MAX_FILE = 2 * 1024 * 1024; // an untracked file larger than this is not read

const keyReason = (file, line) =>
  `A key is in the change: ${file}:${line}. Keys stay in the secret store; make a fixture look fake (e.g. AIza-FAKE...)`;

function upwork(command) {
  return UPWORK.some((r) => r.test(command)) ? REASON_UPWORK : '';
}

// ---- What the command does with git. ----

// The commits and pushes of a command line run in dir, each { kind, dir, add, all }: add is null (no git add before
// it in that folder), [] (git add of everything) or the paths added; all: a commit with -a.
function gitSteps(command, dir) {
  const steps = [];
  const adds = new Map(); // folder -> the paths added there, [] for everything
  let here = path.resolve(dir);
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const w = words(part);
    let i = 0;
    while (i < w.length && /^(?:[A-Za-z_]\w*=.*|if|then|do|!|\{|\()$/.test(w[i])) i++;
    if (i >= w.length) continue;
    if (CHANGE_DIR.has(w[i].toLowerCase())) {
      const target = w.slice(i + 1).find((a) => !a.startsWith('-'));
      if (target) here = moveTo(here, target);
      continue;
    }
    if (!isGit(w[i])) continue;
    let k = i + 1;
    let where = here;
    while (k < w.length && w[k].startsWith('-')) {
      if ((w[k] === '-C' || w[k] === '-c') && k + 1 < w.length) {
        if (w[k] === '-C') where = moveTo(here, w[k + 1]);
        k += 2;
      } else k++;
    }
    const sub = w[k];
    const args = w.slice(k + 1);
    if (sub === 'add') {
      const paths = args.filter((a) => !a.startsWith('-'));
      const every = args.some((a) => a === '-A' || a === '--all' || a === '-u' || a === '--update') || !paths.length || paths.includes('.');
      const before = adds.get(where);
      adds.set(where, every || (before && !before.length) ? [] : (before || []).concat(paths));
    } else if (sub === 'commit') {
      const all = args.some((a) => a === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(a));
      steps.push({ kind: 'commit', dir: where, add: adds.has(where) ? adds.get(where) : null, all });
    } else if (sub === 'push') {
      steps.push({ kind: 'push', dir: where, add: null, all: false });
    }
  }
  // "contains git commit / git push" but read as no command (inside quotes that run, say): the cwd's change.
  if (!steps.length) {
    const m = GIT_OP.exec(command);
    if (m) steps.push({ kind: m[1], dir: path.resolve(dir), add: null, all: false });
  }
  return steps;
}

// ---- The change's added lines. ----

function git(dir, args) {
  return execFileSync('git', ['-c', 'safe.directory=*', '-c', 'core.quotepath=false', '-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024 * 1024,
  });
}

// The added lines of a -U0 diff, each { file, line, text }.
function added(diff) {
  const out = [];
  let file = null;
  let at = 0;
  for (const l of String(diff || '').split('\n')) {
    if (l.startsWith('+++ ')) {
      const name = l.slice(4).replace(/^"(.*)"$/, '$1');
      file = name === '/dev/null' ? null : name.replace(/^b\//, '');
    } else if (l.startsWith('@@')) {
      const m = /\+(\d+)/.exec(l);
      at = m ? Number(m[1]) : 0;
    } else if (l.startsWith('+') && file) {
      out.push({ file, line: at, text: l.slice(1) });
      at++;
    }
  }
  return out;
}

function diffLines(dir, args) {
  try { return added(git(dir, ['diff', '--no-color', '--no-ext-diff', '-U0', ...args])); } catch (e) { return []; }
}

// The lines of the untracked, not ignored files a git add in dir would take (paths: [] for all); top: the repo's
// folder, which the names are relative to.
function untrackedLines(dir, top, paths) {
  let names = [];
  try { names = git(dir, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z', '--', ...paths]).split('\0').filter(Boolean); } catch (e) { return []; }
  const out = [];
  for (const name of names) {
    try {
      const full = path.join(top, name);
      if (fs.statSync(full).size > MAX_FILE) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes('\0')) continue;
      text.split('\n').forEach((t, i) => out.push({ file: name.replace(/\\/g, '/'), line: i + 1, text: t }));
    } catch (e) { /* unreadable: passed over */ }
  }
  return out;
}

// The lines a step adds.
function stepLines(step) {
  const top = (() => { try { return git(step.dir, ['rev-parse', '--show-toplevel']).trim(); } catch (e) { return ''; } })();
  if (!top) return [];
  if (step.kind === 'push') return diffLines(step.dir, ['origin/main...HEAD']).concat(diffLines(step.dir, ['--cached']));
  const lines = diffLines(step.dir, ['--cached']);
  if (step.all || step.add) lines.push(...diffLines(step.dir, ['--', ...(step.add || [])]));
  if (step.add) lines.push(...untrackedLines(step.dir, top, step.add));
  return lines;
}

// The first added line that holds a key, as { file, line }; null when none does.
function findKey(lines) {
  for (const l of lines) {
    if (FIXTURE_FOLDER.test(l.file) && FIXTURE_MARK.test(l.text)) continue;
    if (KEYS.some((r) => r.test(l.text))) return { file: l.file, line: l.line };
  }
  return null;
}

// The reason the command is refused, or '' when it is allowed.
function refused(command, dir) {
  const u = upwork(command);
  if (u) return u;
  if (!GIT_OP.test(command)) return '';
  for (const step of gitSteps(command, dir)) {
    const key = findKey(stepLines(step));
    if (key) return keyReason(key.file, key.line);
  }
  return '';
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let reason = '';
    try {
      const input = JSON.parse(raw || '{}') || {};
      const command = input.tool_input && typeof input.tool_input.command === 'string' ? input.tool_input.command : '';
      reason = command ? refused(command, input.cwd || process.env.CLAUDE_PROJECT_DIR || '.') : '';
    } catch (e) { reason = ''; }
    if (!reason) process.exit(0);
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
    process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { refused, upwork, gitSteps, added, findKey, keyReason, REASON_UPWORK, KEYS };
