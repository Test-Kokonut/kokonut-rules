'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, write, runHook } = require('./sandbox');
const { RULEBOOK, project } = require('./rulebook-fixture');
const R = require('../.claude/hooks/reminder.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'reminder.js');
after(cleanup);

// The parts the reminder prints, cut from the fixture rulebook by hand: what "verbatim" means here.
const lines = RULEBOOK.split('\n');
const REPLIES = lines.slice(0, lines.indexOf('# Work') - 1).join('\n');
const fixtureBullet = (start) => {
  const i = lines.findIndex((l) => l.startsWith('- ' + start));
  let j = i + 1;
  while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
  return lines.slice(i, j).join('\n');
};
const ALWAYS = 'REPLY RULES, before every reply:\n' + REPLIES;

const STATUS_README = ['# kokonut-status', '', '## Every chat is a project', '- a line', '', '## Status page',
  'One page per project.', '- Purpose: what the project must achieve.', '```', '# not a heading', '```', '',
  '## Life of a page', '1. Opens.', ''].join('\n');
const STATUS_SECTION = ['## Status page', 'One page per project.', '- Purpose: what the project must achieve.', '```',
  '# not a heading', '```'].join('\n');
const READER_README = ['# shared/', '## Routes', 'x', '## Reading from a chat', '', 'Sign in as the reader.', '### Detail',
  'kept: a lower heading', '## Database changes', 'y'].join('\n');
const READER_SECTION = ['## Reading from a chat', '', 'Sign in as the reader.', '### Detail', 'kept: a lower heading'].join('\n');

// A transcript: George's message, then one assistant turn using the tools given.
function transcript(tools, extra) {
  const entries = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'fix the billing page' } },
    { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: tools.map((t, i) => ({ type: 'tool_use', id: 't' + i, name: t.name, input: t.input || {} })) } },
  ].concat(extra || []);
  const file = path.join(scratch(), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

// A workspace: a project folder with the fixture rulebook, siblings as asked, a home for the state files.
function workspace(siblings) {
  const base = scratch();
  const dir = project(base, 'kokonut-x');
  for (const [file, text] of Object.entries(siblings || {})) write(base, file, text);
  return { base, dir, home: path.join(base, 'home') };
}

const NO_GH = () => { throw new Error('gh: not reachable'); };

// The reminder's text, run in the process: tools of the last turn, the workspace, gh's stand-in.
function remind(tools, ws, options) {
  const w = ws || workspace();
  const o = Object.assign({ prompt: 'next', session_id: 'session-1' }, options || {});
  return R.onPrompt({ hook_event_name: 'UserPromptSubmit', prompt: o.prompt, session_id: o.session_id, transcript_path: transcript(tools), cwd: w.dir },
    { projectDir: w.dir, home: w.home, stateDir: path.join(w.home, 'reminder-state'), gh: o.gh || NO_GH });
}

test('always: the line "REPLY RULES, before every reply:" and the section "# Replies" as written, nothing else', () => {
  assert.strictEqual(remind([]), ALWAYS);
  assert.match(ALWAYS, /^REPLY RULES, before every reply:\n# Replies\n1\. Answer first\. Evidence second\.\n/);
  assert.match(ALWAYS, /\n7\. A line at most 10 words\. .* as long as the\n {2}list\.\n/, 'a wrapped rule keeps its continuation line');
  assert.match(ALWAYS, /\n12\. A reply holds an answer, a result, a plan, a step or a question\.$/);
  assert.strictEqual(remind([{ name: 'Read', input: { file_path: 'x' } }, { name: 'Bash', input: { command: 'ls' } }]), ALWAYS);
});

test('the reminder holds no rule text of its own', () => {
  const source = fs.readFileSync(HOOK, 'utf8');
  for (const rule of ['Answer first', 'Evidence second', 'A line at most 10 words', 'Use common words', 'Facts only.']) {
    assert.ok(!source.includes(rule), rule);
  }
});

test('the status tool, first time in the session: "## Status page" of ../kokonut-status/README.md; then never again', () => {
  const ws = workspace({ 'kokonut-status/README.md': STATUS_README });
  const status = { name: 'Bash', input: { command: 'node ../kokonut-status/scripts/status.js read 2026-10-09_x' } };
  assert.strictEqual(remind([status], ws), ALWAYS + '\n\n' + STATUS_SECTION);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ws.home, 'reminder-state', 'session-1.json'), 'utf8')), { status: true });
  assert.strictEqual(remind([status], ws), ALWAYS, 'the second time: nothing');
  assert.strictEqual(remind([status], ws, { session_id: 'session-2' }), ALWAYS + '\n\n' + STATUS_SECTION, 'another session: fed again');
  const windows = { name: 'PowerShell', input: { command: 'node ..\\kokonut-status\\scripts\\status.js list' } };
  assert.strictEqual(remind([windows], ws, { session_id: 'session-3' }), ALWAYS + '\n\n' + STATUS_SECTION);
});

