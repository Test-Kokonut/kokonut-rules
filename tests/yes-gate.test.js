'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, runHook } = require('./sandbox');
const { classify, refused, ORDER } = require('../.claude/hooks/yes-gate.js');
const { pinFile } = require('../.claude/hooks/purpose.js');

const HOOK = path.join(ROOT, '.claude', 'hooks', 'yes-gate.js');
after(cleanup);

const george = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } });
const meta = (text) => Object.assign({ isMeta: true }, george(text));
function transcript(dir, name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const mcp = (name, input) => ({ tool_name: name, tool_input: input || {} });

test('blocked: sending, binning, sharing, changing shared files, the calendar, GitHub merges, reviews, issues and repos, chats and scheduled tasks, Upwork, in both connector spellings', () => {
  const want = {
    'mcp__Gmail__send_message': 'sending mail', 'mcp__claude_ai_Gmail__reply': 'sending mail', 'mcp__Gmail__forward': 'sending mail',
    'mcp__Gmail__trash_thread': 'binning mail', 'mcp__Gmail__mark_message_spam': 'binning mail',
    'mcp__Slack__slack_send_message': 'sending on Slack', 'mcp__claude_ai_Slack__slack_schedule_message': 'sending on Slack',
    'mcp__Slack__slack_update_canvas': 'changing a shared Slack canvas or list', 'mcp__Slack__slack_add_list_record': 'changing a shared Slack canvas or list',
    'mcp__Google_Drive__trash_file': 'binning a Drive file', 'mcp__Google_Drive__share_file': 'sharing a Drive file',
    'mcp__Google_Drive__update_file': 'changing a Drive file in place', 'mcp__Google_Docs__update_doc': 'changing a Doc',
    'mcp__Google_Sheets__update_values': 'changing a Sheet', 'mcp__Google_Sheets__append_values': 'changing a Sheet',
    'mcp__Google_Calendar__create_event': 'changing the calendar', 'mcp__Google_Calendar__update_event': 'changing the calendar',
    'mcp__Google_Calendar__delete_event': 'deleting a calendar event',
    'mcp__github__merge_pull_request': 'merging a pull request', 'mcp__github__enable_pr_auto_merge': 'merging a pull request',
    'mcp__github__pull_request_review_write': 'a review on GitHub', 'mcp__github__request_copilot_review': 'a review on GitHub',
    'mcp__github__issue_write': 'an issue or comment on GitHub', 'mcp__github__add_issue_comment': 'an issue or comment on GitHub',
    'mcp__github__update_issue_comment': 'an issue or comment on GitHub', 'mcp__github__create_repository': 'a repository on GitHub',
    'mcp__claude-code-remote__create_session': 'starting or changing a chat or a scheduled task',
    'mcp__claude-code-remote__create_trigger': 'starting or changing a chat or a scheduled task',
    'mcp__claude-code-remote__update_trigger': 'starting or changing a chat or a scheduled task',
    'mcp__claude-code-remote__archive_session': 'ending a chat or a scheduled task', 'mcp__claude-code-remote__delete_trigger': 'ending a chat or a scheduled task',
    'mcp__claude-code-remote__fire_trigger': 'running a scheduled task',
    'mcp__Upwork__upwork__search_help_center': 'the Upwork connector', 'mcp__claude_ai_Upwork__anything': 'the Upwork connector',
  };
  for (const [name, label] of Object.entries(want)) assert.strictEqual(classify(name, {}), label, name);
  assert.strictEqual(classify('Artifact', { action: 'delete', url: 'x' }), 'deleting a page');
  for (const label of Object.values(want)) assert.ok(ORDER[label], `${label} has its words`);
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
    // 13 Nov 2026: reads pass, writes stay blocked.
    'gcloud sql instances execute-sql db --sql="INSERT INTO t VALUES (1)"': 'changing Google Cloud',
    'gcloud sql instances execute-sql db --sql=@/no/such/file.sql': 'changing Google Cloud',
    'gcloud secrets versions access latest --secret=k': 'changing Google Cloud',
    'bq query --destination_table=ds.t "SELECT 1"': 'changing BigQuery',
    "bq query 'GRANT SELECT ON ds.t TO x'": 'changing BigQuery',
    "echo 'DELETE FROM t' | psql": 'changing the database',
    'psql <<EOF\nUPDATE t SET x = 1;\nEOF': 'changing the database',
  };
  for (const [command, label] of Object.entries(want)) assert.strictEqual(classify('Bash', { command }), label, command);
});

