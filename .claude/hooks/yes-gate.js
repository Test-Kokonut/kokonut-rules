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
// transcript, mainTranscript) approves every part of it (parts below: a shell line can hold several), each part in
// one sentence. An approval is his yes (transcript.js isYes) to an "I will:" line of the reply he answered, or his
// order: a short message of his own (orderShaped). The sentence must name the action with the action's own words
// (ORDER below: "mail" for a mail, "merge" for a merge, "sheet" for a Sheet, ...) and a word that does it (VERB:
// "send", "merge", "update", ...), or, in an "I will:" line, the action's label; and every target the call acts on,
// exactly (mcpTargets, shellTargets: each recipient, the channel, the file and who it is shared with, the repo and
// its number, the branch, the service, the table, the page, or the whole command). A word match, nothing read into
// his words. A question is never an order; quoted, pasted, fenced or blockquoted text is not his; a sentence that
// says no (NEGATION) approves nothing; a long or pasted-looking message is no order.
// Whatever the gate cannot verify is refused: a call whose targets it cannot read in full (a draft sent as is, a
// reply-all, a tool it does not know), and any error while checking, the hook's own included. After that message,
// every call in the turn that it approves passes: his next message ends it.
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

// ---- What a call acts on: its targets. ----
// A target is { what, forms, exact }: what names it in a refusal, forms are the spellings that name it in an
// approval, exact makes the match case-sensitive (paths, branches, commands). A part whose targets the gate cannot
// read in full has targets null and a reason (why): it is always refused, since its approval cannot be verified.
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const pick = (input, keys) => { for (const k of keys) { const v = str(input[k]); if (v) return v; } return ''; };
const target = (v, extra) => ({ what: v, forms: [v].concat(extra || []), exact: false });
const exactTarget = (v) => ({ what: v, forms: [v], exact: true, path: true });
const EMAIL = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[^\s<>,;"'()]+/g;

class Unverifiable extends Error {}
const unknown = (why) => { throw new Unverifiable(why); };
const need = (v, why) => v || unknown(why);

function emails(input, keys) {
  const out = [];
  const add = (v, depth) => {
    if (depth > 3) unknown('a recipient list nested too deep to read');
    if (Array.isArray(v)) v.forEach((x) => add(x, depth + 1));
    else if (v && typeof v === 'object') add(v.email || v.emailAddress || v.address || '', depth + 1);
    else for (const m of String(v || '').match(EMAIL) || []) out.push(m.toLowerCase());
  };
  for (const k of keys) add(input[k], 0);
  return [...new Set(out)].map((a) => target(a));
}

// The tables a SQL text writes to: each name as written.
const SQL_TABLE = /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?|drop\s+(?:table|view|index|schema)(?:\s+if\s+exists)?|alter\s+table|create\s+(?:or\s+replace\s+)?(?:table|view|index|schema)(?:\s+if\s+not\s+exists)?)\s+[`"]?([A-Za-z_][\w.$-]*)/gi;
function sqlTables(text) {
  const found = [];
  for (const m of String(text).matchAll(SQL_TABLE)) if (!found.includes(m[1])) found.push(m[1]);
  return found.length ? found.map((t) => target(t)) : unknown('no table the gate can read in its SQL');
}

const GITHUB_REPO_ONLY = /^(?:create_repository|fork_repository)$/;
function githubTargets(tool, input) {
  if (tool === 'create_repository') return [target(need(pick(input, ['name']), 'no repository name'))];
  const owner = need(pick(input, ['owner']), 'no repository owner');
  const repo = need(pick(input, ['repo', 'repository']), 'no repository');
  const full = `${owner}/${repo}`;
  if (GITHUB_REPO_ONLY.test(tool) || (tool === 'issue_write' && str(input.method) === 'create')) return [target(full)];
  const n = need(pick(input, ['pullNumber', 'pull_number', 'issue_number', 'issueNumber', 'number']), 'no pull request or issue number');
  const out = [target(`${full}#${n}`, [`${full}/pull/${n}`, `${full}/issues/${n}`])];
  const comment = pick(input, ['commentId', 'comment_id']);
  if (/comment/.test(tool) && tool !== 'add_issue_comment') out.push(target(need(comment, 'no comment id')));
  return out;
}