test('the status tool without kokonut-status beside: from GitHub (base64), else the one-line pointer', () => {
  const status = { name: 'Bash', input: { command: 'node ../kokonut-status/scripts/status.js read x' } };
  const asked = [];
  const gh = (args) => { asked.push(args); return JSON.stringify({ content: Buffer.from(STATUS_README).toString('base64'), encoding: 'base64' }); };
  assert.strictEqual(remind([status], workspace(), { gh }), ALWAYS + '\n\n' + STATUS_SECTION);
  assert.deepStrictEqual(asked, [['api', 'repos/Test-Kokonut/kokonut-status/contents/README.md']]);
  assert.strictEqual(remind([status], workspace()), ALWAYS + '\n\nStatus page definitions: kokonut-status README.md, section Status page');
  const noSection = () => JSON.stringify({ content: Buffer.from('# kokonut-status\n').toString('base64') });
  assert.strictEqual(remind([status], workspace(), { gh: noSection }), ALWAYS + '\n\nStatus page definitions: kokonut-status README.md, section Status page');
});

test('bq, gcloud logging read, builds log or run services, first time: "## Reading from a chat"; once per session', () => {
  const ws = workspace({ 'kokonut-upwork-sync/shared/README.md': READER_README });
  const commands = ['env -u CLOUDSDK_AUTH_ACCESS_TOKEN bq query --use_legacy_sql=false "SELECT 1"',
    "gcloud logging read 'severity>=ERROR' --limit=5", 'gcloud builds log abc --region=us-central1',
    'gcloud run services describe upwork-sync --region=us-central1', 'gcloud --project=kokonut-data-base logging read x'];
  commands.forEach((command, i) => {
    const sid = 'reader-' + i;
    assert.strictEqual(remind([{ name: 'Bash', input: { command } }], ws, { session_id: sid }), ALWAYS + '\n\n' + READER_SECTION, command);
    assert.strictEqual(remind([{ name: 'Bash', input: { command } }], ws, { session_id: sid }), ALWAYS, command + ': the second time');
  });
  for (const command of ['gcloud run deploy x', 'gcloud auth list', 'echo abq query', 'gcloud scheduler jobs list']) {
    assert.strictEqual(remind([{ name: 'Bash', input: { command } }], ws, { session_id: 'none' }), ALWAYS, command);
  }
  assert.strictEqual(remind([{ name: 'Bash', input: { command: 'bq ls' } }], workspace(), { session_id: 'p' }),
    ALWAYS + '\n\nReading live data: kokonut-upwork-sync shared/README.md, section Reading from a chat', 'no copy: the pointer');
});

test('the status tool and a reader command in one turn: both sections, status first, one state file', () => {
  const ws = workspace({ 'kokonut-status/README.md': STATUS_README, 'kokonut-upwork-sync/shared/README.md': READER_README });
  const out = remind([{ name: 'Bash', input: { command: 'bq query x' } }, { name: 'Bash', input: { command: 'node ../kokonut-status/scripts/status.js read y' } }, { name: 'Edit' }], ws);
  assert.strictEqual(out, [ALWAYS, STATUS_SECTION, READER_SECTION].join('\n\n'));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ws.home, 'reminder-state', 'session-1.json'), 'utf8')), { status: true, reader: true });
});

