// Output formatters for the ctop CLI subcommands. Pure functions over the
// proc shape produced by getAllAgentProcesses; no ANSI colors (CLI mode is
// pipeable by default).

const os = require('os');

// Shortens a cwd by replacing $HOME with ~, used in human-readable tables.
function shortenHome(cwd) {
  if (!cwd) return '';
  const home = os.homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length);
  return cwd;
}

function truncate(str, max) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Pads a string to width with spaces (right-pad). Width counts in chars,
// not visual cells; CLI output is plain ASCII so they match.
function pad(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s;
  return s + ' '.repeat(width - s.length);
}

// Reduces a proc to the SessionSummary shape used by `ctop ls`. Missing
// fields are normalized to null so JSON output never has implicit undefined keys.
function summarize(proc) {
  const nz = (v) => (v == null ? null : v);
  return {
    pid: Number(proc.pid),
    agent: nz(proc.agentType),
    model: nz(proc.model),
    cwd: nz(proc.cwd),
    branch: nz(proc.gitBranch),
    contextPct: nz(proc.contextPct),
    cost: proc.cost == null ? null : Number(proc.cost.toFixed(4)),
    status: nz(proc.status),
    startedAgo: nz(proc.startTime),
    tokens: {
      input: proc.inputTokens || 0,
      output: proc.outputTokens || 0,
      cache: (proc.cacheReadTokens || 0) + (proc.cacheCreateTokens || 0),
    },
  };
}

// Returns the full session object (every field on proc that callers care
// about for `ctop get`). Strips functions and internal animation state.
function detail(proc) {
  return {
    pid: Number(proc.pid),
    agent: proc.agentType,
    title: proc.title,
    sessionId: proc.sessionId,
    sessionTitle: proc.sessionTitle,
    slug: proc.slug,
    cwd: proc.cwd,
    command: proc.command,
    startTime: proc.startTime,
    startDate: proc.startDate ? new Date(proc.startDate).toISOString() : null,
    status: proc.status,
    cpu: proc.cpu,
    mem: proc.mem,
    model: proc.model,
    contextPct: proc.contextPct,
    inputTokens: proc.inputTokens,
    outputTokens: proc.outputTokens,
    cacheCreateTokens: proc.cacheCreateTokens,
    cacheReadTokens: proc.cacheReadTokens,
    serviceTier: proc.serviceTier,
    stopReason: proc.stopReason,
    cost: proc.cost,
    gitBranch: proc.gitBranch,
    tokenRate: proc.tokenRate || 0,
    lastTurnMs: proc.lastTurnMs,
    compacted: !!proc.compacted,
    compactionCount: proc.compactionCount || 0,
    rateLimits: proc.rateLimits || null,
    timestamp: proc.timestamp,
    requestId: proc.requestId,
    userType: proc.userType,
    version: proc.version,
  };
}

function formatLsHuman(procs) {
  if (!procs.length) return 'No agent sessions running.\n';
  const rows = procs.map(p => ({
    pid: String(p.pid),
    agent: p.agent || '',
    model: truncate(p.model || '', 22),
    cwd: truncate(shortenHome(p.cwd), 30),
    branch: truncate(p.branch || '', 18),
    ctx: p.contextPct == null ? '--' : p.contextPct + '%',
    cost: p.cost == null ? '--' : '$' + p.cost.toFixed(2),
    status: p.status,
    age: p.startedAgo || '',
  }));
  const widths = {
    pid: Math.max(5, ...rows.map(r => r.pid.length)),
    agent: Math.max(7, ...rows.map(r => r.agent.length)),
    model: Math.max(8, ...rows.map(r => r.model.length)),
    cwd: Math.max(5, ...rows.map(r => r.cwd.length)),
    branch: Math.max(8, ...rows.map(r => r.branch.length)),
    ctx: Math.max(4, ...rows.map(r => r.ctx.length)),
    cost: Math.max(6, ...rows.map(r => r.cost.length)),
    status: Math.max(8, ...rows.map(r => r.status.length)),
    age: Math.max(5, ...rows.map(r => r.age.length)),
  };
  const header = [
    pad('PID', widths.pid),
    pad('AGENT', widths.agent),
    pad('MODEL', widths.model),
    pad('CWD', widths.cwd),
    pad('BRANCH', widths.branch),
    pad('CTX', widths.ctx),
    pad('COST', widths.cost),
    pad('STATUS', widths.status),
    pad('AGE', widths.age),
  ].join('  ');
  const lines = [header];
  for (const r of rows) {
    lines.push([
      pad(r.pid, widths.pid),
      pad(r.agent, widths.agent),
      pad(r.model, widths.model),
      pad(r.cwd, widths.cwd),
      pad(r.branch, widths.branch),
      pad(r.ctx, widths.ctx),
      pad(r.cost, widths.cost),
      pad(r.status, widths.status),
      pad(r.age, widths.age),
    ].join('  '));
  }
  return lines.join('\n') + '\n';
}

