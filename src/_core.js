// Core module — contains all ctop logic. Split from claude-manager for modularity.
// Individual src/*.js files re-export subsets for cleaner imports.

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Platform detection
const PLATFORM = os.platform(); // 'darwin', 'linux', 'win32'
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';
const IS_WIN = PLATFORM === 'win32';

// ANSI escape codes
const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const HOME = `${ESC}[H`;
const CLR_LINE = `${ESC}[K`;
const CLR_DOWN = `${ESC}[J`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE = `${ESC}[34m`;
const CYAN = `${ESC}[36m`;
const WHITE = `${ESC}[37m`;
const BG_BLUE = `${ESC}[44m`;
const BG_RED = `${ESC}[41m`;
const ORANGE = `${ESC}[38;5;208m`;
const BG_ORANGE = `${ESC}[48;5;130m`;

// Built-in color themes
const THEMES = {
  default: {
    header: ORANGE, headerBg: BG_ORANGE, selection: BG_ORANGE,
    active: GREEN, stopped: YELLOW, zombie: RED, sleeping: DIM,
    ctxLow: RED, ctxMed: ORANGE, ctxHigh: YELLOW, ctxOk: GREEN,
    border: DIM, accent: CYAN, cost: GREEN,
  },
  minimal: {
    header: WHITE, headerBg: `${ESC}[48;5;236m`, selection: `${ESC}[48;5;236m`,
    active: GREEN, stopped: YELLOW, zombie: RED, sleeping: DIM,
    ctxLow: RED, ctxMed: YELLOW, ctxHigh: DIM, ctxOk: DIM,
    border: DIM, accent: DIM, cost: DIM,
  },
  dracula: {
    header: `${ESC}[38;5;189m`, headerBg: `${ESC}[48;5;60m`, selection: `${ESC}[48;5;60m`,
    active: `${ESC}[38;5;80m`, stopped: `${ESC}[38;5;228m`, zombie: `${ESC}[38;5;210m`, sleeping: DIM,
    ctxLow: `${ESC}[38;5;210m`, ctxMed: `${ESC}[38;5;215m`, ctxHigh: `${ESC}[38;5;228m`, ctxOk: `${ESC}[38;5;80m`,
    border: `${ESC}[38;5;61m`, accent: `${ESC}[38;5;141m`, cost: `${ESC}[38;5;80m`,
  },
  solarized: {
    header: `${ESC}[38;5;136m`, headerBg: `${ESC}[48;5;23m`, selection: `${ESC}[48;5;23m`,
    active: `${ESC}[38;5;64m`, stopped: `${ESC}[38;5;136m`, zombie: `${ESC}[38;5;160m`, sleeping: DIM,
    ctxLow: `${ESC}[38;5;160m`, ctxMed: `${ESC}[38;5;166m`, ctxHigh: `${ESC}[38;5;136m`, ctxOk: `${ESC}[38;5;64m`,
    border: `${ESC}[38;5;240m`, accent: `${ESC}[38;5;33m`, cost: `${ESC}[38;5;64m`,
  },
  monokai: {
    header: `${ESC}[38;5;197m`, headerBg: `${ESC}[48;5;236m`, selection: `${ESC}[48;5;59m`,
    active: `${ESC}[38;5;148m`, stopped: `${ESC}[38;5;228m`, zombie: `${ESC}[38;5;197m`, sleeping: DIM,
    ctxLow: `${ESC}[38;5;197m`, ctxMed: `${ESC}[38;5;208m`, ctxHigh: `${ESC}[38;5;228m`, ctxOk: `${ESC}[38;5;148m`,
    border: `${ESC}[38;5;242m`, accent: `${ESC}[38;5;81m`, cost: `${ESC}[38;5;148m`,
  },
};

const THEME_NAMES = Object.keys(THEMES);
const THEME_REQUIRED_KEYS = Object.keys(THEMES.default);

function resolveTheme(value) {
  if (typeof value === 'string') {
    return THEMES[value] ? { ...THEMES[value] } : { ...THEMES.default };
  }
  if (typeof value === 'object' && value !== null) {
    return { ...THEMES.default, ...value };
  }
  return { ...THEMES.default };
}

let THEME = { ...THEMES.default };
let currentThemeName = 'default';

// Config: loaded from ~/.ctoprc (JSON) or CLI flags
const DEFAULT_CONFIG = {
  refreshInterval: 5000,
  contextLimit: 200000,
  defaultView: 'list', // 'list' or 'pane'
  theme: 'default',    // built-in name or custom color object
  contextBarStyle: 'block', // 'block' or 'braille'
  notifications: { enabled: true, minDuration: 30 }, // seconds
};

function loadConfig() {
  const config = { ...DEFAULT_CONFIG };
  // Load ~/.ctoprc
  const rcPath = path.join(os.homedir(), '.ctoprc');
  try {
    if (fs.existsSync(rcPath)) {
      const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
      if (rc.refreshInterval) config.refreshInterval = Number(rc.refreshInterval);
      if (rc.contextLimit) config.contextLimit = Number(rc.contextLimit);
      if (rc.defaultView === 'pane' || rc.defaultView === 'list') config.defaultView = rc.defaultView;
      if (rc.theme !== undefined) {
        if (typeof rc.theme === 'string' && THEMES[rc.theme]) {
          config.theme = rc.theme;
        } else if (typeof rc.theme === 'object' && rc.theme !== null) {
          config.theme = rc.theme;
        }
      }
      if (rc.contextBarStyle === 'braille') config.contextBarStyle = 'braille';
      if (rc.notifications !== undefined && typeof rc.notifications === 'object') {
        config.notifications = { ...DEFAULT_CONFIG.notifications, ...rc.notifications };
      }
    }
  } catch (e) {}
  // CLI flags override
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--refresh' || args[i] === '-r') && args[i + 1]) {
      config.refreshInterval = Number(args[++i]) * 1000;
    } else if ((args[i] === '--context-limit' || args[i] === '-c') && args[i + 1]) {
      config.contextLimit = Number(args[++i]);
    } else if (args[i] === '--pane') {
      config.defaultView = 'pane';
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`ctop — Claude Code process manager

Usage: ctop [options]

Options:
  --refresh, -r <seconds>    Refresh interval (default: 5)
  --context-limit, -c <n>    Context window token limit (default: 200000)
  --pane                     Start in pane/grid view
  -h, --help                 Show this help

Config file: ~/.ctoprc (JSON)
  {
    "refreshInterval": 5000,
    "contextLimit": 200000,
    "defaultView": "list"
  }

Sort keys (in TUI):
  s    Cycle sort: age → cpu → mem → context
  /    Filter by branch, model, or directory
  F    Full-text search session conversation content
  ESC  Clear filter or search
`);
      process.exit(0);
    }
  }
  return config;
}

const CONFIG = loadConfig();
THEME = resolveTheme(CONFIG.theme);
currentThemeName = (typeof CONFIG.theme === 'string' && THEMES[CONFIG.theme]) ? CONFIG.theme : 'custom';

// Plugin system
// Each plugin is a JS file in ~/.ctop/plugins/ that exports:
// {
//   name: 'git-status',           // unique name
//   description: 'Show git status', // human-readable
//   column: {                       // optional: adds a column to list view
//     header: 'GIT',               // column header text
//     width: 12,                   // column width in characters
//     getValue: (proc) => '...',   // function returning display value
//     getColor: (proc) => ANSI,    // optional: color function
//   },
//   detailRows: (proc) => [{       // optional: adds rows to detail pane
//     label: 'Git Branch', value: 'main', color: CYAN
//   }],
//   init: () => {},                // optional: called on load
//   cleanup: () => {},             // optional: called on exit
// }

function loadPlugins(pluginDir) {
  const dir = pluginDir || path.join(os.homedir(), '.ctop', 'plugins');
  if (!fs.existsSync(dir)) return [];
  const plugins = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    try {
      const plugin = require(path.join(dir, file));
      if (plugin.name) {
        if (plugin.init) plugin.init();
        plugins.push(plugin);
      }
    } catch (e) {
      // Log error but don't crash
    }
  }
  return plugins;
}

let plugins = [];
// Load plugins at startup (only when running as main)
if (require.main === module) {
  plugins = loadPlugins();
}

// Pricing per million tokens (USD) — as of 2025
const MODEL_PRICING = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-4-6': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-haiku-4-5': { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  // Older models
  'claude-sonnet-4-5-20250514': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'claude-3-opus-20240229': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
};

function calculateCost(proc) {
  if (!proc.model || proc.inputTokens == null) return null;
  // Try exact match, then prefix match
  let pricing = MODEL_PRICING[proc.model];
  if (!pricing) {
    // Try matching by model family
    const modelLower = proc.model.toLowerCase();
    if (modelLower.includes('opus')) pricing = MODEL_PRICING['claude-opus-4-6'];
    else if (modelLower.includes('haiku')) pricing = MODEL_PRICING['claude-haiku-4-5'];
    else pricing = MODEL_PRICING['claude-sonnet-4-6']; // default to sonnet
  }
  const cost = (
    (proc.inputTokens || 0) * pricing.input / 1_000_000 +
    (proc.outputTokens || 0) * pricing.output / 1_000_000 +
    (proc.cacheCreateTokens || 0) * pricing.cacheWrite / 1_000_000 +
    (proc.cacheReadTokens || 0) * pricing.cacheRead / 1_000_000
  );
  return cost;
}

function formatCost(cost) {
  if (cost === null) return '--';
  if (cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(2);
}

function formatTokenCount(n) {
  if (n == null) return '--';
  return n.toLocaleString('en-US');
}

function calculateAggregateStats(procs) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let ctxSum = 0;
  let ctxCount = 0;
  let active = 0;
  let dead = 0;

  for (const p of procs) {
    if (p.inputTokens != null) totalInput += p.inputTokens;
    if (p.outputTokens != null) totalOutput += p.outputTokens;
    if (p.cacheReadTokens != null) totalCacheRead += p.cacheReadTokens;
    if (p.cacheCreateTokens != null) totalCacheWrite += p.cacheCreateTokens;
    totalCost += (p.cost || 0);
    if (p.contextPct != null) {
      ctxSum += (100 - p.contextPct);
      ctxCount++;
    }
    if (p.isActive) active++;
    else dead++;
  }

  return {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalCache: totalCacheRead + totalCacheWrite,
    totalCost,
    avgContextUtil: ctxCount > 0 ? Math.round(ctxSum / ctxCount) : null,
    active,
    dead,
    total: procs.length,
  };
}

let selectedIndex = 0;
let allProcesses = []; // raw unfiltered list
let processes = [];    // sorted/filtered view used for display
let lastRefresh = new Date();
let statusMessage = '';
let viewMode = CONFIG.defaultView;
let paneCol = 0;
let paneRow = 0;

// Sort & filter state
const SORT_MODES = ['age', 'cpu', 'mem', 'context'];
let sortMode = 'age'; // default: oldest first
let sortReverse = false;
let filterText = '';
let filterInput = false; // true when typing a filter
let showDashboard = false; // toggled by 'd' key
let dashboardManualToggle = false; // true once user presses 'd'
let showHistory = false; // toggled by 'H' key
let showTimeline = false; // toggled by 'W' key
let timelineScrollOffset = 0; // scroll offset for event list in timeline view
let timelineCache = null; // cached timeline data for current process
let showHeatmap = false; // toggled by 'C' key
let exportMode = false; // true when awaiting export format key

// Command palette
const COMMANDS = [
  { name: 'Kill selected process', shortcut: 'x', action: 'kill' },
  { name: 'Force kill selected process', shortcut: 'X', action: 'force-kill' },
  { name: 'Kill all processes', shortcut: 'K', action: 'kill-all' },
  { name: 'Toggle pane view', shortcut: 'P', action: 'toggle-pane' },
  { name: 'Toggle dashboard', shortcut: 'd', action: 'toggle-dashboard' },
  { name: 'Toggle log pane', shortcut: 'L', action: 'toggle-log' },
  { name: 'Toggle history view', shortcut: 'H', action: 'toggle-history' },
  { name: 'Open directory', shortcut: 'o', action: 'open-dir' },
  { name: 'Open in editor', shortcut: 'e', action: 'open-editor' },
  { name: 'Open terminal', shortcut: 't', action: 'open-terminal' },
  { name: 'Sort by age', shortcut: 's', action: 'sort-age' },
  { name: 'Sort by CPU', shortcut: 's', action: 'sort-cpu' },
  { name: 'Sort by memory', shortcut: 's', action: 'sort-mem' },
  { name: 'Sort by context', shortcut: 's', action: 'sort-context' },
  { name: 'Reverse sort', shortcut: 'S', action: 'reverse-sort' },
  { name: 'Refresh', shortcut: 'r', action: 'refresh' },
  { name: 'Cycle theme', shortcut: 'T', action: 'cycle-theme' },
  { name: 'Toggle notifications', shortcut: 'n', action: 'toggle-notif' },
  { name: 'Search sessions', shortcut: 'F', action: 'search' },
  { name: 'Filter processes', shortcut: '/', action: 'filter' },
  { name: 'Show help', shortcut: '?', action: 'help' },
  { name: 'Quit', shortcut: 'q', action: 'quit' },
];

let showPalette = false;
let paletteQuery = '';
let paletteSelected = 0;

function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let qi = 0;
  let lastMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === 0) ? 10 : 1;
      score += (lastMatch === ti - 1) ? 5 : 0;
      lastMatch = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

function filterCommands(query) {
  if (!query) return COMMANDS.slice(0, 10);
  return COMMANDS
    .map(cmd => ({ ...cmd, score: fuzzyScore(query, cmd.name) }))
    .filter(cmd => cmd.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// History tracking state
const HISTORY_DIR = path.join(os.homedir(), '.ctop');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');
let lastSnapshotTime = 0; // ms timestamp of last saved snapshot
const SNAPSHOT_INTERVAL = 60000; // 1 minute minimum between snapshots
const HISTORY_RETENTION_DAYS = 7;

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function pruneHistory(history) {
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return history.filter(entry => new Date(entry.timestamp).getTime() > cutoff);
}

function saveHistorySnapshot(procs) {
  const now = Date.now();
  if (now - lastSnapshotTime < SNAPSHOT_INTERVAL) return;
  lastSnapshotTime = now;

  const stats = calculateAggregateStats(procs);
  const snapshot = {
    timestamp: new Date().toISOString(),
    sessions: procs.length,
    activeCount: stats.active,
    totalInputTokens: stats.totalInput,
    totalOutputTokens: stats.totalOutput,
    totalCacheTokens: stats.totalCache,
    totalCost: Math.round(stats.totalCost * 100) / 100,
    avgContext: stats.avgContextUtil !== null ? stats.avgContextUtil : 0,
  };

  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    let history = loadHistory();
    history.push(snapshot);
    history = pruneHistory(history);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 0));
  } catch {
    // Silently fail - history is best-effort
  }
}

function renderHistoryChart(history, columns) {
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  // Filter to last 24h
  const recent = history.filter(e => new Date(e.timestamp).getTime() > twentyFourHoursAgo);

  if (recent.length === 0) {
    return `${DIM}  No history data in the last 24 hours.${RESET}${CLR_LINE}\n` +
           `${DIM}  Data is collected every minute while ctop is running.${RESET}${CLR_LINE}\n`;
  }

  // Bucket by hour (0-23 hours ago)
  const buckets = new Array(24).fill(null).map(() => ({
    tokens: 0, cost: 0, sessions: 0, count: 0
  }));

  for (const entry of recent) {
    const ts = new Date(entry.timestamp).getTime();
    const hoursAgo = Math.floor((now - ts) / (60 * 60 * 1000));
    const bucketIdx = Math.min(23, Math.max(0, hoursAgo));
    buckets[bucketIdx].tokens += (entry.totalInputTokens || 0) + (entry.totalOutputTokens || 0) + (entry.totalCacheTokens || 0);
    buckets[bucketIdx].cost += entry.totalCost || 0;
    buckets[bucketIdx].sessions += entry.activeCount || 0;
    buckets[bucketIdx].count++;
  }

  // Average values per bucket (since we get multiple snapshots per hour)
  for (const b of buckets) {
    if (b.count > 0) {
      b.tokens = Math.round(b.tokens / b.count);
      b.cost = Math.round(b.cost * 100 / b.count) / 100;
      b.sessions = Math.round(b.sessions / b.count);
    }
  }

  const barWidth = Math.max(20, columns - 25);

  let out = '';

  // Token chart
  out += `\n${BOLD}${THEME.accent}  --- Token Usage (24h) ---${RESET}${CLR_LINE}\n`;
  const maxTokens = Math.max(1, ...buckets.map(b => b.tokens));
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    const hourLabel = formatHourLabel(h);
    const barLen = Math.round((b.tokens / maxTokens) * barWidth);
    const bar = barLen > 0 ? '\u2588'.repeat(barLen) : '';
    const tokenStr = b.tokens > 0 ? formatCompactTokens(b.tokens) : '';
    out += `  ${DIM}${hourLabel}${RESET} ${GREEN}${bar}${RESET} ${DIM}${tokenStr}${RESET}${CLR_LINE}\n`;
  }

  // Cost chart
  out += `\n${BOLD}${THEME.accent}  --- Cost (24h) ---${RESET}${CLR_LINE}\n`;
  const maxCost = Math.max(0.01, ...buckets.map(b => b.cost));
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    const hourLabel = formatHourLabel(h);
    const barLen = Math.round((b.cost / maxCost) * barWidth);
    const bar = barLen > 0 ? '\u2588'.repeat(barLen) : '';
    const costStr = b.cost > 0 ? `$${b.cost.toFixed(2)}` : '';
    out += `  ${DIM}${hourLabel}${RESET} ${YELLOW}${bar}${RESET} ${DIM}${costStr}${RESET}${CLR_LINE}\n`;
  }

  // Session count chart
  out += `\n${BOLD}${THEME.accent}  --- Active Sessions (24h) ---${RESET}${CLR_LINE}\n`;
  const maxSessions = Math.max(1, ...buckets.map(b => b.sessions));
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    const hourLabel = formatHourLabel(h);
    const barLen = Math.round((b.sessions / maxSessions) * barWidth);
    const bar = barLen > 0 ? '\u2588'.repeat(barLen) : '';
    const sessStr = b.sessions > 0 ? `${b.sessions}` : '';
    out += `  ${DIM}${hourLabel}${RESET} ${CYAN}${bar}${RESET} ${DIM}${sessStr}${RESET}${CLR_LINE}\n`;
  }

  return out;
}

function formatHourLabel(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  let hour = d.getHours();
  const ampm = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12 || 12;
  return `${String(hour).padStart(2)}${ampm}`;
}

function formatCompactTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// Full-text search state
let searchMode = false;   // true when typing a search query
let searchQuery = '';
let searchResults = new Map(); // PID -> snippets[]

// Log pane state
let showLogPane = false;
let logPaneManualToggle = false; // true once user presses L (manual override)
let logLines = [];
let logScrollOffset = 0;

// Sparkline state
const processHistory = new Map(); // PID -> { cpu: number[], mem: number[] }
const SPARKLINE_MAX_POINTS = 20;
const SPARKLINE_BLOCKS = '▁▂▃▄▅▆▇█';

function renderSparkline(values, width = 8) {
  if (!values || values.length === 0) return '';
  const recent = values.slice(-width);
  return recent.map(v => {
    const clamped = Math.max(0, Math.min(100, v));
    const idx = Math.min(7, Math.floor(clamped / 100 * 7.99));
    return SPARKLINE_BLOCKS[idx];
  }).join('');
}

