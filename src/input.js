// Input handling

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const {
  ESC, CLEAR, SHOW_CURSOR,
  BOLD, DIM, RESET, RED, GREEN, YELLOW, CYAN, WHITE,
  BG_BLUE, BG_RED,
  THEMES, THEME_NAMES,
} = require('./colors');
const { IS_MAC } = require('./process');
const { render, showHelp, getCardsPerRow } = require('./render');

function parseMouseEvent(data) {
  const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) return null;
  const button = parseInt(match[1]);
  const col = parseInt(match[2]);
  const row = parseInt(match[3]);
  const isRelease = match[4] === 'm';
  return {
    button: button & 3,
    col, row, isRelease,
    isScroll: (button & 64) !== 0,
    scrollUp: (button & 64) !== 0 && (button & 1) === 0,
    scrollDown: (button & 64) !== 0 && (button & 1) !== 0,
  };
}

function listViewRowToIndex(row, state) {
  const headerLines = 7 + (state.showDashboard ? 2 : 0);
  const dataRow = row - headerLines - 1;
  if (dataRow < 0) return -1;

  const termRows = process.stdout.rows || 40;
  const maxVisible = termRows - 10 - (state.showDashboard ? 2 : 0);
  const startIdx = Math.max(0, state.selectedIndex - Math.floor(maxVisible / 2));
  return startIdx + dataRow;
}

function paneViewClickToIndex(row, col, state) {
  const { columns } = process.stdout;
  const cardWidth = 34;
  const cardHeight = 8;
  const cardGapX = 1;
  const cardGapY = 1;
  const cardsPerRow = getCardsPerRow();

  const headerLines = 5 + (state.showDashboard ? 2 : 0);
  const contentRow = row - headerLines - 1;
  if (contentRow < 0) return -1;

  const cellHeight = cardHeight + cardGapY;
  const cardRow = Math.floor(contentRow / cellHeight);
  const withinCard = contentRow % cellHeight;
  if (withinCard >= cardHeight) return -1;

  const cellWidth = cardWidth + cardGapX;
  const cardCol = Math.floor((col - 1) / cellWidth);
  if (cardCol >= cardsPerRow) return -1;
  const withinCardX = (col - 1) % cellWidth;
  if (withinCardX >= cardWidth) return -1;

  const totalRows = Math.ceil(state.processes.length / cardsPerRow);
  const { rows: termRows } = process.stdout;
  const footerLines = 2;
  const availableSpace = termRows - headerLines - footerLines;
  const maxVisibleCardRows = Math.max(1, Math.floor((availableSpace + cardGapY) / (cardHeight + cardGapY)));
  const scrollRow = Math.max(0, state.paneRow - Math.floor(maxVisibleCardRows / 2));

  const actualCardRow = scrollRow + cardRow;
  const idx = actualCardRow * cardsPerRow + cardCol;
  if (idx >= state.processes.length) return -1;
  return idx;
}

