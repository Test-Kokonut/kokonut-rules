'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scratch, cleanup } = require('./sandbox');
const { isYes, lastGeorgeText, lastAssistantText, mainTranscript, textOf } = require('../.claude/hooks/transcript.js');

after(cleanup);

// A transcript line as Claude Code writes it: George's typed message is a user entry with a string; a tool result is
// a user entry with a tool_result block; a helper's entries are isSidechain.
const george = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text }] } });
const side = (entry) => Object.assign({ isSidechain: true }, entry);
function transcript(dir, name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

test('a yes: yes, ok, go, agree, merge it, deploy it, rule change ok, with a short tail that holds no doubt', () => {
  for (const t of ['yes', 'Yes', 'ok', 'k', 'go', 'go, build it', 'yes - let\'s move on', 'yes fix both', 'merge it', 'Merge it.',
    'deploy it', 'agree', 'sure', 'fine', 'rule change ok', 'Go.', 'do it', 'ok, let\'s carry on', 'yes, do it that way']) {
    assert.strictEqual(isYes(t), true, t);
  }
});

test('not a yes: done, no, a question, a yes with a but, a long message, an order with no yes word', () => {
  for (const t of ['done', 'no', 'ok?', 'yes, but why is it that long', 'ok for what - be clear', 'not sure - test it with a bot?',
    'status', 'what do you need from me?', 'yes but not the folder', 'Remove the hand-over entirely', 'Merge 6', 'send me the list',
    'delete the old branches', 'deploy the api now',
    'yes and then also please go and read every chat I had this week and tell me what each one did wrong', '']) {
    assert.strictEqual(isYes(t), false, t);
  }
});

test('the text of an entry: a string, or its text blocks; a tool result is no text', () => {
  assert.strictEqual(textOf(george('hi')), 'hi');
  assert.strictEqual(textOf(reply('a')), 'a');
  assert.strictEqual(textOf(toolResult()), '');
  assert.strictEqual(textOf({}), '');
});

test("George's last message: the last typed user entry of the main chat; tool results, helpers' lines and injected text are passed over", () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [
    george('first'), reply('r1'), george('yes'), toolResult(), reply('r2'),
    side(george('helper brief, not George')), george('<task-notification>x</task-notification>'),
    george('Another Claude session sent a message: ...'), george('Stop hook feedback: push'), toolResult(),
  ]);
  assert.strictEqual(lastGeorgeText(file), 'yes');
  assert.strictEqual(lastAssistantText(file), 'r2');
});

test('empty or missing file: no text, no throw', () => {
  const dir = scratch();
  assert.strictEqual(lastGeorgeText(path.join(dir, 'none.jsonl')), '');
  assert.strictEqual(lastAssistantText(''), '');
  const file = transcript(dir, 'empty.jsonl', []);
  assert.strictEqual(lastGeorgeText(file), '');
});

test("a long transcript: the tail read grows until it holds George's last message", () => {
  const dir = scratch();
  const big = 'x'.repeat(200000);
  const entries = [george('yes')];
  for (let i = 0; i < 6; i++) entries.push(reply(big), toolResult());
  const file = transcript(dir, 'big.jsonl', entries);
  assert.ok(fs.statSync(file).size > 1024 * 1024);
  assert.strictEqual(lastGeorgeText(file), 'yes');
});

test("a helper's input names its own transcript; the chat's file beside it, named by session_id, is read instead when it exists", () => {
  const dir = scratch();
  const main = transcript(dir, 'sess-1.jsonl', [george('yes')]);
  const helper = transcript(dir, 'agent-9.jsonl', [george('the brief')]);
  assert.strictEqual(mainTranscript({ transcript_path: helper, agent_id: 'a9', session_id: 'sess-1' }), main);
  assert.strictEqual(mainTranscript({ transcript_path: helper, agent_id: 'a9', session_id: 'missing' }), helper);
  assert.strictEqual(mainTranscript({ transcript_path: main }), main);
  assert.strictEqual(mainTranscript({}), '');
});
