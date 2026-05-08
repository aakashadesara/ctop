// ANSI escape codes and theme system

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

function ctxColor(pct, state) {
  const THEME = state.THEME;
  // pct = remaining %
  if (pct < 10) return THEME.ctxLow;
  if (pct < 40) return THEME.ctxMed;
  if (pct < 70) return THEME.ctxHigh;
  return THEME.ctxOk;
}

module.exports = {
  ESC, CLEAR, HOME, CLR_LINE, CLR_DOWN, HIDE_CURSOR, SHOW_CURSOR,
  BOLD, DIM, RESET, RED, GREEN, YELLOW, BLUE, CYAN, WHITE,
  BG_BLUE, BG_RED, ORANGE, BG_ORANGE,
  THEMES, THEME_NAMES, THEME_REQUIRED_KEYS,
  resolveTheme, ctxColor,
};
