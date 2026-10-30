#!/usr/bin/env node
// no-main.js: refuses every git push that would land on main or master: a chat pushes the branch it works on (the
// one the cloud gives it, claude/... included) and lands it on main by a pull request.
// Written in kokonut-rules, installed machine-wide by its setup.sh; run by the PreToolUse hook on Bash|PowerShell in
// .claude/settings.json.
// A push is refused when one of its refs is main or master (origin main, HEAD:main, +main, :main,
// refs/heads/main, --delete main), when it names no ref (git push, git push origin) or HEAD and the branch
// it pushes is main or master, or when it pushes every branch (--all, --mirror, --branches). A push whose branch is
// a shell substitution or variable ($(...), `...`, ${...}, $name) is refused too: the branch is unknown. Any other
// branch passes.
// Each simple command (the parts between &&, ||, ;, |, & and line breaks, cut there even inside quotes, so that a
// quote read wrongly hides no command) is read by its command word: git counts after variable assignments, keywords
// (if, then, do, !, ...), grouping and a function's head, or anywhere after a wrapper that runs the rest of its line
// (sudo, env, nohup, timeout, xargs, ...). A quoted word is still taken whole where it holds a separator. A git word
// in another command's text is no push: echo never run git push origin main, grep 'git push origin main' docs/.
// Text that runs is read as well: the string after bash, sh or zsh -c, pwsh or powershell -Command (or -c), cmd /c
// and eval, and what $(...) and `...` run, are each read as a command line of their own; in those, and in the code
// after node -e, python -c, perl -e and ruby -e, a push to main or master written out is refused
// (bash -c "git push origin main"). Any other text, quoted or not, is never searched for a push.
// The branch pushed is read with git in the folder the push runs in: the hook's cwd (else CLAUDE_PROJECT_DIR),
// moved by a cd, Set-Location or pushd earlier in the same command, or the folder of git -C; a git switch or
// checkout earlier in the same command stands for the branch it moves to. git may be called git.exe or by its path.
// Node only, no packages, Windows and Linux. Any internal error prints nothing and exits 0.
'use strict';
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const REASON_MAIN = "Pushing to main or master is refused. Push the chat's own branch, then open a pull request to main.";
const REASON_UNKNOWN = "Pushing a branch named by a substitution or a variable ($(...), `...`, ${...}, $name) is refused: the branch is unknown. Push the chat's own branch by its name (git push -u origin <branch>).";
const MAIN = /^(?:refs\/heads\/)?(?:main|master)$/;
const UNKNOWN = /\$[({\w]|`/;
const VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const NEW_BRANCH = new Set(['-b', '-B', '-c', '-C', '--create', '--force-create', '--orphan']);
const CHANGE_DIR = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
// A redirection (>log, 2>&1, &>out, <in), and one whose target is the next word (> "$LOG").
const REDIRECT = /^(?:\d*[<>]|&>)/;
const REDIRECT_ALONE = /^(?:\d*(?:<<?|>>?)|&>>?)$/;
// Between two simple commands: && || ; | a line break, and a lone & (not the & of 2>&1, &> or <&).
const SEPARATORS = /&&|\|\||[;|\n]|(?<![<>&])&(?![&>])/;
// Words before a command word: a variable assignment, a keyword, grouping, a function's head. (PowerShell's call
// operator, & git push, is a lone & and so a separator.)
const BEFORE = /^(?:[A-Za-z_]\w*=.*|if|then|elif|else|do|while|until|!|\{|\(|[\w.-]+\(\))$/;
// Programs that run the rest of their line as a command, after options of their own that are not read.
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'nohup', 'nice', 'ionice', 'time', 'timeout',
  'xargs', 'stdbuf', 'chronic', 'unbuffer', 'flock']);
// Shells that run the string after -c (also a group of short options that holds c: bash -lc).
const SHELLS = new Set(['bash', 'sh', 'zsh']);
// Programs that run code given after one of these options: the code is searched, not read as a command line.
const CODE = { node: ['-e', '--eval', '-p', '--print'], python: ['-c'], python3: ['-c'], py: ['-c'], perl: ['-e', '-E'], ruby: ['-e'] };
// For a push written out in text that runs (bash -c "git push origin main"): main or master as a ref after "git push".
const QUOTED_PUSH = /\bgit(?:\.exe)?["']?\s+push\b[^;&|\n]*?(?<=[\s:+'"])(?:main|master)(?![\w/:.-])/;
const MAX_DEPTH = 4; // text that runs inside text that runs: read this deep

function currentBranch(dir) {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', '-C', dir, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true,
    }).trim();
  } catch (e) { return ''; }
}

// The simple commands of a command line, each { text, at } (at: where it starts): cut at every separator, quoted or
// not, so that no quote read wrongly (an apostrophe in a here-document) can hide a command.
function segments(command) {
  const out = [];
  let from = 0;
  for (const m of command.matchAll(new RegExp(SEPARATORS.source, 'g'))) {
    out.push({ text: command.slice(from, m.index), at: from });
    from = m.index + m[0].length;
  }
  out.push({ text: command.slice(from), at: from });
  return out;
}

// The words of text that start between from and to, quotes removed: enough to read a git command line. A word may
// join quoted and unquoted parts (NAME="a b", HEAD:"main") and is taken whole where a quoted string in it runs past
// to (bash -c "git fetch; git push"). A quote left open is dropped, and so is a ")" closing a group or a
// substitution that began before the word.
function tokens(text, from, to) {
  const out = [];
  const re = /(?:"[^"]*"|'[^']*'|[^\s"';|&]|(?<=[<>])&|&(?=>))+/g; // unquoted, a word ends at ; | and & (not 2>&1, &>)
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    const w = m[0].replace(/"([^"]*)"|'([^']*)'/g, (all, a, b) => (a !== undefined ? a : b));
    const word = w.includes('(') ? w : w.replace(/\)+$/, '');
    if (word) out.push(word);
  }
  return out;
}

// The words of one simple command.
function words(segment) {
  return tokens(segment, 0, segment.length);
}

// git, git.exe, or either by its path (/usr/bin/git, C:\Program Files\Git\cmd\git.exe).
function isGit(word) {
  return /^git(?:\.exe)?$/i.test(word.split(/[\\/]/).pop());
}

// A command word's program: no folder, no .exe, lower case.
function program(word) {
  return word.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

// The folder a cd to target lands in, from here: ~ is the home folder; /c/... is C:/... on Windows (Git Bash).
function moveTo(here, target) {
  let t = target;
  if (t === '~' || /^~[\\/]/.test(t)) t = path.join(os.homedir(), t.slice(1));
  const drive = /^\/([a-zA-Z])(\/.*)?$/.exec(t);
  if (process.platform === 'win32' && drive) t = drive[1].toUpperCase() + ':' + (drive[2] || '/');
  return path.resolve(here, t);
}

// The index of the first word after variable assignments, keywords, grouping and a function's head.
function start(w) {
  let i = 0;
  while (i < w.length) {
    if (w[i] === 'function') i += 2;
    else if (BEFORE.test(w[i])) i++;
    else break;
  }
  return i;
}

// The text the command word at c runs, as { text, line } (line: a command line, read as one), or null. bash, sh,
// zsh: the first argument after -c; pwsh, powershell: every word after -Command (or -c, -Com, ...); cmd: every word
// after /c or /k; eval: every word after it; node, python, perl, ruby: the code after -e, -c, ... (not a command line).
function runs(w, c) {
  const name = program(w[c]);
  const rest = w.slice(c + 1);
  const flag = (ok) => rest.findIndex(ok);
  if (name === 'eval') return { text: rest.join(' '), line: true };
  if (SHELLS.has(name)) {
    const k = flag((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    const text = k < 0 ? undefined : rest.slice(k + 1).find((a) => !a.startsWith('-'));
    return text === undefined ? null : { text, line: true };
  }
  if (name === 'pwsh' || name === 'powershell') {
    const k = flag((a) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(a));
    return k < 0 ? null : { text: rest.slice(k + 1).join(' '), line: true };
  }
  if (name === 'cmd') {
    const k = flag((a) => /^\/[ck]$/i.test(a));
    return k < 0 ? null : { text: rest.slice(k + 1).join(' '), line: true };
  }
  if (CODE[name]) {
    const k = flag((a) => CODE[name].includes(a));
    return k < 0 || k + 1 >= rest.length ? null : { text: rest[k + 1], line: false };
  }
  return null;
}

// The index of the command word from i, or -1. Past a wrapper (sudo, env, timeout, ...), whose options are not
// read: the first git word, or the first word that runs text, after it.
function commandAt(w, i) {
  if (i >= w.length) return -1;
  if (!WRAPPERS.has(program(w[i]))) return i;
  for (let k = i + 1; k < w.length; k++) if (isGit(w[k]) || runs(w, k)) return k;
  return -1;
}

// What the $(...) and `...` that start between from and to run, each as its inner text, taken whole where it runs
// past to; one left open runs to the text's end.
function substitutions(text, from, to) {
  const out = [];
  const end = to === undefined ? text.length : to;
  for (let i = from || 0; i < end; i++) {
    if (text[i] === '`') {
      const j = text.indexOf('`', i + 1);
      out.push(text.slice(i + 1, j < 0 ? text.length : j));
      if (j < 0) break;
      i = j;
    } else if (text[i] === '$' && text[i + 1] === '(') {
      let open = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '(') open++;
        else if (text[j] === ')' && --open === 0) break;
      }
      out.push(text.slice(i + 2, j));
      i = j;
    }
  }
  return out;
}

