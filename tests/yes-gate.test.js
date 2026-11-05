'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, runHook } = require('./sandbox');
const { classify, parts, refused } = require('../.claude/hooks/yes-gate.js');
const { pinFile } = require('../.claude/hooks/purpose.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'yes-gate.js');
after(cleanup);

const george = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } });
function transcript(dir, name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
function pin(dir) {
  fs.mkdirSync(path.dirname(pinFile(dir)), { recursive: true });
  fs.writeFileSync(pinFile(dir), 'Purpose: p\nDone when:\n- d\n');
}
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const mcp = (name, input) => ({ tool_name: name, tool_input: input || {} });

test('blocked: sending, binning, sharing, changing shared files, the calendar, GitHub actions others see, chats and scheduled tasks, Upwork, in both connector spellings', () => {
  const want = {
    'mcp__Gmail__send_message': 'sending mail', 'mcp__claude_ai_Gmail__reply': 'sending mail', 'mcp__Gmail__forward': 'sending mail',
    'mcp__Gmail__trash_thread': 'binning mail', 'mcp__Gmail__mark_message_spam': 'binning mail',
    'mcp__Slack__slack_send_message': 'sending on Slack', 'mcp__claude_ai_Slack__slack_schedule_message': 'sending on Slack',
    'mcp__Slack__slack_update_canvas': 'changing a shared Slack canvas or list', 'mcp__Slack__slack_add_list_record': 'changing a shared Slack canvas or list',
    'mcp__Google_Drive__trash_file': 'binning a Drive file', 'mcp__Google_Drive__share_file': 'sharing a Drive file',
    'mcp__Google_Drive__update_file': 'changing a Drive file in place', 'mcp__Google_Docs__update_doc': 'changing a Doc',
    'mcp__Google_Sheets__update_values': 'changing a Sheet', 'mcp__Google_Sheets__append_values': 'changing a Sheet',
    'mcp__Google_Calendar__create_event': 'changing the calendar', 'mcp__Google_Calendar__delete_event': 'changing the calendar',
    'mcp__github__merge_pull_request': 'a GitHub action others see', 'mcp__github__enable_pr_auto_merge': 'a GitHub action others see',
    'mcp__github__issue_write': 'a GitHub action others see', 'mcp__github__pull_request_review_write': 'a GitHub action others see',
    'mcp__claude-code-remote__create_session': 'starting or changing a chat or a scheduled task',
    'mcp__claude-code-remote__create_trigger': 'starting or changing a chat or a scheduled task',
    'mcp__claude-code-remote__fire_trigger': 'starting or changing a chat or a scheduled task',
    'mcp__Upwork__upwork__search_help_center': 'the Upwork connector', 'mcp__claude_ai_Upwork__anything': 'the Upwork connector',
  };
  for (const [name, label] of Object.entries(want)) assert.strictEqual(classify(name, {}), label, name);
  assert.strictEqual(classify('Artifact', { action: 'delete', url: 'x' }), 'deleting a page');
});

test('passes: reading, searching, drafting, creating a Drive file, pull requests, pages published, messages to chats, reminders', () => {
  for (const name of ['mcp__Gmail__search_threads', 'mcp__Gmail__get_thread', 'mcp__Gmail__create_draft', 'mcp__Gmail__label_message',
    'mcp__Slack__slack_read_channel', 'mcp__Slack__slack_search_public', 'mcp__Slack__slack_add_reaction',
    'mcp__Google_Drive__search_files', 'mcp__Google_Drive__create_file', 'mcp__Google_Drive__read_file_content', 'mcp__Google_Drive__copy_file',
    'mcp__Google_Docs__read_doc', 'mcp__Google_Sheets__get_values', 'mcp__Google_Calendar__list_events', 'mcp__Google_Calendar__suggest_time',
    'mcp__github__create_pull_request', 'mcp__github__pull_request_read', 'mcp__github__list_commits', 'mcp__github__create_branch',
    'mcp__github__update_pull_request', 'mcp__claude-code-remote__get_session', 'mcp__claude-code-remote__list_events',
    'mcp__claude-code-remote__send_message', 'mcp__claude-code-remote__send_later', 'mcp__claude-code-remote__add_repo',
    'mcp__Webflow__data_pages_tool', 'mcp__Figma__get_metadata', 'Read', 'Edit', 'Write', 'Agent', 'WebFetch']) {
    assert.strictEqual(classify(name, {}), '', name);
  }
  assert.strictEqual(classify('Artifact', { action: 'publish', file_path: 'x.html' }), '');
  assert.strictEqual(classify('Artifact', { action: 'read', url: 'x' }), '');
});

test('shell: deleting, force pushes, merges, deploys, schedules, Google Cloud and BigQuery writes, SQL writes, a status page save are blocked', () => {
  const want = {
    'rm -rf /home/user/kokonut-temp/build': 'deleting files', 'rm -r dist': 'deleting files', 'cd x && rm -fr out': 'deleting files',
    'rm -r -f logs': 'deleting files', 'Remove-Item -Recurse x': 'deleting files',
    'git branch -D old': 'deleting a branch', 'git branch -d old': 'deleting a branch', 'git branch --delete old': 'deleting a branch',
    'git push origin --delete old': 'deleting a branch on GitHub', 'git push -d origin old': 'deleting a branch on GitHub', 'git push origin :old': 'deleting a branch on GitHub',
    'git push --force origin x': 'rewriting a branch on GitHub', 'git push -f': 'rewriting a branch on GitHub', 'git push --force-with-lease origin x': 'rewriting a branch on GitHub',
    'gh pr merge 12': 'merging to main',
    'gcloud run deploy api --region x': 'deploying', 'gcloud run services update api': 'deploying', 'gcloud run jobs execute nightly': 'deploying',
    'gcloud builds submit .': 'deploying', 'gcloud builds triggers run t': 'deploying',
    'gcloud scheduler jobs run daily': 'changing a schedule', 'gcloud scheduler jobs pause daily': 'changing a schedule',
    'gcloud sql instances patch x': 'changing Google Cloud', 'gcloud secrets versions add x': 'changing Google Cloud', 'gcloud iam service-accounts keys create': 'changing Google Cloud',
    'bq rm -t ds.table': 'changing BigQuery', 'bq load ds.t file.csv': 'changing BigQuery', 'bq mk ds': 'changing BigQuery',
    "bq query --use_legacy_sql=false 'DELETE FROM ds.t WHERE 1=1'": 'changing BigQuery',
    "psql -c 'UPDATE jobs SET x=1'": 'changing the database',
    'node /home/user/kokonut-status/scripts/status.js save page f --base 1': 'changing a status page',
  };
  for (const [command, label] of Object.entries(want)) assert.strictEqual(classify('Bash', { command }), label, command);
});

test('shell: reads, commits, pushing the chat\'s own branch, queries, deletes in the temp folder, and the words alone pass', () => {
  for (const command of ['git status', 'git log --oneline', 'git add -A && git commit -m x', 'git push -u origin claude/x',
    'git push origin HEAD', 'gcloud run services list', 'gcloud run services describe api', 'gcloud builds list',
    "bq query --use_legacy_sql=false 'SELECT count(*) FROM ds.t'", 'bq show ds.t', 'bq ls', "psql -c 'SELECT 1'",
    'rm -rf /tmp/claude-0/x/scratch', 'rm -r node_modules', 'rm -f file.txt', 'rm file.txt', 'echo "do not rm -rf anything"',
    'node /home/user/kokonut-status/scripts/status.js read page', 'node scripts/status.js list',
    'grep -rn "git push --force" docs/', 'ls', '']) {
    assert.strictEqual(classify('Bash', { command }), '', command);
  }
});

test('a yes to no "I will:" line approves nothing: refused with the ask line, and nothing is written', () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [george('yes'), reply('✅ Sure.')]);
  const r = refused(Object.assign({ transcript_path: file }, mcp('mcp__Gmail__send_message')), { home: dir });
  assert.strictEqual(r, 'Blocked (sending mail): George\'s last message neither orders it nor says yes to an "I will:" line. Reply one line, "I will: <what, where>", and wait.');
  assert.ok(!fs.existsSync(pinFile(dir)));
  assert.strictEqual(refused(Object.assign({ transcript_path: file }, bash('git status')), { home: dir }), '', 'a read is never refused');
});

