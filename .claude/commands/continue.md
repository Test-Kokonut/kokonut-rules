---
description: Continue a project from its status page, or start it
argument-hint: <project name>
---
Continue the project named $ARGUMENTS. Write George nothing until step 3 or 4.

1. If /home/user/kokonut-status is missing, attach Test-Kokonut/kokonut-status to this chat (the tool
   mcp__claude-code-remote__add_repo), then clone it to /home/user/kokonut-status as its answer says. Below, `S` is
   `node /home/user/kokonut-status/scripts/status.js`.
2. Run `S read $ARGUMENTS`. It prints the page, then a line `--- BASE <id>`: keep that id for a later save. "No page":
   a new project, step 4.
3. A page: read it, and the file named `notes` in its Drive folder when there is one (the Folder link, else the folder
   named $ARGUMENTS in "Bots - work in progress", id 1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy). Tell George one line: the
   next step, and what he must do if it needs him. Never paste the page. Then start the next step.
4. No page: ask George in one line what the project is for, then start the work. Make the page only when there is
   something to keep: `S new <name> <file> --message "New page"`, where <name> is $ARGUMENTS, with today's date
   (`2026-11-04_example`) in front when it has none. Make its Drive folder then: a folder named <name> in "Bots - work
   in progress" (Google Drive create_file, parentId 1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy, mime type
   application/vnd.google-apps.folder). The page: the lines `Folder: <its link>` and `Chat: https://claude.ai/code/<this
   session's id>`, then the parts Purpose (his words), Done when (one line from his ask; do not stop to ask for it),
   State (one dated fact) and Next step.
