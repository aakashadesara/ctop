# CTOP — AI Agent Terminal Operations Panel

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS | Linux | Windows](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](#requirements)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg)](#)

**`htop` for your AI coding agents.** Monitor Claude Code and Codex CLI sessions — CPU, memory, tokens, context window, costs, branches — from a single terminal pane.

![CTOP Demo](assets/hero.gif)

## Features

- **Multi-agent monitoring** — Claude Code + Codex CLI, real-time CPU/memory/status
- **Context window tracking** — visual bar with input, cache, output, and free segments
- **Cost estimation** — per-session and aggregate API cost (Claude + OpenAI pricing)
- **Token waveform** — real-time sparkline showing token activity pulse
- **Two view modes** — list view (table) and pane view (card grid), toggle with `P`
- **Live log tailing** — stream conversation in a split pane (`L`)
- **Sort, filter, search** — by CPU, memory, context, branch, model, or full-text (`F`)
- **Dashboard & history** — aggregate stats (`d`), 24-hour usage charts (`H`)
- **Process control** — kill sessions (graceful or force), quick-jump to project dir
- **Desktop notifications** — get notified when sessions complete
- **5 color themes** — default, minimal, dracula, solarized, monokai (+ custom)
- **Plugin system** — extend with custom columns via `~/.ctop/plugins/`
- **Compaction & rate limit detection** — flags compaction events and quota usage

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

Then run `ctop`. If no agents are running, you'll see an empty state — start a Claude Code or Codex session and it'll appear on the next refresh.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Navigate |
| `h`/`l` or `←`/`→` | Navigate (pane mode) |
| `g` / `G` | Jump to first / last |
| `P` | Toggle list / pane view |
| `s` / `S` | Cycle sort / reverse |
| `/` | Filter |
| `F` | Full-text search conversations |
| `d` | Toggle dashboard |
| `L` | Toggle log pane |
| `H` | Toggle 24-hour history |
| `W` | Timeline view |
| `T` | Cycle color theme |
| `x` / `X` | Kill (SIGTERM / SIGKILL) |
| `K` | Kill ALL agents |
| `o` / `e` / `t` | Open dir in Finder / editor / terminal |
| `n` | Toggle notifications |
| `?` | Help |
| `q` | Quit |

Mouse: click to select, scroll to navigate.

---

## Configuration

### CLI flags

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

Reads process info from `ps` (PowerShell on Windows), resolves working directories via `lsof`, and enriches each process with session metadata from local JSONL files (`~/.claude/projects/` for Claude, `~/.codex/sessions/` for Codex). No network calls, no external dependencies.

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
- **Claude Code** and/or **Codex CLI** running sessions

## Contributing

PRs welcome! Fork, clone, run `./claude-manager` to develop, `npm test` to test. Open an issue first for large changes.

## License

[MIT](LICENSE)
