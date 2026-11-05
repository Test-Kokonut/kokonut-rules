#!/usr/bin/env node
// yes-gate.js: refuses a tool call that sends, deletes, deploys or changes what others use, unless George's last
// message approves that action and its targets (rule 12 of the rulebook). It blocks nothing else: reading,
// answering, editing files, commits, pushing the chat's own branch, opening a pull request and helpers all pass.
// Written in kokonut-rules, run by the PreToolUse hook in .claude/settings.json on Bash|PowerShell (after no-main.js
// and guard.js) and on every connector tool (mcp__.*) and Artifact; installed machine-wide in a cloud chat by
// kokonut-rules' setup.sh.
// What is blocked (classify below): mail sent, binned or marked spam; Slack messages, canvases and lists; a Drive
// file binned, shared or changed in place; a Doc or Sheet changed; a calendar event; a GitHub merge, repo, issue or
// review; a chat started or archived, a scheduled task made, changed or fired; the Upwork connector; a page
// deleted; in a shell: rm -r (outside the temp folder), a branch deleted, a force push, gh pr merge, gcloud run
// deploy and the other Google Cloud writes, bq writes, SQL writes, a status page saved.
// What lets a blocked call pass: George's last message in the chat's transcript (a helper is judged by the chat's
// transcript, mainTranscript) orders that kind of action, or is his yes to an "I will:" line that names it. An
// order names the action with the action's own words (ORDER below: "mail" for a mail, "merge" for a merge, "sheet"
// for a Sheet, ...) in a sentence that does not say no (NEGATION); his yes (transcript.js isYes) answers the reply
// right before it, and that reply's "I will:" lines name the action by those words or by its label. A word match,
// nothing read into his words. A question is never an order; quoted, pasted, fenced or blockquoted text is not his.
// After that message, every call in the turn that it covers passes: his next message ends it. Any error while
// checking, the hook's own included, refuses.
// A backstop, not proof of approval. What it does not check, by design: which recipient, file, branch, table or
// project a call acts on (rule 12: the chat does only what the order named); a repeat of an approved step in the
// same turn; whether an untagged paste or a scheduled task's prompt is George's own message; commands in forms
// classify does not read (git -C, a shell inside a shell) and connector tools not in MCP.
// The pin (purpose.js's file) is never read here: a saved scope approves nothing. A call that passes has its
// approval written there (purpose.js recordApproval), so the chat sees the last thing he approved and when.
// Output on a refusal: {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
// "permissionDecisionReason": <one line>}}. Node only, no packages.
'use strict';
const os = require('os');
const path = require('path');
const { lastExchange, mainTranscript, isYes } = require('./transcript.js');
const { recordApproval } = require('./purpose.js');
const { words } = require('./no-main.js');

