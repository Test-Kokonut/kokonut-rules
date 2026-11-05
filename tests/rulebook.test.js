'use strict';
// CLAUDE.md, the rulebook: its parts in order, the numbered rules 1 to 15, no line over 120 characters, and the
// lines the hooks and the gate rely on.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sandbox');

const text = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\r/g, '');
const lines = text.replace(/\n$/, '').split('\n');

test('the parts, in order', () => {
  assert.deepStrictEqual(lines.filter((l) => l.startsWith('#')), [
    '# How to work for George', '## 🎯 Purpose', '## 💬 Tone', '## Replies', '## Work', '## Safety (strict)',
  ]);
});

test('the numbered rules run 1 to 15, each wrapped line indented', () => {
  const numbers = lines.map((l) => /^(\d+)\. \S/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepStrictEqual(numbers, Array.from({ length: 15 }, (_, i) => i + 1));
});

test('no line is longer than 120 characters; a wrapped line goes on indented', () => {
  for (const l of lines) assert.ok(l.length <= 120, `${l.length}: ${l}`);
  for (const l of lines) assert.ok(!/^ {1}\S/.test(l) && !/^\t/.test(l), `odd indent: ${l}`);
});

test('the rules the hooks enforce are written: the pin (rule 9) and the yes before a shared change (rule 12)', () => {
  assert.match(text, /"Purpose:" and "Done when:"/, 'rule 9 names the two lines purpose.js pins');
  assert.match(text, /"I will: …"/, 'rule 12 names the one line the gate asks for');
  assert.match(text, /The gate blocks a step that no such message/, 'rule 12 says the gate blocks');
});

test('rule 9 shows the two lines only on ask or unclear scope, rule 12 limits an approval to what it names, and the reminder points to rule 9', () => {
  const rule = (n) => {
    const start = lines.findIndex((l) => l.startsWith(`${n}. `));
    const end = lines.findIndex((l) => l.startsWith(`${n + 1}. `));
    assert.ok(start >= 0 && end > start, `rule ${n} and rule ${n + 1} found`);
    return lines.slice(start, end).join(' ').replace(/\s+/g, ' ');
  };
  const rule9 = rule(9);
  assert.match(rule9, /"Purpose:" and "Done when:"/, 'rule 9 names the two lines');
  assert.match(rule9, /only when he asks or when unclear scope needs his decision/);
  assert.doesNotMatch(rule9, /gated step/, 'no routine lines before a shared step: the gate does not need them');
  const rule12 = rule(12);
  assert.match(rule12, /A clear order is the approval: do only what it names/);
  assert.match(rule12, /never ask twice, run it once/);
  assert.match(rule12, /deleting \(look first, list what goes\)/, 'a deletion looks first');
  assert.match(rule12, /A deletion: look at what is there first; what his order did not name stays/, 'what he did not name stays');
  assert.match(rule12, /a folder and all its contents, when he names them, go/, 'a named folder goes whole');
  assert.match(rule12, /a backstop, not proof of approval/);
  const { NOT_PINNED } = require('../.claude/hooks/purpose.js');
  assert.match(NOT_PINNED, /Rule 9 says when/, 'the reminder points to rule 9');
  assert.doesNotMatch(NOT_PINNED, /gated step|unclear scope/, 'the reminder does not restate rule 9');
});

test('the status icons of rule 1 are the five George chose', () => {
  const start = lines.findIndex((l) => l.startsWith('1. '));
  const end = lines.findIndex((l) => l.startsWith('2. '));
  assert.ok(start >= 0 && end > start, 'rule 1 and rule 2 found');
  const rule1 = lines.slice(start, end).join(' ');
  for (const icon of ['👉', '✅', '⚠️', '⛔', '💬']) assert.ok(rule1.includes(icon), icon);
});
