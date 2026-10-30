#!/bin/bash
# kokonut-setup.sh: the setup script of the cloud environment (its settings, Setup script): one rulebook, no copies.
# Every cloud chat, with any number of repos, gets kokonut-temp's rulebook, settings and hooks, installed machine-wide:
#   /root/.claude/CLAUDE.md       kokonut-temp's CLAUDE.md, the rulebook the chat loads (the repos' copies excluded)
#   /root/.claude/hooks/*.js      kokonut-temp's .claude/hooks/
#   /root/.claude/settings.json   kokonut-temp's .claude/settings.json, its hook commands made absolute
#   /root/.claude/kokonut/        the installer (install.sh, once.sh, make-settings.js) and what it installed
# Never /home/user/.claude: Claude Code reads that folder too, as /home/user's project settings, and the hooks would
# fire twice. Always from kokonut-temp's origin/main, never the checked-out branch.
# The cloud runs this script once and keeps the result for about 7 days, and the repos may be cloned after it runs.
# So the same install runs again at every chat start and resume (the SessionStart hook), from the chat's own clone,
# /home/user/kokonut-temp. Here, with no clone, it tries a shallow clone of main from GitHub; failing that, it wires
# the SessionStart refresh alone and the first chat start installs the rest (a chat without kokonut-temp and without
# any install is told: KOKONUT RULES MISSING, stop and tell George).
# Silent, exit 0. A line on stderr when main cannot be installed (exit 0: the chat start says it again); exit 1 only
# when it cannot write in /root/.claude. Idempotent: a file is rewritten only when its content changes. No secret is
# needed. What the run saw goes to /root/.claude/kokonut/setup.txt. Undo: kokonut-temp's README.md, section
# "Setup script: one rulebook in every cloud chat". The tests install elsewhere: KOKONUT_DEST, KOKONUT_SRC, KOKONUT_URL.
set -u
umask 022
DEST=${KOKONUT_DEST:-/root/.claude}
KK=$DEST/kokonut
mkdir -p "$KK" || { echo "KOKONUT RULES NOT INSTALLED: cannot create $KK" >&2; exit 1; }

put() { # put <new> <target>: <target> replaced by <new> only when they differ (atomically); <new> removed
  if cmp -s "$1" "$2"; then rm -f "$1"; else mv -f "$1" "$2"; fi
}

# -------------------------------------------------------------------------------------------------------------------
cat >"$KK/install.sh.new" <<'INSTALL'
#!/bin/bash
# install.sh setup|session-start: installs kokonut-temp's rulebook, hooks and settings from its origin/main (never the
# checked-out branch) into the folder above this one. Written by kokonut-temp's scripts/kokonut-setup.sh.
#   setup          run by the environment's setup script. Source: /home/user/kokonut-temp (or kokonut-temp in the
#                  folder it runs in), else a shallow clone of main from GitHub. No source, or main cannot be
#                  installed: an earlier install stays, else the SessionStart refresh alone is wired. Exit 0; a line
#                  on stderr when main cannot be installed; exit 1 only when it cannot write.
#   session-start  run by the SessionStart hook at every chat start and resume: refreshes from the chat's clone,
#                  /home/user/kokonut-temp; one line when it could not; "KOKONUT RULES MISSING" when no rulebook is
#                  installed at all; then session-start.js. Exit 0.
set -u
umask 022
mode=${1:-setup}
KK=$(cd "$(dirname "$0")" && pwd) || exit 1
DEST=$(dirname "$KK")
REAL=/root/.claude
URL=https://github.com/Test-Kokonut/kokonut-temp.git
REF=refs/remotes/origin/main   # written out: a local branch named origin/main is not main
NODE=$(command -v node 2>/dev/null) || NODE=/opt/node22/bin/node
WHY=
how=
CLONE=

put() { if cmp -s "$1" "$2"; then rm -f "$1"; else mv -f "$1" "$2"; fi; }
stamp() { if [ -f "$KK/installed" ]; then echo "$(date -u -r "$KK/installed" +%F) ($(cat "$KK/installed"))"; else echo "(none)"; fi; }

# Where kokonut-temp is: the cloud's clone. Only a test install (not into /root/.claude) may name others.
candidates=/home/user/kokonut-temp
if [ "$mode" = setup ] && [ "$PWD" != /home/user ]; then candidates="$candidates $PWD/kokonut-temp"; fi
if ! [ "$DEST" -ef "$REAL" ]; then candidates=${KOKONUT_SRC:-$candidates}; URL=${KOKONUT_URL:-$URL}; fi
src=
for d in $candidates; do
  if [ -e "$d/.git" ] && git -C "$d" -c safe.directory='*' rev-parse --git-dir >/dev/null 2>&1; then src=$d; how=clone; break; fi
