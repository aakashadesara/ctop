---
name: ctop
description: Inspect, monitor, and control running AI coding agent sessions across terminals via the `ctop` CLI. Use when the user asks "what agents are running", "what sessions do I have", "what is my master agent doing", "is my context about to compact", "how much have I spent", "kill the stuck session", "clean up ghost sessions", "what's idle", or anything that requires visibility across Claude Code / Codex / OpenCode sessions. Works on macOS, Linux, Windows. No network calls — reads local process state and session files.
---

# ctop — agent session introspection

`ctop` is `htop` for AI coding agents. It already exposes every running Claude Code / Codex / OpenCode session as structured data: PID, model, cost, context-free %, branch, cwd, status. This skill teaches you how to query it from inside another agent session.

**The mental model:** every terminal has its own agent process. Today they don't talk to each other. `ctop` is the third party that sees them all — and now you can ask it questions.

---

## When to use

Reach for `ctop` whenever the question is about **another session**, **your own session's state**, or **cross-session totals**:

| User says… | Run |
|------------|-----|
| "what agents are running" | `ctop ls` |
| "show me all my sessions as JSON" | `ctop ls --json` |
| "what sessions are in /path" | `ctop ls --cwd /path` |
| "details on session 12345" | `ctop get 12345 --json` |
| "what's the conversation in session 12345" | `ctop log 12345 --tail 20` |
| "find sessions discussing X" | `ctop search "X" --json` |
| "git diff for session 12345" | `ctop diff 12345` |
| "total cost / token usage" | `ctop stats` |
| **"which session am I in"** | `ctop whoami` |
| **"is my context low"** | `ctop whoami --json` → check `.session.contextPct` |
| "what sessions need attention" | `ctop alerts` |
| "kill stuck/ghost sessions" | `ctop alerts --json` then `ctop kill <pid> --force` |
| "send me a notification when X" | `ctop notify "title" "message"` |

## When NOT to use

- **General system info** — use `ps`, `htop`, `top`. `ctop` only knows about agent processes.
- **Killing arbitrary processes** — `ctop kill` only accepts PIDs that are running agent sessions. Use the system `kill` otherwise.
- **Reading session files directly** — if you already know the JSONL path, just read it. `ctop log` is for when you only have a PID.

---

## Quick start

Every subcommand has `--help` and a `--json` flag. JSON is machine-parseable; bare invocations give human-readable tables/text.

```bash
ctop ls                     # All running agents, table
ctop ls --json              # Same, JSON array
ctop whoami                 # Detect which session this terminal is in
ctop alerts                 # Warnings: low context, idle, ghost, …
ctop stats                  # Aggregate cost + token totals
ctop kill 12345             # SIGTERM a stuck session
```

Exit codes: `0` success, `1` user error (bad PID, no match), `2` runtime error.

---

## `whoami` — the killer pattern

Most other commands need a PID. `whoami` returns the PID + session object **for the calling agent**, so you can introspect your own state.

Detection (highest confidence first):

1. `$CTOP_PID` env var → `matchConfidence: "exact"`
2. Walk parent PIDs looking for a known agent → `matchConfidence: "ppid"`
3. `$PWD` match against the most-recent ACTIVE session in this cwd → `matchConfidence: "cwd-guess"`
4. None of the above → `matchConfidence: "none"`, `session: null`

Always check `matchConfidence` before trusting the result — `cwd-guess` can return the wrong session if the user runs two agents in the same directory.

```bash
ctop whoami --json
# { "session": { "pid": 18472, "contextPct": 72, "cost": 1.84, ... },
#   "matchConfidence": "ppid" }
```

---

## Common patterns

### 1 · Self-aware compaction warning

Before doing expensive work, check your own context budget:

```bash
PCT=$(ctop whoami --json | jq -r '.session.contextPct // 100')
if [ "$PCT" -lt 15 ]; then
  echo "context at $PCT% free — recommend /compact before next turn"
fi
```

### 2 · Master agent surveying sub-agents

When acting as the "master" coordinator, find every other session in the same project:

```bash
SELF=$(ctop whoami --json | jq -r .session.pid)
ctop ls --cwd ~/code/myproj --json \
  | jq --argjson self "$SELF" '.[] | select(.pid != $self)'
```

### 3 · Cross-session check for duplicate work

Before starting a task, search every session's transcript for related work:

```bash
ctop search "authentication middleware" --json \
  | jq '.[] | {pid, snippets}'
```

### 4 · Ghost cleanup

Find and kill STOPPED/ZOMBIE sessions holding RAM:

```bash
ctop alerts --json \
  | jq -r '.[] | select(.kind=="ghost") | .pid' \
  | xargs -I {} ctop kill {} --force
```

### 5 · Cost audit

Sessions burning unexpected money:

```bash
ctop alerts --json --severity warn \
  | jq '.[] | select(.kind=="cost_spike")'
```

### 6 · "Notify me when this big task finishes"

```bash
# At the end of a long task, in a stop hook or similar:
ctop notify "ctop" "build finished, cost: $(ctop stats --json | jq -r .totalCost)"
```

---

## Alert kinds

`ctop alerts` returns warnings the user (or you) should know about. Default minimum severity is `warn`; pass `--severity info` to also see compaction events, or `--severity critical` to see only urgent ones.

| Kind | Severity | Meaning | Suggested action |
|------|----------|---------|------------------|
| `low_context` | warn / critical | contextPct ≤ 15 / ≤ 8 | `/compact` or hand off |
| `compacting` | info | compaction just happened | nothing — context refreshed |
| `idle` | warn | ACTIVE but no tokens for > 10 min | check if stuck / waiting |
| `ghost` | warn | STOPPED/ZOMBIE holding > 0.5% RAM | `ctop kill <pid> --force` |
| `rate_limited` | warn | hit API quota | wait or switch account |
| `cost_spike` | warn | single session > $5 | review or end |

---

## Output shapes (cheat sheet)

- `ctop ls --json` → `Array<{pid, agent, model, cwd, branch, contextPct, cost, status, startedAgo, tokens}>`
- `ctop get <pid> --json` → full session detail (all 30+ fields)
- `ctop log <pid> --json` → `Array<{role: "user"|"assistant", text, timestamp}>`
- `ctop stats --json` → `{total, active, dead, totalCost, totalInput, totalOutput, totalCache, avgContextUtil}`
- `ctop whoami --json` → `{session, matchConfidence: "exact"|"ppid"|"cwd-guess"|"none"}`
- `ctop alerts --json` → `Array<{pid, agent, kind, severity, message, suggested}>`
- `ctop kill <pid> --json` → `{pid, signal, killed, message}`

See [`reference.md`](reference.md) for every flag and field. See [`examples.md`](examples.md) for longer recipes.

---

## Safety notes

- `ctop kill` enforces two checks before sending the signal: (1) the PID's uid must match yours (no cross-user kills), (2) the PID must already be a known agent session (no killing arbitrary user processes through this surface). There is no `kill-all`.
- Read tools surface data the user could read off disk anyway — no new privilege.
- All operations are local. No network calls.