function updateProcessHistory(procs) {
  const currentPids = new Set();
  for (const proc of procs) {
    currentPids.add(proc.pid);
    if (!processHistory.has(proc.pid)) {
      processHistory.set(proc.pid, { cpu: [], mem: [] });
    }
    const hist = processHistory.get(proc.pid);
    hist.cpu.push(proc.cpu);
    hist.mem.push(proc.mem);
    if (hist.cpu.length > SPARKLINE_MAX_POINTS) hist.cpu.shift();
    if (hist.mem.length > SPARKLINE_MAX_POINTS) hist.mem.shift();
  }
  // Clean up stale PIDs
  for (const pid of processHistory.keys()) {
    if (!currentPids.has(pid)) processHistory.delete(pid);
  }
}

// Notification state
let notificationsEnabled = CONFIG.notifications.enabled;
const previousStates = new Map();   // PID -> last known status string
const processStartTimes = new Map(); // PID -> timestamp (ms) when first seen ACTIVE

function sendNotification(title, message) {
  try {
    if (IS_MAC) {
      spawn('osascript', ['-e', `display notification "${message}" with title "${title}"`], {
        detached: true, stdio: 'ignore'
      }).unref();
    } else if (IS_WIN) {
      const safeTitle = title.replace(/'/g, "''");
      const safeMsg = message.replace(/'/g, "''");
      spawn('powershell', ['-Command',
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `[System.Windows.Forms.MessageBox]::Show('${safeMsg}','${safeTitle}')`
      ], { detached: true, stdio: 'ignore' }).unref();
    } else if (IS_LINUX) {
      spawn('notify-send', [title, message], {
        detached: true, stdio: 'ignore'
      }).unref();
    }
  } catch (e) {}
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function formatNotificationMessage(proc) {
  const parts = [];
  const label = proc.slug || proc.title || 'Claude session';
  parts.push(label);
  if (proc._activeDurationMs) {
    parts.push(`Duration: ${formatDuration(proc._activeDurationMs)}`);
  }
  if (proc.model) {
    parts.push(`Model: ${proc.model.replace(/^claude-/, '')}`);
  }
  return parts.join(' | ');
}

function checkStateTransitions(currentProcs) {
  if (!notificationsEnabled) return;

  const minDuration = (CONFIG.notifications.minDuration || 30) * 1000;
  const now = Date.now();

  // Build a map of current PIDs -> status
  const currentMap = new Map();
  for (const proc of currentProcs) {
    currentMap.set(proc.pid, proc);
  }

  // Track when processes first become ACTIVE
  for (const proc of currentProcs) {
    if (proc.status === 'ACTIVE' && !processStartTimes.has(proc.pid)) {
      processStartTimes.set(proc.pid, now);
    }
  }

  // Check for transitions: previously ACTIVE -> now STOPPED/ZOMBIE/disappeared
  for (const [pid, prevStatus] of previousStates) {
    if (prevStatus !== 'ACTIVE') continue;

    const current = currentMap.get(pid);
    const newStatus = current ? current.status : null;

    // Only notify on completion transitions
    if (newStatus === 'ACTIVE') continue;

    // Process transitioned away from ACTIVE (or disappeared)
    const startTime = processStartTimes.get(pid);
    if (!startTime) continue;

    const activeDuration = now - startTime;
    if (activeDuration < minDuration) continue;

    // Build notification
    const proc = current || { pid, slug: null, title: 'Claude session', model: null };
    proc._activeDurationMs = activeDuration;
    const message = formatNotificationMessage(proc);
    sendNotification('CTOP \u2014 Session Completed', message);
  }

  // Update previousStates for next cycle
  previousStates.clear();
  for (const proc of currentProcs) {
    previousStates.set(proc.pid, proc.status);
  }

  // Clean up start times for processes that are gone
  for (const pid of processStartTimes.keys()) {
    if (!currentMap.has(pid)) {
      processStartTimes.delete(pid);
    }
  }
}

function getClaudeProcessesWindows() {
  try {
    const psCmd = `powershell -Command "Get-Process | Where-Object {$_.CommandLine -like '*claude*' -and $_.CommandLine -notlike '*claude-manager*' -and $_.CommandLine -notlike '*ctop*'} | Select-Object Id,CPU,WorkingSet64,StartTime,CommandLine | ConvertTo-Json"`;
    const output = execSync(psCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!output) return [];

    let parsed = JSON.parse(output);
    // PowerShell returns a single object (not array) when there is only one match
    if (!Array.isArray(parsed)) parsed = [parsed];

    const procs = [];
    const totalMem = os.totalmem();

    for (const p of parsed) {
      if (!p || !p.Id) continue;
      const pid = String(p.Id);
      const cpuVal = p.CPU != null ? parseFloat(p.CPU) : 0;
      const memBytes = p.WorkingSet64 || 0;
      const memPct = totalMem > 0 ? (memBytes / totalMem * 100) : 0;
      const command = p.CommandLine || '';

      // Parse start time — PowerShell serializes dates as "/Date(ms)/" strings
      let startDate = new Date();
      if (p.StartTime) {
        const m = String(p.StartTime).match(/\/Date\((\d+)\)\//);
        if (m) startDate = new Date(parseInt(m[1], 10));
        else startDate = new Date(p.StartTime);
      }

      const startTime = formatStartTime(startDate);
      const cwd = getProcessCwd(pid);

      procs.push({
        pid,
        cpu: cpuVal,
        mem: parseFloat(memPct.toFixed(1)),
        stat: 'R',
        startDate,
        startTime,
        command,
        cwd,
        title: 'Claude Code',
        contextPct: null,
        model: null,
        stopReason: null,
        gitBranch: null,
        slug: null,
        sessionId: null,
        version: null,
        userType: null,
        inputTokens: null,
        cacheCreateTokens: null,
        cacheReadTokens: null,
        outputTokens: null,
        serviceTier: null,
        timestamp: null,
        requestId: null,
        lastTurnMs: null,
        isActive: true,
        isZombie: false,
        isStopped: false,
        status: 'ACTIVE'
      });
    }

    procs.sort((a, b) => a.startDate - b.startDate);
    assignSessionsToProcesses(procs);
    for (const proc of procs) {
      proc.cost = calculateCost(proc);
    }
    return procs;
  } catch (e) {
    return [];
  }
}

function getClaudeProcesses() {
  if (IS_WIN) return getClaudeProcessesWindows();

  try {
    // Get all claude processes with elapsed time for sorting
    // Using lstart for actual start time sorting
    const psOutput = execSync(
      `ps -eo pid,user,pcpu,pmem,stat,lstart,command | grep 'claude' | grep -v 'claude-manager' | grep -v 'ctop' | grep -v 'Claude.app' | grep -v 'grep'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!psOutput) return [];

    const lines = psOutput.split('\n').filter(Boolean);
    const procs = [];

    for (const line of lines) {
      // Parse the line - lstart takes 5 fields (e.g., "Sun Feb 23 15:44:00 2025")
      const parts = line.trim().split(/\s+/);
      const pid = parts[0];
      const user = parts[1];
      const cpu = parts[2];
      const mem = parts[3];
      const stat = parts[4];
      // lstart is parts[5] through parts[9] (e.g., "Sun Feb 23 15:44:00 2025")
      const lstartStr = parts.slice(5, 10).join(' ');
      const command = parts.slice(10).join(' ');

      // Parse start time
      const startDate = new Date(lstartStr);
      const startTime = formatStartTime(startDate);

      // Get working directory
      const cwd = getProcessCwd(pid);

      // Determine process state
      const isActive = !stat.includes('Z') && !stat.includes('T');
      const isZombie = stat.includes('Z');
      const isStopped = stat.includes('T');

      procs.push({
        pid,
        cpu: parseFloat(cpu) || 0,
        mem: parseFloat(mem) || 0,
        stat,
        startDate,
        startTime,
        command,
        cwd,
        title: 'Claude Code',
        contextPct: null,
        model: null,
        stopReason: null,
        gitBranch: null,
        slug: null,
        sessionId: null,
        version: null,
        userType: null,
        inputTokens: null,
        cacheCreateTokens: null,
        cacheReadTokens: null,
        outputTokens: null,
        serviceTier: null,
        timestamp: null,
        requestId: null,
        lastTurnMs: null,
        isActive,
        isZombie,
        isStopped,
        status: isZombie ? 'ZOMBIE' : isStopped ? 'STOPPED' : isActive ? 'ACTIVE' : 'SLEEPING'
      });
    }

    // Sort by start time (oldest first = created first at top)
    procs.sort((a, b) => a.startDate - b.startDate);

    // Assign session data (title + context) by matching sessions to processes per cwd
    assignSessionsToProcesses(procs);

    // Calculate cost for each process
    for (const proc of procs) {
      proc.cost = calculateCost(proc);
    }

    return procs;
  } catch (e) {
    return [];
  }
}

function formatStartTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'just now';
  }
}

// --- Export report formatting ---

function formatSessionMarkdown(proc) {
  return `## Claude Session Report
- **Model:** ${proc.model || 'unknown'}
- **Status:** ${proc.status}
- **Started:** ${proc.startTime}
- **Cost:** ${formatCost(proc.cost)}
- **Context:** ${proc.contextPct != null ? proc.contextPct + '% free' : 'N/A'}
- **Tokens:** ${(proc.inputTokens || 0).toLocaleString()} input, ${(proc.outputTokens || 0).toLocaleString()} output, ${(proc.cacheReadTokens || 0).toLocaleString()} cache read
- **Branch:** ${proc.gitBranch || 'N/A'}
- **Directory:** ${proc.cwd || 'N/A'}
- **PID:** ${proc.pid}`;
}

function formatSessionJSON(proc) {
  return JSON.stringify({
    pid: proc.pid,
    model: proc.model,
    status: proc.status,
    startTime: proc.startTime,
    cost: proc.cost,
    contextPct: proc.contextPct,
    tokens: {
      input: proc.inputTokens,
      output: proc.outputTokens,
      cacheCreate: proc.cacheCreateTokens,
      cacheRead: proc.cacheReadTokens,
    },
    branch: proc.gitBranch,
    slug: proc.slug,
    cwd: proc.cwd,
    cpu: proc.cpu,
    mem: proc.mem,
  }, null, 2);
}

function formatSessionCSV(proc) {
  const headers = 'pid,model,status,cost,context_pct,input_tokens,output_tokens,cache_read_tokens,branch,directory';
  const values = [
    proc.pid,
    csvEscape(proc.model || ''),
    csvEscape(proc.status),
    proc.cost || 0,
    proc.contextPct || '',
    proc.inputTokens || 0,
    proc.outputTokens || 0,
    proc.cacheReadTokens || 0,
    csvEscape(proc.gitBranch || ''),
    csvEscape(proc.cwd || ''),
  ].join(',');
  return headers + '\n' + values;
}

function csvEscape(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function copyToClipboard(text) {
  try {
    if (IS_MAC) {
      execSync('pbcopy', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
    } else if (IS_LINUX) {
      try {
        execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
      }
    } else if (IS_WIN) {
      execSync('clip', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    return true;
  } catch (e) {
    return false;
  }
}

function getProcessCwd(pid) {
  try {
    if (IS_WIN) {
      // Windows: use PowerShell to get the working directory via CIM
      // This queries the Win32_Process WMI class for the ExecutablePath,
      // but CWD is not reliably available on Windows. We try wmic first.
      try {
        const output = execSync(
          `powershell -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").ExecutablePath"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        // ExecutablePath gives us the exe location; derive a working directory from it
        if (output) return path.dirname(output);
      } catch (e2) {}
      return '';
    } else if (IS_LINUX) {
      // Linux: read /proc/<pid>/cwd symlink
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } else {
      // macOS: use lsof
      return execSync(`lsof -p ${pid} 2>/dev/null | grep cwd | awk '{print $NF}'`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    }
  } catch (e) {
    return '';
  }
}

function getSessionData(filePath) {
  const result = {
    title: null, contextPct: null, model: null, stopReason: null,
    gitBranch: null, slug: null, sessionId: null, version: null,
    userType: null, inputTokens: null, cacheCreateTokens: null,
    cacheReadTokens: null, outputTokens: null, serviceTier: null,
    timestamp: null, requestId: null,
  };

  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);

    // Read first 64KB for title
    const headSize = Math.min(65536, stat.size);
    const headBuf = Buffer.alloc(headSize);
    fs.readSync(fd, headBuf, 0, headSize, 0);
    const headLines = headBuf.toString('utf8').split('\n');
    for (const line of headLines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.summary) {
          result.title = data.summary.substring(0, 50);
          break;
        } else if (data.type === 'user' && data.message && data.message.role === 'user' && data.message.content) {
          const msg = typeof data.message.content === 'string'
            ? data.message.content
            : (data.message.content.find(c => c.type === 'text') || {}).text || '';
          if (!msg || msg.startsWith('<') || msg.trim() === '') continue;
          result.title = msg.substring(0, 80).replace(/\n/g, ' ').trim();
          break;
        }
      } catch (e) {}
    }

    // Read last 64KB for usage + metadata
    const tailSize = Math.min(65536, stat.size);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, stat.size - tailSize);
    fs.closeSync(fd);
    const tailLines = tailBuf.toString('utf8').split('\n').reverse();

    // Find turn_duration
    for (const line of tailLines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.subtype === 'turn_duration') {
          result.lastTurnMs = data.durationMs || null;
          break;
        }
      } catch (e) {}
    }

    // Find last assistant message with usage
    for (const line of tailLines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.message && data.message.usage) {
          const u = data.message.usage;
          const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          result.contextPct = Math.round((CONFIG.contextLimit - used) / CONFIG.contextLimit * 100);
          if (result.contextPct < 0) result.contextPct = 0;
          if (result.contextPct > 100) result.contextPct = 100;
          result.model = data.message.model || null;
          result.stopReason = data.message.stop_reason || null;
          result.gitBranch = data.gitBranch || null;
          result.slug = data.slug || null;
          result.sessionId = data.sessionId || null;
          result.version = data.version || null;
          result.userType = data.userType || null;
          result.timestamp = data.timestamp || null;
          result.requestId = data.requestId || null;
          result.inputTokens = u.input_tokens || 0;
          result.cacheCreateTokens = u.cache_creation_input_tokens || 0;
          result.cacheReadTokens = u.cache_read_input_tokens || 0;
          result.outputTokens = u.output_tokens || 0;
          result.serviceTier = u.service_tier || null;
          break;
        }
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

function searchSessionContent(projectPath, sessionFile, query) {
  const result = { matched: false, snippets: [] };
  if (!query) return result;

  const filePath = path.join(projectPath, sessionFile);
  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const readSize = Math.min(262144, stat.size); // 256KB cap
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);

    const content = buf.toString('utf8');
    const lines = content.split('\n');
    const lowerQuery = query.toLowerCase();

    for (const line of lines) {
      if (!line.trim()) continue;
      if (result.snippets.length >= 3) break;
      try {
        const data = JSON.parse(line);
        if (!data.message || !data.message.content) continue;
        const role = data.message.role;
        if (role !== 'user' && role !== 'assistant') continue;

        let text = '';
        if (typeof data.message.content === 'string') {
          text = data.message.content;
        } else if (Array.isArray(data.message.content)) {
          text = data.message.content
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join(' ');
        }

        const lowerText = text.toLowerCase();
        let searchFrom = 0;
        while (searchFrom < lowerText.length && result.snippets.length < 3) {
          const idx = lowerText.indexOf(lowerQuery, searchFrom);
          if (idx === -1) break;
          const start = Math.max(0, idx - 20);
          const end = Math.min(text.length, idx + query.length + 30);
          let snippet = text.substring(start, end).replace(/\n/g, ' ');
          if (start > 0) snippet = '...' + snippet;
          if (end < text.length) snippet = snippet + '...';
          result.snippets.push(snippet);
          result.matched = true;
          searchFrom = idx + query.length;
        }
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

// Convert a cwd path to the Claude project directory name.
// On Unix: /Users/foo/project -> -Users-foo-project
// On Windows: C:\Users\foo\project -> C-Users-foo-project
function cwdToProjectDirName(cwd) {
  return cwd.replace(/[\\/]/g, '-').replace(/:/g, '');
}

function executeSearch(query) {
  searchResults.clear();
  if (!query) return;

  for (const proc of processes) {
    if (!proc.cwd) continue;
    const projectDirName = cwdToProjectDirName(proc.cwd);
    const projectPath = path.join(os.homedir(), '.claude', 'projects', projectDirName);
    if (!fs.existsSync(projectPath)) continue;

    const files = getSessionFilesForProject(projectPath);
    // Search the most recent session file for this process
    if (files.length > 0) {
      const result = searchSessionContent(projectPath, files[0].name, query);
      if (result.matched) {
        searchResults.set(proc.pid, result.snippets);
      }
    }
  }
}

// Cache of sorted session files per project path
let sessionFileCache = new Map();
let sessionFileCacheTime = 0;

function getSessionFilesForProject(projectPath) {
  // Cache session file listings for 3 seconds to avoid repeated readdirs
  const now = Date.now();
  if (now - sessionFileCacheTime > 3000) {
    sessionFileCache.clear();
    sessionFileCacheTime = now;
  }

  if (sessionFileCache.has(projectPath)) return sessionFileCache.get(projectPath);

  try {
    const files = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const fp = path.join(projectPath, f);
        return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    sessionFileCache.set(projectPath, files);
    return files;
  } catch (e) {
    return [];
  }
}

function assignSessionsToProcesses(procs) {
  // Group processes by cwd
  const groups = new Map();
  for (const proc of procs) {
    if (!proc.cwd) continue;
    if (!groups.has(proc.cwd)) groups.set(proc.cwd, []);
    groups.get(proc.cwd).push(proc);
  }

  for (const [cwd, groupProcs] of groups) {
    const projectDirName = cwdToProjectDirName(cwd);
    const projectPath = path.join(os.homedir(), '.claude', 'projects', projectDirName);

    if (!fs.existsSync(projectPath)) continue;

    const files = getSessionFilesForProject(projectPath);
    // Take the N most recently modified session files for N processes
    const n = groupProcs.length;
    const topFiles = files.slice(0, n);

    // Sort processes by startDate descending (most recent first)
    // so most recent process gets most recently modified session
    const sorted = [...groupProcs].sort((a, b) => b.startDate - a.startDate);

    for (let i = 0; i < sorted.length; i++) {
      if (i < topFiles.length) {
        const data = getSessionData(topFiles[i].path);
        if (data.title) sorted[i].title = data.title;
        for (const key of ['contextPct', 'model', 'stopReason', 'gitBranch', 'slug',
          'sessionId', 'version', 'userType', 'inputTokens', 'cacheCreateTokens',
          'cacheReadTokens', 'outputTokens', 'serviceTier', 'timestamp', 'requestId', 'lastTurnMs']) {
          if (data[key] !== null && data[key] !== undefined) sorted[i][key] = data[key];
        }
      }
    }
  }

  // Set fallback titles for processes that still have default
  for (const proc of procs) {
    if (proc.title === 'Claude Code' && proc.cwd) {
      const parts = proc.cwd.split(/[\\/]/).filter(Boolean);
      proc.title = parts.length >= 2
        ? parts[parts.length - 2] + '/' + parts[parts.length - 1]
        : parts[parts.length - 1] || proc.cwd;
    }
  }
}

function parseLogEntry(data) {
  // Extract human-readable conversation text from a JSONL entry.
  // Returns { role: 'user'|'assistant', text: string } or null if not a conversation line.
  if (!data || !data.message) return null;
  const role = data.message.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const content = data.message.content;
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    // Only extract text blocks; skip tool_use, tool_result, images, etc.
    const textParts = content.filter(c => c.type === 'text').map(c => c.text || '');
    text = textParts.join(' ');
  }

  if (!text || !text.trim()) return null;

  // Strip system-like messages (XML tags typically indicate system prompts)
  if (role === 'user' && text.trim().startsWith('<')) return null;

  return { role, text: text.replace(/\n/g, ' ').trim() };
}

function readSessionLog(proc, maxLines) {
  if (maxLines === undefined) maxLines = 50;
  // Find the session JSONL file for this process (same logic as assignSessionsToProcesses)
  if (!proc || !proc.cwd) return [];

  const projectDirName = proc.cwd.replace(/\//g, '-');
  const projectPath = path.join(process.env.HOME || '', '.claude', 'projects', projectDirName);

  try {
    if (!fs.existsSync(projectPath)) return [];
  } catch (e) {
    return [];
  }

  const files = getSessionFilesForProject(projectPath);
  if (files.length === 0) return [];

  // Use the most recent session file (matching what assignSessionsToProcesses does)
  const filePath = files[0].path;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const entries = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        const entry = parseLogEntry(data);
        if (entry) {
          const prefix = entry.role === 'user' ? 'USER' : 'ASSISTANT';
          entries.push({ role: entry.role, text: `${prefix}: ${entry.text}` });
        }
      } catch (e) {}
    }

    // Return last N entries
    return entries.slice(-maxLines);
  } catch (e) {
    return [];
  }
}

