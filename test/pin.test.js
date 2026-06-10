const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Point persistence at a throwaway file BEFORE requiring the module so no test ever
// touches the real ~/.ctop/pins.json.
const TEST_PINS_FILE = path.join(os.tmpdir(), `ctop-pins-test-${process.pid}.json`);
process.env.CTOP_PINS_FILE = TEST_PINS_FILE;

const {
  pinKey,
  isPinned,
  togglePin,
  partitionPinned,
  togglePinAndReflow,
  buildGroupedFlatList,
  applySortAndFilter,
  loadPins,
  savePins,
  pinsFilePath,
  renderProcessRow,
  PINNED_GROUP_CWD,
  _state,
} = require('../claude-manager');

function makeProc(pid, overrides = {}) {
  return {
    pid: String(pid),
    agentType: 'claude',
    cwd: '/home/user/project',
    slug: `slug-${pid}`,
    sessionTitle: null,
    sessionId: `sid-${pid}`,
    isActive: true,
    cpu: 0, mem: 0,
    contextPct: 50,
    startDate: new Date(1_000_000 + Number(pid)),
    startTime: '1h ago',
    model: 'claude-sonnet-4-6',
    status: 'ACTIVE',
    ...overrides,
  };
}

function rmTestFile() {
  try { fs.unlinkSync(TEST_PINS_FILE); } catch {}
}

beforeEach(() => {
  _state.pinnedKeys.clear();
  _state.markedPids.clear();
  _state.processes = [];
  _state.allProcesses = [];
  _state.selectedIndex = 0;
  _state.groupByProject = false;
  _state.groupedFlatList = [];
  _state.filterText = '';
  _state.sortMode = 'age';
  _state.sortReverse = false;
  _state.searchQuery = '';
  _state.searchResults = new Set();
  rmTestFile();
});

afterEach(rmTestFile);

describe('pinKey — stable identity', () => {
  it('prefers the session id', () => {
    assert.equal(pinKey(makeProc('1', { sessionId: 'abc' })), 'claude:sid:abc');
  });

  it('falls back to cwd + slug when there is no session id', () => {
    const k = pinKey(makeProc('1', { sessionId: null, cwd: '/p', slug: 'feature' }));
    assert.equal(k, 'claude:cwd:/p:feature');
  });

  it('falls back to pid when there is no session id or cwd', () => {
    assert.equal(pinKey(makeProc('77', { sessionId: null, cwd: null })), 'claude:pid:77');
  });

  it('is namespaced by agent type so identical ids across agents do not collide', () => {
    assert.notEqual(
      pinKey(makeProc('1', { agentType: 'claude', sessionId: 'x' })),
      pinKey(makeProc('1', { agentType: 'codex', sessionId: 'x' })),
    );
  });

  it('returns null for a null proc (e.g. a group header)', () => {
    assert.equal(pinKey(null), null);
  });
});

describe('isPinned / togglePin', () => {
  it('toggles pin state on and back off', () => {
    const p = makeProc('1');
    assert.equal(isPinned(p), false);
    assert.equal(togglePin(p), true);
    assert.equal(isPinned(p), true);
    assert.equal(togglePin(p), false);
    assert.equal(isPinned(p), false);
  });

  it('matches a different proc object with the same stable identity', () => {
    togglePin(makeProc('1', { sessionId: 'same' }));
    // A fresh refresh hands us a new object (new pid even) for the same session.
    assert.ok(isPinned(makeProc('999', { sessionId: 'same' })), 'pin follows the session, not the pid');
  });

  it('is a no-op for a null proc', () => {
    assert.equal(togglePin(null), false);
    assert.equal(_state.pinnedKeys.size, 0);
  });
});

describe('partitionPinned', () => {
  it('returns the list untouched when nothing is pinned', () => {
    const list = [makeProc('1'), makeProc('2')];
    const { pinned, rest } = partitionPinned(list);
    assert.equal(pinned.length, 0);
    assert.equal(rest, list);
  });

  it('splits pinned to the front, preserving relative order', () => {
    const a = makeProc('1'), b = makeProc('2'), c = makeProc('3');
    togglePin(b);
    const { pinned, rest } = partitionPinned([a, b, c]);
    assert.deepEqual(pinned.map(p => p.pid), ['2']);
    assert.deepEqual(rest.map(p => p.pid), ['1', '3']);
  });
});

