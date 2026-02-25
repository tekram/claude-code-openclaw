# Plan: OpenClaw Notification Integration

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-02-25

## Overview

Wire claude-dash into OpenClaw's existing messaging infrastructure so Claude Code session
events (question asked, permission needed, done, crashed) push to Telegram/WhatsApp/Discord
— whichever channels the user has configured in OpenClaw.

Zero credential duplication: all bot tokens, chat IDs, and gateway auth are read directly from
`~/.openclaw/openclaw.json` and `~/.openclaw/credentials/`. User only configures which events
they care about.

## Architecture

```
session-hook.js (event fires)
    ↓ reads ~/.openclaw/openclaw.json (gateway URL + token)
    ↓ reads ~/.openclaw/workspace/claude-dash-notifications.json (user's event prefs)
    ↓
POST http://127.0.0.1:{port}/hooks/agent
  { message, deliver: true, channel: "telegram", to: "1706765619" }
    ↓
OpenClaw gateway → Telegram/WhatsApp/Discord
```

claude-dash settings page auto-discovers channels from OpenClaw config and lets user
configure which events trigger notifications on which channel.

## Tasks

- [ ] **Step 1**: Create `src/types/notifications.ts`
  - `NotificationRule` type: `{ type, enabled, minMinutes }`
  - `NotificationPrefs` type: `{ channel, to, rules }`
  - `OpenClawChannel` type: `{ id, label, to, enabled }`
  - `OpenClawConfig` type: `{ gatewayUrl, gatewayToken, channels }`

- [ ] **Step 2**: Create `src/app/api/openclaw/config/route.ts` (`GET`)
  - Read `~/.openclaw/openclaw.json` (fallback: `OPENCLAW_CONFIG_PATH` env var)
  - Extract: `gateway.port`, `gateway.auth.token`, `channels.*` keys
  - For telegram: read `~/.openclaw/credentials/telegram-allowFrom.json` for `to` value
  - For whatsapp/discord/slack: check credentials dir for similar files
  - Return: `{ gatewayUrl, gatewayToken, channels: [{ id, label, to, enabled }] }`
  - If openclaw.json not found: return `{ detected: false }`

- [ ] **Step 3**: Create `src/app/api/notifications/prefs/route.ts` (`GET` + `PUT`)
  - Prefs file location: `~/.openclaw/workspace/claude-dash-notifications.json`
  - `GET`: read and return prefs (return sensible defaults if file missing)
  - `PUT`: validate and write prefs file
  - Default rules: `done=true/0min`, `crash=true/0min`, `question=true/0min`,
    `bash=false/10min`, `file=false/0min`, `start=false/0min`

- [ ] **Step 4**: Create `src/app/api/notifications/test/route.ts` (`POST`)
  - Reads openclaw config + prefs
  - Fires a test notification via `/hooks/agent` with `deliver: true`
  - Message: "✅ Claude Dash notifications are working"
  - Returns `{ sent: true }` or `{ sent: false, error }`

- [ ] **Step 5**: Create `src/components/NotificationSettings.tsx`
  - On mount: fetch `/api/openclaw/config` + `/api/notifications/prefs`
  - If OpenClaw not detected: show setup instructions linking to openclaw repo
  - Channel selector: dropdown of enabled channels found in OpenClaw (auto-populated)
  - Notification rules list:
    ```
    ❓ Claude asked me a question      [✅ on]  [immediately ▼]
    ⏸ Claude needs bash permission     [✅ on]  [after 10 min ▼]
    📄 Claude needs file permission    [☐ off] [immediately ▼]
    ✅ Session completed (overnight)   [✅ on]  [immediately ▼]
    💀 Session crashed / interrupted   [✅ on]  [immediately ▼]
    🚀 Session started                 [☐ off] [immediately ▼]
    ```
  - "Send test notification" button → POST `/api/notifications/test`
  - Auto-save on toggle (PUT `/api/notifications/prefs`)

- [ ] **Step 6**: Create `src/app/settings/page.tsx`
  - Minimal wrapper: page header + `<NotificationSettings />`
  - Same layout style as main page

