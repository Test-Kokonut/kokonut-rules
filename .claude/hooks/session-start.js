#!/usr/bin/env node
// session-start.js: at the start of every chat, signs gcloud in as the reader identity, then gives the chat a short
// start note: where things are.
// Written in kokonut-rules, run by the SessionStart hook in .claude/settings.json, and installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh (there it runs after the rules are refreshed). It prints, in this order, each
// part after a blank line:
//   "Signed in as the reader identity." when the environment holds the reader key (KOKONUT_READER_KEY) and gcloud
//       has no account yet: the key goes to $HOME/.kokonut-reader.json (mode 600), then
//       gcloud auth activate-service-account --key-file=<that file> --quiet and
//       gcloud config set project kokonut-data-base --quiet. With an account already there, nothing is done.
//   "Where things are:" and a few lines (WHERE below): the repo map, the projects and their status tool, reading live
//       data, the rules. Always printed.
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

const KEY_FILE = '.kokonut-reader.json';
const PROJECT = 'kokonut-data-base';
const SIGNED_IN = 'Signed in as the reader identity.';
const WHERE = [
  'Where things are:',
  '- Repo map: REPOS.md in kokonut-temp.',
  '- Reading live data: kokonut-upwork-sync shared/README.md.',
  '- Rules: kokonut-rules (CLAUDE.md, hooks, setup.sh).',
].join('\n');
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

// The parts to print, in order. env, run (the gcloud runner) and home can be given by the tests.
function start(options) {
  const o = options || {};
  const env = o.env || process.env;
  const run = o.run || gcloud;
  const home = o.home || env.HOME || os.homedir();
  const parts = [];
  try { if (signIn(env, run, home)) parts.push(SIGNED_IN); } catch (e) { /* no sign-in line */ }
  try { clearPlaceholder(env); } catch (e) { /* the chat keeps the prefix */ }
  parts.push(WHERE);
  return parts;
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0)); // only as the hook: a test that loads this file keeps its own errors
  let parts = [];
  try { parts = start(); } catch (e) { parts = []; }
  if (!parts.length) process.exit(0);
  process.stdout.write(parts.join('\n\n') + '\n', () => process.exit(0));
}

module.exports = { start, signIn, gcloudEnv, clearPlaceholder, UNSET_LINE, KEY_FILE, SIGNED_IN, WHERE };
