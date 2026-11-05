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

// What approves a blocked call. George's conditions of 5 Nov 2026: an approval covers only the actions and exact
// targets it names; a saved "last approved" scope never approves; questions, refusals, quoted approvals and a yes
// to an unrelated question approve nothing; whatever the gate cannot verify, and any error, is refused.
const MAIL_ANNA = mcp('mcp__Gmail__send_message', { to: ['anna@example.com'], subject: 'New time', body: 'x' });
const MAIL_BOB = mcp('mcp__Gmail__send_message', { to: ['bob@example.com'], subject: 'New time', body: 'x' });
const MAIL_BOTH = mcp('mcp__Gmail__send_message', { to: ['anna@example.com', 'bob@example.com'], subject: 'x', body: 'x' });
const SLACK = mcp('mcp__Slack__slack_send_message', { channel_id: 'C0CC8QCFVJQ', message: 'hi' });
const MERGE_19 = mcp('mcp__github__merge_pull_request', { owner: 'Test-Kokonut', repo: 'kokonut-rules', pullNumber: 19 });
const MERGE_20 = mcp('mcp__github__merge_pull_request', { owner: 'Test-Kokonut', repo: 'kokonut-rules', pullNumber: 20 });
const WILL_ANNA = '👉 I will: send the mail to anna@example.com.';

function decide(dir, entries, call) {
  const file = transcript(dir, `c${Math.random().toString(36).slice(2)}.jsonl`, entries);
  return refused(Object.assign({ transcript_path: file }, call), { home: dir });
}
const passes = (dir, entries, call, why) => assert.strictEqual(decide(dir, entries, call), '', why || JSON.stringify(entries));
const blocks = (dir, entries, call, why) => {
  const r = decide(dir, entries, call);
  assert.notStrictEqual(r, '', why || JSON.stringify(entries));
  assert.match(r, /^Blocked/);
  return r;
};

test('a yes to no "I will:" line approves nothing: refused with the ask line, and nothing is written', () => {
  const dir = scratch();
  const r = blocks(dir, [george('yes'), reply('✅ Sure.')], MAIL_ANNA);
  assert.match(r, /^Blocked \(sending mail\): George's last message neither orders it nor says yes to an "I will:" line naming it\. Reply one line, "I will: <what, where>" naming anna@example\.com, and wait\.$/);
  assert.ok(!fs.existsSync(pinFile(dir)));
  passes(dir, [george('yes'), reply('✅ Sure.')], bash('git status'), 'a read is never refused');
});

test('his order passes with nothing pinned and no Purpose lines; it is written as the last approved scope, which approves nothing later', () => {
  const dir = scratch();
  const now = new Date('2026-11-05T15:40:00Z');
  const file = transcript(dir, 's.jsonl', [george('send the mail to anna@example.com')]);
  assert.strictEqual(refused(Object.assign({ transcript_path: file }, MAIL_ANNA), { home: dir, now }), '');
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), 'Approved 2026-11-05 15:40 UTC\nsend the mail to anna@example.com\n');
  blocks(dir, [george('send the mail to anna@example.com'), reply('✅ Sent.'), george('thanks')], MAIL_ANNA, 'the pin approves nothing');
});

test("George's order: the action's words, a word that does it and each exact target, in one sentence", () => {
  const dir = scratch();
  const SHEET = mcp('mcp__Google_Sheets__update_values', { spreadsheetId: '1WEsAbc', range: 'A1', values: [[1]] });
  const cases = [
    ['deploy the api now', bash('gcloud run deploy api'), true],
    ['set up the scheduled task Daily chat score for 07:40', mcp('mcp__claude-code-remote__create_trigger', { name: 'Daily chat score' }), true],
    ['set up the scheduled task for 07:40', mcp('mcp__claude-code-remote__create_trigger', {}), false],
    ['merge Test-Kokonut/kokonut-rules#19', MERGE_19, true],
    ['merge it', MERGE_19, false],
    ['Remove the hand-over entirely', MERGE_19, false],
    ['send me the list', SLACK, false],
    ['update the sheet https://docs.google.com/spreadsheets/d/1WEsAbc/edit with the October numbers', SHEET, true],
    ['update the numbers', SHEET, false],
    ['delete the old branches', bash('git push origin --delete old'), true],
    ['clean the build folder', bash('rm -rf build'), true],
    ['what is in the build folder?', bash('rm -rf build'), false],
  ];
  for (const [said, call, ok] of cases) (ok ? passes : blocks)(dir, [george(said)], call, `${said} -> ${call.tool_name}`);
});