test('shell: reads, commits, pushing the chat\'s own branch, queries, deletes in the temp folder, and the words alone pass', () => {
  for (const command of ['git status', 'git log --oneline', 'git add -A && git commit -m x', 'git push -u origin claude/x',
    'git push origin HEAD', 'gcloud run services list', 'gcloud run services describe api', 'gcloud builds list',
    "bq query --use_legacy_sql=false 'SELECT count(*) FROM ds.t'", 'bq show ds.t', 'bq ls', "psql -c 'SELECT 1'",
    // 13 Nov 2026: reads pass without George; a write word in a value or a comment is no statement.
    `gcloud sql instances execute-sql db --sql="SELECT count(*) FROM t WHERE title LIKE 'Create %'"`,
    `bq query --use_legacy_sql=false "SELECT * FROM t WHERE title = 'Create Amazon Listing Images'"`,
    "psql -c 'SELECT 1 -- delete later'", 'gcloud sql instances describe db', 'gcloud sql databases list --instance=db',
    'gcloud secrets list', 'gcloud projects describe p', 'gcloud iam service-accounts list',
    'rm -rf /tmp/claude-0/x/scratch', 'rm -r node_modules', 'rm -f file.txt', 'rm file.txt', 'echo "do not rm -rf anything"',
    'node /home/user/kokonut-status/scripts/status.js read page', 'node scripts/status.js list',
    'grep -rn "git push --force" docs/', 'ls', '']) {
    assert.strictEqual(classify('Bash', { command }), '', command);
  }
});

test('shell: SQL read from a file is judged by the file: a read passes, a write or a file the gate cannot open is blocked (13 Nov 2026)', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'read.sql'), "SELECT job_id FROM t WHERE title LIKE 'Create %' -- delete later\n");
  fs.writeFileSync(path.join(dir, 'write.sql'), 'UPDATE t SET x = 1');
  const read = path.join(dir, 'read.sql');
  const write = path.join(dir, 'write.sql');
  for (const command of [`gcloud sql instances execute-sql db --sql=@${read}`, `bq query --use_legacy_sql=false < ${read}`,
    `D=${dir}; bq query --format=json < $D/read.sql`, `psql -f ${read}`, `mysql < ${read}`]) {
    assert.strictEqual(classify('Bash', { command }), '', command);
  }
  const want = {
    [`gcloud sql instances execute-sql db --sql=@${write}`]: 'changing Google Cloud',
    [`bq query < ${write}`]: 'changing BigQuery',
    [`psql -f ${write}`]: 'changing the database',
    [`mysql < ${write}`]: 'changing the database',
    'bq query < $NO_SUCH_FOLDER/read.sql': 'changing BigQuery',
  };
  for (const [command, label] of Object.entries(want)) assert.strictEqual(classify('Bash', { command }), label, command);
});

// What approves a blocked call: George's last message, by its words. The gate is a backstop, not proof of approval:
// it checks that a message of his own orders that kind of action, or that his yes answers an "I will:" line naming
// it. It does not read which recipient, file, branch or table a call acts on: rule 12 leaves that to the chat. Its
// limits are written out in the test "known limits" below.
const MAIL_ANNA = mcp('mcp__Gmail__send_message', { to: ['anna@example.com'], subject: 'New time', body: 'x' });
const MAIL_BOB = mcp('mcp__Gmail__send_message', { to: ['bob@example.com'], subject: 'New time', body: 'x' });
const SLACK = mcp('mcp__Slack__slack_send_message', { channel_id: 'C0CC8QCFVJQ', message: 'hi' });
const MERGE_19 = mcp('mcp__github__merge_pull_request', { owner: 'Test-Kokonut', repo: 'kokonut-rules', pullNumber: 19 });
const REVIEW_19 = mcp('mcp__github__pull_request_review_write', { method: 'create', event: 'APPROVE', owner: 'Test-Kokonut', repo: 'kokonut-rules', pullNumber: 19 });
const COMMENT_19 = mcp('mcp__github__add_issue_comment', { owner: 'Test-Kokonut', repo: 'kokonut-rules', issue_number: 19, body: 'x' });
const DEPLOY = bash('gcloud run deploy api --region x');
const WILL_ANNA = '👉 I will: send the mail to anna@example.com.';
const NOW = new Date('2026-11-05T15:40:00Z');
const STAMP = 'Approved 2026-11-05 15:40 UTC\n';
const ASK = /neither orders it nor says yes to an "I will:" line naming it\. Reply one line, "I will: <what, where>", naming [^.]+, and wait\.$/;

function decide(dir, entries, call) {
  const file = transcript(dir, `c${Math.random().toString(36).slice(2)}.jsonl`, entries);
  return refused(Object.assign({ transcript_path: file }, call), { home: dir, now: NOW });
}
const passes = (dir, entries, call, why) => assert.strictEqual(decide(dir, entries, call), '', why || JSON.stringify(entries));
const blocks = (dir, entries, call, why) => {
  const r = decide(dir, entries, call);
  assert.notStrictEqual(r, '', why || JSON.stringify(entries));
  assert.match(r, /^Blocked/);
  assert.doesNotMatch(r, /Purpose/, 'no Purpose lines are ever asked for');
  return r;
};

