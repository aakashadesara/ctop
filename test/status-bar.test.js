const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  buildCostGauge,
  contextHealthDot,
  formatTimeShort,
  renderStatsBar,
  _state,
  _colors,
} = require('../claude-manager');

describe('buildCostGauge', () => {
  it('returns all empty bars when cost is 0', () => {
    const gauge = buildCostGauge(0, 50);
    assert.strictEqual(gauge, '\u2591'.repeat(8));
  });

  it('returns all filled bars when cost equals cap', () => {
    const gauge = buildCostGauge(50, 50);
    assert.strictEqual(gauge, '\u2593'.repeat(8));
  });

  it('returns half filled when cost is half of cap', () => {
    const gauge = buildCostGauge(25, 50);
    assert.strictEqual(gauge, '\u2593'.repeat(4) + '\u2591'.repeat(4));
  });

  it('clamps to full when cost exceeds cap', () => {
    const gauge = buildCostGauge(100, 50);
    assert.strictEqual(gauge, '\u2593'.repeat(8));
  });

  it('returns correct proportions for small values', () => {
    // 1/50 = 2% -> round(0.16) = 0 filled
    const gauge = buildCostGauge(1, 50);
    assert.strictEqual(gauge.length, 8);
  });

  it('gauge is always 8 characters', () => {
    for (const cost of [0, 5, 10, 25, 49, 50, 100]) {
      const gauge = buildCostGauge(cost, 50);
      assert.strictEqual(gauge.length, 8, `gauge length for cost=${cost}`);
    }
  });
});

describe('contextHealthDot', () => {
  it('returns green/ok when no processes', () => {
    const result = contextHealthDot([]);
    assert.strictEqual(result.label, 'ctx ok');
    assert.strictEqual(result.pct, 100);
  });

  it('returns green/ok when all active processes have high context', () => {
    const procs = [
      { isActive: true, contextPct: 80 },
      { isActive: true, contextPct: 60 },
    ];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx ok');
    assert.strictEqual(result.pct, 60);
  });

  it('returns yellow/warn when worst context is between 10-40%', () => {
    const procs = [
      { isActive: true, contextPct: 80 },
      { isActive: true, contextPct: 25 },
    ];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx warn');
    assert.strictEqual(result.pct, 25);
  });

  it('returns red/crit when worst context is below 10%', () => {
    const procs = [
      { isActive: true, contextPct: 50 },
      { isActive: true, contextPct: 5 },
    ];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx crit');
    assert.strictEqual(result.pct, 5);
  });

  it('ignores dead processes', () => {
    const procs = [
      { isActive: false, contextPct: 2 },
      { isActive: true, contextPct: 80 },
    ];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx ok');
    assert.strictEqual(result.pct, 80);
  });

  it('returns ok when active processes have null contextPct', () => {
    const procs = [
      { isActive: true, contextPct: null },
    ];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx ok');
    assert.strictEqual(result.pct, 100);
  });

  it('boundary: exactly 10% is warn, not crit', () => {
    const procs = [{ isActive: true, contextPct: 10 }];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx warn');
  });

  it('boundary: exactly 40% is ok, not warn', () => {
    const procs = [{ isActive: true, contextPct: 40 }];
    const result = contextHealthDot(procs);
    assert.strictEqual(result.label, 'ctx ok');
  });
});

describe('formatTimeShort', () => {
  it('formats morning time without seconds', () => {
    const d = new Date(2025, 0, 1, 9, 5, 30);
    assert.strictEqual(formatTimeShort(d), '9:05 AM');
  });

  it('formats afternoon time', () => {
    const d = new Date(2025, 0, 1, 14, 30, 0);
    assert.strictEqual(formatTimeShort(d), '2:30 PM');
  });

  it('formats midnight as 12:00 AM', () => {
    const d = new Date(2025, 0, 1, 0, 0, 0);
    assert.strictEqual(formatTimeShort(d), '12:00 AM');
  });

  it('formats noon as 12:00 PM', () => {
    const d = new Date(2025, 0, 1, 12, 0, 0);
    assert.strictEqual(formatTimeShort(d), '12:00 PM');
  });

  it('pads minutes with leading zero', () => {
    const d = new Date(2025, 0, 1, 8, 3, 0);
    assert.strictEqual(formatTimeShort(d), '8:03 AM');
  });

  it('does not include seconds', () => {
    const d = new Date(2025, 0, 1, 15, 45, 59);
    const result = formatTimeShort(d);
    assert.ok(!result.includes('59'), 'should not contain seconds');
    assert.strictEqual(result, '3:45 PM');
  });
});

describe('renderStatsBar', () => {
  // Save original state
  let origProcesses, origAllProcesses, origSortMode, origSortReverse, origNotif;

  it('produces a string with active/dead pills', () => {
    origAllProcesses = _state.allProcesses;
    origProcesses = _state.processes;
    origSortMode = _state.sortMode;
    origSortReverse = _state.sortReverse;
    origNotif = _state.notificationsEnabled;

    _state.allProcesses = [
      { isActive: true, cost: 1.5, contextPct: 80 },
      { isActive: true, cost: 0.5, contextPct: 50 },
      { isActive: false, cost: 0.2, contextPct: null },
    ];
    _state.processes = _state.allProcesses;
    _state.sortMode = 'age';
    _state.sortReverse = false;
    _state.notificationsEnabled = true;

    const bar = renderStatsBar(120);
    // Strip ANSI for content checks
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');

    assert.ok(plain.includes('2 active'), 'should show active count');
    assert.ok(plain.includes('1 dead'), 'should show dead count');
  });

  it('includes cost gauge characters', () => {
    const bar = renderStatsBar(120);
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('$2.20'), 'should show total cost');
    // Should have gauge characters
    assert.ok(plain.includes('\u2591') || plain.includes('\u2593'), 'should contain gauge characters');
  });

  it('includes context health indicator', () => {
    const bar = renderStatsBar(120);
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('ctx ok'), 'should show context health');
  });

  it('includes sort indicator', () => {
    _state.sortMode = 'cpu';
    const bar = renderStatsBar(120);
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('cpu'), 'should show sort mode');
    _state.sortMode = 'age';
  });

  it('includes notification indicator', () => {
    const bar = renderStatsBar(120);
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('on'), 'should show notification status');
  });

  it('shows time without seconds', () => {
    const bar = renderStatsBar(120);
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');
    // Time should be in HH:MM AM/PM format (no seconds)
    assert.ok(plain.match(/\d{1,2}:\d{2}\s+(AM|PM)/), 'should have HH:MM AM/PM format');
  });

  it('uses thin separators', () => {
    const bar = renderStatsBar(120);
    const plain = bar.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(plain.includes('\u2502'), 'should use thin pipe separators');
  });

  // Restore state
  it('cleanup', () => {
    _state.allProcesses = origAllProcesses || [];
    _state.processes = origProcesses || [];
    _state.sortMode = origSortMode || 'age';
    _state.sortReverse = origSortReverse || false;
    _state.notificationsEnabled = origNotif != null ? origNotif : true;
  });
});
