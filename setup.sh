#!/bin/bash
# setup.sh: Kokonut's rulebook, settings and hooks in every cloud chat, whatever repos it has. The one source is the
# public repo Test-Kokonut/kokonut-rules: this script downloads its main, with no login, at the cloud environment's
# setup and again at every chat start, and installs it machine-wide:
#   /root/.claude/CLAUDE.md       kokonut-rules' CLAUDE.md, the rulebook the chat loads (the repos' copies excluded)
#   /root/.claude/hooks/*.js      the hooks kokonut-rules' .claude/settings.json wires, and the hooks they require
#   /root/.claude/settings.json   kokonut-rules' .claude/settings.json, its hook commands made absolute
#   /root/.claude/commands/*.md   the slash commands of kokonut-rules' .claude/commands (COMMANDS below): /continue
#   /root/.claude/kokonut/        this script, once.sh and make-settings.js, and what the last run saw
# Never /home/user/.claude: Claude Code reads that folder too, as /home/user's project settings, and the hooks would
# fire twice.
#   bash setup.sh                the environment's setup script (README.md, "The setup script": two lines download
#                                this file from main and run it). Download or install fails: an earlier install stays
#                                (one line on stderr, exit 0); with none, it wires the chat-start refresh alone and
#                                exits 1 with one line: "KOKONUT RULES NOT INSTALLED: <why>".
#   bash setup.sh session-start  the SessionStart hook, from the installed copy: the same download and install (the
#                                cloud may keep a container's setup for days, and skip setup), silent; when it fails,
#                                one line and the installed copy stays. Then session-start.js.
# The download: https://raw.githubusercontent.com/Test-Kokonut/kokonut-rules/main/<file>, by curl, which goes through
# the chat's HTTPS proxy (HTTPS_PROXY). Not codeload.github.com or github.com: a chat's proxy lets those reach only the
# repos the chat attached; raw.githubusercontent.com serves any public repo. Its copies may lag main by up to five
# minutes. The files: CLAUDE.md, .claude/settings.json, setup.sh, and the hooks: those the settings wire and those
# they require ('./<name>.js'). All of them downloaded, this copy hands over to the downloaded setup.sh, which does
# the install: a chat always installs with main's installer. That installer downloads the commands itself, so a copy
# older than COMMANDS still hands over a full install.
# Idempotent: a file is rewritten only when its content changes (kokonut/installed, the stamp, aside). No secret is
# needed. Undo: README.md, "Undo". Tests install elsewhere: KOKONUT_DEST=<folder>, and only there
# KOKONUT_RULES_BRANCH=<branch> (default main) downloads another branch.
set -u
umask 022
mode=${1:-setup}
REAL=/root/.claude
REPO=Test-Kokonut/kokonut-rules
# The slash commands installed in <dest>/commands, from kokonut-rules' .claude/commands/. A new command is added here.
COMMANDS='continue.md'
NODE=$(command -v node 2>/dev/null) || NODE=/opt/node22/bin/node
WHY=

put() { # put <new> <target>: <target> replaced by <new> only when they differ (atomically); <new> removed
  if cmp -s "$1" "$2"; then rm -f "$1"; else mv -f "$1" "$2"; fi
}
stamp() { if [ -f "$KK/installed" ]; then echo "$(date -u -r "$KK/installed" '+%F %H:%M UTC') ($(cat "$KK/installed"))"; else echo "(none)"; fi; }
installed() { [ -s "$DEST/CLAUDE.md" ] && [ -f "$KK/installed" ]; }
clean() { if [ -n "${DL:-}" ]; then rm -rf "$DL"; DL=; fi; }

# setup.txt: what a setup run saw.
report() {
  { echo "setup ran $(date -u +%FT%TZ) in $PWD"
    echo "/home/user held: $(ls -A /home/user 2>/dev/null | tr '\n' ' ')"
    echo "source: https://raw.githubusercontent.com/$REPO/$BRANCH"
    echo "result: $1"; } >"$KK/setup.txt.new" && mv -f "$KK/setup.txt.new" "$KK/setup.txt"
}

