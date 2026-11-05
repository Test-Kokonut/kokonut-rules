'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scratch, cleanup } = require('./sandbox');
const { isYes, saysNo, plain, lastAssistantText, lastExchange, mainTranscript, textOf } = require('../.claude/hooks/transcript.js');

after(cleanup);

// A transcript line as Claude Code writes it: George's typed message is a user entry with a string; a tool result is
// a user entry with a tool_result block; a helper's entries are isSidechain; what the app injects is isMeta.
const george = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text }] } });
const toolUse = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }] } });
const side = (entry) => Object.assign({ isSidechain: true }, entry);
const meta = (text) => Object.assign({ isMeta: true }, george(text));
function transcript(dir, name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

test('a yes: yes, ok, go, agree, merge it, deploy it, rule change ok, with a short tail that holds no doubt', () => {
  for (const t of ['yes', 'Yes', 'ok', 'k', 'go', 'go, build it', 'yes - let\'s move on', 'yes fix both', 'merge it', 'Merge it.',
    'deploy it', 'agree', 'sure', 'fine', 'rule change ok', 'Go.', 'do it', 'ok, let\'s carry on', 'yes, do it that way', 'yes​']) {
    assert.strictEqual(isYes(t), true, t);
  }
});

test('not a yes: done, no, a question, a yes with a but or a no, a long message, an order with no yes word', () => {
  for (const t of ['done', 'no', 'ok?', 'ok？', 'yes, but why is it that long', 'ok for what - be clear', 'not sure - test it with a bot?',
    'status', 'what do you need from me?', 'yes but not the folder', 'Remove the hand-over entirely', 'Merge 6', 'send me the list',
    'delete the old branches', 'deploy the api now', 'ok, cancel that', 'yes, stop', 'ok, hold on', 'ok, never mind', 'yes, nevermind',
    'ok, later', 'sure, skip it', 'go, dont', 'yes, don’t',
    'yes and then also please go and read every chat I had this week and tell me what each one did wrong', '']) {
    assert.strictEqual(isYes(t), false, t);
  }
});

test('says no: no, not, never, nothing, n\'t in every spelling, wait, hold, skip, except, later; stop and cancel unless they open the sentence', () => {
  for (const s of ['no', 'not yet', 'never mail Anna', 'send nothing by mail', "don't send it", 'don’t send it', 'don`t send it', 'dont send it',
    'cant mail Anna yet', 'you cannot mail Anna', 'wait with the mail', 'hold the mail', 'skip the mail to Anna', 'everything except the mail',
    'mail Anna later', 'ok, stop', 'yes, cancel that', 'n​o, mail Anna', 'Never, ever mail Anna', 'nope, mail Anna', 'nah']) {
    assert.strictEqual(saysNo(s), true, s);
  }
  for (const s of ['mail Anna the new time', 'Stop the daily job', 'Cancel the meeting with Anna', '1) Cancel the meeting with Anna', '- Stop the job', 'deploy the api now', 'merge it', 'nobody minds', 'notify Anna']) {
    assert.strictEqual(saysNo(s), false, s);
  }
});

test('plain: zero-width characters dropped, curly quotes and apostrophes made plain, no carriage returns', () => {
  assert.strictEqual(plain('do​n’t “mail” ‘Anna’\r\n'), 'don\'t "mail" \'Anna\'\n');
  assert.strictEqual(plain(null), '');
});

test('the text of an entry: a string, or its text blocks; a tool result is no text', () => {
  assert.strictEqual(textOf(george('hi')), 'hi');
  assert.strictEqual(textOf(reply('a')), 'a');
  assert.strictEqual(textOf(toolResult()), '');
  assert.strictEqual(textOf({}), '');
});

test("George's last message: the last typed user entry of the main chat; tool results, helpers' lines, injected and app-made text are passed over", () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [
    george('first'), reply('r1'), george('yes'), toolResult(), reply('r2'),
    side(george('helper brief, not George')), george('<task-notification>x</task-notification>'),
    george('Another Claude session sent a message: ...'), george('Stop hook feedback: push'), toolResult(),
    meta('Skill /code-review is already loaded above; instructions unchanged. Arguments: merge it'),
  ]);
  assert.strictEqual(lastExchange(file).george, 'yes');
  assert.strictEqual(lastAssistantText(file), 'r2');
});

test("the last exchange: George's last message and the chat's texts right before it, back to the last entry that is not the chat's own", () => {
  const dir = scratch();
  const file = transcript(dir, 'x.jsonl', [george('fix it'), reply('Looking.'), toolResult(), reply('I will: deploy api.'), toolUse(),
    reply('Ready?'), side(reply('I will: merge everything.')), george('yes'), toolResult(), reply('Deploying.')]);
  assert.deepStrictEqual(lastExchange(file), { george: 'yes', reply: 'I will: deploy api.\nReady?' }, 'the run of texts since the last tool result');
  const cut = transcript(dir, 'c.jsonl', [george('fix it'), reply('I will: merge #19. Ok?'), george('<task-notification>done</task-notification>'),
    reply('The helper found 3 failing tests. Fix them first?'), george('yes')]);
  assert.deepStrictEqual(lastExchange(cut), { george: 'yes', reply: 'The helper found 3 failing tests. Fix them first?' }, 'an injected entry ends the reply');
  const app = transcript(dir, 'a.jsonl', [george('go'), reply('I will: deploy api.'), { type: 'system', subtype: 'stop_hook_summary' }, { type: 'queue-operation', operation: 'enqueue' },
    { type: 'queue-operation', operation: 'dequeue' }, george('yes')]);
  assert.deepStrictEqual(lastExchange(app), { george: 'yes', reply: 'I will: deploy api.' }, "the app's own entries between are passed over");
  const first = transcript(dir, 'y.jsonl', [george('yes')]);
  assert.deepStrictEqual(lastExchange(first), { george: 'yes', reply: '' }, 'a yes that answers no reply');
  assert.strictEqual(lastExchange(path.join(dir, 'none.jsonl')), null, 'a file that cannot be read');
  assert.deepStrictEqual(lastExchange(transcript(dir, 'e.jsonl', [])), { george: '', reply: '' }, 'an empty file');
});

test('empty or missing file: no text, no throw', () => {
  const dir = scratch();
  assert.strictEqual(lastExchange(path.join(dir, 'none.jsonl')), null);
  assert.strictEqual(lastAssistantText(''), '');
  const file = transcript(dir, 'empty.jsonl', []);
  assert.strictEqual(lastExchange(file).george, '');
});

test("a long transcript: the tail read grows until it holds George's last message and the reply before it", () => {
  const dir = scratch();
  const big = 'x'.repeat(200000);
  const entries = [george('go'), reply('I will: deploy api.'), george('yes')];
  for (let i = 0; i < 6; i++) entries.push(reply(big), toolResult());
  const file = transcript(dir, 'big.jsonl', entries);
  assert.ok(fs.statSync(file).size > 1024 * 1024);
  assert.deepStrictEqual(lastExchange(file), { george: 'yes', reply: 'I will: deploy api.' });
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