// Text that runs: refused when a push to main or master is written out in it; a command line is also read as one,
// in the same folder and with the same branch.
function runText(text, line, here, tracked, depth) {
  if (QUOTED_PUSH.test(text)) return REASON_MAIN;
  return line && depth < MAX_DEPTH ? check(text, here, tracked, depth + 1) : '';
}

// The reason a command line run in dir is refused, or ''. tracked: the branch a git switch or checkout before it
// moved to (null: the checkout's own); depth: how deep it sits in text that runs.
function check(command, dir, trackedBefore, depth) {
  let here = path.resolve(dir); // the folder the next simple command runs in
  let tracked = trackedBefore; // the branch after a git switch/checkout earlier in this command; null: the checkout's own
  for (const segment of segments(command)) {
    const end = segment.at + segment.text.length;
    for (const text of substitutions(command, segment.at, end)) {
      const r = runText(text, true, here, tracked, depth);
      if (r) return r;
    }
    const w = tokens(command, segment.at + /^\s*\(*/.exec(segment.text)[0].length, end);
    const i = start(w);
    if (i < w.length && CHANGE_DIR.has(w[i].toLowerCase())) {
      const target = w.slice(i + 1).find((a) => !a.startsWith('-'));
      if (target) { here = moveTo(here, target); tracked = null; }
      continue;
    }
    const c = commandAt(w, i);
    if (c < 0) continue;
    const run = runs(w, c);
    if (run) {
      const r = runText(run.text, run.line, here, tracked, depth);
      if (r) return r;
      continue;
    }
    if (!isGit(w[c])) continue;
    let k = c + 1;
    let where = null; // git -C <dir>
    while (k < w.length && w[k].startsWith('-')) {
      if ((w[k] === '-C' || w[k] === '-c') && k + 1 < w.length) {
        if (w[k] === '-C') where = moveTo(here, w[k + 1]);
        k += 2;
      } else k++;
    }
    const sub = w[k];
    const args = w.slice(k + 1);
    if (sub === 'switch' || sub === 'checkout') {
      const n = args.findIndex((a) => NEW_BRANCH.has(a));
      const named = args.filter((a) => !a.startsWith('-'));
      if (n >= 0 && n + 1 < args.length) tracked = args[n + 1];
      else if (named.length === 1 && !args.includes('--')) tracked = named[0];
      continue;
    }
    if (sub !== 'push') continue;
    if (args.some((a) => a === '--all' || a === '--mirror' || a === '--branches')) return REASON_MAIN;
    const positional = [];
    for (let p = 0; p < args.length; p++) {
      if (VALUE_OPTIONS.has(args[p])) { p++; continue; }
      if (REDIRECT.test(args[p])) { if (REDIRECT_ALONE.test(args[p])) p++; continue; } // > file, 2>&1: not a ref
      if (!args[p].startsWith('-')) positional.push(args[p]);
    }
    const branch = () => (where ? currentBranch(where) : tracked !== null ? tracked : currentBranch(here));
    const refs = positional.slice(1); // the first word is the remote
    if (!refs.length) {
      const own = branch();
      if (UNKNOWN.test(own)) return REASON_UNKNOWN;
      if (MAIN.test(own)) return REASON_MAIN;
    }
    for (const ref of refs) {
      const r = ref.replace(/^\+/, '');
      const dst = r.includes(':') ? r.slice(r.indexOf(':') + 1) : r;
      const target = dst === 'HEAD' || dst === '@' ? branch() : dst;
      if (UNKNOWN.test(target)) return REASON_UNKNOWN;
      if (MAIN.test(target)) return REASON_MAIN;
    }
  }
  return '';
}

// The reason the command is refused, or '' when it is allowed.
function refused(command, dir) {
  return check(command, dir, null, 0);
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
      const dir = input.cwd || process.env.CLAUDE_PROJECT_DIR || '.';
      reason = /\bgit\b/.test(command) && /\bpush\b/.test(command) ? refused(command, dir) : '';
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

module.exports = { refused, words, isGit, moveTo, substitutions, REASON_MAIN, REASON_UNKNOWN };
