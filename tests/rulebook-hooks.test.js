'use strict';
// The hooks read the rulebook by its headings and by the first words of its bullets: the real CLAUDE.md must hold
// every one they look for, or a hook goes silent there. Skipped while CLAUDE.md is the rulebook before v5 (no
// "# Replies"), which the hooks do not read.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sandbox');
const R = require('../.claude/hooks/reminder.js');

const text = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\r/g, '');
const v5 = Boolean(R.section(text, '# Replies'));

test('CLAUDE.md holds what the reminder reads: the reply rules, 11 to 15', { skip: !v5 && 'CLAUDE.md has no "# Replies" yet' }, () => {
  const replies = R.section(text, '# Replies').split('\n');
  assert.deepStrictEqual(replies.map((l) => /^(\d+)\. \S/.exec(l)).filter(Boolean).map((m) => Number(m[1])), [11, 12, 13, 14, 15]);
});