function parseSessionTimeline(filePath) {
  // Parse a session JSONL file and extract a timeline of events
  // Returns: { events: [...], startTime, endTime, totalDuration }
  const empty = { events: [], startTime: null, endTime: null, totalDuration: 0 };

  if (!filePath) return empty;

  try {
    if (!fs.existsSync(filePath)) return empty;
  } catch (e) {
    return empty;
  }

  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const readSize = Math.min(524288, stat.size); // 512KB cap
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);

    const content = buf.toString('utf8');
    const lines = content.split('\n');
    const events = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch (e) {
        continue;
      }

      const timestamp = data.timestamp || null;

      // Detect event type
      if (data.type === 'user' && data.message && data.message.role === 'user') {
        // User message
        let text = '';
        const content = data.message.content;
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = content.filter(c => c.type === 'text').map(c => c.text || '').join(' ');
        }
        // Skip system-like XML messages
        if (text.trim().startsWith('<')) continue;
        if (!text.trim()) continue;
        events.push({
          type: 'user',
          timestamp,
          summary: text.replace(/\n/g, ' ').trim().substring(0, 40),
        });
      } else if (data.message && data.message.role === 'assistant') {
        // Assistant message — check if it contains tool_use blocks
        const content = data.message.content;
        let text = '';
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              events.push({
                type: 'tool_use',
                timestamp,
                summary: (block.name || 'tool').substring(0, 40),
              });
            } else if (block.type === 'text') {
              text += (block.text || '') + ' ';
            }
          }
        } else if (typeof content === 'string') {
          text = content;
        }
        // Add assistant text event if there is meaningful text
        text = text.trim();
        if (text) {
          events.push({
            type: 'assistant',
            timestamp,
            summary: text.replace(/\n/g, ' ').substring(0, 40),
          });
        }
      } else if (data.type === 'tool_result' || (data.message && data.message.role === 'tool')) {
        events.push({
          type: 'tool_result',
          timestamp,
          summary: 'tool result',
        });
      }
    }

    // Calculate timing
    const timestamps = events.filter(e => e.timestamp).map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t));
    const startTime = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const endTime = timestamps.length > 0 ? Math.max(...timestamps) : null;
    const totalDuration = (startTime !== null && endTime !== null) ? endTime - startTime : 0;

    // Calculate duration_ms between consecutive events
    for (let i = 0; i < events.length; i++) {
      if (events[i].timestamp && i + 1 < events.length && events[i + 1].timestamp) {
        const t1 = new Date(events[i].timestamp).getTime();
        const t2 = new Date(events[i + 1].timestamp).getTime();
        if (!isNaN(t1) && !isNaN(t2)) {
          events[i].duration_ms = t2 - t1;
        }
      }
    }

    return { events, startTime, endTime, totalDuration };
  } catch (e) {
    return empty;
  }
}

function getSessionFileForProc(proc) {
  // Find the most recent session JSONL file path for a given process
  if (!proc || !proc.cwd) return null;
  const projectDirName = cwdToProjectDirName(proc.cwd);
  const projectPath = path.join(os.homedir(), '.claude', 'projects', projectDirName);
  try {
    if (!fs.existsSync(projectPath)) return null;
  } catch (e) {
    return null;
  }
  const files = getSessionFilesForProject(projectPath);
  return files.length > 0 ? files[0].path : null;
}

function formatElapsed(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
  return Math.floor(ms / 3600000) + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm';
}

function renderTimeline(proc, columns, rows) {
  let output = CLEAR;

  // Header
  output += renderHeader(columns);
  output += '\n';

  const modelStr = proc.model ? proc.model.replace(/^claude-/, '') : 'unknown';
  output += `${BOLD}${WHITE}  Session Timeline ${RESET}${DIM}— PID: ${proc.pid} — Model: ${modelStr}${RESET}${CLR_LINE}\n`;
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  // Get timeline data
  if (!timelineCache) {
    const filePath = getSessionFileForProc(proc);
    timelineCache = parseSessionTimeline(filePath);
  }

  const tl = timelineCache;

  if (tl.events.length === 0) {
    output += `\n${DIM}  No timeline events found for this session.${RESET}${CLR_LINE}\n`;
    output += `\n${DIM}  Press ${RESET}${CYAN}W${RESET}${DIM} or ${RESET}${CYAN}ESC${RESET}${DIM} to return...${RESET}${CLR_LINE}\n`;
    process.stdout.write(output);
    return;
  }

  // Calculate category totals
  const catTotals = { user: 0, assistant: 0, tool_use: 0, tool_result: 0, gap: 0 };
  const catCounts = { user: 0, assistant: 0, tool_use: 0, tool_result: 0 };
  for (const evt of tl.events) {
    catCounts[evt.type] = (catCounts[evt.type] || 0) + 1;
    if (evt.duration_ms && evt.duration_ms > 0) {
      catTotals[evt.type] = (catTotals[evt.type] || 0) + evt.duration_ms;
    }
  }

  // Duration summary line
  const durationStr = tl.totalDuration > 0 ? formatElapsed(tl.totalDuration) : '--';
  output += `  ${BOLD}Duration:${RESET} ${durationStr}`;
  output += `  ${DIM}|${RESET}  ${CYAN}User:${RESET} ${catCounts.user}`;
  output += `  ${GREEN}Assistant:${RESET} ${catCounts.assistant}`;
  output += `  ${YELLOW}Tool:${RESET} ${catCounts.tool_use + catCounts.tool_result}`;
  output += `  ${DIM}Events: ${tl.events.length}${RESET}${CLR_LINE}\n\n`;

  // Time axis and waterfall bar
  const barWidth = Math.max(20, columns - 6); // 3 padding each side
  if (tl.totalDuration > 0) {
    // Time axis markers
    const numMarkers = Math.min(6, Math.floor(barWidth / 12));
    let axisLine = '   ';
    for (let i = 0; i <= numMarkers; i++) {
      const frac = i / numMarkers;
      const ms = Math.round(frac * tl.totalDuration);
      const label = formatElapsed(ms);
      const pos = Math.round(frac * barWidth);
      // Pad to position
      while (axisLine.length < pos + 3) axisLine += ' ';
      axisLine = axisLine.substring(0, pos + 3) + DIM + label + RESET;
    }
    output += axisLine + CLR_LINE + '\n';

    // Waterfall bar — each event gets a proportional colored segment
    let barLine = '   ';
    for (const evt of tl.events) {
      const evtDur = evt.duration_ms || 0;
      const charCount = tl.totalDuration > 0
        ? Math.max(evtDur > 0 ? 1 : 0, Math.round((evtDur / tl.totalDuration) * barWidth))
        : 0;
      let color = DIM;
      let ch = '\u2591'; // ░ for gaps
      if (evt.type === 'user') { color = CYAN; ch = '\u2588'; }
      else if (evt.type === 'assistant') { color = GREEN; ch = '\u2588'; }
      else if (evt.type === 'tool_use') { color = YELLOW; ch = '\u2588'; }
      else if (evt.type === 'tool_result') { color = YELLOW; ch = '\u2588'; }
      barLine += color + ch.repeat(charCount) + RESET;
    }
    output += barLine + CLR_LINE + '\n';

    // Legend
    output += `   ${CYAN}\u2588${RESET} User  ${GREEN}\u2588${RESET} Assistant  ${YELLOW}\u2588${RESET} Tool  ${DIM}\u2591${RESET} Gap${CLR_LINE}\n`;
  }

  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  // Event list header
  output += `${BOLD}${CYAN}  ${'#'.padEnd(5)}${'TYPE'.padEnd(12)}${'TIME'.padEnd(20)}${'DURATION'.padEnd(12)}SUMMARY${RESET}${CLR_LINE}\n`;
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  // Scrollable event list
  const headerUsed = 14; // lines used by header/bar/legend above
  const footerLines = 3; // separator + keys + buffer
  const availRows = Math.max(3, rows - headerUsed - footerLines);

  // Clamp scroll offset
  const maxScroll = Math.max(0, tl.events.length - availRows);
  if (timelineScrollOffset > maxScroll) timelineScrollOffset = maxScroll;
  if (timelineScrollOffset < 0) timelineScrollOffset = 0;

  const startIdx = timelineScrollOffset;
  const endIdx = Math.min(tl.events.length, startIdx + availRows);

  for (let i = startIdx; i < endIdx; i++) {
    const evt = tl.events[i];
    const num = String(i + 1).padEnd(5);
    let typeColor = DIM;
    let typeLabel = evt.type;
    if (evt.type === 'user') { typeColor = CYAN; typeLabel = 'user'; }
    else if (evt.type === 'assistant') { typeColor = GREEN; typeLabel = 'assistant'; }
    else if (evt.type === 'tool_use') { typeColor = YELLOW; typeLabel = 'tool_use'; }
    else if (evt.type === 'tool_result') { typeColor = YELLOW; typeLabel = 'tool_result'; }

    const timeStr = evt.timestamp
      ? new Date(evt.timestamp).toLocaleTimeString()
      : '--';
    const durStr = evt.duration_ms ? formatElapsed(evt.duration_ms) : '--';
    const summaryMaxLen = Math.max(10, columns - 5 - 12 - 20 - 12 - 4);
    const summary = (evt.summary || '').substring(0, summaryMaxLen);

    output += `  ${DIM}${num}${RESET}${typeColor}${typeLabel.padEnd(12)}${RESET}`;
    output += `${DIM}${timeStr.padEnd(20)}${RESET}`;
    output += `${DIM}${durStr.padEnd(12)}${RESET}`;
    output += `${summary}${CLR_LINE}\n`;
  }

  // Scroll indicator
  if (tl.events.length > availRows) {
    const pct = Math.round((timelineScrollOffset / maxScroll) * 100);
    output += `${DIM}  Showing ${startIdx + 1}-${endIdx} of ${tl.events.length} events (${pct}% scrolled)${RESET}${CLR_LINE}\n`;
  }

  // Footer
  output += `${ESC}[${rows - 1};1H`;
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}`;
  output += `${ESC}[${rows};1H`;
  output += `${BOLD} KEYS:${RESET} `;
  output += `${CYAN}\u2191\u2193${RESET} Scroll  `;
  output += `${CYAN}W${RESET}/${CYAN}ESC${RESET} Back  `;
  output += `${CYAN}q${RESET} Quit${CLR_LINE}`;

  process.stdout.write(output);
}

function ctxColor(pct) {
  // pct = remaining %
  if (pct < 10) return THEME.ctxLow;
  if (pct < 40) return THEME.ctxMed;
  if (pct < 70) return THEME.ctxHigh;
  return THEME.ctxOk;
}

// Braille-dot context bar rendering
// Each braille character can represent 8 sub-positions (dots in a 2x4 grid).
// We use vertical fill patterns: bottom-to-top dot filling for a smooth bar.
// Braille patterns for horizontal fill (left-to-right within a character):
//   ⠀ (empty) ⢀ ⢠ ⢰ ⢸ ⣸ ⣼ ⣾ ⣿ (full)
// This gives 8 sub-positions per character cell.
const BRAILLE_FILLS = ['\u2800', '\u2880', '\u28A0', '\u28B0', '\u28B8', '\u28F8', '\u28FC', '\u28FE', '\u28FF'];
// indices:                0        1        2        3        4        5        6        7        8

function renderBrailleBar(segments, width) {
  // segments: [{value: fraction (0-1), color: ANSI_COLOR_STRING}, ...]
  // width: number of character cells for the bar
  // Returns a string with ANSI colors representing the bar, exactly `width` visible chars.
  if (width <= 0) return '';

  // Build a per-character array: each cell stores which segment fills it and how much.
  // We walk through character positions and assign each to the segment that owns it.
  const totalSubs = width * 8;
  const chars = new Array(width);

  // Compute cumulative sub-position boundaries for each segment
  let cumSubs = 0;
  const segBounds = []; // [{start, end, color}]
  for (const seg of segments) {
    const segSubs = Math.round(seg.value * totalSubs);
    if (segSubs <= 0) {
      segBounds.push({ start: cumSubs, end: cumSubs, color: seg.color });
      continue;
    }
    segBounds.push({ start: cumSubs, end: cumSubs + segSubs, color: seg.color });
    cumSubs += segSubs;
  }
  // Ensure total fills exactly width by extending the last non-empty segment,
  // or if all segments are empty, leave them empty.
  if (segBounds.length > 0 && cumSubs > 0 && cumSubs < totalSubs) {
    // Find last segment with non-zero span and extend it
    for (let i = segBounds.length - 1; i >= 0; i--) {
      if (segBounds[i].end > segBounds[i].start) {
        segBounds[i].end = totalSubs;
        break;
      }
    }
  }

  // For each character cell, determine the dominant segment and fill level
  for (let ci = 0; ci < width; ci++) {
    const cellStart = ci * 8;
    const cellEnd = cellStart + 8;

    // Find the segment that covers the most sub-positions in this cell
    let bestSeg = segBounds.length - 1;
    let bestOverlap = 0;
    for (let si = 0; si < segBounds.length; si++) {
      const oStart = Math.max(cellStart, segBounds[si].start);
      const oEnd = Math.min(cellEnd, segBounds[si].end);
      const overlap = Math.max(0, oEnd - oStart);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSeg = si;
      }
    }

    // Determine how many sub-positions are filled (non-free) up to this cell
    // We compute fill = total filled sub-positions within this cell across all segments
    // preceding the last segment (which is typically "free")
    let filled = 0;
    for (let si = 0; si < segBounds.length; si++) {
      const oStart = Math.max(cellStart, segBounds[si].start);
      const oEnd = Math.min(cellEnd, segBounds[si].end);
      filled += Math.max(0, oEnd - oStart);
    }

    // The character is the dominant segment's color with its fill level
    const segColor = segBounds[bestSeg].color;
    const fillSubs = Math.min(8, Math.max(0, bestOverlap));
    chars[ci] = { color: segColor, fill: fillSubs };
  }

  // Render the character array
  let result = '';
  let prevColor = null;
  for (let ci = 0; ci < width; ci++) {
    const { color, fill } = chars[ci];
    if (color !== prevColor) {
      if (prevColor !== null) result += RESET;
      if (color) result += color;
      prevColor = color;
    }
    result += BRAILLE_FILLS[fill];
  }
  if (prevColor !== null) result += RESET;

  return result;
}

function renderContextBarBraille(proc, width) {
  // Renders a context bar using braille dots for the given process.
  // Returns an object { bar, segments } where bar is the ANSI string and
  // segments contains the computed proportions for testing.
  const CTX_LIMIT = CONFIG.contextLimit;
  const inp = proc.inputTokens || 0;
  const cw = proc.cacheCreateTokens || 0;
  const cr = proc.cacheReadTokens || 0;
  const out = proc.outputTokens || 0;
  const used = inp + cw + cr;
  const free = Math.max(0, CTX_LIMIT - used);

  const total = inp + cw + cr + out + free;
  // Avoid division by zero
  if (total === 0) {
    return {
      bar: `${DIM}${BRAILLE_FILLS[0].repeat(width)}${RESET}`,
      segments: [{ name: 'free', value: 1, tokens: 0 }]
    };
  }

  // Compute segment proportions relative to CTX_LIMIT.
  // Output tokens reduce the free space (same approach as the block bar).
  const adjustedFree = Math.max(0, free - out);

  const segDefs = [
    { name: 'input',       tokens: inp,           color: GREEN },
    { name: 'cache_write', tokens: cw,            color: BLUE },
    { name: 'cache_read',  tokens: cr,            color: CYAN },
    { name: 'output',      tokens: out,           color: YELLOW },
    { name: 'free',        tokens: adjustedFree,  color: DIM },
  ];

  const segments = segDefs.map(s => ({
    name: s.name,
    value: s.tokens / CTX_LIMIT,
    tokens: s.tokens,
    color: s.color,
  }));

  // Clamp total value to 1.0 (in case used + output > CTX_LIMIT)
  let sumValues = segments.reduce((s, seg) => s + seg.value, 0);
  if (sumValues > 1) {
    const scale = 1 / sumValues;
    for (const seg of segments) seg.value *= scale;
  }

  const bar = renderBrailleBar(segments, width);
  return { bar, segments };
}

function applySortAndFilter() {
  let result = [...allProcesses];

  // Filter
  if (filterText) {
    const ft = filterText.toLowerCase();
    result = result.filter(p => {
      const branch = (p.gitBranch || '').toLowerCase();
      const model = (p.model || '').toLowerCase();
      const dir = (p.cwd || '').toLowerCase();
      const slug = (p.slug || '').toLowerCase();
      const title = (p.title || '').toLowerCase();
      return branch.includes(ft) || model.includes(ft) || dir.includes(ft) || slug.includes(ft) || title.includes(ft);
    });
  }

  // Search filter: show only matching sessions
  if (searchQuery && searchResults.size > 0) {
    result = result.filter(p => searchResults.has(p.pid));
  }

  // Sort
  switch (sortMode) {
    case 'cpu':
      result.sort((a, b) => b.cpu - a.cpu);
      break;
    case 'mem':
      result.sort((a, b) => b.mem - a.mem);
      break;
    case 'context':
      result.sort((a, b) => {
        const ca = a.contextPct !== null ? a.contextPct : 100;
        const cb = b.contextPct !== null ? b.contextPct : 100;
        return ca - cb; // lowest free first (most used first)
      });
      break;
    case 'age':
    default:
      result.sort((a, b) => a.startDate - b.startDate);
      break;
  }

  if (sortReverse) result.reverse();

  processes = result;
  if (selectedIndex >= processes.length) {
    selectedIndex = Math.max(0, processes.length - 1);
  }
}

function renderDashboard(columns) {
  const stats = calculateAggregateStats(allProcesses);
  let out = '';
  const inStr = `In: ${formatTokenCount(stats.totalInput)}`;
  const outStr = `Out: ${formatTokenCount(stats.totalOutput)}`;
  const cacheStr = `Cache: ${formatTokenCount(stats.totalCache)}`;
  out += `${DIM} Tokens  ${RESET}${GREEN}${inStr}${RESET}${DIM} | ${RESET}${YELLOW}${outStr}${RESET}${DIM} | ${RESET}${CYAN}${cacheStr}${RESET}${CLR_LINE}\n`;
  const utilStr = stats.avgContextUtil !== null ? `${stats.avgContextUtil}%` : '--';
  let utilColor = GREEN;
  if (stats.avgContextUtil !== null) {
    if (stats.avgContextUtil > 80) utilColor = RED;
    else if (stats.avgContextUtil > 50) utilColor = YELLOW;
  }
  let costColor = GREEN;
  if (stats.totalCost > 5) costColor = RED;
  else if (stats.totalCost >= 1) costColor = YELLOW;
  out += `${DIM} Avg Ctx ${RESET}${utilColor}${utilStr}${RESET}`;
  out += `${DIM} | Cost: ${RESET}${costColor}${formatCost(stats.totalCost > 0 ? stats.totalCost : null)}${RESET}`;
  out += `${DIM} | Sessions: ${RESET}${GREEN}${stats.active}${RESET}${DIM} active ${RESET}${RED}${stats.dead}${RESET}${DIM} dead ${RESET}${WHITE}${stats.total}${RESET}${DIM} total${RESET}${CLR_LINE}\n`;
  return out;
}

function renderHeader(columns) {
  const title = ' CTOP — Claude Terminal Operations Panel ';
  let h = '';

  // Thin top border
  h += `${THEME.border}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  // Header row with centered title
  const pad = Math.max(0, Math.floor((columns - title.length) / 2));
  const rightPad = Math.max(0, columns - pad - title.length);
  h += `${THEME.headerBg}${WHITE}${BOLD}${' '.repeat(pad)}${title}${' '.repeat(rightPad)}${RESET}${CLR_LINE}\n`;

  // Thin bottom border
  h += `${THEME.border}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  return h;
}

function getCardsPerRow() {
  const { columns } = process.stdout;
  const cardWidth = 34;
  const gap = 1;
  const detailPaneWidth = 42;
  const showDetail = columns >= 140;
  const availWidth = showDetail ? columns - detailPaneWidth - 1 : columns;
  return Math.max(1, Math.floor((availWidth + gap) / (cardWidth + gap)));
}

function renderPaneMode() {
  const { columns, rows } = process.stdout;
  const cardWidth = 34;
  const cardHeight = 8;
  const cardGapX = 1;
  const cardGapY = 1;
  const cardsPerRow = getCardsPerRow();

  // Auto-show log pane when terminal is tall enough (unless user manually toggled)
  if (!logPaneManualToggle) {
    showLogPane = rows >= 40;
  }
  // Auto-show dashboard when terminal is tall enough
  if (!dashboardManualToggle) {
    showDashboard = rows >= 40;
  }

  let output = HOME + HIDE_CURSOR;

  // Header
  output += renderHeader(columns);

  // Stats bar
  const activeCount = allProcesses.filter(p => p.isActive).length;
  const deadCount = allProcesses.filter(p => !p.isActive).length;
  const paneTotalCost = allProcesses.reduce((sum, p) => sum + (p.cost || 0), 0);
  let statsLine = `${DIM} Active: ${RESET}${GREEN}${activeCount}${RESET}${DIM} | Dead/Stopped: ${RESET}${RED}${deadCount}${RESET}`;
  let paneCostColor = GREEN;
  if (paneTotalCost > 5) paneCostColor = RED;
  else if (paneTotalCost >= 1) paneCostColor = YELLOW;
  statsLine += `${DIM} | Total Cost: ${RESET}${paneCostColor}${formatCost(paneTotalCost > 0 ? paneTotalCost : null)}${RESET}`;
  if (sortMode !== 'age') statsLine += `${DIM} | Sort: ${RESET}${CYAN}${sortMode}${sortReverse ? ' ↑' : ''}${RESET}`;
  if (filterText) statsLine += `${DIM} | Filter: ${RESET}${YELLOW}"${filterText}"${RESET}${DIM} (${processes.length}/${allProcesses.length})${RESET}`;
  if (filterInput) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} /${filterText}█ ${RESET}`;
  if (searchMode) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} Search: ${searchQuery}█ ${RESET}`;
  else if (searchQuery) statsLine += `${DIM} | Search: ${RESET}${YELLOW}"${searchQuery}"${RESET}${DIM} (${searchResults.size} matches)${RESET}`;
  const notifLabel = notificationsEnabled ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  statsLine += `${DIM} | Notif: ${RESET}${notifLabel}`;
  statsLine += `${DIM} | ${lastRefresh.toLocaleTimeString()} ${RESET}`;
  output += statsLine + `${CLR_LINE}\n`;

  if (showDashboard) { output += renderDashboard(columns); }

  // Status message if any
  if (statusMessage) {
    output += `${YELLOW} ${statusMessage}${RESET}${CLR_LINE}\n`;
    statusMessage = '';
  }

  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  // Calculate grid
  const totalRows = Math.ceil(processes.length / cardsPerRow);
  const headerLines = 6 + (showDashboard ? 2 : 0); // header box (3) + stats + dashboard + separator + status
  const footerLines = 2; // separator + keys (pinned to bottom)
  const paneLogHeight = showLogPane ? Math.max(5, Math.floor(rows * 0.4)) : 0;
  const availableSpace = rows - headerLines - footerLines - paneLogHeight;
  // Last card row doesn't need gap after it, so add cardGapY back once
  const maxVisibleCardRows = Math.max(1, Math.floor((availableSpace + cardGapY) / (cardHeight + cardGapY)));

  // Scroll offset to keep selected row visible
  const scrollRow = Math.max(0, paneRow - Math.floor(maxVisibleCardRows / 2));
  const endRow = Math.min(totalRows, scrollRow + maxVisibleCardRows);

  if (processes.length === 0) {
    output += `${CLR_LINE}\n${DIM}  No Claude Code processes found.${RESET}${CLR_LINE}\n`;
  }

  for (let r = scrollRow; r < endRow; r++) {
    // Build each line of the card row
    const rowCards = [];
    for (let c = 0; c < cardsPerRow; c++) {
      const idx = r * cardsPerRow + c;
      if (idx < processes.length) {
        rowCards.push({ proc: processes[idx], idx });
      }
    }

    // Render 5 lines for this row of cards
    for (let line = 0; line < cardHeight; line++) {
      let lineStr = '';
      for (let ci = 0; ci < rowCards.length; ci++) {
        const { proc, idx } = rowCards[ci];
        const isSelected = idx === selectedIndex;
        const selStart = isSelected ? `${THEME.selection}${WHITE}${BOLD}` : '';
        const selEnd = isSelected ? RESET : RESET;

        let cell = '';
        if (line === 0) {
          // Top border
          cell = `${selStart}┌${'─'.repeat(cardWidth - 2)}┐${selEnd}`;
        } else if (line === cardHeight - 1) {
          // Bottom border
          cell = `${selStart}└${'─'.repeat(cardWidth - 2)}┘${selEnd}`;
        } else {
          // Content lines
          let content = '';
          const inner = cardWidth - 4; // 2 for borders, 2 for padding
          if (line === 1) {
            // PID + Status
            let statusColor = isSelected ? '' : THEME.active;
            if (proc.isZombie) statusColor = isSelected ? '' : THEME.zombie;
            else if (proc.isStopped) statusColor = isSelected ? '' : THEME.stopped;
            else if (!proc.isActive) statusColor = isSelected ? '' : THEME.sleeping;
            const statusDot = proc.isActive ? '●' : proc.isZombie ? '✗' : '○';
            const pidPart = `PID:${proc.pid}`;
            const statusPart = `${statusDot} ${proc.status}`;
            const gap = inner - pidPart.length - proc.status.length - 2; // 2 for dot+space
            content = `${selStart}│ ${pidPart}${' '.repeat(Math.max(1, gap))}${isSelected ? '' : statusColor}${statusPart}${isSelected ? '' : RESET}${selStart} │${selEnd}`;
          } else if (line === 2) {
            // CPU + MEM
            const cpuStr = `CPU:${proc.cpu.toFixed(1)}%`;
            const memStr = `MEM:${proc.mem.toFixed(1)}%`;
            const gap = inner - cpuStr.length - memStr.length;
            content = `${selStart}│ ${cpuStr}${' '.repeat(Math.max(1, gap))}${memStr} │${selEnd}`;
          } else if (line === 3) {
            // Context window
            const ctxPct = proc.contextPct !== null ? proc.contextPct : 100;
            const cc = isSelected ? '' : ctxColor(ctxPct);
            const ctxLabel = `CTX: ${ctxPct}%`;
            const ctxStr = `${cc}${ctxLabel}${isSelected ? '' : RESET}`;
            content = `${selStart}│ ${ctxStr}${' '.repeat(Math.max(0, inner - ctxLabel.length))} │${selEnd}`;
          } else if (line === 4) {
            // Model + Branch
            const m = proc.model ? proc.model.replace(/^claude-/, '') : '--';
            const b = proc.gitBranch || '--';
            const mLen = Math.min(m.length, Math.floor(inner / 2));
            const bLen = Math.min(b.length, inner - mLen - 1);
            const mStr = m.substring(0, mLen);
            const bStr = b.substring(0, bLen);
            const mbGap = inner - mStr.length - bStr.length;
            const mc = isSelected ? '' : THEME.accent;
            const bc = isSelected ? '' : THEME.stopped;
            content = `${selStart}│ ${mc}${mStr}${isSelected ? '' : RESET}${selStart}${' '.repeat(Math.max(1, mbGap))}${bc}${bStr}${isSelected ? '' : RESET}${selStart} │${selEnd}`;
          } else if (line === 5) {
            // Slug
            let slugStr = proc.slug || '--';
            if (slugStr.length > inner) slugStr = slugStr.substring(0, inner - 1) + '…';
            content = `${selStart}│ ${isSelected ? '' : DIM}${slugStr.padEnd(inner)}${isSelected ? '' : RESET}${selStart} │${selEnd}`;
          } else if (line === 6) {
            // Title (truncated)
            let title = proc.title;
            if (title.length > inner) {
              title = title.substring(0, inner - 1) + '…';
            }
            content = `${selStart}│ ${title.padEnd(inner)} │${selEnd}`;
          }
          cell = content;
        }
        lineStr += cell;
        if (ci < rowCards.length - 1) lineStr += ' '.repeat(cardGapX);
      }
      output += lineStr + `${CLR_LINE}\n`;
    }
    // Gap between card rows
    if (r < endRow - 1) output += `${CLR_LINE}\n`;
  }

  // Scrollbar indicator if needed
  if (totalRows > maxVisibleCardRows) {
    output += `${CLR_LINE}\n${DIM}  Showing rows ${scrollRow + 1}-${endRow} of ${totalRows}${RESET}${CLR_LINE}`;
  }

  // Clear any leftover lines between content and footer
  output += CLR_DOWN;

  // Detail pane on the right in pane view too
  const paneDetailWidth = 42;
  const showPaneDetail = columns >= 140;
  if (showPaneDetail && processes[selectedIndex]) {
    const paneStartRow = 5;
    const footerLines = 2;
    const availDetailRows = rows - paneStartRow - footerLines;
    const paneStartCol = columns - paneDetailWidth;
    output += renderDetailPane(processes[selectedIndex], paneStartRow, paneStartCol, paneDetailWidth, availDetailRows);
  }

  // Bottom detail pane for narrow pane view
  if (!showLogPane && !showPaneDetail && processes[selectedIndex]) {
    const cardRows = Math.ceil(processes.length / cardsPerRow);
    const visibleCardRows = Math.min(cardRows, Math.max(1, Math.floor((rows - 6 - 2 + cardGapY) / (cardHeight + cardGapY))));
    const contentEnd = 6 + visibleCardRows * (cardHeight + cardGapY);
    const footerLines = 2;
    const bottomPaneStart = contentEnd + 1;
    const availBottomRows = rows - footerLines - bottomPaneStart;
    if (availBottomRows >= 8) {
      const bottomPaneWidth = Math.min(columns, 80);
      const bottomPaneCol = Math.max(1, Math.floor((columns - bottomPaneWidth) / 2) + 1);
      output += renderDetailPane(processes[selectedIndex], bottomPaneStart, bottomPaneCol, bottomPaneWidth, availBottomRows);
    }
  }

  // Log pane at bottom in pane mode
  if (showLogPane && processes[selectedIndex]) {
    logLines = readSessionLog(processes[selectedIndex]);
    const logStartRow = rows - paneLogHeight - 1;
    logScrollOffset = Math.max(0, logLines.length - (paneLogHeight - 1));
    output += renderLogPane(logStartRow, columns, paneLogHeight, processes[selectedIndex]);
  }

  // Footer pinned to bottom
  output += `${ESC}[${rows - 1};1H`; // move cursor to second-to-last row
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}`;
  output += `${ESC}[${rows};1H`; // move cursor to last row
  output += `${BOLD} KEYS:${RESET} `;
  output += `${CYAN}hjkl${RESET} Nav  `;
  output += `${RED}x${RESET} Kill  ${RED}X${RESET} Force  `;
  output += `${CYAN}o${RESET} Open  `;
  output += `${CYAN}s${RESET} Sort  ${CYAN}/${RESET} Filter  ${CYAN}F${RESET} Search  `;
  output += `${CYAN}L${RESET} Log  ${CYAN}W${RESET} Timeline  ${CYAN}E${RESET} Export  `;
  output += `${CYAN}T${RESET} Theme  ${CYAN}d${RESET} Dash  ${CYAN}H${RESET} History  ${CYAN}C${RESET} Heatmap  ${CYAN}n${RESET} Notif  ${CYAN}P${RESET} List  ${CYAN}r${RESET} Refresh  ${CYAN}q${RESET} Quit  ${CYAN}?${RESET} Help${CLR_LINE}`;

  process.stdout.write(output);
}

