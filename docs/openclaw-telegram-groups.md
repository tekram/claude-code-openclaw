# OpenClaw Telegram Group Setup — Gotchas & Config Reference

Hard-won notes from getting Telegram group routing working with OpenClaw agents.

> For setting up the OpenClaw code agent itself (SOUL.md, TOOLS.md, Claude CLI requirements),
> see **[docs/openclaw-dispatch-claude.md](./openclaw-dispatch-claude.md)**.

---

## 1. Get the Correct Group Chat ID

Telegram supergroup IDs have a `-100` prefix that apps often hide. The group may appear
as `-3705263697` in your app but the real API ID is `-1003705263697`.

**How to get the real ID:** Add [@getidsbot](https://t.me/getidsbot) to the group, type
`/start` — it immediately replies with the full numeric chat ID (e.g. `-1003705263697`).
Remove it after.

Use the full `-100...` ID everywhere in your OpenClaw config.

---

## 2. Binding Configuration

Add the group binding to `~/.openclaw/openclaw.json` under `agents.list[].bindings` or
the top-level `bindings` array:

```json
{
  "agentId": "code",
  "match": {
    "channel": "telegram",
    "peer": { "kind": "group", "id": "-1003705263697" }
  }
}
```

The binding controls **routing** (which agent handles the message). It does not by itself
allow the group through — you also need the group policy below.

---

## 3. Group Policy — The Part That Actually Blocks Messages

`groupPolicy: "allowlist"` at the top level of `channels.telegram` **silently drops all
group messages** unless the group is explicitly listed under `channels.telegram.groups`.

**What doesn't work:**
```json
"telegram": {
  "groupPolicy": "allowlist"   // ← drops everything silently, even if binding matches
}
```

**What works:**
```json
"telegram": {
  "groupPolicy": "allowlist",
  "groups": {
    "-1003705263697": {
      "groupPolicy": "open",
      "requireMention": false
    }
  }
}
```

The per-group config is the allowlist. Add each group you want to respond in.
Set `requireMention: false` so the bot responds to all messages, not just @mentions.

---

## 4. `allowFrom` — Sender Auth, Not Group Auth

`allowFrom` in the telegram config controls which **users** (by Telegram user ID) are
authorized to send messages. It does **not** accept group chat IDs.

```json
// WRONG — group ID in allowFrom causes "Invalid allowFrom entry" error
"allowFrom": ["-1003705263697"]

// RIGHT — your Telegram user ID (get it from @userinfobot via DM)
"allowFrom": ["1706765619"]
```

In practice, if `groupPolicy` is handled via the `groups` config above, you may not need
`allowFrom` at all for group messages.

---

## 5. Bot Privacy Mode

Telegram bots default to **Privacy Mode** — they only see messages that @mention them in
groups. To receive all group messages:

1. Open [@BotFather](https://t.me/botfather) → `/setprivacy` → select your bot → **Disable**
2. **Remove the bot from the group and re-add it** — Telegram applies the privacy change
   only when the bot (re)joins

Without this, the bot may appear to ignore messages even when config is correct.

---

## 6. Debugging Message Flow

When a group message doesn't produce a response, check gateway verbose logs:

| Log line | Meaning |
|---|---|
| `[telegram] update: {...}` | Message received by gateway |
| `[routing] match: matchedBy=binding.peer agentId=code` | Routing resolved correctly |
| `telegram inbound: chatId=...` | Passed group policy check, entering agent |
| `[agent/embedded] embedded run start` | Agent session started |
| `[diagnostic] session state: ... new=idle reason="run_completed"` | Agent finished |

If you see the `update` log but no `[routing] match` → group policy is still blocking.
If you see the `match` log but no `inbound` → `allowFrom` may be rejecting the sender.
If you see `inbound` but no `embedded run start` → check `maxConcurrent` or stale locks.

---

## 7. Agent Response Behavior

- The gateway adds a **✓ reaction** to received messages (`ackReactionScope: "all"` in
  config). This is the immediate acknowledgment — not a text message.
- Text responses appear after the agent finishes processing (including any `exec` calls).
- If the agent returns `NO_REPLY`, no text is sent. For a coding agent, this is the
  default for non-task messages like "hi". Fix it in the agent's `SOUL.md`:

```markdown
## Greetings & Non-Task Messages

For greetings ("hi", "hello") reply with a short acknowledgment.
Do NOT return NO_REPLY for greetings — always respond so the user knows the bot is alive.
```

---

## 8. Stale Sessions & SOUL.md Changes

OpenClaw reuses existing sessions per conversation (session key:
`agent:code:telegram:group:-1003705263697`). The system prompt (SOUL.md) is baked in at
session creation — updating SOUL.md won't affect the running session.

To force a fresh session after a SOUL.md change, delete the session file:

```bash
# Find and remove the stale session
ls ~/.openclaw/agents/code/sessions/*.jsonl
rm ~/.openclaw/agents/code/sessions/<session-id>.jsonl
```

The next message creates a new session with the updated SOUL.md.

---

## 9. Supergroup vs Group Kind

If the group is a Telegram **supergroup** (most groups created after ~2015 are), use
`"kind": "group"` in the binding — OpenClaw normalizes both. The `-100` prefix in the ID
already identifies it as a supergroup.
