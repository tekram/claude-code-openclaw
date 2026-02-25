# Claude Code Session Tracking Hook

This hook automatically tracks Claude Code sessions and writes events to a log file that the dashboard reads.

## Setup

1. Copy `session-hook.js` to `~/.openclaw/workspace/`:
   ```bash
   cp hooks/session-hook.js ~/.openclaw/workspace/session-hook.js
   ```

2. Add the hook to your Claude Code settings (`~/.claude/settings.json`):
   ```json
   {
     "hooks": {
       "SessionStart": [
         { "type": "command", "command": "node ~/.openclaw/workspace/session-hook.js" }
       ],
       "PreToolUse": [
         { "type": "command", "command": "node ~/.openclaw/workspace/session-hook.js" }
       ],
       "PostToolUse": [
         {
           "type": "command",
           "command": "node ~/.openclaw/workspace/session-hook.js",
           "matcher": "AskUserQuestion|Bash|Write|Edit|NotebookEdit|Read|Grep|Glob|Task"
         }
       ],
       "UserPromptSubmit": [
         { "type": "command", "command": "node ~/.openclaw/workspace/session-hook.js" }
       ],
       "SessionEnd": [
         { "type": "command", "command": "node ~/.openclaw/workspace/session-hook.js" }
       ]
     }
   }
   ```

3. Restart Claude Code.

## Project Name Detection

The hook uses the directory name to determine the project name. Update `DIR_TO_PROJECT` in `session-hook.js` to map your project directories to display names:

```js
const DIR_TO_PROJECT = {
  'my-project': 'my-project',
  'another-repo': 'another-repo',
};
```

Unknown directories fall back to the directory basename.

## Log File

Sessions are logged to `~/.openclaw/workspace/sessions.log`. You can customize the log path with the `CLAUDE_DASH_LOG_PATH` environment variable.

## Session Events

| Event | When |
|---|---|
| `START` | New Claude Code session |
| `PAUSED` | Waiting for user input (permission prompt) |
| `RESUMED` | User responded, Claude is working again |
| `HEARTBEAT` | User sent a new message (keeps session alive) |
| `NOTE` | User-added note |
| `DONE` | Session marked complete from dashboard |
| `EXIT` | Claude Code session ended |
| `DISMISSED` | Session dismissed from dashboard |
