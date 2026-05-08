// Main entry point — terminal setup, event handlers, refresh interval

const { SHOW_CURSOR, CLEAR, resolveTheme, THEMES } = require('./colors');
const { loadConfig, DEFAULT_CONFIG } = require('./config');
const { getClaudeProcesses } = require('./process');
const { assignSessionsToProcesses, searchSessionContent, getSessionFilesForProject, getSessionData: _getSessionData } = require('./session');
const { applySortAndFilter: _applySortAndFilter } = require('./utils');
const { render } = require('./render');
const { handleInput, checkStateTransitions: _checkStateTransitions } = require('./input');
const { ctxColor: _ctxColor } = require('./colors');
const { cycleTheme: _cycleTheme } = require('./input');
const state = require('./state');

// Re-export all sub-modules
const colors = require('./colors');
const cost = require('./cost');
const utils = require('./utils');
const session = require('./session');
const processModule = require('./process');
const renderModule = require('./render');
const inputModule = require('./input');

// CONFIG is loaded at require time for backward compatibility
const CONFIG = loadConfig();
state.THEME = resolveTheme(CONFIG.theme);
state.currentThemeName = (typeof CONFIG.theme === 'string' && THEMES[CONFIG.theme]) ? CONFIG.theme : 'custom';
state.viewMode = CONFIG.defaultView;
state.notificationsEnabled = CONFIG.notifications.enabled;

// Backward-compatible wrappers that bind global state/CONFIG
// so tests can call these functions with the old signatures
function applySortAndFilter() {
  return _applySortAndFilter(state);
}

function ctxColor(pct) {
  return _ctxColor(pct, state);
}

function cycleTheme() {
  return _cycleTheme(state);
}

function checkStateTransitions(procs) {
  return _checkStateTransitions(procs, state, CONFIG);
}

function getSessionData(filePath) {
  return _getSessionData(filePath, CONFIG);
}

function renderContextBarBraille(proc, width) {
  return renderModule.renderContextBarBraille(proc, width, CONFIG);
}

function listViewRowToIndex(row) {
  return inputModule.listViewRowToIndex(row, state);
}

function paneViewClickToIndex(row, col) {
  return inputModule.paneViewClickToIndex(row, col, state);
}

function cleanup() {
  process.stdout.write('\x1b[?1000l\x1b[?1006l');
  process.stdout.write(SHOW_CURSOR + CLEAR);
  process.stdin.setRawMode(false);
}

function main() {
  // Setup terminal
  if (!process.stdin.isTTY) {
    console.error('This program requires an interactive terminal.');
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // Enable mouse tracking (SGR extended mode)
  process.stdout.write('\x1b[?1000h\x1b[?1006h');

  // Handle resize
  process.stdout.on('resize', () => {
    render(state, CONFIG);
  });

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // Dependency injection for input handler
  const deps = {
    process: processModule,
    utils: { applySortAndFilter: _applySortAndFilter },
    session: { assignSessionsToProcesses, searchSessionContent, getSessionFilesForProject },
    cleanup,
  };

  // Initial load
  state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
  _applySortAndFilter(state);
  render(state, CONFIG);

  // Auto-refresh
  setInterval(() => {
    if (!state.showingHelp && !state.confirmKillAll && !state.confirmKillStopped && !state.filterInput && !state.searchMode) {
      state.allProcesses = getClaudeProcesses((procs) => assignSessionsToProcesses(procs, CONFIG));
      _applySortAndFilter(state);
      _checkStateTransitions(state.allProcesses, state, CONFIG);
      state.lastRefresh = new Date();
      if (state.selectedIndex >= state.processes.length) {
        state.selectedIndex = Math.max(0, state.processes.length - 1);
      }
      render(state, CONFIG);
    }
  }, CONFIG.refreshInterval);

  // Handle input
  process.stdin.on('data', (key) => {
    handleInput(key, state, CONFIG, deps);
  });
}

module.exports = {
  main,
  // Cost
  calculateCost: cost.calculateCost,
  formatCost: cost.formatCost,
  MODEL_PRICING: cost.MODEL_PRICING,
  // Utils
  formatStartTime: utils.formatStartTime,
  formatTokenCount: utils.formatTokenCount,
  calculateAggregateStats: utils.calculateAggregateStats,
  formatDuration: utils.formatDuration,
  formatNotificationMessage: utils.formatNotificationMessage,
  // Wrapped versions (backward compatible, bind global state)
  applySortAndFilter,
  ctxColor,
  cycleTheme,
  checkStateTransitions,
  getSessionData,
  renderContextBarBraille,
  // Session (unwrapped)
  searchSessionContent: session.searchSessionContent,
  getSessionFilesForProject: session.getSessionFilesForProject,
  assignSessionsToProcesses: session.assignSessionsToProcesses,
  // Render
  render: renderModule.render,
  renderHeader: renderModule.renderHeader,
  renderListMode: renderModule.renderListMode,
  renderPaneMode: renderModule.renderPaneMode,
  renderDetailPane: renderModule.renderDetailPane,
  renderDashboard: renderModule.renderDashboard,
  renderBrailleBar: renderModule.renderBrailleBar,
  showHelp: renderModule.showHelp,
  getCardsPerRow: renderModule.getCardsPerRow,
  BRAILLE_FILLS: renderModule.BRAILLE_FILLS,
  // Input
  handleInput: inputModule.handleInput,
  parseMouseEvent: inputModule.parseMouseEvent,
  listViewRowToIndex,
  paneViewClickToIndex,
  openDirectory: inputModule.openDirectory,
  sendNotification: inputModule.sendNotification,
  // Config
  loadConfig,
  DEFAULT_CONFIG,
  // Colors / Themes
  THEMES: colors.THEMES,
  THEME_NAMES: colors.THEME_NAMES,
  THEME_REQUIRED_KEYS: colors.THEME_REQUIRED_KEYS,
  resolveTheme: colors.resolveTheme,
  // State (for testing)
  _state: state,
  _notif: { previousStates: state.previousStates, processStartTimes: state.processStartTimes },
  _colors: { RED: colors.RED, ORANGE: colors.ORANGE, YELLOW: colors.YELLOW, GREEN: colors.GREEN, BLUE: colors.BLUE, CYAN: colors.CYAN, DIM: colors.DIM, RESET: colors.RESET },
};
