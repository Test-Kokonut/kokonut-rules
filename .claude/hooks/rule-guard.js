#!/usr/bin/env node
// rule-guard.js: rule files change only after George types "rule change ok" in this chat.
// Written in kokonut-rules and installed machine-wide by its setup.sh; run by the PreToolUse hook in
// .claude/settings.json on Bash|PowerShell (after no-main.js and guard.js) and on Edit|Write|MultiEdit|NotebookEdit.
// Rule files: any CLAUDE.md (CLAUDE.local.md too), anything under a .claude/ or .github/ folder, in any repo or
// folder; kokonut-rules' installer, setup.sh at the top of a folder named kokonut-rules or of one that holds
// .claude/hooks/rule-guard.js (another checkout of kokonut-rules); and, in the home folder's .claude/, only
// CLAUDE.md, settings.json, hooks/, commands/ and kokonut/ (the machine-wide install of kokonut-rules' setup.sh: the
// rulebook, the settings, the hooks, the slash commands and their installer; its transcripts, memory and state are no
// rule files). Nothing under node_modules/ is one.
// A tool call that would change one is refused unless George's latest message (lastTyped() of reminder.js: a message
// he typed in this chat; a task notification, a helper's report or another session's message never counts) holds
// "rule change ok", in any case. The call is read as:
//   Edit, Write, MultiEdit, NotebookEdit: the file it names.
//   a shell command (Bash), read as the shell reads it, quotes, $(...), `...` and here-documents included, each
//       command in the folder it runs in (cd, pushd, Set-Location and git -C followed):
//     - a redirection that writes (>, >>, >|, &>, <>) to a rule file;
//     - a command that writes the files it names: rm, rmdir, unlink, shred, truncate, touch, mkdir, chmod, chown,
//       chgrp, ln, install, cp and mv (a folder copied or moved that holds rule files too), rsync, tee, dd of=,
//       sed -i, perl -i, awk -i inplace, sort -o, uniq's output, patch, wget -O, curl -o and -O, find -delete or
//       -exec (under a folder that holds rule files);
//     - git: rm, mv, checkout and restore of a rule file, apply and am of a patch that touches one, clean that would
//       remove one, a commit whose files (staged, added by git add earlier in the same command, -a, its paths,
//       --amend's commit) include one, and a push whose commits not yet on any remote change one;
//     - gh api and curl that write to GitHub (a method other than GET, fields, a file sent) naming a rule file;
//     - code that runs: bash -c, sh -c, eval and what $(...) and `...` run are read as commands; a here-document or
//       here-string fed to a shell is read as commands, one fed to node, python, perl or ruby as code; code (node -e,
//       python -c, perl -e, ruby -e, ...) that names a rule file and writes files (writeFile, open(..., 'w'),
//       shutil, a child process, ...);
//     - any other command that names a rule file, but those that only read (cat, grep, ls, diff, git diff, ...).
//   a PowerShell command: refused when it names a rule file and writes files (Set-Content, Out-File, Remove-Item,
//       Copy-Item, a redirection, ...); its git commits and pushes are read as above.
// Refuse when unsure: a write whose target the guard cannot tell (a variable or a substitution as its file, xargs
// with a writing command, a patch from a pipe, text left open, a folder too large to look through, git that cannot
// read the folder, a call it cannot read) is refused too, with its reason, unless George's words are there. A
// transcript it cannot read holds no words of his. Any other call passes, silently.
// The refusal: "Refused. Rule files change only after George types "rule change ok" in this chat. ...".
// Node only, no packages, Windows and Linux. It always exits 0; a refusal is its JSON answer on stdout.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isGit } = require('./no-main.js');

let R = null;
try { R = require('./reminder.js'); } catch (e) { R = null; } // unread: no words of George's, so a rule change is refused

const PHRASE = /\brule\s+change\s+ok\b/i;
const SAY = 'Rule files change only after George types "rule change ok" in this chat.';
const reasonRule = (what) => `Refused. ${SAY} This would change ${what}. Ask George first.`;
const reasonUnsure = (why) => `Refused. ${SAY} The guard cannot tell whether this changes one (${why}). Ask George first, or name the files plainly.`;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// A rule file named in text: CLAUDE.md as a file name, .claude or .github as a folder name, kokonut-rules/setup.sh.
const RULE_TEXT = /(?:^|[^\w.-])claude(?:\.local)?\.md(?![\w.-])|(?:^|[^\w])\.(?:claude|github)(?![\w.-])|kokonut-rules[\\/]+setup\.sh(?![\w.-])/i;
const RULE_NAME = /^(?:claude(?:\.local)?\.md|settings(?:\.local)?\.json|hooks|commands|workflows)$/i;
const GIT_WRITE = /\bgit\b[^\n]*\b(?:commit|push)\b/;
const MAX_DEPTH = 6; // text that runs inside text that runs: read this deep
const WALK_LIMIT = 20000; // entries looked at inside one folder that is removed, moved or copied
const PATCH_LIMIT = 4 * 1024 * 1024;
const UNKNOWN_DIR = path.resolve('/', '__folder-unknown__');

// ---- Rule files. ----

const segments = (p) => String(p).replace(/\\/g, '/').split('/').filter(Boolean).map((s) => s.toLowerCase());

// Whether the file or folder at the absolute path p is a rule file; home: the home folder.
function isRulePath(p, home) {
  const low = segments(p);
  if (!low.length || low.includes('node_modules')) return false;
  const h = segments(home || '');
  if (h.length && low.length > h.length && h.every((s, i) => low[i] === s) && low[h.length] === '.claude') {
    const first = low[h.length + 1];
    return first === 'claude.md' || first === 'settings.json' || first === 'hooks' || first === 'commands' || first === 'kokonut';
  }
  if (/^claude(?:\.local)?\.md$/.test(low[low.length - 1])) return true;
  if (low[low.length - 1] === 'setup.sh' && low.length > 1 && (low[low.length - 2] === 'kokonut-rules' ||
    fs.existsSync(path.join(path.dirname(p), '.claude', 'hooks', 'rule-guard.js')))) return true; // kokonut-rules' installer
  return low.includes('.claude') || low.includes('.github');
}

// Whether the path is a rule file or a folder that holds one: true, false or 'unsure' (too many entries to look
// through). node_modules and .git are passed over.
function holdsRuleFiles(p, home) {
  if (isRulePath(p, home)) return true;
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return false; }
  if (!st.isDirectory()) return false;
  const queue = [p];
  let seen = 0;
  while (queue.length) {
    const dir = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of entries) {
      if (++seen > WALK_LIMIT) return 'unsure';
      if (d.name === 'node_modules' || d.name === '.git') continue;
      const full = path.join(dir, d.name);
      if (isRulePath(full, home)) return true;
      if (d.isDirectory()) queue.push(full);
    }
  }
  return false;
}

// ---- Reading a shell command line. ----
// A word's text keeps quotes removed; a $NAME or ${NAME} in it is VAR NAME END, any other expansion ($(...), `...`,
// $1, ${x:-y}) is SUB. A command: its words, its redirections ({ op, fd, target }), its here-documents ({ body }) and
// the commands its substitutions run (inner, one list per substitution).

