---
description: Continue a project from its status page, or start it, under the project's own name
argument-hint: <project name>
---
Continue the project named $ARGUMENTS: this chat takes that project name (rulebook rule 17). Do these steps in order.
The page's shape: kokonut-status README.md, section "Status page".

1. If /home/user/kokonut-status is missing, attach Test-Kokonut/kokonut-status to this chat (the tool
   mcp__claude-code-remote__add_repo), then clone it to /home/user/kokonut-status as its answer says. Below, `S` is
   `node /home/user/kokonut-status/scripts/status.js`.
2. Run `S read $ARGUMENTS`. It prints the page, then a line `--- BASE <id>`: keep that id for this chat's first save.
   It prints "No page": a new project, step 6. Otherwise go on with step 3.

An existing project
3. Show George the project's brief, as the page writes it: the lines Folder and Chat, then the parts Purpose, Done
   when, State and Next step. A page made before 30 Oct 2026 (it has the parts Decisions and Blockers) has no Folder,
   Chat or Done when: show its Purpose, State, Next step and Blockers.
4. Before acting, read the project's working notes: the file named `notes` in its Drive folder (the Folder link; a
   page without one: the folder named $ARGUMENTS in "Bots - work in progress", folder id
   1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy). Find it with the Google Drive connector's search_files
   (`parentId = '<folder id>' and title = 'notes'`) and read it with read_file_content. No folder or no notes: say so
   in one line under the brief.
5. One chat per project: at this chat's first save of the page (`S save $ARGUMENTS <file> --base <id>`), the line
   `Chat:` becomes this chat's link, https://claude.ai/code/<this session's id> (mcp__claude-code-remote__get_session
   with no session id gives it). A page made before 30 Oct 2026 keeps its parts and takes the line `Chat:` under its
   Updated line. When the Chat line named another chat, say in the brief that this chat takes the project over from
   it. Then continue the work from the first item of Next step.

A new project (rules 1 and 17)
6. Its name is $ARGUMENTS when that starts with a date (`2026-10-30_example`); otherwise
   `<today's date, YYYY-MM-DD>_$ARGUMENTS`. Say in one line that no page has this name and ask George for its Purpose
   and its Done when.
7. Settle both with George: Purpose in his words; Done when, the checks that will judge the project. Nothing else
   starts before both are settled.
8. Create the Drive folder named after the project in "Bots - work in progress" with the Google Drive connector:
   search_files (`parentId = '1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy' and title = '<name>'`) first and use the folder found;
   else create_file with title `<name>`, parentId `1O-b-xz-JTbHesM9S5GdB3OpecQZoJQjy` and the folder mime type
   `application/vnd.google-apps.folder`. Its link: https://drive.google.com/drive/folders/<its id>.
9. Write the page to a file and create it with `S new <name> <file> --message "New page"`; it must print SAVED:
   ```
   # <name>
   Folder: https://drive.google.com/drive/folders/<folder id>
   Chat: https://claude.ai/code/<this session's id>

   ## Purpose
   George: "<his words>"
   ## Done when
   - <a check that judges the project>
   ## State
   - <day> <month>: <a fact>.
   ## Next step
   - <the next thing>
   ```
10. Show George the brief as in step 3, then start the first item of Next step.
