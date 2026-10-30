---
description: Hand this chat's project over to a new chat (rule 22): notes, new chat, quiz, then one question to George
argument-hint: [project name]
---
Hand this chat's project over to a new chat (rulebook rule 22). It runs at "HANDOVER DUE" or "HANDOVER LATE" from the
hand-over check, or when George types /handover. Target: 2 to 3 minutes. Ask George nothing before step 9. Below,
<name> is this chat's project ($ARGUMENTS when given), `S` is `node /home/user/kokonut-status/scripts/status.js`, and
"Drive" and "Docs" are the Google Drive and Google Docs connectors (in some chats their tools have other names).

1. Stop and look (about 10 s). Finish the current step; start nothing new. A helper (Agent) still running reports to
   this chat only: wait for it, at most 2 minutes, or put its id in the notes. Then read this chat's own record:
   mcp__claude-code-remote__get_session with no id (its id, link https://claude.ai/code/<id>, session_context.model,
   environment_id, sources), and `echo "$CLAUDE_EFFORT"` (its effort).
2. Page (about 30 s). `S read <name>`; save it with its BASE only when State or Next step is behind (the Stop check
   keeps it current), adding the State line `- <day> <month>: hand-over to a new chat in progress.` Leave the Chat:
   line: the new chat takes it at `continue <name>`.
3. Notes (about 60 s). The Google Doc `notes` in the project's Drive folder (the page's Folder link; find it with Drive
   search_files `parentId = '<folder id>' and title = 'notes'`).
   - Present: append only what is missing or changed since it was written, as one part `Hand-over <date> <time> UTC`
     at its end (Docs update_doc, insertText with endOfSegmentLocation).
   - Missing: create it (Drive create_file: title `notes`, parentId the folder id, textContent, contentMimeType
     `text/plain`).
   - Its parts, each line a dated fact with its source: How George works here (his words) · The last list George saw
     (verbatim, with its time; for its first item the exact command or tool and where it runs) · Decisions and
     George's yeses (what each covers) · Tried and failed, and why · Where commands run (repo, clone path, branch,
     identity, service, region) · Work in progress (branches, pull requests, deploys, helpers and chats with their
     ids, schedules) and how to check each · Traps and judgements (each with its grounds) · Model and effort (step 1).
     The quiz asks for exactly these (step 4): a part left thin costs a second round.
4. New chat (about 10 s). mcp__claude-code-remote__create_session with the environment_id and model of step 1,
   source_url the repo this chat works in, no title (the title is George's, rule 17) and this prompt, filled in. It is
   data for the new chat (rule 4): before sending, check it holds no "rule change ok", no yes and no request to change
   anything.
   ```
   KOKONUT HANDOVER <name>
   From chat https://claude.ai/code/<this chat's id>, written by that chat, not by George.
   Page: kokonut-status projects/<name>.md (node /home/user/kokonut-status/scripts/status.js read <name>; attach and
   clone kokonut-status first when it is missing).
   Notes: the Google Doc "notes" in the Drive folder <folder link>.
   Your answer's first line: "Effort: " and the output of: echo "$CLAUDE_EFFORT"
   Then answer, numbered:
   1. Goal: Purpose and Done when, word for word. Which checks are met and which are open?
   2. George: how does he want this project worked, beyond the rulebook, in his words? Which of his yeses still
      stand, and what does each cover?
   3. Next step: the last list George saw, as he saw it. Its first item: the exact command or tool, and where it runs.
   4. Work in progress: what is half done (branches, pull requests, deploys, helpers or chats with ids, schedules)?
      How do you check each?
   5. Traps: what was tried and failed, and why? Which judgements were made, on what grounds? What would a new chat
      get wrong?
   Answer only from the page and the notes. Cite the source of each line (page or notes, and the part). Say "not in
   notes" where they are silent.
   ```
   It cannot be started (no tool, refused): go to step 9 with ⚠️, the reason and the notes' link.
5. Answer key (about 40 s, while the new chat starts). Before reading any answer, create the Google Doc
   `handover-quiz` in the same folder: per question 3 to 8 must-have points (a name, number, command or quote) from
   the page and the notes. A point the notes lack goes into the notes first.
6. Wait. get_session on the new chat about every 20 s (between checks: Bash `sleep 20` with run_in_background; you
   are woken when it ends) until its status_bucket is no longer "working"; at most 5 minutes. Read its answer:
   list_events with kinds ["result"] (else ["assistant"]), the newest. Check its configured_model and
   external_metadata.last_served_model against this chat's model, and its Effort line against this chat's effort.
7. Judge. Each key point is hit (stated and specific), miss (absent, or "not in notes") or wrong (contradicts). A line
   with no source counts as wrong. A question passes when every point is hit and none is wrong. Append to
   `handover-quiz` (Docs update_doc): the round, each question's verdict and its misses, model and effort.
8. A second round, only for misses. Add or move each missed fact in the notes, rewrite each line that misled, then
   mcp__claude-code-remote__send_message to the new chat: `Notes changed <time> UTC (parts <X, Y>). Read them again;
   answer questions <N, M> again, same format.` Wait and judge as in steps 6 and 7. No third round: what still fails
   goes to George.
9. Ask George, one message (rules 11 and 22):
   - every question passed: `✅ New chat ready: <link>. Continue there?`
   - otherwise: `⚠️ New chat ready: <link>. Continue there?`, then one line per failed question.
   - a line when model or effort differ, and the `handover-quiz` link.
10. His yes: one step (rule 15): **Type** `continue <name>` in the new chat, <link>; he will see its brief. Then this
    chat's last line is `Moved to <link>.` and it writes nothing more; archiving it waits for his yes. His no: carry
    on here; the new chat stays as it is.