// Git diff summary cache and helpers
let gitDiffCache = new Map(); // cwd -> { data, timestamp }
const GIT_DIFF_CACHE_TTL = 10000; // 10 seconds

function parseDiffStat(unstaged, staged, untracked) {
  const parse = (str) => {
    const files = (str.match(/(\d+) file/) || [, 0])[1];
    const ins = (str.match(/(\d+) insertion/) || [, 0])[1];
    const del = (str.match(/(\d+) deletion/) || [, 0])[1];
    return { files: parseInt(files), insertions: parseInt(ins), deletions: parseInt(del) };
  };
  return {
    unstaged: parse(unstaged),
    staged: parse(staged),
    untracked,
  };
}

function parseNumstat(output) {
  // Parse git diff --numstat output: "45\t12\tpath/to/file.js"
  const files = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const ins = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
      const del = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
      const filePath = parts.slice(2).join('\t');
      files.push({ file: filePath, insertions: ins, deletions: del });
    }
  }
  return files;
}

function getGitDiffSummary(cwd) {
  if (!cwd) return null;

  const cached = gitDiffCache.get(cwd);
  if (cached && Date.now() - cached.timestamp < GIT_DIFF_CACHE_TTL) {
    return cached.data;
  }

  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    const diffStat = execSync('git diff --shortstat', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const stagedStat = execSync('git diff --cached --shortstat', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const untracked = execSync('git ls-files --others --exclude-standard | wc -l', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // Get per-file stats
    const numstatOutput = execSync('git diff --numstat', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const stagedNumstatOutput = execSync('git diff --cached --numstat', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const perFile = parseNumstat(numstatOutput);
    const stagedPerFile = parseNumstat(stagedNumstatOutput);
    // Merge staged into perFile (combine if same file)
    for (const sf of stagedPerFile) {
      const existing = perFile.find(f => f.file === sf.file);
      if (existing) {
        existing.insertions += sf.insertions;
        existing.deletions += sf.deletions;
      } else {
        perFile.push(sf);
      }
    }

    const result = parseDiffStat(diffStat, stagedStat, parseInt(untracked) || 0);
    result.files = perFile;
    gitDiffCache.set(cwd, { data: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    gitDiffCache.set(cwd, { data: null, timestamp: Date.now() });
    return null;
  }
}

function renderDetailPane(proc, startRow, paneCol, paneWidth, availRows) {
  if (!proc) return '';
  let output = '';
  const inner = paneWidth - 2; // inside borders

  const drawLine = (row, content) => `${ESC}[${row};${paneCol}H${content}`;

  // Two-column pair row: left label+value and right label+value
  const colW = Math.floor((inner - 2) / 2); // each column width (with 1 padding each side)
  const truncVal = (v, maxLen) => {
    const s = (v || '--').toString();
    return s.length > maxLen ? s.substring(0, maxLen - 1) + '…' : s;
  };
  const pairRow = (row, lbl1, val1, c1, lbl2, val2, c2) => {
    const maxV1 = colW - lbl1.length - 1;
    const maxV2 = lbl2 ? colW - lbl2.length - 1 : 0;
    const v1 = truncVal(val1, Math.max(2, maxV1));
    const v2 = lbl2 ? truncVal(val2, Math.max(2, maxV2)) : '';
    const l1 = `${DIM}${lbl1}${RESET} ${c1 || ''}${v1}${c1 ? RESET : ''}`;
    const l2 = lbl2 ? `${DIM}${lbl2}${RESET} ${c2 || ''}${v2}${c2 ? RESET : ''}` : '';
    const vis1 = lbl1.length + 1 + v1.length;
    const vis2 = lbl2 ? lbl2.length + 1 + v2.length : 0;
    const pad1 = Math.max(1, colW - vis1);
    const pad2 = Math.max(0, colW - vis2);
    return drawLine(row, `${DIM}│${RESET} ${l1}${' '.repeat(pad1)}${l2}${' '.repeat(pad2)} ${DIM}│${RESET}`);
  };

  // Single full-width row
  const fullRow = (row, lbl, val, c) => {
    const maxV = inner - 2 - lbl.length - 1;
    const tv = truncVal(val, Math.max(2, maxV));
    const vis = lbl.length + 1 + tv.length;
    const pad = Math.max(0, inner - 2 - vis);
    return drawLine(row, `${DIM}│${RESET} ${DIM}${lbl}${RESET} ${c || ''}${tv}${c ? RESET : ''}${' '.repeat(pad)} ${DIM}│${RESET}`);
  };

  let r = startRow;

  // Top border
  const heading = ' Session Detail ';
  const bLen = paneWidth - 2 - heading.length;
  output += drawLine(r++, `${DIM}┌${'─'.repeat(Math.floor(bLen / 2))}${RESET}${BOLD}${CYAN}${heading}${RESET}${DIM}${'─'.repeat(bLen - Math.floor(bLen / 2))}┐${RESET}`);

  // Status color
  let sc = GREEN;
  if (proc.isZombie) sc = RED;
  else if (proc.isStopped) sc = YELLOW;
  else if (!proc.isActive) sc = DIM;

  // CTX
  const ctxPct = proc.contextPct !== null ? proc.contextPct : 100;
  const cc = ctxColor(ctxPct);

  // Token counts
  const inTok = proc.inputTokens != null ? proc.inputTokens.toLocaleString() : '--';
  const cachCreate = proc.cacheCreateTokens != null ? proc.cacheCreateTokens.toLocaleString() : '--';
  const cachRead = proc.cacheReadTokens != null ? proc.cacheReadTokens.toLocaleString() : '--';
  const outTok = proc.outputTokens != null ? proc.outputTokens.toLocaleString() : '--';
  const turnMs = proc.lastTurnMs != null ? (proc.lastTurnMs / 1000).toFixed(1) + 's' : '--';

  // Directory shortened
  let dir = proc.cwd || '--';
  if (dir.startsWith(os.homedir())) dir = '~' + dir.substring(os.homedir().length);

  // Row pairs
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'PID:', proc.pid, CYAN, 'Status:', proc.status, sc);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'CTX:', ctxPct + '%', cc, 'Model:', (proc.model || '--').replace(/^claude-/, ''), CYAN);
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Branch:', proc.gitBranch || '--', YELLOW);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Started:', proc.startTime, '', 'CPU:', proc.cpu.toFixed(1) + '%', proc.cpu > 50 ? RED : proc.cpu > 20 ? YELLOW : '');
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'MEM:', proc.mem.toFixed(1) + '%', '', 'Stat:', proc.stat, DIM);

  // Sparklines in detail pane
  if (processHistory.has(proc.pid) && r < startRow + availRows - 1) {
    const hist = processHistory.get(proc.pid);
    const sparkW = Math.min(20, inner - 12);
    const cpuSpark = renderSparkline(hist.cpu, sparkW);
    const memSpark = renderSparkline(hist.mem, sparkW);
    if (cpuSpark) {
      output += fullRow(r++, 'CPU:', cpuSpark, YELLOW);
    }
    if (memSpark && r < startRow + availRows - 1) {
      output += fullRow(r++, 'MEM:', memSpark, CYAN);
    }
  }

  // Separator
  if (r < startRow + availRows - 1)
    output += drawLine(r++, `${DIM}├${'─'.repeat(paneWidth - 2)}┤${RESET}`);

  // Token details
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'In:', inTok, '', 'Out:', outTok, GREEN);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Cache W:', cachCreate, '', 'Cache R:', cachRead, '');
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Turn:', turnMs, '', 'Stop:', proc.stopReason || '--', DIM);

  // Cost row
  if (r < startRow + availRows - 1) {
    const costStr = formatCost(proc.cost);
    let costColor = GREEN;
    if (proc.cost !== null && proc.cost > 5) costColor = RED;
    else if (proc.cost !== null && proc.cost >= 1) costColor = YELLOW;
    output += fullRow(r++, 'Cost:', costStr, costColor);
  }

  // Context bar
  const CTX_LIMIT = CONFIG.contextLimit;
  const hasTokens = proc.inputTokens != null;
  if (hasTokens && r + 5 < startRow + availRows - 1) {
    const barHeading = ' Context Window ';
    const bhLen = paneWidth - 2 - barHeading.length;
    output += drawLine(r++, `${DIM}├${'─'.repeat(Math.floor(bhLen / 2))}${RESET}${BOLD}${CYAN}${barHeading}${RESET}${DIM}${'─'.repeat(bhLen - Math.floor(bhLen / 2))}┤${RESET}`);

    const barW = inner - 2;
    const inp = proc.inputTokens || 0;
    const cw = proc.cacheCreateTokens || 0;
    const cr = proc.cacheReadTokens || 0;
    const out = proc.outputTokens || 0;
    const used = inp + cw + cr;
    const free = Math.max(0, CTX_LIMIT - used);

    let bar;
    const legendChar = CONFIG.contextBarStyle === 'braille' ? '\u28FF' : '\u2588';
    const freeChar = CONFIG.contextBarStyle === 'braille' ? '\u2800' : '\u2591';

    if (CONFIG.contextBarStyle === 'braille') {
      const result = renderContextBarBraille(proc, barW);
      bar = result.bar;
    } else {
      // Block character rendering (original)
      const seg = (v) => Math.max(v > 0 ? 1 : 0, Math.round(v / CTX_LIMIT * barW));
      let sInp = seg(inp);
      let sCw = seg(cw);
      let sCr = seg(cr);
      let sOut = seg(out);
      let sFree = seg(free);
      // Adjust to exactly barW
      let total = sInp + sCw + sCr + sOut + sFree;
      if (total > barW) sFree = Math.max(0, sFree - (total - barW));
      else if (total < barW) sFree += (barW - total);

      bar = `${GREEN}${'█'.repeat(sInp)}${RESET}` +
            `${BLUE}${'█'.repeat(sCw)}${RESET}` +
            `${CYAN}${'█'.repeat(sCr)}${RESET}` +
            `${YELLOW}${'█'.repeat(sOut)}${RESET}` +
            `${DIM}${'░'.repeat(sFree)}${RESET}`;
    }
    output += drawLine(r++, `${DIM}│${RESET} ${bar} ${DIM}│${RESET}`);

    // Legend rows
    const pct = (v) => (v / CTX_LIMIT * 100).toFixed(0) + '%';
    const lPad = (s, w) => s.length >= w ? s.substring(0, w) : s + ' '.repeat(w - s.length);
    const legendW = Math.floor((inner - 2) / 2);
    // Row 1: input + cache write
    const l1a = `${GREEN}${legendChar}${RESET} ${DIM}Input${RESET} ${pct(inp)}`;
    const l1b = `${BLUE}${legendChar}${RESET} ${DIM}Cache W${RESET} ${pct(cw)}`;
    const l1aVis = 8 + pct(inp).length;
    const l1bVis = 10 + pct(cw).length;
    output += drawLine(r++, `${DIM}│${RESET} ${l1a}${' '.repeat(Math.max(1, inner - 2 - l1aVis - l1bVis))}${l1b} ${DIM}│${RESET}`);
    // Row 2: cache read + output
    const l2a = `${CYAN}${legendChar}${RESET} ${DIM}Cache R${RESET} ${pct(cr)}`;
    const l2b = `${YELLOW}${legendChar}${RESET} ${DIM}Output${RESET} ${pct(out)}`;
    const l2aVis = 10 + pct(cr).length;
    const l2bVis = 9 + pct(out).length;
    output += drawLine(r++, `${DIM}│${RESET} ${l2a}${' '.repeat(Math.max(1, inner - 2 - l2aVis - l2bVis))}${l2b} ${DIM}│${RESET}`);
    // Row 3: free
    const l3 = `${DIM}${freeChar} Free ${pct(free)}${RESET}`;
    const l3Vis = 7 + pct(free).length;
    output += drawLine(r++, `${DIM}│${RESET} ${l3}${' '.repeat(Math.max(0, inner - 2 - l3Vis))} ${DIM}│${RESET}`);
  }

  // Separator
  if (r < startRow + availRows - 1)
    output += drawLine(r++, `${DIM}├${'─'.repeat(paneWidth - 2)}┤${RESET}`);

  // Full-width rows for longer values
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Slug:', proc.slug || '--', DIM);
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Session:', proc.sessionId ? proc.sessionId.substring(0, inner - 12) : '--', DIM);
  if (r < startRow + availRows - 1) {
    const maxDir = inner - 6;
    const dirDisplay = dir.length > maxDir ? '...' + dir.substring(dir.length - maxDir + 3) : dir;
    output += fullRow(r++, 'Dir:', dirDisplay, DIM);
  }

  // Git diff summary
  const gitDiff = getGitDiffSummary(proc.cwd);
  if (gitDiff && r < startRow + availRows - 1) {
    const gitHeading = ' Git Changes ';
    const ghLen = paneWidth - 2 - gitHeading.length;
    output += drawLine(r++, `${DIM}├${'─'.repeat(Math.floor(ghLen / 2))}${RESET}${BOLD}${CYAN}${gitHeading}${RESET}${DIM}${'─'.repeat(ghLen - Math.floor(ghLen / 2))}┤${RESET}`);
    if (r < startRow + availRows - 1) {
      const totalFiles = gitDiff.unstaged.files + gitDiff.staged.files;
      const totalIns = gitDiff.unstaged.insertions + gitDiff.staged.insertions;
      const totalDel = gitDiff.unstaged.deletions + gitDiff.staged.deletions;
      let parts = [];
      if (totalFiles > 0) parts.push(`${totalFiles} file${totalFiles !== 1 ? 's' : ''}`);
      if (totalIns > 0) parts.push(`${GREEN}+${totalIns}${RESET}`);
      if (totalDel > 0) parts.push(`${RED}-${totalDel}${RESET}`);
      if (gitDiff.untracked > 0) parts.push(`${DIM}(${gitDiff.untracked} new)${RESET}`);
      const gitStr = parts.length > 0 ? parts.join('  ') : 'clean';
      const visLen = gitStr.replace(/\x1b\[[0-9;]*m/g, '').length;
      const gitLabel = 'Total:';
      const totalVis = gitLabel.length + 1 + visLen;
      const pad = Math.max(0, inner - 2 - totalVis);
      output += drawLine(r++, `${DIM}│${RESET} ${DIM}${gitLabel}${RESET} ${gitStr}${' '.repeat(pad)} ${DIM}│${RESET}`);
    }
    // Per-file table when there's room
    if (gitDiff.files && gitDiff.files.length > 0 && r + 2 < startRow + availRows - 1) {
      const maxFileRows = Math.min(gitDiff.files.length, startRow + availRows - 1 - r - 1);
      for (let fi = 0; fi < maxFileRows; fi++) {
        const f = gitDiff.files[fi];
        const fname = f.file.length > inner - 18 ? '…' + f.file.slice(-(inner - 19)) : f.file;
        const insStr = f.insertions > 0 ? `${GREEN}+${f.insertions}${RESET}` : `${DIM}+0${RESET}`;
        const delStr = f.deletions > 0 ? `${RED}-${f.deletions}${RESET}` : `${DIM}-0${RESET}`;
        const statsStr = `${insStr} ${delStr}`;
        const statsVisLen = `+${f.insertions} -${f.deletions}`.length;
        const gap = Math.max(1, inner - 2 - fname.length - statsVisLen);
        output += drawLine(r++, `${DIM}│${RESET} ${DIM}${fname}${RESET}${' '.repeat(gap)}${statsStr} ${DIM}│${RESET}`);
      }
      if (gitDiff.files.length > maxFileRows && r < startRow + availRows - 1) {
        const moreStr = `…${gitDiff.files.length - maxFileRows} more`;
        output += drawLine(r++, `${DIM}│ ${moreStr}${' '.repeat(Math.max(0, inner - 2 - moreStr.length))} │${RESET}`);
      }
    }
  }

  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Ver:', proc.version || '--', DIM, 'Tier:', proc.serviceTier || '--', DIM);
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Time:', proc.timestamp || '--', DIM);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Stat:', proc.stat, DIM, 'Type:', proc.userType || '--', DIM);

  // Search matches section
  if (searchQuery && searchResults.has(proc.pid)) {
    const snippets = searchResults.get(proc.pid);
    if (r < startRow + availRows - 1) {
      const matchHeading = ' Search Matches ';
      const mhLen = paneWidth - 2 - matchHeading.length;
      output += drawLine(r++, `${DIM}├${'─'.repeat(Math.floor(mhLen / 2))}${RESET}${BOLD}${GREEN}${matchHeading}${RESET}${DIM}${'─'.repeat(mhLen - Math.floor(mhLen / 2))}┤${RESET}`);
    }
    for (let si = 0; si < snippets.length && r < startRow + availRows - 1; si++) {
      let snip = snippets[si].replace(/\n/g, ' ');
      const maxSnipLen = inner - 4;
      if (snip.length > maxSnipLen) snip = snip.substring(0, maxSnipLen - 1) + '…';
      const pad = Math.max(0, inner - 2 - snip.length - 2);
      output += drawLine(r++, `${DIM}│${RESET} ${GREEN}▸${RESET} ${snip}${' '.repeat(pad)} ${DIM}│${RESET}`);
    }
  }

  // Plugin detail rows
  const pluginsWithDetails = plugins.filter(p => typeof p.detailRows === 'function');
  if (pluginsWithDetails.length > 0) {
    for (const p of pluginsWithDetails) {
      let rows2 = [];
      try { rows2 = p.detailRows(proc) || []; } catch (e) {}
      if (rows2.length > 0 && r < startRow + availRows - 1) {
        const pluginHeading = ` ${p.name || 'Plugin'} `;
        const phLen = paneWidth - 2 - pluginHeading.length;
        output += drawLine(r++, `${DIM}├${'─'.repeat(Math.floor(phLen / 2))}${RESET}${BOLD}${CYAN}${pluginHeading}${RESET}${DIM}${'─'.repeat(phLen - Math.floor(phLen / 2))}┤${RESET}`);
      }
      for (const row of rows2) {
        if (r >= startRow + availRows - 1) break;
        output += fullRow(r++, (row.label || '') + ':', row.value || '--', row.color || '');
      }
    }
  }

  // Fill remaining
  while (r < startRow + availRows - 1) {
    output += drawLine(r++, `${DIM}│${' '.repeat(paneWidth - 2)}│${RESET}`);
  }

  // Bottom border
  output += drawLine(r, `${DIM}└${'─'.repeat(paneWidth - 2)}┘${RESET}`);

  return output;
}

function renderLogPane(startRow, paneWidth, paneHeight, proc) {
  if (!proc || paneHeight < 3) return '';
  let output = '';

  // Header separator
  const heading = ` Session Log (PID: ${proc.pid}) `;
  const hLen = paneWidth - heading.length;
  const leftDash = Math.floor(hLen / 2);
  const rightDash = hLen - leftDash;
  output += `${ESC}[${startRow};1H${DIM}${'─'.repeat(Math.max(0, leftDash))}${RESET}${BOLD}${CYAN}${heading}${RESET}${DIM}${'─'.repeat(Math.max(0, rightDash))}${RESET}${CLR_LINE}`;

  const contentRows = paneHeight - 1; // 1 for header
  if (contentRows <= 0) return output;

  // Determine visible slice with scroll offset
  const totalLines = logLines.length;
  const maxScroll = Math.max(0, totalLines - contentRows);
  if (logScrollOffset > maxScroll) logScrollOffset = maxScroll;
  if (logScrollOffset < 0) logScrollOffset = 0;

  const visStart = logScrollOffset;
  const visEnd = Math.min(totalLines, visStart + contentRows);

  for (let row = 0; row < contentRows; row++) {
    const lineIdx = visStart + row;
    const r = startRow + 1 + row;
    output += `${ESC}[${r};1H`;

    if (lineIdx < totalLines) {
      const entry = logLines[lineIdx];
      const color = entry.role === 'user' ? CYAN : GREEN;
      // Truncate line to terminal width
      let displayText = entry.text;
      if (displayText.length > paneWidth - 2) {
        displayText = displayText.substring(0, paneWidth - 5) + '...';
      }
      output += ` ${color}${displayText}${RESET}${CLR_LINE}`;
    } else {
      output += `${CLR_LINE}`;
    }
  }

  return output;
}

function render() {
  if (showTimeline && processes[selectedIndex]) {
    const { columns, rows } = process.stdout;
    return renderTimeline(processes[selectedIndex], columns, rows);
  }
  if (viewMode === 'pane') return renderPaneMode();
  const { columns, rows } = process.stdout;
  const detailPaneWidth = 42;
  const showDetailPane = columns >= 140;
  const listWidth = showDetailPane ? columns - detailPaneWidth - 1 : columns;

  // Auto-show log pane when terminal is tall enough (unless user manually toggled)
  if (!logPaneManualToggle) {
    showLogPane = rows >= 40;
  }
  // Auto-show dashboard when terminal is tall enough
  if (!dashboardManualToggle) {
    showDashboard = rows >= 40;
  }

  let output = HOME + HIDE_CURSOR;

  // Header
  output += renderHeader(columns);

  // Stats bar
  const activeCount = allProcesses.filter(p => p.isActive).length;
  const deadCount = allProcesses.filter(p => !p.isActive).length;
  const totalCost = allProcesses.reduce((sum, p) => sum + (p.cost || 0), 0);
  let statsLine = `${DIM} Active: ${RESET}${GREEN}${activeCount}${RESET}${DIM} | Dead/Stopped: ${RESET}${RED}${deadCount}${RESET}`;
  let totalCostColor = GREEN;
  if (totalCost > 5) totalCostColor = RED;
  else if (totalCost >= 1) totalCostColor = YELLOW;
  statsLine += `${DIM} | Total Cost: ${RESET}${totalCostColor}${formatCost(totalCost > 0 ? totalCost : null)}${RESET}`;
  if (sortMode !== 'age') statsLine += `${DIM} | Sort: ${RESET}${CYAN}${sortMode}${sortReverse ? ' ↑' : ''}${RESET}`;
  if (filterText) statsLine += `${DIM} | Filter: ${RESET}${YELLOW}"${filterText}"${RESET}${DIM} (${processes.length}/${allProcesses.length})${RESET}`;
  if (filterInput) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} /${filterText}█ ${RESET}`;
  if (searchMode) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} Search: ${searchQuery}█ ${RESET}`;
  else if (searchQuery) statsLine += `${DIM} | Search: ${RESET}${YELLOW}"${searchQuery}"${RESET}${DIM} (${searchResults.size} matches)${RESET}`;
  const notifLabel2 = notificationsEnabled ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  statsLine += `${DIM} | Notif: ${RESET}${notifLabel2}`;
  statsLine += `${DIM} | ${lastRefresh.toLocaleTimeString()} ${RESET}`;
  output += statsLine + `${CLR_LINE}\n`;

  if (showDashboard) { output += renderDashboard(columns); }

  // Status message if any
  if (statusMessage) {
    output += `${YELLOW} ${statusMessage}${RESET}${CLR_LINE}\n`;
    statusMessage = '';
  }

  output += `${DIM}${'─'.repeat(listWidth)}${RESET}${CLR_LINE}\n`;

  // Column headers - responsive based on width
  const ctxBarMode = listWidth >= 160;
  const ctxColW = ctxBarMode ? 16 : 6;
  const isNarrow = listWidth < 120;
  const showCostCol = listWidth >= 140;
  const costColW = 9;
  const sparkColW = 10; // 8 chars sparkline + 2 padding
  const showSparklines = columns >= 180;
  // Plugin columns — extra width from loaded plugins
  const pluginCols = plugins.filter(p => p.column);
  const pluginColsWidth = pluginCols.reduce((sum, p) => sum + (p.column.width || 10), 0);
  // In narrow mode: PID(8) + STATUS(10) + CTX(6) + STARTED(12) + MODEL(14) + CPU%(7) + MEM%(5) + pad(2) = 64
  // In wide mode: full columns with BRANCH, SLUG, DIRECTORY, and optionally COST + sparklines
  const fixedColsTotal = isNarrow
    ? 8 + 10 + ctxColW + 12 + 14 + 7 + 7 + 2 + pluginColsWidth
    : 8 + 10 + ctxColW + 12 + 32 + 22 + 14 + (showCostCol ? costColW : 0) + pluginColsWidth + 7 + (showSparklines ? sparkColW : 0) + 7 + (showSparklines ? sparkColW : 0) + 2;
  output += `${BOLD}${CYAN}`;
  if (isNarrow) {
    output += `  ${'PID'.padEnd(8)}${'STATUS'.padEnd(10)}${'CTX'.padEnd(ctxColW)}${'STARTED'.padEnd(12)}${'MODEL'.padEnd(14)}`;
    for (const p of pluginCols) output += `${(p.column.header || '').padEnd(p.column.width || 10)}`;
    output += `${'CPU%'.padEnd(7)}MEM%`;
  } else {
    output += `  ${'PID'.padEnd(8)}${'STATUS'.padEnd(10)}${'CTX'.padEnd(ctxColW)}${'STARTED'.padEnd(12)}${'BRANCH'.padEnd(32)}${'SLUG'.padEnd(22)}${'MODEL'.padEnd(14)}`;
    if (showCostCol) output += `${'COST'.padEnd(costColW)}`;
    for (const p of pluginCols) output += `${(p.column.header || '').padEnd(p.column.width || 10)}`;
    output += `${'DIRECTORY'.padEnd(Math.max(0, listWidth - fixedColsTotal))}${'CPU%'.padEnd(7)}`;
    if (showSparklines) output += `${'CPU-HIST'.padEnd(sparkColW)}`;
    output += `${'MEM%'.padEnd(7)}`;
    if (showSparklines) output += `${'MEM-HIST'.padEnd(sparkColW)}`;
  }
  output += `${RESET}${CLR_LINE}\n`;
  output += `${DIM}${'─'.repeat(listWidth)}${RESET}${CLR_LINE}\n`;

  // Process list
  // Header: 3 (header box) + 1 (stats) + 1 (separator) + 1 (col headers) + 1 (separator) = 7
  // Footer: 2 (separator + keys, pinned to bottom)
  // Reserve 1 extra for selected item detail line
  const logPaneHeight = showLogPane ? Math.max(5, Math.floor(rows * 0.4)) : 0;
  const maxVisible = rows - 10 - (showDashboard ? 2 : 0) - logPaneHeight;
  const startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  const endIdx = Math.min(processes.length, startIdx + maxVisible);

  if (processes.length === 0) {
    output += `${CLR_LINE}\n${DIM}  No Claude Code processes found.${RESET}${CLR_LINE}\n`;
  }

  for (let i = startIdx; i < endIdx; i++) {
    const proc = processes[i];
    const isSelected = i === selectedIndex;

    // Selection indicator and styling
    const hasSearchMatch = searchQuery && searchResults.has(proc.pid);
    if (isSelected) {
      output += `${THEME.selection}${WHITE}${BOLD}> `;
    } else if (hasSearchMatch) {
      output += `${THEME.active}* ${RESET}`;
    } else {
      output += '  ';
    }

    // PID
    output += `${isSelected ? '' : THEME.accent}${proc.pid.padEnd(8)}`;

    // Status
    let stClr = THEME.active;
    if (proc.isZombie) stClr = THEME.zombie;
    else if (proc.isStopped) stClr = THEME.stopped;
    else if (!proc.isActive) stClr = THEME.sleeping;
    output += `${isSelected ? '' : stClr}${proc.status.padEnd(10)}${isSelected ? '' : RESET}`;

    // CTX LEFT
    const ctxPct = proc.contextPct !== null ? proc.contextPct : 100;
    if (ctxBarMode) {
      // Loading bar mode: 10-char bar + space + 4-char pct + 1 space = 16
      const barLen = 10;
      if (CONFIG.contextBarStyle === 'braille') {
        // Braille bar: sub-character precision
        const filledValue = ctxPct / 100;
        const freeValue = 1 - filledValue;
        const cc = isSelected ? '' : ctxColor(ctxPct);
        const ccEnd = isSelected ? '' : RESET;
        const brailleBar = renderBrailleBar(
          [{ value: filledValue, color: cc || '' }, { value: freeValue, color: DIM }],
          barLen
        );
        output += `${brailleBar}${ccEnd} ${cc}${(ctxPct + '%').padStart(4)}${ccEnd} `;
      } else {
        const filled = Math.round(ctxPct / 100 * barLen);
        const empty = barLen - filled;
        if (isSelected) {
          output += `${'█'.repeat(filled)}${'░'.repeat(empty)} ${(ctxPct + '%').padStart(4)} `;
        } else {
          const cc = ctxColor(ctxPct);
          output += `${cc}${'█'.repeat(filled)}${RESET}${DIM}${'░'.repeat(empty)}${RESET} ${cc}${(ctxPct + '%').padStart(4)}${RESET} `;
        }
      }
    } else {
      if (!isSelected) output += ctxColor(ctxPct);
      output += `${(ctxPct + '%').padEnd(6)}`;
      if (!isSelected) output += RESET;
    }

    // Started
    output += `${proc.startTime.padEnd(12)}`;

    if (!isNarrow) {
      // Branch
      const branchStr = proc.gitBranch || '--';
      output += `${isSelected ? '' : THEME.stopped}${branchStr.substring(0, 31).padEnd(32)}${isSelected ? '' : RESET}`;

      // Slug
      const slugStr = proc.slug || '--';
      output += `${isSelected ? '' : THEME.border}${slugStr.substring(0, 21).padEnd(22)}${isSelected ? '' : RESET}`;
    }

    // Model
    const modelStr = proc.model ? proc.model.replace(/^claude-/, '') : '--';
    output += `${isSelected ? '' : THEME.accent}${modelStr.substring(0, 13).padEnd(14)}${isSelected ? '' : RESET}`;

    // Cost column (wide mode only)
    if (showCostCol && !isNarrow) {
      const costStr = formatCost(proc.cost);
      if (!isSelected) {
        if (proc.cost !== null && proc.cost > 5) output += THEME.zombie;
        else if (proc.cost !== null && proc.cost >= 1) output += THEME.stopped;
        else output += THEME.cost;
      }
      output += `${costStr.padEnd(costColW)}`;
      if (!isSelected) output += RESET;
    }

    // Plugin columns
    for (const p of pluginCols) {
      const w = p.column.width || 10;
      let val = '--';
      try { val = String(p.column.getValue(proc) || '--'); } catch (e) {}
      let color = '';
      if (p.column.getColor && !isSelected) {
        try { color = p.column.getColor(proc) || ''; } catch (e) {}
      }
      if (color) output += color;
      output += `${val.substring(0, w - 1).padEnd(w)}`;
      if (color) output += RESET;
    }

    if (!isNarrow) {
      // Directory
      const dirMaxLen = listWidth - fixedColsTotal;
      let dir = proc.cwd || '';
      if (dir.startsWith(os.homedir())) {
        dir = '~' + dir.substring(os.homedir().length);
      }
      if (dir.length > dirMaxLen) {
        dir = '...' + dir.substring(dir.length - dirMaxLen + 3);
      }
      output += `${isSelected ? '' : DIM}${dir.padEnd(Math.max(0, dirMaxLen))}${isSelected ? '' : RESET}`;
    }

    // CPU%
    const cpuStr = proc.cpu.toFixed(1);
    if (!isSelected) {
      if (proc.cpu > 50) output += RED;
      else if (proc.cpu > 20) output += YELLOW;
    }
    output += `${cpuStr.padEnd(7)}`;
    if (!isSelected) output += RESET;

    // CPU sparkline
    if (showSparklines) {
      const cpuHist = processHistory.has(proc.pid) ? processHistory.get(proc.pid).cpu : [];
      output += `${isSelected ? '' : YELLOW}${renderSparkline(cpuHist, 8).padEnd(sparkColW)}${isSelected ? '' : RESET}`;
    }

    // MEM%
    if (showSparklines) {
      output += `${proc.mem.toFixed(1).padEnd(7)}`;
    } else {
      output += `${proc.mem.toFixed(1)}`;
    }

    // MEM sparkline
    if (showSparklines) {
      const memHist = processHistory.has(proc.pid) ? processHistory.get(proc.pid).mem : [];
      output += `${isSelected ? '' : CYAN}${renderSparkline(memHist, 8).padEnd(sparkColW)}${isSelected ? '' : RESET}`;
    }

    output += `${isSelected ? RESET : ''}${CLR_LINE}\n`;

    // Show model + stopReason on detail line for selected item (only when no detail pane)
    if (!showDetailPane && isSelected && (proc.model || proc.stopReason)) {
      let detail = '   ';
      if (proc.model) detail += ` ${CYAN}${proc.model}${RESET}`;
      if (proc.stopReason) detail += `  ${DIM}stop: ${proc.stopReason}${RESET}`;
      output += `${detail}${CLR_LINE}\n`;
    }
  }

  // Scrollbar indicator if needed
  if (processes.length > maxVisible) {
    output += `${CLR_LINE}\n${DIM}  Showing ${startIdx + 1}-${endIdx} of ${processes.length} processes${RESET}${CLR_LINE}`;
  }

  // Clear any leftover lines between content and footer
  output += CLR_DOWN;

  // Render detail pane on the right if terminal is wide enough
  if (showDetailPane && processes[selectedIndex]) {
    const paneStartRow = 5; // right after header box (3 lines) + stats line
    const footerLines = 2;
    const availRows = rows - paneStartRow - footerLines;
    const paneStartCol = listWidth + 2;
    output += renderDetailPane(processes[selectedIndex], paneStartRow, paneStartCol, detailPaneWidth, availRows);
  }

  // Bottom detail pane for narrow terminals
  if (!showLogPane && !showDetailPane && processes[selectedIndex]) {
    // Calculate how many content lines we used
    const headerLines = 8; // header(3) + stats(1) + status?(0-1) + separator(1) + colheader(1) + separator(1)
    const listLines = endIdx - startIdx + (processes.length > maxVisible ? 1 : 0);
    // Account for the inline detail line
    let extraLines = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (i === selectedIndex && (processes[i].model || processes[i].stopReason)) extraLines++;
    }
    const contentEnd = headerLines + listLines + extraLines;
    const footerLines = 2;
    const bottomPaneStart = contentEnd + 1;
    const availBottomRows = rows - footerLines - bottomPaneStart;
    if (availBottomRows >= 8) {
      // Render a full-width bottom detail pane
      const bottomPaneWidth = Math.min(columns, 80);
      const bottomPaneCol = Math.max(1, Math.floor((columns - bottomPaneWidth) / 2) + 1);
      output += renderDetailPane(processes[selectedIndex], bottomPaneStart, bottomPaneCol, bottomPaneWidth, availBottomRows);
    }
  }

  // Log pane at bottom
  if (showLogPane && processes[selectedIndex]) {
    // Refresh log content for selected process
    logLines = readSessionLog(processes[selectedIndex]);
    // Auto-scroll to bottom
    const logStartRow = rows - logPaneHeight - 1; // -1 for footer separator
    logScrollOffset = Math.max(0, logLines.length - (logPaneHeight - 1));
    output += renderLogPane(logStartRow, columns, logPaneHeight, processes[selectedIndex]);
  }

  // Footer pinned to bottom
  output += `${ESC}[${rows - 1};1H`;
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}`;
  output += `${ESC}[${rows};1H`;
  output += `${BOLD} KEYS:${RESET} `;
  output += `${CYAN}jk${RESET} Nav  `;
  output += `${RED}x${RESET} Kill  ${RED}X${RESET} Force  `;
  output += `${CYAN}o${RESET} Open  `;
  output += `${CYAN}s${RESET} Sort  ${CYAN}/${RESET} Filter  ${CYAN}F${RESET} Search  `;
  output += `${CYAN}L${RESET} Log  ${CYAN}W${RESET} Timeline  ${CYAN}E${RESET} Export  `;
  output += `${CYAN}T${RESET} Theme  ${CYAN}d${RESET} Dash  ${CYAN}H${RESET} History  ${CYAN}C${RESET} Heatmap  ${CYAN}n${RESET} Notif  ${CYAN}P${RESET} Pane  ${CYAN}r${RESET} Refresh  ${CYAN}q${RESET} Quit  ${CYAN}?${RESET} Help${CLR_LINE}`;

  process.stdout.write(output);
}

function openDirectory(cwd, mode) {
  // Validate cwd
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
      } else if (IS_WIN) {
        command = 'explorer';
        args = [cwd];
      } else {
        command = 'xdg-open';
        args = [cwd];
      }
      message = `Opened ${cwd}`;
      break;

    case 'editor': {
      // Use $EDITOR if it's a GUI editor, otherwise default to 'code'
      const editor = process.env.EDITOR || 'code';
      // For GUI editors (code, cursor, subl, atom, zed, idea), spawn directly
      // For terminal editors (vim, nvim, nano, emacs), open in a new terminal window
      const terminalEditors = ['vim', 'nvim', 'vi', 'nano', 'emacs', 'pico', 'joe', 'micro'];
      const editorBase = path.basename(editor);
      if (terminalEditors.includes(editorBase) && IS_MAC) {
        command = 'open';
        args = ['-a', 'Terminal', cwd];
      } else if (terminalEditors.includes(editorBase) && IS_LINUX) {
        command = 'x-terminal-emulator';
        args = ['-e', `${editor} ${cwd}`];
      } else {
        command = editor;
        args = [cwd];
      }
      message = `Opened in editor (${editorBase}): ${cwd}`;
      break;
    }

    case 'terminal':
      if (IS_MAC) {
        // Use 'open' command which works with whatever default terminal the user has
        command = 'open';
        args = ['-a', 'Terminal', cwd];
      } else if (IS_WIN) {
        command = 'cmd';
        args = ['/c', 'start', 'cmd', '/k', `cd /d ${cwd}`];
      } else {
        // Try x-terminal-emulator (Debian/Ubuntu default), then gnome-terminal, then xterm
        try {
          execSync('which x-terminal-emulator', { stdio: 'pipe' });
          command = 'x-terminal-emulator';
          args = ['--working-directory=' + cwd];
        } catch {
          try {
            execSync('which gnome-terminal', { stdio: 'pipe' });
            command = 'gnome-terminal';
            args = ['--working-directory=' + cwd];
          } catch {
            command = 'xterm';
            args = ['-e', `cd ${cwd} && ${process.env.SHELL || '/bin/sh'}`];
          }
        }
      }
      message = `Opened terminal in ${cwd}`;
      break;

    default:
      return { error: `Unknown mode: ${mode}` };
  }

  return { command, args, message };
}

function execOpenDirectory(cwd, mode) {
  const result = openDirectory(cwd, mode);
  if (result.error) {
    statusMessage = result.error;
    return;
  }
  try {
    const child = spawn(result.command, result.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    statusMessage = result.message;
  } catch (e) {
    statusMessage = `Failed to open: ${e.message}`;
  }
}

function buildKillCommand(pid, force = false) {
  if (IS_WIN) {
    return `taskkill ${force ? '/F ' : ''}/PID ${pid}`;
  }
  const signal = force ? 9 : 15;  // SIGKILL=9, SIGTERM=15
  return `kill -${signal} ${pid} 2>&1`;
}

function killProcess(pid, force = false) {
  try {
    execSync(buildKillCommand(pid, force), { encoding: 'utf8' });
    statusMessage = `${force ? 'Force killed' : 'Killed'} process ${pid}`;
    return true;
  } catch (e) {
    if (IS_WIN) {
      // On Windows, taskkill returns non-zero if the process doesn't exist
      statusMessage = `Process ${pid} already terminated or could not be killed`;
      return true;
    }
    // Check if process still exists (Unix)
    try {
      execSync(`kill -0 ${pid} 2>&1`);
      statusMessage = `Failed to kill process ${pid}: ${e.message}`;
      return false;
    } catch (e2) {
      // Process doesn't exist anymore, consider it killed
      statusMessage = `Process ${pid} already terminated`;
      return true;
    }
  }
}

function killAllProcesses(force = false) {
  let killed = 0;
  for (const proc of allProcesses) {
    if (killProcess(proc.pid, force)) {
      killed++;
    }
  }
  return killed;
}

function cycleTheme() {
  const idx = THEME_NAMES.indexOf(currentThemeName);
  const nextIdx = (idx + 1) % THEME_NAMES.length;
  currentThemeName = THEME_NAMES[nextIdx];
  THEME = { ...THEMES[currentThemeName] };
  statusMessage = `Theme: ${currentThemeName}`;
}

function showHistoryView() {
  const { columns } = process.stdout;
  let output = CLEAR;

  output += renderHeader(columns);
  output += '\n';

  output += `${BOLD}${WHITE}  Usage History${RESET}${CLR_LINE}\n`;
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  const history = loadHistory();
  output += renderHistoryChart(history, columns);

  output += `\n${DIM}  Press any key to return...${RESET}`;

  process.stdout.write(output);
}

function scanSessionFilesForHistory() {
  // Scan actual Claude session JSONL files to build historical usage data
  // This captures usage even when CTOP wasn't running
  const results = [];
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeDir)) return results;
    for (const projectDir of fs.readdirSync(claudeDir)) {
      const projectPath = path.join(claudeDir, projectDir);
      let stat;
      try { stat = fs.statSync(projectPath); } catch { continue; }
      if (!stat.isDirectory()) continue;
      let files;
      try { files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const file of files) {
        const fp = path.join(projectPath, file);
        try {
          const fstat = fs.statSync(fp);
          // Use file mtime as session date
          const dateKey = fstat.mtime.toISOString().slice(0, 10);
          // Read last 32KB for usage data
          const fd = fs.openSync(fp, 'r');
          const tailSize = Math.min(32768, fstat.size);
          const buf = Buffer.alloc(tailSize);
          fs.readSync(fd, buf, 0, tailSize, fstat.size - tailSize);
          fs.closeSync(fd);
          const lines = buf.toString('utf8').split('\n').reverse();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.message && data.message.usage) {
                const u = data.message.usage;
                results.push({
                  dateKey,
                  inputTokens: u.input_tokens || 0,
                  outputTokens: u.output_tokens || 0,
                  cacheTokens: (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
                  model: data.message.model || null,
                });
                break; // Only need the last usage entry per file
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}
  return results;
}

let sessionScanCache = null;
let sessionScanCacheTime = 0;

function aggregateHeatmapData(history, metric = 'tokens') {
  const dayMap = new Map();
  const now = new Date();
  // Cover last 12 weeks (84 days)
  const cutoff = new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000);

  // Include data from CTOP history.json
  for (const entry of history) {
    const ts = new Date(entry.timestamp);
    if (ts < cutoff) continue;
    const dateKey = ts.toISOString().slice(0, 10);

    const prev = dayMap.get(dateKey) || 0;
    if (metric === 'tokens') {
      dayMap.set(dateKey, prev + (entry.totalInputTokens || 0) + (entry.totalOutputTokens || 0) + (entry.totalCacheTokens || 0));
    } else if (metric === 'cost') {
      dayMap.set(dateKey, prev + (entry.totalCost || 0));
    } else if (metric === 'sessions') {
      dayMap.set(dateKey, prev + (entry.sessions || 0));
    }
  }

  // Also scan actual session JSONL files for historical coverage
  // Cache for 60 seconds since scanning is expensive
  if (!sessionScanCache || Date.now() - sessionScanCacheTime > 60000) {
    sessionScanCache = scanSessionFilesForHistory();
    sessionScanCacheTime = Date.now();
  }
  for (const entry of sessionScanCache) {
    const entryDate = new Date(entry.dateKey);
    if (entryDate < cutoff) continue;
    const prev = dayMap.get(entry.dateKey) || 0;
    if (metric === 'tokens') {
      dayMap.set(entry.dateKey, prev + entry.inputTokens + entry.outputTokens + entry.cacheTokens);
    } else if (metric === 'cost') {
      // Estimate cost from tokens using sonnet pricing as default
      const cost = (entry.inputTokens * 3 + entry.outputTokens * 15) / 1_000_000;
      dayMap.set(entry.dateKey, prev + cost);
    } else if (metric === 'sessions') {
      dayMap.set(entry.dateKey, prev + 1);
    }
  }

  return dayMap;
}

function getHeatmapColorLevel(value, maxValue) {
  if (value === 0 || maxValue === 0) return 0;
  const ratio = value / maxValue;
  if (ratio <= 0.05) return 0;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.50) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function renderHeatmap(columns, rows) {
  const history = loadHistory();
  const dayMap = aggregateHeatmapData(history, 'tokens');
  const costMap = aggregateHeatmapData(history, 'cost');
  const sessionMap = aggregateHeatmapData(history, 'sessions');

  let output = CLEAR;
  output += renderHeader(columns);
  output += '\n';

  output += `${BOLD}${WHITE}  Usage Heatmap \u2014 Last 12 Weeks${RESET}${CLR_LINE}\n`;
  output += `${DIM}${'─'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  // Build the grid: 12 weeks of columns, 7 day-of-week rows
  const now = new Date();
  const WEEKS = 12;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Find the start: go back to the Monday of (WEEKS) weeks ago
  const todayDow = today.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = todayDow === 0 ? 6 : todayDow - 1; // days since last Monday
  const startDate = new Date(today.getTime() - (mondayOffset + (WEEKS - 1) * 7) * 24 * 60 * 60 * 1000);

  // Build grid[week][day] = value
  const grid = [];
  const dates = [];
  let maxValue = 0;
  for (let w = 0; w < WEEKS; w++) {
    const weekCol = [];
    const weekDates = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startDate.getTime() + (w * 7 + d) * 24 * 60 * 60 * 1000);
      const key = cellDate.toISOString().slice(0, 10);
      const val = dayMap.get(key) || 0;
      if (cellDate <= today) {
        weekCol.push(val);
        if (val > maxValue) maxValue = val;
      } else {
        weekCol.push(-1); // future date
      }
      weekDates.push(cellDate);
    }
    grid.push(weekCol);
    dates.push(weekDates);
  }

  // Color definitions for levels
  const HEATMAP_CHARS = ['\u2591', '\u2592', '\u2593', '\u2588', '\u2588'];
  const HEATMAP_COLORS = [
    DIM,                           // level 0: dim (no/minimal)
    `${ESC}[38;5;22m`,             // level 1: dark green
    `${ESC}[38;5;28m`,             // level 2: green
    `${ESC}[38;5;34m`,             // level 3: bright green
    `${BOLD}${CYAN}`,              // level 4: cyan bold
  ];

  // Day labels (left side)
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayLabelShow = [true, false, true, false, true, false, true]; // Mon, Wed, Fri, Sun

  // Month labels (top)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let monthRow = '      '; // padding for day labels
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const firstDayOfWeek = dates[w][0];
    const month = firstDayOfWeek.getMonth();
    if (month !== lastMonth) {
      monthRow += MONTHS[month].padEnd(2);
      lastMonth = month;
    } else {
      monthRow += '  ';
    }
  }
  output += `${DIM}${monthRow}${RESET}${CLR_LINE}\n`;

  // Render grid rows (one per day of week)
  for (let d = 0; d < 7; d++) {
    let row = '  ';
    if (dayLabelShow[d]) {
      row += `${DIM}${dayLabels[d]}${RESET} `;
    } else {
      row += '    ';
    }

    for (let w = 0; w < WEEKS; w++) {
      const val = grid[w][d];
      if (val === -1) {
        row += ' '; // future date
      } else {
        const level = getHeatmapColorLevel(val, maxValue);
        row += `${HEATMAP_COLORS[level]}${HEATMAP_CHARS[level]}${RESET} `;
      }
    }
    output += `${row}${CLR_LINE}\n`;
  }

  output += `${CLR_LINE}\n`;

  // Legend
  output += `  ${DIM}Less${RESET} `;
  for (let i = 0; i < 5; i++) {
    output += `${HEATMAP_COLORS[i]}${HEATMAP_CHARS[i]}${RESET} `;
  }
  output += `${DIM}More${RESET}${CLR_LINE}\n`;
  output += `${CLR_LINE}\n`;

  // Stats
  let totalTokens = 0;
  let totalCost = 0;
  let totalSessions = 0;
  let busiestDay = '';
  let busiestValue = 0;
  let daysWithData = 0;

  for (const [dateKey, val] of dayMap) {
    totalTokens += val;
    if (val > busiestValue) {
      busiestValue = val;
      busiestDay = dateKey;
    }
    if (val > 0) daysWithData++;
  }
  for (const [, val] of costMap) totalCost += val;
  for (const [, val] of sessionMap) totalSessions += val;

  const avgDaily = daysWithData > 0 ? Math.round(totalTokens / daysWithData) : 0;

  output += `  ${BOLD}${WHITE}Stats:${RESET}${CLR_LINE}\n`;
  output += `    ${DIM}Total tokens:${RESET}  ${GREEN}${formatCompactTokens(totalTokens)}${RESET}${CLR_LINE}\n`;
  output += `    ${DIM}Total cost:${RESET}    ${YELLOW}$${totalCost.toFixed(2)}${RESET}${CLR_LINE}\n`;
  output += `    ${DIM}Total sessions:${RESET}${CYAN} ${totalSessions}${RESET}${CLR_LINE}\n`;
  if (busiestDay) {
    output += `    ${DIM}Busiest day:${RESET}   ${WHITE}${busiestDay}${RESET} ${DIM}(${formatCompactTokens(busiestValue)} tokens)${RESET}${CLR_LINE}\n`;
  }
  output += `    ${DIM}Avg daily:${RESET}     ${WHITE}${formatCompactTokens(avgDaily)} tokens${RESET}${CLR_LINE}\n`;

  output += `\n${DIM}  Press any key to return...${RESET}`;

  process.stdout.write(output);
}