const MCP = [
  [/^mcp__Gmail__(?:send_message|reply|forward)$/, 'sending mail'],
  [/^mcp__Gmail__(?:trash_message|trash_thread|delete_draft|delete_label|mark_message_spam|mark_thread_spam)$/, 'binning mail'],
  [/^mcp__Slack__slack_(?:send_message|schedule_message|send_message_draft|create_conversation)$/, 'sending on Slack'],
  [/^mcp__Slack__slack_(?:create_canvas|update_canvas|create_list|update_list|add_list_record|update_list_record)$/, 'changing a shared Slack canvas or list'],
  [/^mcp__Google_Drive__trash_file$/, 'binning a Drive file'],
  [/^mcp__Google_Drive__share_file$/, 'sharing a Drive file'],
  [/^mcp__Google_Drive__update_file$/, 'changing a Drive file in place'],
  [/^mcp__Google_Docs__update_doc$/, 'changing a Doc'],
  [/^mcp__Google_Sheets__(?:update_values|append_values|batch_clear_values|insert_dimension|update_formulas|update_spreadsheet|copy_sheet_to_another_spreadsheet)$/, 'changing a Sheet'],
  [/^mcp__Google_Calendar__(?:create_event|update_event|delete_event|respond_to_event)$/, 'changing the calendar'],
  [/^mcp__github__(?:merge_pull_request|enable_pr_auto_merge|create_repository|fork_repository|issue_write|sub_issue_write|add_issue_comment|update_issue_comment|pull_request_review_write|add_reply_to_pull_request_comment|request_copilot_review)$/, 'a GitHub action others see'],
  [/^mcp__claude-code-remote__(?:create_session|archive_session|create_trigger|update_trigger|delete_trigger|fire_trigger)$/, 'starting or changing a chat or a scheduled task'],
  [/^mcp__Upwork/, 'the Upwork connector'],
];
// A shell pattern applies to a simple command whose command word is one of its programs: text in an echo or a grep
// is never a command. SQL writes are read in the whole command when psql, mysql or bq query runs in it.
const BASH = [
  [['git'], /^git\s+branch\s+(?:-[a-zA-Z]*[dD][a-zA-Z]*|--delete)\b/, 'deleting a branch'],
  [['git'], /^git\s+push\b.*?(?:\s--delete\b|\s-d\s|\s:[^\s:]+)/, 'deleting a branch on GitHub'],
  [['git'], /^git\s+push\b.*?\s(?:--force|-f|--force-with-lease)\b/, 'rewriting a branch on GitHub'],
  [['gh'], /^gh\s+pr\s+merge\b/, 'merging to main'],
  [['gcloud'], /^gcloud\s+run\s+(?:deploy|services\s+(?:update|delete)|jobs\s+(?:execute|update|delete|create))\b/, 'deploying'],
  [['gcloud'], /^gcloud\s+builds\s+(?:submit|triggers\s+run)\b/, 'deploying'],
  [['gcloud'], /^gcloud\s+scheduler\s+jobs\s+(?:run|delete|pause|resume|update|create)\b/, 'changing a schedule'],
  [['gcloud'], /^gcloud\s+(?:sql|secrets|iam|projects)\b/, 'changing Google Cloud'],
  [['bq'], /^bq\s+(?:rm|load|mk|update|insert|cp)\b/, 'changing BigQuery'],
  [['node'], /\bstatus\.js\s+(?:save|new|delete)\b/, 'changing a status page'],
  [['remove-item'], /^remove-item\b/i, 'deleting files'],
];
const SQL_WRITE = /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b/i;
// The words of George's message that name each blocked action: his order passes the gate when it holds one.
const ORDER = {
  'sending mail': /\b(?:mail|email|gmail)\b/i,
  'binning mail': /\b(?:mail|email|gmail|trash|spam)\b/i,
  'sending on Slack': /\bslack\b/i,
  'changing a shared Slack canvas or list': /\b(?:slack|canvas)\b/i,
  'binning a Drive file': /\b(?:drive|folder|trash)\b/i,
  'sharing a Drive file': /\bshare\b/i,
  'changing a Drive file in place': /\bdrive\b/i,
  'changing a Doc': /\b(?:doc|docs|document)\b/i,
  'changing a Sheet': /\b(?:sheet|sheets|spreadsheet)\b/i,
  'changing the calendar': /\b(?:calendar|event|meeting|invite)\b/i,
  'a GitHub action others see': /\b(?:merge|issue|review|comment|repo|repository)\b/i,
  'starting or changing a chat or a scheduled task': /\b(?:chat|session|task|schedule|scheduled|trigger|reminder)\b/i,
  'the Upwork connector': /\bupwork\b/i,
  'deleting a page': /\b(?:page|artifact|delete)\b/i,
  'deleting files': /\b(?:delete|remove|clean|wipe)\b/i,
  'deleting a branch': /\bbranch(?:es)?\b/i,
  'deleting a branch on GitHub': /\bbranch(?:es)?\b/i,
  'rewriting a branch on GitHub': /\bforce\b/i,
  'merging to main': /\bmerge\b/i,
  'deploying': /\b(?:deploy|release|ship)\b/i,
  'changing a schedule': /\b(?:schedule|scheduler|job)\b/i,
  'changing Google Cloud': /\b(?:cloud|gcloud|secret|iam|sql)\b/i,
  'changing BigQuery': /\b(?:bigquery|bq|table)\b/i,
  'changing the database': /\b(?:database|db|sql|table)\b/i,
  'changing a status page': /\b(?:status|page)\b/i,
};
// rm -r / rm -rf / rm -fr / rm -r -f as a command word (not inside an echo or a grep): deleting files, unless every
// path is in the temp folder or node_modules (a chat's own scratch). Each simple command (between && || ; | and
// line breaks) is read by its command word, past variable assignments, keywords and wrappers (sudo, env, timeout).
const TEMP = /^(?:\/tmp\/|\$TMPDIR|\$\{?TMPDIR|\.\/?node_modules(?:\/|$)|node_modules(?:\/|$))/;
const BEFORE = /^(?:[A-Za-z_]\w*=.*|if|then|elif|else|do|while|until|!|\{|\()$/;
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'nohup', 'nice', 'ionice', 'time', 'timeout', 'xargs', 'stdbuf']);
const program = (w) => w.split(/[\\/]/).pop().toLowerCase();

// The simple commands of a command line, each { program, args, text }: the command word past variable assignments,
// keywords and wrappers, then its words.
function simpleCommands(command) {
  const out = [];
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const w = words(segment.replace(/^\s*\(+/, ''));
    let i = 0;
    while (i < w.length && BEFORE.test(w[i])) i++;
    while (i < w.length && WRAPPERS.has(program(w[i]))) {
      i++;
      while (i < w.length && (w[i].startsWith('-') || /^\d+[smhd]?$/.test(w[i]))) i++;
    }
    if (i >= w.length) continue;
    out.push({ program: program(w[i]), args: w.slice(i + 1), text: [program(w[i])].concat(w.slice(i + 1)).join(' ') });
  }
  return out;
}

function rmLabel(command) {
  for (const c of simpleCommands(command)) {
    if (c.program !== 'rm') continue;
    const args = c.args;
    const flags = args.filter((a) => a.startsWith('-'));
    const paths = args.filter((a) => !a.startsWith('-'));
    if (!flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive')) continue;
    if (paths.length && paths.every((p) => TEMP.test(p))) continue;
    return 'deleting files';
  }
  return '';
}

// What a tool call does that needs George's yes, as a short label; '' when it needs none.
function classify(toolName, toolInput) {
  const name = String(toolName || '').replace(/^mcp__claude_ai_/, 'mcp__');
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (name === 'Bash' || name === 'PowerShell') {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command) return '';
    const rm = rmLabel(command);
    if (rm) return rm;
    const simple = simpleCommands(command);
    for (const c of simple) for (const [programs, re, label] of BASH) if (programs.includes(c.program) && re.test(c.text)) return label;
    const programs = new Set(simple.map((c) => c.program));
    if ((programs.has('psql') || programs.has('mysql')) && SQL_WRITE.test(command)) return 'changing the database';
    if (programs.has('bq') && simple.some((c) => c.program === 'bq' && /^bq\s+query\b/.test(c.text)) && SQL_WRITE.test(command)) return 'changing BigQuery';
    return '';
  }
  if (name === 'Artifact') return input.action === 'delete' ? 'deleting a page' : '';
  for (const [re, label] of MCP) if (re.test(name)) return label;
  return '';
}

// ---- What approves a call: George's last message. ----
// His approvals, from his last message in the chat's transcript: [{ how: 'yes' | 'order', text }].
//   yes:    his message is a yes (transcript.js isYes) to the reply it answers, and that reply holds "I will:" lines
//           written as its own lines (not quoted, not in a fenced block, not in a blockquote): those lines.
//   order:  each sentence of his message outside quotes, pastes, fences and blockquotes that does not say no (no,
//           not, never, stop, cancel, wait, hold, n't). A message with a question mark is a question, never an order.
// An approval covers a kind of action when it names it with the action's own words (ORDER above); an "I will:"
// line may name it by its label too ("changing Google Cloud"). A word match, nothing read into his words.
const NEGATION = /\b(?:no|not|never|stop|cancel|wait|hold)\b|n['’]t\b/i;
const WILL = /^[\s*_•·–—\p{Extended_Pictographic}️‍-]*I will:\s*(.+)$/u;

// A text without what is not George's own words: pasted content, fenced blocks, blockquote lines, quoted spans; an
// open quote runs to the end.
function unquoted(text) {
  let t = String(text || '')
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/gi, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ');
  t = t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  t = t.replace(/"[^"]*"/g, ' ').replace(/“[^”]*”/g, ' ').replace(/«[^»]*»/g, ' ');
  const lone = t.search(/["“”«]/);
  return lone >= 0 ? t.slice(0, lone) : t;
}

// The sentences of a text that do not say no, each trimmed. A dot inside a name, an address or a path stays.
function sentences(text) {
  return String(text || '').split(/(?:[.!;](?=\s|$))+|\n+/).map((s) => s.trim()).filter((s) => s && !NEGATION.test(s));
}

// The "I will:" lines of a reply, written as its own lines: not quoted, not in a fenced block.
function willLines(reply) {
  return String(reply || '').replace(/```[\s\S]*?(?:```|$)/g, '\n').split('\n')
    .filter((l) => !/^\s*>/.test(l)).map((l) => WILL.exec(l)).filter(Boolean)
    .map((m) => m[1].replace(/^[*_\s]+/, '').trim()).filter(Boolean);
}

function approvals(main) {
  const { george, reply } = lastExchange(main);
  const out = [];
  if (isYes(george)) {
    const lines = willLines(reply);
    if (lines.length) out.push({ how: 'yes', text: lines.join('\n') });
  }
  if (george && !george.includes('?')) for (const s of sentences(unquoted(george))) out.push({ how: 'order', text: s });
  return out;
}

// Whether an approval names a kind of action.
function namesAction(approval, label) {
  const words = ORDER[label];
  if (words && words.test(approval.text)) return true;
  return approval.how === 'yes' && approval.text.toLowerCase().includes(label.toLowerCase());
}

// The reason the call is refused, or '' when it passes. The pin is never read. Any error while checking refuses.
// A call that passes has its approval written as the pin (purpose.js recordApproval), for the chat to see.
// options: { home, now } for the tests.
function refused(input, options) {
  const o = options || {};
  try {
    if (!input || typeof input !== 'object') return 'Blocked: the gate got no tool call to check. Nothing ran.';
    const label = classify(input.tool_name, input.tool_input);
    if (!label) return '';
    const given = approvals(mainTranscript(input));
    const a = given.find((g) => namesAction(g, label));
    if (!a) {
      return `Blocked (${label}): George's last message neither orders it nor says yes to an "I will:" line naming it. ` +
        `Reply one line, "I will: <what, where>", naming ${label}, and wait.`;
    }
    try { recordApproval(a.text, o.home || os.homedir(), o.now); } catch (e) { /* the pin is for the chat only */ }
    return '';
  } catch (e) {
    return `Blocked: the gate could not check this call (${String((e && e.message) || e).split('\n')[0].slice(0, 160)}). Nothing ran.`;
  }
}

// A refusal as the hook prints it.
const deny = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

if (require.main === module) {
  let raw = '';
  let done = false;
  const finish = (reason) => {
    if (!reason) process.exit(0);
    process.stdout.write(deny(reason) + '\n', () => process.exit(0));
  };
  process.on('uncaughtException', (e) => { done = true; finish(`Blocked: the gate failed (${String((e && e.message) || e).slice(0, 160)}). Nothing ran.`); });
  const go = () => {
    if (done) return;
    done = true;
    let input;
    try { input = JSON.parse(raw); } catch (e) { finish('Blocked: the gate could not read the tool call. Nothing ran.'); return; }
    finish(refused(input || {}));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { classify, approvals, unquoted, sentences, willLines, refused, MCP, BASH, ORDER };
