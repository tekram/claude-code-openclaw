# claude-dash

Claude Code session dashboard. See what's active, paused, or interrupted. Tracks sessions via Claude Code hooks.

## Features

- **Session tracking** — Real-time view of active, paused, completed, and interrupted Claude Code sessions
- **Captures/Todos** — Read and manage your `~/CAPTURES.md` idea capture file
- **Activity indicators** — Shows what Claude is currently doing (reading files, running commands, etc.)
- **Session actions** — Dismiss, mark done, or export sessions as JSON/CSV
- **Stats endpoint** — `GET /api/sessions/stats` for aggregated metrics

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Claude Code hooks

Copy the hook script and configure your Claude Code settings to track sessions automatically. See [`hooks/README.md`](hooks/README.md) for detailed instructions.

### 3. Run the dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

### Log file path

By default, sessions are read from `~/.openclaw/workspace/sessions.log`. Override with:

```bash
CLAUDE_DASH_LOG_PATH=/path/to/sessions.log npm run dev
```

### Captures file

Captures/Todos are read from `~/CAPTURES.md`. This is not currently configurable.

## Private Extensions

The `local/` directory is gitignored for personal private routes and components. See [`local.example/README.md`](local.example/README.md) for how to add private extensions without committing them.

## API

| Endpoint | Description |
|---|---|
| `GET /api/sessions` | All sessions grouped by status |
| `POST /api/sessions` | Session actions (dismiss, markDone, addNote) |
| `GET /api/sessions/stats` | Aggregated session statistics |
| `GET /api/sessions/export?format=json\|csv` | Export sessions |
| `GET /api/todos` | Read captures from `~/CAPTURES.md` |
| `POST /api/todos` | Add new capture item |
| `PATCH /api/todos` | Update capture item |
| `DELETE /api/todos` | Delete capture item |