done
if [ -z "$src" ] && [ "$mode" = setup ] && command -v git >/dev/null && command -v timeout >/dev/null; then
  CLONE=$(mktemp -d "$KK/.clone.XXXXXX") || { echo "KOKONUT RULES NOT INSTALLED: cannot write in $KK" >&2; exit 1; }
  if GIT_TERMINAL_PROMPT=0 timeout 90 git clone -q --depth 1 --single-branch --branch main --no-tags "$URL" \
      "$CLONE/kokonut-temp" </dev/null >/dev/null 2>&1; then
    src=$CLONE/kokonut-temp; how=github
  fi
fi
g() { git -C "$src" -c safe.directory='*' "$@" </dev/null; }
ref=
if [ -n "$src" ] && g rev-parse -q --verify "$REF^{commit}" >/dev/null 2>&1; then ref=$REF; fi

install_rules() {
  local tmp sha p n f
  tmp=$(mktemp -d "$KK/.build.XXXXXX") || { WHY="cannot write in $KK"; return 1; }
  bad() { WHY=$1; rm -rf "$tmp"; }
  sha=$(g rev-parse --short "$ref") || { bad "kokonut-temp's origin/main cannot be read"; return 1; }
  if ! g show "$ref:CLAUDE.md" >"$tmp/CLAUDE.md" 2>/dev/null || [ ! -s "$tmp/CLAUDE.md" ]; then
    bad "kokonut-temp origin/main $sha has no CLAUDE.md"; return 1
  fi
  g show "$ref:.claude/settings.json" >"$tmp/project.json" 2>/dev/null || { bad "kokonut-temp origin/main $sha has no .claude/settings.json"; return 1; }
  mkdir "$tmp/hooks" && : >"$tmp/hooks.list" || { bad "cannot write in $KK"; return 1; }
  for p in $(g ls-tree --name-only "$ref" .claude/hooks/); do
    case $p in
      *.js) n=${p##*/}; g show "$ref:$p" >"$tmp/hooks/$n" 2>/dev/null || { bad "cannot read $p"; return 1; }; echo "$n" >>"$tmp/hooks.list" ;;
    esac
  done
  [ -s "$tmp/hooks.list" ] || { bad "kokonut-temp origin/main $sha has no .claude/hooks/*.js"; return 1; }
  if ! "$NODE" "$KK/make-settings.js" "$tmp/project.json" "$tmp/hooks" "$DEST" >"$tmp/settings.json" 2>"$tmp/err"; then
    bad "settings: $(head -c 300 "$tmp/err" | tr '\n' ' ')"; return 1
  fi
  # All built: into place. The hooks first, the rulebook, the wiring last; then the hooks main no longer has.
  mkdir -p "$DEST/hooks" || { bad "cannot write $DEST/hooks"; return 1; }
  backup
  for f in "$tmp"/hooks/*.js; do put "$f" "$DEST/hooks/${f##*/}" || { bad "cannot write $DEST/hooks"; return 1; }; done
  put "$tmp/CLAUDE.md" "$DEST/CLAUDE.md" || { bad "cannot write $DEST/CLAUDE.md"; return 1; }
  put "$tmp/settings.json" "$DEST/settings.json" || { bad "cannot write $DEST/settings.json"; return 1; }
  if [ -f "$KK/hooks.list" ]; then
    while read -r n; do grep -qxF "$n" "$tmp/hooks.list" || rm -f "$DEST/hooks/$n"; done <"$KK/hooks.list"
  fi
  put "$tmp/hooks.list" "$KK/hooks.list"
  printf 'origin/main %s\n' "$sha" >"$tmp/installed"
  put "$tmp/installed" "$KK/installed"
  rm -rf "$tmp"
}

backup() { # once: a settings.json that is not this installer's is kept as kokonut/settings.json.before-kokonut
  if [ -f "$DEST/settings.json" ] && ! grep -qF "$KK/" "$DEST/settings.json"; then cp -n "$DEST/settings.json" "$KK/settings.json.before-kokonut"; fi
}

bootstrap() { # no rules installed and none from before: the SessionStart refresh alone, the first chat start does the rest
  if [ -f "$DEST/settings.json" ] && grep -qF "$KK/install.sh" "$DEST/settings.json"; then return 0; fi
  backup
  printf '{\n  "hooks": {\n    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash %s/install.sh session-start", "timeout": 60 }] }]\n  }\n}\n' \
    "$KK" >"$KK/.settings.json.new" && put "$KK/.settings.json.new" "$DEST/settings.json"
}

if [ -n "$ref" ] && install_rules; then
  result="installed $(cat "$KK/installed")"
