#!/usr/bin/env node
// purpose.js: keeps the chat's Purpose and Done when in front of it on every message of George's, and pins them
// when he says ok to them (rule 9 of the rulebook).
// Written in kokonut-rules, run by the UserPromptSubmit hook in .claude/settings.json, installed machine-wide in a
// cloud chat by kokonut-rules' setup.sh. Inside a helper (agent_id in its input) it prints nothing.
// The pin: ~/.claude/kokonut-purpose.md (one chat per machine in the cloud). It is written when George's message is
// a yes (transcript.js isYes) and the chat's last reply holds a line "Purpose: ..." and a line "Done when: ..."
// (the latter's text, or the list items under it, up to 8). A later reply with both lines and another yes pins
// again, so the purpose can change on his ok.
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
const NOT_PINNED = 'No Purpose and Done when pinned. Before the first change: a reply with the lines "Purpose:" and ' +
  '"Done when:" in George\'s words, then his ok pins them. A question needs none.';
const PURPOSE = /^\s*(?:[-*•]\s*)?\**Purpose\**\s*:\**\s*(.*)$/i;
const DONE = /^\s*(?:[-*•]\s*)?\**Done when\**\s*:\**\s*(.*)$/i;
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
  if (isYes(prompt)) {
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

module.exports = { check, extract, pinFile, NOT_PINNED, PIN_FILE };
