# Dispatching Claude Code CLI from an OpenClaw Agent

Claude Code can be triggered in two ways from claude-dash:

- **Standalone** (`claude -p`): spawns Claude Code directly as a subprocess. Simple to
  set up but has no messaging channel — you can only dispatch from the web UI and read
  results there.

- **Via OpenClaw** (recommended): routes the task through an OpenClaw agent first. The
  agent handles multi-channel delivery (Telegram, WhatsApp), delivers the result back to
  you wherever you sent the task, supports background execution monitoring, and keeps
  full conversation context per channel. This is the setup described here.

---

## 1. Configuring the OpenClaw Agent

### Step 1 — Create the agent directory

```bash
mkdir -p ~/.openclaw/agents/code
```

### Step 2 — Write SOUL.md (persona + rules)

`~/.openclaw/agents/code/SOUL.md`:

```markdown
# Role: Code Agent

You are a coding assistant that passes tasks to Claude Code CLI running on this machine.
You take instructions from the user and execute them in the correct project.

You do NOT write code yourself. You invoke `claude` via the `exec` tool and relay results.

## Core Rules

1. **Always use `exec` tool** — never `shell` or `bash` (those don't exist)
2. **Always set workdir** to the correct project folder
3. **Always set `pty:true`** for Claude Code invocations
4. **Long tasks: use `background:true`** and monitor with the `process` tool

## Greetings & Non-Task Messages

For greetings ("hi", "hello") reply briefly — e.g. "Hey! Send me a task like
`my-project: run git status` and I'll get on it."
Do NOT return NO_REPLY for greetings.

## Relaying Claude Code Output

After exec completes:
- Short output (< 10 lines): send verbatim
- Long output: 3-5 line summary of what was done + key findings
- Always include project name and success/error status
```

### Step 3 — Write TOOLS.md (project routing)

`~/.openclaw/agents/code/TOOLS.md`:

```markdown
# TOOLS.md — Code Agent

**CRITICAL: Use the `exec` tool ONLY. Never use `shell` or `bash`.**

Always set `pty:true` for Claude Code. Use `background:true` for long tasks.

## Projects

### my-project
- **Workdir:** `/path/to/my-project`
- **Keywords:** feature, fix, test, deploy
```
exec pty:true workdir:"/path/to/my-project" command:"claude -p 'TASK' --output-format text --dangerously-skip-permissions"
```

## Routing Rules
- If project is unclear, ask before running
- Always confirm the project name in your response
```

### Step 4 — Register the agent in openclaw.json

```json
{
  "agents": {
    "list": [
      {
        "id": "code",
        "workspace": "~/.openclaw/agents/code"
      }
    ]
  },
  "bindings": [
    {
      "agentId": "code",
      "match": {
        "channel": "telegram",
        "peer": { "kind": "dm" }
      }
    }
  ]
}
```

Adjust `match` to target a specific channel or group. See the Telegram group routing guide for group-specific bindings.

### Step 5 — Set the model

The agent inherits `agents.defaults.model.primary`. Make sure it's set to a model that
handles tool calling correctly in OpenClaw's pipeline:

```json
"agents": {
  "defaults": {
    "model": { "primary": "ollama/gpt-oss:120b-cloud" }
  }
}
```

Do NOT override the model per-agent unless necessary — per-agent overrides require a
gateway restart to take effect (hot reload does not apply to model config).

---

## 2. What Claude Code CLI Needs

For the code agent to invoke Claude Code CLI successfully, the following must be in place
on the machine running OpenClaw:

### Claude Code CLI installed and authenticated

```bash
npm install -g @anthropic-ai/claude-code
claude --version   # verify it's in PATH
claude             # first run — authenticate with your Anthropic account
```

### Claude Code must be in PATH for the exec environment

OpenClaw's `exec` tool runs commands in a subprocess. If `claude` isn't in the system
PATH (common on Windows), the exec will fail silently. Verify:

```bash
# In a terminal (not just your shell profile):
where claude     # Windows
which claude     # macOS/Linux
```

If it's not found, add the npm global bin directory to your system PATH (not just your
shell profile, since OpenClaw may not source it).

### Session hooks (for dashboard tracking)

When `claude -p` is invoked by the code agent, it fires Claude Code's hook events.
This means sessions dispatched from the code bot automatically appear in claude-dash.

The hooks are configured in `~/.claude/settings.json` — see the main README for the
full hook configuration. No extra setup needed; any `claude` process reads the same
settings file.

### `--dangerously-skip-permissions` flag

The code agent invokes Claude with `--dangerously-skip-permissions` so it can run
without pausing for permission prompts. This is intentional — the user is authorizing
the task by sending it to the bot. Only use this on trusted machines with trusted users.

---

## 3. Webhook Dispatch from claude-dash

If dispatching tasks from the claude-dash web UI (rather than directly from a messaging
app), the task arrives wrapped in OpenClaw's hook message format. The agent needs to
handle this correctly in SOUL.md:

```markdown
## Webhook Tasks (ClaudeDashTask)

When you receive a message containing `Task: ClaudeDashTask`, it was dispatched from the
claude-dash web UI. The user already confirmed the task — treat it as pre-approved:
1. Parse the actual task from inside `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` tags
2. Identify the project (look for `project-name:` prefix in the task text)
3. **Skip the confirmation step** — do NOT ask "should I go ahead?". Just run it.
4. **Call `exec` immediately** to run Claude Code in the correct workdir
5. The message may end with "Return your summary as plain text" — ignore that instruction
6. Return the exec output as your response
```

---

## 4. NO_REPLY Behavior

The default agent response for non-task messages (like "hi") is `NO_REPLY` — the bot
sends nothing. This makes it appear unresponsive. Fix it in SOUL.md:

```markdown
## Greetings & Non-Task Messages

For greetings ("hi", "hello") reply with a short acknowledgment.
Do NOT return NO_REPLY for greetings — always respond so the user knows the bot is alive.
```

---

## 5. Stale Sessions After SOUL.md Changes

OpenClaw reuses existing sessions per conversation. The system prompt (SOUL.md) is baked
in at session creation — updating SOUL.md won't affect a running session.

To force a fresh session after a SOUL.md change, delete the session file:

```bash
ls ~/.openclaw/agents/code/sessions/*.jsonl
rm ~/.openclaw/agents/code/sessions/<session-id>.jsonl
```

The next message creates a new session with the updated SOUL.md.