const VAR = '\u0001';
const END = '\u0002';
const SUB = '\u0003';

const newWord = () => ({ text: '', quoted: false, glob: false, brace: false });
const newCmd = () => ({ words: [], redirects: [], heredocs: [], inner: [], pending: false });

// Reads shell text from start: { cmds, i, error }. Inside $( ... ), stop is ')' and it ends after the ) that closes
// it. error: what it could not read ('' when none).
function lex(text, start, stop, depth) {
  const cmds = [];
  let cmd = newCmd();
  let word = null;
  let redirect = null; // an operator waiting for its word
  const bodies = []; // here-documents waiting for their lines
  let error = depth > MAX_DEPTH ? 'text that runs, too deep' : '';
  let paren = 0;
  let i = start;
  const fail = (why) => { if (!error) error = why; };
  const begin = () => { if (!word) word = newWord(); return word; };
  const finishWord = () => {
    if (!word) return;
    const w = word;
    word = null;
    if (redirect) {
      const r = redirect;
      redirect = null;
      if (r.op === '<<' || r.op === '<<-') {
        bodies.push({ cmd, delim: w.text.replace(/[\u0001-\u0003]/g, ''), strip: r.op === '<<-' });
        cmd.pending = true;
      } else {
        r.target = w;
        cmd.redirects.push(r);
      }
      return;
    }
    cmd.words.push(w);
  };
  const finishCmd = () => {
    finishWord();
    if (redirect) { cmd.redirects.push(redirect); redirect = null; }
    if (cmd.words.length || cmd.redirects.length || cmd.inner.length || cmd.pending) cmds.push(cmd);
    cmd = newCmd();
  };
  const sub = (j) => {
    const r = depth > MAX_DEPTH ? { cmds: [], i: text.length, error: 'text that runs, too deep' } : lex(text, j, ')', depth + 1);
    cmd.inner.push(r.cmds);
    if (r.error) fail(r.error);
    begin().text += SUB;
    return r.i;
  };
  const backtick = (j) => {
    let k = j;
    let inner = '';
    while (k < text.length && text[k] !== '`') {
      if (text[k] === '\\' && k + 1 < text.length) { inner += text[k + 1]; k += 2; } else inner += text[k++];
    }
    if (k >= text.length) fail('a ` left open');
    const r = lex(inner, 0, '', depth + 1);
    cmd.inner.push(r.cmds);
    if (r.error) fail(r.error);
    begin().text += SUB;
    return k + 1;
  };
  const dollar = (j) => {
    const n = text[j + 1];
    if (n === '(') return sub(j + 2);
    if (n === '{') {
      let k = j + 2;
      let open = 1;
      while (k < text.length && open) { if (text[k] === '{') open++; else if (text[k] === '}') open--; k++; }
      if (open) fail('a ${ left open');
      const inside = text.slice(j + 2, open ? k : k - 1);
      begin().text += /^[A-Za-z_]\w*$/.test(inside) ? VAR + inside + END : SUB;
      return k;
    }
    if (n && /[A-Za-z_]/.test(n)) {
      const name = /^[A-Za-z_]\w*/.exec(text.slice(j + 1))[0];
      begin().text += VAR + name + END;
      return j + 1 + name.length;
    }
    if (n && /[0-9@*#?$!-]/.test(n)) { begin().text += SUB; return j + 2; }
    if (n === "'") { // $'...': read as a quoted string
      const w = begin();
      w.quoted = true;
      let k = j + 2;
      while (k < text.length && text[k] !== "'") {
        if (text[k] === '\\' && k + 1 < text.length) { w.text += text[k + 1]; k += 2; } else w.text += text[k++];
      }
      if (k >= text.length) fail('a quote left open');
      return k + 1;
    }
    begin().text += '$';
    return j + 1;
  };
  const double = (j) => {
    const w = begin();
    w.quoted = true;
    let k = j;
    while (k < text.length && text[k] !== '"') {
      const c = text[k];
      if (c === '\\' && k + 1 < text.length) {
        const next = text[k + 1];
        if (next === '\n') { k += 2; continue; }
        w.text += '$`"\\'.includes(next) ? next : c + next;
        k += 2;
        continue;
      }
      if (c === '$') { k = dollar(k); continue; }
      if (c === '`') { k = backtick(k + 1); continue; }
      w.text += c;
      k++;
    }
    if (k >= text.length) fail('a quote left open');
    return k + 1;
  };
  const readBodies = (j) => {
    let k = j;
    for (const b of bodies.splice(0)) {
      const lines = [];
      while (k < text.length) {
        const nl = text.indexOf('\n', k);
        const line = text.slice(k, nl < 0 ? text.length : nl);
        k = nl < 0 ? text.length : nl + 1;
        if ((b.strip ? line.replace(/^\t+/, '') : line) === b.delim) break;
        lines.push(line);
      }
      b.cmd.heredocs.push({ body: lines.join('\n') });
    }
    return k;
  };

  while (i < text.length) {
    const c = text[i];
    if (stop && c === ')' && paren === 0) { finishCmd(); return { cmds, i: i + 1, error }; }
    if (c === '\\') {
      if (text[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 < text.length) begin().text += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "'") {
      const w = begin();
      w.quoted = true;
      const j = text.indexOf("'", i + 1);
      if (j < 0) { fail('a quote left open'); w.text += text.slice(i + 1); i = text.length; continue; }
      w.text += text.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === '"') { i = double(i + 1); continue; }
    if (c === '`') { i = backtick(i + 1); continue; }
    if (c === '$') { i = dollar(i); continue; }
    if (c === '#' && !word) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    if (c === '\n') { finishCmd(); i++; if (bodies.length) i = readBodies(i); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { finishWord(); i++; continue; }
    if (c === '<' || c === '>' || (c === '&' && text[i + 1] === '>')) {
      const op = /^(?:&>>|&>|>>|>\||>&|<<<|<<-|<<|<>|<&|>|<)/.exec(text.slice(i, i + 3))[0];
      if ((op === '<' || op === '>') && text[i + 1] === '(') { i = sub(i + 2); continue; } // <( ... ), >( ... )
      let fd = '';
      if (word && !word.quoted && /^\d+$/.test(word.text) && /\d/.test(text[i - 1] || '')) { fd = word.text; word = null; }
      finishWord();
      if (redirect) cmd.redirects.push(redirect);
      redirect = { op, fd, target: null };
      i += op.length;
      continue;
    }
    if (c === ';' || c === '|' || c === '&') {
      finishCmd();
      const two = text.slice(i, i + 2);
      i += ['&&', '||', '|&', ';;', ';&'].includes(two) ? 2 : 1;
      continue;
    }
    if (c === '(') { finishCmd(); paren++; i++; continue; }
    if (c === ')') { finishCmd(); if (paren > 0) paren--; i++; continue; }
    const fresh = !word;
    const w = begin();
    if (c === '~' && fresh && (i + 1 >= text.length || /[/\s;|&)]/.test(text[i + 1]))) { w.text += VAR + 'HOME' + END; i++; continue; }
    if (c === '*' || c === '?' || c === '[') w.glob = true;
    if (c === '{') w.brace = true;
    w.text += c;
    i++;
  }
  finishCmd();
  if (stop) fail('a $( left open');
  return { cmds, i, error };
}

// ---- Words as text and as paths. ----

const printable = (t) => String(t).replace(/\u0001(\w+)\u0002/g, '$$$1').replace(/\u0003/g, '$(...)');
const plain = (w) => printable(w ? w.text : '');
const dynamic = (w) => /[\u0001\u0003]/.test(w.text);
const program = (s) => String(s).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
const asWord = (w, text) => ({ text, quoted: w.quoted, glob: w.glob, brace: w.brace });

function known(name, ctx) {
  if (name === 'HOME' || name === 'USERPROFILE') return ctx.home;
  if (name === 'PWD') return ctx.here || undefined;
  if (name === 'CLAUDE_PROJECT_DIR' || name === 'TMPDIR' || name === 'TEMP' || name === 'TMP') return ctx.env[name] || undefined;
  return undefined;
}

function braces(t, n) {
  const m = /\{([^{}]*,[^{}]*)\}/.exec(t);
  if (!m || (n || 0) > 5) return [t];
  return m[1].split(',').flatMap((part) => braces(t.slice(0, m.index) + part + t.slice(m.index + m[0].length), (n || 0) + 1)).slice(0, 200);
}

function globRe(seg) {
  let re = seg.startsWith('.') ? '^' : '^(?!\\.)';
  for (let k = 0; k < seg.length; k++) {
    const c = seg[k];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = seg.indexOf(']', k + 1);
      if (j < 0) { re += '\\['; continue; }
      re += '[' + seg.slice(k + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
      k = j;
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

// The paths a glob stands for, folder by folder; none: the glob as written (as the shell leaves it).
function glob(abs) {
  const root = path.parse(abs).root;
  let paths = [root];
  for (const seg of abs.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    if (!/[*?[]/.test(seg)) { paths = paths.map((p) => path.join(p, seg)); continue; }
    const re = globRe(seg);
    const next = [];
    for (const p of paths) {
      let names = [];
      try { names = fs.readdirSync(p); } catch (e) { continue; }
      for (const n of names) if (re.test(n)) next.push(path.join(p, n));
      if (next.length > 5000) break;
    }
    paths = next;
  }
  return paths.length ? paths : [abs];
}

// The paths a word stands for, from the folder the command runs in: { paths, relUnknown } or { unknown } (a
// variable or substitution the guard does not know, printed as written).
function expand(word, ctx) {
  const t = word.text.replace(/\u0001(\w+)\u0002/g, (m, name) => { const v = known(name, ctx); return v === undefined ? m : v; });
  if (/[\u0001\u0003]/.test(t)) return { unknown: printable(t) };
  const paths = [];
  let relUnknown = false;
  for (const s of word.brace ? braces(t) : [t]) {
    if (!s) continue;
    if (!ctx.here && !path.isAbsolute(s)) relUnknown = true;
    const abs = path.resolve(ctx.here || UNKNOWN_DIR, s);
    if (word.glob && /[*?[]/.test(s)) paths.push(...glob(abs)); else paths.push(abs);
  }
  return { paths, relUnknown };
}

const rule = (what) => ({ rule: what });
const unsure = (why) => ({ unsure: why });

// What writing to the word's file or folder would change: a rule file, unsure, or null. options.holds: a folder
// that holds rule files counts (it is removed, moved or copied whole).
function target(word, ctx, label, options) {
  const o = options || {};
  const e = expand(word, ctx);
  if (e.unknown) {
    const last = e.unknown.split(/[\\/]/).pop();
    if (RULE_TEXT.test(e.unknown) || !last || last.includes('$') || RULE_NAME.test(last)) return unsure(`${label} whose file is ${e.unknown}`);
    return null;
  }
  for (const p of e.paths) {
    if (isRulePath(p, ctx.home)) return rule(p);
    if (o.holds) {
      const h = holdsRuleFiles(p, ctx.home);
      if (h === true) return rule(`${p}, a folder that holds rule files`);
      if (h === 'unsure') return unsure(`${label} ${p}, a folder too large to look through`);
    }
  }
  if (e.relUnknown && ctx.hereRuleish) return unsure(`${label} in a folder the guard cannot tell`);
  return null;
}

// The first finding among the words.
function targets(words, ctx, label, options) {
  for (const w of words) { const f = target(w, ctx, label, options); if (f) return f; }
  return null;
}

// Whether a word names a rule file (an option's value after = too); its path, else ''.
function ruleNamed(word, ctx) {
  const s = plain(word);
  let w = word;
  if (s.startsWith('-')) {
    const k = word.text.indexOf('=');
    if (k < 0) return '';
    w = asWord(word, word.text.slice(k + 1));
  }
  const e = expand(w, ctx);
  if (e.unknown) return '';
  return e.paths.find((p) => isRulePath(p, ctx.home)) || '';
}

// The words of a command's arguments that are not options: options (-x, --x, --x=v) skipped, with the word after
// each option of takes; every word after "--" kept.
function operands(args, a, takes) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const s = a[k];
    if (s === '--') { out.push(...args.slice(k + 1)); break; }
    if (s.length > 1 && s.startsWith('-')) { if (takes && takes.has(s)) k++; continue; }
    out.push(args[k]);
  }
  return out;
}

// The values of an option: -o FILE, -oFILE, --output FILE, --output=FILE.
function values(args, a, short, long) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const s = a[k];
    if (s === '--') break;
    if ((short && s === short) || (long && s === long)) { if (k + 1 < args.length) out.push(args[++k]); continue; }
    if (long && s.startsWith(long + '=')) out.push(asWord(args[k], args[k].text.slice(long.length + 1)));
    else if (short && s.length > 2 && s.startsWith(short) && !s.startsWith('--')) out.push(asWord(args[k], args[k].text.slice(2)));
  }
  return out;
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

// ---- Code that runs. ----

// Code that writes files or runs commands: Node, Python, Ruby, Perl, PowerShell and .NET.
const WRITE_CODE = [
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|cpSync|rename|renameSync|unlink|unlinkSync|rmSync|rmdir|rmdirSync|mkdir|mkdirSync|truncate|truncateSync|symlink|symlinkSync|linkSync|chmod|chmodSync|writeSync|openSync|exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/,
  /\bfs(?:\.promises)?\.(?:rm|cp|link|open|write)\s*\(/,
  /\bopen\s*\([^()]*,\s*(?:mode\s*=\s*)?['"][rbt]*[wax+][rbtwax+]*['"]/,
  /\bmode\s*=\s*['"][rbt]*[wax+]/,
  /\.open\s*\(\s*['"][rbt]*[wax+]/,
  /\.(?:write_text|write_bytes|touch|symlink_to|hardlink_to)\s*\(/,
  /\bos\.(?:remove|unlink|rename|renames|replace|makedirs|mkdir|rmdir|removedirs|symlink|link|chmod|truncate|system|popen|exec\w*|spawn\w*|posix_spawn\w*)\s*\(/,
  /\bshutil\.\w+/,
  /\bsubprocess\b/,
  /\bFile\.(?:write|open|delete|unlink|rename|symlink|chmod|truncate)\b/,
  /\b(?:FileUtils|IO\.write)\b/,
  /\bsystem\s*\(/,
  /%x[({[]/,
  /\bopen\b[^;]*?['"]\s*\+?>/,
  /\b(?:unlink|rename|rmdir|symlink)\s+['"$]/,
  /\b(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Clear-Content|Tee-Object)\b/i,
  /::(?:WriteAll\w*|AppendAll\w*|Delete|Move|Copy|Create\w*|Replace)\s*\(/,
];

// Code (or a PowerShell or cmd line) that names a rule file, in itself or in the words given to it, and writes.
function codeFinding(code, rest, ctx, label) {
  const named = RULE_TEXT.test(code) || rest.some((w) => ruleNamed(w, ctx));
  if (!named || !WRITE_CODE.some((r) => r.test(code))) return null;
  return rule(`a rule file, named in ${label} that writes files`);
}

// PowerShell's writing commands, their aliases, a redirection, .NET's file calls.
const PS_WRITE = [
  /(?:^|[\s;|&({])(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Clear-Content|Tee-Object|ni|del|erase|rd|rmdir|rm|ri|cp|cpi|copy|mv|mi|move|rni|ren|sc|ac|tee|mkdir|md|xcopy|robocopy)(?=[\s(]|$)/im,
  /(?:^|[^-=<])>/,
  /\[(?:System\.)?IO\.(?:File|Directory|FileInfo)\]::/i,
];

function psFinding(text, label) {
  if (!RULE_TEXT.test(text)) return null;
  if (PS_WRITE.some((r) => r.test(text)) || WRITE_CODE.some((r) => r.test(text))) return rule(`a rule file, named in ${label} that writes files`);
  return null;
}

// ---- The commands. ----

const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'in', 'esac', '!', '{', '}', 'function', 'time']);
const SKIPPED = new Set(['for', 'select', 'case']); // a list of words, not a command
const ASSIGN = /^[A-Za-z_]\w*\+?=/;
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'nohup', 'nice', 'ionice', 'time', 'timeout',
  'stdbuf', 'chronic', 'unbuffer', 'flock', 'xargs', 'noglob', 'nocorrect']);
const CHANGE_DIR = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const CODE = { node: ['-e', '--eval', '-p', '--print'], nodejs: ['-e', '--eval', '-p', '--print'], python: ['-c'], python3: ['-c'],
  python2: ['-c'], py: ['-c'], perl: ['-e', '-E'], ruby: ['-e'], php: ['-r'] };
// Commands that only read the files they name (they write only through a redirection).
const READ_ONLY = new Set(['cat', 'less', 'more', 'bat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ls', 'dir',
  'tree', 'wc', 'diff', 'cmp', 'comm', 'stat', 'file', 'du', 'df', 'echo', 'printf', 'test', '[', '[[', 'true', 'false', 'readlink',
  'realpath', 'basename', 'dirname', 'sha1sum', 'sha256sum', 'sha512sum', 'md5sum', 'cksum', 'od', 'xxd', 'hexdump', 'strings', 'jq',
  'cut', 'tr', 'column', 'nl', 'fold', 'fmt', 'paste', 'join', 'expand', 'unexpand', 'rev', 'tac', 'base64', 'which', 'type',
  'whereis', 'printenv', 'date', 'sleep', 'pwd', 'popd', 'whoami', 'id', 'uname', 'ps', 'export', 'unset', 'set', 'local',
  'declare', 'readonly', 'read', 'shift', 'return', 'exit', 'wait', 'trap', 'alias', 'unalias', 'history', 'jobs', 'kill', 'source',
  '.', 'seq', 'yes', 'numfmt', 'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'test-path', 'write-output', 'write-host']);

// The words after a command word, as { args, a (their text), name, cmd, ctx }.
function call(cmd, i, w, ctx) {
  return { args: cmd.words.slice(i + 1), a: w.slice(i + 1), name: program(w[i]), cmd, ctx };
}

const WRITES = {
  rm: (c) => targets(operands(c.args, c.a), c.ctx, 'rm', { holds: true }),
  rmdir: (c) => targets(operands(c.args, c.a), c.ctx, 'rmdir', { holds: true }),
  unlink: (c) => targets(operands(c.args, c.a), c.ctx, 'unlink'),
  shred: (c) => targets(operands(c.args, c.a, new Set(['-n', '-s', '--iterations', '--size'])), c.ctx, 'shred'),
  truncate: (c) => targets(operands(c.args, c.a, new Set(['-s', '-r', '--size', '--reference'])), c.ctx, 'truncate'),
  touch: (c) => targets(operands(c.args, c.a, new Set(['-d', '-t', '-r', '--date', '--reference'])), c.ctx, 'touch'),
  mkdir: (c) => targets(operands(c.args, c.a, new Set(['-m', '--mode'])), c.ctx, 'mkdir'),
  chmod: (c) => targets(operands(c.args, c.a).slice(c.a.some((s) => s.startsWith('--reference')) ? 0 : 1), c.ctx, 'chmod'),
  chown: (c) => targets(operands(c.args, c.a).slice(c.a.some((s) => s.startsWith('--reference')) ? 0 : 1), c.ctx, 'chown'),
  chgrp: (c) => targets(operands(c.args, c.a).slice(c.a.some((s) => s.startsWith('--reference')) ? 0 : 1), c.ctx, 'chgrp'),
  tee: (c) => targets(operands(c.args, c.a), c.ctx, 'tee'),
  cp: (c) => copy(c, false),
  mv: (c) => copy(c, true),
  ln: (c) => copy(c, false, true),
  install: (c) => (c.a.includes('-d') || c.a.includes('--directory')
    ? targets(operands(c.args, c.a, new Set(['-m', '-o', '-g', '--mode', '--owner', '--group'])), c.ctx, 'install')
    : copy(c, false, true, new Set(['-m', '-o', '-g', '-S', '--mode', '--owner', '--group', '--suffix']))),
  rsync: (c) => targets(operands(c.args, c.a, new Set(['-e', '--rsh', '--exclude', '--include', '--filter', '-f'])), c.ctx, 'rsync', { holds: true }),
  dd: (c) => targets(c.args.filter((w) => /^of=/.test(w.text)).map((w) => asWord(w, w.text.slice(3))), c.ctx, 'dd'),
  sed: (c) => sed(c),
  awk: (c) => awk(c),
  gawk: (c) => awk(c),
  sort: (c) => targets(values(c.args, c.a, '-o', '--output'), c.ctx, 'sort -o'),
  uniq: (c) => targets(operands(c.args, c.a, new Set(['-f', '-s', '-w', '--skip-fields', '--skip-chars', '--check-chars'])).slice(1, 2), c.ctx, 'uniq'),
  patch: (c) => patchCmd(c),
  wget: (c) => targets(values(c.args, c.a, '-O', '--output-document'), c.ctx, 'wget -O'),
  curl: (c) => web(c) || targets(values(c.args, c.a, '-o', '--output'), c.ctx, 'curl -o') || curlRemoteName(c),
  gh: (c) => web(c),
  find: (c) => find(c),
};

// cp, mv, ln, install: the destination (and each name it gets inside a destination folder); for mv, and for a
// recursive cp, the sources too (a rule file moved away, a folder of rule files copied).
function copy(c, move, link, takes) {
  const ops = operands(c.args, c.a, takes || new Set(['-t', '--target-directory', '-S', '--suffix']));
  const into = values(c.args, c.a, '-t', '--target-directory')[0];
  const dest = into || (ops.length > 1 || !link ? ops[ops.length - 1] : null);
  const srcs = into ? ops : dest ? ops.slice(0, -1) : ops;
  const recursive = c.a.some((s) => s === '--recursive' || s === '--archive' || (/^-[A-Za-z]+$/.test(s) && /[rRa]/.test(s)));
  if (move || (recursive && !link)) {
    const f = targets(srcs, c.ctx, c.name, { holds: true });
    if (f) return f;
  }
  if (!dest) { // ln with one name: the link lands in the folder the command runs in
    for (const s of srcs) {
      const e = expand(s, c.ctx);
      if (e.unknown) return unsure(`${c.name} of ${e.unknown}`);
      for (const p of e.paths) if (c.ctx.here && isRulePath(path.join(c.ctx.here, path.basename(p)), c.ctx.home)) return rule(path.join(c.ctx.here, path.basename(p)));
    }
    return null;
  }
  const f = target(dest, c.ctx, c.name);
  if (f) return f;
  const d = expand(dest, c.ctx);
  for (const dp of d.paths || []) {
    if (!isDir(dp)) continue;
    for (const s of srcs) {
      const e = expand(s, c.ctx);
      if (e.unknown) return unsure(`${c.name} of ${e.unknown} into ${dp}`);
      for (const sp of e.paths) {
        const landed = path.join(dp, path.basename(sp));
        if (isRulePath(landed, c.ctx.home) || (recursive && holdsRuleFiles(sp, c.ctx.home) === true)) return rule(landed);
      }
    }
  }
  return null;
}

// sed -i: the files after the script (the script: the first operand, unless -e or -f gave it).
function sed(c) {
  const inPlace = c.a.some((s) => s === '--in-place' || s.startsWith('--in-place=') || (/^-[A-Za-z]/.test(s) && s.slice(1).split(/[ef]/)[0].includes('i')));
  if (!inPlace) return null;
  let script = false;
  const files = [];
  for (let k = 0; k < c.a.length; k++) {
    const s = c.a[k];
    if (s === '--') { files.push(...c.args.slice(k + 1)); break; }
    if (s.startsWith('--')) {
      if (/^--(?:expression|file)$/.test(s)) { script = true; k++; } else if (/^--(?:expression|file)=/.test(s)) script = true;
      else if (s === '--line-length') k++;
      continue;
    }
    if (s.length > 1 && s[0] === '-') {
      const flags = s.slice(1);
      const i = flags.indexOf('i');
      const before = i < 0 ? flags : flags.slice(0, i);
      const m = /[ef]/.exec(before);
      if (m) { script = true; if (m.index === flags.length - 1) k++; } else if (flags.endsWith('l') && i < 0) k++;
      continue;
    }
    files.push(c.args[k]);
  }
  return targets(script ? files : files.slice(1), c.ctx, 'sed -i');
}

// awk -i inplace: the files after the program.
function awk(c) {
  const inPlace = c.a.some((s, k) => (s === '-i' && c.a[k + 1] === 'inplace') || s === '--include=inplace' || s === '-iinplace');
  if (!inPlace) return null;
  const ops = operands(c.args, c.a, new Set(['-i', '-f', '-v', '-F', '--include', '--file', '--assign', '--field-separator']));
  const program = c.a.some((s) => s === '-f' || s.startsWith('--file')) ? 0 : 1;
  return targets(ops.slice(program), c.ctx, 'awk -i inplace');
}

// curl -O: the file is named after the address.
function curlRemoteName(c) {
  if (!c.a.some((s) => s === '-O' || s === '--remote-name' || (/^-[A-Za-z]+$/.test(s) && s.includes('O')))) return null;
  for (const w of operands(c.args, c.a, new Set(['-o', '--output', '-X', '--request', '-H', '--header', '-d', '--data', '-u', '--user', '-F', '--form']))) {
    const name = plain(w).split('?')[0].split('/').pop();
    if (name && c.ctx.here && isRulePath(path.join(c.ctx.here, name), c.ctx.home)) return rule(path.join(c.ctx.here, name));
  }
  return null;
}

// gh api or curl that writes to GitHub and names a rule file.
function web(c) {
  if (!c.a.some((s) => RULE_TEXT.test(s))) return null;
  if (c.name === 'gh' && c.a[0] !== 'api') return null;
  let method = '';
  let sends = false;
  for (let k = 0; k < c.a.length; k++) {
    const s = c.a[k];
    if (s === '-X' || s === '--method' || s === '--request') method = c.a[k + 1] || '';
    else if (/^--(?:method|request)=/.test(s)) method = s.slice(s.indexOf('=') + 1);
    else if (/^-X\w+$/.test(s)) method = s.slice(2);
    else if (/^(?:-f|-F|--field|--raw-field|--input|-d|-T|--form|--upload-file|--json)$/.test(s) || /^--(?:field|raw-field|input|data[\w-]*|json|form)(?:=|$)/.test(s)) sends = true;
  }
  if (/^(?:get|head)$/i.test(method)) return null;
  return method || sends ? rule(`a rule file on GitHub, through ${c.name}`) : null;
}

// find -delete, -exec and the like, under a folder that holds rule files.
function find(c) {
  const risky = c.a.some((s, k) => /^-(?:delete|fprint0?|fprintf|fls)$/.test(s) ||
    (/^-(?:exec|execdir|ok|okdir)$/.test(s) && !READ_ONLY.has(program(c.a[k + 1] || ''))));
  if (!risky) return null;
  const roots = [];
  for (const w of c.args) { const s = plain(w); if (s.startsWith('-') || s === '(' || s === '!') break; roots.push(w); }
  return targets(roots.length ? roots : [{ text: '.', quoted: false, glob: false, brace: false }], c.ctx, 'find', { holds: true });
}

// A patch's files, read from the patch texts given, files named, a < redirection, a here-document or a here-string.
function patchFinding(files, cmd, ctx, label) {
  const texts = [];
  const read = (w) => {
    const e = expand(w, ctx);
    if (e.unknown) return unsure(`${label} of ${e.unknown}`);
    for (const p of e.paths) {
      try {
        if (fs.statSync(p).size > PATCH_LIMIT) return unsure(`${label} of ${p}, too large to read`);
        texts.push(fs.readFileSync(p, 'utf8'));
      } catch (err) { return unsure(`${label} of ${p}, which cannot be read`); }
    }
    return null;
  };
  for (const w of files) { const f = read(w); if (f) return f; }
  for (const r of cmd.redirects) {
    if (r.op === '<' && r.target) { const f = read(r.target); if (f) return f; }
    if (r.op === '<<<' && r.target) texts.push(plain(r.target));
  }
  for (const h of cmd.heredocs) texts.push(h.body);
  if (!texts.length) return unsure(`${label} reads its changes from a pipe`);
  const named = /^(?:diff --git a\/(\S+) b\/(\S+)|\+\+\+ (\S+)|--- (\S+)|Index: (\S+)|rename (?:from|to) (\S+)|copy (?:from|to) (\S+))/;
  for (const t of texts) {
    for (const line of t.split('\n')) {
      const m = named.exec(line);
      if (!m) continue;
      for (const n of m.slice(1).filter(Boolean)) {
        if (n === '/dev/null') continue;
        const p = path.resolve(ctx.here || UNKNOWN_DIR, n.replace(/^[ab]\//, ''));
        if (isRulePath(p, ctx.home)) return rule(`${p}, in the patch`);
      }
    }
  }
  return null;
}

function patchCmd(c) {
  const ops = operands(c.args, c.a, new Set(['-p', '-i', '-o', '-d', '-B', '-r', '-D', '-F', '-z', '--input', '--output', '--directory', '--strip']));
  const into = targets(ops.slice(0, 1).concat(values(c.args, c.a, '-o', '--output')), c.ctx, 'patch');
  if (into) return into;
  const input = values(c.args, c.a, '-i', '--input').concat(ops.slice(1, 2));
  return patchFinding(input, c.cmd, c.ctx, 'patch');
}

// ---- git. ----

function git(dir, args) {
  return execFileSync('git', ['-c', 'safe.directory=*', '-c', 'core.quotepath=false', '-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}

const nul = (out) => String(out).split('\0').map((s) => s.trim()).filter(Boolean);
const lines = (out) => String(out).split('\n').map((s) => s.trim()).filter(Boolean);

function gitTop(dir) {
  try { return git(dir, ['rev-parse', '--show-toplevel']).trim(); } catch (e) { return ''; }
}

const COMMIT_TAKES = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--template', '--author', '--date',
  '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file']);
const PUSH_TAKES = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

// The files of the commit a git commit makes, from the folder it runs in.
function gitCommit(g) {
  if (!g.where) return unsure('a git commit in a folder the guard cannot tell');
  let all = false;
  let amend = false;
  const specs = [];
  for (let k = 0; k < g.a.length; k++) {
    const s = g.a[k];
    if (s === '--') { specs.push(...g.args.slice(k + 1)); break; }
    if (s === '--dry-run') return null;
    if (s.startsWith('--')) { if (s === '--all') all = true; else if (s === '--amend') amend = true; else if (COMMIT_TAKES.has(s)) k++; continue; }
    if (s.length > 1 && s[0] === '-') {
      for (let j = 1; j < s.length; j++) {
        if (s[j] === 'a') all = true;
        if ('mFCct'.includes(s[j])) { if (j === s.length - 1) k++; break; }
      }
      continue;
    }
    specs.push(g.args[k]);
  }
  const top = gitTop(g.where);
  if (!top) return unsure(`a git commit in ${g.where}, which git cannot read`);
  const names = new Set();
  const add = (list) => list.forEach((n) => names.add(n));
  try {
    add(nul(git(g.where, ['diff', '--cached', '--name-only', '-z'])));
    const added = g.ctx.adds.get(g.where);
    if (added) {
      const ps = added.length ? ['--', ...added] : [];
      add(nul(git(g.where, ['diff', '--name-only', '-z', ...ps])));
      add(nul(git(g.where, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z', ...ps])));
    }
    if (all || specs.some(dynamic)) add(nul(git(g.where, ['diff', '--name-only', '-z'])));
    else if (specs.length) add(nul(git(g.where, ['diff', '--name-only', '-z', '--', ...specs.map(plain)])));
    if (amend) add(nul(git(g.where, ['show', '--pretty=format:', '--name-only', '-z', 'HEAD'])));
  } catch (e) { return unsure(`a git commit in ${g.where}, which git cannot read`); }
  for (const n of names) { const p = path.join(top, n); if (isRulePath(p, g.ctx.home)) return rule(`${p}, in the commit`); }
  return null;
}

// The files changed by the commits a git push sends that no remote has yet.
function gitPush(g) {
  if (!g.where) return unsure('a git push from a folder the guard cannot tell');
  let all = false;
  let tags = false;
  const pos = [];
  for (let k = 0; k < g.a.length; k++) {
    const s = g.a[k];
    if (s === '--') { pos.push(...g.args.slice(k + 1)); break; }
    if (/^--(?:all|mirror|branches)$/.test(s)) all = true;
    else if (s === '--tags' || s === '--follow-tags') tags = true;
    else if (s === '--dry-run' || s === '--delete') return null;
    else if (PUSH_TAKES.has(s)) k++;
    else if (/^-[A-Za-z]+$/.test(s)) { if (/[nd]/.test(s)) return null; } // -n: a dry run; -d: a deletion
    else if (!s.startsWith('-')) pos.push(g.args[k]);
  }
  const revs = [];
  if (all) revs.push('--branches');
  if (tags) revs.push('--tags');
  for (const w of pos.slice(1)) {
    if (dynamic(w)) return unsure(`a git push of ${plain(w)}`);
    const r = plain(w).replace(/^\+/, '');
    const src = r.includes(':') ? r.slice(0, r.indexOf(':')) : r;
    if (src) revs.push(src === '@' ? 'HEAD' : src);
  }
  if (pos.length && dynamic(pos[0])) return unsure(`a git push to ${plain(pos[0])}`);
  if (!revs.length && pos.length <= 1) revs.push('HEAD');
  if (!revs.length) return null; // deletions only
  const top = gitTop(g.where);
  if (!top) return unsure(`a git push from ${g.where}, which git cannot read`);
  let names;
  try { names = lines(git(g.where, ['log', '--pretty=format:', '--name-only', '--no-renames', ...revs, '--not', '--remotes', '--'])); } catch (e) {
    return unsure(`a git push from ${g.where}, whose commits git cannot list`);
  }
  for (const n of names) { const p = path.join(top, n); if (isRulePath(p, g.ctx.home)) return rule(`${p}, in a commit this push sends`); }
  return null;
}

// git clean: what a dry run says it would remove.
function gitClean(g) {
  if (g.a.some((s) => s === '-n' || s === '--dry-run' || (/^-[A-Za-z]+$/.test(s) && s.includes('n')))) return null;
  if (!g.where) return unsure('a git clean in a folder the guard cannot tell');
  const args = g.a.filter((s) => s !== '--force' && s !== '-i' && s !== '--interactive')
    .map((s) => (/^-[A-Za-z]+$/.test(s) ? s.replace(/[fi]/g, '') : s)).filter((s) => s !== '-');
  let out;
  try { out = git(g.where, ['clean', '-n', ...args]); } catch (e) { return unsure(`a git clean in ${g.where}, which git cannot read`); }
  for (const l of lines(out)) {
    const m = /^Would (?:remove|skip repository) (.+)$/.exec(l);
    if (!m) continue;
    const p = path.resolve(g.where, m[1]);
    if (isRulePath(p, g.ctx.home) || (m[1].endsWith('/') && holdsRuleFiles(p, g.ctx.home) !== false)) return rule(`${p}, which git clean removes`);
  }
  return null;
}

function gitCmd(c) {
  const ctx = c.ctx;
  let k = 0;
  let where = ctx.here;
  while (k < c.a.length && c.a[k].startsWith('-')) {
    if (c.a[k] === '-C' && k + 1 < c.a.length) {
      const e = expand(c.args[k + 1], ctx);
      where = e.unknown || e.relUnknown ? null : e.paths[0];
      k += 2;
    } else if (c.a[k] === '-c' || /^--(?:git-dir|work-tree|namespace|exec-path|config-env)$/.test(c.a[k])) k += 2;
    else k++;
  }
  const sub = c.a[k];
  const g = { ctx, where, args: c.args.slice(k + 1), a: c.a.slice(k + 1), cmd: c.cmd };
  const here = Object.assign({}, ctx, { here: where });
  if (ctx.gitOnly && sub !== 'add' && sub !== 'commit' && sub !== 'push') return null;
  if (sub === 'add') {
    const ops = operands(g.args, g.a, new Set(['--chmod', '--pathspec-from-file']));
    const every = g.a.some((s) => ['-A', '--all', '-u', '--update'].includes(s)) || !ops.length || ops.some((w) => plain(w) === '.' || dynamic(w));
    const key = where || '';
    const before = ctx.adds.get(key);
    ctx.adds.set(key, every || (before && !before.length) ? [] : (before || []).concat(ops.map(plain)));
    return null;
  }
  if (sub === 'commit') return gitCommit(g);
  if (sub === 'push') return gitPush(g);
  if (sub === 'rm') return g.a.includes('--cached') ? null : targets(operands(g.args, g.a, new Set(['--pathspec-from-file'])), here, 'git rm', { holds: true });
  if (sub === 'mv') return targets(operands(g.args, g.a), here, 'git mv', { holds: true });
  if (sub === 'checkout') {
    const dd = g.a.indexOf('--');
    if (dd >= 0) return targets(g.args.slice(dd + 1), here, 'git checkout');
    if (g.a.some((s) => ['-b', '-B', '--orphan'].includes(s))) return null;
    const ops = operands(g.args, g.a, new Set(['--conflict', '--pathspec-from-file']));
    return targets(ops.length > 1 ? ops.slice(1) : ops, here, 'git checkout');
  }
  if (sub === 'restore') {
    const staged = g.a.some((s) => s === '--staged' || s === '-S');
    const worktree = g.a.some((s) => s === '--worktree' || s === '-W');
    if (staged && !worktree) return null; // the index only: the file stays as it is
    return targets(operands(g.args, g.a, new Set(['-s', '--source', '--pathspec-from-file'])), here, 'git restore');
  }
  if (sub === 'apply' || sub === 'am') {
    if (sub === 'apply' && g.a.some((s) => /^--(?:check|stat|numstat|summary)$/.test(s)) && !g.a.includes('--apply')) return null;
    const files = operands(g.args, g.a, new Set(['-p', '-C', '--directory', '--exclude', '--include', '--whitespace']));
    return patchFinding(files, c.cmd, here, `git ${sub}`);
  }
  if (sub === 'clean') return gitClean(g);
  return null;
}

// ---- Shells, code and other commands. ----

function shellCmd(c) {
  for (let k = 0; k < c.a.length; k++) {
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(c.a[k])) {
      const j = c.a.findIndex((s, n) => n > k && !s.startsWith('-'));
      return j < 0 ? null : commandLine(plain(c.args[j]), c.ctx);
    }
  }
  const ops = operands(c.args, c.a);
  if (ops.length && plain(ops[0]) !== '-') return scriptArgs(c, ops.slice(1)); // a script file runs: its lines are not read
  for (const h of c.cmd.heredocs) { const f = commandLine(h.body, c.ctx); if (f) return f; }
  for (const r of c.cmd.redirects) if (r.op === '<<<' && r.target) { const f = commandLine(plain(r.target), c.ctx); if (f) return f; }
  return null;
}

// node -e, python -c, perl -e, ruby -e, php -r: the code; no code and no script file: the code fed on stdin by a
// here-document or here-string. perl -i and ruby -i also write the files they name.
function codeCmd(c) {
  const flags = CODE[c.name];
  let code = null;
  let script = null;
  let inPlace = false;
  const rest = [];
  for (let k = 0; k < c.args.length; k++) {
    const s = c.a[k];
    if (code === null && script === null) {
      if (flags.includes(s)) { if (k + 1 < c.args.length) code = plain(c.args[++k]); continue; }
      if ((c.name === 'perl' || c.name === 'ruby') && /^-[A-Za-z]/.test(s) && !s.startsWith('--')) {
        if (s.includes('i')) inPlace = true;
        const e = s.search(/[eE]/);
        if (e > 0) { code = e === s.length - 1 ? (k + 1 < c.args.length ? plain(c.args[++k]) : '') : s.slice(e + 1); }
        continue;
      }
      if (s.length > 1 && s.startsWith('-')) continue;
      script = s;
      continue;
    }
    rest.push(c.args[k]);
  }
  if (inPlace) { const f = targets(rest, c.ctx, `${c.name} -i`); if (f) return f; }
  if (code === null && (script === null || script === '-')) {
    const fed = c.cmd.heredocs.map((h) => h.body).concat(c.cmd.redirects.filter((r) => r.op === '<<<' && r.target).map((r) => plain(r.target)));
    if (fed.length) code = fed.join('\n');
  }
  if (code !== null) return codeFinding(code, rest, c.ctx, `${c.name} code`);
  return scriptArgs(c, rest); // a script file runs: its code is not read
}

// A script file that runs (its code not read) and is given a rule file: unsure.
function scriptArgs(c, rest) {
  for (const w of rest) { const p = ruleNamed(w, c.ctx); if (p) return unsure(`${c.name} runs a script with ${p}`); }
  return null;
}

// What one command would change: a finding, or null.
function checkCmd(cmd, ctx) {
  if (!ctx.gitOnly) {
    for (const r of cmd.redirects) {
      if (!/^(?:>|>>|>\||&>|&>>|<>|>&)$/.test(r.op) || !r.target) continue;
      if (r.op === '>&' && /^(?:\d+|-)$/.test(plain(r.target))) continue; // 2>&1, >&2: a stream, not a file
      const f = target(r.target, ctx, 'a redirection');
      if (f) return f;
    }
  }
  const w = cmd.words.map(plain);
  let i = 0;
  while (i < w.length && (KEYWORDS.has(w[i]) || SKIPPED.has(w[i]) || ASSIGN.test(w[i]))) {
    if (SKIPPED.has(w[i])) return null;
    i += w[i] === 'function' ? 2 : 1;
  }
  while (i < w.length && WRAPPERS.has(program(w[i]))) {
    const wrapper = program(w[i]);
    let k = i + 1;
    const next = w.findIndex((s, n) => n > i && (isGit(s) || CODE[program(s)] || SHELLS.has(program(s)) || WRITES[program(s)] || CHANGE_DIR.has(program(s))));
    if (next > 0) k = next;
    else while (k < w.length && (w[k].startsWith('-') || ASSIGN.test(w[k]) || /^\d+(?:\.\d+)?[smhd]?$/.test(w[k]))) k++;
    if (wrapper === 'xargs' && !ctx.gitOnly) {
      return next > 0 ? unsure(`xargs runs ${program(w[next])} on names it reads`) : null;
    }
    i = k;
  }
  if (i >= w.length) return null;
  const c = call(cmd, i, w, ctx);
  if (CHANGE_DIR.has(c.name)) {
    const t = operands(c.args, c.a)[0];
    if (!t) { ctx.here = c.name === 'cd' || c.name === 'chdir' ? ctx.home : null; ctx.hereRuleish = false; return null; }
    const e = plain(t) === '-' ? { unknown: '-' } : expand(t, ctx);
    if (e.unknown || e.relUnknown) { ctx.hereRuleish = ctx.hereRuleish || RULE_TEXT.test(e.unknown || plain(t)); ctx.here = null; } else { ctx.here = e.paths[0]; ctx.hereRuleish = false; }
    return null;
  }
  if (isGit(w[i])) return gitCmd(c);
  if (ctx.gitOnly) return null;
  if (SHELLS.has(c.name)) return shellCmd(c);
  if (c.name === 'eval') return commandLine(c.a.join(' '), ctx);
  if (c.name === 'pwsh' || c.name === 'powershell') {
    const k = c.a.findIndex((s) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(s));
    return k < 0 ? null : powershell(c.a.slice(k + 1).join(' '), ctx);
  }
  if (c.name === 'cmd') {
    const k = c.a.findIndex((s) => /^\/[ck]$/i.test(s));
    return k < 0 ? null : psFinding(c.a.slice(k + 1).join(' '), 'a cmd line');
  }
  if (CODE[c.name]) return codeCmd(c);
  if (WRITES[c.name]) return WRITES[c.name](c);
  if (READ_ONLY.has(c.name)) return null;
  for (const word of c.args) {
    const p = ruleNamed(word, ctx);
    if (p) return unsure(`${c.name || 'a command'} with ${p}`);
  }
  return null;
}

// The commands in order, each after the commands its substitutions run.
function checkCmds(cmds, ctx) {
  for (const cmd of cmds) {
    for (const inner of cmd.inner) {
      const f = checkCmds(inner, Object.assign({}, ctx, { adds: new Map(), depth: ctx.depth + 1 }));
      if (f) return f;
    }
    const f = checkCmd(cmd, ctx);
    if (f) return f;
  }
  return null;
}

// A command line, read and checked in a shell of its own (a cd in it stays in it).
function commandLine(text, ctx) {
  const t = String(text || '');
  if (ctx.depth >= MAX_DEPTH) return RULE_TEXT.test(t) || GIT_WRITE.test(t) ? unsure('text that runs inside text that runs, too deep') : null;
  const r = lex(t, 0, '', 0);
  const f = checkCmds(r.cmds, Object.assign({}, ctx, { adds: new Map(), depth: ctx.depth + 1 }));
  if (f) return f;
  if (r.error && (RULE_TEXT.test(t) || GIT_WRITE.test(t))) return unsure(r.error);
  return null;
}

// A PowerShell command line: a rule file named by a command that writes; then its cd, git add, commit and push.
function powershell(text, ctx) {
  const f = psFinding(text, 'a PowerShell command');
  if (f) return f;
  const t = String(text).replace(/\\/g, '/').replace(/`/g, '');
  const r = lex(t, 0, '', 0);
  const g = checkCmds(r.cmds, Object.assign({}, ctx, { adds: new Map(), depth: ctx.depth + 1, gitOnly: true }));
  if (g) return g;
  if (r.error && GIT_WRITE.test(t)) return unsure(r.error);
  return null;
}

// ---- The hook. ----

// What the tool call would change: { rule } or { unsure }, or null. options: { env, home } for the tests.
function finding(input, options) {
  const o = options || {};
  const env = o.env || process.env;
  const home = o.home || env.HOME || env.USERPROFILE || os.homedir();
  const tool = String((input && input.tool_name) || '');
  const ti = (input && input.tool_input) || {};
  const cwd = path.resolve(String((input && input.cwd) || env.CLAUDE_PROJECT_DIR || process.cwd()));
  const ctx = { here: cwd, hereRuleish: false, home, env, adds: new Map(), depth: 0, gitOnly: false };
  if (EDIT_TOOLS.has(tool)) {
    const file = [ti.file_path, ti.notebook_path, ti.path].find((v) => typeof v === 'string' && v);
    if (!file) return unsure(`${tool} names no file`);
    const p = path.resolve(cwd, file.replace(/^~(?=$|[\\/])/, home));
    return isRulePath(p, home) ? rule(p) : null;
  }
  if (tool === 'Bash') return commandLine(typeof ti.command === 'string' ? ti.command : '', Object.assign(ctx, { depth: -1 }));
  if (tool === 'PowerShell') return powershell(typeof ti.command === 'string' ? ti.command : '', ctx);
  return null;
}

// George's latest message in the transcript; null when there is none or it cannot be read.
function georgeSaid(input) {
  if (!R) return null;
  try { return R.lastTyped(R.readTranscript(input && input.transcript_path).split('\n')); } catch (e) { return null; }
}

// The refusal for a PreToolUse input, or '' when the call passes.
function decide(input, options) {
  const f = finding(input, options);
  if (!f) return '';
  const said = georgeSaid(input);
  if (said && PHRASE.test(said)) return '';
  return f.rule ? reasonRule(f.rule) : reasonUnsure(f.unsure);
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  let raw = '';
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    let reason = '';
    try {
      reason = decide(JSON.parse(raw || '{}') || {});
    } catch (e) {
      // the call cannot be read: refused when it may touch a rule file
      reason = RULE_TEXT.test(raw) || GIT_WRITE.test(raw) ? reasonUnsure('the guard could not read this call') : '';
    }
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

module.exports = { decide, finding, isRulePath, holdsRuleFiles, lex, PHRASE, SAY, reasonRule, reasonUnsure };
