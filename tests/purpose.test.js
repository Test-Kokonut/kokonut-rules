'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, runHook } = require('./sandbox');
const { check, extract, pinFile, recordApproval, NOT_PINNED, PINNED_HEAD } = require('../.claude/hooks/purpose.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'purpose.js');
after(cleanup);

const george = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
function transcript(dir, entries) {
  const file = path.join(dir, 'chat.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const PROPOSAL = '👉 **Purpose and Done when, ok?**\n\nPurpose: every chat starts lean and does nothing before George decided.\nDone when:\n- 90 of 100 replies pass the form check.\n- 0 shared writes without his yes.\n\nOk?';
const PINNED = 'Purpose: every chat starts lean and does nothing before George decided.\nDone when:\n- 90 of 100 replies pass the form check.\n- 0 shared writes without his yes.\n';
const NOW = new Date('2026-11-05T15:40:00Z');
const STAMP = 'Approved 2026-11-05 15:40 UTC\n';

test('extract: the Purpose line and the Done when items of a reply, in the pinned shape', () => {
  assert.strictEqual(extract(PROPOSAL), PINNED);
  assert.strictEqual(extract('**Purpose:** fix the alerts\n**Done when:** no alert is late for a week'), 'Purpose: fix the alerts\nDone when:\n- no alert is late for a week\n');
  assert.strictEqual(extract('- Purpose: a\n- Done when: b\n- Next: c'), 'Purpose: a\nDone when:\n- b\n');
  assert.strictEqual(extract('👉 **Purpose:** no alert is late.\n✅ **Done when:**\n- every alert within 5 minutes\nOk?'), 'Purpose: no alert is late.\nDone when:\n- every alert within 5 minutes\n', 'icons and bold before the words');
  assert.strictEqual(extract('Purpose: a\nNothing else'), '', 'no Done when: nothing to pin');
  assert.strictEqual(extract('Done when:\n- b'), '', 'no Purpose: nothing to pin');
  assert.strictEqual(extract(''), '');
});

test('not pinned: every message of George gets the one line that says what pins it; nothing is written', () => {
  const dir = scratch();
  const file = transcript(dir, [george('hi'), reply('💬 hello')]);
  const out = check({ hook_event_name: 'UserPromptSubmit', prompt: 'what is this chat about?', transcript_path: file }, { home: dir });
  assert.strictEqual(out, NOT_PINNED);
  assert.ok(!fs.existsSync(pinFile(dir)));
});

test('nothing pinned: a reply with Purpose and Done when is not pinned without his yes, whatever else he says', () => {
  const dir = scratch();
  const file = transcript(dir, [george('fix the alerts'), reply(PROPOSAL)]);
  for (const prompt of ['and the second alert?', 'no, wrong repo', 'hm, not sure', '"ok"']) {
    const out = check({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: file }, { home: dir, now: NOW });
    assert.strictEqual(out, NOT_PINNED, prompt);
    assert.ok(!fs.existsSync(pinFile(dir)), `${prompt}: nothing is labelled approved`);
  }
});

test('pinned: a reply with new lines pins again only on his yes', () => {
  const dir = scratch();
  fs.mkdirSync(path.dirname(pinFile(dir)), { recursive: true });
  fs.writeFileSync(pinFile(dir), 'Approved 2026-11-01 09:00 UTC\nPurpose: old\nDone when:\n- old\n');
  const file = transcript(dir, [reply('Purpose: new\nDone when: new check')]);
  check({ hook_event_name: 'UserPromptSubmit', prompt: 'hm, not sure', transcript_path: file }, { home: dir, now: NOW });
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), 'Approved 2026-11-01 09:00 UTC\nPurpose: old\nDone when:\n- old\n', 'no yes: the old pin stays');
  check({ hook_event_name: 'UserPromptSubmit', prompt: 'ok', transcript_path: file }, { home: dir, now: NOW });
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'Purpose: new\nDone when:\n- new check\n');
});

