# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**claude-dash** is a Next.js dashboard for Claude Code session tracking and Captures/TODO management. It reads from `~/.openclaw/workspace/sessions.log` (written by hook scripts) and `~/CAPTURES.md`.

Stack: Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4, Lucide React icons.

## Development Commands

```bash
npm run dev        # Start dev server at http://localhost:3000
npm run build      # Build production bundle
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

## Architecture

### API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/sessions` | GET, POST | Read sessions log; POST actions: `dismiss`, `markDone`, `addNote` |
| `/api/sessions/stream` | GET | SSE stream — pushes `SessionsData` on every log/activity file change (200ms debounce); heartbeat every 30s |
| `/api/sessions/stats` | GET | Aggregate counts by status/project, interrupt reasons |
| `/api/sessions/export` | GET | Export as JSON or CSV (`?format=csv&project=optional`) |
| `/api/todos` | GET, POST, PATCH, DELETE | Read/write `~/CAPTURES.md` checklist items |
| `/api/openclaw/config` | GET | Detect OpenClaw gateway config & available channels |
| `/api/openclaw/setup-hooks` | POST | Auto-configure hooks token in `~/.openclaw/openclaw.json` |
| `/api/notifications/prefs` | GET, PUT | Read/write `~/.openclaw/workspace/claude-dash-notifications.json` |
| `/api/notifications/test` | POST | Fire a test notification |

### Pages & Components

- **`/` (`page.tsx`)**: Two-panel layout — `<SessionsPanel>` (60%) + `<CapturesPanel>` (40%). Both are Client Components polling every 20s and 30s respectively.
- **`/settings`**: Houses `<NotificationSettings>` — channel selector, delivery mode, per-rule toggles with delay options.
- **`src/lib/sessions/`**: `parse.ts` — server-side shared parsing (used by all session routes + SSE stream); `actions.ts` — client-side API call helpers; `formatting.ts` — client-side duration/time display.
- **`src/types/`**: `sessions.ts`, `todos.ts`, `notifications.ts` — all shared types.

### Data Sources

| Data | Default Path | Override |
|------|-------------|---------|
| Sessions log | `~/.openclaw/workspace/sessions.log` | `CLAUDE_DASH_LOG_PATH` env var |
| Notification prefs | `~/.openclaw/workspace/claude-dash-notifications.json` | `CLAUDE_DASH_NOTIF_PREFS` env var |
| OpenClaw config | `~/.openclaw/openclaw.json` | `OPENCLAW_CONFIG_PATH` env var |
| Captures | `~/CAPTURES.md` | — |
| Session owner cache | `~/.openclaw/workspace/.session-owners/{project}.json` | — |
| Latest activity | `~/.openclaw/workspace/.session-owners/{project}.activity` | — |

### Session Status Flow

```
START → active
  UserPromptSubmit → HEARTBEAT (keeps active)
  PreToolUse (permission) → PAUSED → paused
  PostToolUse → RESUMED → active
  SessionEnd (clean) → EXIT → exited (reason: manual)
  SessionEnd (unclean) → EXIT → exited (reason: crash)
  4h inactivity → exited (reason: timeout)
  User action → dismissed / completed
```

Sessions older than 24h are hidden from the UI regardless of status.

### Session Ownership & Activity Files

The hook writes two lightweight files to avoid full log parsing on every poll:
- `.session-owners/{project}.json` — cached `{sessionId, status, lastUpdated}` for ownership/dedup
- `.session-owners/{project}.activity` — last tool description + timestamp, shown as "Reading file" / "Running: npm test" in the UI. Overwritten each time (no bloat). A session is "actively working" if this file is < 30s old.

### Notification System

Two delivery modes configurable in Settings:
- **Via OpenClaw**: POSTs to `{gatewayUrl}/hooks/agent` — logged in gateway, AI may rephrase
- **Direct**: Uses Telegram Bot API directly — fast, exact messages, Telegram-only

Rules are per-event-type (`question`, `bash`, `file`, `done`, `crash`, `start`) with an optional delay in minutes. Zero-delay rules fire immediately via a detached child process from within the hook. Delayed rules write a `.pending-notif.json` file for `notification-watcher.js` (a cron-driven watcher).

### Project Name Mapping

The hook (`hooks/session-hook.js`) maps `cwd` to project names via `DIR_TO_PROJECT`. Unknown directories fall back to `basename(cwd)`. To track a new project, add its directory name to this object.

## Hook Setup

See `hooks/README.md` for installing `session-hook.js` into `~/.openclaw/workspace/` and wiring it into `~/.claude/settings.json` for all 5 hook events.

## Private Extensions

The `local/` directory is gitignored. Add private API routes and components there, then import or symlink from `src/app/`. See `local.example/README.md` for patterns.

## Path Alias

`@/*` maps to `src/*` (configured in `tsconfig.json`).