test('a rulebook without a section: that part is left out, the rest printed', () => {
  const base = scratch();
  const dir = project(base, 'kokonut-x', '# Work\n- A fix removes the cause.\n- Other.\n');
  const out = R.onPrompt({ prompt: 'x', transcript_path: transcript([{ name: 'Edit' }]) }, { projectDir: dir, home: base, stateDir: scratch(), gh: NO_GH });
  assert.strictEqual(out, '');
  const none = project(base, 'kokonut-y', '# Something else\n');
  assert.strictEqual(R.onPrompt({ prompt: 'x', transcript_path: transcript([{ name: 'Edit' }, { name: 'WebSearch' }]) }, { projectDir: none, home: base, stateDir: scratch(), gh: NO_GH }), '');
});

test('as a hook: CLAUDE_PROJECT_DIR\'s CLAUDE.md, else the cwd\'s; neither: nothing printed, exit 0', () => {
  const ws = workspace();
  const input = { hook_event_name: 'UserPromptSubmit', prompt: 'x', session_id: 's', transcript_path: transcript([{ name: 'Edit' }]), cwd: ws.dir };
  let r = runHook(HOOK, input, { CLAUDE_PROJECT_DIR: ws.dir, HOME: ws.home });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, ALWAYS + '\n');
  const empty = scratch();
  r = runHook(HOOK, input, { CLAUDE_PROJECT_DIR: empty, HOME: ws.home });
  assert.strictEqual(r.stdout, ALWAYS + '\n', 'the project folder has no CLAUDE.md: the cwd\'s');
  r = runHook(HOOK, Object.assign({}, input, { cwd: empty }), { CLAUDE_PROJECT_DIR: empty, HOME: ws.home });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('as a hook, the status tool with no copy and no gh: the pointer; the state file under ~/.claude/reminder-state', () => {
  const ws = workspace();
  const bin = scratch(); // a PATH without gh
  const input = { prompt: 'x', session_id: 'abc', transcript_path: transcript([{ name: 'Bash', input: { command: 'node ../kokonut-status/scripts/status.js read y' } }]) };
  const r = runHook(HOOK, input, { CLAUDE_PROJECT_DIR: ws.dir, HOME: ws.home, USERPROFILE: ws.home, PATH: bin });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, ALWAYS + '\n\nStatus page definitions: kokonut-status README.md, section Status page\n');
  assert.ok(fs.existsSync(path.join(ws.home, '.claude', 'reminder-state', 'abc.json')));
});

test('the transcript already holds the message being submitted: the turn before it counts', () => {
  const ws = workspace();
  const file = transcript([{ name: 'Edit' }], [{ type: 'user', uuid: 'u2', message: { role: 'user', content: 'next' } }]);
  const out = R.onPrompt({ prompt: 'next', session_id: 's', transcript_path: file }, { projectDir: ws.dir, home: ws.home, stateDir: scratch(), gh: NO_GH });
  assert.strictEqual(out, ALWAYS);
});

test('broken input or a missing transcript: the reply rules alone, exit 0', () => {
  const ws = workspace();
  for (const input of ['not json', { prompt: 'x', transcript_path: path.join(scratch(), 'missing.jsonl') }]) {
    const r = runHook(HOOK, input, { CLAUDE_PROJECT_DIR: ws.dir, HOME: ws.home });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, ALWAYS + '\n');
  }
});

test('section(): heading to the next heading of its level or above, code fences kept whole, trailing blanks dropped', () => {
  assert.strictEqual(R.section(STATUS_README, '## Status page'), STATUS_SECTION);
  assert.strictEqual(R.section(READER_README, '## Reading from a chat'), READER_SECTION);
  assert.strictEqual(R.section('# A\nx\n', '## Missing'), '');
  assert.strictEqual(R.section('```\n# Replies\n```\n# Replies\n1. a\n\n', '# Replies'), '# Replies\n1. a');
  assert.strictEqual(R.bullet(R.section(RULEBOOK, '# The repos'), 'Index.'), fixtureBullet('Index.'));
  assert.strictEqual(R.bullet('- a\n- b', 'c'), '');
});
