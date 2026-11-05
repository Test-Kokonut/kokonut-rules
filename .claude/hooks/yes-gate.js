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
// transcript, mainTranscript) approves every part of it (parts below: a shell line can hold several). An approval
// is his yes (transcript.js isYes) to the "I will:" lines of the reply he answered, or his order: his message
// naming the action with the action's own words (ORDER below: "deploy" for a deploy, "merge" for a merge, "sheet"
// for a Sheet, ...). A word match, nothing read into his words. The approval must also name each target the call
// acts on (mcpTargets, shellTargets: a recipient, a channel, a file, a repo and its number, a branch, a service, a
// table, a page); a call whose target the gate cannot read is judged by its action alone. A question is never an
// order; quoted, pasted or fenced text is not his; a clause that says no (NEGATION) approves nothing. After that
// message, every call in the turn that it approves passes: his next message ends it.
// The pin (purpose.js's file) is never read here: a saved scope approves nothing. A call that passes has its
// approval written there (purpose.js recordApproval), so the chat sees the last thing he approved and when.
// Output on a refusal: {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
// "permissionDecisionReason": <one line>}}. Node only, no packages. Any internal error prints nothing and exits 0.
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
// A target is { what, forms }: what names it in a refusal, forms are the spellings that name it in an approval.
// null for a call whose target the gate cannot read: its action alone is checked.
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const pick = (input, keys) => { for (const k of keys) { const v = str(input[k]); if (v) return v; } return ''; };
const one = (v) => (v ? [{ what: v, forms: [v] }] : null);
const base = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const pathTarget = (p) => ({ what: p, forms: [p, base(p)] });
const tableTarget = (t) => ({ what: t, forms: [t, t.split('.').pop()] });
const EMAIL = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[^\s<>,;"'()]+/g;

function emails(input, keys) {
  const out = [];
  const add = (v) => {
    if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') add(v.email || v.emailAddress || v.address || '');
    else for (const m of String(v || '').match(EMAIL) || []) out.push(m);
  };
  for (const k of keys) add(input[k]);
  return [...new Set(out)];
}
const emailTargets = (list) => list.map((a) => ({ what: a, forms: [a, a.split('@')[0]] }));

// The tables a SQL text writes to; null when it names none the gate can read.
const SQL_TABLE = /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?|drop\s+(?:table|view|index|schema)(?:\s+if\s+exists)?|alter\s+table|create\s+(?:or\s+replace\s+)?(?:table|view|index|schema)(?:\s+if\s+not\s+exists)?)\s+[`"]?([A-Za-z_][\w.$-]*)/gi;
function sqlTables(text) {
  const found = [];
  for (const m of String(text).matchAll(SQL_TABLE)) if (!found.includes(m[1])) found.push(m[1]);
  return found.length ? found.map(tableTarget) : null;
}

function githubTargets(name, input) {
  const owner = pick(input, ['owner']);
  const repo = pick(input, ['repo', 'repository']);
  if (/create_repository$/.test(name)) return one(pick(input, ['name']));
  if (!repo) return null;
  const n = pick(input, ['pullNumber', 'pull_number', 'issue_number', 'issueNumber', 'number']);
  const full = owner ? `${owner}/${repo}` : repo;
  if (!n) return [{ what: full, forms: [full, repo] }];
  return [{ what: `${full}#${n}`, forms: [`${full}#${n}`, `${repo}#${n}`, `${repo}/pull/${n}`, `${repo}/issues/${n}`] }];
}