function gmailTargets(tool, input) {
  if (tool === 'send_message') {
    if (str(input.draftId) || str(input.draft_id)) unknown('it sends a draft, whose recipients the gate cannot see; send with the recipients in to, cc or bcc');
    const to = emails(input, ['to', 'cc', 'bcc']);
    return to.length ? to : unknown('no recipients in to, cc or bcc');
  }
  if (tool === 'reply' || tool === 'forward') {
    if (input.replyAll === true || input.reply_all === true) unknown('reply-all reaches recipients the gate cannot see; reply with the recipients in to and replyAll off');
    const to = emails(input, ['to', 'cc', 'bcc']);
    if (!emails(input, ['to']).length) unknown(`the ${tool} goes to recipients the gate cannot see; name them in to`);
    return to;
  }
  return [target(need(pick(input, ['messageId', 'message_id', 'threadId', 'thread_id', 'draftId', 'draft_id', 'labelId', 'label_id', 'id']), 'no message, thread, draft or label id'))];
}

function mcpTargets(name, input) {
  if (name === 'Artifact') {
    const url = need(str(input.url), 'no page link');
    const out = [target(url, [url.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()])];
    if (str(input.path)) out.push(target(str(input.path)));
    return out;
  }
  const tool = name.split('__').pop();
  if (/^mcp__Gmail__/.test(name)) return gmailTargets(tool, input);
  if (/^mcp__Slack__/.test(name)) {
    if (/^slack_create_(?:conversation|canvas|list)$/.test(tool)) return [target(need(pick(input, ['name', 'channel_name', 'title']), 'no name'))];
    return [target(need(pick(input, ['channel_id', 'channel', 'channelId', 'canvas_id', 'list_id']), 'no channel, canvas or list id'))];
  }
  if (/^mcp__Google_Drive__/.test(name)) {
    const file = target(need(pick(input, ['fileId', 'file_id']), 'no file id'));
    if (tool !== 'share_file') return [file];
    const role = target(need(pick(input, ['role']), 'no role'));
    const who = emails(input, ['emailAddress', 'email_address']);
    const space = pick(input, ['chatSpaceId', 'chat_space_id']);
    const permission = pick(input, ['permissionId', 'permission_id']);
    if (who.length + (space ? 1 : 0) + (permission ? 1 : 0) !== 1) unknown('it must share with exactly one person, group, Chat space or audience');
    const with_ = who.length ? who : space ? [target(space)] : [permission === 'anyoneWithLink' ? target(permission, ['anyone with the link']) : target(permission)];
    return [file, role].concat(with_);
  }
  if (/^mcp__Google_Docs__/.test(name)) return [target(need(pick(input, ['documentId', 'document_id']), 'no document id'))];
  if (/^mcp__Google_Sheets__/.test(name)) {
    const out = [target(need(pick(input, ['spreadsheetId', 'spreadsheet_id']), 'no spreadsheet id'))];
    if (tool === 'copy_sheet_to_another_spreadsheet') out.push(target(need(pick(input, ['destinationSpreadsheetId', 'destination_spreadsheet_id']), 'no destination spreadsheet id')));
    return out;
  }
  if (/^mcp__Google_Calendar__/.test(name)) {
    const event = tool === 'create_event' ? target(need(pick(input, ['summary', 'title']), 'no event title')) : target(need(pick(input, ['eventId', 'event_id']), 'no event id'));
    return [event].concat(emails(input, ['attendees', 'attendeeEmails', 'attendee_emails', 'addedAttendees', 'added_attendees', 'addedAttendeeEmails', 'removedAttendeeEmails']));
  }
  if (/^mcp__github__/.test(name)) return githubTargets(tool, input);
  if (/^mcp__claude-code-remote__/.test(name)) {
    if (tool === 'create_session') return [target(need(pick(input, ['title']), 'no chat title'))];
    if (tool === 'archive_session') return [target(need(pick(input, ['session_id']), 'no chat id'))];
    if (tool === 'create_trigger') return [target(need(pick(input, ['name']), 'no task name'))];
    return [target(need(pick(input, ['trigger_id']), 'no task id'))];
  }
  if (/^mcp__Upwork/.test(name)) return [target(tool)];
  return unknown('the gate does not know what this tool acts on');
}

// The value after a flag ("-R x", "--repo x", "--repo=x"), '' when the flag is not there.
function flagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n && args[i + 1]) return args[i + 1];
      if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
  }
  return '';
}

// The whole simple command as the target, for a command whose parts the gate does not read one by one: the
// approval must quote it.
const commandTarget = (c) => exactTarget(c.text.replace(/\s+/g, ' ').trim());

