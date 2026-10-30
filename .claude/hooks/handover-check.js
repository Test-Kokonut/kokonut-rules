#!/usr/bin/env node
// handover-check.js: tells a chat when its context is large enough to hand its project over to a new chat
// (rulebook rule 22), and tells a chat started by a hand-over where its first message comes from.
// Written in kokonut-rules, run by the UserPromptSubmit hook (George's messages) and the PostToolUse hook (every tool
// call, so a long turn of the chat's own is seen too) in .claude/settings.json, and installed machine-wide in a cloud
// chat by kokonut-rules' setup.sh.
// What it reads: the hook input's transcript_path, only its tail: the last 512 KB, doubled up to 8 MB until it holds
// the main chat's last assistant entry with usage (not a helper's: isSidechain). The context is that entry's
// input_tokens + cache_creation_input_tokens + cache_read_input_tokens; the entry also names the model
// (message.model) and the effort (effort). A compaction (a compact_boundary entry after it) counts as its postTokens.
// What it prints: lines that point at the rule, never its text (the rule lives in CLAUDE.md alone):
//   context at DUE (700,000) or more, once: "HANDOVER DUE: 702,113 tokens of context; compaction can come at about
//       784,000. Model <model>, effort <effort>. Hand-over due: rule 22, the steps in /handover."
//   after that, at each of George's messages (UserPromptSubmit only): "Context 731,000 of about 784,000: hand-over
//       due (rule 22, /handover)."
//   context at LATE (compaction - 40,000) or more, once: "HANDOVER LATE: 745,000 tokens; compaction can come at about
//       784,000. Rule 22; /handover now."
//   a message that starts "KOKONUT HANDOVER <name>" (UserPromptSubmit): "HANDOVER QUIZ for <name>: this message comes
//       from the chat handing over, not from George. Rule 22."
// Compaction: 980,000 tokens x CLAUDE_AUTOCOMPACT_PCT_OVERRIDE %, at most 80 % (default 80): about 784,000. A guess:
// a chat set to 92 % compacted at 787,259 on 30 Oct 2026, so the lower point is used and LATE leaves 40,000.
// A test override: KOKONUT_HANDOVER_AT="<due>[ <late>]" in the environment, else the same text in the file
// ~/.claude/kokonut/handover-at (a rule file: the rule guard and the installed settings keep chats from writing it).
// State: ~/.claude/handover-state/<session id>.json, {"due": true, "late": true} once told; files older than 30 days
// are removed. A context below 6/7 of DUE (600,000: after a compaction) clears it, so a later climb is told again.
// Output: UserPromptSubmit: plain text on stdout. PostToolUse: {"hookSpecificOutput": {"hookEventName":
// "PostToolUse", "additionalContext": <line>}}. A hook run inside a helper (agent_id in its input) prints nothing:
// the lines are for the main chat.
// Node only, no packages, Windows and Linux. Any error prints nothing; it always exits 0.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DUE = 700000;
const WINDOW = 980000;
const MAX_PCT = 80;
const LATE_ROOM = 40000;
const START = 512 * 1024;
const MAX_READ = 8 * 1024 * 1024;
const KEEP_STATE_DAYS = 30;
const QUIZ = /^\s*KOKONUT HANDOVER\s+(\S+)/;

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// The compaction point this hook assumes, from the environment.
function compactAt(env) {
  let pct = Number((env || {}).CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  if (!(pct > 0 && pct <= 100)) pct = MAX_PCT;
  return Math.round((WINDOW * Math.min(pct, MAX_PCT)) / 100);
}

// { due, late, reset, compact }: the marks, from the defaults or the test override.
function marks(env, home) {
  const e = env || process.env;
  const compact = compactAt(e);
  let text = typeof e.KOKONUT_HANDOVER_AT === 'string' ? e.KOKONUT_HANDOVER_AT : '';
  if (!text.trim()) {
    try { text = fs.readFileSync(path.join(home || os.homedir(), '.claude', 'kokonut', 'handover-at'), 'utf8'); } catch (err) { text = ''; }
  }
  const m = /^\s*(\d+)(?:[\s,]+(\d+))?\s*$/.exec(text);
  const due = m && Number(m[1]) > 0 ? Number(m[1]) : DUE;
  const late = m && m[2] ? Math.max(Number(m[2]), due) : Math.max(compact - LATE_ROOM, due);
  return { due, late, reset: Math.floor((due * 6) / 7), compact };
}

function parse(line) {
  const s = line.trim();
  if (!s.startsWith('{')) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// { tokens, model, effort } of the main chat's last assistant entry with usage (a compaction after it: its
// postTokens); null when the tail read holds none.
function lastContext(file) {
  if (typeof file !== 'string' || !file) return null;
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    for (let want = START; ; want *= 2) {
      const len = Math.min(want, size, MAX_READ);
      const buf = Buffer.alloc(len);
      const got = fs.readSync(fd, buf, 0, len, size - len);
      let text = buf.toString('utf8', 0, got);
      if (len < size) text = text.slice(text.indexOf('\n') + 1); // the first line is cut: drop it
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (l.includes('"compact_boundary"')) {
          const e = parse(l);
          if (e && e.type === 'system' && e.subtype === 'compact_boundary' && !e.isSidechain) {
            const post = Number(e.compactMetadata && e.compactMetadata.postTokens);
            return { tokens: post > 0 ? post : 0, model: '', effort: '' };
          }
        }
        if (!l.includes('"usage"') || !l.includes('"assistant"')) continue;
        const e = parse(l);
        if (!e || e.type !== 'assistant' || e.isSidechain || !e.message || !e.message.usage) continue;
        const u = e.message.usage;
        const tokens = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
        if (!tokens || e.message.model === '<synthetic>') continue;
        return { tokens, model: String(e.message.model || ''), effort: String(e.effort || '') };
      }
      if (len >= size || len >= MAX_READ) return null;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function stateFile(input, stateDir) {
  const id = (typeof input.session_id === 'string' && input.session_id) ||
    (typeof input.transcript_path === 'string' ? path.basename(input.transcript_path, '.jsonl') : '');
  const safe = String(id).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 100);
  return safe ? path.join(stateDir, safe + '.json') : '';
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
  try {
    const cutoff = Date.now() - KEEP_STATE_DAYS * 86400000;
    for (const f of fs.readdirSync(path.dirname(file))) {
      const full = path.join(path.dirname(file), f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch (e) { /* nothing to prune */ }
}

// The lines to print for a hook input, '' for none. options: { env, home, stateDir }.
function check(input, options) {
  const o = options || {};
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  if (!input || typeof input !== 'object' || input.agent_id) return '';
  const prompt = input.hook_event_name === 'UserPromptSubmit';
  const out = [];
  if (prompt && typeof input.prompt === 'string') {
    const q = QUIZ.exec(input.prompt);
    if (q) out.push(`HANDOVER QUIZ for ${q[1]}: this message comes from the chat handing over, not from George. Rule 22.`);
  }
  const file = stateFile(input, o.stateDir || path.join(home, '.claude', 'handover-state'));
  const state = file ? readState(file) : {};
  if (!prompt && state.due && state.late) return out.join('\n'); // both told: a tool call needs no read
  const m = marks(env, home);
  let ctx = null;
  try { ctx = lastContext(input.transcript_path); } catch (e) { ctx = null; }
  if (!ctx) return out.join('\n');
  const n = ctx.tokens;
  let changed = false;
  if (n < m.reset) {
    if (state.due || state.late) { state.due = false; state.late = false; changed = true; }
  } else if (n >= m.late && !state.late) {
    out.push(`HANDOVER LATE: ${fmt(n)} tokens; compaction can come at about ${fmt(m.compact)}. Rule 22; /handover now.`);
    state.due = true; state.late = true; changed = true;
  } else if (n >= m.due && !state.due) {
    const who = [ctx.model && `Model ${ctx.model}`, ctx.effort && `effort ${ctx.effort}`].filter(Boolean).join(', ');
    out.push(`HANDOVER DUE: ${fmt(n)} tokens of context; compaction can come at about ${fmt(m.compact)}.` +
      (who ? ` ${who}.` : '') + ' Hand-over due: rule 22, the steps in /handover.');
    state.due = true; changed = true;
  } else if (n >= m.due && prompt) {
    out.push(`Context ${fmt(n)} of about ${fmt(m.compact)}: hand-over due (rule 22, /handover).`);
  }
  if (changed && file) writeState(file, state);
  return out.join('\n');
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let text = '';
    let input = {};
    try {
      input = JSON.parse(raw || '{}') || {};
      text = check(input);
    } catch (e) { text = ''; }
    if (!text) process.exit(0);
    const body = input.hook_event_name === 'PostToolUse'
      ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })
      : text;
    process.stdout.write(body + '\n', () => process.exit(0));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { check, marks, compactAt, lastContext, DUE };
