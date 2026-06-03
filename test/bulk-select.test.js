const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMouseEvent,
  activeList,
  cursorPid,
  toggleMark,
  markRange,
  pruneMarks,
  killSelected,
  _state,
} = require('../claude-manager');

// Minimal process factory — only pid matters for the selection helpers.
function makeProc(pid, overrides = {}) {
  return { pid: String(pid), isActive: true, cwd: '/home/user/project', ...overrides };
}

// Build a groupedFlatList with interleaved group headers and process rows.
function makeGrouped(specs) {
  // specs: array of either {header:true} or pid string
  return specs.map(s =>
    s && s.header
      ? { type: 'group', group: { cwd: '/g' } }
      : { type: 'process', proc: makeProc(s), group: { cwd: '/g' } }
  );
}

beforeEach(() => {
  _state.markedPids.clear();
  _state.selectionAnchor = null;
  _state.groupByProject = false;
  _state.groupedFlatList = [];
  _state.selectedIndex = 0;
  _state.processes = [];
  _state.allProcesses = [];
});

describe('toggleMark', () => {
  it('adds then removes a pid (idempotent set semantics)', () => {
    toggleMark('100');
    assert.ok(_state.markedPids.has('100'));
    toggleMark('100');
    assert.ok(!_state.markedPids.has('100'));
  });

  it('is a no-op for null (e.g. cursor on a group header)', () => {
    toggleMark(null);
    assert.equal(_state.markedPids.size, 0);
  });
});

describe('activeList', () => {
  it('returns processes when not grouped', () => {
    _state.processes = [makeProc('1')];
    assert.equal(activeList(), _state.processes);
  });

  it('returns groupedFlatList when grouped', () => {
    _state.groupByProject = true;
    _state.groupedFlatList = makeGrouped([{ header: true }, '1']);
    assert.equal(activeList(), _state.groupedFlatList);
  });
});

describe('cursorPid', () => {
  it('returns the pid at selectedIndex in flat mode', () => {
    _state.processes = [makeProc('10'), makeProc('11'), makeProc('12')];
    _state.selectedIndex = 1;
    assert.equal(cursorPid(), '11');
  });

  it('returns null on an empty list', () => {
    _state.processes = [];
    _state.selectedIndex = 0;
    assert.equal(cursorPid(), null);
  });

  it('resolves through groupedFlatList in group mode', () => {
    _state.groupByProject = true;
    _state.groupedFlatList = makeGrouped([{ header: true }, '100', '101']);
    _state.selectedIndex = 1; // first process row
    assert.equal(cursorPid(), '100');
    _state.selectedIndex = 2;
    assert.equal(cursorPid(), '101');
  });

  it('returns null when the cursor is on a group header', () => {
    _state.groupByProject = true;
    _state.groupedFlatList = makeGrouped([{ header: true }, '100']);
    _state.selectedIndex = 0; // header row
    assert.equal(cursorPid(), null);
  });
});

describe('markRange (flat mode)', () => {
  beforeEach(() => {
    _state.processes = ['1', '2', '3', '4', '5', '6'].map(makeProc);
  });

  it('marks the inclusive index span', () => {
    markRange(1, 3);
    assert.deepEqual([..._state.markedPids].sort(), ['2', '3', '4']);
  });

  it('is order-independent (reversed anchor/target)', () => {
    markRange(3, 1);
    assert.deepEqual([..._state.markedPids].sort(), ['2', '3', '4']);
  });

  it('respects array bounds', () => {
    markRange(4, 999);
    assert.deepEqual([..._state.markedPids].sort(), ['5', '6']);
  });

  it('does nothing when anchor is null', () => {
    markRange(null, 3);
    assert.equal(_state.markedPids.size, 0);
  });
});

describe('markRange (group mode)', () => {
  beforeEach(() => {
    _state.groupByProject = true;
    // index: 0=header 1='100' 2='101' 3=header 4='102'
    _state.groupedFlatList = makeGrouped([{ header: true }, '100', '101', { header: true }, '102']);
  });

  it('marks only process rows in the span and never a group header', () => {
    markRange(0, 4); // spans both headers
    assert.deepEqual([..._state.markedPids].sort(), ['100', '101', '102']);
  });

  it('skips a header that falls inside the span', () => {
    markRange(2, 4); // 2='101', 3=header, 4='102'
    assert.deepEqual([..._state.markedPids].sort(), ['101', '102']);
  });
});

describe('pruneMarks', () => {
  it('drops marks whose pid is no longer running', () => {
    _state.allProcesses = [makeProc('1'), makeProc('2')];
    _state.markedPids.add('1');
    _state.markedPids.add('2');
    _state.markedPids.add('3'); // gone
    pruneMarks();
    assert.deepEqual([..._state.markedPids].sort(), ['1', '2']);
  });

  it('keeps a marked-but-filtered-out pid that is still alive', () => {
    // allProcesses (full live set) has '9'; processes (filtered view) does not.
    _state.allProcesses = [makeProc('8'), makeProc('9')];
    _state.processes = [makeProc('8')];
    _state.markedPids.add('9');
    pruneMarks();
    assert.ok(_state.markedPids.has('9'), 'alive-but-filtered mark should survive');
  });
});

describe('select-all semantics (markRange over the whole list)', () => {
  it('marking the full index range selects every visible session', () => {
    _state.processes = ['1', '2', '3'].map(makeProc);
    markRange(0, _state.processes.length - 1);
    assert.equal(_state.markedPids.size, 3);
  });
});

describe('killSelected', () => {
  it('returns 0 and shells out to nothing when no sessions are marked', () => {
    assert.equal(_state.markedPids.size, 0);
    assert.equal(killSelected(false), 0);
  });
});

describe('parseMouseEvent — shift modifier', () => {
  it('reports shift:true for a shift+left-click (SGR button 4)', () => {
    const evt = parseMouseEvent('\x1b[<4;10;5M');
    assert.ok(evt);
    assert.equal(evt.button, 0, 'button still masks to left (0)');
    assert.equal(evt.shift, true);
    assert.equal(evt.alt, false);
    assert.equal(evt.ctrl, false);
    assert.equal(evt.isScroll, false);
  });

  it('reports shift:false for a plain left-click (SGR button 0)', () => {
    const evt = parseMouseEvent('\x1b[<0;10;5M');
    assert.ok(evt);
    assert.equal(evt.button, 0);
    assert.equal(evt.shift, false);
  });

  it('decodes alt (8) and ctrl (16) bits independently', () => {
    assert.equal(parseMouseEvent('\x1b[<8;1;1M').alt, true);
    assert.equal(parseMouseEvent('\x1b[<16;1;1M').ctrl, true);
  });

  it('leaves scroll detection intact (shift bit does not break it)', () => {
    const evt = parseMouseEvent('\x1b[<64;10;5M');
    assert.ok(evt.isScroll);
    assert.equal(evt.shift, false);
  });
});