test('his yes to the "I will:" line of the reply he answered: that step passes; not a yes: refused with the ask line', () => {
  const dir = scratch();
  pin(dir);
  passes(dir, [george('fix it'), reply('I will: deploy api. Yes?'), george('yes'), toolResult()], bash('gcloud run deploy api'));
  const r = blocks(dir, [george('yes'), reply('✅ Deployed.'), george('now delete the old branch too?')], bash('git push origin --delete old'));
  assert.match(r, /^Blocked \(deleting a branch on GitHub\): George's last message neither orders it nor says yes to an "I will:" line naming it\./);
  blocks(dir, [george('Remove the hand-over entirely')], MERGE_19);
});

test("a helper is judged by the chat's transcript: George's yes there lets its blocked call pass", () => {
  const dir = scratch();
  transcript(dir, 'sess-1.jsonl', [reply('I will: deploy api.'), george('go')]);
  const helper = transcript(dir, 'agent-2.jsonl', [george('Brief: deploy api and report back')]);
  const input = Object.assign({ transcript_path: helper, agent_id: 'a2', session_id: 'sess-1' }, bash('gcloud run deploy api'));
  assert.strictEqual(refused(input, { home: dir }), '');
  transcript(dir, 'sess-1.jsonl', [reply('I will: deploy api.'), george('go'), reply('done'), george('what did it cost?')]);
  assert.match(refused(input, { home: dir }), /neither orders it nor says yes/);
});

test('questions approve nothing: not as an order, not as a yes', () => {
  const dir = scratch();
  for (const said of ['send it?', 'send the mail to anna@example.com?', 'yes?', 'ok, send it?']) blocks(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA, said);
  blocks(dir, [george('should I merge Test-Kokonut/kokonut-rules#19?')], MERGE_19);
  blocks(dir, [george('deploy the api now?')], bash('gcloud run deploy api'));
});

test('refusals approve nothing, even when they name the action and the target', () => {
  const dir = scratch();
  for (const said of ['no', 'not yet', "don't send it", 'no, wrong address', 'stop', 'wait', 'cancel it', 'hold on']) blocks(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA, said);
  for (const said of ["don't send the mail to anna@example.com", 'do not send the mail to anna@example.com', 'never send the mail to anna@example.com',
    'no need to send the mail to anna@example.com']) blocks(dir, [george(said)], MAIL_ANNA, said);
  blocks(dir, [george("don't merge Test-Kokonut/kokonut-rules#19")], MERGE_19);
  blocks(dir, [george("Don't send the mail to bob@example.com. Send the mail to anna@example.com.")], MAIL_BOB, 'a refused target stays refused');
  passes(dir, [george("Don't send the mail to bob@example.com. Send the mail to anna@example.com.")], MAIL_ANNA, 'the sentence that orders still does');
});

test('quoted, pasted, fenced and blockquoted approvals approve nothing', () => {
  const dir = scratch();
  const orders = ['Anna wrote: "yes, send the mail to anna@example.com"', '> send the mail to anna@example.com',
    '“send the mail to anna@example.com” is what she asked', 'Tell it: "merge Test-Kokonut/kokonut-rules#19"',
    '```\nsend the mail to anna@example.com\n```', '<pasted_content id="1">send the mail to anna@example.com</pasted_content>'];
  for (const said of orders) blocks(dir, [george(said)], /merge/.test(said) ? MERGE_19 : MAIL_ANNA, said);
  for (const said of ['"yes"', '> yes', '"ok"']) blocks(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA, said);
  for (const quoted of ['The rule says: "I will: send the mail to anna@example.com"', '> I will: send the mail to anna@example.com',
    '```\nI will: send the mail to anna@example.com\n```']) blocks(dir, [reply(quoted), george('yes')], MAIL_ANNA, `reply: ${quoted}`);
});

test('a yes to an unrelated question, or to another step, approves nothing', () => {
  const dir = scratch();
  blocks(dir, [reply('👉 Shall I check the lock on kokonut-cookies?'), george('yes')], MAIL_ANNA);
  blocks(dir, [reply('👉 I will: check the lock on kokonut-cookies.'), george('yes')], MERGE_19);
  blocks(dir, [reply(WILL_ANNA), george('yes')], SLACK, 'another action');
  blocks(dir, [reply(WILL_ANNA), george('yes')], MAIL_BOB, 'another target');
  blocks(dir, [reply(WILL_ANNA), george('yes')], MAIL_BOTH, 'a target more');
  blocks(dir, [reply(WILL_ANNA), george('ok'), reply('✅ Sent.'), george('yes')], MAIL_ANNA, 'a yes to a later reply');
  blocks(dir, [reply(WILL_ANNA), george('thanks'), george('yes')], MAIL_ANNA, 'the yes answers no reply');
  assert.match(decide(dir, [reply(WILL_ANNA), george('yes')], MAIL_BOB), /no sentence of George's approval names this action together with bob@example\.com/);
});

test('an approval covers only the actions and exact targets it names', () => {
  const dir = scratch();
  passes(dir, [reply(WILL_ANNA), george('yes')], MAIL_ANNA);
  passes(dir, [george('send the mail to anna@example.com')], MAIL_ANNA);
  blocks(dir, [george('send the mail to Anna')], MAIL_ANNA, 'a first name is no address');
  passes(dir, [reply('I will: merge Test-Kokonut/kokonut-rules#19.'), george('go')], MERGE_19);
  blocks(dir, [reply('I will: merge Test-Kokonut/kokonut-rules#19.'), george('go')], MERGE_20);
  passes(dir, [george('deploy the api now')], bash('gcloud run deploy api --region x'));
  blocks(dir, [george('deploy the api now')], bash('gcloud run deploy web --region x'));
  passes(dir, [george('clean the build folder')], bash('rm -rf build'));
  blocks(dir, [george('clean the build folder')], bash('rm -rf build && gcloud run deploy api'), 'each part of a shell line');
  blocks(dir, [george('clean the build folder')], bash('rm -rf build dist'), 'every path');
  passes(dir, [reply('I will: delete the old branch on GitHub.'), george('yes')], bash('git push origin --delete old'));
  blocks(dir, [reply('I will: delete the old branch on GitHub.'), george('yes')], bash('git push origin --delete main'));
  passes(dir, [reply('I will: post the summary on Slack in C0CC8QCFVJQ.'), george('yes')], SLACK);
  const INSERT = bash('gcloud sql instances execute-sql db --sql="INSERT INTO upwork_site_stats VALUES (1)"');
  passes(dir, [reply('I will: add 3 rows to the table upwork_site_stats (changing Google Cloud).'), george('yes')], INSERT);
  blocks(dir, [reply('I will: add 3 rows to the table upwork_site_stats (changing Google Cloud).'), george('yes')],
    bash('gcloud sql instances execute-sql db --sql="DELETE FROM upwork_docs"'));
});

test('a saved scope approves nothing: any pin gives the same decision as none', () => {
  const cases = [
    [[george('thanks')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MAIL_BOB],
    [[george('send the mail to anna@example.com')], MAIL_ANNA], [[george('what next?')], MERGE_19], [[george('deploy the api now')], bash('gcloud run deploy api')],
  ];
  for (const [entries, call] of cases) {
    const bare = scratch();
    const pinned = scratch();
    fs.mkdirSync(path.dirname(pinFile(pinned)), { recursive: true });
    fs.writeFileSync(pinFile(pinned), 'Approved 2026-11-05 15:40 UTC\nI will: send the mail to anna@example.com and bob@example.com, merge Test-Kokonut/kokonut-rules#19.\n');
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
  assert.strictEqual(parts('Bash', { command: 'git push -f' })[0].targets, null, 'no branch named: it cannot be verified');
  assert.deepStrictEqual(parts('Bash', { command: "psql -c 'UPDATE jobs SET x=1'" })[0].targets[0].forms, ['jobs']);
});

// One regression test for each finding of the review of 5 Nov 2026 (2nd round), numbered as reported.
test('review 1: a Gmail draft is sent as it is, so its recipients cannot be verified: refused', () => {
  const dir = scratch();
  const r = blocks(dir, [reply(WILL_ANNA), george('yes')], mcp('mcp__Gmail__send_message', { to: ['anna@example.com'], draftId: 'r-123' }));
  assert.match(r, /cannot verify what this acts on \(it sends a draft/);
  blocks(dir, [george('send the draft mail now')], mcp('mcp__Gmail__send_message', { draftId: 'r-123' }));
  blocks(dir, [reply(WILL_ANNA), george('yes')], mcp('mcp__Gmail__send_message', { subject: 'x' }), 'no recipient at all');
});

test('review 2: a Drive share names its file, its role and exactly who; anyone with the link or a Chat space must be named', () => {
  const dir = scratch();
  const WILL = [reply('I will: share the Drive file 1abcFILE with anna@example.com as reader.'), george('yes')];
  const share = (extra) => mcp('mcp__Google_Drive__share_file', Object.assign({ fileId: '1abcFILE', role: 'reader' }, extra));
  passes(dir, WILL, share({ emailAddress: 'anna@example.com' }));
  blocks(dir, WILL, share({ permissionId: 'anyoneWithLink' }), 'public link');
  blocks(dir, WILL, share({ chatSpaceId: 'spaces/AAA' }), 'a Chat space');
  blocks(dir, WILL, share({ emailAddress: 'anna@example.com', role: 'writer' }), 'a higher role');
  blocks(dir, WILL, share({ emailAddress: 'anna@example.com', permissionId: 'anyoneWithLink' }), 'two audiences');
  passes(dir, [reply('I will: share the Drive file 1abcFILE with anyone with the link as reader.'), george('yes')], share({ permissionId: 'anyoneWithLink' }));
});

test('review 3: a refusal word anywhere in a sentence, before or after a comma, makes the sentence approve nothing', () => {
  const dir = scratch();
  blocks(dir, [george('Never, ever send the mail to bob@example.com')], MAIL_BOB);
  blocks(dir, [george('Do not, under any circumstances, send the mail to bob@example.com')], MAIL_BOB);
  blocks(dir, [reply('I will: delete the old branches on GitHub, not main.'), george('yes')], bash('git push origin --delete main'));
});

test('review 4: naming the thing is not doing it: "check the mail" does not send mail, "read the Slack channel" does not post', () => {
  const dir = scratch();
  blocks(dir, [george('check the mail from anna@example.com and tell me what she wants')], MAIL_ANNA);
  blocks(dir, [george('read the Slack channel C0CC8QCFVJQ and summarise it')], SLACK);
  passes(dir, [george('post the summary on Slack in C0CC8QCFVJQ')], SLACK);
});

test('review 5: the action and its targets must be in one sentence: two approvals never combine into a third', () => {
  const dir = scratch();
  blocks(dir, [reply('I will: send the mail to anna@example.com.\nI will: post bob@example.com notes on Slack.'), george('yes')], MAIL_BOB);
  blocks(dir, [george('Read the mail. Then post the summary for bob@example.com on Slack')], MAIL_BOB);
  blocks(dir, [george('Send the mail. It goes to anna@example.com')], MAIL_ANNA, 'target in another sentence');
});

test('review 6: no short form: a local part, a base name, a last table segment or a repo without its owner names nothing', () => {
  const dir = scratch();
  blocks(dir, [reply(WILL_ANNA), george('yes')], mcp('mcp__Gmail__send_message', { to: ['anna@other.com'] }));
  passes(dir, [reply('I will: delete the folder /home/user/a/build.'), george('yes')], bash('rm -rf /home/user/a/build'));
  blocks(dir, [reply('I will: delete the folder /home/user/a/build.'), george('yes')], bash('rm -rf /srv/build'));
  blocks(dir, [reply('I will: delete the folder /home/user/a/build.'), george('yes')], bash('rm -rf build'));
  passes(dir, [george('remove the bigquery table ds.old_runs')], bash('bq rm -f -t ds.old_runs'));
  blocks(dir, [george('remove the bigquery table ds.old_runs')], bash('bq rm -f -t prod.old_runs'));
  blocks(dir, [reply('I will: merge kokonut-rules#19.'), george('yes')], MERGE_19, 'no owner');
  blocks(dir, [reply('I will: merge Test-Kokonut/kokonut-rules#19.'), george('yes')],
    mcp('mcp__github__merge_pull_request', { owner: 'Other', repo: 'kokonut-rules', pullNumber: 19 }), 'another owner');
});

test('review 7: a hyphen or a dot joins a name: approving "old-feature" or "api-gateway" names neither "old" nor "api"', () => {
  const dir = scratch();
  blocks(dir, [reply('I will: delete the branch old-feature on GitHub.'), george('yes')], bash('git push origin --delete old'));
  passes(dir, [reply('I will: delete the branch old-feature on GitHub.'), george('yes')], bash('git push origin --delete old-feature'));
  blocks(dir, [george('deploy api-gateway now')], bash('gcloud run deploy api'));
  blocks(dir, [george('deploy api.v2 now')], bash('gcloud run deploy api'));
});

test('review 8: calendar guests added or removed and reply recipients are targets; reply-all cannot be verified', () => {
  const dir = scratch();
  const WILL = [reply('I will: move the calendar event ev123 to 10:00.'), george('yes')];
  passes(dir, WILL, mcp('mcp__Google_Calendar__update_event', { eventId: 'ev123', startTime: '2026-11-06T10:00:00' }));
  blocks(dir, WILL, mcp('mcp__Google_Calendar__update_event', { eventId: 'ev123', addedAttendees: [{ email: 'x@evil.com' }] }));
  blocks(dir, WILL, mcp('mcp__Google_Calendar__update_event', { eventId: 'ev123', removedAttendeeEmails: ['bob@example.com'] }));
  const REPLY = [reply('I will: reply to the mail from anna@example.com.'), george('yes')];
  passes(dir, REPLY, mcp('mcp__Gmail__reply', { messageId: 'm1', to: ['anna@example.com'], body: 'x' }));
  blocks(dir, REPLY, mcp('mcp__Gmail__reply', { messageId: 'm1', to: ['anna@example.com'], replyAll: true, body: 'x' }));
  blocks(dir, REPLY, mcp('mcp__Gmail__reply', { messageId: 'm1', body: 'x' }), 'recipients the gate cannot see');
});

test('review 9: a pasted notification, a long message or one of more than three lines is no order', () => {
  const dir = scratch();
  blocks(dir, [george('GitHub\nMerge pull request Test-Kokonut/kokonut-rules#19 from claude/x\nView it on GitHub')], MERGE_19);
  blocks(dir, [george('From: notifications@github.com\nmerge Test-Kokonut/kokonut-rules#19')], MERGE_19);
  blocks(dir, [george('a\nb\nc\nmerge Test-Kokonut/kokonut-rules#19')], MERGE_19, 'four lines');
  blocks(dir, [george(`merge Test-Kokonut/kokonut-rules#19 ${'and more words '.repeat(20)}`)], MERGE_19, 'over 60 words');
  passes(dir, [george('merge Test-Kokonut/kokonut-rules#19')], MERGE_19);
});

test('review 10: not broadened for the daily refresh: a standing prompt cannot delete page files it never names', () => {
  const dir = scratch();
  const prompt = 'Daily refresh of the "Kokonut Pillar Status" dashboard. Refresh the data of the page https://claude.ai/artifact/Xegfng7iZVfCPXqi9thdvJ. ' +
    '11. Old files: delete (Artifact action "delete", url above, path "<id>") only files uploaded more than 7 days before now. ' + 'More steps. '.repeat(20);
  const del = { tool_name: 'Artifact', tool_input: { action: 'delete', url: 'https://claude.ai/artifact/Xegfng7iZVfCPXqi9thdvJ', path: '0123456789abcdef0123456789abcdef' } };
  blocks(dir, [george(prompt)], del);
  blocks(dir, [george('delete the old files of the page https://claude.ai/artifact/Xegfng7iZVfCPXqi9thdvJ')], del, 'the file is not named');
  passes(dir, [reply('I will: delete the file 0123456789abcdef0123456789abcdef of the page https://claude.ai/artifact/Xegfng7iZVfCPXqi9thdvJ.'), george('yes')], del);
});

test('review 12: a call whose target the gate cannot read is refused, whatever was approved', () => {
  const dir = scratch();
  const UPWORK = mcp('mcp__Upwork__upwork__search_help_center', { query: 'fees' });
  blocks(dir, [george('use the Upwork connector')], UPWORK, 'no tool named');
  passes(dir, [reply('I will: use the Upwork connector search_help_center to look up fees.'), george('yes')], UPWORK);
  assert.match(blocks(dir, [reply('I will: force-push the branch on GitHub.'), george('yes')], bash('git push -f')), /cannot verify/);
  const DESTROY = bash('gcloud secrets versions destroy 3 --secret=api-key');
  blocks(dir, [reply('I will: change the Google Cloud secret api-key.'), george('yes')], DESTROY, 'the command is not named');
  passes(dir, [reply('I will: run `gcloud secrets versions destroy 3 --secret=api-key` (changing Google Cloud).'), george('yes')], DESTROY);
  blocks(dir, [reply('I will: trash the mail thread.'), george('yes')], mcp('mcp__Gmail__trash_thread', {}), 'no thread id');
  blocks(dir, [george('merge it')], bash('gh pr merge 12'), 'no repository');
  passes(dir, [george('merge Test-Kokonut/kokonut-rules#12')], bash('gh pr merge 12 --repo Test-Kokonut/kokonut-rules'));
});

test('review 13: any error while checking blocks the call; so does input the hook cannot read', () => {
  const dir = scratch();
  const loop = {};
  loop.email = loop;
  blocks(dir, [reply(WILL_ANNA), george('yes')], mcp('mcp__Gmail__send_message', { to: [loop] }), 'a recipient that refers to itself');
  const boom = { get to() { throw new Error('boom'); } };
  assert.match(blocks(dir, [reply(WILL_ANNA), george('yes')], mcp('mcp__Gmail__send_message', boom)), /could not check this call \(boom\)/);
  assert.match(refused(null), /^Blocked/);
  const env = { HOME: dir, USERPROFILE: dir };
  const bad = runHook(HOOK, '{broken', env);
  assert.strictEqual(bad.status, 0);
  assert.strictEqual(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('review 14: bq cp checks the table it writes as well as the one it reads', () => {
  const dir = scratch();
  blocks(dir, [george('copy the bigquery table ds.a')], bash('bq cp ds.a prod.important'));
  passes(dir, [george('copy the bigquery table ds.a to prod.important')], bash('bq cp ds.a prod.important'));
});

test('review 15: a refusal always names what the approval must name', () => {
  const dir = scratch();
  const r = blocks(dir, [reply('I will: send the mail to anna@example.com.\nI will: send the mail to bob@example.com.'), george('yes')], MAIL_BOTH);
  assert.match(r, /together with anna@example\.com, bob@example\.com\. Reply one line, "I will: <what, where>" naming anna@example\.com, bob@example\.com, and wait\./);
});

test('as the hook: a refusal is a deny decision with the reason; a pass prints nothing', () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [george('status?')]);
  const env = { HOME: dir, USERPROFILE: dir };
  const r = runHook(HOOK, Object.assign({ transcript_path: file, session_id: 's' }, SLACK), env);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^Blocked \(sending on Slack\)/);
  const pass = runHook(HOOK, Object.assign({ transcript_path: file, session_id: 's' }, bash('git status')), env);
  assert.strictEqual(pass.status, 0);
  assert.strictEqual(pass.stdout, '');
});
