// Process detection and management

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const { formatStartTime } = require('./utils');
const { calculateCost } = require('./cost');

const PLATFORM = os.platform();
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

function getProcessCwd(pid) {
  try {
    if (IS_LINUX) {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } else {
      return execSync(`lsof -p ${pid} 2>/dev/null | grep cwd | awk '{print $NF}'`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    }
  } catch (e) {
    return '';
  }
}

function getClaudeProcesses(assignSessionsToProcesses) {
  try {
    const psOutput = execSync(
      `ps -eo pid,user,pcpu,pmem,stat,lstart,command | grep 'claude' | grep -v 'claude-manager' | grep -v 'ctop' | grep -v 'Claude.app' | grep -v 'grep'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!psOutput) return [];

    const lines = psOutput.split('\n').filter(Boolean);
    const procs = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[0];
      const user = parts[1];
      const cpu = parts[2];
      const mem = parts[3];
      const stat = parts[4];
      const lstartStr = parts.slice(5, 10).join(' ');
      const command = parts.slice(10).join(' ');

      const startDate = new Date(lstartStr);
      const startTime = formatStartTime(startDate);
      const cwd = getProcessCwd(pid);

      const isActive = !stat.includes('Z') && !stat.includes('T');
      const isZombie = stat.includes('Z');
      const isStopped = stat.includes('T');

      procs.push({
        pid,
        cpu: parseFloat(cpu) || 0,
        mem: parseFloat(mem) || 0,
        stat,
        startDate,
        startTime,
        command,
        cwd,
        title: 'Claude Code',
        contextPct: null,
        model: null,
        stopReason: null,
        gitBranch: null,
        slug: null,
        sessionId: null,
        version: null,
        userType: null,
        inputTokens: null,
        cacheCreateTokens: null,
        cacheReadTokens: null,
        outputTokens: null,
        serviceTier: null,
        timestamp: null,
        requestId: null,
        lastTurnMs: null,
        isActive,
        isZombie,
        isStopped,
        status: isZombie ? 'ZOMBIE' : isStopped ? 'STOPPED' : isActive ? 'ACTIVE' : 'SLEEPING'
      });
    }

    procs.sort((a, b) => a.startDate - b.startDate);
    assignSessionsToProcesses(procs);

    for (const proc of procs) {
      proc.cost = calculateCost(proc);
    }

    return procs;
  } catch (e) {
    return [];
  }
}

function killProcess(pid, force, state) {
  try {
    const signal = force ? 9 : 15;
    execSync(`kill -${signal} ${pid} 2>&1`, { encoding: 'utf8' });
    state.statusMessage = `${force ? 'Force killed' : 'Killed'} process ${pid}`;
    return true;
  } catch (e) {
    try {
      execSync(`kill -0 ${pid} 2>&1`);
      state.statusMessage = `Failed to kill process ${pid}: ${e.message}`;
      return false;
    } catch (e2) {
      state.statusMessage = `Process ${pid} already terminated`;
      return true;
    }
  }
}

function killAllProcesses(force, state) {
  let killed = 0;
  for (const proc of state.allProcesses) {
    if (killProcess(proc.pid, force, state)) {
      killed++;
    }
  }
  return killed;
}

module.exports = {
  IS_MAC, IS_LINUX,
  getClaudeProcesses, getProcessCwd, killProcess, killAllProcesses,
};
