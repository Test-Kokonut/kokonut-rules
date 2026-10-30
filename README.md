# kokonut-rules: the rulebook and hooks every Kokonut cloud chat installs

The one source of Kokonut's rulebook (`CLAUDE.md`), its Claude Code settings and hooks, and the installer
(`setup.sh`) that the cloud environment runs, so that every chat gets them, whatever repos it has. Public: a chat
downloads it with no login.

## What lives here
- `CLAUDE.md`: the rulebook every chat loads; the only source of rule text: a hook, check or page that needs a rule
  points at it, never restates it.
- `.claude/settings.json`: the permissions (what a chat does without asking, what always asks first, what is never
  allowed), the hook wiring, in the project form `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.js"`, and every new
  chat's defaults: model Opus (`model`) and effort extra high (`effortLevel` `xhigh`); George changes either per chat
  (/model, /effort). The installer turns it into the machine-wide /root/.claude/settings.json.
- `.claude/hooks/`: the hooks. `session-start.js` (the reader identity, then the start note: where things are and the
  open projects, one line each), `reminder.js` (the reply rules before every message), `status-check.js` (at the end
  of a turn: a chat that changed things since its last status page save is refused once, with a note to save it
  again), `handover-check.js` (the hand-over, below), `no-main.js` (no push to main), `guard.js` (no Upwork API or
  login, no key in a commit) and `rule-guard.js` (rule files change only after George types "rule change ok"). What
  each does is written at the top of its file.
- `.claude/commands/`: the slash commands. `continue.md`: `/continue <name>` takes a project over, or starts it: its
  status page's brief (Folder, Chat, Purpose, Done when, State, Next step), its working notes in its Drive folder,
  and the page's Chat line set to this chat; a new project settles Purpose and Done when with George first, then gets
  its Drive folder and its page. `handover.md`: `/handover` hands the project over to a new chat (below).
- `setup.sh`: the installer, below. A rule file, as CLAUDE.md and .claude/ are: the rule guard refuses a change to it
  without George's "rule change ok".
- `tests/`, `scripts/changed-tests.js`, `package.json`: the hooks' and settings' tests (`npm test` runs them all) and
  the picker of the tests a change calls for.
- `.github/workflows/tests.yml` (check: test) runs the tests of what changed on a pull request and on a push to a
  branch other than main; `.github/workflows/pr-cause.yml` (check: cause) fails a pull request whose description
  lacks a "Cause:" line or a "Fix:" line. main is locked by kokonut-temp's repos workflow: a pull request, and both
  checks green.

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
  main's `CLAUDE.md`, `.claude/settings.json`, hooks and commands from raw.githubusercontent.com and installs them
  machine-wide in /root/.claude: CLAUDE.md, hooks/, commands/ (the commands setup.sh lists in COMMANDS, so every
  chat has `/continue` and `/handover`), settings.json (its hook commands made absolute, the repos' own CLAUDE.md
  copies excluded, the installed files closed to Claude's edit tools) and kokonut/ (the installer and what it saw:
  kokonut/setup.txt). Never /home/user/.claude: Claude Code reads it as /home/user's project settings, and the hooks
  would fire twice.
- At every chat start the SessionStart hook runs the installed `setup.sh` again: it downloads main once more and
  installs what changed, so a chat runs main's rules even when the cloud kept a container's setup for days. Silent
  when it works. When it cannot download, one line, and the chat runs on the copy installed before.
- When it fails: a setup that cannot download and has no earlier install exits 1 with one line, "KOKONUT RULES NOT
  INSTALLED: ...", and wires the chat-start refresh alone, which tries again; a chat that starts with no rulebook is
  told "KOKONUT RULES MISSING: ... Stop and tell George before any work."
- Why raw.githubusercontent.com: a chat's HTTPS proxy lets codeload.github.com and github.com reach only the repos the
  chat attached; raw.githubusercontent.com serves any public repo's files. Its copies may lag main by up to five
  minutes, so a chat that starts within five minutes of a merge may get part of it.
- In a chat with one repo that still carries its own copy of a hook in its .claude/settings.json, that copy runs and
  the installed one steps aside, so each hook fires once.
- Paste the box again only when the box above changes. A change to `setup.sh` itself reaches chats on its own: each run
  hands over to the `setup.sh` it downloaded.

## The hand-over (rule 22)
- Why: a chat compacts (summarises its own past) at about 784,000 tokens of context and loses detail. Before that, it
  hands its project to a new chat that starts from the page and the notes.
- What fires when (`handover-check.js`, on George's messages and after every tool call; it reads only the end of the
  transcript):
  - 700,000 tokens, once: `HANDOVER DUE`, with the model and effort. The chat finishes its step and runs `/handover`.
  - After that, each of George's messages: one line, `Context <n> of about 784,000: hand-over due`.
  - 744,000 tokens (40,000 before compaction may come), once: `HANDOVER LATE`.
  - A first message that starts `KOKONUT HANDOVER <name>`: `HANDOVER QUIZ`: that message comes from the old chat, not
    George.
  - After a compaction (context under 600,000) it starts over. Inside a helper it prints nothing.
- What `/handover` does, about 2 to 3 minutes, asking George nothing until the end: the page's last State line, the
  `notes` Doc in the project's Drive folder brought up to date, a new chat (same environment, model and repo) whose
  first message is the 5-question quiz, the answer key and verdict in the Doc `handover-quiz` in that folder, one more
  round for missed points only, then one question: "New chat ready: <link>. Continue there?". George types
  `continue <name>` in the new chat to move. Until then the new chat only reads and answers.
- George's messages: only one with `origin.kind` "human" counts as his (reminder.js `fromGeorge`). A message with no
  origin never does, so a chat started by another chat cannot take its first message for George's "rule change ok".
- Test without a 700,000-token chat: `KOKONUT_HANDOVER_AT="<due> <late>"` in the hook's environment, or the same text
  in /root/.claude/kokonut/handover-at (a rule file: it needs George's "rule change ok"). By hand, on a chat's own
  transcript: `echo '{"hook_event_name":"UserPromptSubmit","session_id":"t","transcript_path":"<file>"}' |
  HOME=<scratch> KOKONUT_HANDOVER_AT=1000 node .claude/hooks/handover-check.js` prints the `HANDOVER DUE` line.

## How a rule changes
1. Only on George's go, typed in the chat as "rule change ok" (the rule guard asks for it before every edit, commit
   and push of a rule file), and only here, on the chat's own branch.
2. Its pull request, with its "Cause:" and "Fix:" lines, passes its checks (test, cause) and is merged into main.
3. Nothing to carry: every chat that starts after the merge installs it.

## Tests by hand
- A test install goes elsewhere, never into /root/.claude: `KOKONUT_DEST=<folder> bash setup.sh`, and
  `KOKONUT_RULES_BRANCH=<branch>` downloads a branch instead of main (a test install only). The installed refresh:
  `KOKONUT_RULES_BRANCH=<branch> bash <folder>/kokonut/setup.sh session-start`.

## Undo
- New chats: paste back the earlier setup script (or empty the box) and Save changes; new chats then start without
  the install.
- In a running chat, after George's "rule change ok": delete /root/.claude/CLAUDE.md, settings.json, hooks/,
  commands/continue.md, commands/handover.md, handover-state/ and kokonut/ (put kokonut/settings.json.before-kokonut
  back first, if there is one).
