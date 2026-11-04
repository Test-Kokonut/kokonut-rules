'use strict';
// CLAUDE.md, the rulebook: its parts in order, the numbered rules 1 to 7, no line over 120 characters.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sandbox');

const lines = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n');

test('the parts, in order', () => {
  assert.deepStrictEqual(lines.filter((l) => l.startsWith('#')), ['# How to work for George', '## Tone of voice', '## Style',
    '## In chat with George', '## Examples of the voice', '## Work', '## Safety (strict)']);
});

test('the numbered rules run 1 to 7, each wrapped line indented', () => {
  const numbers = lines.map((l) => /^(\d+)\. \S/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepStrictEqual(numbers, [1, 2, 3, 4, 5, 6, 7]);
});

test('no line is longer than 120 characters; a wrapped line goes on indented two spaces', () => {
  for (const l of lines) assert.ok(l.length <= 120, `${l.length}: ${l}`);
  for (const l of lines) assert.ok(!/^ {1}\S/.test(l) && !/^\t/.test(l), `odd indent: ${l}`);
});
