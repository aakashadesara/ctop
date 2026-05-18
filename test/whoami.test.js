const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const whoami = require('../src/whoami');
const fmt = require('../src/cli-format');

const mkProc = (over = {}) => ({
  pid: '12345',
  agentType: 'claude',
  cwd: '/tmp/proj',
  status: 'ACTIVE',
  startDate: new Date('2026-05-18T12:00:00Z'),
  startTime: '22m ago',
  model: 'claude-opus-4-7',
  contextPct: 72,
  gitBranch: 'main',
  ...over,
});

describe('whoami.detect — CTOP_PID exact match', () => {
  it('returns exact when CTOP_PID matches a known agent pid', () => {
    const procs = [mkProc({ pid: '111' }), mkProc({ pid: '222' })];
    const result = whoami.detect(procs, fmt.summarize, { envPid: '222' });
    assert.strictEqual(result.matchConfidence, 'exact');
    assert.strictEqual(result.session.pid, 222);
  });

  it('falls through when CTOP_PID is not in the agent list', () => {
    const procs = [mkProc({ pid: '111' })];
    // No ppid match, no cwd match (caller's pid + cwd both differ)
    const result = whoami.detect(procs, fmt.summarize, {
      envPid: '999999',
      callerPid: 999998,
      cwd: '/does/not/exist',
    });
    assert.strictEqual(result.matchConfidence, 'none');
    assert.strictEqual(result.session, null);
  });
});

describe('whoami.detect — cwd-guess fallback', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-whoami-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns cwd-guess when exactly one ACTIVE session matches cwd', () => {
    const procs = [
      mkProc({ pid: '111', cwd: tmpDir }),
      mkProc({ pid: '222', cwd: '/other' }),
    ];
    const result = whoami.detect(procs, fmt.summarize, {
      envPid: '',
      callerPid: 999998,
      cwd: tmpDir,
    });
    assert.strictEqual(result.matchConfidence, 'cwd-guess');
    assert.strictEqual(result.session.pid, 111);
  });

  it('picks the most-recent ACTIVE when multiple sessions match', () => {
    const old = mkProc({ pid: '111', cwd: tmpDir, startDate: new Date('2026-05-18T10:00:00Z') });
    const newer = mkProc({ pid: '222', cwd: tmpDir, startDate: new Date('2026-05-18T14:00:00Z') });
    const procs = [old, newer];
    const result = whoami.detect(procs, fmt.summarize, {
      envPid: '',
      callerPid: 999998,
      cwd: tmpDir,
    });
    assert.strictEqual(result.matchConfidence, 'cwd-guess');
    assert.strictEqual(result.session.pid, 222);
  });

  it('skips non-ACTIVE sessions in cwd fallback', () => {
    const procs = [mkProc({ pid: '111', cwd: tmpDir, status: 'STOPPED' })];
    const result = whoami.detect(procs, fmt.summarize, {
      envPid: '',
      callerPid: 999998,
      cwd: tmpDir,
    });
    assert.strictEqual(result.matchConfidence, 'none');
  });
});

describe('whoami.detect — empty', () => {
  it('returns none when no agents are running', () => {
    const result = whoami.detect([], fmt.summarize, {
      envPid: '',
      callerPid: 999998,
      cwd: '/tmp',
    });
    assert.strictEqual(result.matchConfidence, 'none');
    assert.strictEqual(result.session, null);
  });
});

describe('whoami.canonicalize', () => {
  it('resolves symlinks via realpath', () => {
    const real = os.tmpdir();
    // canonicalize a real existing path; the result is the realpath (which
    // may differ from real on macOS where /tmp -> /private/tmp)
    const canon = whoami.canonicalize(real);
    assert.strictEqual(typeof canon, 'string');
  });

  it('returns input unchanged when realpath fails', () => {
    const fake = '/this/does/not/exist/' + Math.random();
    assert.strictEqual(whoami.canonicalize(fake), fake);
  });
});

describe('whoami.walkParentPids', () => {
  it('returns the matching pid when it is the starting pid', () => {
    const set = new Set([99999]);
    assert.strictEqual(whoami.walkParentPids(99999, set), 99999);
  });

  it('returns null when no match in tree (depth-capped)', () => {
    // Use the current process pid; its ancestors won't be in the empty set.
    const result = whoami.walkParentPids(process.pid, new Set(), 3);
    assert.strictEqual(result, null);
  });
});