# The end of every run. setup: exit 0 with rules installed, else the refresh alone wired and exit 1. session-start:
# the missing-rulebook line when there is none, then session-start.js.
finish() {
  if [ "$mode" = setup ]; then
    if [ -n "$WHY" ] && installed; then
      clean
      report "not refreshed: $WHY; kept the copy installed $(stamp)"
      echo "Kokonut rules: not refreshed from $REPO ($WHY). Kept the copy installed $(stamp)." >&2
      exit 0
    elif [ -n "$WHY" ]; then
      report "not installed: $WHY"
      wire_refresh
      clean
      echo "KOKONUT RULES NOT INSTALLED: $WHY. Each chat start tries again." >&2
      exit 1
    fi
    clean
    report "installed $(stamp)"
    exit 0
  fi
  clean
  if [ -n "$WHY" ]; then
    if installed; then echo "Kokonut rules: not refreshed from $REPO ($WHY). This chat runs on the copy installed $(stamp)."
    else echo "Kokonut rules: not installed ($WHY)."; fi
  fi
  [ -s "$DEST/CLAUDE.md" ] || echo "KOKONUT RULES MISSING: no rulebook at $DEST/CLAUDE.md. Stop and tell George before any work."
  if [ -f "$DEST/hooks/session-start.js" ] && [ -f "$KK/once.sh" ]; then exec sh "$KK/once.sh" session-start.js; fi
  exit 0
}

# No rules installed at setup: the SessionStart refresh alone, from this script's copy; the first chat start tries
# again.
wire_refresh() {
  if [ -f "$0" ] && cp "$0" "$KK/setup.sh.new" 2>/dev/null; then put "$KK/setup.sh.new" "$KK/setup.sh"; fi
  [ -f "$KK/setup.sh" ] || return 0
  if [ -f "$DEST/settings.json" ] && grep -qF "$KK/setup.sh" "$DEST/settings.json"; then return 0; fi
  backup
  printf '{\n  "hooks": {\n    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash %s/setup.sh session-start", "timeout": 60 }] }]\n  }\n}\n' \
    "$KK" >"$KK/.settings.json.new" && put "$KK/.settings.json.new" "$DEST/settings.json"
}

backup() { # once: a settings.json that is not this installer's is kept as kokonut/settings.json.before-kokonut
  if [ -f "$DEST/settings.json" ] && ! grep -qF "$KK/" "$DEST/settings.json"; then cp -n "$DEST/settings.json" "$KK/settings.json.before-kokonut"; fi
}

# ---- Download. ----

