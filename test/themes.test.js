const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  THEMES,
  THEME_NAMES,
  THEME_REQUIRED_KEYS,
  resolveTheme,
  cycleTheme,
  ctxColor,
  _state,
  _colors,
} = require('../claude-manager');

describe('Built-in themes', () => {
  it('has at least 5 built-in themes', () => {
    assert.ok(THEME_NAMES.length >= 5, `Expected >= 5 themes, got ${THEME_NAMES.length}`);
  });

  it('includes default, minimal, dracula, solarized, monokai', () => {
    for (const name of ['default', 'minimal', 'dracula', 'solarized', 'monokai']) {
      assert.ok(THEME_NAMES.includes(name), `Missing theme: ${name}`);
    }
  });

  it('all built-in themes have every required key', () => {
    for (const name of THEME_NAMES) {
      const theme = THEMES[name];
      for (const key of THEME_REQUIRED_KEYS) {
        assert.ok(key in theme, `Theme "${name}" missing key "${key}"`);
        assert.ok(typeof theme[key] === 'string', `Theme "${name}" key "${key}" should be a string`);
      }
    }
  });

  it('required keys list has the expected entries', () => {
    const expected = [
      'header', 'headerBg', 'selection',
      'active', 'stopped', 'zombie', 'sleeping',
      'ctxLow', 'ctxMed', 'ctxHigh', 'ctxOk',
      'border', 'accent', 'cost',
    ];
    assert.deepStrictEqual(THEME_REQUIRED_KEYS, expected);
  });
});

describe('resolveTheme', () => {
  it('resolves a valid built-in name to that theme', () => {
    const theme = resolveTheme('dracula');
    assert.strictEqual(theme.header, THEMES.dracula.header);
    assert.strictEqual(theme.accent, THEMES.dracula.accent);
  });

  it('resolves an invalid string to the default theme', () => {
    const theme = resolveTheme('nonexistent');
    assert.strictEqual(theme.header, THEMES.default.header);
    assert.strictEqual(theme.accent, THEMES.default.accent);
  });

  it('resolves a custom object by merging with default', () => {
    const custom = { header: '\x1b[38;5;99m', accent: '\x1b[38;5;100m' };
    const theme = resolveTheme(custom);
    // Custom keys override
    assert.strictEqual(theme.header, '\x1b[38;5;99m');
    assert.strictEqual(theme.accent, '\x1b[38;5;100m');
    // Non-overridden keys fall back to default
    assert.strictEqual(theme.zombie, THEMES.default.zombie);
    assert.strictEqual(theme.border, THEMES.default.border);
  });

  it('resolves null to the default theme', () => {
    const theme = resolveTheme(null);
    assert.strictEqual(theme.header, THEMES.default.header);
  });

  it('resolves undefined to the default theme', () => {
    const theme = resolveTheme(undefined);
    assert.strictEqual(theme.header, THEMES.default.header);
  });

  it('resolves a number to the default theme', () => {
    const theme = resolveTheme(42);
    assert.strictEqual(theme.header, THEMES.default.header);
  });
});

describe('Theme loading from config', () => {
  it('loadConfig returns default theme when .ctoprc has no theme', () => {
    const { loadConfig } = require('../claude-manager');
    const config = loadConfig();
    assert.ok(config.theme !== undefined);
  });

  it('default config theme is "default"', () => {
    const { DEFAULT_CONFIG } = require('../claude-manager');
    assert.strictEqual(DEFAULT_CONFIG.theme, 'default');
  });
});

describe('cycleTheme', () => {
  beforeEach(() => {
    // Reset to default theme
    _state.currentThemeName = 'default';
    _state.THEME = { ...THEMES.default };
  });

  it('cycles from default to the next theme', () => {
    cycleTheme();
    const expectedNext = THEME_NAMES[1]; // 'minimal'
    assert.strictEqual(_state.currentThemeName, expectedNext);
    assert.strictEqual(_state.THEME.header, THEMES[expectedNext].header);
  });

  it('cycles through all themes and wraps around', () => {
    for (let i = 0; i < THEME_NAMES.length; i++) {
      const expectedName = THEME_NAMES[(i + 1) % THEME_NAMES.length];
      cycleTheme();
      assert.strictEqual(_state.currentThemeName, expectedName,
        `After ${i + 1} cycles, expected "${expectedName}" but got "${_state.currentThemeName}"`);
    }
    // After cycling through all, should be back to default
    assert.strictEqual(_state.currentThemeName, 'default');
  });

  it('wraps from last theme back to default', () => {
    // Set to last theme
    const lastTheme = THEME_NAMES[THEME_NAMES.length - 1];
    _state.currentThemeName = lastTheme;
    _state.THEME = { ...THEMES[lastTheme] };
    cycleTheme();
    assert.strictEqual(_state.currentThemeName, 'default');
  });
});

describe('ctxColor uses theme', () => {
  beforeEach(() => {
    _state.THEME = { ...THEMES.default };
  });

  it('returns ctxLow for pct < 10', () => {
    _state.THEME = { ...THEMES.dracula };
    const color = ctxColor(5);
    assert.strictEqual(color, THEMES.dracula.ctxLow);
  });

  it('returns ctxMed for pct 10-39', () => {
    _state.THEME = { ...THEMES.solarized };
    const color = ctxColor(25);
    assert.strictEqual(color, THEMES.solarized.ctxMed);
  });

  it('returns ctxHigh for pct 40-69', () => {
    _state.THEME = { ...THEMES.monokai };
    const color = ctxColor(55);
    assert.strictEqual(color, THEMES.monokai.ctxHigh);
  });

  it('returns ctxOk for pct >= 70', () => {
    _state.THEME = { ...THEMES.minimal };
    const color = ctxColor(85);
    assert.strictEqual(color, THEMES.minimal.ctxOk);
  });
});
