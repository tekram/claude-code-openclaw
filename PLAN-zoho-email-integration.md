# Plan: Zoho Email Integration for OpenClaw Studio

**Status**: In Progress
**Tool**: Claude Code
**Created**: 2026-02-24
**Last Updated**: 2026-02-24

## Tasks

### Phase 1: Foundation — Types, Config, OAuth

- [x] Create `src/types/zoho.ts` — interfaces for ZohoAccount, ZohoEmail, ZohoEmailDraft, ZohoDailySummary, ZohoEmailsData
- [x] Create `src/lib/zoho/config.ts` — read/write config, multi-account token storage, token validity check
- [x] Create `src/lib/zoho/api.ts` — Zoho API client with auto token refresh, rate limit handling, htmlToPlainText
- [x] Create `src/app/api/zoho/auth/route.ts` — OAuth redirect with slot in state param
- [x] Create `src/app/api/zoho/callback/route.ts` — exchange code for tokens, get accountId + email, store in config
- [x] Create `src/app/api/zoho/status/route.ts` — return per-account token status

### Phase 2: API Routes — Email & Draft Management

- [x] Create `src/app/api/zoho/emails/route.ts` — GET unread from all accounts, merged + sorted
- [x] Create `src/app/api/zoho/drafts/route.ts` — GET list drafts, PATCH update status
- [x] Create `src/app/api/zoho/send/route.ts` — POST send approved reply via Zoho Mail API
- [x] Create `src/app/api/zoho/summary/route.ts` — GET latest daily summary

### Phase 3: UI — ZohoEmailTab in FlowsSidebar

- [x] Create `src/components/FlowsSidebar/ZohoEmailTab.tsx` — tab with polling, account status, drafts grouped by status
- [x] Modify `src/components/FlowsSidebar.tsx` — add 'zoho' to Tab union + tab button + render

### Phase 4: Automation — Workspace Script

- [x] Create `~/.openclaw/workspace/zoho-check.js` — daily triage script with --status and --dry-run flags
- [ ] Set up cron job via Gateway — "Daily Email Check", schedule `0 9 * * 1-5`

### Phase 5: Polish

- [x] Rate limiting (500ms delay between content fetches, 429 backoff) — built into api.ts
- [x] HTML→plain text conversion — htmlToPlainText in api.ts
- [ ] Test two-account OAuth flow
- [x] Windows path handling (USERPROFILE fallback, path.join) — throughout

## Verification

1. TypeScript typecheck: PASS
2. ESLint: No new errors (only pre-existing warnings in other files)

## Implementation Notes

- Followed LinkedIn pipeline pattern exactly: same config module structure, same draft CRUD, same tab component pattern
- Zoho uses `Zoho-oauthtoken` header (not Bearer) — handled in api.ts
- Token refresh is automatic via refresh_token grant — no manual re-auth needed unless refresh token is revoked
- State param in OAuth flow encodes account slot (0 or 1) via base64url JSON for two-account support
- Cron script batches emails in groups of 50 for triage to handle large unread counts
