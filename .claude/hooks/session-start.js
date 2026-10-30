#!/usr/bin/env node
// session-start.js: at the start of every chat, signs gcloud in as the reader identity, then gives the chat a short
// start note: where things are, and the open projects, one line each (no dashboard: /continue <name> shows a project's
// brief).
// Written in kokonut-rules, run by the SessionStart hook in .claude/settings.json, and installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh (there it runs after the rules are refreshed). It prints, in this order, each
// part after a blank line:
//   "Signed in as the reader identity." when the environment holds the reader key (KOKONUT_READER_KEY) and gcloud
//       has no account yet: the key goes to $HOME/.kokonut-reader.json (mode 600), then
//       gcloud auth activate-service-account --key-file=<that file> --quiet and
//       gcloud config set project kokonut-data-base --quiet. With an account already there, nothing is done.
//   "Where things are:" and a few lines (WHERE below): the repo map, the projects and their status tool, reading live
//       data, the Drive folder "Bots - work in progress", the rules. Always printed.
//   "Open projects ...:" and one line per page of a kokonut-status clone's projects/ (looked for beside the project
//       folder, inside it and in /home/user: reminder.js's cloneBases), the most recently updated first:
//       "- <name>: <the first words of its Purpose>", at most 40 lines, then "- and <n> more: ..." when there are more.
//       No clone: the one line "Open projects: attach kokonut-status to see projects." (GitHub is not read: the repo
//       is private, and a chat reads it only once attached.)
// A part that fails is left out alone. Every gcloud call runs without CLOUDSDK_AUTH_ACCESS_TOKEN: the cloud session
// sets a placeholder token there that would win over the key. The chat's own shell gets the same: when that variable
// is set and Claude Code names its environment file (CLAUDE_ENV_FILE, run as shell code before each Bash command), one
// line "unset CLOUDSDK_AUTH_ACCESS_TOKEN" is appended to it, once, so plain gcloud and bq calls work in the chat with
// no prefix. The key and the file's content are never printed or logged; gcloud's own output is dropped.
// Node only, no packages, Windows and Linux. Any error prints nothing (a failed part only drops its own lines) and
// the hook always exits 0: it never traps a chat.
'use strict';
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./reminder.js');

const KEY_FILE = '.kokonut-reader.json';
const PROJECT = 'kokonut-data-base';
const SIGNED_IN = 'Signed in as the reader identity.';
const WHERE = [
  'Where things are:',
  '- Repo map: REPOS.md in kokonut-temp.',
  '- Projects: kokonut-status projects/<name>.md, read and saved only with its scripts/status.js.',
  '- Reading live data: kokonut-upwork-sync shared/README.md.',
  '- Drive: "Bots - work in progress", https://drive.google.com/drive/folders/1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy',
  '- Rules: kokonut-rules (CLAUDE.md, hooks, setup.sh, /continue).',
].join('\n');
const PROJECTS_HEAD = 'Open projects (kokonut-status, newest first; /continue <name> shows its brief):';
const NO_PROJECTS = 'Open projects: attach kokonut-status to see projects.';
const MAX_PROJECTS = 40;
const PURPOSE_WORDS = 70; // characters of a Purpose's first line, cut at a word

// The environment gcloud runs in: this one without the placeholder token.
function gcloudEnv(env) {
  const out = Object.assign({}, env);
  delete out.CLOUDSDK_AUTH_ACCESS_TOKEN;
  return out;
}