else
  if [ -z "$ref" ]; then
    if [ -n "$src" ]; then WHY="kokonut-temp at $src has no origin/main"; else WHY="kokonut-temp is not cloned (looked in $candidates)"; fi
  fi
  result="not installed: $WHY"
  if [ "$mode" = setup ]; then
    bootstrap || { echo "KOKONUT RULES NOT INSTALLED: cannot write $DEST/settings.json" >&2; [ -n "$CLONE" ] && rm -rf "$CLONE"; exit 1; }
    [ -n "$src" ] && echo "KOKONUT RULES NOT INSTALLED at setup: $WHY. Each chat start tries again." >&2
  elif [ -n "$src" ]; then
    echo "Kokonut rules: not refreshed from kokonut-temp ($WHY). This chat runs on the copy installed $(stamp)."
  elif [ -f "$KK/installed" ]; then
    echo "Kokonut rules: kokonut-temp is not in this chat. The rules are the copy installed $(stamp)."
  fi
fi

if [ "$mode" = setup ]; then
  [ -n "$CLONE" ] && rm -rf "$CLONE"
  { echo "setup ran $(date -u +%FT%TZ) in $PWD"
    echo "/home/user held: $(ls -A /home/user 2>/dev/null | tr '\n' ' ')"
    echo "source: ${how:-none}${src:+ ($src)}"
    echo "result: $result"; } >"$KK/setup.txt.new" && mv -f "$KK/setup.txt.new" "$KK/setup.txt"
  exit 0
fi
[ -s "$DEST/CLAUDE.md" ] || echo "KOKONUT RULES MISSING: no rulebook at $DEST/CLAUDE.md. Stop and tell George before any work."
if [ -f "$DEST/hooks/session-start.js" ]; then exec sh "$KK/once.sh" session-start.js; fi
exit 0
INSTALL

# -------------------------------------------------------------------------------------------------------------------
cat >"$KK/once.sh.new" <<'ONCE'
#!/bin/sh
# once.sh <name>.js: runs one Kokonut hook of the machine-wide install (../hooks/<name>.js), its input on stdin.
# Written by kokonut-temp's scripts/kokonut-setup.sh. While the repos still carry their own copies, a chat with one
# repo also loads that repo's .claude/settings.json: when it wires the same hook and holds its file, that copy runs
# and this one steps aside, so each hook fires once. A chat with several repos loads no repo hooks: this copy runs.
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

# -------------------------------------------------------------------------------------------------------------------
cat >"$KK/make-settings.js.new" <<'MAKE'
#!/usr/bin/env node
// make-settings.js <kokonut-temp .claude/settings.json> <hooks folder> <dest>: prints the machine-wide settings.json.
// Written by kokonut-temp's scripts/kokonut-setup.sh. It is kokonut-temp's settings (permissions included), with:
//   every hook command node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.js" made sh <dest>/kokonut/once.sh <name>.js;
//   SessionStart's session-start.js made bash <dest>/kokonut/install.sh session-start (the refresh, then the hook);
//   the repos' own rulebook copies excluded (claudeMdExcludes), so the chat loads <dest>/CLAUDE.md alone;
//   the installed files closed to Claude's edit tools (deny Edit(...)).
// A hook of another form, or a wired hook missing from the folder: one line on stderr, nothing printed, exit 1.
'use strict';
const fs = require('fs');
const path = require('path');
try {
  const [src, hooksDir, dest] = process.argv.slice(2);
  const kk = path.join(dest, 'kokonut');
  const s = JSON.parse(fs.readFileSync(src, 'utf8'));
  const FORM = /^node\s+"\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)\/\.claude\/hooks\/([\w.-]+\.js)"$/;
  const refreshCmd = `bash ${path.join(kk, 'install.sh')} session-start`;
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
  s.permissions.deny = add(s.permissions.deny, ['CLAUDE.md', 'settings.json', 'hooks/**', 'kokonut/**'].map((p) => `Edit(/${path.join(dest, p)})`));
  process.stdout.write(JSON.stringify(s, null, 2) + '\n');
} catch (e) {
  process.stderr.write(String(e && e.message ? e.message : e).split('\n')[0] + '\n');
  process.exit(1);
}
MAKE

put "$KK/install.sh.new" "$KK/install.sh" && put "$KK/once.sh.new" "$KK/once.sh" && put "$KK/make-settings.js.new" "$KK/make-settings.js" \
  && chmod 755 "$KK/install.sh" "$KK/once.sh" || { echo "KOKONUT RULES NOT INSTALLED: cannot write $KK" >&2; exit 1; }
exec bash "$KK/install.sh" setup