describe('applySortAndFilter — pinned float to the top', () => {
  it('moves pinned sessions above the sorted rest', () => {
    const procs = [makeProc('1'), makeProc('2'), makeProc('3')];
    _state.allProcesses = procs;
    togglePin(procs[2]); // pin the last one
    applySortAndFilter();
    assert.equal(_state.processes[0].pid, '3', 'pinned is first');
    assert.deepEqual(_state.processes.slice(1).map(p => p.pid), ['1', '2']);
  });

  it('keeps pinned ordering stable under reverse sort', () => {
    const procs = [makeProc('1'), makeProc('2'), makeProc('3')];
    _state.allProcesses = procs;
    togglePin(procs[0]);
    _state.sortReverse = true;
    applySortAndFilter();
    assert.equal(_state.processes[0].pid, '1', 'pinned still first even when the rest is reversed');
  });

  it('does not resurrect a pinned session that the filter excluded', () => {
    const keep = makeProc('1', { slug: 'keepme' });
    const drop = makeProc('2', { slug: 'other', cwd: '/zzz', model: 'x' });
    _state.allProcesses = [keep, drop];
    togglePin(drop);
    _state.filterText = 'keepme';
    applySortAndFilter();
    assert.deepEqual(_state.processes.map(p => p.pid), ['1'], 'filtered-out pin stays hidden');
  });
});

describe('buildGroupedFlatList — Pinned pseudo-group', () => {
  it('has no pinned group when nothing is pinned', () => {
    const items = buildGroupedFlatList([makeProc('1'), makeProc('2')]);
    assert.ok(!items.some(i => i.type === 'group' && i.group.isPinned));
  });

  it('prepends a Pinned group and pulls pinned procs out of their project group', () => {
    const a = makeProc('1', { cwd: '/proj' });
    const b = makeProc('2', { cwd: '/proj' });
    togglePin(a);
    const items = buildGroupedFlatList([a, b]);

    // First item is the pinned group header.
    assert.equal(items[0].type, 'group');
    assert.equal(items[0].group.isPinned, true);
    assert.equal(items[0].group.cwd, PINNED_GROUP_CWD);
    assert.equal(items[1].type, 'process');
    assert.equal(items[1].proc.pid, '1');

    // The pinned pid appears exactly once across the whole flat list.
    const pidCounts = items.filter(i => i.type === 'process').map(i => i.proc.pid);
    assert.equal(pidCounts.filter(p => p === '1').length, 1, 'no duplicate of the pinned row');

    // The /proj group below it only has the unpinned session.
    const projGroup = items.find(i => i.type === 'group' && !i.group.isPinned);
    assert.deepEqual(projGroup.group.procs.map(p => p.pid), ['2']);
  });
});

describe('togglePinAndReflow', () => {
  it('pins, re-sorts, and keeps the cursor on the toggled session', () => {
    const procs = [makeProc('1'), makeProc('2'), makeProc('3')];
    _state.allProcesses = procs;
    applySortAndFilter();
    _state.selectedIndex = 2; // cursor on pid 3
    togglePinAndReflow(_state.processes[2]);
    assert.equal(_state.processes[0].pid, '3', 'toggled session jumped to the top');
    assert.equal(_state.processes[_state.selectedIndex].pid, '3', 'cursor followed it');
  });

  it('is a no-op on a null proc (group header)', () => {
    _state.allProcesses = [makeProc('1')];
    applySortAndFilter();
    togglePinAndReflow(null);
    assert.equal(_state.pinnedKeys.size, 0);
  });
});

describe('persistence', () => {
  it('round-trips pinned keys through the store file', () => {
    togglePin(makeProc('1', { sessionId: 'persist-me' }));
    assert.ok(fs.existsSync(pinsFilePath()), 'savePins wrote the file');

    _state.pinnedKeys.clear();
    assert.equal(isPinned(makeProc('1', { sessionId: 'persist-me' })), false);

    loadPins();
    assert.ok(isPinned(makeProc('1', { sessionId: 'persist-me' })), 'loadPins restored the pin');
  });

  it('tolerates a missing store file', () => {
    rmTestFile();
    assert.doesNotThrow(loadPins);
    assert.equal(_state.pinnedKeys.size, 0);
  });

  it('accepts a legacy bare-array file shape', () => {
    fs.writeFileSync(pinsFilePath(), JSON.stringify(['claude:sid:legacy']));
    loadPins();
    assert.ok(_state.pinnedKeys.has('claude:sid:legacy'));
  });
});

describe('renderProcessRow — pin star in the gutter', () => {
  const opts = {
    ctxBarMode: false, isNarrow: true, showCostCol: false, costColW: 9, pluginCols: [],
    showSparklines: false, sparkColW: 10, gitColW: 10, listWidth: 100, fixedColsTotal: 70, showDetailPane: false,
  };

  it('renders a ★ for a pinned, unselected row and none for an unpinned one', () => {
    const p = makeProc('1');
    assert.ok(!renderProcessRow(p, false, false, opts).includes('★'), 'no star before pinning');
    togglePin(p);
    assert.ok(renderProcessRow(p, false, false, opts).includes('★'), 'star after pinning');
  });

  it('shows the ★ on the selected pinned row too', () => {
    const p = makeProc('1');
    togglePin(p);
    assert.ok(renderProcessRow(p, true, false, opts).includes('★'));
  });

  it('shows a dim ☆ hint on the selected unpinned row (the click-to-pin affordance)', () => {
    assert.ok(renderProcessRow(makeProc('1'), true, false, opts).includes('☆'));
  });
});