// Runs gcloud; returns its output when asked to keep it. On Windows gcloud is a .cmd file, run through the shell.
function gcloud(args, env, keep, timeout) {
  const options = { env, encoding: 'utf8', stdio: ['ignore', keep ? 'pipe' : 'ignore', 'ignore'], timeout: timeout || 15000, windowsHide: true };
  if (process.platform === 'win32') {
    return execSync(['gcloud', ...args.map((a) => '"' + String(a).replace(/"/g, '') + '"')].join(' '), options) || '';
  }
  return execFileSync('gcloud', args, options) || '';
}

// Clears the placeholder token from the chat's shell: the unset line goes into Claude Code's environment file, once.
// Nothing happens without the variable or without the file name.
const UNSET_LINE = 'unset CLOUDSDK_AUTH_ACCESS_TOKEN';
function clearPlaceholder(env) {
  const file = env.CLAUDE_ENV_FILE;
  if (typeof file !== 'string' || !file || typeof env.CLOUDSDK_AUTH_ACCESS_TOKEN !== 'string') return false;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = ''; }
  if (text.split('\n').some((l) => l.trim() === UNSET_LINE)) return false;
  fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + UNSET_LINE + '\n');
  return true;
}

// Signs in with the key when there is one and gcloud has no account; true when it did.
function signIn(env, run, home) {
  const key = env.KOKONUT_READER_KEY;
  if (typeof key !== 'string' || !key.trim()) return false;
  const clean = gcloudEnv(env);
  const accounts = String(run(['auth', 'list', '--format=value(account)'], clean, true, 15000) || '').trim();
  if (accounts) return false;
  const file = path.join(home, KEY_FILE);
  fs.writeFileSync(file, key, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  run(['auth', 'activate-service-account', '--key-file=' + file, '--quiet'], clean, false, 25000);
  run(['config', 'set', 'project', PROJECT, '--quiet'], clean, false, 15000);
  return true;
}

// The first words of a page's Purpose: its first line that holds text, without a list marker or a leading
// "George, <date>:", cut at a word; '' when it has none.
function purposeWords(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => l.trim() === '## Purpose');
  if (at < 0) return '';
  let first = '';
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,6} /.test(l)) break;
    if (l.trim()) { first = l.trim(); break; }
  }
  const words = first.replace(/^[-*]\s+/, '').replace(/^George(?:,[^:]{0,60})?:\s*/, '').trim();
  if (words.length <= PURPOSE_WORDS) return words;
  const cut = words.slice(0, PURPOSE_WORDS);
  return (cut.lastIndexOf(' ') > 20 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

// The open projects of the first kokonut-status clone found (cloneBases), one line each, the most recently updated
// first; '' when there is no clone.
function projects(projectDir) {
  const base = R.cloneBases(projectDir).find((b) => {
    try { return fs.statSync(path.join(b, 'kokonut-status', 'projects')).isDirectory(); } catch (e) { return false; }
  });
  if (!base) return '';
  const dir = path.join(base, 'kokonut-status', 'projects');
  const pages = fs.readdirSync(dir).filter((f) => /^[a-z0-9]+(?:[-_][a-z0-9]+)*\.md$/.test(f)).map((f) => {
    const text = R.readText(path.join(dir, f));
    const updated = (/^Updated: (.*)$/m.exec(text) || [])[1] || '';
    return { name: f.slice(0, -3), updated, words: purposeWords(text) };
  });
  pages.sort((a, b) => (a.updated === b.updated ? (a.name < b.name ? -1 : 1) : (a.updated < b.updated ? 1 : -1)));
  const lines = pages.slice(0, MAX_PROJECTS).map((p) => `- ${p.name}${p.words ? ': ' + p.words : ''}`);
  if (pages.length > MAX_PROJECTS) {
    lines.push(`- and ${pages.length - MAX_PROJECTS} more: node ${path.join(base, 'kokonut-status', 'scripts', 'status.js')} list`);
  }
  return [PROJECTS_HEAD].concat(lines.length ? lines : ['- None.']).join('\n');
}

// The parts to print, in order. env, run (the gcloud runner), home and projectDir can be given by the tests.
function start(options) {
  const o = options || {};
  const env = o.env || process.env;
  const run = o.run || gcloud;
  const home = o.home || env.HOME || os.homedir();
  const projectDir = path.resolve(o.projectDir || env.CLAUDE_PROJECT_DIR || process.cwd());
  const parts = [];
  try { if (signIn(env, run, home)) parts.push(SIGNED_IN); } catch (e) { /* no sign-in line */ }
  try { clearPlaceholder(env); } catch (e) { /* the chat keeps the prefix */ }
  parts.push(WHERE);
  try { parts.push(projects(projectDir) || NO_PROJECTS); } catch (e) { /* no project list */ }
  return parts;
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0)); // only as the hook: a test that loads this file keeps its own errors
  let parts = [];
  try { parts = start(); } catch (e) { parts = []; }
  if (!parts.length) process.exit(0);
  process.stdout.write(parts.join('\n\n') + '\n', () => process.exit(0));
}

module.exports = { start, signIn, gcloudEnv, clearPlaceholder, purposeWords, projects, UNSET_LINE, KEY_FILE, SIGNED_IN, WHERE,
  PROJECTS_HEAD, NO_PROJECTS, MAX_PROJECTS };
