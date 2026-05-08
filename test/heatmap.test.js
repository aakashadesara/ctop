const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  aggregateHeatmapData,
  getHeatmapColorLevel,
  loadHistory,
  formatCompactTokens,
  _state,
} = require('../claude-manager');

// Mock scanSessionFilesForHistory to return empty during tests
// by pre-populating the cache so it doesn't scan real files
const mod = require('../src/_core');
// Reset the session scan cache to empty before each test
function clearSessionScanCache() {
  // Set the internal cache by calling aggregateHeatmapData after forcing cache
  if (mod.sessionScanCache !== undefined) {
    mod.sessionScanCache = [];
    mod.sessionScanCacheTime = Date.now();
  }
}

describe('Heatmap', () => {

  describe('aggregateHeatmapData', () => {
    beforeEach(() => {
      clearSessionScanCache();
    });

    it('returns empty map for empty history', () => {
      const result = aggregateHeatmapData([], 'tokens');
      assert.strictEqual(result.size, 0);
    });

    it('groups entries by day for tokens metric', () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const history = [
        {
          timestamp: today.toISOString(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCacheTokens: 200,
          totalCost: 0.10,
          sessions: 2,
        },
        {
          timestamp: today.toISOString(),
          totalInputTokens: 3000,
          totalOutputTokens: 1000,
          totalCacheTokens: 800,
          totalCost: 0.30,
          sessions: 1,
        },
      ];

      const result = aggregateHeatmapData(history, 'tokens');
      assert.strictEqual(result.get(todayStr), 1000 + 500 + 200 + 3000 + 1000 + 800);
    });

    it('groups entries by day for cost metric', () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const history = [
        {
          timestamp: today.toISOString(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCacheTokens: 200,
          totalCost: 0.10,
          sessions: 2,
        },
        {
          timestamp: today.toISOString(),
          totalInputTokens: 3000,
          totalOutputTokens: 1000,
          totalCacheTokens: 800,
          totalCost: 0.30,
          sessions: 1,
        },
      ];

      const result = aggregateHeatmapData(history, 'cost');
      const val = result.get(todayStr);
      assert.ok(Math.abs(val - 0.40) < 0.001, `Expected ~0.40, got ${val}`);
    });

    it('groups entries by day for sessions metric', () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const history = [
        {
          timestamp: today.toISOString(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCacheTokens: 200,
          totalCost: 0.10,
          sessions: 2,
        },
        {
          timestamp: today.toISOString(),
          totalInputTokens: 3000,
          totalOutputTokens: 1000,
          totalCacheTokens: 800,
          totalCost: 0.30,
          sessions: 3,
        },
      ];

      const result = aggregateHeatmapData(history, 'sessions');
      assert.strictEqual(result.get(todayStr), 5);
    });

    it('separates entries across different days', () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const todayStr = today.toISOString().slice(0, 10);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const history = [
        {
          timestamp: today.toISOString(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCacheTokens: 200,
          totalCost: 0.10,
          sessions: 1,
        },
        {
          timestamp: yesterday.toISOString(),
          totalInputTokens: 2000,
          totalOutputTokens: 1000,
          totalCacheTokens: 500,
          totalCost: 0.20,
          sessions: 2,
        },
      ];

      const result = aggregateHeatmapData(history, 'tokens');
      assert.strictEqual(result.get(todayStr), 1700);
      assert.strictEqual(result.get(yesterdayStr), 3500);
      assert.strictEqual(result.size, 2);
    });

    it('covers only last 12 weeks (84 days)', () => {
      const now = new Date();
      // Entry from 90 days ago (outside 12-week window)
      const oldDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      // Entry from 10 days ago (inside window)
      const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      const history = [
        {
          timestamp: oldDate.toISOString(),
          totalInputTokens: 5000,
          totalOutputTokens: 1000,
          totalCacheTokens: 500,
          totalCost: 0.50,
          sessions: 3,
        },
        {
          timestamp: recentDate.toISOString(),
          totalInputTokens: 2000,
          totalOutputTokens: 500,
          totalCacheTokens: 200,
          totalCost: 0.20,
          sessions: 1,
        },
      ];

      const result = aggregateHeatmapData(history, 'tokens');
      // Old entry should be excluded
      assert.strictEqual(result.size, 1);
      const recentStr = recentDate.toISOString().slice(0, 10);
      assert.strictEqual(result.get(recentStr), 2700);
    });

    it('handles missing token fields gracefully', () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);

      const history = [
        {
          timestamp: today.toISOString(),
          // missing all token fields
          totalCost: 0.10,
          sessions: 1,
        },
      ];

      const result = aggregateHeatmapData(history, 'tokens');
      assert.strictEqual(result.get(todayStr), 0);
    });
  });

  describe('getHeatmapColorLevel', () => {
    it('returns 0 for zero value', () => {
      assert.strictEqual(getHeatmapColorLevel(0, 100), 0);
    });

    it('returns 0 for zero maxValue', () => {
      assert.strictEqual(getHeatmapColorLevel(50, 0), 0);
    });

    it('returns 0 for very low ratio (<= 5%)', () => {
      assert.strictEqual(getHeatmapColorLevel(5, 100), 0);
    });

    it('returns 1 for low ratio (6-25%)', () => {
      assert.strictEqual(getHeatmapColorLevel(10, 100), 1);
      assert.strictEqual(getHeatmapColorLevel(25, 100), 1);
    });

    it('returns 2 for moderate ratio (26-50%)', () => {
      assert.strictEqual(getHeatmapColorLevel(30, 100), 2);
      assert.strictEqual(getHeatmapColorLevel(50, 100), 2);
    });

    it('returns 3 for high ratio (51-75%)', () => {
      assert.strictEqual(getHeatmapColorLevel(60, 100), 3);
      assert.strictEqual(getHeatmapColorLevel(75, 100), 3);
    });

    it('returns 4 for very high ratio (> 75%)', () => {
      assert.strictEqual(getHeatmapColorLevel(80, 100), 4);
      assert.strictEqual(getHeatmapColorLevel(100, 100), 4);
    });

    it('handles equal value and maxValue', () => {
      assert.strictEqual(getHeatmapColorLevel(50, 50), 4);
    });
  });

});
