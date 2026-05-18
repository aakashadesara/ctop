const { describe, it } = require('node:test');
const assert = require('node:assert');
const alerts = require('../src/alerts');

const mkProc = (over = {}) => ({
  pid: '12345',
  agentType: 'claude',
  status: 'ACTIVE',
  contextPct: 50,
  cost: 0.5,
  cpu: 1.2,
  mem: 0.1,
  tokenRate: 5,
  lastTurnMs: 2000,
  compacted: false,
  compactionCount: 0,
  rateLimits: null,
  startTime: '5m ago',
  ...over,
});

describe('alerts.compute — low_context', () => {
  it('fires critical when context <= 8', () => {
    const out = alerts.compute([mkProc({ contextPct: 5 })], { severity: 'info' });
    const a = out.find(x => x.kind === 'low_context');
    assert.ok(a, 'expected a low_context alert');
    assert.strictEqual(a.severity, 'critical');
    assert.match(a.message, /5% context/);
  });

  it('fires warn when context is between 8 and 15', () => {
    const out = alerts.compute([mkProc({ contextPct: 12 })], { severity: 'info' });
    const a = out.find(x => x.kind === 'low_context');
    assert.ok(a);
    assert.strictEqual(a.severity, 'warn');
  });

  it('does not fire when context is healthy', () => {
    const out = alerts.compute([mkProc({ contextPct: 50 })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'low_context').length, 0);
  });

  it('does not fire when contextPct is null', () => {
    const out = alerts.compute([mkProc({ contextPct: null })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'low_context').length, 0);
  });
});

describe('alerts.compute — compacting', () => {
  it('emits an info-level alert when compacted is true', () => {
    const out = alerts.compute([mkProc({ compacted: true, compactionCount: 2 })], { severity: 'info' });
    const a = out.find(x => x.kind === 'compacting');
    assert.ok(a);
    assert.strictEqual(a.severity, 'info');
    assert.match(a.message, /count: 2/);
  });

  it('is filtered out by default severity=warn', () => {
    const out = alerts.compute([mkProc({ compacted: true })]);
    assert.strictEqual(out.filter(x => x.kind === 'compacting').length, 0);
  });
});

describe('alerts.compute — idle', () => {
  it('fires when ACTIVE with zero rate and lastTurnMs > threshold', () => {
    const out = alerts.compute([mkProc({
      status: 'ACTIVE', tokenRate: 0, lastTurnMs: 15 * 60 * 1000,
    })], { severity: 'info' });
    const a = out.find(x => x.kind === 'idle');
    assert.ok(a);
    assert.match(a.message, /15m/);
  });

  it('does not fire on fresh session (lastTurnMs not set)', () => {
    const out = alerts.compute([mkProc({
      status: 'ACTIVE', tokenRate: 0, lastTurnMs: null,
    })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'idle').length, 0);
  });

  it('does not fire on actively producing tokens', () => {
    const out = alerts.compute([mkProc({
      status: 'ACTIVE', tokenRate: 50, lastTurnMs: 20 * 60 * 1000,
    })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'idle').length, 0);
  });
});

describe('alerts.compute — ghost', () => {
  it('fires when STOPPED with significant memory', () => {
    const out = alerts.compute([mkProc({ status: 'STOPPED', mem: 1.2 })], { severity: 'info' });
    const a = out.find(x => x.kind === 'ghost');
    assert.ok(a);
    assert.match(a.suggested, /kill 12345/);
  });

  it('does not fire when memory is below threshold', () => {
    const out = alerts.compute([mkProc({ status: 'STOPPED', mem: 0.1 })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'ghost').length, 0);
  });

  it('does not fire on ACTIVE sessions even with high memory', () => {
    const out = alerts.compute([mkProc({ status: 'ACTIVE', mem: 5 })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'ghost').length, 0);
  });
});

describe('alerts.compute — rate_limited', () => {
  it('fires when rateLimits is set', () => {
    const out = alerts.compute([mkProc({ rateLimits: { remaining: 0 } })], { severity: 'info' });
    assert.ok(out.find(x => x.kind === 'rate_limited'));
  });
});

describe('alerts.compute — cost_spike', () => {
  it('fires when cost exceeds $5', () => {
    const out = alerts.compute([mkProc({ cost: 7.5 })], { severity: 'info' });
    const a = out.find(x => x.kind === 'cost_spike');
    assert.ok(a);
    assert.match(a.message, /\$7\.50/);
  });

  it('does not fire on small costs', () => {
    const out = alerts.compute([mkProc({ cost: 0.50 })], { severity: 'info' });
    assert.strictEqual(out.filter(x => x.kind === 'cost_spike').length, 0);
  });
});

describe('alerts.compute — severity filtering', () => {
  it('default severity=warn excludes info-level alerts', () => {
    const out = alerts.compute([mkProc({ compacted: true })]);
    assert.strictEqual(out.length, 0);
  });

  it('severity=critical keeps only critical', () => {
    const procs = [
      mkProc({ contextPct: 5 }),    // critical
      mkProc({ cost: 100 }),         // warn
      mkProc({ compacted: true }),   // info
    ];
    const out = alerts.compute(procs, { severity: 'critical' });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].severity, 'critical');
  });
});

describe('alerts.compute — empty input', () => {
  it('returns empty array when no procs', () => {
    assert.deepStrictEqual(alerts.compute([]), []);
  });
});
