#!/usr/bin/env node
// purpose.js: keeps the last scope George approved in front of the chat on every message of his, marked as the
// last approved one, never as the current job (rule 9 of the rulebook).
// Written in kokonut-rules, run by the UserPromptSubmit hook in .claude/settings.json, installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh. Inside a helper (agent_id in its input) it prints nothing.
// The pin: ~/.claude/kokonut-purpose.md (one chat per machine in the cloud): "Approved <date> <time> UTC", then the
// scope. Only an approval writes it: his yes to a reply holding a line "Purpose: ..." and a line "Done when: ..."
// (the latter's text, or the list items under it, up to 8), written here; or a shared step yes-gate.js let pass on
// his order or his yes to an "I will:" line, written there (recordApproval). Each approval replaces the one before.
// The pin approves nothing: yes-gate.js never reads it.
// What it prints, on stdout, as context for the chat (never for George):
//   just pinned:  "Pinned now:" and the pin;
//   pinned:       PINNED_HEAD and the pin;
//   not pinned:   one line saying rule 9 tells when to show Purpose and Done when, and that a question needs none.
// Node only, no packages. Any error prints nothing; it always exits 0.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastAssistantText, isYes } = require('./transcript.js');

const PIN_FILE = path.join('.claude', 'kokonut-purpose.md');
const NOT_PINNED = 'No Purpose and Done when pinned. Rule 9 says when to show them; a question needs none.';
const PINNED_HEAD = 'Last scope George approved (it approves nothing new; never repeat it to George; keep the current ' +
  'job\'s scope, rule 9):';
const MAX_PIN = 600; // characters of an approval kept in the pin
// The two lines, whatever comes before the word: an icon, a bullet, bold marks ("👉 **Purpose:** ...").
const PURPOSE = /^[^A-Za-z0-9]*Purpose\**\s*:\**\s*(.*)$/i;
const DONE = /^[^A-Za-z0-9]*Done when\**\s*:\**\s*(.*)$/i;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;
const LABEL = /^\**[A-Z][\w ]{0,24}\**:/; // a list item that opens another part ("Next: ...", "State: ...") ends the list
const MAX_ITEMS = 8;

function pinFile(home) {
  return path.join(home || os.homedir(), PIN_FILE);
}

// The Purpose and Done when lines of a reply, as the text to pin; '' when the reply holds no complete pair.
function extract(reply) {
  const lines = String(reply || '').split('\n');
  let purpose = '';
  const done = [];
  for (let i = 0; i < lines.length; i++) {
    const p = PURPOSE.exec(lines[i]);
    if (p && !purpose) {
      purpose = p[1].trim();
      if (!purpose) for (let j = i + 1; j < lines.length; j++) { if (lines[j].trim()) { purpose = lines[j].trim().replace(/^[-*•]\s*/, ''); break; } }
      continue;
    }
    const d = DONE.exec(lines[i]);
    if (d && !done.length) {
      if (d[1].trim()) done.push(d[1].trim());
      for (let j = i + 1; j < lines.length && done.length < MAX_ITEMS; j++) {
        const it = ITEM.exec(lines[j]);
        if (!it || LABEL.test(it[1].trim())) break;
        done.push(it[1].trim());
      }
    }
  }
  if (!purpose || !done.length) return '';
  return `Purpose: ${purpose}\nDone when:\n${done.map((d) => '- ' + d).join('\n')}\n`;
}

// "YYYY-MM-DD HH:MM UTC" of a time (now by default).
function stamp(now) {
  return (now || new Date()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// Writes an approved scope as the pin, with its time; the same scope again keeps its first time. true when the pin
// holds it. For this hook (his yes to Purpose and Done when) and for yes-gate.js (a step it let pass).
function recordApproval(text, home, now) {
  let body = String(text || '').trim();
  if (!body) return false;
  if (body.length > MAX_PIN) body = body.slice(0, MAX_PIN).trimEnd() + ' …';
  const file = pinFile(home);
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch (e) { old = ''; }
  if (old.replace(/^Approved [^\n]*\n/, '').trim() === body) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `Approved ${stamp(now)}\n${body}\n`);
  return true;
}

// The text to print for a hook input, '' for none. options: { home, now } for the tests.
function check(input, options) {
  const o = options || {};
  if (!input || typeof input !== 'object' || input.agent_id) return '';
  if (input.hook_event_name && input.hook_event_name !== 'UserPromptSubmit') return '';
  const file = pinFile(o.home);
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (isYes(prompt)) {
    let pinned = '';
    try { pinned = extract(lastAssistantText(input.transcript_path)); } catch (e) { pinned = ''; }
    if (pinned) {
      try {
        recordApproval(pinned, o.home, o.now);
        return 'Pinned now:\n' + fs.readFileSync(file, 'utf8').trim();
      } catch (e) { /* no pin written: the chat is told below */ }
    }
  }
  let current = '';
  try { current = fs.readFileSync(file, 'utf8').trim(); } catch (e) { current = ''; }
  if (current) return PINNED_HEAD + '\n' + current;
  return NOT_PINNED;
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let text = '';
    try { text = check(JSON.parse(raw || '{}') || {}); } catch (e) { text = ''; }
    if (!text) process.exit(0);
    process.stdout.write(text + '\n', () => process.exit(0));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { check, extract, pinFile, recordApproval, stamp, NOT_PINNED, PINNED_HEAD, PIN_FILE };
