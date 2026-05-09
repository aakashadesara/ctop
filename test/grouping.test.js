const { describe, it } = require('node:test');
const assert = require('node:assert');
const { groupProcesses, shortenCwd, buildGroupedFlatList } = require('../claude-manager');

function makeProc(overrides = {}) {
  return {
    pid: String(Math.floor(Math.random() * 100000)),
    cwd: '/Users/test/project-a',
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    isActive: true,
    cpu: 0,
    mem: 0,
    stat: 'R',
    startDate: new Date(),
    startTime: '1h ago',
    command: 'claude',
    status: 'ACTIVE',
    model: 'claude-sonnet-4-6',
    contextPct: 50,
    gitBranch: 'main',
    slug: null,
    isZombie: false,
    isStopped: false,
    ...overrides,
  };
}

describe('groupProcesses', () => {
  it('groups processes by cwd', () => {
    const procs = [
      makeProc({ cwd: '/a' }),
      makeProc({ cwd: '/b' }),
      makeProc({ cwd: '/a' }),
    ];
    const groups = groupProcesses(procs);
    assert.strictEqual(groups.length, 2);
    const cwds = groups.map(g => g.cwd);
    assert.ok(cwds.includes('/a'));
    assert.ok(cwds.includes('/b'));
  });

  it('computes correct aggregate stats for cost', () => {
    const procs = [
      makeProc({ cwd: '/a', cost: 1.50 }),
      makeProc({ cwd: '/a', cost: 2.00 }),
      makeProc({ cwd: '/b', cost: 0.50 }),
    ];
    const groups = groupProcesses(procs);
    const groupA = groups.find(g => g.cwd === '/a');
    const groupB = groups.find(g => g.cwd === '/b');
    assert.ok(Math.abs(groupA.totalCost - 3.50) < 0.001);
    assert.ok(Math.abs(groupB.totalCost - 0.50) < 0.001);
  });

  it('computes correct aggregate tokens', () => {
    const procs = [
      makeProc({ cwd: '/a', inputTokens: 1000, outputTokens: 500 }),
      makeProc({ cwd: '/a', inputTokens: 2000, outputTokens: 300 }),
    ];
    const groups = groupProcesses(procs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].totalTokens, 3800); // 1000+500+2000+300
  });

  it('counts active processes correctly', () => {
    const procs = [
      makeProc({ cwd: '/a', isActive: true }),
      makeProc({ cwd: '/a', isActive: false }),
      makeProc({ cwd: '/a', isActive: true }),
    ];
    const groups = groupProcesses(procs);
    assert.strictEqual(groups[0].activeCount, 2);
  });

  it('groups processes with same cwd together', () => {
    const procs = [
      makeProc({ cwd: '/project', pid: '100' }),
      makeProc({ cwd: '/other', pid: '200' }),
      makeProc({ cwd: '/project', pid: '300' }),
      makeProc({ cwd: '/project', pid: '400' }),
    ];
    const groups = groupProcesses(procs);
    const projectGroup = groups.find(g => g.cwd === '/project');
    assert.strictEqual(projectGroup.procs.length, 3);
    const pids = projectGroup.procs.map(p => p.pid);
    assert.ok(pids.includes('100'));
    assert.ok(pids.includes('300'));
    assert.ok(pids.includes('400'));
  });

  it('puts processes without cwd into unknown group', () => {
    const procs = [
      makeProc({ cwd: null }),
      makeProc({ cwd: undefined }),
      makeProc({ cwd: '/known' }),
    ];
    const groups = groupProcesses(procs);
    const unknownGroup = groups.find(g => g.cwd === 'unknown');
    assert.ok(unknownGroup, 'should have an unknown group');
    assert.strictEqual(unknownGroup.procs.length, 2);
  });

  it('sorts groups by cost descending', () => {
    const procs = [
      makeProc({ cwd: '/cheap', cost: 0.10 }),
      makeProc({ cwd: '/expensive', cost: 5.00 }),
      makeProc({ cwd: '/medium', cost: 1.50 }),
    ];
    const groups = groupProcesses(procs);
    assert.strictEqual(groups[0].cwd, '/expensive');
    assert.strictEqual(groups[1].cwd, '/medium');
    assert.strictEqual(groups[2].cwd, '/cheap');
  });

  it('returns empty array for empty input', () => {
    const groups = groupProcesses([]);
    assert.deepStrictEqual(groups, []);
  });

  it('handles processes with zero or null cost', () => {
    const procs = [
      makeProc({ cwd: '/a', cost: null }),
      makeProc({ cwd: '/a', cost: 0 }),
      makeProc({ cwd: '/a', cost: 1.00 }),
    ];
    const groups = groupProcesses(procs);
    // null coerces to 0 via (proc.cost || 0)
    assert.ok(Math.abs(groups[0].totalCost - 1.00) < 0.001);
  });
});

describe('shortenCwd', () => {
  it('replaces home directory with ~', () => {
    const os = require('os');
    const home = os.homedir();
    const result = shortenCwd(home + '/projects/test');
    assert.strictEqual(result, '~/projects/test');
  });

  it('returns unknown for null/undefined', () => {
    assert.strictEqual(shortenCwd(null), 'unknown');
    assert.strictEqual(shortenCwd(undefined), 'unknown');
  });

  it('leaves non-home paths unchanged', () => {
    assert.strictEqual(shortenCwd('/var/log'), '/var/log');
  });
});

describe('buildGroupedFlatList', () => {
  it('builds collapsed list with only group headers', () => {
    const procs = [
      makeProc({ cwd: '/a', cost: 1.00 }),
      makeProc({ cwd: '/b', cost: 0.50 }),
    ];
    const items = buildGroupedFlatList(procs);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].type, 'group');
    assert.strictEqual(items[1].type, 'group');
  });

  it('includes child processes when group is expanded', () => {
    // Access the expandedGroups set through the module state
    const core = require('../claude-manager');
    const { expandedGroups } = core._state;
    expandedGroups.clear();
    expandedGroups.add('/a');

    const procs = [
      makeProc({ cwd: '/a', cost: 1.00, pid: '111' }),
      makeProc({ cwd: '/a', cost: 0.50, pid: '222' }),
      makeProc({ cwd: '/b', cost: 0.25, pid: '333' }),
    ];
    const items = buildGroupedFlatList(procs);
    // Group /a header + 2 child processes + Group /b header = 4
    assert.strictEqual(items.length, 4);
    assert.strictEqual(items[0].type, 'group');
    assert.strictEqual(items[0].group.cwd, '/a');
    assert.strictEqual(items[1].type, 'process');
    assert.strictEqual(items[2].type, 'process');
    assert.strictEqual(items[3].type, 'group');
    assert.strictEqual(items[3].group.cwd, '/b');

    // Cleanup
    expandedGroups.clear();
  });
});