function renderPalette() {
  const { columns, rows } = process.stdout;
  const filtered = filterCommands(paletteQuery);
  const boxWidth = Math.min(56, columns - 4);
  const boxHeight = Math.min(filtered.length + 4, 14); // input + border + items + border
  const startCol = Math.max(1, Math.floor((columns - boxWidth) / 2));
  const startRow = Math.max(1, Math.floor((rows - boxHeight) / 3));

  let output = '';

  // Move to start position and draw top border
  const topBorder = '\u250c' + '\u2500'.repeat(boxWidth - 2) + '\u2510';
  output += `\x1b[${startRow};${startCol}H${BOLD}${CYAN}${topBorder}${RESET}`;

  // Input row
  const inputLabel = ' > ';
  const cursorChar = '\u2588';
  const inputMaxLen = boxWidth - 2 - inputLabel.length - 1;
  const displayQuery = paletteQuery.length > inputMaxLen
    ? paletteQuery.slice(-inputMaxLen)
    : paletteQuery;
  const inputPad = ' '.repeat(Math.max(0, boxWidth - 2 - inputLabel.length - displayQuery.length - 1));
  output += `\x1b[${startRow + 1};${startCol}H${BOLD}${CYAN}\u2502${RESET}${BOLD}${WHITE}${inputLabel}${displayQuery}${cursorChar}${RESET}${inputPad}${BOLD}${CYAN}\u2502${RESET}`;

  // Separator
  const sep = '\u251c' + '\u2500'.repeat(boxWidth - 2) + '\u2524';
  output += `\x1b[${startRow + 2};${startCol}H${BOLD}${CYAN}${sep}${RESET}`;

  // Command items
  for (let i = 0; i < filtered.length && i < 10; i++) {
    const cmd = filtered[i];
    const rowPos = startRow + 3 + i;
    const isSelected = i === paletteSelected;
    const bg = isSelected ? BG_BLUE : '';
    const fg = isSelected ? `${WHITE}${BOLD}` : WHITE;
    const shortcutText = `${DIM}[${cmd.shortcut}]${RESET}`;
    const nameMaxLen = boxWidth - 2 - cmd.shortcut.length - 5; // 5 = "| " + " [" + "]|"
    const name = cmd.name.length > nameMaxLen
      ? cmd.name.slice(0, nameMaxLen)
      : cmd.name;
    const namePad = ' '.repeat(Math.max(0, nameMaxLen - name.length));
    output += `\x1b[${rowPos};${startCol}H${BOLD}${CYAN}\u2502${RESET}${bg}${fg} ${name}${RESET}${bg}${namePad} ${shortcutText}${bg ? RESET : ''}${BOLD}${CYAN}\u2502${RESET}`;
  }

  // If no results
  if (filtered.length === 0) {
    const noMatch = 'No matching commands';
    const pad = ' '.repeat(Math.max(0, boxWidth - 2 - noMatch.length));
    output += `\x1b[${startRow + 3};${startCol}H${BOLD}${CYAN}\u2502${RESET}${DIM} ${noMatch}${pad}${RESET}${BOLD}${CYAN}\u2502${RESET}`;
  }

  // Bottom border
  const bottomRow = startRow + 3 + Math.max(filtered.length, 1);
  const bottomBorder = '\u2514' + '\u2500'.repeat(boxWidth - 2) + '\u2518';
  output += `\x1b[${bottomRow};${startCol}H${BOLD}${CYAN}${bottomBorder}${RESET}`;

  process.stdout.write(output);
}