test('his order passes with nothing pinned and no Purpose lines; it is written as the last approved scope, which approves nothing later', () => {
  const dir = scratch();
  const now = new Date('2026-11-05T15:40:00Z');
  const file = transcript(dir, 's.jsonl', [george('mail Anna the new time')]);
  const send = mcp('mcp__Gmail__send_message', { to: ['anna@example.com'] });
  assert.strictEqual(refused(Object.assign({ transcript_path: file }, send), { home: dir, now }), '');
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), 'Approved 2026-11-05 15:40 UTC\nmail Anna the new time\n');
  const later = transcript(dir, 'later.jsonl', [george('mail Anna the new time'), reply('✅ Sent.'), george('thanks')]);
  assert.match(refused(Object.assign({ transcript_path: later }, send), { home: dir, now }), /neither orders it nor says yes/, 'the pin approves nothing');
});

test("pinned, George's order names the action: the call passes; an order for something else: refused", () => {
  const dir = scratch();
  pin(dir);
  const cases = [
    ['deploy the api now', bash('gcloud run deploy api'), true],
    ['set up the scheduled task for 07:40', mcp('mcp__claude-code-remote__create_trigger'), true],
    ['merge it', mcp('mcp__github__merge_pull_request'), true],
    ['Remove the hand-over entirely', mcp('mcp__github__merge_pull_request'), false],
    ['send me the list', mcp('mcp__Slack__slack_send_message'), false],
    ['update the sheet with the October numbers', mcp('mcp__Google_Sheets__update_values'), true],
    ['update the numbers', mcp('mcp__Google_Sheets__update_values'), false],
    ['delete the old branches', bash('git push origin --delete old'), true],
    ['clean the build folder', bash('rm -rf build'), true],
    ['what is in the build folder?', bash('rm -rf build'), false],
  ];
  for (const [said, call, passes] of cases) {
    const file = transcript(dir, 'o.jsonl', [george(said)]);
    const r = refused(Object.assign({ transcript_path: file }, call), { home: dir });
    assert.strictEqual(r === '', passes, `${said} -> ${call.tool_name}: ${r || 'passes'}`);
  }
});

