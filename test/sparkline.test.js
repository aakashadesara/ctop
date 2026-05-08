const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { renderSparkline, updateProcessHistory, processHistory, SPARKLINE_BLOCKS, SPARKLINE_MAX_POINTS } = require('../claude-manager');

describe('renderSparkline', () => {
  it('returns empty string for empty array', () => {
    assert.equal(renderSparkline([]), '');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(renderSparkline(null), '');
    assert.equal(renderSparkline(undefined), '');
  });

  it('renders a single value', () => {
    const result = renderSparkline([50]);
    assert.equal(result.length, 1);
  });

  it('renders lowest block for 0', () => {
    const result = renderSparkline([0]);
    assert.equal(result, SPARKLINE_BLOCKS[0]);
  });

  it('renders highest block for 100', () => {
    const result = renderSparkline([100]);
    assert.equal(result, SPARKLINE_BLOCKS[7]);
  });

  it('renders increasing values as ascending blocks', () => {
    const result = renderSparkline([0, 25, 50, 75, 100]);
    assert.equal(result.length, 5);
    // Each character should be >= the previous one
    for (let i = 1; i < result.length; i++) {
      assert.ok(SPARKLINE_BLOCKS.indexOf(result[i]) >= SPARKLINE_BLOCKS.indexOf(result[i - 1]),
        `block at ${i} should be >= block at ${i-1}`);
    }
  });

  it('respects width parameter — truncates to last N', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = renderSparkline(values, 4);
    assert.equal(result.length, 4);
  });

  it('uses default width of 8', () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 5);
    const result = renderSparkline(values);
    assert.equal(result.length, 8);
  });

  it('clamps values above 100', () => {
    const result = renderSparkline([150, 200]);
    assert.equal(result, SPARKLINE_BLOCKS[7].repeat(2));
  });

  it('clamps negative values to 0', () => {
    const result = renderSparkline([-10, -50]);
    assert.equal(result, SPARKLINE_BLOCKS[0].repeat(2));
  });

  it('all same values produce uniform sparkline', () => {
    const result = renderSparkline([50, 50, 50, 50]);
    const chars = new Set(result.split(''));
    assert.equal(chars.size, 1);
  });
});

describe('updateProcessHistory', () => {
  beforeEach(() => {
    processHistory.clear();
  });

  it('adds entries for new processes', () => {
    updateProcessHistory([{ pid: '123', cpu: 10, mem: 20 }]);
    assert.ok(processHistory.has('123'));
    const hist = processHistory.get('123');
    assert.deepEqual(hist.cpu, [10]);
    assert.deepEqual(hist.mem, [20]);
  });

  it('appends to existing history', () => {
    updateProcessHistory([{ pid: '123', cpu: 10, mem: 20 }]);
    updateProcessHistory([{ pid: '123', cpu: 30, mem: 40 }]);
    const hist = processHistory.get('123');
    assert.deepEqual(hist.cpu, [10, 30]);
    assert.deepEqual(hist.mem, [20, 40]);
  });

  it('caps history at SPARKLINE_MAX_POINTS', () => {
    for (let i = 0; i < SPARKLINE_MAX_POINTS + 5; i++) {
      updateProcessHistory([{ pid: '123', cpu: i, mem: i }]);
    }
    const hist = processHistory.get('123');
    assert.equal(hist.cpu.length, SPARKLINE_MAX_POINTS);
    assert.equal(hist.mem.length, SPARKLINE_MAX_POINTS);
    // Should have dropped the oldest values
    assert.equal(hist.cpu[0], 5);
  });

  it('removes stale PIDs', () => {
    updateProcessHistory([{ pid: '111', cpu: 1, mem: 1 }, { pid: '222', cpu: 2, mem: 2 }]);
    assert.ok(processHistory.has('111'));
    assert.ok(processHistory.has('222'));
    // Only 222 in next update — 111 should be pruned
    updateProcessHistory([{ pid: '222', cpu: 3, mem: 3 }]);
    assert.ok(!processHistory.has('111'));
    assert.ok(processHistory.has('222'));
  });

  it('tracks multiple processes independently', () => {
    updateProcessHistory([{ pid: 'a', cpu: 10, mem: 20 }, { pid: 'b', cpu: 30, mem: 40 }]);
    assert.deepEqual(processHistory.get('a').cpu, [10]);
    assert.deepEqual(processHistory.get('b').cpu, [30]);
  });
});

describe('SPARKLINE_BLOCKS', () => {
  it('has 8 block characters', () => {
    assert.equal(SPARKLINE_BLOCKS.length, 8);
  });

  it('each character is a single-width character', () => {
    for (const ch of SPARKLINE_BLOCKS) {
      assert.equal(ch.length, 1);
    }
  });
});