function shellTargets(label, c, command) {
  const pos = c.args.filter((a) => !a.startsWith('-'));
  const ref = (r) => r.replace(/^\+/, '').split(':').pop();
  switch (label) {
    case 'deleting files': return pos.filter((p) => !TEMP.test(p)).map(exactTarget);
    case 'deleting a branch': return pos.length > 1 ? pos.slice(1).map(exactTarget) : unknown('no branch named');
    case 'deleting a branch on GitHub':
    case 'rewriting a branch on GitHub': {
      const refs = pos.slice(2).map(ref).filter(Boolean);
      return refs.length ? refs.map(exactTarget) : unknown('no branch named; name the remote and the branch');
    }
    case 'merging to main': {
      const arg = pos.slice(2).find((a) => a !== flagValue(c.args, ['-R', '--repo'])) || '';
      const url = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(arg);
      const repo = url ? url[1] : flagValue(c.args, ['-R', '--repo']);
      const n = url ? url[2] : (/^\d+$/.test(arg) ? arg : '');
      if (!repo || !n) unknown('no repository and pull request number; use --repo <owner/repo> <number>');
      return [target(`${repo}#${n}`, [`${repo}/pull/${n}`])];
    }
    case 'deploying': {
      if (pos[0] === 'builds') return pos[1] === 'triggers' && pos[3] ? [exactTarget(pos[3])] : [commandTarget(c)];
      const service = pos[1] === 'deploy' ? pos[2] : pos[3];
      return service ? [exactTarget(service)] : [commandTarget(c)];
    }
    case 'changing a schedule': return pos[3] ? [exactTarget(pos[3])] : [commandTarget(c)];
    case 'changing Google Cloud': return /--sql\b/.test(c.text) ? sqlTables(c.text) : [commandTarget(c)];
    case 'changing BigQuery':
      if (pos[0] === 'cp') return pos[1] && pos[2] ? [target(pos[1]), target(pos[2])] : unknown('no source and destination table');
      return pos[1] ? [target(pos[1])] : [commandTarget(c)];
    case 'changing a status page': {
      const i = c.args.findIndex((a) => /\bstatus\.js$/.test(a));
      return [exactTarget(need(i >= 0 ? c.args[i + 2] : '', 'no status page named'))];
    }
    default: return unknown('the gate does not know what this command acts on');
  }
}

// One part: its label and targets, or targets null and why when they cannot be read in full.
function part(label, read) {
  try {
    return { label, targets: read() };
  } catch (e) {
    if (e instanceof Unverifiable) return { label, targets: null, why: e.message };
    throw e;
  }
}

// Every part of a tool call that needs George's approval; [] when none. A shell line can hold several (each simple
// command, and its SQL): each needs its own approval.
function parts(toolName, toolInput) {
  const name = String(toolName || '').replace(/^mcp__claude_ai_/, 'mcp__');
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (name !== 'Bash' && name !== 'PowerShell') {
    const label = classify(name, input);
    return label ? [part(label, () => mcpTargets(name, input))] : [];
  }
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) return [];
  const out = [];
  const simple = simpleCommands(command);
  for (const c of simple) {
    if (c.program === 'rm' && rmLabel(c.text)) { out.push(part('deleting files', () => shellTargets('deleting files', c, command))); continue; }
    const hit = BASH.find(([programs, re]) => programs.includes(c.program) && re.test(c.text));
    if (hit) out.push(part(hit[2], () => shellTargets(hit[2], c, command)));
  }
  const programs = new Set(simple.map((c) => c.program));
  if ((programs.has('psql') || programs.has('mysql')) && SQL_WRITE.test(command)) out.push(part('changing the database', () => sqlTables(command)));
  if (simple.some((c) => c.program === 'bq' && /^bq\s+query\b/.test(c.text)) && SQL_WRITE.test(command)) out.push(part('changing BigQuery', () => sqlTables(command)));
  return out;
}