test('a clear order runs the step: no Purpose lines, no pin, no second question, for each kind of action', () => {
  const dir = scratch();
  const cases = [
    ['send the mail to anna@example.com', MAIL_ANNA],
    ['trash the mail thread from the spammer', mcp('mcp__Gmail__trash_thread', { threadId: 't1' })],
    ['post the summary on Slack in C0CC8QCFVJQ', SLACK],
    ['share the Drive file with Anna', mcp('mcp__Google_Drive__share_file', { fileId: 'f', role: 'reader', emailAddress: 'anna@example.com' })],
    ['update the doc with the new prices', mcp('mcp__Google_Docs__update_doc', { documentId: 'd', requests: [] })],
    ['update the sheet with the October numbers', mcp('mcp__Google_Sheets__update_values', { spreadsheetId: 'x', range: 'A1', values: [[1]] })],
    ['book the meeting with Anna on Monday at 10', mcp('mcp__Google_Calendar__create_event', { summary: 'Anna' })],
    ['cancel the meeting with Anna', mcp('mcp__Google_Calendar__delete_event', { eventId: 'ev1' })],
    ['1) Cancel the meeting with Anna', mcp('mcp__Google_Calendar__delete_event', { eventId: 'ev1' })],
    ['merge Test-Kokonut/kokonut-rules#19', MERGE_19],
    ['approve Test-Kokonut/kokonut-rules#19 with a review', REVIEW_19],
    ['comment on Test-Kokonut/kokonut-rules#19 that it looks good', COMMENT_19],
    ['fork the repo Test-Kokonut/kokonut-rules', mcp('mcp__github__fork_repository', { owner: 'Test-Kokonut', repo: 'kokonut-rules' })],
    ['set up the scheduled task Daily chat score for 07:40', mcp('mcp__claude-code-remote__create_trigger', { name: 'Daily chat score' })],
    ['delete the scheduled task Daily chat score', mcp('mcp__claude-code-remote__delete_trigger', { trigger_id: 't' })],
    ['run the scheduled task Daily chat score now', mcp('mcp__claude-code-remote__fire_trigger', { trigger_id: 't' })],
    ['use the Upwork connector to look up the fees', mcp('mcp__Upwork__upwork__search_help_center', { query: 'fees' })],
    ['delete the old page', { tool_name: 'Artifact', tool_input: { action: 'delete', url: 'https://claude.ai/artifact/x' } }],
    ['clean the build folder', bash('rm -rf build')],
    ['delete the old branches', bash('git push origin --delete old')],
    ['force push the branch', bash('git push --force origin claude/x')],
    ['merge Test-Kokonut/kokonut-rules#12', bash('gh pr merge 12 --repo Test-Kokonut/kokonut-rules')],
    ['deploy the api now', DEPLOY],
    ['Stop the daily job', bash('gcloud scheduler jobs pause daily')],
    ['add the rows with gcloud sql', bash('gcloud sql instances execute-sql db --sql="INSERT INTO t VALUES (1)"')],
    ['remove the bigquery table ds.old', bash('bq rm -f -t ds.old')],
    ['update the jobs table in the database', bash("psql -c 'UPDATE jobs SET x=1'")],
    ['save the status page', bash('node /home/user/kokonut-status/scripts/status.js save page f --base 1')],
  ];
  for (const [said, call] of cases) passes(dir, [george(said)], call, said);
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'save the status page\n', 'the order is saved as the last approved scope');
  passes(dir, [george('deploy the api now'), reply('On it.'), toolResult()], DEPLOY, 'his order stays the last message through the turn');
  passes(dir, [george('Today:\n- mail Anna at anna@example.com\n- deploy the api')], DEPLOY, 'a list under a line that does not say no');
  passes(dir, [george('Today:\n- mail Anna at anna@example.com\n- deploy the api')], MAIL_ANNA);
});

