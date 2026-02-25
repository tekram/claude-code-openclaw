# Plan: Advanced TODO List Management in OpenClaw Studio

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-02-21
**Last Updated**: 2026-02-22

## Overview
Build a full-featured TODO management frontend into OpenClaw Studio that goes beyond read-only display. Users should be able to create, complete, edit, delete, and organize TODO items directly from the dashboard. Items sync bidirectionally with `~/CAPTURES.md` so Telegram-captured ideas and dashboard-managed TODOs share the same source of truth. Also added Telegram-based TODO management commands.

## Tasks
- [x] Step 1: Add write API endpoints (POST/PATCH/DELETE) to `/api/todos`
- [x] Step 2: Upgrade `/todos` page with interactive management UI
  - Toggle completion (checkbox)
  - Add new items (with optional project tag)
  - Edit items inline
  - Delete items
  - Status filter (all/pending/completed)
  - Project filter dropdown
- [x] Step 3: Add project filtering/grouping on the todos page
- [x] Step 4: Update TodosWidget banner to allow quick-add and quick-toggle from main page
- [x] Step 5: Update CLAUDE.md with new TODO management docs
- [x] Step 6: Create Telegram TODO management scripts (manage-todos.js, telegram-todos-handler.js)
- [x] Step 7: Update USER.md with Telegram trigger phrases
- [x] Step 8: Add to exec-approvals.json allowlist

## Files Affected
- `src/app/api/todos/route.ts` - Full CRUD: GET, POST, PATCH, DELETE with CAPTURES.md sync
- `src/app/todos/page.tsx` - Interactive management UI with filters, inline edit, add form
- `src/components/TodosWidget.tsx` - Quick-add input + quick-toggle checkboxes in banner
- `~/.claude/CLAUDE.md` - Updated dashboard and TODO docs
- `~/.openclaw/workspace/manage-todos.js` - CLI/Telegram TODO management (list/add/complete/delete/edit)
- `~/.openclaw/workspace/telegram-todos-handler.js` - Telegram message pattern handler
- `~/.openclaw/workspace/todos-command.js` - OpenClaw bridge for Telegram
- `~/.openclaw/workspace/USER.md` - Telegram trigger phrases for TODO management
- `~/.openclaw/exec-approvals.json` - Allowlisted new command patterns

## Risks & Considerations
- File write contention if Telegram bot and dashboard write simultaneously (low risk — human-speed operations)
- Must preserve markdown formatting and headers in CAPTURES.md when rewriting
- Windows CRLF handling: all reads strip \r\n to \n before parsing

## Implementation Notes
- Windows CRLF was the main gotcha — regex patterns using `$` anchor fail on `\r\n` lines. Fixed by stripping `\r\n` → `\n` on all file reads.
- Pattern ordering matters in Telegram handler — "uncomplete" must be matched before "complete" since the latter is a substring.
- Git bash expands `/todos` as a file path in CLI tests, but actual Telegram messages arrive correctly.
- API uses index-based operations for PATCH/DELETE which is simple but means concurrent writes could shift indices. Acceptable for human-speed single-user usage.

## Completion Summary
**Completed on**: 2026-02-22
**Completed by**: Claude Code

Implemented full TODO management across three surfaces:
1. **Web Dashboard** (`/todos` page) — Interactive CRUD with status/project filters, inline editing
2. **Studio Banner** (main page widget) — Quick-add and quick-toggle from the main page
3. **Telegram** — Natural language commands: "show todos", "complete todo 2", "add todo: ...", etc.

All three surfaces read/write the same `~/CAPTURES.md` file, keeping everything in sync.
