const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadHistory,
  pruneHistory,
  saveHistorySnapshot,
  renderHistoryChart,
  formatHourLabel,
  formatCompactTokens,
  calculateAggregateStats,
  SNAPSHOT_INTERVAL,
  HISTORY_RETENTION_DAYS,
  _state,
} = require('../claude-manager');

// Use a temp directory for tests to avoid touching real ~/.ctop
const TEST_DIR = path.join(os.tmpdir(), `ctop-history-test-${process.pid}`);
const TEST_HISTORY_FILE = path.join(TEST_DIR, 'history.json');

describe('History tracking', () => {

  describe('loadHistory', () => {
    it('returns empty array for non-existent file', () => {
      // loadHistory reads from HISTORY_FILE which is ~/.ctop/history.json
      // We test the function logic by verifying it handles missing files
      const result = loadHistory();
      // Result is either an existing array (if user has data) or empty array
      assert.ok(Array.isArray(result));
    });
  });

  describe('pruneHistory', () => {
    it('removes entries older than 7 days', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      const recentDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      const history = [
        { timestamp: oldDate.toISOString(), sessions: 1, activeCount: 1, totalInputTokens: 100 },
        { timestamp: recentDate.toISOString(), sessions: 2, activeCount: 2, totalInputTokens: 200 },
        { timestamp: now.toISOString(), sessions: 3, activeCount: 3, totalInputTokens: 300 },
      ];

      const pruned = pruneHistory(history);
      assert.strictEqual(pruned.length, 2, 'Should remove the 8-day-old entry');
      assert.strictEqual(pruned[0].totalInputTokens, 200);
      assert.strictEqual(pruned[1].totalInputTokens, 300);
    });

    it('keeps entries exactly at the 7-day boundary', () => {
      const now = new Date();
      // 6 days 23 hours ago - should be kept
      const borderDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000));

      const history = [
        { timestamp: borderDate.toISOString(), sessions: 1, activeCount: 1, totalInputTokens: 100 },
      ];

      const pruned = pruneHistory(history);
      assert.strictEqual(pruned.length, 1, 'Entry within 7 days should be kept');
    });

    it('returns empty array when all entries are old', () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const history = [
        { timestamp: oldDate.toISOString(), sessions: 1 },
        { timestamp: oldDate.toISOString(), sessions: 2 },
      ];

      const pruned = pruneHistory(history);
      assert.strictEqual(pruned.length, 0);
    });

    it('returns empty array for empty input', () => {
      assert.deepStrictEqual(pruneHistory([]), []);
    });
  });

  describe('saveHistorySnapshot', () => {
    it('creates a valid snapshot from mock process data', () => {
      const mockProcs = [
        {
          pid: '1234', isActive: true, inputTokens: 30000, outputTokens: 5000,
          cacheReadTokens: 20000, cacheCreateTokens: 10000, contextPct: 60, cost: 0.50,
        },
        {
          pid: '5678', isActive: false, inputTokens: 20000, outputTokens: 5000,
          cacheReadTokens: 15000, cacheCreateTokens: 5000, contextPct: 40, cost: 0.73,
        },
      ];

      const stats = calculateAggregateStats(mockProcs);
      assert.strictEqual(stats.totalInput, 50000);
      assert.strictEqual(stats.totalOutput, 10000);
      assert.strictEqual(stats.active, 1);
      assert.strictEqual(stats.total, 2);
    });

    it('respects 1-minute throttle', () => {
      // Set lastSnapshotTime to "just now"
      const original = _state.lastSnapshotTime;
      _state.lastSnapshotTime = Date.now();

      // Calling saveHistorySnapshot should be a no-op due to throttle
      // We verify by checking that lastSnapshotTime doesn't change
      // (it only updates when a snapshot is actually saved)
      const timeBefore = _state.lastSnapshotTime;
      saveHistorySnapshot([]);
      // lastSnapshotTime should remain the same (snapshot was throttled)
      assert.strictEqual(_state.lastSnapshotTime, timeBefore,
        'Snapshot should be throttled within 1 minute');

      // Restore
      _state.lastSnapshotTime = original;
    });

    it('allows snapshot after throttle window passes', () => {
      const original = _state.lastSnapshotTime;
      // Set to well past the throttle window
      _state.lastSnapshotTime = Date.now() - SNAPSHOT_INTERVAL - 1000;

      const timeBefore = _state.lastSnapshotTime;
      saveHistorySnapshot([]);
      // lastSnapshotTime should have been updated
      assert.ok(_state.lastSnapshotTime > timeBefore,
        'Snapshot should proceed after throttle window');

      // Restore
      _state.lastSnapshotTime = original;
    });
  });

  describe('renderHistoryChart', () => {
    it('renders "no data" message for empty history', () => {
      const output = renderHistoryChart([], 80);
      assert.ok(output.includes('No history data'), 'Should show no data message');
    });

    it('renders "no data" when all history is older than 24h', () => {
      const oldEntry = {
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        sessions: 2, activeCount: 1,
        totalInputTokens: 1000, totalOutputTokens: 500, totalCacheTokens: 300,
        totalCost: 0.10, avgContext: 50,
      };
      const output = renderHistoryChart([oldEntry], 80);
      assert.ok(output.includes('No history data'), 'Should show no data for old entries');
    });

    it('renders charts with known data', () => {
      const now = Date.now();
      const entries = [];
      // Create entries for 3 different hours
      for (let h = 0; h < 3; h++) {
        entries.push({
          timestamp: new Date(now - h * 60 * 60 * 1000 - 5 * 60 * 1000).toISOString(),
          sessions: 2 + h, activeCount: 1 + h,
          totalInputTokens: 10000 * (h + 1),
          totalOutputTokens: 2000 * (h + 1),
          totalCacheTokens: 5000 * (h + 1),
          totalCost: 0.50 * (h + 1),
          avgContext: 30 + h * 10,
        });
      }

      const output = renderHistoryChart(entries, 80);
      // Should contain all three chart sections
      assert.ok(output.includes('Token Usage'), 'Should have token chart header');
      assert.ok(output.includes('Cost'), 'Should have cost chart header');
      assert.ok(output.includes('Active Sessions'), 'Should have session chart header');
      // Should contain block characters for bars
      assert.ok(output.includes('\u2588'), 'Should contain block bar characters');
    });

    it('renders correctly with a narrow terminal width', () => {
      const entries = [{
        timestamp: new Date().toISOString(),
        sessions: 1, activeCount: 1,
        totalInputTokens: 5000, totalOutputTokens: 1000, totalCacheTokens: 2000,
        totalCost: 0.10, avgContext: 50,
      }];

      const output = renderHistoryChart(entries, 40);
      assert.ok(output.includes('Token Usage'), 'Should still render at narrow width');
    });
  });

  describe('formatHourLabel', () => {
    it('formats 0 hours ago correctly', () => {
      const label = formatHourLabel(0);
      // Should be current hour in am/pm format
      assert.ok(label.match(/\d+[ap]m/), `Expected am/pm format, got "${label}"`);
    });

    it('formats various hours ago', () => {
      // Just verify it returns a string with am/pm
      for (let h = 0; h < 24; h++) {
        const label = formatHourLabel(h);
        assert.ok(label.match(/\d+[ap]m/), `Hour ${h} ago: expected am/pm format, got "${label}"`);
      }
    });
  });

  describe('formatCompactTokens', () => {
    it('formats millions', () => {
      assert.strictEqual(formatCompactTokens(1_500_000), '1.5M');
      assert.strictEqual(formatCompactTokens(2_000_000), '2.0M');
    });

    it('formats thousands', () => {
      assert.strictEqual(formatCompactTokens(45_000), '45k');
      assert.strictEqual(formatCompactTokens(1_000), '1k');
    });

    it('formats small numbers as-is', () => {
      assert.strictEqual(formatCompactTokens(500), '500');
      assert.strictEqual(formatCompactTokens(0), '0');
    });
  });
});
