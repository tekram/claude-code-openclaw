# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**claude-dash** is a standalone dashboard for Claude Code session tracking and Captures management. It reads from `~/.openclaw/workspace/sessions.log` (written by the hook scripts) and `~/CAPTURES.md`.

No gateway, no agent management — just a focused dashboard for Claude sessions.

## Development Commands

```bash
npm run dev        # Start dev server at http://localhost:3000
npm run build      # Build production bundle
npm run typecheck  # Run TypeScript checks
```

## Architecture

- **Sessions**: `/api/sessions` reads `~/.openclaw/workspace/sessions.log`
- **Captures**: `/api/todos` reads/writes `~/CAPTURES.md`
- **Frontend**: Two-panel layout in `src/app/page.tsx`

## Environment Variables

```bash
# Override default log path
CLAUDE_DASH_LOG_PATH=/path/to/sessions.log
```

## Private Extensions

The `local/` directory is gitignored. Add private API routes and components there.
To wire them in, symlink or import them from `src/app/` manually.

See `local.example/README.md` for patterns.

## Hook Setup

See `hooks/README.md` for how to configure Claude Code to automatically track sessions.
