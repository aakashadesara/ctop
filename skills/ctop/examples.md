# `ctop` recipes

Longer-form scripts and patterns. For the trigger sheet ("user says X → run Y") see [`SKILL.md`](SKILL.md).

---

## Self-aware context warning

Drop this in a Claude Code `UserPromptSubmit` hook to remind yourself before each turn:

```bash
#!/bin/bash
PCT=$(ctop whoami --json | jq -r '.session.contextPct // 100')
if [ "$PCT" -lt 15 ]; then
  echo "⚠ ctop: context at $PCT% free — consider /compact"
fi
```

---

## Pick the cheapest non-self session to do a sub-task

When you have multiple Claude sessions open and want to delegate work to whichever one has the most context budget:

```bash
SELF=$(ctop whoami --json | jq -r .session.pid)
ctop ls --agent claude --json \
  | jq --argjson self "$SELF" '
    [.[] | select(.pid != $self and .status == "ACTIVE" and .contextPct != null)]
    | sort_by(-.contextPct)
    | .[0]
  '
# Returns the session with the most context-free %, or null
```

---

## Find sessions on the same branch as me (avoid stomping)

```bash
SELF=$(ctop whoami --json)
SELF_BRANCH=$(echo "$SELF" | jq -r .session.branch)
SELF_PID=$(echo "$SELF" | jq -r .session.pid)

ctop ls --json \
  | jq --arg b "$SELF_BRANCH" --argjson p "$SELF_PID" \
    '.[] | select(.branch == $b and .pid != $p) | {pid, cwd, agent}'
```

---

## Read what another session just discussed

```bash
# Get the most-recent 5 messages from session 12345
ctop log 12345 --tail 5 --json | jq -r '.[] | "[\(.role)] \(.text)"'
```

---

## Daily cost report

```bash
ctop stats --json | jq -r '
  "📊 \(.active) active, \(.dead) dead sessions\n" +
  "💰 Total: $\(.totalCost | . * 100 | floor / 100)\n" +
  "📥 Input: \(.totalInput) tokens\n" +
  "📤 Output: \(.totalOutput) tokens\n" +
  "🧠 Cache: \(.totalCache) tokens\n" +
  "⚙ Avg context used: \(.avgContextUtil // "n/a")%"
'
```

---

## Watchdog: warn when any session has < 10% context

A one-shot poll you can cron or background-loop:

```bash
ctop alerts --severity warn --json \
  | jq -r '.[] | select(.kind == "low_context") | "⚠ pid=\(.pid): \(.message)"'
```

---

## End-of-session cleanup

When wrapping a long Claude Code session, kill orphans your work spawned and report cost:

```bash
SELF=$(ctop whoami --json | jq -r .session.pid)

# Kill ghosts
ctop alerts --json --severity warn \
  | jq -r '.[] | select(.kind == "ghost") | .pid' \
  | xargs -I {} ctop kill {} --force

# Final cost
COST=$(ctop get $SELF --json | jq -r .cost)
ctop notify "session done" "this session cost \$$COST"
```

---

## Cross-session search before starting

Before diving in, check if you (or another session) already discussed the topic:

```bash
ctop search "rate limiter" --json | jq '.[] | {pid, sessionFile, snippets: (.snippets | join("\n  "))}'
```

---

## Diff summary for the master agent

Master agent wants to know what each sub-session has changed:

```bash
for pid in $(ctop ls --status active --json | jq -r '.[].pid'); do
  echo "── pid=$pid ──"
  ctop diff $pid 2>/dev/null | head -5
done
```

---

## Programmatic: from Node

Skip the shell. The same data is available via `require('ctop-claude')`:

```js
const ctop = require('ctop-claude');
const procs = ctop.getAllAgentProcesses();
const idle = procs.filter(p => p.status === 'ACTIVE' && p.tokenRate === 0);
console.log(`${idle.length} idle sessions`);
```

This is what the MCP server (future) will do internally.

---

## Combining with system tools

`ctop` plays nicely with `watch`, `fzf`, `awk`:

```bash
# Live update
watch -n 5 'ctop ls'

# Pick a session interactively
ctop ls --json | jq -r '.[] | "\(.pid)\t\(.agent)\t\(.cwd)"' | fzf

# Top 5 most expensive sessions
ctop ls --json | jq 'sort_by(-.cost) | .[0:5]'
```