function executeCommand(action) {
  switch (action) {
    case 'kill':
      if (processes[selectedIndex]) {
        killProcess(processes[selectedIndex].pid, false);
        setTimeout(() => {
          allProcesses = getClaudeProcesses(); applySortAndFilter();
          lastRefresh = new Date();
          if (selectedIndex >= processes.length) selectedIndex = Math.max(0, processes.length - 1);
          render();
        }, 300);
      }
      break;
    case 'force-kill':
      if (processes[selectedIndex]) {
        killProcess(processes[selectedIndex].pid, true);
        setTimeout(() => {
          allProcesses = getClaudeProcesses(); applySortAndFilter();
          lastRefresh = new Date();
          if (selectedIndex >= processes.length) selectedIndex = Math.max(0, processes.length - 1);
          render();
        }, 300);
      }
      break;
    case 'kill-all':
      confirmKillAll = true;
      process.stdout.write(`\n${BG_RED}${WHITE}${BOLD} Kill ALL ${allProcesses.length} Claude processes? (y/N) ${RESET}`);
      break;
    case 'toggle-pane':
      if (viewMode === 'list') {
        viewMode = 'pane';
        const cardsPerRow = getCardsPerRow();
        paneRow = Math.floor(selectedIndex / cardsPerRow);
        paneCol = selectedIndex % cardsPerRow;
      } else {
        viewMode = 'list';
      }
      render();
      break;
    case 'toggle-dashboard':
      dashboardManualToggle = true;
      showDashboard = !showDashboard;
      render();
      break;
    case 'toggle-log':
      logPaneManualToggle = true;
      showLogPane = !showLogPane;
      if (showLogPane) {
        logScrollOffset = 0;
        logLines = [];
        statusMessage = 'Log pane ON (L to close)';
      } else {
        logLines = [];
        logScrollOffset = 0;
        statusMessage = 'Log pane OFF';
      }
      render();
      break;
    case 'toggle-history':
      showHistory = true;
      showHistoryView();
      break;
    case 'open-dir':
      if (processes[selectedIndex]) {
        execOpenDirectory(processes[selectedIndex].cwd, 'finder');
        render();
      }
      break;
    case 'open-editor':
      if (processes[selectedIndex]) {
        execOpenDirectory(processes[selectedIndex].cwd, 'editor');
        render();
      }
      break;
    case 'open-terminal':
      if (processes[selectedIndex]) {
        execOpenDirectory(processes[selectedIndex].cwd, 'terminal');
        render();
      }
      break;
    case 'sort-age':
      sortMode = 'age';
      statusMessage = 'Sort: age';
      applySortAndFilter();
      render();
      break;
    case 'sort-cpu':
      sortMode = 'cpu';
      statusMessage = 'Sort: cpu';
      applySortAndFilter();
      render();
      break;
    case 'sort-mem':
      sortMode = 'mem';
      statusMessage = 'Sort: mem';
      applySortAndFilter();
      render();
      break;
    case 'sort-context':
      sortMode = 'context';
      statusMessage = 'Sort: context';
      applySortAndFilter();
      render();
      break;
    case 'reverse-sort':
      sortReverse = !sortReverse;
      statusMessage = `Sort: ${sortMode} ${sortReverse ? '(reversed)' : ''}`;
      applySortAndFilter();
      render();
      break;
    case 'refresh':
      allProcesses = getClaudeProcesses(); applySortAndFilter();
      updateProcessHistory(allProcesses);
      checkStateTransitions(allProcesses);
      lastRefresh = new Date();
      statusMessage = 'Refreshed';
      render();
      break;
    case 'cycle-theme':
      cycleTheme();
      render();
      break;
    case 'toggle-notif':
      notificationsEnabled = !notificationsEnabled;
      statusMessage = `Notifications: ${notificationsEnabled ? 'ON' : 'OFF'}`;
      render();
      break;
    case 'search':
      searchMode = true;
      searchQuery = '';
      searchResults.clear();
      statusMessage = 'Search: type query, Enter to search, ESC to cancel';
      render();
      break;
    case 'filter':
      filterInput = true;
      filterText = '';
      statusMessage = 'Filter: type to search, Enter to confirm, ESC to cancel';
      render();
      break;
    case 'help':
      showingHelp = true;
      showHelp();
      break;
    case 'quit':
      cleanup();
      process.exit(0);
      break;
  }
}

