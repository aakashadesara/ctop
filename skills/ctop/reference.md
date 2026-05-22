# `ctop` command reference

Every subcommand. For the agent-facing patterns and the trigger sheet, see [`SKILL.md`](SKILL.md).

Global conventions:

- Human-readable output by default (tables / key-value blocks)
- `--json` for machine-parseable output (always parseable; never colored)
- `--help` for per-command usage
- Exit `0` success, `1` user error (bad PID, missing arg, refused kill), `2` runtime error
- No interactive prompts. Every subcommand is one-shot.

---

## `ctop ls`

List running agent sessions.

```
ctop ls [--agent claude|codex|opencode] [--cwd PATH] [--status active|sleeping|all] [--json]
```

| Flag | Meaning |
|------|---------|
| `--agent X` | Filter by backend |
| `--cwd P` | Filter by directory (prefix match) |
| `--status S` | Filter by status. Default: `all` |
| `--json` | Machine-parseable JSON output |

**JSON shape:**

```ts
type SessionSummary = {
  pid: number;
  agent: 'claude' | 'codex' | 'opencode';
  model: string | null;
  cwd: string | null;
  branch: string | null;
  contextPct: number | null;   // % FREE, 0–100
  cost: number | null;          // USD
  status: 'ACTIVE' | 'SLEEPING' | 'STOPPED' | 'ZOMBIE';
  startedAgo: string;           // "22m ago"
  tokens: { input: number; output: number; cache: number };
};
```

---

## `ctop get <pid>`

Full detail on one session.

```
ctop get <pid> [--json]
```

Returns every field on the underlying proc shape including `sessionId`, `sessionTitle`, `lastTurnMs`, `compactionCount`, `tokenRate`, etc. Use this when you've identified a PID via `ls` and need the full picture.

---

## `ctop log <pid>`

Conversation transcript for one session. User and assistant text only — tool_use blocks are stripped.

```
ctop log <pid> [--tail N] [--since ISO] [--json]
```

| Flag | Meaning |
|------|---------|
| `--tail N` | Last N messages (default: 50, 0 = all) |
| `--since T` | Only messages after this ISO timestamp |
| `--json` | JSON array output |

**JSON shape:** `Array<{role: 'user'|'assistant', text: string, timestamp: string}>`

---

## `ctop search <query>`

Full-text search across all session JSONL content. Useful before starting work to avoid duplicating something already in flight in another session.

```
ctop search <query> [--agent X] [--cwd P] [--json]
```

**JSON shape:** `Array<{pid, sessionFile, snippets: string[]}>`

---

## `ctop diff <pid|cwd>`

Git diff summary for a session's working directory (or any cwd you pass).

```
ctop diff <pid|cwd> [--json]
```

If the first positional is numeric it's treated as a PID and the cwd is looked up. Otherwise it's treated as a literal path.

**JSON shape:**

```ts
{
  insertions: number;
  deletions: number;
  untracked: number;
  files: Array<{file: string; insertions: number; deletions: number}>;
}
```

---

## `ctop stats`

Aggregate stats across all running sessions.

```
ctop stats [--json]
```

**JSON shape:**

```ts
{
  total: number;
  active: number;
  dead: number;
  totalCost: number;          // USD
  totalInput: number;          // tokens
  totalOutput: number;
  totalCache: number;          // cache_read + cache_create
  avgContextUtil: number | null; // average % USED
}
```

---

## `ctop whoami`

Detect which agent session the calling process is part of.

```
ctop whoami [--json] [--pid-only]
```

| Flag | Meaning |
|------|---------|
| `--json` | JSON output |
| `--pid-only` | Print just the PID (or exit 1 if none). For shell scripting |

Detection strategy (highest confidence first):

1. `$CTOP_PID` env var → `matchConfidence: "exact"`
2. Walk `process.ppid` chain → `matchConfidence: "ppid"`
3. `$PWD` match against most-recent ACTIVE session in this cwd → `matchConfidence: "cwd-guess"`

**Exit codes:** `0` if a session resolved, `1` if none.

**JSON shape:**

```ts
{
  session: SessionSummary | null;
  matchConfidence: 'exact' | 'ppid' | 'cwd-guess' | 'none';
}
```

---

## `ctop alerts`

Show computed warnings across all sessions.

```
ctop alerts [--severity info|warn|critical] [--json]
```

| Flag | Meaning |
|------|---------|
| `--severity` | Minimum severity. Default: `warn` |
| `--json` | JSON array output |

**Alert kinds:**

| Kind | Severity | Trigger |
|------|----------|---------|
| `low_context` | warn / critical | contextPct ≤ 15 / ≤ 8 |
| `compacting` | info | compacted = true |
| `idle` | warn | ACTIVE && tokenRate=0 && lastTurnMs > 10min |
| `ghost` | warn | STOPPED/ZOMBIE && mem > 0.5% |
| `rate_limited` | warn | rateLimits != null |
| `cost_spike` | warn | cost > $5 |

**JSON shape:** `Array<{pid, agent, kind, severity, message, suggested}>`

---

## `ctop kill <pid>`

Send SIGTERM (or SIGKILL with `--force`) to an agent session.

```
ctop kill <pid> [--force] [--json]
```

**Two checks before any signal is sent:**

1. **uid ownership** — `ps -o uid=` on the PID must match `process.getuid()`. Cross-user PIDs are refused (Unix only; Windows skips this check).
2. **agent-session check** — the PID must be in `ctop ls`. You cannot kill arbitrary processes through this surface — use the system `kill` for those.

There is intentionally no `kill-all` subcommand. Enumerate via `ctop ls` first.

**JSON shape:** `{pid, signal: 'SIGTERM'|'SIGKILL', killed: bool, message: string}`

---

## `ctop notify <title> <message>`

Send a desktop notification.

```
ctop notify "title" "message"
```

Backend:
- macOS: `osascript display notification`
- Linux: libnotify (`notify-send`)
- Windows: `Add-Type System.Windows.Forms`

No JSON mode — fire-and-forget. Useful in stop hooks to mark long tasks complete.

---

## Environment variables

| Var | Effect |
|-----|--------|
| `CTOP_PID` | Force `whoami` to return this PID's session with `matchConfidence: "exact"` |
| `CTOP_SUBCOMMAND` | Set by the CLI dispatcher; tells `loadConfig` to skip TUI-flag parsing. Not for user consumption |

---

## Where data comes from

- **Process list:** `ps -eo pid,user,pcpu,pmem,stat,lstart,command` (PowerShell on Windows)
- **Working directory:** `lsof` per PID (`Get-Process` on Windows — limited)
- **Claude Code sessions:** `~/.claude/projects/<dir-name>/*.jsonl`
- **Codex CLI sessions:** `~/.codex/sessions/`
- **OpenCode sessions:** `~/.opencode/` (SQLite)
- **Git info:** `git diff` and `git rev-parse` per cwd
