# Plan: Activity Insights & Session Heatmap

**Status**: In Progress
**Tool**: Claude Code
**Created**: 2026-02-27
**Last Updated**: 2026-02-27

## Overview

Add a GitHub-style activity calendar ("contribution heatmap") plus productivity insights to the dashboard. The new `/insights` page shows:
- 52-week session heatmap with day-of-week alignment and month labels
- Key stats: total sessions, total coding hours, current streak, peak hour
- Hourly distribution bar chart (24-hour view)
- Day-of-week distribution bar chart
- Hover tooltip on heatmap cells

Data comes entirely from the existing `sessions.log` — no new external dependencies or data sources needed. The feature gives the user an at-a-glance view of their AI-coding patterns over time.

**Autonomous decision**: Chose heatmap + insights over other options (notifications history, session cost estimator, dark mode toggle) because it is visually impressive on first load, requires no external services or API keys, and complements the existing analytics page without duplicating it. The analytics page shows aggregate counts; the insights page shows *when* work happens.

## Tasks

- [x] Create `src/app/api/sessions/heatmap/route.ts` — API endpoint returning daily counts, hourly distribution, streaks, day-of-week counts, totals
- [x] Create `src/app/insights/page.tsx` — client component with heatmap grid, stats cards, hourly chart, day-of-week chart, hover tooltip
- [x] Update `src/app/page.tsx` — add "Insights" nav link in the sessions panel header (alongside Settings)
- [x] Verify `npm run typecheck` passes
- [x] Commit all changes

## Files Affected

- `src/app/api/sessions/heatmap/route.ts` — new GET route
- `src/app/insights/page.tsx` — new page
- `src/app/page.tsx` — add nav link

## Risks & Considerations

- Heatmap cell alignment: must pad start so row 0 = Sunday. Handled via `firstDow` calculation.
- Large log files: `parseLogLines` is O(n) but acceptable for this use case (same as existing stats route).
- Timestamps in log are local time, not UTC — `substring(0, 10)` extracts local date correctly since the log uses local time format `YYYY-MM-DD HH:MM:SS`.
- Horizontal overflow: heatmap is ~700px wide; handled with `overflow-x-auto` on the container.
- Empty data (new install): all cells show as level-0 gray; stats show 0 — looks fine, not broken.

## Implementation Notes

- Used CSS grid with `gridAutoFlow: column` and `gridTemplateRows: repeat(7, Npx)` — this fills columns first, exactly like GitHub's calendar.
- Color levels: 5 levels (0=muted, 1-4=primary with increasing opacity). Uses Tailwind `bg-primary/25`, `bg-primary/45`, `bg-primary/70`, `bg-primary` — all theme-aware via CSS variables.
- Hover tooltip: fixed-position div tracking mouse clientX/Y — avoids z-index issues with overflow-x-auto.
- Day-of-week labels: only alternate labels shown (Mon, Wed, Fri) to avoid crowding.
- Month labels: positioned absolutely above the grid using column index × cell stride.
- Streak: counts consecutive days with ≥1 session going backward from today. If today = 0, streak = 0.
- Total duration: computed from `session.durationMs` in `parseLogLines` output — same as stats route.

## Completion Summary

**Completed on**: 2026-02-27
**Completed by**: Claude Code

Implemented all 4 tasks. The `/insights` page provides a GitHub-style 52-week activity calendar with hover tooltips, 4 stat cards (total sessions, coding hours, streak, peak hour), hourly distribution bars, and day-of-week breakdown. Accessible via new "Insights" link in the main dashboard header. `npm run typecheck` passes clean.