test('his yes to the "I will:" line of the reply he answered: that step passes; not a yes: refused with the ask line', () => {
  const dir = scratch();
  pin(dir);
  const yes = transcript(dir, 'yes.jsonl', [george('fix it'), reply('I will: deploy api. Yes?'), george('yes'), toolResult()]);
  assert.strictEqual(refused(Object.assign({ transcript_path: yes }, bash('gcloud run deploy api')), { home: dir }), '');
  const no = transcript(dir, 'no.jsonl', [george('yes'), reply('✅ Deployed.'), george('now delete the old branch too?')]);
  const r = refused(Object.assign({ transcript_path: no }, bash('git push origin --delete old')), { home: dir });
  assert.strictEqual(r, 'Blocked (deleting a branch on GitHub): George\'s last message neither orders it nor says yes to an "I will:" line. Reply one line, "I will: <what, where>", and wait.');
  const order = transcript(dir, 'order.jsonl', [george('Remove the hand-over entirely')]);
  assert.match(refused(Object.assign({ transcript_path: order }, mcp('mcp__github__merge_pull_request')), { home: dir }), /neither orders it nor says yes/);
});

test("a helper is judged by the chat's transcript: George's yes there lets its blocked call pass", () => {
  const dir = scratch();
  pin(dir);
  transcript(dir, 'sess-1.jsonl', [reply('I will: deploy api.'), george('go')]);
  const helper = transcript(dir, 'agent-2.jsonl', [george('Brief: deploy api and report back')]);
  const input = Object.assign({ transcript_path: helper, agent_id: 'a2', session_id: 'sess-1' }, bash('gcloud run deploy api'));
  assert.strictEqual(refused(input, { home: dir }), '');
  transcript(dir, 'sess-1.jsonl', [george('go'), reply('done'), george('what did it cost?')]);
  assert.match(refused(input, { home: dir }), /neither orders it nor says yes/);
});

// George's conditions of 5 Nov 2026: an approval covers only the actions and targets it names; a saved "last
// approved" scope never approves; questions, refusals, quoted approvals and a yes to an unrelated question approve
// nothing.
const MAIL_ANNA = mcp('mcp__Gmail__send_message', { to: ['anna@example.com'], subject: 'New time', body: 'x' });
const MAIL_BOB = mcp('mcp__Gmail__send_message', { to: ['bob@example.com'], subject: 'New time', body: 'x' });
const MAIL_BOTH = mcp('mcp__Gmail__send_message', { to: 'anna@example.com, bob@example.com', subject: 'x', body: 'x' });
const SLACK = mcp('mcp__Slack__slack_send_message', { channel_id: 'C0CC8QCFVJQ', message: 'hi' });
const MERGE_19 = mcp('mcp__github__merge_pull_request', { owner: 'Test-Kokonut', repo: 'kokonut-rules', pullNumber: 19 });
const MERGE_20 = mcp('mcp__github__merge_pull_request', { owner: 'Test-Kokonut', repo: 'kokonut-rules', pullNumber: 20 });
const WILL_ANNA = '👉 I will: send the mail to anna@example.com.';

