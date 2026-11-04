# The nightly score: the prompt of the scheduled task

A scheduled task (claude.ai/code, the environment "Kokonut", a fresh chat on each firing, repo kokonut-rules) sends
this prompt once a day. The chat reads yesterday's chats and replies with one line per chat. It changes nothing.
George reads the line in the task's chat. The score comes from `scripts/score.js` (what each number is: the top of
that file). Create or change the task only on George's yes.

```
Score yesterday's chats. Read only: change, send, delete or start nothing.
1. mcp__claude-code-remote__list_sessions with mine true, limit 60. Keep the sessions whose updated_at is within the
   last 24 hours and whose origin is not claude_code_mcp_seed (those are helpers and tests).
2. For each kept session: mcp__claude-code-remote__list_events with its id, kinds ["assistant"], limit 100, no cursor
   (the newest 100 events). When the result is saved to a file, keep the path; otherwise write the JSON to a file in
   the scratchpad.
3. Run, once, with every file: node /home/user/kokonut-rules/scripts/score.js --name "<title>" <file> ... (one --name
   before each file, the session's title, else its id).
4. Reply with the script's lines only, one per chat, nothing else. A session that could not be read: one line
   "<title>: not read (<why>)".
```
