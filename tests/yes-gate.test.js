'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, scratch, cleanup, runHook } = require('./sandbox');
const { classify, refused } = require('../.claude/hooks/yes-gate.js');
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

test('nothing pinned and no reply with the lines: a blocked call is refused with the pin line, whatever George said', () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [george('yes'), reply('✅ Sure.')]);
  const r = refused(Object.assign({ transcript_path: file }, mcp('mcp__Gmail__send_message')), { home: dir });
  assert.match(r, /^Blocked \(sending mail\): no Purpose and Done when yet\./);
  assert.ok(!fs.existsSync(pinFile(dir)));
  assert.strictEqual(refused(Object.assign({ transcript_path: file }, bash('git status')), { home: dir }), '', 'a read is never refused');
});

test('nothing pinned, the current reply holds the lines: pinned on the spot, and the call goes on', () => {
  const dir = scratch();
  const file = transcript(dir, 's.jsonl', [george('mail Anna the new time'), reply('Purpose: Anna has the new time.\nDone when:\n- the mail is sent')]);
  assert.strictEqual(refused(Object.assign({ transcript_path: file }, mcp('mcp__Gmail__send_message')), { home: dir }), '');
  assert.strictEqual(fs.readFileSync(pinFile(dir), 'utf8'), 'Purpose: Anna has the new time.\nDone when:\n- the mail is sent\n');
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

test("pinned, George's last message a yes: the call passes; not a yes: refused with the ask line", () => {
  const dir = scratch();
  pin(dir);
  const yes = transcript(dir, 'yes.jsonl', [george('fix it'), reply('I will: deploy api. Yes?'), george('yes'), toolResult()]);
  assert.strictEqual(refused(Object.assign({ transcript_path: yes }, bash('gcloud run deploy api')), { home: dir }), '');
  const no = transcript(dir, 'no.jsonl', [george('yes'), reply('✅ Deployed.'), george('now delete the old branch too?')]);
  const r = refused(Object.assign({ transcript_path: no }, bash('git push origin --delete old')), { home: dir });
  assert.strictEqual(r, 'Blocked (deleting a branch on GitHub): George\'s last message neither orders it nor says yes. Reply one line, "I will: <what, where>", and wait.');
  const order = transcript(dir, 'order.jsonl', [george('Remove the hand-over entirely')]);
  assert.match(refused(Object.assign({ transcript_path: order }, mcp('mcp__github__merge_pull_request')), { home: dir }), /neither orders it nor says yes/);
});

test("a helper is judged by the chat's transcript: George's yes there lets its blocked call pass", () => {
  const dir = scratch();
  pin(dir);
  transcript(dir, 'sess-1.jsonl', [george('go')]);
  const helper = transcript(dir, 'agent-2.jsonl', [george('Brief: deploy api and report back')]);
  const input = Object.assign({ transcript_path: helper, agent_id: 'a2', session_id: 'sess-1' }, bash('gcloud run deploy api'));
  assert.strictEqual(refused(input, { home: dir }), '');
  transcript(dir, 'sess-1.jsonl', [george('go'), reply('done'), george('what did it cost?')]);
  assert.match(refused(input, { home: dir }), /neither orders it nor says yes/);
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
