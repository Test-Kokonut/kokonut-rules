'use strict';
// A chat is tied by a save (not a read); work after its last save refuses the stop with the note, at most once per
// chat; plus the hook as Claude Code runs it.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, runHook } = require('./sandbox');
const { decide, note } = require('../.claude/hooks/status-check.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'status-check.js');
after(cleanup);

let n = 0;
// A chat: a transcript file, its own state folder, and helpers to add turns and to end the chat's turn (a Stop).
// Every entry carries a uuid, as Claude Code writes them (uuids: false leaves them out).
function chat(options) {
  const o = Object.assign({ uuids: true }, options || {});
  n++;
  const dir = scratch();
  const transcript = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(transcript, '');
  const state = path.join(dir, 'status-state');
  let id = 0;
  const add = (entry) => {
    const e = Object.assign({ timestamp: new Date().toISOString() }, entry);
    if (o.uuids) e.uuid = `e${++id}`;
    fs.appendFileSync(transcript, JSON.stringify(e) + '\n');
  };
  let tools = 0;
  const tool = (name, input, result, isError) => {
    const useId = `t${++tools}`;
    add({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: useId, name, input }] } });
    add({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: useId, content: result, is_error: Boolean(isError) }] } });
  };
  const session = `session-${n}`;
  return {
    session, transcript, state,
    say: (text) => add({ type: 'user', message: { role: 'user', content: text } }),
    bash: (command, result, isError) => tool('Bash', { command }, result === undefined ? 'ok' : result, isError),
    use: (name, input) => tool(name, input || {}, 'ok'),
    edit: () => tool('Edit', { file_path: 'x.js', old_string: 'a', new_string: 'b' }, 'ok'),
    next: () => decide({ hook_event_name: 'Stop', session_id: session, transcript_path: transcript, stop_hook_active: false }, state),
    stateFile: () => path.join(state, `${session}.check.json`),
  };
}
const SAVE = 'node ../kokonut-status/scripts/status.js save 2026-10-09_dashboard page.md --base abc123 --message "x"';
const SAVED = 'SAVED projects/2026-10-09_dashboard.md\n--- BASE def456';
const NOTE = note('2026-10-09_dashboard');

test('the note: the agreed text, one line, naming the new parts and the cloud command', () => {
  assert.strictEqual(note('x'), 'Status note: the page x was saved before later changes. Save it again if its State, ' +
    'Done when or Next step changed (node /home/user/kokonut-status/scripts/status.js read x, edit, save with its BASE); otherwise finish.');
  assert.ok(!note('x').includes('\n'));
});

test('a chat that never saved is never noted', () => {
  const c = chat();
  c.say('Fix the bug.');
  c.edit();
  c.bash('git commit -m x');
  assert.strictEqual(c.next(), '');
});

test('a read alone ties nothing', () => {
  const c = chat();
  c.bash('node ../kokonut-status/scripts/status.js read 2026-10-09_dashboard', 'page\n--- BASE abc123');
  c.edit();
  c.bash('git push -u origin x');
  assert.strictEqual(c.next(), '');
});

test('"this is project X" ties nothing', () => {
  const c = chat();
  c.say('this is project website');
  c.edit();
  assert.strictEqual(c.next(), '');
});

test('a save ties the chat: work after it refuses the stop with the note', () => {
  const c = chat();
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
});

test('a new page (status.js new) ties the chat', () => {
  const c = chat();
  c.bash('node ../kokonut-status/scripts/status.js new 2026-10-09_dashboard page.md', SAVED);
  c.bash('git commit -m "more work"');
  assert.strictEqual(c.next(), NOTE);
});

test('a save with --base new ties the chat', () => {
  const c = chat();
  c.bash('node status.js save website page.md --base new', 'SAVED projects/website.md\n--- BASE 1');
  c.edit();
  assert.strictEqual(c.next(), note('website'));
});

