#!/usr/bin/env node
// status-check.js: keeps a chat's status page current: when a chat saved its page and then changed more, George's next
// message brings the chat a one-line note to save the page again.
// Written in kokonut-rules, run by the UserPromptSubmit hook in .claude/settings.json (after reminder.js), and
// installed machine-wide in a cloud chat by kokonut-rules' setup.sh. Never a refusal: what it prints becomes context for
// the reply the chat is about to write. It replaced kokonut-status's computer copy (scripts/status-stop-hook.js).
// It reads the transcript (the same reading code as reminder.js), from its start at every message:
//   - a chat is tied to a page once it saves or creates that page with status.js (status.js save <name> or
//     status.js new <name>) and the call's result says SAVED; a read alone ties nothing, a facts/ page ties nothing,
//     a failed save ties nothing, and a delete of that page (DELETED) unties the chat;
//   - work is an Edit, Write, MultiEdit, NotebookEdit, Agent, Task or Workflow call, or a command with git commit,
//     push or merge, a gcloud deploy, update, create, delete or execute, or bq query, rm, mk or load; a command that
//     calls status.js is not work.
// When a tied chat has work after its last save, it prints one line: "Status note: the page <name> was saved before
// later changes. Save it again if the state, a decision, the next step or a blocker changed (node
// /home/user/kokonut-status/scripts/status.js read <name>, edit, save with its BASE)." The path is the cloud's clone
// of kokonut-status, so the command works from any folder of the chat, /home/user included.
// Once per unsaved stretch: the key of the last save's result (its uuid, else its tool call's id) is written to
// ~/.claude/status-state/<session id>.check.json when the note is printed, and the note is printed only while that
// file holds another key. A newer save has a new key, so work after it brings the note again. State files older than
// 30 days are removed. A transcript over 20 MB is read from its last 2 MB only: a save before that is not seen, and
// the chat counts as untied.
// Node only, no packages, Windows and Linux. It prints nothing else and always exits 0: any error prints nothing.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'status-state');
const STATE_SUFFIX = '.check.json';
const STATUS_JS = '/home/user/kokonut-status/scripts/status.js'; // the cloud's clone: works from any folder
const KEEP_STATE_DAYS = 30;
const BIG = 20 * 1024 * 1024;
const TAIL = 2 * 1024 * 1024;
// A status.js call: its verb and page name, not a facts/ page; several may stand in one command.
const STATUS_CALL = /status\.js["']?\s+(read|save|new|delete)\s+["']?(?!facts\/)([a-z0-9]+(?:[-_][a-z0-9]+)*)/g;
const WORK_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Agent', 'Task', 'Workflow']);
const WORK_COMMAND = /\bgit\s+(commit|push|merge)\b|\bgcloud\b[^\n]*\b(deploy|update|create|delete|execute)\b|\bbq\s+(query|rm|mk|load)\b/;

// ---- Reading the transcript: the same code as reminder.js. ----

function readTranscript(file) {
  if (typeof file !== 'string' || !file) return '';
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  if (!fs.existsSync(file)) return '';
  const size = fs.statSync(file).size;
  if (size <= BIG) return fs.readFileSync(file, 'utf8');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(TAIL);
    const got = fs.readSync(fd, buf, 0, TAIL, size - TAIL);
    const text = buf.toString('utf8', 0, got);
    return text.slice(text.indexOf('\n') + 1); // the first line is cut: drop it
  } finally {
    fs.closeSync(fd);
  }
}

function parse(line) {
  const s = line.trim();
  if (!s.startsWith('{')) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

// ---- The page the chat saved last, and the work since. ----

// { project, key, work }: the page the chat is tied to (null: none), the key of its last save's result and the work
// done since that save.
function scan(lines) {
  const state = { project: null, key: null, work: 0 };
  const pending = {}; // tool_use id -> { verb, name }: a save, new or delete waiting for its result
  for (const line of lines) {
    const e = parse(line);
    if (!e || e.isSidechain || !e.message || !Array.isArray(e.message.content)) continue;
    if (e.type === 'user') {
      for (const c of e.message.content) {
        if (!c || c.type !== 'tool_result' || !pending[c.tool_use_id]) continue;
        const call = pending[c.tool_use_id];
        delete pending[c.tool_use_id];
        if (c.is_error) continue;
        const out = textOf(c.content);
        if (call.verb === 'delete') {
          if (/\bDELETED\b/.test(out) && state.project === call.name) {
            Object.assign(state, { project: null, key: null, work: 0 });
          }
        } else if (/\bSAVED\b/.test(out)) {
          Object.assign(state, { project: call.name, key: String(e.uuid || c.tool_use_id), work: 0 });
        }
      }
    } else if (e.type === 'assistant') {
      for (const c of e.message.content) {
        if (!c || c.type !== 'tool_use') continue;
        const command = c.input && typeof c.input.command === 'string' ? c.input.command : '';
        const calls = [...command.matchAll(STATUS_CALL)];
        if (calls.length) {
          // a read alone ties nothing: only a save (or a new page) that succeeded does
          for (const call of calls) if (call[1] !== 'read') pending[c.id] = { verb: call[1], name: call[2] };
          continue;
        }
        if (WORK_TOOLS.has(c.name) || WORK_COMMAND.test(command)) state.work++;
      }
    }
  }
  return state;
}

function note(name) {
  return `Status note: the page ${name} was saved before later changes. Save it again if the state, a decision, the ` +
    `next step or a blocker changed (node ${STATUS_JS} read ${name}, edit, save with its BASE).`;
}

// ---- Once per unsaved stretch. ----

function kebab(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function prune(stateDir) {
  try {
    const cutoff = Date.now() - KEEP_STATE_DAYS * 86400000;
    for (const f of fs.readdirSync(stateDir)) {
      const full = path.join(stateDir, f);
      if (f.endsWith(STATE_SUFFIX) && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch (e) { /* nothing to prune */ }
}

// The line to print for a UserPromptSubmit input; '' for nothing. stateDir can be given by the tests.
function decide(input, stateDir) {
  const dir = stateDir || STATE_DIR;
  if (!input || !input.session_id || !input.transcript_path) return '';
  const raw = readTranscript(input.transcript_path);
  if (!raw) return '';
  const state = scan(raw.split('\n'));
  if (!state.project || state.work === 0) return '';
  const file = path.join(dir, kebab(input.session_id) + STATE_SUFFIX);
  let kept = {};
  try { kept = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { kept = {}; }
  if (kept.noted === state.key) return ''; // this stretch was noted already
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ noted: state.key, project: state.project }));
  prune(dir);
  return note(state.project);
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let line = '';
    try { line = decide(JSON.parse(raw || '{}')); } catch (e) { line = ''; }
    if (!line) process.exit(0);
    process.stdout.write(line + '\n', () => process.exit(0));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { decide, scan, note, kebab, STATE_DIR };
