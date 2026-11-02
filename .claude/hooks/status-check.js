#!/usr/bin/env node
// status-check.js: the stop check: a chat that changed things since it last wrote its project folder may not end its
// turn without writing it: the end of the turn is refused once, with a one-line note to write the project notes.
// Written in kokonut-rules, run by the Stop hook in .claude/settings.json, and installed machine-wide in a cloud chat
// by kokonut-rules' setup.sh. The refusal is Claude Code's Stop answer {"decision": "block", "reason": <the note>} on
// stdout: the chat goes on with the note, writes the notes or finishes.
// It reads the transcript (the same reading code as reminder.js), from its start at every stop:
//   - a folder write is a save of the project's status page, or a write of the project's working notes:
//       - a page save: status.js save <name> or status.js new <name> whose result says SAVED; a read is none, a
//         facts/ page is none, a failed save is none;
//       - a notes write: a Google Drive or Google Docs create_file, update_file or update_doc call (the connector's
//         part of the tool's name may be a uuid: only the end of the name counts) on the file named notes: its title
//         in the call (create_file, update_file), or its id (fileId, documentId) where an earlier connector result
//         (search_files, get_file_metadata, create_file) gave that id with the title notes; a call that failed is
//         none;
//     the chat's first folder write ties it to its project; a delete of its page (status.js delete <name>, DELETED)
//     unties it; a chat never tied is never refused;
//   - work is an Edit, Write, MultiEdit, NotebookEdit, Agent, Task or Workflow call, an artifact publish or delete
//     (Artifact), a scheduled task created, changed or deleted (create_trigger, update_trigger, delete_trigger), or a
//     command with git commit, push or merge, a gcloud deploy, update, create, delete or execute, or bq query, rm, mk
//     or load; a command that calls status.js is not work.
// When a tied chat has work after its last folder write, the stop is refused with one line: "Stop check: things
// changed since the project folder was last written. Write the project notes (and save the page if State or Next step
// changed) before ending."
// Once per unsaved stretch: its state file, ~/.claude/status-state/<session id>.check.json, holds the last folder
// write the chat was refused after, and is written before the stop is refused. A stop after that write is never
// refused again, however much more work; a folder write after it starts a new stretch, and new work after that write
// is refused again. A stop that Claude Code already marks as continued by a Stop hook (stop_hook_active) is never
// refused, and a helper's turns (isSidechain) count for nothing. State files older than 30 days are removed. A
// transcript over 20 MB is read from its last 2 MB only: a folder write before that is not seen (nor a notes id
// given before that), and the chat counts as untied.
// Node only, no packages, Windows and Linux. An error never blocks: it prints nothing and always exits 0.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'status-state');
const STATE_SUFFIX = '.check.json';
const KEEP_STATE_DAYS = 30;
const BIG = 20 * 1024 * 1024;
const TAIL = 2 * 1024 * 1024;
// A status.js call: its verb and page name, not a facts/ page; several may stand in one command.
const STATUS_CALL = /status\.js["']?\s+(read|save|new|delete)\s+["']?(?!facts\/)([a-z0-9]+(?:[-_][a-z0-9]+)*)/g;
const WORK_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Agent', 'Task', 'Workflow']);
const WORK_COMMAND = /\bgit\s+(commit|push|merge)\b|\bgcloud\b[^\n]*\b(deploy|update|create|delete|execute)\b|\bbq\s+(query|rm|mk|load)\b/;
const WORK_TRIGGER = /^mcp__.+__(create_trigger|update_trigger|delete_trigger)$/;
const ARTIFACT_WRITES = new Set([undefined, 'publish', 'delete']);
// A connector call that writes a Drive file or a Doc; the notes are the file whose title is notes.
const NOTES_WRITE = /^mcp__.+__(create_file|update_file|update_doc)$/;
const NOTES_TITLE = /"title"\s*:\s*"\s*notes\s*"/i;
const isNotes = (title) => typeof title === 'string' && title.trim().toLowerCase() === 'notes';

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

// ---- The last folder write, and the work since. ----

// The ids a connector's result gives for files titled notes: one file (create_file, get_file_metadata) or a list
// (search_files: {"files": [...]}).
function learnNotes(out, ids) {
  if (!NOTES_TITLE.test(out)) return;
  let v = null;
  try { v = JSON.parse(out); } catch (e) { return; }
  const files = v && Array.isArray(v.files) ? v.files : [v];
  for (const f of files) if (f && typeof f.id === 'string' && isNotes(f.title)) ids.add(f.id);
}

// Whether a tool call writes the notes: its title in the call, or an id known as the notes'.
function writesNotes(c, ids) {
  if (!NOTES_WRITE.test(c.name)) return false;
  const i = c.input || {};
  return isNotes(i.title) || [i.fileId, i.documentId].some((id) => typeof id === 'string' && ids.has(id));
}

function isWork(c, command) {
  if (WORK_TOOLS.has(c.name) || WORK_TRIGGER.test(c.name) || WORK_COMMAND.test(command)) return true;
  return c.name === 'Artifact' && ARTIFACT_WRITES.has(c.input ? c.input.action : undefined);
}

// { tied, project, key, work }: whether the chat wrote its project folder, the page it saved last (null: none), the
// key of its last folder write's result and the work done since that write.
function scan(lines) {
  const state = { tied: false, project: null, key: null, work: 0 };
  const notesIds = new Set();
  // tool_use id -> { verb, name }: a page save, new or delete, or a notes write ('notes'), waiting for its result;
  // mcp: a connector call, whose result may give the notes' id
  const pending = {};
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
        if (call.mcp) learnNotes(out, notesIds);
        const key = String(e.uuid || c.tool_use_id);
        const wrote = (project) => Object.assign(state, { tied: true, project, key, work: 0 });
        if (call.verb === 'delete') {
          if (/\bDELETED\b/.test(out) && state.project === call.name) {
            Object.assign(state, { tied: false, project: null, key: null, work: 0 });
          }
        } else if (call.verb === 'notes') {
          wrote(state.project);
        } else if (call.verb && /\bSAVED\b/.test(out)) {
          wrote(call.name);
        }
      }
    } else if (e.type === 'assistant') {
      for (const c of e.message.content) {
        if (!c || c.type !== 'tool_use') continue;
        const command = c.input && typeof c.input.command === 'string' ? c.input.command : '';
        const calls = [...command.matchAll(STATUS_CALL)];
        if (calls.length) {
          // a read alone writes nothing: only a save (or a new page) that succeeded does
          for (const call of calls) if (call[1] !== 'read') pending[c.id] = { verb: call[1], name: call[2] };
          continue;
        }
        const mcp = typeof c.name === 'string' && c.name.startsWith('mcp__');
        if (writesNotes(c, notesIds)) pending[c.id] = { verb: 'notes', mcp };
        else if (mcp) pending[c.id] = { mcp };
        if (isWork(c, command)) state.work++;
      }
    }
  }
  return state;
}

function note() {
  return 'Stop check: things changed since the project folder was last written. Write the project notes ' +
    '(and save the page if State or Next step changed) before ending.';
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

// The note to refuse a Stop with; '' to let the chat stop. stateDir can be given by the tests.
function decide(input, stateDir) {
  const dir = stateDir || STATE_DIR;
  if (!input || !input.session_id || !input.transcript_path || input.stop_hook_active) return '';
  const raw = readTranscript(input.transcript_path);
  if (!raw) return '';
  const state = scan(raw.split('\n'));
  if (!state.tied || state.work === 0) return '';
  const file = path.join(dir, kebab(input.session_id) + STATE_SUFFIX);
  if (fs.existsSync(file)) {
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return ''; } // unreadable: never block
    if (!kept || kept.noted === state.key) return ''; // refused once already in this stretch
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ noted: state.key, project: state.project }));
  prune(dir);
  return note();
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
    process.stdout.write(JSON.stringify({ decision: 'block', reason: line }) + '\n', () => process.exit(0));
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
