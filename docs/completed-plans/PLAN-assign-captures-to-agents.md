# Plan: Assign Captures to OpenClaw Agents

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-02-25
**Last Updated**: 2026-02-25

## Overview
Closes the loop between captures and OpenClaw agents. A capture can be dispatched as a task directly to an OpenClaw agent from the dashboard UI.

## Tasks

- [x] Add `assignedTo?: string` field to `TodoItem` type in `src/types/todos.ts`
- [x] Extract shared captures logic to `src/lib/captures.ts` (parse + write `_(assigned: agentId)_` suffix)
- [x] Refactor `src/app/api/todos/route.ts` to import from shared lib
- [x] Extend `GET /api/openclaw/config` to include `agents: { id, label }[]` by listing `~/.openclaw/agents/` subdirectories
- [x] Add `OpenClawAgent` interface and `agents` field to `OpenClawConfig` type in `src/types/notifications.ts`
- [x] Create `POST /api/todos/assign/route.ts` — dispatches task to agent and marks TODO as assigned in CAPTURES.md
- [x] Update `CapturesPanel.tsx` — add Assign button per pending item, agent picker + editable message modal, assigned badge on items

## Files Affected

- `src/types/todos.ts` — added `assignedTo?: string` to `TodoItem`
- `src/lib/captures.ts` — **new shared lib** with `readCaptures`, `writeCaptures`, `formatItem`, `CAPTURES_PATH`
- `src/app/api/todos/route.ts` — refactored to import from `src/lib/captures`; handles `assignedTo` preservation on round-trips
- `src/types/notifications.ts` — added `OpenClawAgent` interface; added `agents: OpenClawAgent[]` to `OpenClawConfig`
- `src/app/api/openclaw/config/route.ts` — added `getAgents()` function listing `~/.openclaw/agents/` subdirectories
- `src/app/api/todos/assign/route.ts` — **new file**, POSTs to `/hooks/agent` then writes `_(assigned: agentId)_` to CAPTURES.md
- `src/components/CapturesPanel.tsx` — Assign button (Bot icon, hover-reveal), modal with agent dropdown + editable textarea, assigned badge (`→ agentId`)

## CAPTURES.md format

```
- [ ] my task text _(from project-name)_ _(assigned: main)_
```

## Completion Summary
**Completed on**: 2026-02-25
**Completed by**: Claude Code

Implemented as planned. Key decision: extracted shared captures parsing/formatting to `src/lib/captures.ts` rather than duplicating logic in the assign route. TypeScript strict mode passes cleanly (`npm run typecheck` — no errors).

Known limitation: `agentId` routing via `/hooks/agent` payload may not be supported by all OpenClaw versions — tasks may silently route to the default agent.
