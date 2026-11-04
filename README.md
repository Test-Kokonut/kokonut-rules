# kokonut-rules: the rulebook and hooks every Kokonut cloud chat installs

The one source of Kokonut's rulebook (`CLAUDE.md`), its Claude Code settings and hooks, and the installer
(`setup.sh`) that the cloud environment runs, so that every chat gets them, whatever repos it has. Public: a chat
downloads it with no login.

## What lives here
- `CLAUDE.md`: the rulebook, 15 rules: how a reply looks (1 to 6), how work starts and goes (7 to 11), safety (12
  to 15). The only source of rule text: a hook or page that needs a rule points at it, never restates it.
- `.claude/settings.json`: the permissions (what a chat does without asking, what is never allowed; nothing asks
  in the app: the gate asks in chat), the hook wiring, in the project form
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.js"`, and every new chat's model: Opus (`model`). The effort of a
  chat is George's app's choice. The installer turns it into the machine-wide /root/.claude/settings.json.
- `.claude/hooks/`: five hooks and one shared reader, each explained at the top of its file:
  - `session-start.js`: at every chat start, the reader identity for live data, then a short note: where things are.
  - `purpose.js`: on each of George's messages, keeps the chat's Purpose and Done when in front of it. The first
    reply holding the lines "Purpose:" and "Done when:" is pinned; once pinned, new lines pin on his yes (rule 9).
  - `no-main.js`: refuses every push to main or master (a pull request lands it).
  - `guard.js`: refuses Upwork API or login addresses, and a commit or push that holds a key.
  - `yes-gate.js`: refuses a call that sends, deletes, deploys or changes what others use (mail, Slack, Drive,
    Docs, Sheets, Calendar, GitHub merges, chats and scheduled tasks, Upwork, deploys, BigQuery and SQL writes, a
    status page) unless the purpose is pinned and George's last message is a yes or names the action with its own
    words ("deploy", "merge", "sheet", ...: a word match, no reading into his words; rules 9 and 12). Reading,
    answering, editing files, commits, pushing the chat's branch, opening a pull request and helpers pass.
  - `transcript.js`: what the hooks read from the chat's transcript (George's last message, the last reply, what
    counts as his yes).
- `scripts/score.js` and `scripts/score-task.md`: the nightly score. A scheduled task starts a fresh chat once a
  day; it reads yesterday's chats and replies one line per chat: how many replies start with a status icon, run over
  40 words, promise a time, only report progress, or talk about the machinery. George reads the line, nothing else
  happens. The task's prompt, and when it is created, are in score-task.md.
- `setup.sh`: the installer, below.
- `tests/`, `scripts/changed-tests.js`, `package.json`: the hooks' and settings' tests (`npm test` runs them all) and
  the picker of the tests a change calls for.
- `.github/workflows/tests.yml` (check: test) runs the tests of what changed on a pull request and on a push to a
  branch other than main; `.github/workflows/pr-cause.yml` (check: cause) fails a pull request whose description
  lacks a "Cause:" line or a "Fix:" line, and, when the pull request changes `CLAUDE.md`, one whose description does
  not quote every line it removes and every line it adds. main is locked by kokonut-temp's repos workflow: a pull
  request, and both checks green.

## The setup script
- Where George pastes it, once: claude.ai/code, the environment selector, the environment "Kokonut", its settings
  icon, Setup script. The whole box, then Save changes:

```bash
if [ -n "$KOKONUT_READER_KEY" ]; then
  umask 077
  printf '%s' "$KOKONUT_READER_KEY" > "$HOME/.kokonut-reader.json"
  gcloud auth activate-service-account --key-file="$HOME/.kokonut-reader.json" --quiet
  gcloud config set project kokonut-data-base --quiet
fi
curl -fsS --retry 3 --max-time 60 -o /tmp/kokonut-setup.sh https://raw.githubusercontent.com/Test-Kokonut/kokonut-rules/main/setup.sh || cp /root/.claude/kokonut/setup.sh /tmp/kokonut-setup.sh 2>/dev/null || { echo "KOKONUT RULES NOT INSTALLED: setup.sh could not be downloaded from github.com/Test-Kokonut/kokonut-rules" >&2; exit 1; }
bash /tmp/kokonut-setup.sh
```

- What it does: signs in the reader identity, then downloads `setup.sh` from main and runs it. `setup.sh` downloads
  main's `CLAUDE.md`, `.claude/settings.json` and hooks from raw.githubusercontent.com and installs them
  machine-wide in /root/.claude: CLAUDE.md, hooks/, settings.json (its hook commands made absolute, the repos' own
  CLAUDE.md copies excluded, the installed files closed to Claude's edit tools) and kokonut/ (the installer and what
  it saw: kokonut/setup.txt). Never /home/user/.claude: Claude Code reads it as /home/user's project settings, and
  the hooks would fire twice.
- At every chat start the SessionStart hook runs the installed `setup.sh` again: it downloads main once more and
  installs what changed, so a chat runs main's rules even when the cloud kept a container's setup for days. Silent
  when it works. When it cannot download, one line, and the chat runs on the copy installed before.
- When it fails: a setup that cannot download and has no earlier install exits 1 with one line, "KOKONUT RULES NOT
  INSTALLED: ...", and wires the chat-start refresh alone, which tries again; a chat that starts with no rulebook is
  told "KOKONUT RULES MISSING: ... Stop and tell George before any work."
- Why raw.githubusercontent.com: a chat's HTTPS proxy lets codeload.github.com and github.com reach only the repos the
  chat attached; raw.githubusercontent.com serves any public repo's files. Its copies may lag main by up to five
  minutes, so a chat that starts within five minutes of a merge may get part of it.
- Paste the box again only when the box above changes. A change to `setup.sh` itself reaches chats on its own: each run
  hands off to the `setup.sh` it downloaded.

## How a rule changes
1. Only on George's go in the chat, and only here, on the chat's own branch. No chat can change main: no-main.js
   refuses the push, and main takes only a pull request.
2. Its pull request description holds its "Cause:" and "Fix:" lines and quotes every line of `CLAUDE.md` it removes
   and adds, in plain words, so George reads the change in 30 seconds before he merges; the check (cause) fails
   otherwise. The tests of what changed (test) pass.
3. Nothing to carry: every chat that starts after the merge installs it.

## Tests by hand
- A test install goes elsewhere, never into /root/.claude: `KOKONUT_DEST=<folder> bash setup.sh`, and
  `KOKONUT_RULES_BRANCH=<branch>` downloads a branch instead of main (a test install only). The installed refresh:
  `KOKONUT_RULES_BRANCH=<branch> bash <folder>/kokonut/setup.sh session-start`.
- A hook by hand, on a chat's own transcript: `echo '{"hook_event_name":"UserPromptSubmit","prompt":"ok",
  "transcript_path":"<file>"}' | HOME=<scratch> node .claude/hooks/purpose.js`; the gate:
  `echo '{"tool_name":"mcp__Gmail__send_message","tool_input":{},"transcript_path":"<file>"}' | HOME=<scratch> node
  .claude/hooks/yes-gate.js`.
- The score on a saved chat: `node scripts/score.js <file>`.

## Undo
- New chats: paste back the earlier setup script (or empty the box) and Save changes; new chats then start without
  the install.
- In a running chat, on George's go: delete /root/.claude/CLAUDE.md, settings.json, hooks/, kokonut-purpose.md and
  kokonut/ (put kokonut/settings.json.before-kokonut back first, if there is one).
