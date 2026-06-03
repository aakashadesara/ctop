# CTOP — AI Agent Terminal Operations Panel

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS | Linux | Windows](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](#requirements)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg)](#)

**`htop` for your AI coding agents.** Monitor Claude Code, Codex CLI, OpenCode, and Devin sessions — CPU, memory, tokens, context window, costs, branches — from a single terminal pane.

![CTOP Demo](assets/hero.gif)

## Features

- **Multi-agent monitoring** — Claude Code + Codex CLI + OpenCode + Devin, real-time CPU/memory/status
- **Context window tracking** — visual bar with input, cache, output, and free segments
- **Cost estimation** — per-session and aggregate API cost (Claude + OpenAI pricing)
- **Token waveform** — real-time sparkline showing token activity pulse
- **Two view modes** — list view (table) and pane view (card grid), toggle with `P`
- **Live log tailing** — stream conversation in a split pane (`L`)
- **Sort, filter, search** — by CPU, memory, context, branch, model, or full-text (`F`)
- **Dashboard & history** — aggregate stats (`d`), 24-hour usage charts (`H`)
- **Process control** — kill sessions (graceful or force), bulk multi-select close, quick-jump to project dir
- **Desktop notifications** — get notified when sessions complete
- **5 color themes** — default, minimal, dracula, solarized, monokai (+ custom)
- **Plugin system** — extend with custom columns via `~/.ctop/plugins/`
- **Compaction & rate limit detection** — flags compaction events and quota usage
- **CLI mode for agents** — `ctop ls`, `ctop whoami`, `ctop alerts`, … (see [CLI mode](#cli-mode-for-agents-and-scripts))

![CTOP Features](assets/features.gif)

---

## Installation

```bash
# Homebrew
brew tap aakashadesara/ctop && brew install ctop-claude

# npm
npm install -g ctop-claude

# npx (no install)
npx ctop-claude

# From source
git clone https://github.com/aakashadesara/ctop.git
chmod +x ctop/claude-manager
ln -s "$(pwd)/ctop/claude-manager" /usr/local/bin/ctop
```

Then run `ctop`. If no agents are running, you'll see an empty state — start a Claude Code, Codex, OpenCode, or Devin session and it'll appear on the next refresh.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Navigate |
| `h`/`l` or `←`/`→` | Navigate (pane mode) |
| `g` / `G` | Jump to first / last |
| `P` | Toggle list / pane view |
| `Space` | Mark / unmark session (multi-select) |
| `Shift+↑`/`↓` or `V` | Extend / start a marked range |
| `a` | Select all visible / clear |
| `s` / `S` | Cycle sort / reverse |
| `/` | Filter |
| `F` | Full-text search conversations |
| `d` | Toggle dashboard |
| `L` | Toggle log pane |
| `H` | Toggle 24-hour history |
| `W` | Timeline view |
| `T` | Cycle color theme |
| `x` / `X` | Kill (SIGTERM / SIGKILL) — bulk if rows are marked |
| `K` | Kill ALL agents |
| `o` / `e` / `t` | Open dir in Finder / editor / terminal |
| `n` | Toggle notifications |
| `?` | Help |
| `Esc` | Clear selection (or filter / search) |
| `q` | Quit |

Mouse: click to select, scroll to navigate, `Shift`+click to mark (best-effort).

### Bulk actions

Mark several sessions and act on them at once. Press `Space` to mark the session
under the cursor, or hold `Shift` while pressing `↑`/`↓` to extend a range; press
`V` for vim-style range mode (then move to extend) and `a` to select all visible.
With sessions marked, `x` / `X` close the whole set after a confirmation prompt;
`Esc` clears the selection. Works in list, pane, and group views.

> **Shift+click note:** many terminals (Terminal.app, iTerm2, GNOME Terminal, …)
> reserve `Shift`+click for their own text selection and never forward it to the
> app, so `Shift`+click marking is best-effort. The keyboard path
> (`Space` / `Shift`+`↑`/`↓` / `V`) works everywhere.

---

## Agent skill

A self-contained [`ctop` skill](skills/ctop/SKILL.md) ships in this repo. Drop it into Claude Code so any agent learns when and how to call `ctop`:

```bash
# Per-project
mkdir -p .claude/skills && cp -r skills/ctop .claude/skills/

# Or user-wide
mkdir -p ~/.claude/skills && cp -r skills/ctop ~/.claude/skills/
```

Once installed, ask any Claude Code session things like _"what other agents am I running"_, _"how much have my sessions cost"_, _"is my context about to compact"_ — the agent will reach for `ctop` automatically.

Skill files:

- [`SKILL.md`](skills/ctop/SKILL.md) — trigger sheet + common patterns
- [`reference.md`](skills/ctop/reference.md) — full per-command spec
- [`examples.md`](skills/ctop/examples.md) — copy-pasteable recipes

## CLI mode (for agents and scripts)

`ctop` with no args starts the interactive TUI. `ctop <subcommand>` runs a one-shot query and exits, so AI agents can introspect their own sessions and sister sessions from another terminal.

```bash
ctop ls                          # Table of every running agent
ctop ls --json                   # Same, machine-parseable
ctop ls --agent claude           # Filter by backend
ctop ls --cwd ~/code/myproj      # Filter by directory

ctop get <pid> --json            # Full detail on one session
ctop log <pid> --tail 20         # Last 20 conversation messages
ctop search "TODO" --json        # Full-text search across sessions
ctop diff <pid>                  # Git diff for the session's cwd
ctop stats --json                # Aggregate cost / tokens / counts

ctop whoami                      # Detect which session you're in
ctop whoami --pid-only           # PID only, for scripting
ctop alerts                      # Low-context / idle / ghost warnings
ctop alerts --severity critical  # Only critical-level alerts

ctop kill <pid>                  # SIGTERM (must be your own user)
ctop kill <pid> --force          # SIGKILL
ctop notify "title" "message"    # Desktop notification
```

`whoami` detects the calling session via `$CTOP_PID` → parent-PID walk → `$PWD` match, with a `matchConfidence` label (`exact | ppid | cwd-guess | none`) so agents know how much to trust the answer.

Read tools surface data that the user could read off disk anyway. `kill` enforces uid ownership and an agent-session check before sending the signal — there is no kill-all.

### Examples

```bash
# Find sessions about to compact
ctop ls --json | jq '.[] | select(.contextPct != null and .contextPct < 20)'

# Self-aware compaction (hook)
[ "$(ctop whoami --json | jq -r .session.contextPct)" -lt 15 ] && \
  echo "context low — consider /compact"

# Clean up ghost sessions
ctop alerts --json | jq -r '.[] | select(.kind=="ghost") | .pid' | \
  xargs -I {} ctop kill {} --force
```

## Configuration

### CLI flags (TUI mode)

```bash
ctop --refresh 3             # Refresh every 3 seconds
ctop --context-limit 128000  # Set context window to 128k
ctop --pane                  # Start in pane view
```

### Config file (`~/.ctoprc`)

```json
{
  "refreshInterval": 5000,
  "contextLimit": 200000,
  "defaultView": "list",
  "theme": "default",
  "contextBarStyle": "block",
  "notifications": { "enabled": true, "minDuration": 30 }
}
```

CLI flags override config file values.

---

## How it works

Reads process info from `ps` (PowerShell on Windows), resolves working directories via `lsof`, and enriches each process with session metadata from local JSONL files (`~/.claude/projects/` for Claude, `~/.codex/sessions/` for Codex) and SQLite databases (`~/.local/share/opencode/` for OpenCode, `~/.local/share/devin/cli/` for Devin). No network calls, no external dependencies.

## Plugins

Extend with custom columns. Create `.js` files in `~/.ctop/plugins/`:

```js
module.exports = {
  name: 'my-plugin',
  column: {
    header: 'CUSTOM',
    width: 10,
    getValue: (proc) => proc.cwd ? 'yes' : 'no',
  },
};
```

See `examples/plugins/` for more.

---

## Requirements

- **Node.js 18+**
- **macOS, Linux, or Windows** — Windows uses PowerShell for process detection; CWD resolution is more limited than macOS/Linux.
- **Claude Code**, **Codex CLI**, **OpenCode**, and/or **Devin (terminal)** running sessions
- **`sqlite3`** on PATH for OpenCode and Devin session reads (built-in on macOS; available via `apt`/`brew` on Linux)

## Contributing

PRs welcome! Fork, clone, run `./claude-manager` to develop, `npm test` to test. Open an issue first for large changes.

## License

[MIT](LICENSE)
