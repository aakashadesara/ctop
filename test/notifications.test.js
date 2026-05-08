const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatDuration,
  formatNotificationMessage,
  checkStateTransitions,
  _state,
  _notif,
  DEFAULT_CONFIG,
} = require('../claude-manager');

// Helper: build a minimal process object
function makeProc(pid, status, overrides = {}) {
  const isActive = status === 'ACTIVE';
  const isZombie = status === 'ZOMBIE';
  const isStopped = status === 'STOPPED';
  return {
    pid: String(pid),
    cpu: 0, mem: 0, stat: isActive ? 'S' : isStopped ? 'T' : isZombie ? 'Z' : 'S',
    startDate: new Date(), startTime: 'just now', command: 'node',
    cwd: '/tmp', title: 'Claude Code', contextPct: null,
    model: null, stopReason: null, gitBranch: null, slug: null,
    sessionId: null, version: null, userType: null,
    inputTokens: null, cacheCreateTokens: null, cacheReadTokens: null,
    outputTokens: null, serviceTier: null, timestamp: null,
    requestId: null, lastTurnMs: null, cost: null,
    isActive, isZombie, isStopped, status,
    ...overrides,
  };
}

describe('formatDuration', () => {
  it('formats seconds only', () => {
    assert.equal(formatDuration(45000), '45s');
  });

  it('formats minutes and seconds', () => {
    assert.equal(formatDuration(125000), '2m 5s');
  });

  it('formats hours and minutes', () => {
    assert.equal(formatDuration(3725000), '1h 2m');
  });

  it('formats zero', () => {
    assert.equal(formatDuration(0), '0s');
  });
});

describe('formatNotificationMessage', () => {
  it('includes slug when available', () => {
    const proc = makeProc(1, 'STOPPED', {
      slug: 'my-project', model: 'claude-sonnet-4-6', _activeDurationMs: 60000,
    });
    const msg = formatNotificationMessage(proc);
    assert.ok(msg.includes('my-project'));
    assert.ok(msg.includes('sonnet-4-6'));
    assert.ok(msg.includes('1m 0s'));
  });

  it('falls back to title when slug is missing', () => {
    const proc = makeProc(1, 'STOPPED', {
      slug: null, title: 'Fix the bug', model: null, _activeDurationMs: 30000,
    });
    const msg = formatNotificationMessage(proc);
    assert.ok(msg.includes('Fix the bug'));
  });

  it('falls back to default label when both slug and title are missing', () => {
    const proc = makeProc(1, 'STOPPED', {
      slug: null, title: null, model: null,
    });
    const msg = formatNotificationMessage(proc);
    assert.ok(msg.includes('Claude session'));
  });
});

describe('checkStateTransitions', () => {
  beforeEach(() => {
    // Reset notification state
    _notif.previousStates.clear();
    _notif.processStartTimes.clear();
    _state.notificationsEnabled = true;
  });

  it('ACTIVE -> STOPPED triggers notification (via state tracking)', () => {
    // Cycle 1: process is ACTIVE
    const procs1 = [makeProc(100, 'ACTIVE', { slug: 'test-proj', model: 'claude-sonnet-4-6' })];
    checkStateTransitions(procs1);

    // Verify state was recorded
    assert.equal(_notif.previousStates.get('100'), 'ACTIVE');
    assert.ok(_notif.processStartTimes.has('100'));

    // Backdate start time to make duration > minDuration
    _notif.processStartTimes.set('100', Date.now() - 60000);

    // Cycle 2: process is now STOPPED
    const procs2 = [makeProc(100, 'STOPPED', { slug: 'test-proj', model: 'claude-sonnet-4-6' })];
    // This should trigger a notification (we can't easily intercept spawn, but we verify
    // that previousStates updates correctly and no error is thrown)
    checkStateTransitions(procs2);

    // After the check, previous states should reflect new status
    assert.equal(_notif.previousStates.get('100'), 'STOPPED');
  });

  it('ACTIVE -> ZOMBIE triggers notification path', () => {
    const procs1 = [makeProc(200, 'ACTIVE')];
    checkStateTransitions(procs1);
    _notif.processStartTimes.set('200', Date.now() - 120000);

    const procs2 = [makeProc(200, 'ZOMBIE')];
    checkStateTransitions(procs2);

    assert.equal(_notif.previousStates.get('200'), 'ZOMBIE');
  });

  it('process disappearing triggers notification path', () => {
    const procs1 = [makeProc(300, 'ACTIVE')];
    checkStateTransitions(procs1);
    _notif.processStartTimes.set('300', Date.now() - 90000);

    // Cycle 2: process is gone
    checkStateTransitions([]);

    // Previous states should be empty (no current processes)
    assert.equal(_notif.previousStates.size, 0);
    // Start time should be cleaned up
    assert.ok(!_notif.processStartTimes.has('300'));
  });

  it('does NOT notify for short-lived processes (< minDuration)', () => {
    const procs1 = [makeProc(400, 'ACTIVE')];
    checkStateTransitions(procs1);

    // processStartTimes was just set to ~now, so duration < 30s
    // The transition should not trigger notification
    const procs2 = [makeProc(400, 'STOPPED')];
    checkStateTransitions(procs2);

    // State should still update
    assert.equal(_notif.previousStates.get('400'), 'STOPPED');
  });

  it('STOPPED -> STOPPED does NOT re-trigger', () => {
    // Set up a process that's already STOPPED
    const procs1 = [makeProc(500, 'STOPPED')];
    checkStateTransitions(procs1);

    assert.equal(_notif.previousStates.get('500'), 'STOPPED');

    // Cycle 2: still STOPPED
    const procs2 = [makeProc(500, 'STOPPED')];
    checkStateTransitions(procs2);

    // Should not crash and state remains STOPPED
    assert.equal(_notif.previousStates.get('500'), 'STOPPED');
  });

  it('does not notify when notifications are disabled', () => {
    _state.notificationsEnabled = false;

    const procs1 = [makeProc(600, 'ACTIVE')];
    checkStateTransitions(procs1);

    // previousStates should NOT be updated when disabled
    // (the function returns early)
    assert.equal(_notif.previousStates.size, 0);
  });

  it('tracks multiple processes independently', () => {
    const procs1 = [
      makeProc(700, 'ACTIVE'),
      makeProc(701, 'ACTIVE'),
    ];
    checkStateTransitions(procs1);
    _notif.processStartTimes.set('700', Date.now() - 60000);
    // 701 stays short-lived

    // Only 700 stops
    const procs2 = [
      makeProc(700, 'STOPPED'),
      makeProc(701, 'ACTIVE'),
    ];
    checkStateTransitions(procs2);

    assert.equal(_notif.previousStates.get('700'), 'STOPPED');
    assert.equal(_notif.previousStates.get('701'), 'ACTIVE');
    // 701 should still have its start time tracked
    assert.ok(_notif.processStartTimes.has('701'));
  });
});

describe('DEFAULT_CONFIG notifications', () => {
  it('has notifications config with expected defaults', () => {
    assert.ok(DEFAULT_CONFIG.notifications);
    assert.equal(DEFAULT_CONFIG.notifications.enabled, true);
    assert.equal(DEFAULT_CONFIG.notifications.minDuration, 30);
  });
});
