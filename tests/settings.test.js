'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sandbox');
const { classify } = require('../.claude/hooks/yes-gate.js');

const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const { allow, ask, deny } = settings.permissions;

test('allow: the routine commands, the web (WebFetch, WebSearch, curl), every Drive, Gmail, Slack and Calendar tool in both spellings and Agent', () => {
  const want = ['Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git fetch:*)', 'Bash(git switch:*)',
    'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push -u origin:*)', 'Bash(node:*)', 'Bash(cp:*)',
    'Bash(gcloud:*)', 'Bash(bq:*)', 'WebFetch', 'WebSearch', 'Bash(curl:*)', 'Agent'];
  for (const server of ['Google_Drive', 'Gmail', 'Slack', 'Google_Calendar']) want.push(`mcp__${server}__*`, `mcp__claude_ai_${server}__*`);
  for (const w of want) assert.ok(allow.includes(w), w);
});

test('ask: nothing asks in the app; the gate (yes-gate.js) asks in chat for sending, binning, deploying and shared changes', () => {
  assert.deepStrictEqual(ask, []);
  const gated = ['Bash(gcloud run deploy api)', 'Bash(gcloud run services update api)', 'Bash(gcloud run services delete api)',
    'Bash(gcloud run jobs execute x)', 'Bash(gcloud builds submit .)', 'Bash(gcloud builds triggers run t)', 'Bash(gcloud sql x)',
    'Bash(gcloud secrets x)', 'Bash(gcloud iam x)', 'Bash(gcloud projects x)', 'Bash(gcloud scheduler jobs run x)',
    'Bash(gcloud scheduler jobs delete x)', 'Bash(gcloud scheduler jobs pause x)', 'Bash(bq rm x)', 'Bash(bq load x)', 'Bash(bq mk x)',
    'Bash(bq update x)', 'Bash(git branch -D x)', 'Bash(git branch -d x)', 'Bash(git push --delete origin x)', 'Bash(git push -d origin x)',
    'Bash(rm -r x)', 'Bash(rm -rf x)', 'PowerShell(Remove-Item x)',
    'mcp__Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__Gmail__forward', 'mcp__Gmail__trash_message', 'mcp__Gmail__trash_thread',
    'mcp__Gmail__delete_draft', 'mcp__Gmail__delete_label', 'mcp__Gmail__mark_message_spam', 'mcp__Gmail__mark_thread_spam',
    'mcp__Google_Drive__trash_file', 'mcp__claude_ai_Google_Drive__share_file', 'mcp__Slack__slack_send_message',
    'mcp__Slack__slack_schedule_message', 'mcp__Slack__slack_send_message_draft', 'mcp__Slack__slack_create_conversation',
    'mcp__Upwork__x', 'mcp__claude_ai_Upwork__x'];
  for (const g of gated) {
    const m = /^(Bash|PowerShell)\((.*)\)$/.exec(g);
    const label = m ? classify(m[1], { command: m[2] }) : classify(g, {});
    assert.ok(label, `${g} is not gated`);
  }
});

test("deny: the GitHub connector's write tools, which write to any branch past the push guard", () => {
  assert.deepStrictEqual(deny, ['mcp__github__push_files', 'mcp__github__create_or_update_file', 'mcp__github__delete_file']);
  for (const d of deny) assert.ok(!allow.includes(d) && !ask.includes(d), `${d} is on another list too`);
  assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'Bash|PowerShell', 'the push guard sees only shell commands');
});

test('hooks: session start; the pin on George\'s messages; no-main, guard, then the gate on shell commands; the gate on every connector and Artifact; nothing else; every hook file wired or required', () => {
  assert.strictEqual(settings.disableWorkflows, true);
  const hooks = settings.hooks;
  const file = (h) => /\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/(.+?)"/.exec(h.command)[1];
  const shape = (event) => hooks[event].map((g) => ({ matcher: g.matcher, hooks: g.hooks.map((h) => [file(h), h.timeout]) }));
  assert.deepStrictEqual(shape('SessionStart'), [{ matcher: undefined, hooks: [['session-start.js', 60]] }]);
  assert.deepStrictEqual(shape('UserPromptSubmit'), [{ matcher: undefined, hooks: [['purpose.js', 10]] }]);
  assert.deepStrictEqual(shape('PreToolUse'), [
    { matcher: 'Bash|PowerShell', hooks: [['no-main.js', 10], ['guard.js', 20], ['yes-gate.js', 10]] },
    { matcher: 'mcp__.*|Artifact', hooks: [['yes-gate.js', 10]] },
  ]);
  assert.deepStrictEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse'], 'no hook after a tool call and none at the stop');
  const used = new Set();
  for (const event of Object.keys(hooks)) {
    for (const group of hooks[event]) {
      for (const h of group.hooks) {
        assert.strictEqual(h.type, 'command');
        assert.strictEqual(h.command, `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${file(h)}"`);
        assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'hooks', file(h))), file(h));
        used.add(file(h));
      }
    }
  }
  const dir = path.join(ROOT, '.claude', 'hooks');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g)) used.add(m[1] + '.js');
  }
  assert.deepStrictEqual([...used].sort(), files.sort());
  assert.ok(!fs.existsSync(path.join(ROOT, '.claude', 'commands')) || fs.readdirSync(path.join(ROOT, '.claude', 'commands')).length === 0, 'no slash command is left');
});

// Attaching a Test-Kokonut repo to a chat: the remote session tools of the attach (find the repo, check it, attach
// it, register the clone) and the clone the attach hands back. Without these rules the attach goes to the auto mode
// classifier, which refuses it as a permission grant ("[Permission Grant]"), and the chat cannot start in its
// system's repo.
const ATTACH = ['mcp__claude-code-remote__list_repos',
  'mcp__claude-code-remote__add_repo', 'mcp__claude-code-remote__register_repo_root',
  'Bash(git clone https://github.com/Test-Kokonut/*)'];

test('allow: attaching and cloning a Test-Kokonut repo, each tool of the attach and the clone named', () => {
  for (const w of ATTACH) assert.ok(allow.includes(w), w);
  for (const w of ATTACH) assert.ok(!ask.includes(w) && !deny.includes(w), `${w} is on another list too`);
});
