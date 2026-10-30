'use strict';
// CLAUDE.md, the rulebook: its parts in order, the reply rules numbered 11 to 15, no line over 120 characters.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sandbox');

const lines = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n');

test('the parts, in order', () => {
  assert.deepStrictEqual(lines.filter((l) => l.startsWith('# ')), ['# Purpose and Done when', "# George's messages", '# Changes', '# Facts',
    '# Replies', '# Who does the work', '# Project name and Drive folder', '# Live data', '# Upwork (strict)', '# Hand-over', '# How George works']);
});

test('the reply rules are numbered 11 to 15, one per line', () => {
  const replies = lines.slice(lines.indexOf('# Replies') + 1, lines.indexOf('# Who does the work'));
  const numbers = replies.map((l) => /^(\d+)\. \S/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepStrictEqual(numbers, [11, 12, 13, 14, 15]);
  for (const l of replies.filter((x) => x && !/^\d+\. /.test(x))) assert.match(l, /^ {2,}\S/, `a continuation is indented: ${l}`);
});

test('no line is longer than 120 characters; a wrapped line goes on indented two spaces', () => {
  for (const l of lines) assert.ok(l.length <= 120, `${l.length}: ${l}`);
  for (const l of lines) assert.ok(!/^ {1}\S/.test(l) && !/^\t/.test(l), `odd indent: ${l}`);
});
