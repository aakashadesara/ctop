// ANSI codes and theme system — re-exports from core
const core = require('./_core');

module.exports = {
  THEMES: core.THEMES,
  THEME_NAMES: core.THEME_NAMES,
  THEME_REQUIRED_KEYS: core.THEME_REQUIRED_KEYS,
  resolveTheme: core.resolveTheme,
  ctxColor: core.ctxColor,
  _colors: core._colors,
};