test('his ok to a reply with Purpose and Done when pins them with the time; every later message shows them as the last approved scope', () => {
  const dir = scratch();
  const file = transcript(dir, [george('fix the alerts'), reply(PROPOSAL)]);
  const first = check({ hook_event_name: 'UserPromptSubmit', prompt: 'ok', transcript_path: file }, { home: dir, now: NOW });
  assert.strictEqual(first, 'Pinned now:\n' + (STAMP + PINNED).trim());
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + PINNED);
  const later = check({ hook_event_name: 'UserPromptSubmit', prompt: 'and the second alert?', transcript_path: file }, { home: dir, now: NOW });
  assert.strictEqual(later, PINNED_HEAD + '\n' + (STAMP + PINNED).trim());
  assert.match(PINNED_HEAD, /never repeat it to George/);
  assert.match(PINNED_HEAD, /approves nothing new/, 'a saved scope approves nothing');
  assert.doesNotMatch(PINNED_HEAD, /keep to it/, 'an old pin is not the current job (rule 9)');
});

test('recordApproval: the approval with its time; the same approval keeps its first time; a new one replaces it', () => {
  const dir = scratch();
  assert.strictEqual(recordApproval('I will: deploy api.', dir, NOW), true);
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'I will: deploy api.\n');
  recordApproval('I will: deploy api.', dir, new Date('2026-11-05T18:00:00Z'));
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'I will: deploy api.\n', 'same approval: first time kept');
  recordApproval('merge kokonut-rules#19', dir, new Date('2026-11-05T18:00:00Z'));
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), 'Approved 2026-11-05 18:00 UTC\nmerge kokonut-rules#19\n');
  assert.strictEqual(recordApproval('', dir, NOW), false);
});

test('a yes to something else does not pin: the last reply holds no Purpose and Done when', () => {
  const dir = scratch();
  const file = transcript(dir, [george('fix the alerts'), reply(PROPOSAL), george('ok'), reply('✅ Done. Merge it?')]);
  const out = check({ hook_event_name: 'UserPromptSubmit', prompt: 'yes', transcript_path: file }, { home: dir });
  assert.strictEqual(out, NOT_PINNED);
});

test('a new pair and another ok pins again, replacing the old pin', () => {
  const dir = scratch();
  fs.mkdirSync(path.dirname(pinFile(dir)), { recursive: true });
  fs.writeFileSync(pinFile(dir), 'Approved 2026-11-01 09:00 UTC\nPurpose: old\nDone when:\n- old\n');
  const file = transcript(dir, [reply('Purpose: new\nDone when: new check')]);
  check({ hook_event_name: 'UserPromptSubmit', prompt: 'yes', transcript_path: file }, { home: dir, now: NOW });
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'Purpose: new\nDone when:\n- new check\n');
});

test('inside a helper, or on another event, nothing is printed', () => {
  const dir = scratch();
  const file = transcript(dir, [reply(PROPOSAL)]);
  assert.strictEqual(check({ hook_event_name: 'UserPromptSubmit', prompt: 'ok', transcript_path: file, agent_id: 'a1' }, { home: dir }), '');
  assert.strictEqual(check({ hook_event_name: 'PostToolUse', prompt: 'ok', transcript_path: file }, { home: dir }), '');
  assert.strictEqual(check(null, { home: dir }), '');
});

test('as the hook: JSON on stdin, text on stdout, exit 0; bad input prints nothing', () => {
  const dir = scratch();
  const file = transcript(dir, [george('fix the alerts'), reply(PROPOSAL)]);
  const r = runHook(HOOK, { hook_event_name: 'UserPromptSubmit', prompt: 'ok', transcript_path: file, session_id: 's' }, { HOME: dir, USERPROFILE: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Pinned now:\nApproved \d{4}-\d\d-\d\d \d\d:\d\d UTC\n/);
  assert.ok(r.stdout.endsWith(PINNED.trim() + '\n'), r.stdout);
  const bad = runHook(HOOK, 'not json', { HOME: dir, USERPROFILE: dir });
  assert.strictEqual(bad.status, 0);
  assert.strictEqual(bad.stdout, '');
});
