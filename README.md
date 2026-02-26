# claude-dash

A local dashboard for Claude Code session tracking. See which sessions are active, what Claude is currently doing, when it needs your input, and manage your idea backlog — all from a browser tab.

**Not a token/cost tracker.** The focus is workflow visibility: knowing when to walk away, when to come back, and what happened while you were gone.

## Features

- **Live session status** — Active, paused (needs your input), completed, and crashed sessions across all your projects
- **Tool-level activity** — See exactly what Claude is doing: "Reading route.ts", "Running: pytest", "Editing server.py"
- **Push notifications** — Get a Telegram message when Claude needs approval or asks a question, so you can walk away and come back only when needed
- **Session actions** — Dismiss, mark done, add notes directly from the dashboard
- **Crash detection** — Distinguishes clean exits from unexpected crashes
- **Captures/Todos** — Optional: manage a `~/CAPTURES.md` idea backlog alongside your sessions
- **Export** — Download session history as JSON or CSV

## How it works

A small hook script (`session-hook.js`) plugs into Claude Code's native hook events — `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionEnd`. It writes a lightweight append log and a few small state files. The dashboard reads those files and polls every 20 seconds.

No background daemon. No dependency on Claude's internal log format. No API calls.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code CLI](https://claude.ai/code) installed and in use

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the hook

Copy the hook script to a directory it will run from. All paths in the hook are relative to wherever you place it, so choose a stable location.

**Option A — recommended (`~/.claude-dash/`):**

```bash
mkdir -p ~/.claude-dash
cp hooks/session-hook.js ~/.claude-dash/session-hook.js
```

Then tell the dashboard where to find the log:

```bash
# Add to your shell profile (.bashrc / .zshrc / .profile)
export CLAUDE_DASH_LOG_PATH=~/.claude-dash/sessions.log
```

**Option B — if you use OpenClaw** (gateway already at `~/.openclaw/`):

```bash
cp hooks/session-hook.js ~/.openclaw/workspace/session-hook.js
```

No env var needed — the dashboard defaults to `~/.openclaw/workspace/sessions.log`.

### 3. Wire up the hooks in Claude Code

Add this to `~/.claude/settings.json` (merge with any existing `hooks` block). Update the path to match where you placed the script.

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

### 4. Run the dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Start a Claude Code session in any project — it should appear within seconds.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_DASH_LOG_PATH` | `~/.openclaw/workspace/sessions.log` | Path to the sessions log written by the hook |
| `CLAUDE_DASH_NOTIF_PREFS` | `~/.openclaw/workspace/claude-dash-notifications.json` | Notification preferences file |
| `OPENCLAW_CONFIG_PATH` | `~/.openclaw/openclaw.json` | OpenClaw config (only needed for OpenClaw-based notifications) |

## Project name mapping

The hook derives project names from the working directory basename. It works out of the box — `~/code/my-app` shows as `my-app`. To override, edit `DIR_TO_PROJECT` in your copy of `session-hook.js`:

```js
const DIR_TO_PROJECT = {
  'my-app': 'My App',
  'legacy-monorepo': 'platform',
};
```

## Notifications (optional)

Get pushed to Telegram when Claude needs your input. Two modes — no OpenClaw required:

- **Direct mode**: uses the Telegram Bot API directly. Provide a bot token and chat ID in the settings UI.
- **OpenClaw mode**: routes through an OpenClaw gateway if you have one running.

Configure at [http://localhost:3000/settings](http://localhost:3000/settings). Per-rule delays let you suppress noisy events (e.g. only notify about bash commands after 5 minutes of inactivity).

## Captures / Todos (optional)

The dashboard can manage a `~/CAPTURES.md` Markdown checklist as a lightweight idea backlog. If the file doesn't exist, the panel is hidden. This is designed for use with the [OpenClaw](https://github.com/tekram/openclaw-ollama-telegram) Telegram bot, which can append to the file from your phone — but you can also edit it directly.

## API

| Endpoint | Methods | Description |
|---|---|---|
| `/api/sessions` | GET, POST | Sessions grouped by status; POST for dismiss/markDone/addNote |
| `/api/sessions/stats` | GET | Aggregated counts by status/project |
| `/api/sessions/export` | GET | JSON or CSV export (`?format=csv&project=optional`) |
| `/api/todos` | GET, POST, PATCH, DELETE | Read/write `~/CAPTURES.md` |
| `/api/notifications/prefs` | GET, PUT | Notification preferences |
| `/api/notifications/test` | POST | Send a test notification |

## Private extensions

The `local/` directory is gitignored. Add private API routes and components there and import from `src/app/`. See [`local.example/README.md`](local.example/README.md).

## How it's different

Most Claude Code monitoring tools focus on **token and cost tracking** — how much you've spent, how many tokens per project, usage over time. That's useful, but it doesn't tell you what you need to know when you're running Claude in the background.

claude-dash is built around a different question: **is Claude stuck, working, or done?**

- **Hook-based, not log-parsing.** It uses Claude Code's native hook events rather than scraping internal log files. This means status transitions are precise and immediate — no polling the process, no parsing undocumented formats.
- **Tool-level activity, not just status.** When a session is active, the dashboard shows what tool Claude is currently using and on which file — "Editing server.py", "Running: pytest", "Searching for TODO". Not just a green dot.
- **Designed for walking away.** Push notifications mean you can leave Claude running overnight or across meetings and get pinged on your phone only when it needs you. Notifications have per-rule delays so you're not spammed for every file write.
- **Session actions.** You can dismiss stale sessions, mark work done with a note, and export history. It's not purely observational.
- **Crash detection.** Unexpected exits (process killed, machine sleep, OOM) are flagged separately from clean exits, so you know when something went wrong vs. when Claude just finished.
- **No API key needed.** Everything runs locally, reads local files, and makes no outbound requests except for optional Telegram notifications you configure yourself.