test('an order covers only its kind: a comment is no merge, a move is no deletion, an update is no run', () => {
  const dir = scratch();
  blocks(dir, [george('comment on Test-Kokonut/kokonut-rules#19 that it looks good')], MERGE_19);
  blocks(dir, [george('comment on Test-Kokonut/kokonut-rules#19 that it looks good')], REVIEW_19);
  blocks(dir, [george("Review pull request #19. Report any issues. Don't merge yet.")], MERGE_19);
  blocks(dir, [george("Review pull request #19. Report any issues. Don't merge yet.")], REVIEW_19, 'a short message with a no in it orders nothing: the gate asks once');
  blocks(dir, [george('Review pull request #19 and report any issues.')], MERGE_19);
  passes(dir, [george('Review pull request #19 and report any issues.')], REVIEW_19, 'the review itself is ordered');
  blocks(dir, [george('move the calendar event ev123 to 10:00')], mcp('mcp__Google_Calendar__delete_event', { eventId: 'ev123' }));
  passes(dir, [george('move the calendar event ev123 to 10:00')], mcp('mcp__Google_Calendar__update_event', { eventId: 'ev123' }));
  blocks(dir, [george('update the scheduled task Daily chat score to 8:00')], mcp('mcp__claude-code-remote__delete_trigger', { trigger_id: 't' }));
  blocks(dir, [george('update the scheduled task Daily chat score to 8:00')], mcp('mcp__claude-code-remote__fire_trigger', { trigger_id: 't' }));
  passes(dir, [george('update the scheduled task Daily chat score to 8:00')], mcp('mcp__claude-code-remote__update_trigger', { trigger_id: 't' }));
});

test('his yes passes only the kinds of action the "I will:" line of the reply right before it names', () => {
  const dir = scratch();
  passes(dir, [george('fix it'), reply('I will: deploy api. Yes?'), george('yes'), toolResult()], DEPLOY);
  blocks(dir, [george('fix it'), reply('I will: deploy api. Yes?'), george('yes'), toolResult()], SLACK, 'the line names no Slack');
  passes(dir, [reply(WILL_ANNA), george('yes')], MAIL_ANNA);
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'send the mail to anna@example.com\n', 'the line is saved as the last approved scope');
  blocks(dir, [reply(WILL_ANNA), george('yes')], MERGE_19, 'the line names no merge');
  passes(dir, [reply('I will: push the new build live (deploying).'), george('go')], DEPLOY, 'the label names it');
  passes(dir, [reply('I will: deploy api.'), reply('Ready?'), george('yes')], DEPLOY, 'texts of one reply, with nothing between');
  blocks(dir, [reply('I will: deploy api.'), toolResult(), reply('Ready?'), george('yes')], DEPLOY, 'a line before a tool result is not the reply he answered');
  blocks(dir, [reply('I will: merge Test-Kokonut/kokonut-rules#19. Ok?'), george('<task-notification>helper done</task-notification>'),
    reply('The helper found 3 failing tests. Fix them first?'), george('yes')], MERGE_19, 'a line before an injected entry is not the reply he answered');
  const r = blocks(dir, [reply('✅ Sure.'), george('yes')], MAIL_ANNA, 'no "I will:" line');
  assert.match(r, /^Blocked \(sending mail\): George's last message /);
  assert.match(r, ASK);
  blocks(dir, [reply('👉 Shall I check the lock on kokonut-cookies?'), george('yes')], MAIL_ANNA, 'a yes to an unrelated question');
  blocks(dir, [reply('👉 I will: check the lock on kokonut-cookies.'), george('yes')], MERGE_19, 'a yes to another step');
  blocks(dir, [reply(WILL_ANNA), george('ok'), reply('✅ Sent.'), george('yes')], MAIL_ANNA, 'a yes to a later reply with no line');
  blocks(dir, [reply(WILL_ANNA), george('thanks'), george('yes')], MAIL_ANNA, 'the yes answers no reply');
  blocks(dir, [george('yes')], MAIL_ANNA, 'a yes as the first message');
});

test('the "I will:" line in every usual form: an icon, bold around or inside, a number, the steps as a list under it', () => {
  const dir = scratch();
  for (const line of ['👉 **I will**: deploy api.', '**I will:** deploy api.', '1. I will: deploy api.', '→ I will: deploy api.', '👉🏽 I will: deploy api',
    '- I will : deploy api.', 'i will: deploy api']) passes(dir, [reply(line), george('yes')], DEPLOY, line);
  passes(dir, [reply('I will:\n- deploy api\n- send the mail to anna@example.com'), george('yes')], DEPLOY, 'a list under a bare line');
  passes(dir, [reply('I will:\n- deploy api\n- send the mail to anna@example.com'), george('yes')], MAIL_ANNA);
  passes(dir, [reply('👉 I will deploy the api and everything with it. **Yes?**'), george('yes')], DEPLOY, 'no colon: the line all the same when it asks');
  blocks(dir, [reply('⚠️ The api deploy failed last night.\nI will look at the logs and report back; the deploy stays as it is.\n👉 Shall I open the ticket?'), george('yes')], DEPLOY,
    'no colon and no question on the line: a sentence of the reply, not the line');
  passes(dir, [reply('I will: update the doc.\nI will: delete the scheduled task Daily.'), george('yes')], mcp('mcp__claude-code-remote__delete_trigger', { trigger_id: 't' }), 'each line on its own');
  const stopHook = { type: 'system', subtype: 'stop_hook_summary', content: 'x' };
  const queue = { type: 'queue-operation', operation: 'dequeue' };
  passes(dir, [reply('I will: deploy api.'), stopHook, queue, george('yes')], DEPLOY, "the app's own entries between the reply and his yes are passed over");
  blocks(dir, [reply('I will not deploy api yet.'), george('yes')], DEPLOY, 'a line that says no names nothing');
  blocks(dir, [reply('I will not deploy api today. Shall I open the ticket?'), george('yes')], DEPLOY, 'a sentence that says no names nothing');
  passes(dir, [reply('👉 I will delete the whole work folder: work, build inside it, and a.txt, which is empty. Nothing else is in it. Yes?'), george('yes')],
    bash('rm -r work'), 'a no in another sentence of the line does not void the first');
  blocks(dir, [reply('I will: deploy api, not web.'), george('yes')], DEPLOY, 'a line that says no names nothing, colon or not');
  blocks(dir, [reply('Later I will deploy api.'), george('yes')], DEPLOY, 'not at the start of a line: not the line');
});