- [ ] **Step 7**: Add settings link to main layout
  - Add gear icon / "Settings" link in `src/app/layout.tsx` or `page.tsx`
  - Link to `/settings`

- [ ] **Step 8**: Update `hooks/session-hook.js` — notification dispatch
  - New function `readNotificationPrefs()`: reads `~/.openclaw/workspace/claude-dash-notifications.json`
  - New function `readOpenClawGateway()`: reads `~/.openclaw/openclaw.json` → `{ url, token, to }`
  - New function `fireNotification(message, prefs, gateway)`: POSTs to `/hooks/agent` with
    `{ message, deliver: true, channel: prefs.channel, to: prefs.to, name: "ClaudeDashNotif" }`
    Fire-and-forget (don't await, don't block hook)
  - In `handlePreToolUse`:
    - After PAUSED: determine rule type (`question` / `bash` / `file`)
    - If rule enabled + minMinutes=0: call `fireNotification` immediately
    - If rule enabled + minMinutes>0: write pending file to `.session-owners/{project}.pending-notif.json`
      with `{ type, message, timestamp, rule }`
  - In `handlePostToolUse` (RESUMED):
    - Delete any pending notification file for this project
  - In `handleUserPromptSubmit` (RESUMED from paused):
    - Delete any pending notification file for this project
  - In `handleSessionEnd` DONE (new — currently sessions are only marked DONE manually):
    - Check if `done` rule enabled → fire notification with session details
  - In `handleSessionEnd` EXIT:
    - Check if `crash` rule enabled → fire notification

- [ ] **Step 9**: Add `notification-watcher.js` to `hooks/`
  - Lightweight script to check pending notifications (for minMinutes > 0 cases)
  - Reads all `.session-owners/*.pending-notif.json` files
  - For each: if elapsed >= minMinutes AND project status still `paused` → fire → delete
  - If project status no longer paused → delete (resolved, no need to notify)
  - Designed to run via cron: `*/5 * * * * node ~/.openclaw/workspace/notification-watcher.js`
  - Also copy to `~/.openclaw/workspace/` in README setup instructions

- [ ] **Step 10**: Update `hooks/README.md`
  - Add section: "Notification Setup"
  - Copy `notification-watcher.js` to `~/.openclaw/workspace/`
  - Add cron entry for watcher
  - Explain: notifications auto-configure from OpenClaw, visit `/settings` to choose events

- [ ] **Step 11**: `npm run build` — verify clean TypeScript build

## Files Affected

- `src/types/notifications.ts` — new
- `src/app/api/openclaw/config/route.ts` — new
- `src/app/api/notifications/prefs/route.ts` — new
- `src/app/api/notifications/test/route.ts` — new
- `src/components/NotificationSettings.tsx` — new
- `src/app/settings/page.tsx` — new
- `src/app/layout.tsx` — add settings link
- `hooks/session-hook.js` — add notification dispatch (~60 lines)
- `hooks/notification-watcher.js` — new (~80 lines)
- `hooks/README.md` — update setup docs

## Notification Message Formats

```
❓ agentic-trading: Claude is asking —
   "Which database strategy should I use for caching?"
   (waiting 2 min)

⏸ agentic-trading: Permission needed —
   bash `npm run build && npm test`
   (waiting 14 min)

✅ claude-dash: Session done —
   Extracted OpenClaw features, moved LinkedIn/Zoho to local/

💀 agentic-trading: Session crashed or interrupted
```

## Risks & Considerations

- **OpenClaw not running**: `/hooks/agent` call will fail silently (fire-and-forget is fine)
- **No openclaw.json**: API returns `{ detected: false }`, settings page shows setup guide
- **minMinutes > 0 watcher**: requires cron setup — document clearly, mark as optional
- **`/hooks/agent` is async** (202 response): model processes message before sending to Telegram
  (slight delay, but message gets nicely formatted by the AI)
- **Multiple channels**: v1 supports one channel at a time; multi-channel is a future enhancement
- **Pending notification file format**: store in `.session-owners/` dir (already exists and is writable)

## Implementation Notes

_To be filled during implementation_

## Completion Summary

_To be filled when done_
