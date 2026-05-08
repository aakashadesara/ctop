// Utility functions

function formatStartTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'just now';
  }
}

function formatTokenCount(n) {
  if (n == null) return '--';
  return n.toLocaleString('en-US');
}

function calculateAggregateStats(procs) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let ctxSum = 0;
  let ctxCount = 0;
  let active = 0;
  let dead = 0;

  for (const p of procs) {
    if (p.inputTokens != null) totalInput += p.inputTokens;
    if (p.outputTokens != null) totalOutput += p.outputTokens;
    if (p.cacheReadTokens != null) totalCacheRead += p.cacheReadTokens;
    if (p.cacheCreateTokens != null) totalCacheWrite += p.cacheCreateTokens;
    totalCost += (p.cost || 0);
    if (p.contextPct != null) {
      ctxSum += (100 - p.contextPct);
      ctxCount++;
    }
    if (p.isActive) active++;
    else dead++;
  }

  return {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalCache: totalCacheRead + totalCacheWrite,
    totalCost,
    avgContextUtil: ctxCount > 0 ? Math.round(ctxSum / ctxCount) : null,
    active,
    dead,
    total: procs.length,
  };
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function formatNotificationMessage(proc) {
  const parts = [];
  const label = proc.slug || proc.title || 'Claude session';
  parts.push(label);
  if (proc._activeDurationMs) {
    parts.push(`Duration: ${formatDuration(proc._activeDurationMs)}`);
  }
  if (proc.model) {
    parts.push(`Model: ${proc.model.replace(/^claude-/, '')}`);
  }
  return parts.join(' | ');
}

function applySortAndFilter(state) {
  let result = [...state.allProcesses];

  // Filter
  if (state.filterText) {
    const ft = state.filterText.toLowerCase();
    result = result.filter(p => {
      const branch = (p.gitBranch || '').toLowerCase();
      const model = (p.model || '').toLowerCase();
      const dir = (p.cwd || '').toLowerCase();
      const slug = (p.slug || '').toLowerCase();
      const title = (p.title || '').toLowerCase();
      return branch.includes(ft) || model.includes(ft) || dir.includes(ft) || slug.includes(ft) || title.includes(ft);
    });
  }

  // Search filter: show only matching sessions
  if (state.searchQuery && state.searchResults.size > 0) {
    result = result.filter(p => state.searchResults.has(p.pid));
  }

  // Sort
  switch (state.sortMode) {
    case 'cpu':
      result.sort((a, b) => b.cpu - a.cpu);
      break;
    case 'mem':
      result.sort((a, b) => b.mem - a.mem);
      break;
    case 'context':
      result.sort((a, b) => {
        const ca = a.contextPct !== null ? a.contextPct : 100;
        const cb = b.contextPct !== null ? b.contextPct : 100;
        return ca - cb; // lowest free first (most used first)
      });
      break;
    case 'age':
    default:
      result.sort((a, b) => a.startDate - b.startDate);
      break;
  }

  if (state.sortReverse) result.reverse();

  state.processes = result;
  if (state.selectedIndex >= state.processes.length) {
    state.selectedIndex = Math.max(0, state.processes.length - 1);
  }
}

module.exports = {
  formatStartTime,
  formatTokenCount,
  calculateAggregateStats,
  formatDuration,
  formatNotificationMessage,
  applySortAndFilter,
};
