# Plan: Claude Code CLI Dispatch from Captures

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-02-25
**Last Updated**: 2026-02-25

## Context

The captures panel already dispatches TODOs to OpenClaw agents via `/hooks/agent`. This plan adds a second dispatch mode — **Claude Code CLI** — where assigning a capture spawns `claude -p "task"` directly in the project directory. The session appears in the sessions panel automatically (hooks fire), and the final stdout output is captured and stored so the user can view the result from the captures panel. A new Settings section maps project names → absolute paths, needed to know which directory to `cd` into.

## Tasks

- [x] Add `taskId?: string` to `TodoItem` in `src/types/todos.ts`
- [x] Update `src/lib/captures.ts` — parse/write `_(taskid: ...)_` tag
- [x] Create `GET/PUT /api/settings/projects` — project name → path mapping
- [x] Create `GET /api/tasks/result` — read result file by `?id=uuid`
- [x] Extend `/api/todos/assign` — add `mode: 'openclaw' | 'claude'` branch with spawn + async stdout capture
- [x] Create `src/components/ProjectSettings.tsx` — project paths table UI
- [x] Update `src/app/settings/page.tsx` — add ProjectSettings section
- [x] Update `CapturesPanel.tsx` — mode toggle in assign modal, project path field, View Result button on items

## Files Affected

- `src/types/todos.ts` — added `taskId?: string`
- `src/lib/captures.ts` — parse/write `_(taskid: ...)_`
- `src/app/api/settings/projects/route.ts` — new GET/PUT route
- `src/app/api/tasks/result/route.ts` — new GET route
- `src/app/api/todos/assign/route.ts` — refactored into dispatchOpenClaw + dispatchClaude branches
- `src/components/ProjectSettings.tsx` — new table UI component
- `src/app/settings/page.tsx` — added Project Paths section
- `src/components/CapturesPanel.tsx` — mode toggle, result modal, FileOutput button

## Implementation Notes

- Used `shell: true` on spawn (required on Windows for `claude.cmd`)
- 50KB stdout truncation applied in both the result route and the spawn close handler
- `proc.unref()` called inside `close` handler to avoid dropping stdout pipe prematurely
- `TaskResult` type exported from route for import in CapturesPanel
- Assign button is always shown (previously only shown when agents > 0) since Claude mode doesn't need agents
- Project path auto-populated from `projectPaths[item.project]` in modal open handler

## Completion Summary

**Completed on**: 2026-02-25
**Completed by**: Claude Code

All 8 tasks implemented. `npm run typecheck` passes clean. Full spawn pipeline with async stdout capture, result file persistence at `~/.openclaw/workspace/task-results/{uuid}.json`, result viewer modal in CapturesPanel, and Project Paths settings UI in `/settings`.