function decide(dir, entries, call) {
  const file = transcript(dir, `c${Math.random().toString(36).slice(2)}.jsonl`, entries);
  return refused(Object.assign({ transcript_path: file }, call), { home: dir });
}

test('questions approve nothing: not as an order, not as a yes', () => {
  const dir = scratch();
  for (const said of ['send it?', 'send the mail to anna@example.com?', 'yes?', 'ok, send it?', 'should I merge kokonut-rules#19?']) {
    const call = /merge/.test(said) ? MERGE_19 : MAIL_ANNA;
    assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george(said)], call), '', said);
  }
  assert.notStrictEqual(decide(dir, [george('deploy the api now?')], bash('gcloud run deploy api')), '');
});

test('refusals approve nothing, even when they name the action and the target', () => {
  const dir = scratch();
  for (const said of ['no', 'not yet', "don't send it", 'no, wrong address', 'stop', 'wait', 'cancel it', 'hold on']) {
    assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA), '', said);
  }
  for (const said of ["don't send the mail to anna@example.com", 'do not send the mail to Anna', 'never mail Anna',
    'no need to mail Anna', "don't merge kokonut-rules#19"]) {
    const call = /merge/.test(said) ? MERGE_19 : MAIL_ANNA;
    assert.notStrictEqual(decide(dir, [george(said)], call), '', said);
  }
  assert.notStrictEqual(decide(dir, [george("Don't mail Bob. Mail Anna the new time.")], MAIL_BOB), '', 'a refused target stays refused');
  assert.strictEqual(decide(dir, [george("Don't mail Bob. Mail Anna the new time.")], MAIL_ANNA), '', 'the clause that orders still does');
});

test('quoted, pasted and fenced approvals approve nothing', () => {
  const dir = scratch();
  const orders = ['Anna wrote: "yes, send the mail to anna@example.com"', '> send the mail to anna@example.com',
    '“send the mail to anna@example.com” is what she asked', 'Tell it: "merge kokonut-rules#19"',
    '```\nsend the mail to anna@example.com\n```', '<pasted_content id="1">send the mail to anna@example.com</pasted_content>'];
  for (const said of orders) {
    const call = /merge/.test(said) ? MERGE_19 : MAIL_ANNA;
    assert.notStrictEqual(decide(dir, [george(said)], call), '', said);
  }
  for (const said of ['"yes"', '> yes', '"ok"']) assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA), '', said);
  for (const quoted of ['The rule says: "I will: send the mail to anna@example.com"', '> I will: send the mail to anna@example.com',
    '```\nI will: send the mail to anna@example.com\n```']) {
    assert.notStrictEqual(decide(dir, [reply(quoted), george('yes')], MAIL_ANNA), '', `reply: ${quoted}`);
  }
});

test('a yes to an unrelated question, or to another step, approves nothing', () => {
  const dir = scratch();
  assert.notStrictEqual(decide(dir, [reply('👉 Shall I check the lock on kokonut-cookies?'), george('yes')], MAIL_ANNA), '');
  assert.notStrictEqual(decide(dir, [reply('👉 I will: check the lock on kokonut-cookies.'), george('yes')], MERGE_19), '');
  assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george('yes')], SLACK), '', 'another action');
  assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george('yes')], MAIL_BOB), '', 'another target');
  assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george('yes')], MAIL_BOTH), '', 'a target more');
  assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george('ok'), reply('✅ Sent.'), george('yes')], MAIL_ANNA), '', 'a yes to a later reply');
  assert.notStrictEqual(decide(dir, [reply(WILL_ANNA), george('thanks'), george('yes')], MAIL_ANNA), '', 'the yes answers no reply');
  assert.match(decide(dir, [reply(WILL_ANNA), george('yes')], MAIL_BOB), /does not name bob@example\.com/);
});

