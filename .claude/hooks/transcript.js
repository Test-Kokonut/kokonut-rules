#!/usr/bin/env node
// transcript.js: what the hooks read from a chat's own transcript (the hook input's transcript_path, a JSONL file):
// the main chat's last reply, George's last message, and whether a message of his is a yes.
// Written in kokonut-rules; required by purpose.js and yes-gate.js, installed with them by setup.sh. Not a hook.
// It reads only the file's tail (the last 512 KB, doubled up to 8 MB until it holds what is asked), never the whole
// chat. A helper's hook input names the helper's own transcript and the chat's session_id: mainTranscript() gives
// the chat's file (<folder>/<session_id>.jsonl) when it is there, so a helper is judged by George's words, not by
// its brief.
// George's message: a user entry of the main chat (not isSidechain) whose content is a string or text blocks only
// (a tool result is not his), and whose text does not start like something the cloud, a hook, a helper or another
// chat put there (INJECTED below).
// A yes: his message starts with a yes word (YES below: yes, ok, go, do it, agree, merge it, deploy it, ...), is at
// most 12 words, and the rest of it holds no but, not, no, except, unless, wait, why, what, or a question mark.
// "go, build it" and "yes - let's move on" are a yes; "done", "yes, but ..." and "ok?" are not.
// Node only, no packages. Any error in a reader gives null or false, never a throw to the hook.
'use strict';
const fs = require('fs');
const path = require('path');

const START = 512 * 1024;
const MAX_READ = 8 * 1024 * 1024;
const INJECTED = ['<', '[', '{', 'Another Claude session', 'This session is being continued', 'Stop hook feedback',
  'Caveat:', 'KOKONUT ', 'Base directory for this skill', 'SessionStart:', 'Command executed'];
const YES = /^(?:yes|y|yep|yeah|yup|ok|okay|k|kk|go|go ahead|do it|do that|do so|sure|agree|agreed|fine|proceed|approved|approve|confirm|confirmed|correct|right|merge(?: it| them| both| all)?|send(?: it| them)?|delete(?: it| them| all| both)?|deploy(?: it)?|run it|ship it|build it|rule change ok)$/i;
const NOT_YES = /\b(?:but|not|no|don'?t|except|unless|wait|why|what|how|which)\b|\?/i;

// The last lines of the file, newest last, each parsed as JSON when it is one; null when the file cannot be read.
function tailEntries(file, holds) {
  if (typeof file !== 'string' || !file) return null;
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }
  try {
    const size = fs.statSync(file).size;
    for (let want = START; ; want *= 2) {
      const len = Math.min(want, size, MAX_READ);
      const buf = Buffer.alloc(len);
      const got = fs.readSync(fd, buf, 0, len, size - len);
      let text = buf.toString('utf8', 0, got);
      if (len < size) text = text.slice(text.indexOf('\n') + 1); // the first line is cut: drop it
      const entries = [];
      for (const l of text.split('\n')) {
        const s = l.trim();
        if (!s.startsWith('{')) continue;
        try { entries.push(JSON.parse(s)); } catch (e) { /* a cut or odd line */ }
      }
      if (!holds || holds(entries) || len >= size || len >= MAX_READ) return entries;
    }
  } catch (e) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// The text of an entry's message: a string, or its text blocks joined; '' when it holds a tool result or no text.
function textOf(entry) {
  const m = entry && entry.message;
  if (!m) return '';
  const c = m.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  if (c.some((b) => b && b.type === 'tool_result')) return '';
  return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function isGeorge(entry) {
  if (!entry || entry.type !== 'user' || entry.isSidechain) return false;
  const t = textOf(entry).trim();
  if (!t) return false;
  return !INJECTED.some((p) => t.startsWith(p));
}

function isMainAssistant(entry) {
  return !!entry && entry.type === 'assistant' && !entry.isSidechain && textOf(entry).trim() !== '';
}

// George's last message in the file, '' when the tail holds none.
function lastGeorgeText(file) {
  const entries = tailEntries(file, (es) => es.some(isGeorge));
  if (!entries) return '';
  for (let i = entries.length - 1; i >= 0; i--) if (isGeorge(entries[i])) return textOf(entries[i]).trim();
  return '';
}

// The main chat's last reply with text, '' when the tail holds none.
function lastAssistantText(file) {
  const entries = tailEntries(file, (es) => es.some(isMainAssistant));
  if (!entries) return '';
  for (let i = entries.length - 1; i >= 0; i--) if (isMainAssistant(entries[i])) return textOf(entries[i]).trim();
  return '';
}

// The chat's own transcript for a hook input: a helper's input (agent_id) names the helper's file; the chat's file
// sits beside it, named by session_id.
function mainTranscript(input) {
  const file = input && typeof input.transcript_path === 'string' ? input.transcript_path : '';
  if (!file) return '';
  if (input.agent_id && typeof input.session_id === 'string' && input.session_id) {
    const main = path.join(path.dirname(file), input.session_id + '.jsonl');
    if (fs.existsSync(main)) return main;
  }
  return file;
}

// Whether a message of George's is a yes (see the top of the file).
function isYes(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim().replace(/[.!…\s]+$/, '');
  if (!t || t.split(/\s+/).length > 12) return false;
  const words = t.split(/\s+/);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const head = words.slice(0, n).join(' ').replace(/[,:;!.-]+$/, '');
    if (!YES.test(head)) continue;
    const rest = words.slice(n).join(' ').replace(/^[\s,:;-]+/, '');
    if (rest.length > 60 || NOT_YES.test(rest)) return false;
    return true;
  }
  return false;
}

module.exports = { tailEntries, textOf, isGeorge, lastGeorgeText, lastAssistantText, mainTranscript, isYes, INJECTED };
