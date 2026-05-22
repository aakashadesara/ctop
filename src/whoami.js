// Self-detection — figure out which agent session the calling process is
// part of. Three strategies tried in order, with a matchConfidence label so
// callers know how much to trust the result.
//
//   1. CTOP_PID env var — most explicit, set by hooks or the user
//   2. parent-PID walk — climb process.ppid looking for a known agent PID
//   3. $PWD match — fall back to the most-recent ACTIVE session with the
//      same canonical cwd as the caller. Single-match heuristic only.
//
// Returns { session: SessionSummary | null, matchConfidence: 'exact' | 'ppid' | 'cwd-guess' | 'none' }.

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';

// Returns parent PID of the given PID, or null on error.
function getParentPid(pid) {
  try {
    if (IS_WIN) {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      ).trim();
      const n = parseInt(out, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const out = execSync(`ps -o ppid= -p ${pid}`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// Walks parent PIDs starting from `startPid`, looking for any PID that's
// in `agentPidSet`. Returns the matching agent PID, or null. Capped at
// `maxDepth` steps to avoid runaway loops on weird process trees.
function walkParentPids(startPid, agentPidSet, maxDepth = 12) {
  let current = startPid;
  for (let i = 0; i < maxDepth; i++) {
    if (agentPidSet.has(current) || agentPidSet.has(String(current))) {
      return current;
    }
    const next = getParentPid(current);
    if (next == null || next === current || next === 1) return null;
    current = next;
  }
  return null;
}

// Canonicalizes a path through fs.realpath if possible. Symlinked CWDs
// can otherwise mismatch the session's recorded cwd.
function canonicalize(p) {
  if (!p) return p;
  try { return fs.realpathSync(p); } catch { return p; }
}

// Main entry. `procs` is the array from getAllAgentProcesses(). Returns
// { session, matchConfidence } using cli-format.summarize for the session.
function detect(procs, summarize, opts = {}) {
  const pidSet = new Set(procs.map(p => Number(p.pid)));
  const procByPid = new Map(procs.map(p => [Number(p.pid), p]));

  // Strategy 1: CTOP_PID env var
  const envPid = opts.envPid || process.env.CTOP_PID;
  if (envPid) {
    const n = Number(envPid);
    if (pidSet.has(n)) {
      return { session: summarize(procByPid.get(n)), matchConfidence: 'exact' };
    }
  }

  // Strategy 2: ppid walk from the caller's own PID
  const callerPid = opts.callerPid || process.pid;
  const matched = walkParentPids(callerPid, pidSet);
  if (matched != null) {
    return { session: summarize(procByPid.get(Number(matched))), matchConfidence: 'ppid' };
  }

  // Strategy 3: $PWD match — only if exactly one ACTIVE session matches
  const cwd = canonicalize(opts.cwd || process.cwd());
  if (cwd) {
    const candidates = procs.filter(p => {
      if (p.status !== 'ACTIVE') return false;
      const procCwd = canonicalize(p.cwd);
      return procCwd === cwd;
    });
    if (candidates.length === 1) {
      return { session: summarize(candidates[0]), matchConfidence: 'cwd-guess' };
    }
    // If multiple candidates, pick the most recent — but flag low confidence
    if (candidates.length > 1) {
      const sorted = [...candidates].sort((a, b) => b.startDate - a.startDate);
      return { session: summarize(sorted[0]), matchConfidence: 'cwd-guess' };
    }
  }

  return { session: null, matchConfidence: 'none' };
}

module.exports = {
  detect,
  walkParentPids,
  getParentPid,
  canonicalize,
};
