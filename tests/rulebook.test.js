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
  assert.deepStrictEqual(lines.filter((l) => l.startsWith('#')), ['# How to work for George', '## Replies', '## Work', '## Safety (strict)']);
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
  assert.match(text, /blocked until his yes/, 'rule 12 says the gate blocks');
});

test('the status icons of rule 1 are the five George chose', () => {
  for (const icon of ['👉', '✅', '⚠️', '⛔', '💬']) assert.ok(lines[4].includes(icon) || lines[5].includes(icon), icon);
});
