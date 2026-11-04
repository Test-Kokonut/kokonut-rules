#!/usr/bin/env node
// purpose.js: keeps the chat's Purpose and Done when in front of it on every message of George's, and pins them
// when he says ok to them (rule 9 of the rulebook).
// Written in kokonut-rules, run by the UserPromptSubmit hook in .claude/settings.json, installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh. Inside a helper (agent_id in its input) it prints nothing.
// The pin: ~/.claude/kokonut-purpose.md (one chat per machine in the cloud). While nothing is pinned, the chat's last
// reply holding a line "Purpose: ..." and a line "Done when: ..." (the latter's text, or the list items under it,
// up to 8) is pinned at George's next message, whatever it says: rule 9 states them and goes on; he corrects them
// if wrong. Once pinned, a later reply with both lines pins again only when his message is a yes (transcript.js
// isYes), so the purpose changes on his ok. yes-gate.js pins the same way before a gated call in the first turn.
// What it prints, on stdout, as context for the chat (never for George):
//   just pinned:  "Pinned now:" and the pinned lines;
//   pinned:       "Pinned (keep to it, never repeat it to George):" and the pinned lines;
//   not pinned:   one line saying a change needs Purpose and Done when in his words and his ok, and a question none.
// yes-gate.js refuses a shared change while nothing is pinned.
// Node only, no packages. Any error prints nothing; it always exits 0.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastAssistantText, isYes } = require('./transcript.js');

const PIN_FILE = path.join('.claude', 'kokonut-purpose.md');
const NOT_PINNED = 'No Purpose and Done when pinned. The first reply on a job holds the lines "Purpose:" and ' +
  '"Done when:" in George\'s words, then the work starts. A question needs none.';
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

// The text to print for a hook input, '' for none. options: { home } for the tests.
function check(input, options) {
  const o = options || {};
  if (!input || typeof input !== 'object' || input.agent_id) return '';
  if (input.hook_event_name && input.hook_event_name !== 'UserPromptSubmit') return '';
  const file = pinFile(o.home);
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  let had = false;
  try { had = fs.readFileSync(file, 'utf8').trim() !== ''; } catch (e) { had = false; }
  if (!had || isYes(prompt)) {
    let pinned = '';
    try { pinned = extract(lastAssistantText(input.transcript_path)); } catch (e) { pinned = ''; }
    if (pinned) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, pinned);
        return 'Pinned now:\n' + pinned.trim();
      } catch (e) { /* no pin written: the chat is told below */ }
    }
  }
  let current = '';
  try { current = fs.readFileSync(file, 'utf8').trim(); } catch (e) { current = ''; }
  if (current) return 'Pinned (keep to it, never repeat it to George):\n' + current;
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

// Pins the last reply's lines when nothing is pinned yet; true when it did. For yes-gate.js, in the first turn.
function pinFromReply(transcriptPath, home) {
  const file = pinFile(home);
  try { if (fs.readFileSync(file, 'utf8').trim()) return true; } catch (e) { /* nothing pinned */ }
  let pinned = '';
  try { pinned = extract(lastAssistantText(transcriptPath)); } catch (e) { pinned = ''; }
  if (!pinned) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, pinned);
    return true;
  } catch (e) { return false; }
}

module.exports = { check, extract, pinFile, pinFromReply, NOT_PINNED, PIN_FILE };