test('a quoted page name ties the chat too, from any path to status.js', () => {
  const c = chat();
  c.bash('node "C:/Users/x/.claude/scripts/status.js" save "2026-10-09_dashboard" "page.md" --base abc', SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
});

test('a save whose result comes as text blocks ties the chat', () => {
  const c = chat();
  c.bash(SAVE, [{ type: 'text', text: SAVED }]);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
});

test('work: edits, writes, agents, workflows, git commit, push or merge, gcloud changes, bq writes; not reads, not status.js', () => {
  const work = [['Write'], ['MultiEdit'], ['NotebookEdit'], ['Agent'], ['Task'], ['Workflow'], ['Bash', 'git commit -m x'],
    ['Bash', 'git push -u origin x'], ['Bash', 'git merge origin/main'], ['Bash', 'gcloud run deploy app --source .'],
    ['Bash', 'gcloud run services update app'], ['Bash', 'gcloud scheduler jobs create http x'], ['Bash', 'gcloud run jobs execute x'],
    ['Bash', 'gcloud sql instances delete x'], ['Bash', 'bq query "SELECT 1"'], ['Bash', 'bq rm -t d.t'], ['Bash', 'bq mk d'],
    ['Bash', 'bq load d.t f.csv'], ['PowerShell', 'git commit -m x']];
  for (const [name, command] of work) {
    const c = chat();
    c.bash(SAVE, SAVED);
    c.use(name, command ? { command } : {});
    assert.strictEqual(c.next(), NOTE, `${name} ${command || ''}`);
  }
  const reads = ['git status', 'git log -3', 'gcloud logging read "severity>=ERROR"', 'ls', 'node --test',
    'node ../kokonut-status/scripts/status.js read 2026-10-09_dashboard'];
  for (const command of reads) {
    const c = chat();
    c.bash(SAVE, SAVED);
    c.bash(command);
    c.use('Read', { file_path: 'a.js' });
    assert.strictEqual(c.next(), '', command);
  }
});

test('a saved chat with no work since its save: no note', () => {
  const c = chat();
  c.edit();
  c.bash(SAVE, SAVED);
  assert.strictEqual(c.next(), '');
});

test('work before the save does not count', () => {
  const c = chat();
  c.edit();
  c.bash('git commit -m x');
  c.bash(SAVE, SAVED);
  c.say('thanks');
  assert.strictEqual(c.next(), '');
});

test('a save that failed ties nothing', () => {
  const c = chat();
  c.bash(SAVE, 'OVERLAP: another chat changed the page', true);
  c.bash(SAVE, 'Page refused by the shape check');
  c.edit();
  assert.strictEqual(c.next(), '');
});

test('a save of a facts page ties nothing', () => {
  const c = chat();
  c.bash('node status.js save facts/the-book page.md --base abc', 'SAVED facts/the-book.md\n--- BASE x');
  c.edit();
  assert.strictEqual(c.next(), '');
});

test('a delete of the tied page unties the chat', () => {
  const c = chat();
  c.bash(SAVE, SAVED);
  c.bash('node status.js delete 2026-10-09_dashboard --base def456 --reason kill', 'DELETED projects/2026-10-09_dashboard.md');
  c.edit();
  assert.strictEqual(c.next(), '');
});

test('at most once per chat: after the note, the next stops pass, however much more work', () => {
  const c = chat();
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
  assert.strictEqual(c.next(), '', 'refused once already: the stop passes');
  for (let i = 0; i < 3; i++) {
    c.edit();
    c.bash('git push -u origin x');
    assert.strictEqual(c.next(), '');
  }
});

test('a newer save does not reset it: work after that save passes too; the state file names the page', () => {
  const c = chat();
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
  c.bash(SAVE, SAVED);
  assert.strictEqual(c.next(), '', 'saved, no work since: nothing to note');
  c.edit();
  assert.strictEqual(c.next(), '', 'work after the newer save: refused once already');
  const kept = JSON.parse(fs.readFileSync(c.stateFile(), 'utf8'));
  assert.strictEqual(kept.project, '2026-10-09_dashboard');
  assert.strictEqual(typeof kept.noted, 'string');
});

test('without uuids in the transcript, the save\'s tool call is its key: still once per chat', () => {
  const c = chat({ uuids: false });
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
  assert.strictEqual(c.next(), '');
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), '');
});

test('a stop before any save, then a save and work: the note then', () => {
  const c = chat();
  c.edit();
  assert.strictEqual(c.next(), '');
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
});

test('two chats are counted apart', () => {
  const a = chat();
  const b = chat();
  a.bash(SAVE, SAVED);
  a.edit();
  b.edit();
  assert.strictEqual(a.next(), NOTE);
  assert.strictEqual(b.next(), '');
});

test("the kokonut-status copy's state file in the same folder is neither read nor written", () => {
  const c = chat();
  c.bash('node status.js read website', 'page\n--- BASE 1');
  c.edit();
  const theirs = path.join(c.state, `${c.session}.json`);
  fs.mkdirSync(c.state, { recursive: true });
  const kept = JSON.stringify({ v: 2, offset: 99999, project: 'website', workSinceSave: 5, pendingSaves: {}, fired: false });
  fs.writeFileSync(theirs, kept);
  assert.strictEqual(c.next(), '', 'its project is not taken over: a read ties nothing');
  c.bash(SAVE, SAVED);
  c.edit();
  assert.strictEqual(c.next(), NOTE);
  assert.strictEqual(fs.readFileSync(theirs, 'utf8'), kept);
});

test('a subagent\'s turns (isSidechain) count for nothing', () => {
  const c = chat();
  c.bash(SAVE, SAVED);
  fs.appendFileSync(c.transcript, JSON.stringify({ type: 'assistant', isSidechain: true,
    message: { content: [{ type: 'tool_use', id: 'side', name: 'Edit', input: {} }] } }) + '\n');
  assert.strictEqual(c.next(), '');
});

test('a missing transcript or input: nothing', () => {
  const state = scratch();
  assert.strictEqual(decide({ session_id: 'x', transcript_path: path.join(state, 'none.jsonl') }, state), '');
  assert.strictEqual(decide({}, state), '');
  assert.strictEqual(decide(null, state), '');
});

test('as a hook: the refusal as Stop JSON on stdout, its state in ~/.claude/status-state, silent after; a continued stop or broken input silent; always exit 0', () => {
  const c = chat();
  c.bash(SAVE, SAVED);
  c.edit();
  const home = scratch();
  const env = { HOME: home, USERPROFILE: home };
  const input = { hook_event_name: 'Stop', session_id: c.session, transcript_path: c.transcript, stop_hook_active: false };
  const continued = runHook(HOOK, Object.assign({}, input, { stop_hook_active: true }), env);
  assert.strictEqual(continued.stdout, '', 'a stop already continued by a Stop hook is never refused');
  const r = runHook(HOOK, input, env);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), { decision: 'block', reason: NOTE });
  assert.ok(r.stdout.endsWith('}\n') && r.stdout.split('\n').length === 2, 'one line');
  assert.strictEqual(r.stderr, '');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'status-state', `${c.session}.check.json`)));
  const again = runHook(HOOK, input, env);
  assert.strictEqual(again.status, 0);
  assert.strictEqual(again.stdout, '');
  for (const broken of ['not json', {}, { session_id: 'x', transcript_path: path.join(home, 'missing.jsonl') }]) {
    const r2 = runHook(HOOK, broken, env);
    assert.strictEqual(r2.status, 0);
    assert.strictEqual(r2.stdout, '');
  }
});
