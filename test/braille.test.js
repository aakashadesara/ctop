const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  renderBrailleBar,
  renderContextBarBraille,
  BRAILLE_FILLS,
  DEFAULT_CONFIG,
  _colors: { GREEN, BLUE, CYAN, YELLOW, DIM, RESET },
} = require('../claude-manager');

// Helper: strip all ANSI escape codes from a string
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Helper: count visible (non-ANSI) characters in a string
function visibleLength(s) {
  return stripAnsi(s).length;
}

describe('BRAILLE_FILLS', () => {
  it('has 9 entries from empty to full', () => {
    assert.strictEqual(BRAILLE_FILLS.length, 9);
    assert.strictEqual(BRAILLE_FILLS[0], '\u2800'); // empty braille
    assert.strictEqual(BRAILLE_FILLS[8], '\u28FF'); // full braille
  });

  it('each entry is a single character', () => {
    for (const ch of BRAILLE_FILLS) {
      assert.strictEqual([...ch].length, 1, `Expected single char, got "${ch}"`);
    }
  });
});

describe('renderBrailleBar', () => {
  it('returns empty string for width 0', () => {
    const result = renderBrailleBar([{ value: 1, color: '' }], 0);
    assert.strictEqual(result, '');
  });

  it('renders a fully filled single-segment bar', () => {
    const result = renderBrailleBar([{ value: 1.0, color: '' }], 10);
    const visible = stripAnsi(result);
    // All characters should be full braille
    assert.strictEqual(visible.length, 10);
    for (const ch of visible) {
      assert.strictEqual(ch, '\u28FF');
    }
  });

  it('renders a completely empty bar when all segment values are 0', () => {
    const result = renderBrailleBar([{ value: 0, color: '' }, { value: 0, color: '' }], 10);
    const visible = stripAnsi(result);
    assert.strictEqual(visible.length, 10);
    for (const ch of visible) {
      assert.strictEqual(ch, '\u2800');
    }
  });

  it('renders a half-filled bar with correct length', () => {
    const result = renderBrailleBar(
      [{ value: 0.5, color: GREEN }, { value: 0.5, color: DIM }],
      10
    );
    const visible = stripAnsi(result);
    assert.strictEqual(visible.length, 10);
  });

  it('renders multiple segments totaling 1.0', () => {
    const result = renderBrailleBar([
      { value: 0.25, color: GREEN },
      { value: 0.25, color: BLUE },
      { value: 0.25, color: CYAN },
      { value: 0.25, color: YELLOW },
    ], 20);
    const visible = stripAnsi(result);
    assert.strictEqual(visible.length, 20);
  });

  it('uses fractional braille characters for sub-character precision', () => {
    // With width=1, value=0.5 filled + 0.5 empty should produce a partial braille character.
    // 0.5 * 8 = 4 sub-positions for the filled segment.
    // The filled segment has 4/8 overlap in the cell, empty has 4/8.
    // The dominant segment (4 vs 4) depends on which is checked first (filled wins).
    const result = renderBrailleBar(
      [{ value: 0.5, color: GREEN }, { value: 0.5, color: DIM }],
      1
    );
    const visible = stripAnsi(result);
    assert.strictEqual(visible.length, 1);
  });

  it('handles very small segments', () => {
    // A tiny segment in a large bar
    const result = renderBrailleBar([
      { value: 0.01, color: GREEN },
      { value: 0.99, color: DIM },
    ], 20);
    const visible = stripAnsi(result);
    assert.strictEqual(visible.length, 20);
  });
});