test('an approval covers only the actions and targets it names', () => {
  const dir = scratch();
  assert.strictEqual(decide(dir, [reply(WILL_ANNA), george('yes')], MAIL_ANNA), '');
  assert.strictEqual(decide(dir, [george('send the mail to Anna')], MAIL_ANNA), '', 'an order naming the person');
  assert.strictEqual(decide(dir, [reply('I will: merge Test-Kokonut/kokonut-rules#19.'), george('go')], MERGE_19), '');
  assert.notStrictEqual(decide(dir, [reply('I will: merge Test-Kokonut/kokonut-rules#19.'), george('go')], MERGE_20), '');
  assert.notStrictEqual(decide(dir, [george('merge it')], MERGE_19), '', 'an order naming no pull request');
  assert.strictEqual(decide(dir, [george('deploy the api now')], bash('gcloud run deploy api --region x')), '');
  assert.notStrictEqual(decide(dir, [george('deploy the api now')], bash('gcloud run deploy web --region x')), '');
  assert.strictEqual(decide(dir, [george('clean the build folder')], bash('rm -rf build')), '');
  assert.notStrictEqual(decide(dir, [george('clean the build folder')], bash('rm -rf build && gcloud run deploy api')), '', 'each part of a shell line');
  assert.notStrictEqual(decide(dir, [george('clean the build folder')], bash('rm -rf build dist')), '', 'every path');
  assert.strictEqual(decide(dir, [reply('I will: delete the old branches on GitHub, not main.'), george('yes')], bash('git push origin --delete old')), '');
  assert.notStrictEqual(decide(dir, [reply('I will: delete the old branches on GitHub, not main.'), george('yes')], bash('git push origin --delete main')), '', 'a target in a clause that says no');
  assert.strictEqual(decide(dir, [reply('I will: post the summary on Slack in C0CC8QCFVJQ.'), george('yes')], SLACK), '');
  assert.strictEqual(decide(dir, [reply('I will: add 3 rows to the table upwork_site_stats (changing Google Cloud).'), george('yes')],
    bash('gcloud sql instances execute-sql db --sql="INSERT INTO upwork_site_stats VALUES (1)"')), '');
  assert.notStrictEqual(decide(dir, [reply('I will: add 3 rows to the table upwork_site_stats (changing Google Cloud).'), george('yes')],
    bash('gcloud sql instances execute-sql db --sql="DELETE FROM upwork_docs"')), '');
});

test('a saved scope approves nothing: any pin gives the same decision as none', () => {
  const cases = [
    [[george('thanks')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MAIL_BOB],
    [[george('send the mail to Anna')], MAIL_ANNA], [[george('what next?')], MERGE_19], [[george('deploy the api now')], bash('gcloud run deploy api')],
  ];
  for (const [entries, call] of cases) {
    const bare = scratch();
    const pinned = scratch();
    fs.mkdirSync(path.dirname(pinFile(pinned)), { recursive: true });
    fs.writeFileSync(pinFile(pinned), 'Approved 2026-11-05 15:40 UTC\nI will: send the mail to anna@example.com and bob@example.com, merge kokonut-rules#19.\n');
    assert.strictEqual(decide(pinned, entries, call) === '', decide(bare, entries, call) === '', JSON.stringify(entries));
  }
});

test('parts: every call classify blocks has its parts, and a shell line has one per blocked command', () => {
  const calls = [bash('rm -r dist'), bash('git push -f'), bash('gh pr merge 12'), bash("psql -c 'UPDATE jobs SET x=1'"),
    bash('node /home/user/kokonut-status/scripts/status.js save page f --base 1'), MAIL_ANNA, SLACK, MERGE_19,
    mcp('mcp__Upwork__upwork__search_help_center'), { tool_name: 'Artifact', tool_input: { action: 'delete', url: 'https://claude.ai/artifact/abc' } },
    bash('git status'), mcp('mcp__Gmail__get_thread')];
  for (const c of calls) assert.strictEqual(parts(c.tool_name, c.tool_input).length > 0, classify(c.tool_name, c.tool_input) !== '', c.tool_name + ' ' + JSON.stringify(c.tool_input));
  assert.deepStrictEqual(parts('Bash', { command: 'rm -rf build && gcloud run deploy api' }).map((p) => p.label), ['deleting files', 'deploying']);
  assert.strictEqual(parts('Bash', { command: 'git push -f' })[0].targets, null, 'no branch named: the action alone');
  assert.deepStrictEqual(parts('Bash', { command: "psql -c 'UPDATE jobs SET x=1'" })[0].targets[0].forms, ['jobs', 'jobs']);
});

test('as the hook: a refusal is a deny decision with the reason; a pass prints nothing; bad input prints nothing', () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [george('status?')]);
  const env = { HOME: dir, USERPROFILE: dir };
  const r = runHook(HOOK, Object.assign({ transcript_path: file, session_id: 's' }, mcp('mcp__Slack__slack_send_message')), env);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^Blocked \(sending on Slack\)/);
  const pass = runHook(HOOK, Object.assign({ transcript_path: file, session_id: 's' }, bash('git status')), env);
  assert.strictEqual(pass.status, 0);
  assert.strictEqual(pass.stdout, '');
  const bad = runHook(HOOK, '{broken', env);
  assert.strictEqual(bad.status, 0);
  assert.strictEqual(bad.stdout, '');
});
