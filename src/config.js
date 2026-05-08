// Configuration loading

const fs = require('fs');
const path = require('path');
const os = require('os');
const { THEMES } = require('./colors');

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

module.exports = { DEFAULT_CONFIG, loadConfig };