function mcpTargets(name, input) {
  if (name === 'Artifact') {
    const url = str(input.url);
    const out = url ? [{ what: url, forms: [url, base(url.split(/[?#]/)[0])] }] : [];
    if (str(input.path)) out.push({ what: str(input.path), forms: [str(input.path)] });
    return out.length ? out : null;
  }
  const tool = name.split('__').pop();
  if (/^mcp__Gmail__/.test(name)) {
    if (/^(?:send_message|reply|forward)$/.test(tool)) {
      const to = emails(input, ['to', 'cc', 'bcc', 'recipient', 'recipients']);
      return to.length ? emailTargets(to) : one(pick(input, ['threadId', 'thread_id', 'messageId', 'message_id', 'id']));
    }
    return one(pick(input, ['messageId', 'message_id', 'threadId', 'thread_id', 'draftId', 'draft_id', 'labelId', 'label_id', 'id']));
  }
  if (/^mcp__Slack__/.test(name)) {
    if (tool === 'slack_create_conversation') return one(pick(input, ['name', 'channel_name']));
    return one(pick(input, ['channel_id', 'channel', 'channelId', 'canvas_id', 'list_id', 'id']));
  }
  if (/^mcp__Google_Drive__/.test(name)) {
    const file = one(pick(input, ['fileId', 'file_id', 'id']));
    if (tool !== 'share_file') return file;
    const people = emailTargets(emails(input, ['emailAddress', 'email', 'emails', 'user', 'users', 'permission', 'permissions']));
    return file || people.length ? (file || []).concat(people) : null;
  }
  if (/^mcp__Google_Docs__/.test(name)) return one(pick(input, ['documentId', 'document_id', 'docId', 'doc_id', 'id']));
  if (/^mcp__Google_Sheets__/.test(name)) {
    const sheet = one(pick(input, ['spreadsheetId', 'spreadsheet_id', 'id']));
    const to = one(pick(input, ['destinationSpreadsheetId', 'destination_spreadsheet_id']));
    return sheet && to ? sheet.concat(to) : sheet || to;
  }
  if (/^mcp__Google_Calendar__/.test(name)) {
    return tool === 'create_event' ? one(pick(input, ['summary', 'title'])) : one(pick(input, ['eventId', 'event_id', 'id']));
  }
  if (/^mcp__github__/.test(name)) return githubTargets(tool, input);
  if (/^mcp__claude-code-remote__/.test(name)) {
    if (tool === 'create_session') return one(pick(input, ['title']));
    if (tool === 'archive_session') return one(pick(input, ['session_id']));
    if (tool === 'create_trigger') return one(pick(input, ['name']));
    return one(pick(input, ['trigger_id']));
  }
  return null; // the Upwork connector and anything else: its action alone
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

function shellTargets(label, c, command) {
  const pos = c.args.filter((a) => !a.startsWith('-'));
  const ref = (r) => r.replace(/^\+/, '').split(':').pop();
  switch (label) {
    case 'deleting files': return pos.filter((p) => !TEMP.test(p)).map(pathTarget);
    case 'deleting a branch': return pos.length > 1 ? pos.slice(1).map((b) => ({ what: b, forms: [b] })) : null;
    case 'deleting a branch on GitHub':
    case 'rewriting a branch on GitHub': {
      const refs = pos.slice(2).map(ref).filter(Boolean);
      return refs.length ? refs.map((b) => ({ what: b, forms: [b] })) : null;
    }
    case 'merging to main': {
      const repo = flagValue(c.args, ['-R', '--repo']);
      const n = pos.slice(2).find((a) => a !== repo);
      if (!n) return null;
      const num = (/(\d+)\/?$/.exec(n) || [])[1] || n;
      const forms = [n, `#${num}`, `pull/${num}`, `pr ${num}`, `pull request ${num}`];
      if (repo) forms.push(`${repo}#${num}`, `${repo.split('/').pop()}#${num}`);
      return [{ what: repo ? `${repo}#${num}` : `#${num}`, forms }];
    }
    case 'deploying': {
      if (pos[0] === 'builds') return pos[1] === 'triggers' ? one(pos[3]) : null;
      return one(pos[1] === 'deploy' ? pos[2] : pos[3]);
    }
    case 'changing a schedule': return one(pos[3]);
    case 'changing Google Cloud': return sqlTables(command);
    case 'changing BigQuery': return pos[0] === 'query' ? sqlTables(command) : (pos[1] ? [tableTarget(pos[1])] : null);
    case 'changing a status page': {
      const i = c.args.findIndex((a) => /\bstatus\.js$/.test(a));
      return one(i >= 0 ? c.args[i + 2] : '');
    }
    default: return null;
  }
}

// Every part of a tool call that needs George's approval, each { label, targets }; [] when none. A shell line can
// hold several (each simple command, and its SQL): each needs its own approval.
function parts(toolName, toolInput) {
  const name = String(toolName || '').replace(/^mcp__claude_ai_/, 'mcp__');
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (name !== 'Bash' && name !== 'PowerShell') {
    const label = classify(name, input);
    return label ? [{ label, targets: mcpTargets(name, input) }] : [];
  }
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) return [];
  const out = [];
  const simple = simpleCommands(command);
  for (const c of simple) {
    if (c.program === 'rm' && rmLabel(c.text)) { out.push({ label: 'deleting files', targets: shellTargets('deleting files', c, command) }); continue; }
    const hit = BASH.find(([programs, re]) => programs.includes(c.program) && re.test(c.text));
    if (hit) out.push({ label: hit[2], targets: shellTargets(hit[2], c, command) });
  }
  const programs = new Set(simple.map((c) => c.program));
  if ((programs.has('psql') || programs.has('mysql')) && SQL_WRITE.test(command)) out.push({ label: 'changing the database', targets: sqlTables(command) });
  if (simple.some((c) => c.program === 'bq' && /^bq\s+query\b/.test(c.text)) && SQL_WRITE.test(command)) out.push({ label: 'changing BigQuery', targets: sqlTables(command) });
  return out;
}

// ---- What George approved. ----
// His approvals, from his last message: his yes to the "I will:" lines of the reply he answered, and his order,
// each the text that approves: [{ how: 'yes' | 'order', text }]. A question is never an order; quoted, pasted and
// fenced text is not his; a clause that says no, not, never, stop, cancel, wait or hold approves nothing.
const NEGATION = /\b(?:no|not|never|stop|cancel|wait|hold)\b|n['’]t\b/i;
const WILL = /^[\s*_•·–—\p{Extended_Pictographic}️‍-]*I will:\s*(.+)$/u;

function unquoted(text) {
  let t = String(text || '')
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/gi, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ');
  t = t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  t = t.replace(/"[^"]*"/g, ' ').replace(/“[^”]*”/g, ' ').replace(/«[^»]*»/g, ' ');
  const lone = t.search(/["“”«]/); // an open quote runs to the end
  return lone >= 0 ? t.slice(0, lone) : t;
}

// The clauses of a text that do not say no, joined.
function standing(text) {
  return String(text || '').split(/(?:[.!;](?=\s|$))+|[,\n]+|\bbut\b/i) // a dot inside a name or an address stays
    .map((s) => s.trim()).filter((s) => s && !NEGATION.test(s)).join('. ');
}

// The "I will:" lines of a reply, written as its own lines: not quoted, not in a fenced block.
function willLines(reply) {
  return String(reply || '').replace(/```[\s\S]*?(?:```|$)/g, '\n').split('\n')
    .filter((l) => !/^\s*>/.test(l)).map((l) => WILL.exec(l)).filter(Boolean)
    .map((m) => m[1].replace(/^[*_\s]+/, '').trim()).filter(Boolean).join('\n');
}

function approvals(main) {
  const { george, reply } = lastExchange(main);
  const out = [];
  if (isYes(george)) {
    const will = standing(willLines(reply));
    if (will) out.push({ how: 'yes', text: will });
  }
  if (george && !george.includes('?')) {
    const order = standing(unquoted(george));
    if (order) out.push({ how: 'order', text: order });
  }
  return out;
}

// Whether an approval's text names a spelling: as a whole word, any case.
function names(text, form) {
  const t = text.toLowerCase();
  const f = String(form || '').toLowerCase();
  if (f.length < 2) return false;
  for (let i = t.indexOf(f); i >= 0; i = t.indexOf(f, i + 1)) {
    const before = i ? t[i - 1] : '';
    const after = t[i + f.length] || '';
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
  }
  return false;
}

// Whether an approval names a part's action: an order by ORDER's words; an "I will:" line by those words or the
// label itself.
function namesAction(approval, part) {
  const words = ORDER[part.label];
  return Boolean((words && words.test(approval.text)) || (approval.how === 'yes' && names(approval.text, part.label)));
}

// Whether an approval covers a part: it names the action and every target the gate can read.
function covers(approval, part) {
  if (!namesAction(approval, part)) return false;
  return part.targets === null || part.targets.every((t) => t.forms.some((f) => names(approval.text, f)));
}

// The reason the call is refused, or '' when it passes. A call passes only when George's last message approves
// each of its parts; the pin is never read. A call that passes has its approval written as the pin (purpose.js
// recordApproval), for the chat to see. options: { home, now } for the tests.
function refused(input, options) {
  const o = options || {};
  if (!input || typeof input !== 'object') return '';
  const need = parts(input.tool_name, input.tool_input);
  if (!need.length) return '';
  let given = [];
  try { given = approvals(mainTranscript(input)); } catch (e) { given = []; }
  const used = [];
  for (const part of need) {
    const a = given.find((g) => covers(g, part));
    if (!a) {
      if (!given.some((g) => namesAction(g, part))) {
        return `Blocked (${part.label}): George's last message neither orders it nor says yes to an "I will:" line. ` +
          'Reply one line, "I will: <what, where>", and wait.';
      }
      const named = (t) => given.some((g) => namesAction(g, part) && t.forms.some((f) => names(g.text, f)));
      const what = part.targets.filter((t) => !named(t)).map((t) => t.what).join(', ');
      return `Blocked (${part.label}): George's approval does not name ${what}. Reply one line, "I will: <what, ` +
        `where>" naming ${what}, and wait.`;
    }
    if (!used.includes(a.text)) used.push(a.text);
  }
  try { recordApproval(used.join('\n'), o.home || os.homedir(), o.now); } catch (e) { /* the pin is for the chat only */ }
  return '';
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let reason = '';
    try { reason = refused(JSON.parse(raw || '{}') || {}); } catch (e) { reason = ''; }
    if (!reason) process.exit(0);
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
    process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', go);
    process.stdin.on('error', go);
  } catch (e) { go(); }
  setTimeout(go, 3000);
}

module.exports = { classify, parts, approvals, covers, unquoted, willLines, refused, MCP, BASH, ORDER };
