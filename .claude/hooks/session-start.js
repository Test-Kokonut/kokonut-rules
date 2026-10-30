#!/usr/bin/env node
// session-start.js: at the start of every chat, signs gcloud in as the reader identity, then feeds the chat its map:
// the rulebook's index, the repo map and the project dashboard.
// Written in kokonut-rules, run by the SessionStart hook in .claude/settings.json, and installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh (there it runs after the rules are refreshed). It prints, in this order, each
// part after a blank line:
//   "Signed in as the reader identity." when the environment holds the reader key (KOKONUT_READER_KEY) and gcloud
//       has no account yet: the key goes to $HOME/.kokonut-reader.json (mode 600), then
//       gcloud auth activate-service-account --key-file=<that file> --quiet and
//       gcloud config set project kokonut-data-base --quiet. With an account already there, nothing is done.
//   The "Index." bullet of the section "# The repos" of the rulebook (~/.claude/CLAUDE.md, else
//       $CLAUDE_PROJECT_DIR/CLAUDE.md), as written there; a rulebook without that bullet: nothing.
//   "REPOS.md:" and the repo map: $CLAUDE_PROJECT_DIR/REPOS.md, else a clone's kokonut-temp/REPOS.md, else
//       kokonut-temp's REPOS.md from GitHub (the map lives only in kokonut-temp; the other repos read it from there).
//   "DASHBOARD.md (kokonut-status):" and the dashboard, at most 200 lines: a clone's kokonut-status/DASHBOARD.md,
//       else from GitHub; neither: the one line "Dashboard: attach kokonut-status and read DASHBOARD.md".
// A clone is looked for beside the project folder, inside it and in /home/user, and GitHub is read with
// gh api .../contents/<file> (base64 decoded), both by reminder.js's code (repoFile). A part that fails is left out
// alone. Every gcloud call runs without CLOUDSDK_AUTH_ACCESS_TOKEN: the cloud session sets a placeholder token
// there that would win over the key. The chat's own shell gets the same: when that variable is set and Claude Code
// names its environment file (CLAUDE_ENV_FILE, run as shell code before each Bash command), one line
// "unset CLOUDSDK_AUTH_ACCESS_TOKEN" is appended to it, once, so plain gcloud and bq calls work in the chat with no
// prefix. The key and the file's content are never printed or logged; gcloud's own output is dropped.
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
const MAP_HEAD = 'REPOS.md:';
const DASHBOARD_HEAD = 'DASHBOARD.md (kokonut-status):';
const NO_DASHBOARD = 'Dashboard: attach kokonut-status and read DASHBOARD.md';
const DASHBOARD_LINES = 200;

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

// A file's text without its trailing line breaks; '' when it cannot be read.
const trimmed = (text) => String(text || '').replace(/\s+$/, '');

// The parts to print, in order. env, run (the gcloud runner), gh (the gh runner), home and projectDir can be given by
// the tests.
function start(options) {
  const o = options || {};
  const env = o.env || process.env;
  const run = o.run || gcloud;
  const home = o.home || env.HOME || os.homedir();
  const projectDir = path.resolve(o.projectDir || env.CLAUDE_PROJECT_DIR || process.cwd());
  const parts = [];
  try { if (signIn(env, run, home)) parts.push(SIGNED_IN); } catch (e) { /* no sign-in line */ }
  try { clearPlaceholder(env); } catch (e) { /* the chat keeps the prefix */ }
  try {
    const index = R.bullet(R.section(R.rulebookText(projectDir, projectDir, home), '# The repos'), 'Index.');
    if (index) parts.push(index);
  } catch (e) { /* no index */ }
  try {
    const map = trimmed(R.readText(path.join(projectDir, 'REPOS.md')) || R.repoFile(projectDir, 'kokonut-temp', 'REPOS.md', o.gh));
    if (map) parts.push(MAP_HEAD + '\n' + map);
  } catch (e) { /* no map */ }
  try {
    const board = trimmed(R.repoFile(projectDir, 'kokonut-status', 'DASHBOARD.md', o.gh));
    parts.push(board ? DASHBOARD_HEAD + '\n' + board.split('\n').slice(0, DASHBOARD_LINES).join('\n') : NO_DASHBOARD);
  } catch (e) { /* no dashboard */ }
  return parts;
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0)); // only as the hook: a test that loads this file keeps its own errors
  let parts = [];
  try { parts = start(); } catch (e) { parts = []; }
  if (!parts.length) process.exit(0);
  process.stdout.write(parts.join('\n\n') + '\n', () => process.exit(0));
}

module.exports = { start, signIn, gcloudEnv, clearPlaceholder, UNSET_LINE, KEY_FILE, SIGNED_IN, MAP_HEAD, DASHBOARD_HEAD, NO_DASHBOARD, DASHBOARD_LINES };