test('questions approve nothing: not as an order, not as a yes, with any question mark', () => {
  const dir = scratch();
  for (const said of ['send it?', 'send the mail to anna@example.com?', 'yes?', 'ok, send it?', 'ok, send it？']) blocks(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA, said);
  blocks(dir, [george('should I merge Test-Kokonut/kokonut-rules#19?')], MERGE_19);
  blocks(dir, [george('deploy the api now?')], DEPLOY);
  blocks(dir, [george('deploy the api now？')], DEPLOY, 'a full-width question mark');
  blocks(dir, [george('what is in the build folder?')], bash('rm -rf build'));
});

test('refusals approve nothing, in every spelling, after a yes word, and over a list; the sentences that order still do', () => {
  const dir = scratch();
  for (const said of ['no', 'not yet', "don't send it", 'no, wrong address', 'stop', 'wait', 'cancel it', 'hold on', 'ok, cancel that', 'yes, stop',
    'ok, hold on', 'ok, never mind', 'ok, later', 'sure, skip it', 'yes, nevermind']) blocks(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA, said);
  for (const said of ["don't send the mail to anna@example.com", 'do not send the mail to anna@example.com', 'never send the mail to anna@example.com',
    'no need to send the mail to anna@example.com', 'Never, ever send the mail to anna@example.com',
    'Do not, under any circumstances, send the mail to anna@example.com', 'Do not, under any circumstances,\nsend the mail to anna@example.com',
    'dont send the mail to anna@example.com', 'don`t send the mail to anna@example.com', 'don’t send the mail to anna@example.com',
    'you cannot send the mail to anna@example.com', 'nope, send the mail to anna@example.com', 'skip the mail to anna@example.com',
    'send nothing by mail to anna@example.com', 'n\u200Bo, send the mail to anna@example.com', 'hold the mail to anna@example.com',
    'everything except the mail to anna@example.com']) blocks(dir, [george(said)], MAIL_ANNA, said);
  for (const said of ['Never:\n- mail Anna at anna@example.com\n- deploy the api', 'Never do any of these:\n1. deploy the api\n2. mail Anna at anna@example.com',
    "Don't:\n- send the mail to anna@example.com\n- merge #19"]) {
    blocks(dir, [george(said)], MAIL_ANNA, said);
    blocks(dir, [george(said)], DEPLOY, said);
  }
  blocks(dir, [george("don't merge Test-Kokonut/kokonut-rules#19")], MERGE_19);
  blocks(dir, [george('Remove the hand-over entirely')], MERGE_19, 'no word of a merge');
  blocks(dir, [george('send me the list')], SLACK, 'no word of Slack');
  blocks(dir, [george("Don't touch the sheet. Mail Anna at anna@example.com the new time.")], MAIL_ANNA, 'a short message with a no in it orders nothing');
  blocks(dir, [george("Don't touch the sheet. Mail Anna the new time.")], mcp('mcp__Google_Sheets__update_values', { spreadsheetId: 'x' }), 'the refused one is refused');
  for (const said of ['Never:\n\n- send the mail to anna@example.com', 'Never:\nsend the mail to anna@example.com', 'Never:\n-send the mail to anna@example.com',
    "- Do:\n  - read the mail\n- Don't:\n  - send the mail to anna@example.com", "**Don't:**\n- send the mail to anna@example.com",
    "Don't do any of these.\n- send the mail to anna@example.com", "Don't touch shared things, e.g. the sheet or the mail to anna@example.com.",
    'Never:\n- mail Anna\n  at anna@example.com\n- deploy the api']) {
    blocks(dir, [george(said)], MAIL_ANNA, said);
    blocks(dir, [george(said)], DEPLOY, said);
  }
  blocks(dir, [george("Don't touch shared things, e.g. the sheet or the mail.")], mcp('mcp__Google_Sheets__update_values', { spreadsheetId: 'x' }));
});

