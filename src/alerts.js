// Alert rules — pure function over a procs[] array. Returns the set of
// warning-level signals across all sessions so a "master agent" can ask
// "what needs attention right now?" without re-deriving thresholds.

const SEVERITY_ORDER = { info: 0, warn: 1, critical: 2 };

const DEFAULT_THRESHOLDS = {
  // Context-free percent: < 15 warns, < 8 is critical (will compact next turn)
  lowContextWarn: 15,
  lowContextCritical: 8,
  // Idle = ACTIVE with tokenRate=0 for > 10 minutes (proc.lastTurnMs)
  idleMs: 10 * 60 * 1000,
  // Ghost = STOPPED/ZOMBIE consuming > 100MB resident.
  // proc.mem is a percent of total system memory; default cutoff = 0.5%
  // which is roughly ~80MB on a 16GB machine.
  ghostMemPct: 0.5,
  // Single-session cost spike
  costSpikeUsd: 5,
};

// Compute alerts for an array of session procs. Each alert is
// { pid, agent, kind, severity, message, suggested }.
function compute(procs, opts = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const out = [];

  for (const p of procs) {
    const pid = Number(p.pid);
    const agent = p.agentType;

    // low_context
    if (p.contextPct != null) {
      if (p.contextPct <= t.lowContextCritical) {
        out.push({
          pid, agent, kind: 'low_context', severity: 'critical',
          message: `${agent} session at ${p.contextPct}% context, will compact next turn`,
          suggested: 'run /compact or hand off to a fresh session',
        });
      } else if (p.contextPct <= t.lowContextWarn) {
        out.push({
          pid, agent, kind: 'low_context', severity: 'warn',
          message: `${agent} session at ${p.contextPct}% context (threshold: ${t.lowContextWarn}%)`,
          suggested: 'plan to /compact within the next few turns',
        });
      }
    }

    // compacting (fired this tick)
    if (p.compacted) {
      out.push({
        pid, agent, kind: 'compacting', severity: 'info',
        message: `${agent} session compacted (count: ${p.compactionCount || 1})`,
        suggested: 'no action needed — context has been refreshed',
      });
    }

    // idle (ACTIVE but no recent token activity)
    // tokenRate is set by updateTokenRates; on first read it may be undefined.
    // Use lastTurnMs as a fallback — if the most recent turn is older than
    // the threshold and rate is 0, we call it idle.
    if (p.status === 'ACTIVE' && (p.tokenRate === 0 || p.tokenRate == null)) {
      // Only flag if we have a signal that the session is genuinely idle,
      // not just freshly started. Use lastTurnMs > threshold as the proxy.
      if (p.lastTurnMs != null && p.lastTurnMs > t.idleMs) {
        const mins = Math.round(p.lastTurnMs / 60000);
        out.push({
          pid, agent, kind: 'idle', severity: 'warn',
          message: `${agent} session ACTIVE but no token activity for ${mins}m`,
          suggested: 'check if the session is stuck or waiting on input',
        });
      }
    }

    // ghost — STOPPED/ZOMBIE consuming memory
    if ((p.status === 'STOPPED' || p.status === 'ZOMBIE') && p.mem > t.ghostMemPct) {
      out.push({
        pid, agent, kind: 'ghost', severity: 'warn',
        message: `${agent} session ${p.status} ${p.startTime || ''}, holding ${p.mem.toFixed(1)}% memory`,
        suggested: `ctop kill ${pid} --force`,
      });
    }

    // rate_limited — proc.rateLimits is populated when the session hit quota
    if (p.rateLimits) {
      out.push({
        pid, agent, kind: 'rate_limited', severity: 'warn',
        message: `${agent} session rate-limited`,
        suggested: 'wait or switch to a different account',
      });
    }

    // cost_spike — single session over the configured cost cap
    if (p.cost != null && p.cost > t.costSpikeUsd) {
      out.push({
        pid, agent, kind: 'cost_spike', severity: 'warn',
        message: `${agent} session has accrued $${p.cost.toFixed(2)} in API cost`,
        suggested: 'review the session or end it if no longer needed',
      });
    }
  }

  // Filter by minimum severity (default: warn — info alerts are opt-in).
  const requested = opts.severity || 'warn';
  const min = SEVERITY_ORDER[requested];
  if (min != null) {
    return out.filter(a => SEVERITY_ORDER[a.severity] >= min);
  }
  return out;
}

module.exports = {
  compute,
  DEFAULT_THRESHOLDS,
  SEVERITY_ORDER,
};
