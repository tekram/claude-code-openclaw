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

## Notifications (Optional)

Push notifications to Telegram, WhatsApp, or any channel you have configured in OpenClaw.

**Requirements:** OpenClaw must be installed and its gateway running.

### Setup

1. Copy the notification watcher:
   ```bash
   cp hooks/notification-watcher.js ~/.openclaw/workspace/notification-watcher.js
   ```

2. Add a cron entry for delayed notifications (e.g. "notify after 10 min waiting"):
   ```bash
   # In your crontab (crontab -e):
   */5 * * * * node ~/.openclaw/workspace/notification-watcher.js
   ```

3. Open the dashboard at `http://localhost:3000/settings` and configure which events you want to be notified about. Channels are auto-discovered from your OpenClaw config — no tokens to copy.

### What triggers a notification

| Rule | When |
|---|---|
| `question` | Claude used `AskUserQuestion` — it's waiting for your answer |
| `bash` | Claude needs permission to run a bash command |
| `file` | Claude needs permission to write or edit a file |
| `done` | Session marked complete (via `active-sessions.js done`) |
| `crash` | Session exited unexpectedly while active or paused |
| `start` | New Claude Code session started |

Each rule can be set to fire immediately or only after a configurable delay (useful for `bash` — you don't need a ping every time Claude runs a command, only if you've been away a while).

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