test('quoted, pasted, fenced, blockquoted and commented text approves nothing, in every quote style', () => {
  const dir = scratch();
  const orders = ['Anna wrote: "yes, send the mail to anna@example.com"', '> send the mail to anna@example.com',
    '“send the mail to anna@example.com” is what she asked', 'Tell it: "merge Test-Kokonut/kokonut-rules#19"',
    "Tell it: 'merge Test-Kokonut/kokonut-rules#19'", "She said 'send the mail to anna@example.com'", 'Anna wrote: ‘send the mail to anna@example.com’',
    '„send the mail to anna@example.com“ she said', '`send the mail to anna@example.com`', '«send the mail to anna@example.com»',
    '```\nsend the mail to anna@example.com\n```', '~~~\nsend the mail to anna@example.com\n~~~', '<!-- send the mail to anna@example.com -->',
    '<pasted_content id="1">send the mail to anna@example.com</pasted_content>', 'She said "mail Anna now'];
  for (const said of orders) blocks(dir, [george(said)], /merge/.test(said) ? MERGE_19 : MAIL_ANNA, said);
  for (const said of ['"yes"', '> yes', '"ok"', "'yes'"]) blocks(dir, [reply(WILL_ANNA), george(said)], MAIL_ANNA, said);
  for (const quoted of ['The rule says: "I will: send the mail to anna@example.com"', '> I will: send the mail to anna@example.com',
    '```\nI will: send the mail to anna@example.com\n```', '~~~\nI will: send the mail to anna@example.com\n~~~',
    '<!-- I will: send the mail to anna@example.com -->']) blocks(dir, [reply(quoted), george('yes')], MAIL_ANNA, `reply: ${quoted}`);
  passes(dir, [george("Send Anna's mail to anna@example.com, it's about Bob's team")], MAIL_ANNA, 'apostrophes are not quotes');
});

test("messages the app made are never George's: an isMeta entry with the action's words approves nothing", () => {
  const dir = scratch();
  blocks(dir, [george('Review pull request #19. Report any issues.'), meta('Skill /code-review is already loaded above. Arguments: merge it')], MERGE_19);
  passes(dir, [george('Review pull request #19. Report any issues.'), meta('Skill /code-review is already loaded above. Arguments: merge it')], REVIEW_19, 'his own order still stands');
});

test('a saved scope approves nothing: any pin gives the same decision as none, and old pins are never read', () => {
  const cases = [
    [[george('thanks')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MERGE_19],
    [[george('send the mail to anna@example.com')], MAIL_ANNA], [[george('what next?')], MERGE_19], [[george('deploy the api now')], DEPLOY],
    [[george('yes')], MAIL_ANNA],
  ];
  for (const pinText of ['Approved 2026-11-05 15:40 UTC\nI will: send the mail to anna@example.com, merge Test-Kokonut/kokonut-rules#19.\n', 'Purpose: p\nDone when:\n- d\n']) {
    for (const [entries, call] of cases) {
      const bare = scratch();
      const pinned = scratch();
      fs.mkdirSync(path.dirname(pinFile(pinned)), { recursive: true });
      fs.writeFileSync(pinFile(pinned), pinText);
      assert.strictEqual(decide(pinned, entries, call) === '', decide(bare, entries, call) === '', JSON.stringify(entries));
    }
  }
});

test('the saved scope is the whole order, written once for the turn', () => {
  const dir = scratch();
  const file = transcript(dir, 'o.jsonl', [george('Mail Anna at anna@example.com the new time. Then post it on Slack in C0CC8QCFVJQ.')]);
  for (const call of [MAIL_ANNA, SLACK, MAIL_ANNA, SLACK]) assert.strictEqual(refused(Object.assign({ transcript_path: file }, call), { home: dir, now: NOW }), '');
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'Mail Anna at anna@example.com the new time Then post it on Slack in C0CC8QCFVJQ\n');
  const file2 = transcript(dir, 'o2.jsonl', [george('Thanks for the check, all clear. Deploy the api now. Tell me when it is live.')]);
  assert.strictEqual(refused(Object.assign({ transcript_path: file2 }, DEPLOY), { home: dir, now: NOW }), '');
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), STAMP + 'Deploy the api now\n', 'only the sentence that orders is kept');
});

test("a helper is judged by the chat's transcript: George's order or yes there lets its blocked call pass", () => {
  const dir = scratch();
  transcript(dir, 'sess-1.jsonl', [reply('I will: deploy api.'), george('go')]);
  const helper = transcript(dir, 'agent-2.jsonl', [george('Brief: deploy api and report back')]);
  const input = Object.assign({ transcript_path: helper, agent_id: 'a2', session_id: 'sess-1' }, DEPLOY);
  assert.strictEqual(refused(input, { home: dir }), '');
  transcript(dir, 'sess-1.jsonl', [reply('I will: deploy api.'), george('go'), reply('done'), george('what did it cost?')]);
  assert.match(refused(input, { home: dir }), /neither orders it nor says yes/);
});

