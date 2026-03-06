# ctop

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)](#requirements)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](#requirements)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**A terminal UI for monitoring and managing Claude Code sessions.** Think `htop`, but for your Claude processes.

Track CPU, memory, token usage, context window saturation, active branches, and more — all from a single terminal pane.

<!-- TODO: Add hero screenshot -->
<!-- ![ctop screenshot](assets/screenshot.png) -->

---

## Features

- **Real-time process monitoring** — CPU, memory, status, uptime for every Claude session
- **Context window tracking** — visual bar showing input, cache, output, and free context (out of 200k)
- **Token breakdown** — input, output, cache creation, and cache read token counts per session
- **Session metadata** — model, branch, slug, session ID, service tier, version
- **Two view modes** — list view (table) and pane view (card grid)
- **Process control** — kill individual or all sessions (graceful `SIGTERM` or force `SIGKILL`)
- **Vim-style navigation** — `hjkl`, `g`/`G`, arrow keys
- **Zero dependencies** — pure Node.js, no `npm install` required
- **Auto-refresh** — updates every 5 seconds

<!-- TODO: Add screenshot of list view -->
<!-- ![List view](assets/list-view.png) -->

<!-- TODO: Add screenshot of pane view -->
<!-- ![Pane view](assets/pane-view.png) -->

---

## Installation

### Quick install

```bash
# Clone the repo
git clone https://github.com/aakashadesara/ctop.git

# Make it executable (should already be, but just in case)
chmod +x ctop/claude-manager

# Symlink into your PATH
ln -s "$(pwd)/ctop/claude-manager" /usr/local/bin/ctop
```

### Manual install

```bash
curl -o /usr/local/bin/ctop https://raw.githubusercontent.com/aakashadesara/ctop/main/claude-manager
chmod +x /usr/local/bin/ctop
```

### Verify

```bash
ctop
```

If no Claude processes are running, you'll see an empty state. Start a Claude Code session and `ctop` will pick it up on the next refresh.

---

## Recommended aliases

Add these to your `~/.zshrc` or `~/.bashrc`:

```bash
# Launch ctop
alias ctop="/usr/local/bin/ctop"

# Quick-kill all Claude sessions (no TUI, just nuke them)
alias ckill="pkill -f 'claude'"
```

Then reload:

```bash
source ~/.zshrc
```

---

## Usage

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `←` / `h` | Move left (pane mode) |
| `→` / `l` | Move right (pane mode) |
| `g` | Jump to first process |
| `G` | Jump to last process |
| `P` | Toggle list / pane view |
| `r` | Refresh process list |
| `x` | Kill selected process (SIGTERM) |
| `X` | Force kill selected process (SIGKILL) |
| `K` | Kill ALL Claude processes |
| `A` | Kill all stopped/zombie processes |
| `?` | Show help |
| `q` / `ESC` | Quit |

### Context window visualization

The context bar shows how much of the 200k token window is consumed:

```
[████████░░░░░░░░░░░░░░░░░░░░░░] 27% used
 ▲ green   ▲ blue     ▲ cyan      ▲ yellow  ▲ gray
 input     cache-w    cache-r     output    free
```

Color coding:
- **Green** — 70%+ free (healthy)
- **Yellow** — 40–70% free
- **Orange** — 10–40% free (getting tight)
- **Red** — <10% free (near limit)

### Detail pane

On wide terminals (140+ cols), a detail pane appears showing full session info: model, branch, slug, token breakdown, turn duration, session ID, and more.

<!-- TODO: Add screenshot of detail pane -->
<!-- ![Detail pane](assets/detail-pane.png) -->

---

## Requirements

- **macOS** (uses `ps` and `lsof` — see [roadmap](#roadmap) for Linux/Windows)
- **Node.js 18+**
- **Claude Code** installed and running sessions

---

## How it works

`ctop` reads process info from `ps`, resolves working directories via `lsof`, and enriches each process with session metadata by parsing Claude Code's local `.jsonl` session files in `~/.claude/projects/`. No network calls. No external dependencies. Everything stays local.

---

## Roadmap

- [ ] **Linux support** — adapt `ps`/`lsof` parsing for Linux
- [ ] **Windows support** — PowerShell-based process detection
- [ ] **npm package** — `npx ctop` / `npm install -g ctop`
- [ ] **Homebrew formula** — `brew install ctop`
- [ ] **Configurable refresh interval**
- [ ] **Configurable context window size** (for future model changes)
- [ ] **Process log tailing** — stream a session's output in a split pane
- [ ] **Multi-sort** — sort by CPU, memory, context %, age
- [ ] **Filter/search** — filter processes by branch, model, directory

---

## Contributing

PRs are welcome! This is a young project and there's plenty to improve.

```bash
# Fork & clone
git clone https://github.com/<your-username>/ctop.git
cd ctop

# The entire app is a single file — no build step
# Just edit and run:
./claude-manager
```

A few areas where contributions would be especially helpful:

- **Linux/Windows compatibility** — the biggest gap right now
- **Tests** — there are none yet
- **Performance** — profiling on systems with many Claude sessions
- **UI polish** — better responsive layouts, color themes

Please open an issue first for large changes so we can discuss the approach.

---

## License

[MIT](LICENSE) — use it however you want.