// ---- What George approved. ----
// His approvals, from his last message, one per sentence: each sentence of the "I will:" lines of the reply he
// answered, when his message is a yes; each sentence of his order, when his message is a short one written as his
// (ORDER_LINES, ORDER_WORDS, no notification lines). [{ how: 'yes' | 'order', text }]. A question is never an order;
// quoted, pasted, fenced and blockquoted text is not his; a sentence with no, not, never, stop, cancel, wait or hold
// in it approves nothing.
const NEGATION = /\b(?:no|not|never|stop|cancel|wait|hold)\b|n['’]t\b/i;
const WILL = /^[\s*_•·–—\p{Extended_Pictographic}️‍-]*I will:\s*(.+)$/u;
const ORDER_LINES = 3;
const ORDER_WORDS = 60;
const NOTICE = /^\s*(?:from|to|cc|subject|date|sent):\s|view it on github|reply to this email|unsubscribe|you are receiving this|notifications? settings|wrote:\s*$|^\s*-{2,}\s*$|^\s*on .{4,80} wrote:/im;

function unquoted(text) {
  let t = String(text || '')
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/gi, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ');
  t = t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  t = t.replace(/"[^"]*"/g, ' ').replace(/“[^”]*”/g, ' ').replace(/«[^»]*»/g, ' ');
  const lone = t.search(/["“”«]/); // an open quote runs to the end
  return lone >= 0 ? t.slice(0, lone) : t;
}

// The sentences of a text that say no "no", each trimmed. A dot inside a name, an address or a path stays.
function sentences(text) {
  return String(text || '').split(/(?:[.!;](?=\s|$))+|\n+/).map((s) => s.trim()).filter((s) => s && !NEGATION.test(s));
}

// The "I will:" lines of a reply, written as its own lines: not quoted, not in a fenced block.
function willLines(reply) {
  return String(reply || '').replace(/```[\s\S]*?(?:```|$)/g, '\n').split('\n')
    .filter((l) => !/^\s*>/.test(l)).map((l) => WILL.exec(l)).filter(Boolean)
    .map((m) => m[1].replace(/^[*_\s]+/, '').trim()).filter(Boolean);
}

// Whether a message can be an order: short, and with no line of a pasted mail or notification.
function orderShaped(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.length <= ORDER_LINES && text.split(/\s+/).filter(Boolean).length <= ORDER_WORDS && !NOTICE.test(text);
}

function approvals(main) {
  const { george, reply } = lastExchange(main);
  const out = [];
  if (isYes(george)) for (const line of willLines(reply)) for (const s of sentences(line)) out.push({ how: 'yes', text: s });
  if (george && !george.includes('?') && orderShaped(george)) for (const s of sentences(unquoted(george))) out.push({ how: 'order', text: s });
  return out;
}

// Whether a text names a spelling as a whole token: a letter, digit, _, - or a dot inside a name next to it makes
// it part of another name. exact keeps the case; path makes a "/" part of the name too (a path, a branch, a command:
// "build" is not "/srv/build"), while an id may sit inside a link.
const BEFORE_OK = /[\s"'`(<[{,:/=?#&]/;
const AFTER_OK = /[\s"'`)>\]},;:!?/=#&]/;
const BEFORE_OK_PATH = /[\s"'`(<[{,:=]/;
const AFTER_OK_PATH = /[\s"'`)>\]},;:!?=]/;
function names(text, form, exact, path) {
  const t = exact ? text : text.toLowerCase();
  const f = exact ? String(form || '') : String(form || '').toLowerCase();
  if (f.length < 2) return false;
  for (let i = t.indexOf(f); i >= 0; i = t.indexOf(f, i + 1)) {
    const before = i ? t[i - 1] : '';
    const rest = t.slice(i + f.length);
    const okBefore = !before || (path ? BEFORE_OK_PATH : BEFORE_OK).test(before);
    const okAfter = !rest || (path ? AFTER_OK_PATH : AFTER_OK).test(rest[0]) || (rest[0] === '.' && !/^\.[\w-]/.test(rest));
    if (okBefore && okAfter) return true;
  }
  return false;
}
const squash = (s) => String(s).replace(/\s+/g, ' ');

// The words that do each blocked action, needed with ORDER's words in the same sentence: "check the mail" names the
// mail but does not send it.
const VERB = {
  'sending mail': /\b(?:send|reply|forward|resend)\b/i,
  'binning mail': /\b(?:trash|bin|delete|remove|spam|junk)\b/i,
  'sending on Slack': /\b(?:send|post|reply|share|announce|message|dm)\b/i,
  'changing a shared Slack canvas or list': /\b(?:update|edit|change|add|create|write|post|set up|make)\b/i,
  'binning a Drive file': /\b(?:trash|bin|delete|remove)\b/i,
  'sharing a Drive file': /\bshare\b/i,
  'changing a Drive file in place': /\b(?:update|edit|change|replace|overwrite|write|rename|move)\b/i,
  'changing a Doc': /\b(?:update|edit|change|write|add|replace|fix|rewrite|insert)\b/i,
  'changing a Sheet': /\b(?:update|edit|change|write|add|fill|replace|fix|insert|clear|copy|append)\b/i,
  'changing the calendar': /\b(?:schedule|book|create|add|move|reschedule|delete|invite|accept|decline|respond|update|change|set up)\b/i,
  'a GitHub action others see': /\b(?:merge|comment|open|create|close|review|reply|fork|request|approve|file|post|update|edit)\b/i,
  'starting or changing a chat or a scheduled task': /\b(?:start|create|set up|schedule|archive|update|change|fire|run|delete|pause|make|add|move)\b/i,
  'the Upwork connector': /\b(?:use|run|call|search|submit|send|ask)\b/i,
  'deleting a page': /\b(?:delete|remove)\b/i,
  'deleting files': /\b(?:delete|remove|clean|wipe|rm)\b/i,
  'deleting a branch': /\b(?:delete|remove|prune|clean)\b/i,
  'deleting a branch on GitHub': /\b(?:delete|remove|prune|clean)\b/i,
  'rewriting a branch on GitHub': /\b(?:force|force-push|rewrite|overwrite|reset)\b/i,
  'merging to main': /\bmerge\b/i,
  'deploying': /\b(?:deploy|redeploy|release|ship|roll out|run|execute|build|submit)\b/i,
  'changing a schedule': /\b(?:run|pause|resume|update|create|delete|change|set up|schedule)\b/i,
  'changing Google Cloud': /\b(?:change|update|set|add|create|delete|patch|insert|rotate|grant|revoke|write|destroy|remove|run)\b/i,
  'changing BigQuery': /\b(?:remove|delete|drop|load|insert|update|create|copy|write|truncate|add|make)\b/i,
  'changing the database': /\b(?:insert|update|delete|add|remove|write|change|drop|create|truncate|fix|set)\b/i,
  'changing a status page': /\b(?:save|update|create|delete|write|open|close)\b/i,
};

// Whether one approval sentence names a part's action: ORDER's words and a VERB of it, or, in an "I will:" line, the
// label itself.
function namesAction(approval, part) {
  const noun = ORDER[part.label];
  const verb = VERB[part.label];
  return Boolean((noun && verb && noun.test(approval.text) && verb.test(approval.text)) ||
    (approval.how === 'yes' && names(approval.text, part.label)));
}

// Whether one approval sentence covers a part: the action and every target, all in that sentence.
function covers(approval, part) {
  if (!part.targets || !namesAction(approval, part)) return false;
  return part.targets.every((t) => t.forms.some((f) => names(squash(approval.text), squash(f), t.exact, t.path)));
}

function refusal(part, given) {
  if (!part.targets) {
    return `Blocked (${part.label}): the gate cannot verify what this acts on (${part.why}), so no approval covers it. ` +
      'Change the call so its target can be read, then reply one line, "I will: <what, where>", and wait.';
  }
  const all = part.targets.map((t) => t.what).join(', ');
  if (!given.some((g) => namesAction(g, part))) {
    return `Blocked (${part.label}): George's last message neither orders it nor says yes to an "I will:" line naming ` +
      `it. Reply one line, "I will: <what, where>"${all ? ` naming ${all}` : ''}, and wait.`;
  }
  return `Blocked (${part.label}): no sentence of George's approval names this action together with ${all}. ` +
    `Reply one line, "I will: <what, where>" naming ${all}, and wait.`;
}

// The reason the call is refused, or '' when it passes. A call passes only when George's last message approves each
// of its parts, each in one sentence; the pin is never read. Whatever the gate cannot verify, and any error while
// checking, is refused. A call that passes has its approval written as the pin (purpose.js recordApproval), for the
// chat to see. options: { home, now } for the tests.
function refused(input, options) {
  const o = options || {};
  try {
    if (!input || typeof input !== 'object') return 'Blocked: the gate got no tool call to check.';
    const needs = parts(input.tool_name, input.tool_input);
    if (!needs.length) return '';
    const given = approvals(mainTranscript(input));
    const used = [];
    for (const p of needs) {
      const a = given.find((g) => covers(g, p));
      if (!a) return refusal(p, given);
      if (!used.includes(a.text)) used.push(a.text);
    }
    try { recordApproval(used.join('\n'), o.home || os.homedir(), o.now); } catch (e) { /* the pin is for the chat only */ }
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

module.exports = { classify, parts, approvals, covers, names, sentences, unquoted, willLines, orderShaped, refused, MCP, BASH, ORDER, VERB };