function showHelp() {
  const { columns } = process.stdout;
  let output = CLEAR;

  output += renderHeader(columns);
  output += '\n';

  output += `${BOLD}NAVIGATION:${RESET}\n`;
  output += `  ${CYAN}↑ / k${RESET}     Move selection up\n`;
  output += `  ${CYAN}↓ / j${RESET}     Move selection down\n`;
  output += `  ${CYAN}← / h${RESET}     Move selection left (pane mode)\n`;
  output += `  ${CYAN}→ / l${RESET}     Move selection right (pane mode)\n`;
  output += `  ${CYAN}g${RESET}         Jump to first process\n`;
  output += `  ${CYAN}G${RESET}         Jump to last process\n`;
  output += `  ${CYAN}P${RESET}         Toggle pane/grid view\n\n`;

  output += `${BOLD}ACTIONS:${RESET}\n`;
  output += `  ${CYAN}x${RESET}         Kill selected process (SIGTERM - graceful)\n`;
  output += `  ${CYAN}X${RESET}         Force kill selected process (SIGKILL)\n`;
  output += `  ${CYAN}K${RESET}         Kill ALL Claude processes (with confirmation)\n`;
  output += `  ${CYAN}A${RESET}         Kill ALL stopped/dead processes (with confirmation)\n`;
  output += `  ${CYAN}o${RESET}         Open working directory in file manager\n`;
  output += `  ${CYAN}e${RESET}         Open working directory in editor ($EDITOR or code)\n`;
  output += `  ${CYAN}t${RESET}         Open new terminal tab in working directory\n`;
  output += `  ${CYAN}r${RESET}         Refresh process list\n`;
  output += `  ${CYAN}d${RESET}         Toggle aggregate dashboard stats\n`;
  output += `  ${CYAN}H${RESET}         Toggle usage history view (24h charts)\n`;
  output += `  ${CYAN}C${RESET}         Toggle usage heatmap (12-week calendar)\n`;
  output += `  ${CYAN}n${RESET}         Toggle desktop notifications on/off\n`;
  output += `  ${CYAN}L${RESET}         Toggle live session log pane\n`;
  output += `  ${CYAN}W${RESET}         Show session timeline waterfall view\n`;
  output += `  ${CYAN}E${RESET}         Export session report to clipboard\n\n`;

  output += `${BOLD}APPEARANCE:${RESET}\n`;
  output += `  ${CYAN}T${RESET}         Cycle color theme (${THEME_NAMES.join(', ')})\n`;
  output += `  ${DIM}Current:${RESET}  ${currentThemeName}\n\n`;

  output += `${BOLD}OTHER:${RESET}\n`;
  output += `  ${CYAN}Ctrl+K${RESET}    Command palette with fuzzy search\n`;
  output += `  ${CYAN}q / ESC${RESET}   Quit the manager\n`;
  output += `  ${CYAN}?${RESET}         Show this help\n\n`;

  output += `${BOLD}PROCESS STATUS:${RESET}\n`;
  output += `  ${GREEN}ACTIVE${RESET}    Process is running normally\n`;
  output += `  ${YELLOW}STOPPED${RESET}   Process is suspended (can be resumed)\n`;
  output += `  ${RED}ZOMBIE${RESET}    Process has terminated but not reaped\n`;
  output += `  ${DIM}SLEEPING${RESET}  Process is idle/waiting\n\n`;

  output += `${BOLD}SORT & FILTER:${RESET}\n`;
  output += `  ${CYAN}s${RESET}         Cycle sort: age → cpu → mem → context\n`;
  output += `  ${CYAN}S${RESET}         Reverse sort order\n`;
  output += `  ${CYAN}/${RESET}         Start typing to filter (branch, model, dir, slug)\n`;
  output += `  ${CYAN}F${RESET}         Full-text search session content\n`;
  output += `  ${CYAN}ESC${RESET}       Clear active filter or search\n\n`;

  output += `${DIM}Press any key to return...${RESET}`;

  process.stdout.write(output);
}

function parseMouseEvent(data) {
  // SGR format: \x1b[<button;col;rowM (press) or \x1b[<button;col;rowm (release)
  const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) return null;
  const button = parseInt(match[1]);
  const col = parseInt(match[2]);
  const row = parseInt(match[3]);
  const isRelease = match[4] === 'm';
  return {
    button: button & 3, // 0=left, 1=middle, 2=right
    col, row, isRelease,
    isScroll: (button & 64) !== 0,
    scrollUp: (button & 64) !== 0 && (button & 1) === 0,
    scrollDown: (button & 64) !== 0 && (button & 1) !== 0,
  };
}

function listViewRowToIndex(row) {
  // Header: 3 (header box) + 1 (stats) + 1 (separator) + 1 (col headers) + 1 (separator) = 7
  const headerLines = 7 + (showDashboard ? 2 : 0);
  const dataRow = row - headerLines - 1; // -1 because rows are 1-based
  if (dataRow < 0) return -1;

  const termRows = process.stdout.rows || 40;
  const maxVisible = termRows - 10 - (showDashboard ? 2 : 0);
  const startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  return startIdx + dataRow;
}

function paneViewClickToIndex(row, col) {
  const { columns } = process.stdout;
  const cardWidth = 34;
  const cardHeight = 8;
  const cardGapX = 1;
  const cardGapY = 1;
  const cardsPerRow = getCardsPerRow();

  // Header: 3 (header box) + 1 (stats) + 1 (separator) = 5, plus optional dashboard/status
  const headerLines = 5 + (showDashboard ? 2 : 0);
  const contentRow = row - headerLines - 1; // 0-based row within card grid (1-based row correction)
  if (contentRow < 0) return -1;

  // Determine which card row
  const cellHeight = cardHeight + cardGapY;
  const cardRow = Math.floor(contentRow / cellHeight);
  const withinCard = contentRow % cellHeight;
  if (withinCard >= cardHeight) return -1; // clicked in gap

  // Determine which card column
  const cellWidth = cardWidth + cardGapX;
  const cardCol = Math.floor((col - 1) / cellWidth); // col is 1-based
  if (cardCol >= cardsPerRow) return -1;
  const withinCardX = (col - 1) % cellWidth;
  if (withinCardX >= cardWidth) return -1; // clicked in gap

  // Account for scroll offset
  const totalRows = Math.ceil(processes.length / cardsPerRow);
  const { rows: termRows } = process.stdout;
  const footerLines = 2;
  const availableSpace = termRows - headerLines - footerLines;
  const maxVisibleCardRows = Math.max(1, Math.floor((availableSpace + cardGapY) / (cardHeight + cardGapY)));
  const scrollRow = Math.max(0, paneRow - Math.floor(maxVisibleCardRows / 2));

  const actualCardRow = scrollRow + cardRow;
  const idx = actualCardRow * cardsPerRow + cardCol;
  if (idx >= processes.length) return -1;
  return idx;
}