test('any error refuses: a call the gate cannot read, a transcript it cannot read, input the hook cannot parse, a sibling that fails to load', () => {
  const dir = scratch();
  const boom = { get command() { throw new Error('boom'); } };
  assert.match(decide(dir, [george('deploy the api now')], { tool_name: 'Bash', tool_input: boom }), /^Blocked: the gate could not check this call \(boom\)\. Nothing ran\.$/);
  assert.match(refused(null), /^Blocked: the gate got no tool call/);
  assert.match(refused({ tool_input: {} }), /^Blocked: the gate got no tool call/);
  assert.match(refused(Object.assign({ transcript_path: path.join(dir, 'missing.jsonl') }, DEPLOY), { home: dir }), /could not check this call \(the chat's transcript cannot be read\)/);
  assert.match(refused(Object.assign({ transcript_path: dir }, DEPLOY), { home: dir }), /transcript cannot be read/, 'a folder as the transcript');
  const env = { HOME: dir, USERPROFILE: dir };
  for (const raw of ['{broken', '', 'null', '0', '[]', '"x"']) {
    const r = runHook(HOOK, raw, env);
    assert.strictEqual(r.status, 0, raw);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /could not read the tool call/, raw);
  }
  const copy = scratch();
  for (const f of ['yes-gate.js', 'purpose.js', 'no-main.js']) fs.copyFileSync(path.join(ROOT, '.claude', 'hooks', f), path.join(copy, f));
  fs.writeFileSync(path.join(copy, 'transcript.js'), 'this is not a module (');
  const broken = runHook(path.join(copy, 'yes-gate.js'), Object.assign({ transcript_path: transcript(dir, 'b.jsonl', [george('deploy the api now')]) }, DEPLOY), env);
  assert.strictEqual(broken.status, 0, broken.stderr);
  assert.match(JSON.parse(broken.stdout).hookSpecificOutput.permissionDecisionReason, /^Blocked: the gate failed \(/);
});

// A standing prompt (a scheduled task's) arrives as a message in George's name: the gate reads it as his, and it
// passes the kind of step a sentence of it orders without saying no. The permission it carries is the one he gave
// when he set the task up; the gate cannot check that. The real prompts are replayed outside the tests (they hold
// private ids): see the pull request.
test("a standing prompt passes the kind of step it orders in a sentence that says no 'no', and nothing else", () => {
  const dir = scratch();
  const short = 'Weekly run George set on 26 Oct. He approved posting this one summary to the channel, so post it without asking.\n' +
    '1. Run exactly one search. Never list, search, open or read any other email.\n' +
    '3. Slack: read the last 20 messages of C0CC8QCFVJQ (last week\'s summary).\n' +
    '5. Post ONE message to C0CC8QCFVJQ. Super plain, brief and clear.\n' +
    '6. Change nothing else: no archiving, labels, deleting or replies; nothing in Google Cloud or any repo.';
  const prompt = short + '\n7. Then, for each item, note its date and its source, and keep the wording of the source.'.repeat(12);
  assert.ok(prompt.split(/\s+/).length > 150 && short.split(/\s+/).length <= 150);
  blocks(dir, [george(short)], SLACK, 'a message of up to 150 words that says no anywhere orders nothing');
  passes(dir, [george(prompt)], SLACK, 'a longer one is read sentence by sentence');
  blocks(dir, [george(prompt)], DEPLOY, 'no sentence orders a deploy');
  blocks(dir, [george(prompt)], bash('gcloud sql instances patch x'), 'the only sentence naming Google Cloud says nothing');
  blocks(dir, [george(prompt)], { tool_name: 'Artifact', tool_input: { action: 'delete', url: 'https://claude.ai/artifact/x' } }, 'the only such sentence says no');
  blocks(dir, [george(prompt + '\nAnything unclear? Ask.')], SLACK, 'a prompt with a question mark is a question, as any message');
});

test('the gate never allows what the word rule of 5 Nov 2026 blocked: a yes, or the action\'s word with no question mark', () => {
  // The rule in use before this change, with its Purpose pin in place: George's last message is a yes, or holds the
  // action's word and no question mark. The new gate must never allow what that one blocked, only narrow it.
  const { isYes } = require('../.claude/hooks/transcript.js');
  const lastText = (entries) => entries.filter((e) => typeof e.message.content === 'string' && !e.isMeta).map((e) => e.message.content).pop() || '';
  const wordRule = (label, last) => isYes(last) || (!last.includes('?') && Boolean(ORDER[label] && ORDER[label].test(last)));
  const cases = [
    [[george('deploy the api now')], DEPLOY], [[george('send the mail to anna@example.com')], MAIL_ANNA], [[george('clean the build folder')], bash('rm -rf build')],
    [[reply('I will: deploy api.'), george('yes')], DEPLOY], [[reply(WILL_ANNA), george('yes')], MAIL_ANNA], [[reply(WILL_ANNA), george('yes')], MERGE_19],
    [[reply('✅ Sure.'), george('yes')], MAIL_ANNA], [[george('yes')], MAIL_ANNA], [[george('send it?')], MAIL_ANNA], [[george("don't send the mail to anna@example.com")], MAIL_ANNA],
    [[george('Tell it: "merge Test-Kokonut/kokonut-rules#19"')], MERGE_19], [[george('> send the mail to anna@example.com')], MAIL_ANNA],
    [[george('Remove the hand-over entirely')], MERGE_19], [[george('thanks')], MAIL_ANNA], [[george("Don't touch the sheet. Mail Anna the new time.")], MAIL_ANNA],
    [[george('Never:\n- mail Anna\n- deploy the api')], DEPLOY], [[reply(WILL_ANNA), george('ok, cancel that')], MAIL_ANNA],
  ];
  const stricter = [];
  for (const [entries, call] of cases) {
    const dir = scratch();
    const now = decide(dir, entries, call) === '';
    const before = wordRule(classify(call.tool_name, call.tool_input), lastText(entries));
    assert.ok(!now || before, `newly allowed, never allowed before: ${JSON.stringify(entries)}`);
    if (before && !now) stricter.push(lastText(entries));
  }
  for (const s of ['yes', "don't send the mail to anna@example.com", 'Tell it: "merge Test-Kokonut/kokonut-rules#19"', '> send the mail to anna@example.com']) {
    assert.ok(stricter.includes(s), `stricter now: ${s}`);
  }
});

// The gate's known limits, written out so that nobody reads it as proof of approval. Each is a decision rule 12
// leaves to the chat, or a gap that exists today; none is a bug a later change silently "fixes" into a wider gate.
test('known limits, written out: targets, repeats, untagged pastes, bracketed messages, word senses, command forms and tools it does not read', () => {
  const dir = scratch();
  passes(dir, [george('Mail Anna at anna@example.com the new time.')], MAIL_BOB, 'which recipient: not read; the chat keeps to what the order named');
  passes(dir, [george('deploy the api now')], bash('gcloud run deploy web --project other'), 'which service or project: not read');
  passes(dir, [george('check the mail from anna@example.com and tell me what she wants')], MAIL_ANNA, 'an order\'s word in another sense');
  passes(dir, [george('1. Gmail: run exactly one search.\n5. Post the summary on Slack.')], MAIL_ANNA, 'a sentence that names mail for reading passes a send');
  passes(dir, [reply(WILL_ANNA), george('yes')], MAIL_ANNA);
  passes(dir, [reply(WILL_ANNA), george('yes')], MAIL_ANNA, 'a repeat in the same turn: not told from a retry');
  passes(dir, [george('GitHub\nMerge pull request Test-Kokonut/kokonut-rules#19 from claude/x\nView it on GitHub')], MERGE_19, 'an untagged paste is read as his message (rule 13 is the chat\'s)');
  passes(dir, [george('deploy the api now'), reply('Deploying.'), george('[note] stop, do not deploy')], DEPLOY, 'a message of his that starts with [ is passed over as the cloud\'s');
  blocks(dir, [george('Merge Test-Kokonut/kokonut-rules#19 and wait for the checks.')], MERGE_19, 'a no-word in an order: the gate asks once');
  blocks(dir, [george('Mail Anna at anna@example.com the new time, no cc')], MAIL_ANNA, 'a no anywhere in a message of up to 150 words: the gate asks once');
  blocks(dir, [george('Deploy the api now. Then wait for the checks.')], DEPLOY, 'the same, in another sentence');
  passes(dir, [george('Cancel the mail to anna@example.com')], MAIL_ANNA, '"cancel" opening a sentence is read as an order');
  for (const command of ['git -C /home/user/x push --force origin main', 'bash -c "rm -rf /home/user/x"', 'git clean -fdx', 'gcloud --project p run deploy api']) {
    assert.strictEqual(classify('Bash', { command }), '', `a command form the gate does not read: ${command}`);
  }
  assert.strictEqual(classify('mcp__Webflow__data_pages_tool', {}), '', 'a connector tool not on its list');
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
  const order = transcript(dir, 'o.jsonl', [george('post it on Slack in C0CC8QCFVJQ')]);
  const ok = runHook(HOOK, Object.assign({ transcript_path: order, session_id: 'o' }, SLACK), env);
  assert.strictEqual(ok.stdout, '');
});
