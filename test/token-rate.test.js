const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { updateTokenRates, formatTokenRate, tokenHistory } = require('../claude-manager');

describe('updateTokenRates', () => {
  beforeEach(() => {
    tokenHistory.clear();
  });

  it('sets rate to 0 for first reading', () => {
    const procs = [{ pid: '100', inputTokens: 500, outputTokens: 200, cacheCreateTokens: 0, cacheReadTokens: 0 }];
    updateTokenRates(procs);
    assert.equal(procs[0].tokenRate, 0);
    assert.ok(tokenHistory.has('100'));
    assert.equal(tokenHistory.get('100').rate, 0);
  });

  it('calculates rate with known deltas', () => {
    // First reading at time T
    const procs1 = [{ pid: '200', inputTokens: 100, outputTokens: 100, cacheCreateTokens: 0, cacheReadTokens: 0 }];
    updateTokenRates(procs1);

    // Simulate time passing: manually set lastTime to 2 seconds ago
    const entry = tokenHistory.get('200');
    entry.lastTime = Date.now() - 2000;
    entry.lastTotal = 200; // 100 + 100

    // Second reading with more tokens
    const procs2 = [{ pid: '200', inputTokens: 300, outputTokens: 300, cacheCreateTokens: 100, cacheReadTokens: 100 }];
    updateTokenRates(procs2);

    // Total now = 800, previous = 200, delta = 600, dt ~ 2s, rate ~ 300 tok/s
    const rate = procs2[0].tokenRate;
    assert.ok(rate > 250, `Expected rate > 250, got ${rate}`);
    assert.ok(rate < 350, `Expected rate < 350, got ${rate}`);
  });

  it('rate is 0 when tokens do not change', () => {
    const procs1 = [{ pid: '300', inputTokens: 500, outputTokens: 500, cacheCreateTokens: 0, cacheReadTokens: 0 }];
    updateTokenRates(procs1);

    // Simulate time passing
    const entry = tokenHistory.get('300');
    entry.lastTime = Date.now() - 3000;

    // Same token counts
    const procs2 = [{ pid: '300', inputTokens: 500, outputTokens: 500, cacheCreateTokens: 0, cacheReadTokens: 0 }];
    updateTokenRates(procs2);

    assert.equal(procs2[0].tokenRate, 0);
  });

  it('cleans up stale PIDs', () => {
    const procs1 = [
      { pid: 'a', inputTokens: 10, outputTokens: 10, cacheCreateTokens: 0, cacheReadTokens: 0 },
      { pid: 'b', inputTokens: 20, outputTokens: 20, cacheCreateTokens: 0, cacheReadTokens: 0 },
    ];
    updateTokenRates(procs1);
    assert.ok(tokenHistory.has('a'));
    assert.ok(tokenHistory.has('b'));

    // Only 'b' remains
    const procs2 = [
      { pid: 'b', inputTokens: 30, outputTokens: 30, cacheCreateTokens: 0, cacheReadTokens: 0 },
    ];
    updateTokenRates(procs2);
    assert.ok(!tokenHistory.has('a'), 'Stale PID "a" should be removed');
    assert.ok(tokenHistory.has('b'));
  });

  it('handles null token values gracefully', () => {
    const procs = [{ pid: '400', inputTokens: null, outputTokens: null, cacheCreateTokens: null, cacheReadTokens: null }];
    updateTokenRates(procs);
    assert.equal(procs[0].tokenRate, 0);
    assert.equal(tokenHistory.get('400').lastTotal, 0);
  });

  it('rate is never negative', () => {
    // First reading with high tokens
    const procs1 = [{ pid: '500', inputTokens: 1000, outputTokens: 1000, cacheCreateTokens: 0, cacheReadTokens: 0 }];
    updateTokenRates(procs1);

    // Simulate time passing
    const entry = tokenHistory.get('500');
    entry.lastTime = Date.now() - 1000;

    // Second reading with lower tokens (edge case — e.g., session reset)
    const procs2 = [{ pid: '500', inputTokens: 100, outputTokens: 100, cacheCreateTokens: 0, cacheReadTokens: 0 }];
    updateTokenRates(procs2);

    assert.ok(procs2[0].tokenRate >= 0, 'Rate should never be negative');
  });
});

describe('formatTokenRate', () => {
  it('returns "0" for rate of 0', () => {
    assert.equal(formatTokenRate(0), '0');
  });

  it('returns "0" for null', () => {
    assert.equal(formatTokenRate(null), '0');
  });

  it('returns "0" for undefined', () => {
    assert.equal(formatTokenRate(undefined), '0');
  });

  it('formats small rates as rounded integers', () => {
    assert.equal(formatTokenRate(500), '500');
    assert.equal(formatTokenRate(42.7), '43');
    assert.equal(formatTokenRate(1), '1');
    assert.equal(formatTokenRate(999), '999');
  });

  it('formats rates >= 1000 with k suffix', () => {
    assert.equal(formatTokenRate(1500), '1.5k');
    assert.equal(formatTokenRate(1000), '1.0k');
    assert.equal(formatTokenRate(50000), '50.0k');
    assert.equal(formatTokenRate(2345), '2.3k');
  });
});
