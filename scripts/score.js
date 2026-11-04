#!/usr/bin/env node
// score.js: scores a chat's replies against the reply rules (CLAUDE.md, rules 1 to 4), one line per chat, so George
// sees drift without reading chats.
//   node scripts/score.js <file> ...     each file: a saved list_events result (the JSON a cloud chat's
//                                        mcp__claude-code-remote__list_events call returns, wrapped or not) or a JSONL
//                                        of {"who": "assistant", "text": "..."} lines. One line per file:
//   <name>: <n> replies | icon first <p>% | over 40 words <p>% | time estimates <n> | progress lines <n> | machinery <p>%
// The name is the file's name without its extension (--name <text> before a file names it instead).
// What each number is:
//   icon first      the first non-empty line starts with one of 👉 ✅ ⚠️ ⛔ 💬 (rule 1)
//   over 40 words   the reply has more than 40 words; a list is counted too, so a long list George asked for counts
//                   against the chat: read the number as a trend, not a verdict (rule 2)
//   time estimates  replies that promise a time: "about 20 minutes", "2 to 3 min", "in 30 seconds" (rule 4)
//   progress lines  replies of at most 12 words that only say what the chat is doing (⏳, "Now ...", "Still ...") (rule 4)
//   machinery       replies that name tools, hooks, commits, branches, pull requests, helpers or agents (rule 3)
// A Stop or other hook never runs this: it is for the nightly scoring chat (scripts/score-task.md). Node only, no
// packages. Exit 1 on a file it cannot read.
'use strict';
const fs = require('fs');
const path = require('path');

const ICONS = ['👉', '✅', '⚠️', '⚠', '⛔', '💬'];
const TIME = /\b(?:about|around|roughly|approx\.?|in|takes?|took|within)?\s*~?\d+\s*(?:to|-|–)?\s*\d*\s*(?:s|sec|secs|seconds?|min|mins|minutes?|h|hrs?|hours?)\b/i;
const TIME_SAFE = /\b\d+\s*(?:s|sec|secs|seconds?|min|mins|minutes?|h|hrs?|hours?)\b\s*(?:ago|yesterday|earlier|old|late|cap|window)/i;
const PROGRESS = /^(?:⏳|now\b|still\b|next:|reading\b|building\b|checking\b|running\b|waiting\b|updating\b|fixing\b)/i;
const MACHINERY = /\b(?:hooks?|commits?|branch(?:es)?|pull requests?|PRs?|tools?|helpers?|agents?|subagents?|MCP|transcripts?)\b/;

function assistantTexts(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const texts = [];
  if (file.endsWith('.jsonl')) {
    for (const l of raw.split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r.who === 'assistant' && typeof r.text === 'string') texts.push(r.text); } catch (e) { /* skip */ }
    }
    return texts;
  }
  const d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const events = (d.ccr && d.ccr.data) || d.data || d.events || [];
  for (const e of events) {
    const a = e.assistant;
    if (!a) continue;
    const m = (a.internal_anthropic_catchall && a.internal_anthropic_catchall.message) || a.message || {};
    const c = m.content;
    const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '';
    if (t.trim()) texts.push(t);
  }
  return texts;
}

function score(texts) {
  const n = texts.length;
  const s = { replies: n, iconFirst: 0, over40: 0, time: 0, progress: 0, machinery: 0 };
  for (const t of texts) {
    const first = t.split('\n').map((l) => l.trim()).find((l) => l) || '';
    if (ICONS.some((i) => first.startsWith(i))) s.iconFirst++;
    const words = t.trim().split(/\s+/).filter(Boolean).length;
    if (words > 40) s.over40++;
    if (TIME.test(t) && !TIME_SAFE.test(t)) s.time++;
    if (words <= 12 && PROGRESS.test(first.replace(/^[*_]+/, '')) && !t.includes('?')) s.progress++;
    if (MACHINERY.test(t)) s.machinery++;
  }
  return s;
}

const pct = (a, n) => (n ? Math.round((100 * a) / n) : 0);

function line(name, s) {
  return `${name}: ${s.replies} replies | icon first ${pct(s.iconFirst, s.replies)}% | over 40 words ${pct(s.over40, s.replies)}% | ` +
    `time estimates ${s.time} | progress lines ${s.progress} | machinery ${pct(s.machinery, s.replies)}%`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('usage: node scripts/score.js [--name <text>] <file> ...'); process.exit(2); }
  let name = '';
  let failed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') { name = args[++i] || ''; continue; }
    try {
      console.log(line(name || path.basename(args[i]).replace(/\.[^.]+$/, ''), score(assistantTexts(args[i]))));
    } catch (e) {
      console.error(`${args[i]}: ${e.message}`);
      failed = true;
    }
    name = '';
  }
  process.exit(failed ? 1 : 0);
}

module.exports = { score, line, assistantTexts };
