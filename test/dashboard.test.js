const { describe, it } = require('node:test');
const assert = require('node:assert');
const { calculateAggregateStats, formatTokenCount } = require('../claude-manager');

describe('formatTokenCount', () => {
  it('returns "--" for null', () => {
    assert.strictEqual(formatTokenCount(null), '--');
  });

  it('returns "--" for undefined', () => {
    assert.strictEqual(formatTokenCount(undefined), '--');
  });

  it('formats zero', () => {
    assert.strictEqual(formatTokenCount(0), '0');
  });

  it('formats small numbers without commas', () => {
    assert.strictEqual(formatTokenCount(999), '999');
  });

  it('formats thousands with commas', () => {
    assert.strictEqual(formatTokenCount(1000), '1,000');
    assert.strictEqual(formatTokenCount(12345), '12,345');
  });

  it('formats large numbers with commas', () => {
    assert.strictEqual(formatTokenCount(1000000), '1,000,000');
    assert.strictEqual(formatTokenCount(1234567), '1,234,567');
  });

  it('formats very large token counts', () => {
    assert.strictEqual(formatTokenCount(10000000), '10,000,000');
  });
});

describe('calculateAggregateStats', () => {
  it('returns zeros for empty array', () => {
    const stats = calculateAggregateStats([]);
    assert.strictEqual(stats.totalInput, 0);
    assert.strictEqual(stats.totalOutput, 0);
    assert.strictEqual(stats.totalCacheRead, 0);
    assert.strictEqual(stats.totalCacheWrite, 0);
    assert.strictEqual(stats.totalCache, 0);
    assert.strictEqual(stats.totalCost, 0);
    assert.strictEqual(stats.avgContextUtil, null);
    assert.strictEqual(stats.active, 0);
    assert.strictEqual(stats.dead, 0);
    assert.strictEqual(stats.total, 0);
  });

  it('sums token counts across processes', () => {
    const procs = [
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheCreateTokens: 100, cost: 0.10, contextPct: 80, isActive: true },
      { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 300, cacheCreateTokens: 150, cost: 0.20, contextPct: 60, isActive: true },
    ];
    const stats = calculateAggregateStats(procs);
    assert.strictEqual(stats.totalInput, 3000);
    assert.strictEqual(stats.totalOutput, 1300);
    assert.strictEqual(stats.totalCacheRead, 500);
    assert.strictEqual(stats.totalCacheWrite, 250);
    assert.strictEqual(stats.totalCache, 750);
  });

  it('sums cost across processes', () => {
    const procs = [
      { inputTokens: 0, outputTokens: 0, cost: 1.50, isActive: true },
      { inputTokens: 0, outputTokens: 0, cost: 2.25, isActive: false },
    ];
    const stats = calculateAggregateStats(procs);
    assert.ok(Math.abs(stats.totalCost - 3.75) < 0.001);
  });

  it('counts active and dead sessions', () => {
    const procs = [
      { inputTokens: 0, outputTokens: 0, cost: 0, isActive: true },
      { inputTokens: 0, outputTokens: 0, cost: 0, isActive: true },
      { inputTokens: 0, outputTokens: 0, cost: 0, isActive: false },
    ];
    const stats = calculateAggregateStats(procs);
    assert.strictEqual(stats.active, 2);
    assert.strictEqual(stats.dead, 1);
    assert.strictEqual(stats.total, 3);
  });

  it('calculates average context utilization from valid values', () => {
    // contextPct is "remaining %", utilization = 100 - remaining
    const procs = [
      { inputTokens: 0, outputTokens: 0, cost: 0, contextPct: 80, isActive: true }, // 20% used
      { inputTokens: 0, outputTokens: 0, cost: 0, contextPct: 40, isActive: true }, // 60% used
    ];
    const stats = calculateAggregateStats(procs);
    // avg utilization = (20 + 60) / 2 = 40
    assert.strictEqual(stats.avgContextUtil, 40);
  });

  it('skips null contextPct in average calculation', () => {
    const procs = [
      { inputTokens: 0, outputTokens: 0, cost: 0, contextPct: null, isActive: true },
      { inputTokens: 0, outputTokens: 0, cost: 0, contextPct: 50, isActive: true }, // 50% used
    ];
    const stats = calculateAggregateStats(procs);
    // Only one valid value: utilization = 50
    assert.strictEqual(stats.avgContextUtil, 50);
  });

  it('returns null avgContextUtil when no sessions have context data', () => {
    const procs = [
      { inputTokens: 0, outputTokens: 0, cost: 0, contextPct: null, isActive: true },
      { inputTokens: 0, outputTokens: 0, cost: 0, isActive: false },
    ];
    const stats = calculateAggregateStats(procs);
    assert.strictEqual(stats.avgContextUtil, null);
  });

  it('handles processes with null token fields', () => {
    const procs = [
      { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreateTokens: null, cost: null, isActive: true },
      { inputTokens: 5000, outputTokens: 1000, cacheReadTokens: 200, cacheCreateTokens: 100, cost: 0.50, isActive: true },
    ];
    const stats = calculateAggregateStats(procs);
    assert.strictEqual(stats.totalInput, 5000);
    assert.strictEqual(stats.totalOutput, 1000);
    assert.strictEqual(stats.totalCacheRead, 200);
    assert.strictEqual(stats.totalCacheWrite, 100);
    assert.strictEqual(stats.totalCache, 300);
    assert.ok(Math.abs(stats.totalCost - 0.50) < 0.001);
  });

  it('handles single process correctly', () => {
    const procs = [
      { inputTokens: 100000, outputTokens: 50000, cacheReadTokens: 30000, cacheCreateTokens: 20000, cost: 1.23, contextPct: 30, isActive: false },
    ];
    const stats = calculateAggregateStats(procs);
    assert.strictEqual(stats.totalInput, 100000);
    assert.strictEqual(stats.totalOutput, 50000);
    assert.strictEqual(stats.totalCacheRead, 30000);
    assert.strictEqual(stats.totalCacheWrite, 20000);
    assert.strictEqual(stats.totalCache, 50000);
    assert.ok(Math.abs(stats.totalCost - 1.23) < 0.001);
    assert.strictEqual(stats.avgContextUtil, 70); // 100 - 30
    assert.strictEqual(stats.active, 0);
    assert.strictEqual(stats.dead, 1);
  });
});
