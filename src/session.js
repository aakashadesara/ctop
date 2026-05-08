// Session data parsing

const fs = require('fs');
const path = require('path');

// Cache of sorted session files per project path
let sessionFileCache = new Map();
let sessionFileCacheTime = 0;

function getSessionData(filePath, CONFIG) {
  const result = {
    title: null, contextPct: null, model: null, stopReason: null,
    gitBranch: null, slug: null, sessionId: null, version: null,
    userType: null, inputTokens: null, cacheCreateTokens: null,
    cacheReadTokens: null, outputTokens: null, serviceTier: null,
    timestamp: null, requestId: null,
  };

  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);

    // Read first 64KB for title
    const headSize = Math.min(65536, stat.size);
    const headBuf = Buffer.alloc(headSize);
    fs.readSync(fd, headBuf, 0, headSize, 0);
    const headLines = headBuf.toString('utf8').split('\n');
    for (const line of headLines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.summary) {
          result.title = data.summary.substring(0, 50);
          break;
        } else if (data.type === 'user' && data.message && data.message.role === 'user' && data.message.content) {
          const msg = typeof data.message.content === 'string'
            ? data.message.content
            : (data.message.content.find(c => c.type === 'text') || {}).text || '';
          if (!msg || msg.startsWith('<') || msg.trim() === '') continue;
          result.title = msg.substring(0, 80).replace(/\n/g, ' ').trim();
          break;
        }
      } catch (e) {}
    }

    // Read last 64KB for usage + metadata
    const tailSize = Math.min(65536, stat.size);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, stat.size - tailSize);
    fs.closeSync(fd);
    const tailLines = tailBuf.toString('utf8').split('\n').reverse();

    // Find turn_duration
    for (const line of tailLines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.subtype === 'turn_duration') {
          result.lastTurnMs = data.durationMs || null;
          break;
        }
      } catch (e) {}
    }

    // Find last assistant message with usage
    const contextLimit = CONFIG ? CONFIG.contextLimit : 200000;
    for (const line of tailLines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.message && data.message.usage) {
          const u = data.message.usage;
          const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          result.contextPct = Math.round((contextLimit - used) / contextLimit * 100);
          if (result.contextPct < 0) result.contextPct = 0;
          if (result.contextPct > 100) result.contextPct = 100;
          result.model = data.message.model || null;
          result.stopReason = data.message.stop_reason || null;
          result.gitBranch = data.gitBranch || null;
          result.slug = data.slug || null;
          result.sessionId = data.sessionId || null;
          result.version = data.version || null;
          result.userType = data.userType || null;
          result.timestamp = data.timestamp || null;
          result.requestId = data.requestId || null;
          result.inputTokens = u.input_tokens || 0;
          result.cacheCreateTokens = u.cache_creation_input_tokens || 0;
          result.cacheReadTokens = u.cache_read_input_tokens || 0;
          result.outputTokens = u.output_tokens || 0;
          result.serviceTier = u.service_tier || null;
          break;
        }
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

function searchSessionContent(projectPath, sessionFile, query) {
  const result = { matched: false, snippets: [] };
  if (!query) return result;

  const filePath = path.join(projectPath, sessionFile);
  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const readSize = Math.min(262144, stat.size); // 256KB cap
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);

    const content = buf.toString('utf8');
    const lines = content.split('\n');
    const lowerQuery = query.toLowerCase();

    for (const line of lines) {
      if (!line.trim()) continue;
      if (result.snippets.length >= 3) break;
      try {
        const data = JSON.parse(line);
        if (!data.message || !data.message.content) continue;
        const role = data.message.role;
        if (role !== 'user' && role !== 'assistant') continue;

        let text = '';
        if (typeof data.message.content === 'string') {
          text = data.message.content;
        } else if (Array.isArray(data.message.content)) {
          text = data.message.content
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join(' ');
        }

        const lowerText = text.toLowerCase();
        let searchFrom = 0;
        while (searchFrom < lowerText.length && result.snippets.length < 3) {
          const idx = lowerText.indexOf(lowerQuery, searchFrom);
          if (idx === -1) break;
          const start = Math.max(0, idx - 20);
          const end = Math.min(text.length, idx + query.length + 30);
          let snippet = text.substring(start, end).replace(/\n/g, ' ');
          if (start > 0) snippet = '...' + snippet;
          if (end < text.length) snippet = snippet + '...';
          result.snippets.push(snippet);
          result.matched = true;
          searchFrom = idx + query.length;
        }
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

function getSessionFilesForProject(projectPath) {
  const now = Date.now();
  if (now - sessionFileCacheTime > 3000) {
    sessionFileCache.clear();
    sessionFileCacheTime = now;
  }

  if (sessionFileCache.has(projectPath)) return sessionFileCache.get(projectPath);

  try {
    const files = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const fp = path.join(projectPath, f);
        return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    sessionFileCache.set(projectPath, files);
    return files;
  } catch (e) {
    return [];
  }
}

function assignSessionsToProcesses(procs, CONFIG) {
  // Group processes by cwd
  const groups = new Map();
  for (const proc of procs) {
    if (!proc.cwd) continue;
    if (!groups.has(proc.cwd)) groups.set(proc.cwd, []);
    groups.get(proc.cwd).push(proc);
  }

  for (const [cwd, groupProcs] of groups) {
    const projectDirName = cwd.replace(/\//g, '-');
    const projectPath = path.join(process.env.HOME, '.claude', 'projects', projectDirName);

    if (!fs.existsSync(projectPath)) continue;

    const files = getSessionFilesForProject(projectPath);
    const n = groupProcs.length;
    const topFiles = files.slice(0, n);

    const sorted = [...groupProcs].sort((a, b) => b.startDate - a.startDate);

    for (let i = 0; i < sorted.length; i++) {
      if (i < topFiles.length) {
        const data = getSessionData(topFiles[i].path, CONFIG);
        if (data.title) sorted[i].title = data.title;
        for (const key of ['contextPct', 'model', 'stopReason', 'gitBranch', 'slug',
          'sessionId', 'version', 'userType', 'inputTokens', 'cacheCreateTokens',
          'cacheReadTokens', 'outputTokens', 'serviceTier', 'timestamp', 'requestId', 'lastTurnMs']) {
          if (data[key] !== null && data[key] !== undefined) sorted[i][key] = data[key];
        }
      }
    }
  }

  // Set fallback titles
  for (const proc of procs) {
    if (proc.title === 'Claude Code' && proc.cwd) {
      const parts = proc.cwd.split('/').filter(Boolean);
      proc.title = parts.length >= 2
        ? parts[parts.length - 2] + '/' + parts[parts.length - 1]
        : parts[parts.length - 1] || proc.cwd;
    }
  }
}

module.exports = {
  getSessionData, searchSessionContent, getSessionFilesForProject, assignSessionsToProcesses,
};