describe('renderContextBarBraille', () => {
  it('renders correctly with known token values', () => {
    const proc = {
      inputTokens: 50000,
      cacheCreateTokens: 30000,
      cacheReadTokens: 20000,
      outputTokens: 10000,
    };
    const result = renderContextBarBraille(proc, 40);
    assert.ok(result.bar, 'bar string should exist');
    assert.ok(result.segments, 'segments array should exist');
    assert.strictEqual(result.segments.length, 5);
    const visible = stripAnsi(result.bar);
    assert.strictEqual(visible.length, 40);
  });

  it('returns correct segment names', () => {
    const proc = {
      inputTokens: 10000,
      cacheCreateTokens: 5000,
      cacheReadTokens: 3000,
      outputTokens: 2000,
    };
    const result = renderContextBarBraille(proc, 20);
    const names = result.segments.map(s => s.name);
    assert.deepStrictEqual(names, ['input', 'cache_write', 'cache_read', 'output', 'free']);
  });

  it('handles all free (zero tokens)', () => {
    const proc = {
      inputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    const result = renderContextBarBraille(proc, 30);
    assert.ok(result.bar);
    const visible = stripAnsi(result.bar);
    assert.strictEqual(visible.length, 30);
    // All segments except free should have value 0
    for (const seg of result.segments) {
      if (seg.name === 'free') {
        assert.strictEqual(seg.value, 1);
      } else {
        assert.strictEqual(seg.value, 0);
      }
    }
  });

  it('handles all used (context fully consumed)', () => {
    const limit = DEFAULT_CONFIG.contextLimit;
    const proc = {
      inputTokens: limit * 0.4,
      cacheCreateTokens: limit * 0.3,
      cacheReadTokens: limit * 0.3,
      outputTokens: 0,
    };
    const result = renderContextBarBraille(proc, 20);
    assert.ok(result.bar);
    const visible = stripAnsi(result.bar);
    assert.strictEqual(visible.length, 20);
    // Free segment should be 0
    const freeSeg = result.segments.find(s => s.name === 'free');
    assert.strictEqual(freeSeg.tokens, 0);
  });

  it('handles null token fields gracefully', () => {
    const proc = {
      inputTokens: null,
      cacheCreateTokens: null,
      cacheReadTokens: null,
      outputTokens: null,
    };
    // Should treat nulls as 0 since inputTokens || 0 = 0
    const result = renderContextBarBraille(proc, 20);
    assert.ok(result.bar);
    const visible = stripAnsi(result.bar);
    assert.strictEqual(visible.length, 20);
  });

  it('handles missing token fields gracefully', () => {
    const proc = {};
    const result = renderContextBarBraille(proc, 20);
    assert.ok(result.bar);
    const visible = stripAnsi(result.bar);
    assert.strictEqual(visible.length, 20);
  });

  it('produces correct segment proportions', () => {
    const limit = DEFAULT_CONFIG.contextLimit; // 200000
    const proc = {
      inputTokens: 40000,      // 20% of limit
      cacheCreateTokens: 20000, // 10% of limit
      cacheReadTokens: 10000,   // 5% of limit
      outputTokens: 5000,       // 2.5% of limit
    };
    // used = 40000 + 20000 + 10000 = 70000
    // free = max(0, 200000 - 70000) = 130000
    // adjustedFree = max(0, 130000 - 5000) = 125000
    // values: input=40000/200000=0.20, cw=20000/200000=0.10, cr=10000/200000=0.05,
    //         out=5000/200000=0.025, free=125000/200000=0.625
    const result = renderContextBarBraille(proc, 40);
    const inputSeg = result.segments.find(s => s.name === 'input');
    const cwSeg = result.segments.find(s => s.name === 'cache_write');
    const crSeg = result.segments.find(s => s.name === 'cache_read');
    const outSeg = result.segments.find(s => s.name === 'output');
    const freeSeg = result.segments.find(s => s.name === 'free');

    assert.ok(Math.abs(inputSeg.value - 0.20) < 0.001, `input: expected ~0.20, got ${inputSeg.value}`);
    assert.ok(Math.abs(cwSeg.value - 0.10) < 0.001, `cache_write: expected ~0.10, got ${cwSeg.value}`);
    assert.ok(Math.abs(crSeg.value - 0.05) < 0.001, `cache_read: expected ~0.05, got ${crSeg.value}`);
    assert.ok(Math.abs(outSeg.value - 0.025) < 0.001, `output: expected ~0.025, got ${outSeg.value}`);
    assert.ok(Math.abs(freeSeg.value - 0.625) < 0.001, `free: expected ~0.625, got ${freeSeg.value}`);
  });

  it('correctly stores token counts in segments', () => {
    const proc = {
      inputTokens: 12345,
      cacheCreateTokens: 6789,
      cacheReadTokens: 4321,
      outputTokens: 1111,
    };
    const result = renderContextBarBraille(proc, 20);
    const inputSeg = result.segments.find(s => s.name === 'input');
    const cwSeg = result.segments.find(s => s.name === 'cache_write');
    const crSeg = result.segments.find(s => s.name === 'cache_read');
    const outSeg = result.segments.find(s => s.name === 'output');

    assert.strictEqual(inputSeg.tokens, 12345);
    assert.strictEqual(cwSeg.tokens, 6789);
    assert.strictEqual(crSeg.tokens, 4321);
    assert.strictEqual(outSeg.tokens, 1111);
  });

  it('width parameter controls visible bar length', () => {
    const proc = {
      inputTokens: 50000,
      cacheCreateTokens: 30000,
      cacheReadTokens: 20000,
      outputTokens: 10000,
    };
    for (const w of [5, 10, 20, 40, 80]) {
      const result = renderContextBarBraille(proc, w);
      const visible = stripAnsi(result.bar);
      assert.strictEqual(visible.length, w, `Expected width ${w}, got ${visible.length}`);
    }
  });

  it('clamps values when usage exceeds context limit', () => {
    const limit = DEFAULT_CONFIG.contextLimit;
    const proc = {
      inputTokens: limit * 0.6,
      cacheCreateTokens: limit * 0.4,
      cacheReadTokens: limit * 0.3,
      outputTokens: limit * 0.1,
    };
    // Total used (1.3x limit) exceeds limit, so free=0 and values get scaled
    const result = renderContextBarBraille(proc, 20);
    assert.ok(result.bar);
    const visible = stripAnsi(result.bar);
    assert.strictEqual(visible.length, 20);
    // Sum of segment values should be <= 1.0
    const totalValue = result.segments.reduce((sum, s) => sum + s.value, 0);
    assert.ok(totalValue <= 1.001, `total value should be <= 1, got ${totalValue}`);
  });
});

describe('DEFAULT_CONFIG.contextBarStyle', () => {
  it('defaults to "block"', () => {
    assert.strictEqual(DEFAULT_CONFIG.contextBarStyle, 'block');
  });
});
