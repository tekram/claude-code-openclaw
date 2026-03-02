# Plan: Session Stats Dashboard (/stats page)

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-03-01
**Last Updated**: 2026-03-01

## Overview

Built a comprehensive `/stats` page that goes well beyond the existing `/insights` page. The new
page provides a multi-panel analytics dashboard with per-project drill-down, a punch-card heatmap
(hour × day-of-week matrix), session duration histogram, weekly productivity trend with dual-axis
(sessions + coding time), completion rate trend line, expandable per-project breakdown, and a
weekly data table.

The stats page is filterable by project — selecting a project pill in the header refetches all
charts filtered to that project only.

## Tasks

- [x] Step 1: Read all existing pages, API routes, components, and types to understand patterns
- [x] Step 2: Design the new API route (`/api/sessions/stats-detail`) with richer computed data
- [x] Step 3: Implement the API route with full TypeScript types exported for client import
- [x] Step 4: Build the `/stats` page with all chart components as pure SVG/CSS (no new deps)
- [x] Step 5: Add "Stats" nav link to the main page header (between Insights and History)
- [x] Step 6: TypeScript check (clean) and production build (clean)
- [x] Step 7: Write this PLAN file

## Files Affected

- `src/app/stats/page.tsx` — New page, ~580 lines, fully client-rendered
- `src/app/api/sessions/stats-detail/route.ts` — New API route, ~250 lines
- `src/app/page.tsx` — Added "Stats" nav link

## New API: `/api/sessions/stats-detail`

Accepts optional `?project=<name>` query param to filter all metrics to a single project.

Returns `StatsDetailData` with:
- Summary totals: sessions, duration, avg/median duration, completion rate, longest session
- `punchCard`: 24 × 7 = 168 cells (hour 0-23 × weekday 0-6) with session counts
- `durationHistogram`: 8 buckets from "< 1m" to "4h+" with counts
- `weeklyTrend`: last 16 weeks (Monday-aligned) with sessions, minutes, completed, exited
- `projects`: per-project `ProjectDetail` objects with hourly/DOW arrays, stats, averages
- `projectNames`: sorted list (by total sessions) for the filter UI

## New Page: `/stats`

Charts (all built with inline SVG or CSS/Tailwind, no charting library):

| Chart | Type | Description |
|---|---|---|
| Summary cards | CSS | 4 stat cards with icons |
| Activity Punch Card | CSS grid | 24h × 7-day matrix with hover tooltips |
| Weekly Trend | CSS flexbox bars | Session bars + coding time overlay, 16 weeks |
| Duration Histogram | CSS flexbox bars | 8 duration buckets |
| Completion Rate Trend | Inline SVG polyline | Week-by-week done% with filled area |
| Per-project breakdown | CSS rows | Expandable rows with hourly + DOW mini-bars |
| Weekly data table | HTML table | Last 12 active weeks with colour-coded completion% |

Project filter pills in the header let the user switch between "All" and any individual project.
Switching fires a new fetch to `/api/sessions/stats-detail?project=<name>` and re-renders all
charts for that project's data.

## Risks & Considerations

- No new npm dependencies — all charts are hand-rolled SVG/CSS
- The punch card has 168 DOM elements (24 × 7); fine for performance
- `weeklyTrend` always covers the last 16 weeks even if most are empty — the weekly table
  filters to non-empty weeks only to avoid visual noise
- Per-project `ProjectDetail` objects always include all projects (not filtered), so the
  project list sidebar stays stable when a filter is active
- TypeScript strict mode fully satisfied; build is clean

## Implementation Notes

- Followed existing patterns exactly: `parseLogLines` for raw session parsing, same
  `formatDuration` from `@/lib/sessions/formatting`, same Tailwind CSS variable names
  (`bg-primary`, `border-border`, `text-muted-foreground`, etc.)
- The `monday-of-week` calculation uses local time (same approach as existing heatmap route)
- Exported types from the API route are imported directly in the page component
  (same pattern as `/insights` page importing `HeatmapData` / `HeatmapDay`)
- Completion rate trend uses inline SVG `<polyline>` + `<polygon>` for the filled area
  rather than a library — keeps the bundle small

## Completion Summary

**Completed on**: 2026-03-01
**Completed by**: Claude Code

Implemented `/stats` page with 7 chart types, per-project filtering, and a new
`/api/sessions/stats-detail` API route. All TypeScript types are strict and the production
build passes cleanly. Added "Stats" nav link to the main dashboard header between "Insights"
and "History".
