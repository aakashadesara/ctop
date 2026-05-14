const { describe, it } = require('node:test');
const assert = require('node:assert');
const { calculateCost, formatCost, MODEL_PRICING } = require('../claude-manager');

describe('calculateCost', () => {
  it('returns null when no model', () => {
    const proc = { model: null, inputTokens: 1000 };
    assert.strictEqual(calculateCost(proc), null);
  });

  it('returns null when inputTokens is null', () => {
    const proc = { model: 'claude-sonnet-4-6', inputTokens: null };
    assert.strictEqual(calculateCost(proc), null);
  });

  it('returns null when both model and tokens are missing', () => {
    const proc = {};
    assert.strictEqual(calculateCost(proc), null);
  });

  it('calculates cost for claude-sonnet-4-6 with known token counts', () => {
    const proc = {
      model: 'claude-sonnet-4-6',
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheCreateTokens: 50_000,
      cacheReadTokens: 200_000,
    };
    // input: 100000 * 3 / 1M = 0.30
    // output: 10000 * 15 / 1M = 0.15
    // cacheWrite: 50000 * 3.75 / 1M = 0.1875
    // cacheRead: 200000 * 0.30 / 1M = 0.06
    // total = 0.6975
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 0.6975) < 0.0001, `Expected ~0.6975, got ${cost}`);
  });

  it('calculates cost for claude-opus-4-6', () => {
    const proc = {
      model: 'claude-opus-4-6',
      inputTokens: 50_000,
      outputTokens: 5_000,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    };
    // input: 50000 * 15 / 1M = 0.75
    // output: 5000 * 75 / 1M = 0.375
    // total = 1.125
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 1.125) < 0.0001, `Expected ~1.125, got ${cost}`);
  });

  it('calculates cost for claude-haiku-4-5', () => {
    const proc = {
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    };
    // input: 1000000 * 0.80 / 1M = 0.80
    // output: 100000 * 4 / 1M = 0.40
    // total = 1.20
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 1.20) < 0.0001, `Expected ~1.20, got ${cost}`);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const proc = {
      model: 'claude-unknown-model',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    };
    // Falls back to sonnet: 1000000 * 3 / 1M = 3.00
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 3.0) < 0.0001, `Expected ~3.0, got ${cost}`);
  });

  it('uses opus pricing when model name contains "opus"', () => {
    const proc = {
      model: 'claude-opus-future-version',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    };
    // opus: 1000000 * 15 / 1M = 15.00
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 15.0) < 0.0001, `Expected ~15.0, got ${cost}`);
  });

  it('uses haiku pricing when model name contains "haiku"', () => {
    const proc = {
      model: 'claude-haiku-future',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    };
    // haiku: 1000000 * 0.80 / 1M = 0.80
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 0.80) < 0.0001, `Expected ~0.80, got ${cost}`);
  });

  it('handles zero tokens correctly', () => {
    const proc = {
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    };
    const cost = calculateCost(proc);
    assert.strictEqual(cost, 0);
  });

  it('handles missing optional token fields', () => {
    const proc = {
      model: 'claude-sonnet-4-6',
      inputTokens: 100_000,
      // outputTokens, cacheCreateTokens, cacheReadTokens are undefined
    };
    // input: 100000 * 3 / 1M = 0.30
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 0.30) < 0.0001, `Expected ~0.30, got ${cost}`);
  });

  it('calculates correctly for older model claude-3-5-sonnet-20241022', () => {
    const proc = {
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 200_000,
      outputTokens: 20_000,
      cacheCreateTokens: 100_000,
      cacheReadTokens: 500_000,
    };
    // input: 200000 * 3 / 1M = 0.60
    // output: 20000 * 15 / 1M = 0.30
    // cacheWrite: 100000 * 3.75 / 1M = 0.375
    // cacheRead: 500000 * 0.30 / 1M = 0.15
    // total = 1.425
    const cost = calculateCost(proc);
    assert.ok(Math.abs(cost - 1.425) < 0.0001, `Expected ~1.425, got ${cost}`);
  });
});

describe('formatCost', () => {
  it('returns "--" for null cost', () => {
    assert.strictEqual(formatCost(null), '--');
  });

  it('returns "<$0.01" for very small costs', () => {
    assert.strictEqual(formatCost(0.001), '<$0.01');
    assert.strictEqual(formatCost(0.009), '<$0.01');
    assert.strictEqual(formatCost(0.0099), '<$0.01');
  });

  it('returns "<$0.01" for zero cost', () => {
    assert.strictEqual(formatCost(0), '<$0.01');
  });

  it('formats costs at exactly $0.01', () => {
    assert.strictEqual(formatCost(0.01), '$0.01');
  });

  it('formats typical costs with two decimal places', () => {
    assert.strictEqual(formatCost(1.23), '$1.23');
    assert.strictEqual(formatCost(0.50), '$0.50');
    assert.strictEqual(formatCost(15.00), '$15.00');
  });

  it('formats large costs correctly', () => {
    assert.strictEqual(formatCost(100.99), '$100.99');
  });

  it('rounds to two decimal places', () => {
    assert.strictEqual(formatCost(1.999), '$2.00');
    assert.strictEqual(formatCost(1.456), '$1.46');
  });
});

describe('MODEL_PRICING', () => {
  it('contains expected model entries', () => {
    assert.ok(MODEL_PRICING['claude-sonnet-4-6']);
    assert.ok(MODEL_PRICING['claude-opus-4-6']);
    assert.ok(MODEL_PRICING['claude-haiku-4-5']);
    assert.ok(MODEL_PRICING['claude-3-5-sonnet-20241022']);
    assert.ok(MODEL_PRICING['claude-3-opus-20240229']);
  });

  it('has correct pricing structure for each model', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      assert.ok(typeof pricing.input === 'number', `${model} missing input price`);
      assert.ok(typeof pricing.output === 'number', `${model} missing output price`);
      assert.ok(typeof pricing.cacheWrite === 'number', `${model} missing cacheWrite price`);
      assert.ok(typeof pricing.cacheRead === 'number', `${model} missing cacheRead price`);
      // Free/local models (e.g., ollama) have all-zero pricing
      if (pricing.input > 0) {
        assert.ok(pricing.output > pricing.input, `${model}: output should cost more than input`);
        assert.ok(pricing.cacheWrite > pricing.cacheRead, `${model}: cache write should cost more than cache read`);
      }
    }
  });
});
