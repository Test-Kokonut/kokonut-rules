#!/usr/bin/env node
// reminder.js: before every message, the reply rules, read from the rulebook itself: this file holds no rule text of
// its own.
// Written in kokonut-rules, run by the UserPromptSubmit hook in .claude/settings.json, and installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh. At every run it reads the rulebook: ~/.claude/CLAUDE.md (the one the
// setup script installs, the copy the chat loads), else $CLAUDE_PROJECT_DIR/CLAUDE.md, else the CLAUDE.md of the
// hook's cwd (none of them: it prints nothing at all), and prints, each part after a blank line:
//   always: "REPLY RULES, before every reply:", then the section "# Replies" as written there (heading and rules);
//   the turn before George's message ran the status tool (a command naming scripts/status.js) for the first time in
//       the session: the section "## Status page" of kokonut-status's README.md;
//   it ran bq, gcloud logging read, gcloud builds log or gcloud run services for the first time in the session: the
//       section "## Reading from a chat" of kokonut-upwork-sync's shared/README.md.
// Those two READMEs are read from a clone of their repo (repoFile(): beside the project folder, inside it, or in the
// folder the cloud clones the repos into, /home/user), else from GitHub (gh api .../contents/..., base64 decoded),
// else a one-line pointer is printed. "First time" is kept in ~/.claude/reminder-state/<session id>.json (files older
// than 30 days are removed). A section the rulebook lacks is left out, silently; nothing else is printed.
// George's messages: isUserText() is true only for a message George typed in this chat. Claude Code writes other
// user-role entries too: tool results, command echoes, system notes, interruptions, task notifications, a helper's
// hand-back, a message from another session, the summary of a chat that ran out of room; none of them counts.
// lastTyped() gives George's latest message, one he typed while the chat was working (a queued message) included.
// The transcript is read once; one over 20 MB is read from its last 2 MB only. The reading code here (transcript,
// George's messages, rulebook, sections, a file beside the project or on GitHub) is shared: session-start.js and
// rule-guard.js require this file.
// Node only, no packages, Windows and Linux. It never fails a prompt: on any error it prints what it has, and it
// always exits 0.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'REPLY RULES, before every reply:';
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const STATUS_TOOL = /scripts[\\/]status\.js/;
const READER_COMMANDS = [/(?:^|[\s;&|(`'"])bq(?:\.cmd|\.exe)?\s/, /\bgcloud\b[^;&|\n]*?\blogging\s+read\b/,
  /\bgcloud\b[^;&|\n]*?\bbuilds\s+log\b/, /\bgcloud\b[^;&|\n]*?\brun\s+services\b/];
// The two definitions fed on first use: where they are, and the line printed when neither copy can be read.
const STATUS_DOC = { repo: 'kokonut-status', file: 'README.md', heading: '## Status page',
  pointer: 'Status page definitions: kokonut-status README.md, section Status page' };
const READER_DOC = { repo: 'kokonut-upwork-sync', file: 'shared/README.md', heading: '## Reading from a chat',
  pointer: 'Reading live data: kokonut-upwork-sync shared/README.md, section Reading from a chat' };
const OWNER = 'Test-Kokonut';
// Where a cloud chat's repos are cloned: /home/user/<repo>. KOKONUT_REPOS_DIR names another folder (the tests do).
const CLOUD_REPOS = '/home/user';
const STATE_DIR = path.join(os.homedir(), '.claude', 'reminder-state');
const KEEP_STATE_DAYS = 30;
const BIG = 20 * 1024 * 1024;
const TAIL = 2 * 1024 * 1024;

// ---- Reading the transcript. ----

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

// How a user-role entry starts when Claude Code wrote it, not George: a command echo, a system note, a task
// notification, a message from another session or a helper, an interruption, the summary of a chat out of room.
const INJECTED = new RegExp('^(?:<(?:command-|local-command|system-reminder|task-notification|agent-message|' +
  'cross-session|bash-|user-prompt-submit-hook)|\\[Request interrupted|Another Claude session sent a message|' +
  'This session is being continued from a previous conversation|Caveat: The messages below were generated)');

// Whether an entry's origin is George: Claude Code marks each message with where it came from, origin.kind "human"
// for one he typed ("task-notification", "peer" for a helper's hand-back or another session's message, ...). An
// entry without an origin (older transcripts) is judged by its text alone.
function fromGeorge(origin) {
  return origin === undefined || Boolean(origin && typeof origin === 'object' && origin.kind === 'human');
}

// A message George typed in this chat: a user entry from him (fromGeorge; not promptSource "system", not a
// turnOrigin other than "human"), not meta (a hand-back, an image's caption), not a helper's own transcript
// (isSidechain), not the summary of a chat out of room (isCompactSummary), not a tool result, and not text that
// Claude Code writes itself (INJECTED).
function isUserText(e) {
  if (!e || e.type !== 'user' || e.isMeta || e.isSidechain || e.isCompactSummary || e.isVisibleInTranscriptOnly || !e.message) return false;
  if (!fromGeorge(e.origin) || e.promptSource === 'system') return false;
  if (e.turnOrigin !== undefined && e.turnOrigin !== 'human') return false;
  const c = e.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  return Boolean(t) && !INJECTED.test(t);
}

// The text of a message George typed while the chat was working, '' for any other entry. Claude Code keeps it as an
// attachment: type queued_command, commandMode "prompt", origin.kind "human"; a queued task notification has another
// mode and origin.
function queuedText(e) {
  const a = e && e.type === 'attachment' && !e.isSidechain ? e.attachment : null;
  if (!a || a.type !== 'queued_command' || !fromGeorge(a.origin)) return '';
  if (a.commandMode !== undefined && a.commandMode !== 'prompt') return '';
  const t = (typeof a.prompt === 'string' ? a.prompt : textOf(a.prompt)).trim();
  return t && !INJECTED.test(t) ? t : '';
}

// George's latest message in the transcript lines, as he typed it; null when there is none.
function lastTyped(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = parse(lines[i]);
    if (!e) continue;
    if (isUserText(e)) return textOf(e.message.content);
    const queued = queuedText(e);
    if (queued) return queued;
  }
  return null;
}

// The tool uses since George's previous message. If the transcript already holds the prompt being
// submitted now, the turn before it is the one that counts.
function lastTurnTools(lines, prompt) {
  const tools = [];
  let sawAssistant = false;
  let skippedCurrent = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = parse(lines[i]);
    if (!e) continue;
    if (isUserText(e)) {
      const same = prompt && textOf(e.message.content).trim() === prompt.trim();
      if (same && !sawAssistant && !skippedCurrent) { skippedCurrent = true; continue; }
      break;
    }
    if (e.type !== 'assistant' || e.isSidechain || !e.message || !Array.isArray(e.message.content)) continue;
    sawAssistant = true;
    for (const b of e.message.content) if (b && b.type === 'tool_use') tools.push(b);
  }
  return tools;
}

// ---- Reading the rulebook and other pages. ----

// The project folder: $CLAUDE_PROJECT_DIR, else the hook's cwd.
function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || (input && typeof input.cwd === 'string' && input.cwd) || process.cwd();
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/\r/g, ''); } catch (e) { return ''; }
}

// The rulebook's text: <home>/.claude/CLAUDE.md (home: the one given, else the user's), else CLAUDE.md of dir, else
// of the cwd given (else of the process's cwd); '' when none exists.
function rulebookText(dir, cwd, home) {
  for (const file of [path.join(home || os.homedir(), '.claude', 'CLAUDE.md'), path.join(dir || '.', 'CLAUDE.md'),
    path.join(cwd || process.cwd(), 'CLAUDE.md')]) {
    const text = readText(file);
    if (text) return text;
  }
  return '';
}

// A section of a page, as written: its heading line (exactly the heading given) and every line up to the next
// heading of the same level or above, outside fenced code blocks; blank lines at its end dropped. '' when missing.
function section(text, heading) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const level = /^#+/.exec(heading)[0].length;
  let start = -1;
  let fence = null;
  const out = [];
  for (const line of lines) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const h = !fence && !f ? /^ {0,3}(#{1,6})\s/.exec(line) : null;
    if (start < 0) {
      if (h && line.trim() === heading) { start = 0; out.push(line); }
      continue;
    }
    if (h && h[1].length <= level) break;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

// Every "- " bullet of a text with its indented continuation lines, exactly as written.
function bullets(text) {
  const found = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('- ')) { current = [line]; found.push(current); }
    else if (current && /^\s+\S/.test(line)) current.push(line);
    else current = null;
  }
  return found.map((b) => b.join('\n'));
}

// The bullet of a text whose words after "- " start with start; '' when there is none.
function bullet(text, start) {
  return bullets(text).find((b) => b.slice(2).startsWith(start)) || '';
}

// gh's answer to args (stdout), or throws. Tests give their own.
function gh(args, timeout) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeout || 5000,
    windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

// The folders a clone of another repo is looked for in, in order: beside the project folder (a chat with one repo),
// inside it (a chat with several, whose project folder is /home/user), and /home/user, where the cloud clones them.
function cloneBases(dir) {
  const project = path.resolve(dir || '.');
  return [path.dirname(project), project, path.resolve(process.env.KOKONUT_REPOS_DIR || CLOUD_REPOS)];
}

// A file of another repo, from a clone (cloneBases: ../<repo>/<file>, <project>/<repo>/<file> or
// /home/user/<repo>/<file>); else from GitHub (the contents API, base64 decoded); '' when none can be read.
function repoFile(dir, repo, file, run) {
  const parts = [repo, ...file.split('/')];
  for (const base of cloneBases(dir)) {
    const near = readText(path.join(base, ...parts));
    if (near) return near;
  }
  try {
    const answer = JSON.parse((run || gh)(['api', `repos/${OWNER}/${repo}/contents/${file}`]) || '{}');
    if (!answer || typeof answer.content !== 'string') return '';
    return Buffer.from(answer.content, answer.encoding === 'base64' || !answer.encoding ? 'base64' : 'utf8').toString('utf8').replace(/\r/g, '');
  } catch (e) { return ''; }
}

// ---- What the last turn calls for. ----

function commandOf(tool) {
  const input = (tool && tool.input) || {};
  return SHELL_TOOLS.has(String(tool && tool.name)) && typeof input.command === 'string' ? input.command : '';
}

// { status, reader }: which definitions the tools of the last turn call for.
function wanted(tools) {
  const want = { status: false, reader: false };
  for (const t of tools) {
    const command = commandOf(t);
    if (STATUS_TOOL.test(command)) want.status = true;
    if (READER_COMMANDS.some((r) => r.test(command))) want.reader = true;
  }
  return want;
}

// ---- First time in the session. ----

function stateFile(input, stateDir) {
  const id = (input && typeof input.session_id === 'string' && input.session_id) ||
    (input && typeof input.transcript_path === 'string' ? path.basename(input.transcript_path, '.jsonl') : '');
  const safe = String(id).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 100);
  return safe ? path.join(stateDir || STATE_DIR, safe + '.json') : '';
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; }
}

function prune(dir) {
  try {
    const cutoff = Date.now() - KEEP_STATE_DAYS * 86400000;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch (e) { /* nothing to prune */ }
}

// ---- The reminder. ----

// The text to print for a UserPromptSubmit input; '' for nothing. options: { projectDir, cwd, home, stateDir, gh }
// for the tests.
function onPrompt(input, options) {
  const o = options || {};
  const parts = [];
  const dir = o.projectDir || projectDir(input);
  const rules = rulebookText(dir, o.cwd || (input && input.cwd), o.home);
  if (!rules) return ''; // no rulebook: nothing at all
  const replies = section(rules, '# Replies');
  if (replies) parts.push(PREFIX + '\n' + replies);
  try {
    const prompt = input && typeof input.prompt === 'string' ? input.prompt : '';
    const raw = readTranscript(input && input.transcript_path);
    const want = wanted(lastTurnTools(raw ? raw.split('\n') : [], prompt));
    if (want.status || want.reader) {
      const file = stateFile(input, o.stateDir);
      const state = file ? readState(file) : {};
      let fed = false;
      for (const [key, doc] of [['status', STATUS_DOC], ['reader', READER_DOC]]) {
        if (!want[key] || state[key]) continue;
        parts.push(section(repoFile(dir, doc.repo, doc.file, o.gh), doc.heading) || doc.pointer);
        state[key] = true;
        fed = true;
      }
      if (fed && file) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state));
        prune(path.dirname(file));
      }
    }
  } catch (e) { /* print what there is */ }
  return parts.join('\n\n');
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let out = '';
    try {
      let input = {};
      try { input = JSON.parse(raw || '{}') || {}; } catch (e) { input = {}; }
      out = onPrompt(input);
    } catch (e) { out = ''; }
    if (!out) process.exit(0);
    process.stdout.write(out + '\n', () => process.exit(0));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { PREFIX, STATUS_DOC, READER_DOC, STATE_DIR,
  readTranscript, parse, textOf, isUserText, queuedText, lastTyped, lastTurnTools,
  projectDir, readText, rulebookText, section, bullets, bullet, gh, cloneBases, repoFile, wanted, onPrompt };