function formatGetHuman(detail) {
  if (!detail) return 'Session not found.\n';
  const lines = [];
  const push = (k, v) => lines.push(pad(k + ':', 18) + (v == null || v === '' ? '--' : v));
  push('PID', detail.pid);
  push('Agent', detail.agent);
  push('Title', detail.title);
  push('Session Title', detail.sessionTitle);
  push('Session ID', detail.sessionId);
  push('Status', detail.status);
  push('Model', detail.model);
  push('Started', detail.startTime + (detail.startDate ? ` (${detail.startDate})` : ''));
  push('CWD', detail.cwd);
  push('Branch', detail.gitBranch);
  push('Context Free', detail.contextPct == null ? '--' : detail.contextPct + '%');
  push('Cost', detail.cost == null ? '--' : '$' + detail.cost.toFixed(4));
  push('Input Tokens', (detail.inputTokens || 0).toLocaleString());
  push('Output Tokens', (detail.outputTokens || 0).toLocaleString());
  push('Cache Read', (detail.cacheReadTokens || 0).toLocaleString());
  push('Cache Create', (detail.cacheCreateTokens || 0).toLocaleString());
  push('Token Rate', (detail.tokenRate || 0).toFixed(1) + ' tok/s');
  push('Last Turn', detail.lastTurnMs ? detail.lastTurnMs + 'ms' : '--');
  push('Compacted', detail.compactionCount + ' time(s)');
  push('CPU', detail.cpu + '%');
  push('Memory', detail.mem + '%');
  return lines.join('\n') + '\n';
}

function formatLogHuman(entries) {
  if (!entries.length) return 'No log entries.\n';
  const lines = [];
  for (const e of entries) {
    const ts = e.timestamp ? `[${e.timestamp}] ` : '';
    lines.push(ts + e.text);
  }
  return lines.join('\n') + '\n';
}

function formatStatsHuman(stats) {
  const lines = [
    pad('Sessions:', 20) + `${stats.active} active, ${stats.dead} dead (${stats.total} total)`,
    pad('Total cost:', 20) + '$' + (stats.totalCost || 0).toFixed(2),
    pad('Input tokens:', 20) + (stats.totalInput || 0).toLocaleString(),
    pad('Output tokens:', 20) + (stats.totalOutput || 0).toLocaleString(),
    pad('Cache tokens:', 20) + (stats.totalCache || 0).toLocaleString(),
    pad('Avg context used:', 20) + (stats.avgContextUtil == null ? '--' : stats.avgContextUtil + '%'),
  ];
  return lines.join('\n') + '\n';
}

function formatAlertsHuman(alerts) {
  if (!alerts.length) return 'No alerts.\n';
  const lines = [];
  for (const a of alerts) {
    const sev = a.severity.toUpperCase().padEnd(8);
    lines.push(`[${sev}] pid=${a.pid} ${a.agent}  ${a.kind}: ${a.message}`);
    if (a.suggested) lines.push('           → ' + a.suggested);
  }
  return lines.join('\n') + '\n';
}

function formatWhoamiHuman(result) {
  if (!result.session) return `Could not detect calling session (matchConfidence: ${result.matchConfidence}).\n`;
  return `pid=${result.session.pid} agent=${result.session.agent} model=${result.session.model || '--'} cwd=${shortenHome(result.session.cwd)} context=${result.session.contextPct == null ? '--' : result.session.contextPct + '%'} (matchConfidence: ${result.matchConfidence})\n`;
}

function formatDiffHuman(diff) {
  if (!diff) return 'No git diff (not a git repo, or no changes).\n';
  const lines = [];
  lines.push(`+${diff.insertions || 0} -${diff.deletions || 0} (untracked: ${diff.untracked || 0})`);
  if (diff.files && diff.files.length) {
    lines.push('');
    for (const f of diff.files) {
      lines.push(`  +${String(f.insertions).padStart(4)} -${String(f.deletions).padStart(4)}  ${f.file}`);
    }
  }
  return lines.join('\n') + '\n';
}

function formatSearchHuman(results) {
  if (!results.length) return 'No matches.\n';
  const lines = [];
  for (const r of results) {
    lines.push(`pid=${r.pid} (${r.sessionFile})`);
    for (const s of r.snippets) {
      lines.push('  ' + truncate(s.replace(/\s+/g, ' ').trim(), 100));
    }
    lines.push('');
  }
  return lines.join('\n');
}

// JSON helper — pretty-print with 2-space indent so it's diff-friendly.
function toJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

module.exports = {
  shortenHome,
  truncate,
  summarize,
  detail,
  formatLsHuman,
  formatGetHuman,
  formatLogHuman,
  formatStatsHuman,
  formatAlertsHuman,
  formatWhoamiHuman,
  formatDiffHuman,
  formatSearchHuman,
  toJson,
};
