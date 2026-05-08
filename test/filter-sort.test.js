const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { applySortAndFilter, _state } = require('../claude-manager');

function makeProc(overrides) {
  return {
    pid: 1000 + Math.floor(Math.random() * 9000),
    cpu: 0,
    mem: 0,
    startDate: new Date(),
    title: 'Claude Code',
    cwd: '/home/user/project',
    contextPct: null,
    model: null,
    gitBranch: null,
    slug: null,
    ...overrides,
  };
}

describe('applySortAndFilter', () => {
  beforeEach(() => {
    _state.filterText = '';
    _state.sortMode = 'age';
    _state.sortReverse = false;
    _state.selectedIndex = 0;
    _state.processes = [];
    _state.allProcesses = [];
  });

  describe('filtering', () => {
    it('returns all processes when filter is empty', () => {
      const p1 = makeProc({ title: 'Task A' });
      const p2 = makeProc({ title: 'Task B' });
      _state.allProcesses = [p1, p2];
      _state.filterText = '';
      applySortAndFilter();
      assert.equal(_state.processes.length, 2);
    });

    it('filters by branch name', () => {
      const p1 = makeProc({ gitBranch: 'feature-auth' });
      const p2 = makeProc({ gitBranch: 'main' });
      _state.allProcesses = [p1, p2];
      _state.filterText = 'auth';
      applySortAndFilter();
      assert.equal(_state.processes.length, 1);
      assert.equal(_state.processes[0].gitBranch, 'feature-auth');
    });

    it('filters by model name', () => {
      const p1 = makeProc({ model: 'claude-sonnet-4-20250514' });
      const p2 = makeProc({ model: 'claude-opus-4-20250514' });
      _state.allProcesses = [p1, p2];
      _state.filterText = 'opus';
      applySortAndFilter();
      assert.equal(_state.processes.length, 1);
      assert.equal(_state.processes[0].model, 'claude-opus-4-20250514');
    });

    it('filters by directory path', () => {
      const p1 = makeProc({ cwd: '/home/user/project-a' });
      const p2 = makeProc({ cwd: '/home/user/project-b' });
      _state.allProcesses = [p1, p2];
      _state.filterText = 'project-a';
      applySortAndFilter();
      assert.equal(_state.processes.length, 1);
      assert.equal(_state.processes[0].cwd, '/home/user/project-a');
    });

    it('filters by slug', () => {
      const p1 = makeProc({ slug: 'my-cool-slug' });
      const p2 = makeProc({ slug: 'another-slug' });
      _state.allProcesses = [p1, p2];
      _state.filterText = 'cool';
      applySortAndFilter();
      assert.equal(_state.processes.length, 1);
      assert.equal(_state.processes[0].slug, 'my-cool-slug');
    });

    it('filters by title', () => {
      const p1 = makeProc({ title: 'Fix login bug' });
      const p2 = makeProc({ title: 'Add tests' });
      _state.allProcesses = [p1, p2];
      _state.filterText = 'login';
      applySortAndFilter();
      assert.equal(_state.processes.length, 1);
      assert.equal(_state.processes[0].title, 'Fix login bug');
    });

    it('is case-insensitive', () => {
      const p1 = makeProc({ title: 'Fix Login Bug' });
      _state.allProcesses = [p1];
      _state.filterText = 'FIX LOGIN';
      applySortAndFilter();
      assert.equal(_state.processes.length, 1);
    });

    it('returns empty when nothing matches', () => {
      const p1 = makeProc({ title: 'Task A', gitBranch: 'main', model: 'sonnet', cwd: '/x', slug: 'a' });
      _state.allProcesses = [p1];
      _state.filterText = 'zzzznotfound';
      applySortAndFilter();
      assert.equal(_state.processes.length, 0);
    });
  });

  describe('sorting by age', () => {
    it('sorts oldest first by default', () => {
      const p1 = makeProc({ startDate: new Date('2025-01-01'), title: 'old' });
      const p2 = makeProc({ startDate: new Date('2025-06-01'), title: 'new' });
      _state.allProcesses = [p2, p1];
      _state.sortMode = 'age';
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'old');
      assert.equal(_state.processes[1].title, 'new');
    });

    it('sorts newest first when reversed', () => {
      const p1 = makeProc({ startDate: new Date('2025-01-01'), title: 'old' });
      const p2 = makeProc({ startDate: new Date('2025-06-01'), title: 'new' });
      _state.allProcesses = [p1, p2];
      _state.sortMode = 'age';
      _state.sortReverse = true;
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'new');
      assert.equal(_state.processes[1].title, 'old');
    });
  });

  describe('sorting by cpu', () => {
    it('sorts highest CPU first', () => {
      const p1 = makeProc({ cpu: 10, title: 'low' });
      const p2 = makeProc({ cpu: 80, title: 'high' });
      _state.allProcesses = [p1, p2];
      _state.sortMode = 'cpu';
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'high');
      assert.equal(_state.processes[1].title, 'low');
    });

    it('reverses CPU sort', () => {
      const p1 = makeProc({ cpu: 10, title: 'low' });
      const p2 = makeProc({ cpu: 80, title: 'high' });
      _state.allProcesses = [p1, p2];
      _state.sortMode = 'cpu';
      _state.sortReverse = true;
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'low');
      assert.equal(_state.processes[1].title, 'high');
    });
  });

  describe('sorting by mem', () => {
    it('sorts highest memory first', () => {
      const p1 = makeProc({ mem: 50, title: 'low' });
      const p2 = makeProc({ mem: 200, title: 'high' });
      _state.allProcesses = [p1, p2];
      _state.sortMode = 'mem';
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'high');
      assert.equal(_state.processes[1].title, 'low');
    });
  });

  describe('sorting by context', () => {
    it('sorts lowest context remaining first (most used first)', () => {
      const p1 = makeProc({ contextPct: 80, title: 'plenty' });
      const p2 = makeProc({ contextPct: 15, title: 'low' });
      _state.allProcesses = [p1, p2];
      _state.sortMode = 'context';
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'low');
      assert.equal(_state.processes[1].title, 'plenty');
    });

    it('treats null contextPct as 100 (sorts last)', () => {
      const p1 = makeProc({ contextPct: null, title: 'unknown' });
      const p2 = makeProc({ contextPct: 30, title: 'known' });
      _state.allProcesses = [p1, p2];
      _state.sortMode = 'context';
      applySortAndFilter();
      assert.equal(_state.processes[0].title, 'known');
      assert.equal(_state.processes[1].title, 'unknown');
    });
  });

  describe('selectedIndex clamping', () => {
    it('clamps selectedIndex when it exceeds filtered list length', () => {
      const p1 = makeProc({ title: 'A' });
      _state.allProcesses = [p1];
      _state.selectedIndex = 5;
      applySortAndFilter();
      assert.equal(_state.selectedIndex, 0);
    });

    it('sets selectedIndex to 0 when result is empty', () => {
      _state.allProcesses = [];
      _state.selectedIndex = 3;
      applySortAndFilter();
      assert.equal(_state.selectedIndex, 0);
    });
  });
});
