// Global state management

const { THEMES } = require('./colors');

// Initialize state with defaults - CONFIG will update these after loading
const state = {
  selectedIndex: 0,
  allProcesses: [],
  processes: [],
  lastRefresh: new Date(),
  statusMessage: '',
  viewMode: 'list',
  paneCol: 0,
  paneRow: 0,

  // Sort & filter state
  SORT_MODES: ['age', 'cpu', 'mem', 'context'],
  sortMode: 'age',
  sortReverse: false,
  filterText: '',
  filterInput: false,
  showDashboard: false,

  // Full-text search state
  searchMode: false,
  searchQuery: '',
  searchResults: new Map(),

  // Notification state
  notificationsEnabled: true,
  previousStates: new Map(),
  processStartTimes: new Map(),

  // Help/confirm state
  showingHelp: false,
  confirmKillAll: false,
  confirmKillStopped: false,

  // Theme state
  THEME: { ...THEMES.default },
  currentThemeName: 'default',
};

module.exports = state;