# get <path in the repo> <file> ...: each pair downloaded in one curl run (one connection); 1 and $WHY on the first
# failure.
get() {
  local args=() code err
  while [ $# -ge 2 ]; do args+=(-o "$2" "$BASE/$1"); shift 2; done
  err=$DL/curl.err
  if command -v timeout >/dev/null; then
    timeout 25 curl -fsS --proto =https --fail-early --connect-timeout 10 --max-time 20 --retry 2 --retry-delay 1 "${args[@]}" </dev/null 2>"$err"
  else
    curl -fsS --proto =https --fail-early --connect-timeout 10 --max-time 20 --retry 2 --retry-delay 1 "${args[@]}" </dev/null 2>"$err"
  fi
  code=$?
  [ "$code" = 0 ] && return 0
  if [ "$code" = 124 ]; then WHY="download from $BASE timed out"; else WHY="download from $BASE failed: $(tr '\n' ' ' <"$err" | head -c 200 | sed 's/ *$//')"; fi
  return 1
}

# The hook names a file wires or requires: .claude/hooks/<name>.js in the settings, require('./<name>') in a hook.
wired() { grep -ohE '\.claude/hooks/[A-Za-z0-9._-]+\.js' "$@" 2>/dev/null | sed 's#.*/##'; }
required() {
  grep -ohE "require\(\s*['\"]\./[A-Za-z0-9._-]+['\"]\s*\)" "$@" 2>/dev/null | sed -E "s#.*\./([A-Za-z0-9._-]+).*#\1#; /\.js\$/!s#\$#.js#"
}

download() {
  local want have n round args
  mkdir -p "$DL/hooks" || { WHY="cannot write in $KK"; return 1; }
  get CLAUDE.md "$DL/CLAUDE.md" .claude/settings.json "$DL/project.json" setup.sh "$DL/setup.sh" || return 1
  [ -s "$DL/CLAUDE.md" ] || { WHY="$BASE/CLAUDE.md is empty"; return 1; }
  [ "$(head -n 1 "$DL/setup.sh")" = '#!/bin/bash' ] && bash -n "$DL/setup.sh" 2>/dev/null || { WHY="$BASE/setup.sh is not this installer"; return 1; }
  have=
  want=$(wired "$DL/project.json" | sort -u)
  [ -n "$want" ] || { WHY="$BASE/.claude/settings.json wires no hook"; return 1; }
  for round in 1 2 3 4 5; do
    args=()
    for n in $want; do case " $have " in *" $n "*) ;; *) args+=(".claude/hooks/$n" "$DL/hooks/$n"); have="$have $n" ;; esac; done
    [ ${#args[@]} -eq 0 ] && break
    get "${args[@]}" || return 1
    want=$( { required "$DL"/hooks/*.js; printf '%s\n' $want; } | sort -u)
  done
  for n in $have; do
    head -c 64 "$DL/hooks/$n" | grep -q '^#!/usr/bin/env node' || { WHY="$BASE/.claude/hooks/$n is not a hook"; return 1; }
  done
  return 0
}

# ---- Install (run as the downloaded copy: bash <download>/setup.sh install <download> <dest> <mode> <branch>). ----

install_rules() {
  local tmp n f args
  tmp=$DL/build
  mkdir -p "$tmp" "$DL/commands" || { WHY="cannot write in $KK"; return 1; }
  args=()
  for n in $COMMANDS; do args+=(".claude/commands/$n" "$DL/commands/$n"); done
  get "${args[@]}" || return 1
  for n in $COMMANDS; do [ -s "$DL/commands/$n" ] || { WHY="$BASE/.claude/commands/$n is empty"; return 1; }; done
  printf '%s\n' $COMMANDS >"$tmp/commands.list"
  write_helpers || { WHY="cannot write in $KK"; return 1; }
  if ! "$NODE" "$KK/make-settings.js" "$DL/project.json" "$DL/hooks" "$DEST" >"$tmp/settings.json" 2>"$tmp/err"; then
    WHY="settings: $(head -c 300 "$tmp/err" | tr '\n' ' ')"; return 1
  fi
  (cd "$DL/hooks" && ls -1 -- *.js) >"$tmp/hooks.list" 2>/dev/null && [ -s "$tmp/hooks.list" ] || { WHY="no hook downloaded"; return 1; }
  # All built: into place. The hooks and commands first, the rulebook, the wiring last; then the hooks and commands
  # main no longer has (only those an earlier install put there: other commands in that folder stay).
  mkdir -p "$DEST/hooks" "$DEST/commands" || { WHY="cannot write $DEST/hooks or $DEST/commands"; return 1; }
  backup
  for f in "$DL"/hooks/*.js; do put "$f" "$DEST/hooks/${f##*/}" || { WHY="cannot write $DEST/hooks"; return 1; }; done
  for n in $COMMANDS; do put "$DL/commands/$n" "$DEST/commands/$n" || { WHY="cannot write $DEST/commands"; return 1; }; done
  put "$DL/CLAUDE.md" "$DEST/CLAUDE.md" || { WHY="cannot write $DEST/CLAUDE.md"; return 1; }
  put "$tmp/settings.json" "$DEST/settings.json" || { WHY="cannot write $DEST/settings.json"; return 1; }
  if [ -f "$KK/hooks.list" ]; then
    while read -r n; do grep -qxF "$n" "$tmp/hooks.list" || rm -f "$DEST/hooks/$n"; done <"$KK/hooks.list"
  fi
  put "$tmp/hooks.list" "$KK/hooks.list"
  if [ -f "$KK/commands.list" ]; then
    while read -r n; do grep -qxF "$n" "$tmp/commands.list" || rm -f "$DEST/commands/$n"; done <"$KK/commands.list"
  fi
  put "$tmp/commands.list" "$KK/commands.list"
  chmod 755 "$DL/setup.sh" && put "$DL/setup.sh" "$KK/setup.sh" || { WHY="cannot write $KK/setup.sh"; return 1; }
  rm -f "$KK/install.sh" # the installer before kokonut-rules (kokonut-temp's scripts/kokonut-setup.sh): no longer wired
  printf 'kokonut-rules %s\n' "$BRANCH" >"$KK/installed"
}

write_helpers() {
# ---------------------------------------------------------------------------------------------------------------------
cat >"$KK/once.sh.new" <<'ONCE' || return 1
#!/bin/sh
# once.sh <name>.js: runs one Kokonut hook of the machine-wide install (../hooks/<name>.js), its input on stdin.
# Written by kokonut-rules' setup.sh. While a repo still carries its own copies, a chat with that one repo also loads
# its .claude/settings.json: when it wires the same hook and holds its file, that copy runs and this one steps aside,
# so each hook fires once. A chat with several repos loads no repo hooks: this copy runs.
h=${1:-}
case $h in '' | *[!A-Za-z0-9._-]*) echo "Kokonut hook: no such name: $h" >&2; exit 1 ;; esac
p=${CLAUDE_PROJECT_DIR:-}
if [ -n "$p" ] && [ -f "$p/.claude/hooks/$h" ] && grep -qF ".claude/hooks/$h" "$p/.claude/settings.json" 2>/dev/null; then
  exit 0
fi
d=$(dirname "$0")/../hooks
[ -f "$d/$h" ] || { echo "Kokonut hook missing: $d/$h" >&2; exit 1; }
n=$(command -v node) || n=/opt/node22/bin/node
exec "$n" "$d/$h"
ONCE

# ---------------------------------------------------------------------------------------------------------------------
cat >"$KK/make-settings.js.new" <<'MAKE' || return 1
#!/usr/bin/env node
// make-settings.js <kokonut-rules .claude/settings.json> <hooks folder> <dest>: prints the machine-wide settings.json.
// Written by kokonut-rules' setup.sh. It is kokonut-rules' settings (permissions included), with:
//   every hook command node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.js" made sh <dest>/kokonut/once.sh <name>.js;
//   SessionStart's session-start.js made bash <dest>/kokonut/setup.sh session-start (the refresh, then the hook);
//   the repos' own rulebook copies excluded (claudeMdExcludes), so the chat loads <dest>/CLAUDE.md alone;
//   the installed files (rulebook, settings, hooks, commands, installer) closed to Claude's edit tools (deny Edit(...)).
// A hook of another form, or a wired hook missing from the folder: one line on stderr, nothing printed, exit 1.
'use strict';
const fs = require('fs');
const path = require('path');
try {
  const [src, hooksDir, dest] = process.argv.slice(2);
  const kk = path.join(dest, 'kokonut');
  const s = JSON.parse(fs.readFileSync(src, 'utf8'));
  const FORM = /^node\s+"\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)\/\.claude\/hooks\/([\w.-]+\.js)"$/;
  const refreshCmd = `bash ${path.join(kk, 'setup.sh')} session-start`;
  let refresh = false;
  s.hooks = s.hooks || {};
  for (const [event, groups] of Object.entries(s.hooks)) {
    for (const group of groups) {
      for (const h of group.hooks || []) {
        if (h.type !== 'command') continue;
        const m = FORM.exec(String(h.command || '').trim());
        if (!m) throw new Error(`${event}: a hook not of the form node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.js": ${h.command}`);
        if (!fs.existsSync(path.join(hooksDir, m[1]))) throw new Error(`${event}: ${m[1]} is wired but not in .claude/hooks`);
        if (event === 'SessionStart' && m[1] === 'session-start.js') { h.command = refreshCmd; refresh = true; }
        else h.command = `sh ${path.join(kk, 'once.sh')} ${m[1]}`;
      }
    }
  }
  if (!refresh) (s.hooks.SessionStart = s.hooks.SessionStart || []).unshift({ hooks: [{ type: 'command', command: refreshCmd, timeout: 60 }] });
  const add = (list, items) => [...new Set([...(list || []), ...items])];
  s.claudeMdExcludes = add(s.claudeMdExcludes, ['/home/user/*/CLAUDE.md', '/home/user/*/.claude/CLAUDE.md', '/home/user/*/CLAUDE.local.md']);
  s.permissions = s.permissions || {};
  s.permissions.deny = add(s.permissions.deny, ['CLAUDE.md', 'settings.json', 'hooks/**', 'commands/**', 'kokonut/**'].map((p) => `Edit(/${path.join(dest, p)})`));
  process.stdout.write(JSON.stringify(s, null, 2) + '\n');
} catch (e) {
  process.stderr.write(String(e && e.message ? e.message : e).split('\n')[0] + '\n');
  process.exit(1);
}
MAKE

put "$KK/once.sh.new" "$KK/once.sh" && put "$KK/make-settings.js.new" "$KK/make-settings.js" && chmod 755 "$KK/once.sh"
}

# ---- The run. ----

case $mode in
  setup)
    DEST=${KOKONUT_DEST:-$REAL} ;;
  session-start)
    DEST=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd) || exit 0 ;;
  install) # the handover: the downloaded copy installs what the running copy downloaded
    DL=${2:-}; DEST=${3:-}; mode=${4:-}; BRANCH=${5:-main}
    case $mode in setup | session-start) ;; *) echo "setup.sh install: no such mode: $mode" >&2; exit 2 ;; esac
    KK=$DEST/kokonut
    case $DL in "$KK"/.dl.*) ;; *) echo "setup.sh install: not a download of this installer: $DL" >&2; exit 2 ;; esac
    BASE=https://raw.githubusercontent.com/$REPO/$BRANCH
    install_rules
    finish ;;
  *)
    echo "setup.sh: no such mode: $mode (setup or session-start)" >&2; exit 2 ;;
esac

KK=$DEST/kokonut
if ! mkdir -p "$KK" 2>/dev/null; then
  [ "$mode" = setup ] && { echo "KOKONUT RULES NOT INSTALLED: cannot create $KK" >&2; exit 1; }
  WHY="cannot create $KK"; finish
fi
DEST=$(cd "$DEST" && pwd); KK=$DEST/kokonut
BRANCH=main
if ! [ "$DEST" -ef "$REAL" ]; then BRANCH=${KOKONUT_RULES_BRANCH:-main}; fi
case $BRANCH in '' | -* | *..* | *[!A-Za-z0-9._/-]*) echo "setup.sh: no such branch name: $BRANCH" >&2; exit 2 ;; esac
BASE=https://raw.githubusercontent.com/$REPO/$BRANCH
DL=$(mktemp -d "$KK/.dl.XXXXXX" 2>/dev/null) || { WHY="cannot write in $KK"; finish; }
if download; then exec bash "$DL/setup.sh" install "$DL" "$DEST" "$mode" "$BRANCH"; fi
finish