function handleMouseEvent(evt, state, CONFIG) {
  if (evt.isScroll) {
    if (evt.scrollUp) {
      if (state.viewMode === 'pane') {
        if (state.paneRow > 0) {
          state.paneRow--;
          const cardsPerRow = getCardsPerRow();
          state.selectedIndex = state.paneRow * cardsPerRow + state.paneCol;
          if (state.selectedIndex >= state.processes.length) {
            state.selectedIndex = state.processes.length - 1;
            state.paneCol = state.selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (state.selectedIndex > 0) state.selectedIndex--;
      }
    } else if (evt.scrollDown) {
      if (state.viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        const totalRows = Math.ceil(state.processes.length / cardsPerRow);
        if (state.paneRow < totalRows - 1) {
          state.paneRow++;
          state.selectedIndex = state.paneRow * cardsPerRow + state.paneCol;
          if (state.selectedIndex >= state.processes.length) {
            state.selectedIndex = state.processes.length - 1;
            state.paneCol = state.selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (state.selectedIndex < state.processes.length - 1) state.selectedIndex++;
      }
    }
    render(state, CONFIG);
    return;
  }

  if (evt.button !== 0 || evt.isRelease) return;

  if (state.viewMode === 'pane') {
    const idx = paneViewClickToIndex(evt.row, evt.col, state);
    if (idx >= 0 && idx < state.processes.length) {
      state.selectedIndex = idx;
      const cardsPerRow = getCardsPerRow();
      state.paneRow = Math.floor(idx / cardsPerRow);
      state.paneCol = idx % cardsPerRow;
      render(state, CONFIG);
    }
  } else {
    const idx = listViewRowToIndex(evt.row, state);
    if (idx >= 0 && idx < state.processes.length) {
      state.selectedIndex = idx;
      render(state, CONFIG);
    }
  }
}

function openDirectory(cwd, mode) {
  if (!cwd) {
    return { error: 'No working directory for this process' };
  }
  try {
    if (!fs.existsSync(cwd)) {
      return { error: `Directory does not exist: ${cwd}` };
    }
  } catch (e) {
    return { error: `Directory does not exist: ${cwd}` };
  }

  let command, args, message;

  switch (mode) {
    case 'finder':
      if (IS_MAC) {
        command = 'open';
        args = [cwd];
      } else {
        command = 'xdg-open';
        args = [cwd];
      }
      message = `Opened ${cwd}`;
      break;

    case 'editor': {
      const editor = process.env.EDITOR || 'code';
      command = editor;
      args = [cwd];
      message = `Opened in editor: ${cwd}`;
      break;
    }

    case 'terminal':
      if (IS_MAC) {
        command = 'osascript';
        args = ['-e', `tell app "Terminal" to do script "cd ${cwd}"`];
      } else {
        try {
          execSync('which gnome-terminal', { stdio: 'pipe' });
          command = 'gnome-terminal';
          args = ['--working-directory=' + cwd];
        } catch (e) {
          command = 'xterm';
          args = ['-e', `cd ${cwd} && ${process.env.SHELL || '/bin/sh'}`];
        }
      }
      message = `Opened terminal in ${cwd}`;
      break;

    default:
      return { error: `Unknown mode: ${mode}` };
  }

  return { command, args, message };
}

function execOpenDirectory(cwd, mode, state) {
  const result = openDirectory(cwd, mode);
  if (result.error) {
    state.statusMessage = result.error;
    return;
  }
  try {
    const child = spawn(result.command, result.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    state.statusMessage = result.message;
  } catch (e) {
    state.statusMessage = `Failed to open: ${e.message}`;
  }
}

function cycleTheme(state) {
  const idx = THEME_NAMES.indexOf(state.currentThemeName);
  const nextIdx = (idx + 1) % THEME_NAMES.length;
  state.currentThemeName = THEME_NAMES[nextIdx];
  state.THEME = { ...THEMES[state.currentThemeName] };
  state.statusMessage = `Theme: ${state.currentThemeName}`;
}

function sendNotification(title, message) {
  try {
    if (IS_MAC) {
      spawn('osascript', ['-e', `display notification "${message}" with title "${title}"`], {
        detached: true, stdio: 'ignore'
      }).unref();
    } else {
      spawn('notify-send', [title, message], {
        detached: true, stdio: 'ignore'
      }).unref();
    }
  } catch (e) {}
}

function checkStateTransitions(currentProcs, state, CONFIG) {
  if (!state.notificationsEnabled) return;

  const { formatDuration, formatNotificationMessage } = require('./utils');
  const minDuration = (CONFIG.notifications.minDuration || 30) * 1000;
  const now = Date.now();

  const currentMap = new Map();
  for (const proc of currentProcs) {
    currentMap.set(proc.pid, proc);
  }

  for (const proc of currentProcs) {
    if (proc.status === 'ACTIVE' && !state.processStartTimes.has(proc.pid)) {
      state.processStartTimes.set(proc.pid, now);
    }
  }

  for (const [pid, prevStatus] of state.previousStates) {
    if (prevStatus !== 'ACTIVE') continue;

    const current = currentMap.get(pid);
    const newStatus = current ? current.status : null;

    if (newStatus === 'ACTIVE') continue;

    const startTime = state.processStartTimes.get(pid);
    if (!startTime) continue;

    const activeDuration = now - startTime;
    if (activeDuration < minDuration) continue;

    const proc = current || { pid, slug: null, title: 'Claude session', model: null };
    proc._activeDurationMs = activeDuration;
    const message = formatNotificationMessage(proc);
    sendNotification('CTOP \u2014 Session Completed', message);
  }

  state.previousStates.clear();
  for (const proc of currentProcs) {
    state.previousStates.set(proc.pid, proc.status);
  }

  for (const pid of state.processStartTimes.keys()) {
    if (!currentMap.has(pid)) {
      state.processStartTimes.delete(pid);
    }
  }
}

function handleInput(key, state, CONFIG, deps) {
  const { getClaudeProcesses, killProcess, killAllProcesses } = deps.process;
  const { applySortAndFilter } = deps.utils;
  const { assignSessionsToProcesses } = deps.session;
  const { searchSessionContent, getSessionFilesForProject } = deps.session;

  const mouseEvt = parseMouseEvent(key);
  if (mouseEvt) {
    handleMouseEvent(mouseEvt, state, CONFIG);
    return;
  }

  // Filter input mode
  if (state.filterInput) {
    if (key === '\r' || key === '\n') {
      state.filterInput = false;
      if (state.filterText) state.statusMessage = `Filter: "${state.filterText}" (ESC to clear)`;
      applySortAndFilter(state);
      render(state, CONFIG);
    } else if (key === '\x1b' && key.length === 1) {
      state.filterInput = false;
      state.filterText = '';
      applySortAndFilter(state);
      render(state, CONFIG);
    } else if (key.startsWith('\x1b[')) {
      // Arrow keys — ignore in filter mode
    } else if (key === '\x7f' || key === '\b') {
      state.filterText = state.filterText.slice(0, -1);
      applySortAndFilter(state);
      render(state, CONFIG);
    } else if (key.length === 1 && key >= ' ') {
      state.filterText += key;
      applySortAndFilter(state);
      render(state, CONFIG);
    }
    return;
  }

  // Search input mode
  if (state.searchMode) {
    if (key === '\r' || key === '\n') {
      state.searchMode = false;
      if (state.searchQuery) {
        state.statusMessage = 'Searching...';
        render(state, CONFIG);
        // Execute search
        executeSearch(state.searchQuery, state, getSessionFilesForProject, searchSessionContent);
        state.statusMessage = `Search: "${state.searchQuery}" (${state.searchResults.size} matches, ESC to clear)`;
      }
      applySortAndFilter(state);
      render(state, CONFIG);
    } else if (key === '\x1b' && key.length === 1) {
      state.searchMode = false;
      state.searchQuery = '';
      render(state, CONFIG);
    } else if (key.startsWith('\x1b[')) {
      // Arrow keys — ignore in search mode
    } else if (key === '\x7f' || key === '\b') {
      state.searchQuery = state.searchQuery.slice(0, -1);
      render(state, CONFIG);
    } else if (key.length === 1 && key >= ' ') {
      state.searchQuery += key;
      render(state, CONFIG);
    }
    return;
  }

  if (state.showingHelp) {
    state.showingHelp = false;
    render(state, CONFIG);
    return;
  }

  if (state.confirmKillAll) {
    if (key === 'y' || key === 'Y') {
      const killed = killAllProcesses(false, state);
      state.statusMessage = `Killed ${killed} processes`;
      state.confirmKillAll = false;
      setTimeout(() => {
        state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
        applySortAndFilter(state);
        state.lastRefresh = new Date();
        render(state, CONFIG);
      }, 500);
    } else {
      state.confirmKillAll = false;
      render(state, CONFIG);
    }
    return;
  }

  if (state.confirmKillStopped) {
    if (key === 'y' || key === 'Y') {
      const stoppedProcs = state.allProcesses.filter(p => !p.isActive);
      let killed = 0;
      for (const proc of stoppedProcs) {
        if (killProcess(proc.pid, true, state)) killed++;
      }
      state.statusMessage = `Killed ${killed} stopped processes`;
      state.confirmKillStopped = false;
      setTimeout(() => {
        state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
        applySortAndFilter(state);
        state.lastRefresh = new Date();
        if (state.selectedIndex >= state.processes.length) {
          state.selectedIndex = Math.max(0, state.processes.length - 1);
        }
        render(state, CONFIG);
      }, 500);
    } else {
      state.confirmKillStopped = false;
      render(state, CONFIG);
    }
    return;
  }

  switch (key) {
    case 'P':
      if (state.viewMode === 'list') {
        state.viewMode = 'pane';
        const cardsPerRow = getCardsPerRow();
        state.paneRow = Math.floor(state.selectedIndex / cardsPerRow);
        state.paneCol = state.selectedIndex % cardsPerRow;
      } else {
        state.viewMode = 'list';
      }
      render(state, CONFIG);
      break;

    case 'T':
      cycleTheme(state);
      render(state, CONFIG);
      break;

    case '\x1b[A': // Up arrow
    case 'k':
      if (state.viewMode === 'pane') {
        if (state.paneRow > 0) {
          state.paneRow--;
          const cardsPerRow = getCardsPerRow();
          state.selectedIndex = state.paneRow * cardsPerRow + state.paneCol;
          if (state.selectedIndex >= state.processes.length) {
            state.selectedIndex = state.processes.length - 1;
            state.paneCol = state.selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (state.selectedIndex > 0) state.selectedIndex--;
      }
      render(state, CONFIG);
      break;

    case '\x1b[B': // Down arrow
    case 'j':
      if (state.viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        const totalRows = Math.ceil(state.processes.length / cardsPerRow);
        if (state.paneRow < totalRows - 1) {
          state.paneRow++;
          state.selectedIndex = state.paneRow * cardsPerRow + state.paneCol;
          if (state.selectedIndex >= state.processes.length) {
            state.selectedIndex = state.processes.length - 1;
            state.paneCol = state.selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (state.selectedIndex < state.processes.length - 1) state.selectedIndex++;
      }
      render(state, CONFIG);
      break;

    case '\x1b[D': // Left arrow
    case 'h':
      if (state.viewMode === 'pane') {
        if (state.paneCol > 0) {
          state.paneCol--;
          const cardsPerRow = getCardsPerRow();
          state.selectedIndex = state.paneRow * cardsPerRow + state.paneCol;
        }
        render(state, CONFIG);
      }
      break;

    case '\x1b[C': // Right arrow
    case 'l':
      if (state.viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        const maxColInRow = Math.min(cardsPerRow - 1, state.processes.length - 1 - state.paneRow * cardsPerRow);
        if (state.paneCol < maxColInRow) {
          state.paneCol++;
          state.selectedIndex = state.paneRow * cardsPerRow + state.paneCol;
        }
        render(state, CONFIG);
      }
      break;

    case 'd':
      state.showDashboard = !state.showDashboard;
      render(state, CONFIG);
      break;

    case 'g':
      state.selectedIndex = 0;
      if (state.viewMode === 'pane') { state.paneRow = 0; state.paneCol = 0; }
      render(state, CONFIG);
      break;

    case 'G':
      state.selectedIndex = Math.max(0, state.processes.length - 1);
      if (state.viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        state.paneRow = Math.floor(state.selectedIndex / cardsPerRow);
        state.paneCol = state.selectedIndex % cardsPerRow;
      }
      render(state, CONFIG);
      break;

    case 'x':
      if (state.processes[state.selectedIndex]) {
        const pid = state.processes[state.selectedIndex].pid;
        killProcess(pid, false, state);
        setTimeout(() => {
          state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
          applySortAndFilter(state);
          state.lastRefresh = new Date();
          if (state.selectedIndex >= state.processes.length) {
            state.selectedIndex = Math.max(0, state.processes.length - 1);
          }
          render(state, CONFIG);
        }, 300);
      }
      break;

    case 'X':
      if (state.processes[state.selectedIndex]) {
        const pid = state.processes[state.selectedIndex].pid;
        killProcess(pid, true, state);
        setTimeout(() => {
          state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
          applySortAndFilter(state);
          state.lastRefresh = new Date();
          if (state.selectedIndex >= state.processes.length) {
            state.selectedIndex = Math.max(0, state.processes.length - 1);
          }
          render(state, CONFIG);
        }, 300);
      }
      break;

    case 'K':
      state.confirmKillAll = true;
      process.stdout.write(`\n${BG_RED}${WHITE}${BOLD} Kill ALL ${state.allProcesses.length} Claude processes? (y/N) ${RESET}`);
      break;

    case 'A': {
      const stoppedCount = state.allProcesses.filter(p => !p.isActive).length;
      if (stoppedCount > 0) {
        state.confirmKillStopped = true;
        process.stdout.write(`\n${BG_RED}${WHITE}${BOLD} Kill ALL ${stoppedCount} stopped/dead processes? (y/N) ${RESET}`);
      } else {
        state.statusMessage = 'No stopped processes to kill';
        render(state, CONFIG);
      }
      break;
    }

    case 'o':
      if (state.processes[state.selectedIndex]) {
        execOpenDirectory(state.processes[state.selectedIndex].cwd, 'finder', state);
        render(state, CONFIG);
      }
      break;

    case 'e':
      if (state.processes[state.selectedIndex]) {
        execOpenDirectory(state.processes[state.selectedIndex].cwd, 'editor', state);
        render(state, CONFIG);
      }
      break;

    case 't':
      if (state.processes[state.selectedIndex]) {
        execOpenDirectory(state.processes[state.selectedIndex].cwd, 'terminal', state);
        render(state, CONFIG);
      }
      break;

    case 's': {
      const si = state.SORT_MODES.indexOf(state.sortMode);
      state.sortMode = state.SORT_MODES[(si + 1) % state.SORT_MODES.length];
      state.statusMessage = `Sort: ${state.sortMode}`;
      applySortAndFilter(state);
      render(state, CONFIG);
      break;
    }

    case 'S':
      state.sortReverse = !state.sortReverse;
      state.statusMessage = `Sort: ${state.sortMode} ${state.sortReverse ? '(reversed)' : ''}`;
      applySortAndFilter(state);
      render(state, CONFIG);
      break;

    case '/':
      state.filterInput = true;
      state.filterText = '';
      state.statusMessage = 'Filter: type to search, Enter to confirm, ESC to cancel';
      render(state, CONFIG);
      break;

    case 'F':
      state.searchMode = true;
      state.searchQuery = '';
      state.searchResults.clear();
      state.statusMessage = 'Search: type query, Enter to search, ESC to cancel';
      render(state, CONFIG);
      break;

    case 'n':
      state.notificationsEnabled = !state.notificationsEnabled;
      state.statusMessage = `Notifications: ${state.notificationsEnabled ? 'ON' : 'OFF'}`;
      render(state, CONFIG);
      break;

    case 'r':
      state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
      applySortAndFilter(state);
      checkStateTransitions(state.allProcesses, state, CONFIG);
      state.lastRefresh = new Date();
      state.statusMessage = 'Refreshed';
      render(state, CONFIG);
      break;

    case '?':
      state.showingHelp = true;
      showHelp(state);
      break;

    case '\x1b':
      if (state.searchQuery) {
        state.searchQuery = '';
        state.searchResults.clear();
        state.statusMessage = 'Search cleared';
        applySortAndFilter(state);
        render(state, CONFIG);
        break;
      }
      if (state.filterText) {
        state.filterText = '';
        state.statusMessage = 'Filter cleared';
        applySortAndFilter(state);
        render(state, CONFIG);
        break;
      }
      // Fall through to quit
    case 'q':
    case '\x03': // Ctrl+C
      deps.cleanup();
      process.exit(0);
      break;
  }
}

function executeSearch(query, state, getSessionFilesForProject, searchSessionContent) {
  const path = require('path');
  const fs = require('fs');
  state.searchResults.clear();
  if (!query) return;

  for (const proc of state.processes) {
    if (!proc.cwd) continue;
    const projectDirName = proc.cwd.replace(/\//g, '-');
    const projectPath = path.join(process.env.HOME, '.claude', 'projects', projectDirName);
    if (!fs.existsSync(projectPath)) continue;

    const files = getSessionFilesForProject(projectPath);
    if (files.length > 0) {
      const result = searchSessionContent(projectPath, files[0].name, query);
      if (result.matched) {
        state.searchResults.set(proc.pid, result.snippets);
      }
    }
  }
}

module.exports = {
  handleInput, parseMouseEvent, listViewRowToIndex, paneViewClickToIndex,
  openDirectory, cycleTheme,
  sendNotification, checkStateTransitions,
};
