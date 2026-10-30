'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sandbox');

const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const { allow, ask, deny } = settings.permissions;
const both = (server, tools) => tools.flatMap((t) => [`mcp__${server}__${t}`, `mcp__claude_ai_${server}__${t}`]);
// Google's write commands: they ask first, though "Bash(gcloud:*)" and "Bash(bq:*)" allow the rest (Claude Code
// reads deny, then ask, then allow).
const GOOGLE_WRITES = ['Bash(gcloud run deploy:*)', 'Bash(gcloud run services update:*)', 'Bash(gcloud run services delete:*)',
  'Bash(gcloud run jobs execute:*)', 'Bash(gcloud builds submit:*)', 'Bash(gcloud builds triggers run:*)', 'Bash(gcloud sql:*)',
  'Bash(gcloud secrets:*)', 'Bash(gcloud iam:*)', 'Bash(gcloud projects:*)', 'Bash(gcloud scheduler jobs run:*)',
  'Bash(gcloud scheduler jobs delete:*)', 'Bash(gcloud scheduler jobs pause:*)',
  'Bash(bq rm:*)', 'Bash(bq load:*)', 'Bash(bq mk:*)', 'Bash(bq update:*)'];

test('allow: the routine commands, the web (WebFetch, WebSearch, curl), every Drive, Gmail, Slack and Calendar tool in both spellings, Agent and Task', () => {
  const want = ['Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git fetch:*)', 'Bash(git switch:*)',
    'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push -u origin:*)', 'Bash(node:*)', 'Bash(cp:*)',
    'Bash(gcloud:*)', 'Bash(bq:*)', 'WebFetch', 'WebSearch', 'Bash(curl:*)', 'Agent', 'Task'];
  for (const server of ['Google_Drive', 'Gmail', 'Slack', 'Google_Calendar']) want.push(`mcp__${server}__*`, `mcp__claude_ai_${server}__*`);
  for (const w of want) assert.ok(allow.includes(w), w);
});

test('ask: sending, binning, sharing, deleting, the Upwork connector, workflows and artifacts, each named', () => {
  const want = [
    ...both('Gmail', ['send_message', 'reply', 'forward', 'trash_message', 'trash_thread', 'delete_draft', 'delete_label',
      'mark_message_spam', 'mark_thread_spam']),
    ...both('Google_Drive', ['trash_file', 'share_file']),
    ...both('Slack', ['slack_send_message', 'slack_schedule_message', 'slack_send_message_draft', 'slack_create_conversation']),
    'mcp__claude_ai_Upwork', 'mcp__Upwork', 'Workflow', 'Artifact',
    'Bash(git branch -D:*)', 'Bash(git branch -d:*)', 'Bash(git push --delete:*)', 'Bash(git push -d:*)',
    'Bash(rm -r:*)', 'Bash(rm -rf:*)', 'PowerShell(Remove-Item:*)', 'PowerShell(git branch -D:*)',
  ];
  for (const w of want) assert.ok(ask.includes(w), w);
  for (const a of ask) assert.ok(!allow.includes(a), `${a} is on both lists`);
});

test("ask: Google's write commands, as prefix rules under the gcloud and bq the allow list lets through", () => {
  for (const w of GOOGLE_WRITES) {
    assert.ok(ask.includes(w), w);
    assert.ok(allow.includes(w.startsWith('Bash(bq ') ? 'Bash(bq:*)' : 'Bash(gcloud:*)'), `${w} narrows an allow rule`);
  }
});

test("deny: the GitHub connector's write tools, which write to any branch past the push guard", () => {
  assert.deepStrictEqual(deny, ['mcp__github__push_files', 'mcp__github__create_or_update_file', 'mcp__github__delete_file']);
  for (const d of deny) assert.ok(!allow.includes(d) && !ask.includes(d), `${d} is on another list too`);
  assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'Bash|PowerShell', 'the push guard sees only shell commands');
});

test('hooks: session start; reminder, then status note; no-main, guard, then rule-guard on shell commands; rule-guard on edits; no Stop hook; every hook file present, every hook file used', () => {
  assert.strictEqual(settings.disableWorkflows, true);
  const hooks = settings.hooks;
  const file = (h) => /\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/(.+?)"/.exec(h.command)[1];
  const shape = (event) => hooks[event].map((g) => ({ matcher: g.matcher, hooks: g.hooks.map((h) => [file(h), h.timeout]) }));
  assert.deepStrictEqual(shape('SessionStart'), [{ matcher: undefined, hooks: [['session-start.js', 60]] }]);
  assert.deepStrictEqual(shape('UserPromptSubmit'), [{ matcher: undefined, hooks: [['reminder.js', 10], ['status-check.js', 10]] }]);
  assert.deepStrictEqual(shape('PreToolUse'), [
    { matcher: 'Bash|PowerShell', hooks: [['no-main.js', 10], ['guard.js', 20], ['rule-guard.js', 30]] },
    { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [['rule-guard.js', 30]] },
  ]);
  assert.deepStrictEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse'], 'no Stop hook: the push check is gone, the status check is a note');
  const used = [];
  for (const event of Object.keys(hooks)) {
    for (const group of hooks[event]) {
      for (const h of group.hooks) {
        assert.strictEqual(h.type, 'command');
        assert.strictEqual(h.command, `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${file(h)}"`);
        assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'hooks', file(h))), file(h));
        used.push('.claude/hooks/' + file(h));
      }
    }
  }
  const files = fs.readdirSync(path.join(ROOT, '.claude', 'hooks')).filter((f) => f.endsWith('.js')).map((f) => '.claude/hooks/' + f);
  assert.deepStrictEqual([...new Set(used)].sort(), files.sort());
  assert.ok(!fs.existsSync(path.join(ROOT, '.claude', 'hooks', 'push-check.js')), 'push-check.js is gone');
});

// Attaching a Test-Kokonut repo to a chat: the remote session tools of the attach (find the repo, check it, attach
// it, register the clone) and the clone the attach hands back. Without these rules the attach goes to the auto mode
// classifier, which refuses it as a permission grant ("[Permission Grant]"), and the chat cannot start in its
// system's repo.
const ATTACH = ['mcp__claude-code-remote__list_repos', 'mcp__claude-code-remote__check_repo_access',
  'mcp__claude-code-remote__add_repo', 'mcp__claude-code-remote__register_repo_root',
  'Bash(git clone https://github.com/Test-Kokonut/*)'];

test('allow: attaching and cloning a Test-Kokonut repo, each tool of the attach and the clone named', () => {
  for (const w of ATTACH) assert.ok(allow.includes(w), w);
  for (const w of ATTACH) assert.ok(!ask.includes(w) && !deny.includes(w), `${w} is on another list too`);
});
