const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fmt = require('../src/cli-format');

const sampleProc = {
  pid: '12345',
  agentType: 'claude',
  title: 'Claude Code',
  sessionId: 'sess-abc',
  sessionTitle: 'Refactor auth',
  slug: 'refactor-auth',
  cwd: os.homedir() + '/code/app',
  command: '/usr/local/bin/claude',
  startTime: '22m ago',
  startDate: new Date('2026-05-18T12:00:00Z'),
  status: 'ACTIVE',
  cpu: 4.2,
  mem: 1.5,
  model: 'claude-opus-4-7',
  contextPct: 72,
  inputTokens: 100_000,
  outputTokens: 8_000,
  cacheCreateTokens: 50_000,
  cacheReadTokens: 200_000,
  serviceTier: 'standard',
  stopReason: 'end_turn',
  cost: 1.8472,
  gitBranch: 'mcp-cli',
  tokenRate: 12.5,
  lastTurnMs: 4200,
  compacted: false,
  compactionCount: 0,
};

describe('cli-format.shortenHome', () => {
  it('replaces $HOME with ~', () => {
    assert.strictEqual(fmt.shortenHome(os.homedir() + '/foo'), '~/foo');
  });
  it('returns ~ for exact home', () => {
    assert.strictEqual(fmt.shortenHome(os.homedir()), '~');
  });
  it('leaves non-home paths alone', () => {
    assert.strictEqual(fmt.shortenHome('/etc/passwd'), '/etc/passwd');
  });
  it('handles empty / null', () => {
    assert.strictEqual(fmt.shortenHome(null), '');
    assert.strictEqual(fmt.shortenHome(''), '');
  });
});

describe('cli-format.truncate', () => {
  it('returns short strings unchanged', () => {
    assert.strictEqual(fmt.truncate('hello', 10), 'hello');
  });
  it('truncates with ellipsis at the requested width', () => {
    const out = fmt.truncate('hello world', 8);
    assert.strictEqual(out.length, 8);
    assert.ok(out.endsWith('…'));
  });
});

describe('cli-format.summarize', () => {
  it('strips internal fields and keeps SessionSummary shape', () => {
    const s = fmt.summarize(sampleProc);
    assert.strictEqual(s.pid, 12345);
    assert.strictEqual(s.agent, 'claude');
    assert.strictEqual(s.model, 'claude-opus-4-7');
    assert.strictEqual(s.branch, 'mcp-cli');
    assert.strictEqual(s.contextPct, 72);
    assert.strictEqual(s.cost, 1.8472);
    assert.strictEqual(s.status, 'ACTIVE');
    assert.deepStrictEqual(s.tokens, { input: 100_000, output: 8_000, cache: 250_000 });
  });
  it('handles missing fields gracefully', () => {
    const s = fmt.summarize({ pid: '1', agentType: 'codex', startTime: '' });
    assert.strictEqual(s.cost, null);
    assert.strictEqual(s.contextPct, null);
    assert.deepStrictEqual(s.tokens, { input: 0, output: 0, cache: 0 });
  });
});

describe('cli-format.detail', () => {
  it('returns all expected fields', () => {
    const d = fmt.detail(sampleProc);
    assert.strictEqual(d.pid, 12345);
    assert.strictEqual(d.sessionId, 'sess-abc');
    assert.strictEqual(d.tokenRate, 12.5);
    assert.strictEqual(d.compactionCount, 0);
    assert.ok(d.startDate.includes('2026-05-18'));
  });
});

describe('cli-format.formatLsHuman', () => {
  it('prints empty-state message when no procs', () => {
    assert.match(fmt.formatLsHuman([]), /No agent sessions running/);
  });
  it('includes header row + data row', () => {
    const summary = fmt.summarize(sampleProc);
    const out = fmt.formatLsHuman([summary]);
    assert.match(out, /PID/);
    assert.match(out, /AGENT/);
    assert.match(out, /MODEL/);
    assert.match(out, /12345/);
    assert.match(out, /claude/);
    assert.match(out, /mcp-cli/);
  });
});

describe('cli-format.formatGetHuman', () => {
  it('returns not-found message for null', () => {
    assert.match(fmt.formatGetHuman(null), /Session not found/);
  });
  it('renders key/value lines', () => {
    const out = fmt.formatGetHuman(fmt.detail(sampleProc));
    assert.match(out, /PID:/);
    assert.match(out, /12345/);
    assert.match(out, /Branch:/);
    assert.match(out, /mcp-cli/);
  });
});

describe('cli-format.formatStatsHuman', () => {
  it('prints the aggregate fields', () => {
    const out = fmt.formatStatsHuman({
      active: 3, dead: 1, total: 4,
      totalCost: 5.42, totalInput: 100_000, totalOutput: 5_000, totalCache: 50_000,
      avgContextUtil: 65,
    });
    assert.match(out, /3 active, 1 dead/);
    assert.match(out, /\$5\.42/);
    assert.match(out, /65%/);
  });
});

describe('cli-format.formatAlertsHuman', () => {
  it('prints no-alerts message when empty', () => {
    assert.match(fmt.formatAlertsHuman([]), /No alerts/);
  });
  it('renders kind, severity, message', () => {
    const out = fmt.formatAlertsHuman([
      { pid: 1, agent: 'claude', kind: 'low_context', severity: 'critical', message: '5% free', suggested: '/compact' },
    ]);
    assert.match(out, /CRITICAL/);
    assert.match(out, /low_context/);
    assert.match(out, /5% free/);
    assert.match(out, /\/compact/);
  });
});

describe('cli-format.formatWhoamiHuman', () => {
  it('reports unknown when session is null', () => {
    const out = fmt.formatWhoamiHuman({ session: null, matchConfidence: 'none' });
    assert.match(out, /Could not detect/);
  });
  it('shows pid + agent + match confidence when found', () => {
    const out = fmt.formatWhoamiHuman({
      session: fmt.summarize(sampleProc),
      matchConfidence: 'ppid',
    });
    assert.match(out, /pid=12345/);
    assert.match(out, /agent=claude/);
    assert.match(out, /matchConfidence: ppid/);
  });
});

describe('cli-format.formatDiffHuman', () => {
  it('handles null diff', () => {
    assert.match(fmt.formatDiffHuman(null), /No git diff/);
  });
  it('shows insertions / deletions / files', () => {
    const out = fmt.formatDiffHuman({
      insertions: 12, deletions: 3, untracked: 1,
      files: [{ file: 'src/foo.js', insertions: 10, deletions: 2 }],
    });
    assert.match(out, /\+12 -3/);
    assert.match(out, /untracked: 1/);
    assert.match(out, /src\/foo\.js/);
  });
});

describe('cli-format.toJson', () => {
  it('pretty-prints with 2-space indent and trailing newline', () => {
    const out = fmt.toJson({ a: 1 });
    assert.strictEqual(out, '{\n  "a": 1\n}\n');
  });
});