function handleMouseEvent(evt) {
  // Only handle left-click press events, plus scroll
  if (evt.isScroll) {
    if (evt.scrollUp) {
      // Same as 'k' — move selection up
      if (viewMode === 'pane') {
        if (paneRow > 0) {
          paneRow--;
          const cardsPerRow = getCardsPerRow();
          selectedIndex = paneRow * cardsPerRow + paneCol;
          if (selectedIndex >= processes.length) {
            selectedIndex = processes.length - 1;
            paneCol = selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (selectedIndex > 0) selectedIndex--;
      }
    } else if (evt.scrollDown) {
      // Same as 'j' — move selection down
      if (viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        const totalRows = Math.ceil(processes.length / cardsPerRow);
        if (paneRow < totalRows - 1) {
          paneRow++;
          selectedIndex = paneRow * cardsPerRow + paneCol;
          if (selectedIndex >= processes.length) {
            selectedIndex = processes.length - 1;
            paneCol = selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (selectedIndex < processes.length - 1) selectedIndex++;
      }
    }
    render();
    return;
  }

  // Only left-click press (not release)
  if (evt.button !== 0 || evt.isRelease) return;

  if (viewMode === 'pane') {
    const idx = paneViewClickToIndex(evt.row, evt.col);
    if (idx >= 0 && idx < processes.length) {
      selectedIndex = idx;
      const cardsPerRow = getCardsPerRow();
      paneRow = Math.floor(idx / cardsPerRow);
      paneCol = idx % cardsPerRow;
      render();
    }
  } else {
    const idx = listViewRowToIndex(evt.row);
    if (idx >= 0 && idx < processes.length) {
      selectedIndex = idx;
      render();
    }
  }
}

let showingHelp = false;
let confirmKillAll = false;
let confirmKillStopped = false;

function handleInput(key) {
  // Check for mouse events first
  const mouseEvt = parseMouseEvent(key);
  if (mouseEvt) {
    handleMouseEvent(mouseEvt);
    return;
  }

  // Command palette mode
  if (showPalette) {
    if (key === '\x1b' && key.length === 1) {
      // ESC: close palette
      showPalette = false;
      paletteQuery = '';
      paletteSelected = 0;
      render();
    } else if (key === '\r' || key === '\n') {
      // Enter: execute selected command
      const filtered = filterCommands(paletteQuery);
      if (filtered.length > 0 && paletteSelected < filtered.length) {
        const action = filtered[paletteSelected].action;
        showPalette = false;
        paletteQuery = '';
        paletteSelected = 0;
        executeCommand(action);
      }
    } else if (key === '\x1b[A' || key === '\x10') {
      // Up arrow or Ctrl+P
      if (paletteSelected > 0) paletteSelected--;
      render();
      renderPalette();
    } else if (key === '\x1b[B' || key === '\x0e') {
      // Down arrow or Ctrl+N
      const filtered = filterCommands(paletteQuery);
      if (paletteSelected < filtered.length - 1) paletteSelected++;
      render();
      renderPalette();
    } else if (key === '\x7f' || key === '\b') {
      // Backspace
      paletteQuery = paletteQuery.slice(0, -1);
      paletteSelected = 0;
      render();
      renderPalette();
    } else if (key.length === 1 && key >= ' ') {
      // Regular character
      paletteQuery += key;
      paletteSelected = 0;
      render();
      renderPalette();
    }
    return;
  }

  // Filter input mode
  if (filterInput) {
    if (key === '\r' || key === '\n') {
      // Enter: confirm filter
      filterInput = false;
      if (filterText) statusMessage = `Filter: "${filterText}" (ESC to clear)`;
      applySortAndFilter();
      render();
    } else if (key === '\x1b' && key.length === 1) {
      // ESC only (not an arrow key escape sequence)
      filterInput = false;
      filterText = '';
      applySortAndFilter();
      render();
    } else if (key.startsWith('\x1b[')) {
      // Arrow keys / escape sequences — ignore in filter mode
    } else if (key === '\x7f' || key === '\b') {
      // Backspace
      filterText = filterText.slice(0, -1);
      applySortAndFilter();
      render();
    } else if (key.length === 1 && key >= ' ') {
      filterText += key;
      applySortAndFilter();
      render();
    }
    return;
  }

  // Search input mode
  if (searchMode) {
    if (key === '\r' || key === '\n') {
      // Enter: execute search
      searchMode = false;
      if (searchQuery) {
        statusMessage = 'Searching...';
        render();
        executeSearch(searchQuery);
        statusMessage = `Search: "${searchQuery}" (${searchResults.size} matches, ESC to clear)`;
      }
      applySortAndFilter();
      render();
    } else if (key === '\x1b' && key.length === 1) {
      // ESC: cancel search input
      searchMode = false;
      searchQuery = '';
      render();
    } else if (key.startsWith('\x1b[')) {
      // Arrow keys — ignore in search mode
    } else if (key === '\x7f' || key === '\b') {
      // Backspace
      searchQuery = searchQuery.slice(0, -1);
      render();
    } else if (key.length === 1 && key >= ' ') {
      searchQuery += key;
      render();
    }
    return;
  }

  if (showingHelp) {
    showingHelp = false;
    render();
    return;
  }

  if (showHistory) {
    showHistory = false;
    render();
    return;
  }

  if (showTimeline) {
    if (key === 'W' || key === 'w' || key === '\x1b') {
      showTimeline = false;
      timelineCache = null;
      timelineScrollOffset = 0;
      render();
    } else if (key === '\x1b[A' || key === 'k') {
      // Scroll up
      if (timelineScrollOffset > 0) timelineScrollOffset--;
      render();
    } else if (key === '\x1b[B' || key === 'j') {
      // Scroll down
      timelineScrollOffset++;
      render();
    } else if (key === 'g') {
      timelineScrollOffset = 0;
      render();
    } else if (key === 'G') {
      timelineScrollOffset = 999999; // will be clamped in renderTimeline
      render();
    } else if (key === 'q' || key === '\x03') {
      cleanup();
      process.exit(0);
    }
    return;
  }

  if (showHeatmap) {
    showHeatmap = false;
    render();
    return;
  }

  if (confirmKillAll) {
    if (key === 'y' || key === 'Y') {
      const killed = killAllProcesses();
      statusMessage = `Killed ${killed} processes`;
      confirmKillAll = false;
      setTimeout(() => {
        allProcesses = getClaudeProcesses(); applySortAndFilter();
        lastRefresh = new Date();
        render();
      }, 500);
    } else {
      confirmKillAll = false;
      render();
    }
    return;
  }

  if (confirmKillStopped) {
    if (key === 'y' || key === 'Y') {
      const stoppedProcs = allProcesses.filter(p => !p.isActive);
      let killed = 0;
      for (const proc of stoppedProcs) {
        if (killProcess(proc.pid, true)) killed++;
      }
      statusMessage = `Killed ${killed} stopped processes`;
      confirmKillStopped = false;
      setTimeout(() => {
        allProcesses = getClaudeProcesses(); applySortAndFilter();
        lastRefresh = new Date();
        if (selectedIndex >= processes.length) {
          selectedIndex = Math.max(0, processes.length - 1);
        }
        render();
      }, 500);
    } else {
      confirmKillStopped = false;
      render();
    }
    return;
  }

  if (exportMode) {
    exportMode = false;
    const proc = processes[selectedIndex];
    if (proc && (key === 'm' || key === 'j' || key === 'c')) {
      let text, label;
      if (key === 'm') {
        text = formatSessionMarkdown(proc);
        label = 'Markdown';
      } else if (key === 'j') {
        text = formatSessionJSON(proc);
        label = 'JSON';
      } else {
        text = formatSessionCSV(proc);
        label = 'CSV';
      }
      if (copyToClipboard(text)) {
        statusMessage = `Copied ${label} report to clipboard`;
      } else {
        statusMessage = `Failed to copy ${label} report to clipboard`;
      }
    } else {
      statusMessage = 'Export cancelled';
    }
    render();
    return;
  }

  switch (key) {
    case '\x0b': // Ctrl+K — open command palette
      showPalette = true;
      paletteQuery = '';
      paletteSelected = 0;
      render();
      renderPalette();
      break;

    case 'P':
      if (viewMode === 'list') {
        viewMode = 'pane';
        const cardsPerRow = getCardsPerRow();
        paneRow = Math.floor(selectedIndex / cardsPerRow);
        paneCol = selectedIndex % cardsPerRow;
      } else {
        viewMode = 'list';
      }
      render();
      break;

    case 'T':
      cycleTheme();
      render();
      break;

    case 'L':
      logPaneManualToggle = true;
      showLogPane = !showLogPane;
      if (showLogPane) {
        logScrollOffset = 0;
        logLines = [];
        statusMessage = 'Log pane ON (L to close)';
      } else {
        logLines = [];
        logScrollOffset = 0;
        statusMessage = 'Log pane OFF';
      }
      render();
      break;

    case 'W':
      if (processes[selectedIndex]) {
        showTimeline = true;
        timelineScrollOffset = 0;
        timelineCache = null; // force re-parse
        render();
      }
      break;

    case '\x1b[A': // Up arrow
    case 'k':
      if (viewMode === 'pane') {
        if (paneRow > 0) {
          paneRow--;
          const cardsPerRow = getCardsPerRow();
          selectedIndex = paneRow * cardsPerRow + paneCol;
          if (selectedIndex >= processes.length) {
            selectedIndex = processes.length - 1;
            paneCol = selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (selectedIndex > 0) selectedIndex--;
      }
      render();
      break;

    case '\x1b[B': // Down arrow
    case 'j':
      if (viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        const totalRows = Math.ceil(processes.length / cardsPerRow);
        if (paneRow < totalRows - 1) {
          paneRow++;
          selectedIndex = paneRow * cardsPerRow + paneCol;
          if (selectedIndex >= processes.length) {
            selectedIndex = processes.length - 1;
            paneCol = selectedIndex % cardsPerRow;
          }
        }
      } else {
        if (selectedIndex < processes.length - 1) selectedIndex++;
      }
      render();
      break;

    case '\x1b[D': // Left arrow
    case 'h':
      if (viewMode === 'pane') {
        if (paneCol > 0) {
          paneCol--;
          const cardsPerRow = getCardsPerRow();
          selectedIndex = paneRow * cardsPerRow + paneCol;
        }
        render();
      }
      break;

    case '\x1b[C': // Right arrow
    case 'l':
      if (viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        const maxColInRow = Math.min(cardsPerRow - 1, processes.length - 1 - paneRow * cardsPerRow);
        if (paneCol < maxColInRow) {
          paneCol++;
          selectedIndex = paneRow * cardsPerRow + paneCol;
        }
        render();
      }
      break;

    case 'd':
      dashboardManualToggle = true;
      showDashboard = !showDashboard;
      render();
      break;

    case 'H':
      showHistory = true;
      showHistoryView();
      break;

    case 'C':
      showHeatmap = true;
      renderHeatmap(process.stdout.columns || 80, process.stdout.rows || 40);
      break;

    case 'g':
      selectedIndex = 0;
      if (viewMode === 'pane') { paneRow = 0; paneCol = 0; }
      render();
      break;

    case 'G':
      selectedIndex = Math.max(0, processes.length - 1);
      if (viewMode === 'pane') {
        const cardsPerRow = getCardsPerRow();
        paneRow = Math.floor(selectedIndex / cardsPerRow);
        paneCol = selectedIndex % cardsPerRow;
      }
      render();
      break;

    case 'x':
      if (processes[selectedIndex]) {
        const pid = processes[selectedIndex].pid;
        killProcess(pid, false);
        setTimeout(() => {
          allProcesses = getClaudeProcesses(); applySortAndFilter();
          lastRefresh = new Date();
          if (selectedIndex >= processes.length) {
            selectedIndex = Math.max(0, processes.length - 1);
          }
          render();
        }, 300);
      }
      break;

    case 'X':
      if (processes[selectedIndex]) {
        const pid = processes[selectedIndex].pid;
        killProcess(pid, true);
        setTimeout(() => {
          allProcesses = getClaudeProcesses(); applySortAndFilter();
          lastRefresh = new Date();
          if (selectedIndex >= processes.length) {
            selectedIndex = Math.max(0, processes.length - 1);
          }
          render();
        }, 300);
      }
      break;

    case 'K':
      confirmKillAll = true;
      process.stdout.write(`\n${BG_RED}${WHITE}${BOLD} Kill ALL ${allProcesses.length} Claude processes? (y/N) ${RESET}`);
      break;

    case 'A': {
      const stoppedCount = allProcesses.filter(p => !p.isActive).length;
      if (stoppedCount > 0) {
        confirmKillStopped = true;
        process.stdout.write(`\n${BG_RED}${WHITE}${BOLD} Kill ALL ${stoppedCount} stopped/dead processes? (y/N) ${RESET}`);
      } else {
        statusMessage = 'No stopped processes to kill';
        render();
      }
      break;
    }

    case 'o':
      if (processes[selectedIndex]) {
        execOpenDirectory(processes[selectedIndex].cwd, 'finder');
        render();
      }
      break;

    case 'e':
      if (processes[selectedIndex]) {
        execOpenDirectory(processes[selectedIndex].cwd, 'editor');
        render();
      }
      break;

    case 't':
      if (processes[selectedIndex]) {
        execOpenDirectory(processes[selectedIndex].cwd, 'terminal');
        render();
      }
      break;

    case 's': {
      // Cycle sort mode
      const si = SORT_MODES.indexOf(sortMode);
      sortMode = SORT_MODES[(si + 1) % SORT_MODES.length];
      statusMessage = `Sort: ${sortMode}`;
      applySortAndFilter();
      render();
      break;
    }

    case 'S':
      // Reverse sort
      sortReverse = !sortReverse;
      statusMessage = `Sort: ${sortMode} ${sortReverse ? '(reversed)' : ''}`;
      applySortAndFilter();
      render();
      break;

    case '/':
      // Enter filter mode
      filterInput = true;
      filterText = '';
      statusMessage = 'Filter: type to search, Enter to confirm, ESC to cancel';
      render();
      break;

    case 'F':
      // Enter full-text search mode
      searchMode = true;
      searchQuery = '';
      searchResults.clear();
      statusMessage = 'Search: type query, Enter to search, ESC to cancel';
      render();
      break;

    case 'E':
      if (processes[selectedIndex]) {
        exportMode = true;
        statusMessage = 'Export: [m]arkdown [j]son [c]sv';
        render();
      }
      break;

    case 'n':
      notificationsEnabled = !notificationsEnabled;
      statusMessage = `Notifications: ${notificationsEnabled ? 'ON' : 'OFF'}`;
      render();
      break;

    case 'r':
      allProcesses = getClaudeProcesses(); applySortAndFilter();
      updateProcessHistory(allProcesses);
      checkStateTransitions(allProcesses);
      lastRefresh = new Date();
      statusMessage = 'Refreshed';
      render();
      break;

    case '?':
      showingHelp = true;
      showHelp();
      break;

    case '\x1b': // ESC
      if (searchQuery) {
        // Clear search
        searchQuery = '';
        searchResults.clear();
        statusMessage = 'Search cleared';
        applySortAndFilter();
        render();
        break;
      }
      if (filterText) {
        // Clear filter
        filterText = '';
        statusMessage = 'Filter cleared';
        applySortAndFilter();
        render();
        break;
      }
      // Fall through to quit
    case 'q':
    case '\x03': // Ctrl+C
      cleanup();
      process.exit(0);
      break;
  }
}

function cleanup() {
  // Call plugin cleanup functions
  for (const p of plugins) {
    if (typeof p.cleanup === 'function') {
      try { p.cleanup(); } catch (e) {}
    }
  }
  // Disable mouse tracking
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
    render();
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

  // Initial load
  allProcesses = getClaudeProcesses(); applySortAndFilter();
  updateProcessHistory(allProcesses);
  render();

  // Prune old history on startup
  try {
    const hist = loadHistory();
    const pruned = pruneHistory(hist);
    if (pruned.length < hist.length) {
      if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(pruned, null, 0));
    }
  } catch {}

  // Auto-refresh every 5 seconds
  setInterval(() => {
    if (!showingHelp && !showHistory && !showTimeline && !showHeatmap && !confirmKillAll && !confirmKillStopped && !filterInput && !searchMode && !showPalette) {
      allProcesses = getClaudeProcesses(); applySortAndFilter();
      updateProcessHistory(allProcesses);
      checkStateTransitions(allProcesses);
      saveHistorySnapshot(allProcesses);
      lastRefresh = new Date();
      if (selectedIndex >= processes.length) {
        selectedIndex = Math.max(0, processes.length - 1);
      }
      render();
    }
  }, CONFIG.refreshInterval);

  // Handle input
  process.stdin.on('data', (key) => {
    handleInput(key);
  });
}

module.exports = {
  main,
  calculateCost,
  formatCost,
  formatTokenCount,
  calculateAggregateStats,
  MODEL_PRICING,
  formatStartTime,
  ctxColor,
  loadConfig,
  getSessionData,
  searchSessionContent,
  applySortAndFilter,
  getCardsPerRow,
  openDirectory,
  renderBrailleBar,
  renderContextBarBraille,
  BRAILLE_FILLS,
  parseMouseEvent,
  listViewRowToIndex,
  paneViewClickToIndex,
  DEFAULT_CONFIG,
  // Theme exports
  THEMES,
  THEME_NAMES,
  THEME_REQUIRED_KEYS,
  resolveTheme,
  cycleTheme,
  // Export report
  formatSessionMarkdown,
  formatSessionJSON,
  formatSessionCSV,
  csvEscape,
  copyToClipboard,
  // Plugin system
  loadPlugins,
  // History tracking
  loadHistory,
  pruneHistory,
  saveHistorySnapshot,
  renderHistoryChart,
  formatHourLabel,
  formatCompactTokens,
  HISTORY_DIR,
  HISTORY_FILE,
  SNAPSHOT_INTERVAL,
  HISTORY_RETENTION_DAYS,
  // Heatmap
  aggregateHeatmapData,
  getHeatmapColorLevel,
  renderHeatmap,
  // Notification helpers
  sendNotification,
  formatDuration,
  formatNotificationMessage,
  checkStateTransitions,
  // Windows / cross-platform exports
  buildKillCommand,
  cwdToProjectDirName,
  IS_MAC,
  IS_LINUX,
  IS_WIN,
  PLATFORM,
  // Git diff summary
  getGitDiffSummary,
  parseDiffStat,
  parseNumstat,
  scanSessionFilesForHistory,
  get sessionScanCache() { return sessionScanCache; },
  set sessionScanCache(v) { sessionScanCache = v; },
  get sessionScanCacheTime() { return sessionScanCacheTime; },
  set sessionScanCacheTime(v) { sessionScanCacheTime = v; },
  gitDiffCache,
  GIT_DIFF_CACHE_TTL,
  // Sparklines
  renderSparkline,
  updateProcessHistory,
  processHistory,
  SPARKLINE_BLOCKS,
  SPARKLINE_MAX_POINTS,
  // Log tailing
  parseLogEntry,
  readSessionLog,
  // Timeline
  parseSessionTimeline,
  getSessionFileForProc,
  formatElapsed,
  renderTimeline,
  // Command palette
  COMMANDS,
  fuzzyMatch,
  fuzzyScore,
  filterCommands,
  executeCommand,
  // Expose internals for testing
  _state: { get allProcesses() { return allProcesses; }, set allProcesses(v) { allProcesses = v; },
            get processes() { return processes; }, set processes(v) { processes = v; },
            get filterText() { return filterText; }, set filterText(v) { filterText = v; },
            get sortMode() { return sortMode; }, set sortMode(v) { sortMode = v; },
            get sortReverse() { return sortReverse; }, set sortReverse(v) { sortReverse = v; },
            get selectedIndex() { return selectedIndex; }, set selectedIndex(v) { selectedIndex = v; },
            get showDashboard() { return showDashboard; }, set showDashboard(v) { showDashboard = v; },
            get showHistory() { return showHistory; }, set showHistory(v) { showHistory = v; },
            get showTimeline() { return showTimeline; }, set showTimeline(v) { showTimeline = v; },
            get timelineScrollOffset() { return timelineScrollOffset; }, set timelineScrollOffset(v) { timelineScrollOffset = v; },
            get timelineCache() { return timelineCache; }, set timelineCache(v) { timelineCache = v; },
            get showHeatmap() { return showHeatmap; }, set showHeatmap(v) { showHeatmap = v; },
            get lastSnapshotTime() { return lastSnapshotTime; }, set lastSnapshotTime(v) { lastSnapshotTime = v; },
            get searchQuery() { return searchQuery; }, set searchQuery(v) { searchQuery = v; },
            get searchResults() { return searchResults; }, set searchResults(v) { searchResults = v; },
            get notificationsEnabled() { return notificationsEnabled; }, set notificationsEnabled(v) { notificationsEnabled = v; },
            get viewMode() { return viewMode; }, set viewMode(v) { viewMode = v; },
            get currentThemeName() { return currentThemeName; }, set currentThemeName(v) { currentThemeName = v; },
            get showLogPane() { return showLogPane; }, set showLogPane(v) { showLogPane = v; },
            get logLines() { return logLines; }, set logLines(v) { logLines = v; },
            get logScrollOffset() { return logScrollOffset; }, set logScrollOffset(v) { logScrollOffset = v; },
            get exportMode() { return exportMode; }, set exportMode(v) { exportMode = v; },
            get THEME() { return THEME; }, set THEME(v) { THEME = v; },
            get plugins() { return plugins; }, set plugins(v) { plugins = v; },
            get showPalette() { return showPalette; }, set showPalette(v) { showPalette = v; },
            get paletteQuery() { return paletteQuery; }, set paletteQuery(v) { paletteQuery = v; },
            get paletteSelected() { return paletteSelected; }, set paletteSelected(v) { paletteSelected = v; } },
  _notif: { previousStates, processStartTimes },
  _colors: { RED, ORANGE, YELLOW, GREEN, BLUE, CYAN, DIM, RESET },
};
