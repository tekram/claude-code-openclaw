# Claude Code Session Tracking Hook

`session-hook.js` plugs into Claude Code's native hook events and writes a lightweight log that the dashboard reads. It handles all five hook types: `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionEnd`.

## Setup

### 1. Copy the hook script

All paths in the hook are relative to wherever you place it. Choose a stable directory.

**If you don't use OpenClaw:**

```bash
mkdir -p ~/.claude-dash
cp hooks/session-hook.js ~/.claude-dash/session-hook.js
```

Then set the log path so the dashboard can find it:

```bash
# Add to your shell profile (.bashrc / .zshrc / .profile)
export CLAUDE_DASH_LOG_PATH=~/.claude-dash/sessions.log
```

**If you use OpenClaw** (its workspace directory already exists):

```bash
cp hooks/session-hook.js ~/.openclaw/workspace/session-hook.js
```

No env var needed — the dashboard defaults to `~/.openclaw/workspace/sessions.log`.

### 2. Add hooks to Claude Code settings

Edit `~/.claude/settings.json` (merge with any existing `hooks` block). Replace the path with wherever you placed the script.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }]
      }
    ],
    "PreToolUse": [
      { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Bash",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Write",           "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Edit",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "NotebookEdit",    "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] }
    ],
    "PostToolUse": [
      { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Bash",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Write",           "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Edit",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "NotebookEdit",    "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Read",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Grep",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Glob",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] },
      { "matcher": "Task",            "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }] }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{ "type": "command", "command": "node ~/.claude-dash/session-hook.js" }]
      }
    ]
  }
}
```

### 3. Restart Claude Code

New sessions will appear in the dashboard automatically.

## Project Name Detection

The hook uses the working directory basename as the project name. `~/code/my-app` → `my-app`. It works out of the box.

To override specific directories, edit `DIR_TO_PROJECT` in your copy of `session-hook.js`:

```js
const DIR_TO_PROJECT = {
  'my-app': 'My App',
  'legacy-monorepo': 'platform',
};
```

## Log File

Sessions are appended to `sessions.log` in the same directory as the hook script. Override the path the dashboard reads with `CLAUDE_DASH_LOG_PATH`.

## Notifications (Optional)

Push notifications to Telegram when Claude needs your input. Two delivery modes — OpenClaw is not required.

### Direct Telegram (no OpenClaw needed)

1. [Create a Telegram bot](https://core.telegram.org/bots#botfather) and get a bot token
2. Start a chat with your bot and get your chat ID
3. Open the dashboard at `http://localhost:3000/settings`
4. Select **Direct** delivery mode, enter your bot token and chat ID

### Via OpenClaw gateway

If you have OpenClaw installed and its gateway running:

1. Copy the notification watcher:
   ```bash
   cp hooks/notification-watcher.js ~/.openclaw/workspace/notification-watcher.js
   ```
2. Add a cron entry for delayed notifications:
   ```bash
   # crontab -e
   */5 * * * * node ~/.openclaw/workspace/notification-watcher.js
   ```
3. Configure at `http://localhost:3000/settings` — channels are auto-discovered from your OpenClaw config.

### Notification rules

| Rule | Triggers when |
|---|---|
| `question` | Claude used `AskUserQuestion` — waiting for your answer |
| `bash` | Claude needs permission to run a command |
| `file` | Claude needs permission to write or edit a file |
| `done` | Session marked complete |
| `crash` | Session exited unexpectedly while active |
| `start` | New Claude Code session started |

Each rule can fire immediately or only after a configurable delay. Useful for `bash` — you may not want a ping every time Claude runs a command, only if you've been away a while.

## OpenClaw Integration

### Dispatching Claude Code from an OpenClaw Agent

To configure an OpenClaw agent (SOUL.md, TOOLS.md, model config) that routes messages
to Claude Code CLI, see **[docs/openclaw-dispatch-claude.md](../docs/openclaw-dispatch-claude.md)**:

- Agent directory structure and SOUL.md / TOOLS.md setup
- Model config (`gpt-oss:120b-cloud` — cloud-routed, no cold-start delay)
- Claude Code CLI requirements (PATH, auth, `--dangerously-skip-permissions`)
- Webhook dispatch format from claude-dash web UI
- `NO_REPLY` behavior fix and stale session clearing

### Telegram Group Setup

If you want messages in a Telegram group routed through OpenClaw to Claude Code,
see **[docs/openclaw-telegram-groups.md](../docs/openclaw-telegram-groups.md)**:

- Getting the correct group chat ID (the `-100` prefix issue)
- Group policy config (`groupPolicy: "allowlist"` + `groups` per-group entry)
- Bot Privacy Mode — must disable via @BotFather
- Debugging silent message drops via gateway verbose logs

## Session Events

| Event | Meaning |
|---|---|
| `START` | New session began |
| `PAUSED` | Waiting for user input or permission |
| `RESUMED` | User responded, Claude is working again |
| `HEARTBEAT` | User sent a message (keeps session alive, prevents timeout) |
| `NOTE` | User-added note |
| `DONE` | Session marked complete from dashboard |
| `EXIT` | Session ended (clean or crash) |
| `DISMISSED` | Session dismissed from dashboard |
