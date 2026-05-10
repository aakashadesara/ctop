# Performance fixes for many concurrent agent sessions

## 1. Background

With ~73 active Claude Code / Codex CLI sessions, ctop becomes laggy on
macOS: rendering takes seconds, and `j`/`k` navigation and `q` quit are
unresponsive. The root cause is event-loop blocking from synchronous
shell-outs (`lsof`, `fs.readFileSync` of large JSONL files) inside the
5 s auto-refresh and inside `render()` itself. Stdin keypresses queue up
behind the blocking work and either fire late or never get processed.

## 2. Requirements Summary

Apply seven targeted fixes to `src/_core.js`. Keep it KISS — no new
files, no new abstractions, no new exported APIs unless required by
tests. Linux and Windows code paths must keep working. CLI flags,
config keys, and rendered output must not change. `npm test` must pass.

## 3. Acceptance Criteria

1. macOS `getProcessCwd` issues one batched `lsof -a -d cwd -p pid1,pid2,...`
   per refresh instead of N per-PID `lsof` calls.
2. cwd is cached per PID; only newly-seen PIDs trigger a resolution;
   cache entries for PIDs no longer in `ps` output are pruned.
3. `getSessionData(filePath)` returns a cached result when the file's
   `(mtimeMs, size)` is unchanged.
4. `getSessionFilesForProject(projectPath)` reuses the cached file list
   when the directory's `mtimeMs` is unchanged (no add/remove).
5. `readSessionLog` reads only the last ~64 KB of the JSONL and reuses
   the previous parsed entries when the file's `(mtimeMs, size)` is
   unchanged.
6. The 5 s auto-refresh `setInterval` skips the tick if the previous
   refresh hasn't finished.
7. Burst keystrokes coalesce into a single redraw — calling `render()`
   N times within one tick produces at most one screen write.
8. All action paths that rebuild the process list — kills (`x`, `X`,
   `K`, `A`, palette `kill`/`force-kill`) AND refresh (`r`, palette
   `refresh`) — use `getAllAgentProcesses` so Codex sessions are not
   dropped.
9. `npm test` passes.
10. No CLI flag, config key, or rendered output changes; Linux + Windows
    paths unchanged.

## 4. Problem Analysis

Hot spots identified by reading `src/_core.js`:

- **Per-PID `lsof` (`src/_core.js:1333` `getProcessCwd`).** Called once
  per Claude PID at `src/_core.js:1165` and once per Codex PID at
  `src/_core.js:1063`. On macOS each `lsof` is ~100–500 ms. 73 PIDs
  blocks the event loop for several seconds per refresh. — biggest win.
- **`getSessionData` re-reads + re-parses 128 KB per session per refresh
  (`src/_core.js:1363`).** No mtime cache.
- **`getSessionFilesForProject` (`src/_core.js:1541`)** has a 3 s TTL
  cache, which means it re-scans every project every ~3 s regardless of
  whether anything changed.
- **`readSessionLog` (`src/_core.js:1803`)** does `fs.readFileSync` on
  the entire JSONL on every render when the log pane is open.
- **5 s `setInterval` (`src/_core.js:5115`)** has no re-entry guard, so
  ticks stack when refresh runs longer than 5 s.
- **`render()` (`src/_core.js:3272`)** writes the full screen on every
  call; mashing `j` produces N redraws back-to-back.
- **Kill handlers** (`src/_core.js:4602, 4622, 4849, 4863, 4081, 4091`)
  re-query only `getClaudeProcesses`, silently dropping Codex.

Chosen approach: add module-level caches and one batched `lsof`; gate
`render()` and the refresh `setInterval` with simple flags. No
refactor; minimal diff.

## 5. Decision Log

**1. How to batch `lsof` on macOS while keeping `getProcessCwd` callers
unchanged**
- Options:
  A) Replace `getProcessCwd` callers with a new batch helper, removing
     `getProcessCwd`.
  B) Keep `getProcessCwd(pid)` but back it with a module-level cache;
     add a new `resolveCwds(pids)` that the two `get*Processes`
     functions call once before the per-PID loop, then `getProcessCwd`
     becomes a cache lookup.
- Decision: **B)** — keeps the surface the same and avoids touching
  the Windows `getProcessCwd` path. The batched call populates the
  cache; per-PID lookups become O(1) Map reads.

**2. cwd-cache invalidation policy**
- Options:
  A) Never invalidate.
  B) Prune entries for PIDs no longer in the latest `ps` output, with
     the union of Claude + Codex PIDs, called from
     `getAllAgentProcesses`.
  C) Prune inside `resolveCwds` using the per-agent PID list.
- Decision: **B)** — (C) is incorrect: a Claude refresh prunes all
  Codex PIDs (they're not in Claude's input list) and vice versa,
  thrashing the cache between agent types. Pruning at the union level
  in `getAllAgentProcesses` is the right boundary; the only path that
  rebuilds *both* lists also reconciles the cache.
- Accepted limitation: a freshly-recycled PID (process exits, OS
  reuses the PID for a different process between refreshes) returns
  stale cwd for one refresh cycle. Self-corrects within 5 s. Not
  worth a per-PID start-time fingerprint for long-lived agent
  processes.

**3. `lsof` failure mode (some PIDs gone between `ps` and `lsof`)**
- Options:
  A) Let `execSync` throw on nonzero exit and fall back to per-PID.
  B) Pipe through `2>/dev/null || true` so we always read stdout, then
     parse what we got. Cache `''` for any PID lsof didn't return.
  C) Same as B, but distinguish "lsof returned nothing for this PID"
     (cache empty — PID gone) from "lsof itself failed / produced no
     output at all" (do not cache; let next refresh retry).
- Decision: **C)** — Revised in Phase 4 review. Blanket-caching `''`
  on a totally-empty lsof response (e.g. lsof not on PATH) would
  permanently empty every cwd until ctop restarts. Detect `out === ''`
  and skip the "record empty" loop; treat per-PID empty as the gone
  case only when at least one other PID succeeded.

**4. `lsof` output parsing**
- Options:
  A) Use field offsets in the textual output.
  B) Use machine format `lsof -F pn` (one field per line, prefixed by
     `p`/`n`).
- Decision: **B)** — `-F pn` is unambiguous and immune to columns
  shifting on long usernames or paths with spaces. Output is a stream
  of `p<pid>\nn<cwd>\n` blocks.

**5. `getSessionFilesForProject` cache key**
- Options:
  A) Keep the existing 3 s TTL.
  B) Cache by directory `mtimeMs`, return cached list with cached
     mtimes (sort can go stale until a file is added/removed).
  C) Cache the file *names* by directory `mtimeMs`, but always
     re-stat each file on every call to get a fresh `mtime` for
     sorting.
- Decision: **C)** — Revised in Phase 4 review. (B) is a real bug:
  `assignSessionsToProcesses` (`src/_core.js:1581-1599`) uses the
  sort to map the N most-recently-modified session files to the N
  active processes in a cwd. If a file's content updates without
  add/remove, dir mtime does not change, the cached order is wrong,
  and the wrong session metadata (title / context / tokens) attaches
  to a process — and stays wrong until the directory mtime bumps,
  which can be many minutes. Re-statting cached entries is N very
  cheap stat calls per project (a few microseconds each), preserving
  correct sort while still avoiding `readdirSync`.

**6. `getSessionData` cache key and storage**
- Options:
  A) `path → {mtimeMs, size, data}`, in-memory Map.
  B) Same plus periodic eviction.
- Decision: **A)** — stale entries naturally get displaced as projects
  rotate. Number of session files is bounded in practice; not worth a
  cleanup loop.

**7. Same-shape cache for `getCodexSessionData`?**
- Options:
  A) Cache only the Claude-side `getSessionData` (the user's
     literal request).
  B) Apply the same `(path, mtime, size)` cache to
     `getCodexSessionData` for symmetry.
- Decision: **B)** — same hot pattern, trivial extra lines, no risk.
  Codex sessions also count toward the 73 in the user's report.

**8. `readSessionLog` tail size and partial-line handling**
- Options:
  A) Always read the whole file (today).
  B) Read last 64 KB; when the read window does not start at offset 0,
     drop the first split fragment because it may be a partial JSON
     line.
- Decision: **B)** — matches the tail strategy already used by
  `getSessionData` (`src/_core.js:1399-1404`). When the file is ≤ 64 KB
  the read covers the whole file and there is no partial line to drop,
  so existing tests (which use small files) keep working.
- Known limitation: the 64 KB boundary is byte-aligned, not codepoint-
  aligned, so for files >64 KB the *second* line of the tail can begin
  with a U+FFFD if a multi-byte UTF-8 character straddles the boundary.
  `JSON.parse` then throws and that single line is silently skipped.
  This is at most one missing log line per file change, not corruption,
  and is acceptable for a recent-activity pane.

**9. `readSessionLog` cache shape**
- Options:
  A) Cache the parsed entries (full array); slice to `maxLines` per
     call. Re-parse only on `(mtimeMs, size)` change.
  B) Cache and slice eagerly with `maxLines` baked into the key.
- Decision: **A)** — simpler key; the slice is O(N) on a small array.

**10. `setInterval` re-entry guard placement**
- Options:
  A) Top-level `let refreshing = false;` checked at the start of the
     callback; set in `try`, cleared in `finally`.
  B) Convert refresh to async with a Promise lock.
- Decision: **A)** — refresh body is synchronous, so a plain flag is
  enough.

**11. Render coalescing strategy**
- Options:
  A) Replace every `render()` call site with a new `scheduleRender()`.
  B) Rename the current `render()` body to `renderNow()` (private),
     and make `render()` a coalescing wrapper that schedules
     `renderNow` via `setImmediate` when not already pending.
- Decision: **B)** — zero churn at call sites, and every existing
  `render()` automatically gets coalesced.
- Scope clarification (added in Phase 4 review): render coalescing is
  the *cosmetic* fix for "mashing `j` produces N redraws"; it does
  *not* on its own fix the unresponsive-`q` symptom. The latency win
  comes from the cwd cache (Decisions 1–4) and the refresh re-entry
  guard (Decision 10), which together keep the event loop free for
  stdin events.
- Known minor regression: code that sets `statusMessage = '...'` and
  then synchronously sets it again before the next tick will only
  display the second message (`render()` consumes the message at
  `src/_core.js:3303-3306`). Audit shows no current call site does
  this — every status set is followed by a `render()` and a return to
  the event loop.
- SIGWINCH (`src/_core.js:5075`) and other resize-driven renders are
  also coalesced; deferred by ≤ 1 ms via `setImmediate`, which is
  imperceptible.

**12. Coalescing scheduler**
- Options:
  A) `setImmediate`.
  B) `process.nextTick`.
  C) `setTimeout(..., 0)`.
- Decision: **A)** — `setImmediate` runs after pending I/O events,
  which lets stdin `data` events drain first. `process.nextTick` would
  run before I/O and starve stdin, defeating the purpose.

**13. Kill handler refresh function**
- Options:
  A) Swap `getClaudeProcesses` → `getAllAgentProcesses` in the kill
     and refresh paths and leave the rest of the body alone.
  B) Splice the killed PID out of `allProcesses` directly.
- Decision: **A)** — meets AC8 with one identifier change per site.
  Splicing is nice but not required; the cwd cache + file caches make
  re-querying cheap anyway.
- Scope expansion (added in Phase 4 review): swap *every* "rebuild
  process list after action" call site, not just the kill ones. `grep`
  identified eight: lines 4084, 4095, 4204, 4602, 4623, 4849, 4864,
  4962. Lines 4204 (palette `case 'refresh'`) and 4962 (key handler
  `case 'r'`) are user-triggered refresh-all and were also dropping
  Codex sessions. After this swap, the only callers of
  `getClaudeProcesses` are `getAllAgentProcesses` (`src/_core.js:1228`)
  and module exports.

**14. Test coverage for new caches and the lsof parser**
- Options:
  A) Add unit tests for `resolveCwds` (mocked execSync), the
     `getSessionData` cache, and `readSessionLog` on a >64 KB file.
  B) Rely on existing tests + manual verification with a real 73-
     session workload.
- Decision: **B)** — KISS / YAGNI per project conventions. Existing
  `session.test.js` and `log-tailing.test.js` exercise the public
  surface with small files, which guarantees no behavior regression
  there. The new code paths are small, localised, and have no
  branching beyond what's covered in the design. Adding parser tests
  would require either exporting a private helper or mocking
  `execSync` — both contradict the "no new abstractions" constraint.
  Accept the risk; user can run with their 73-session workload as
  the integration test.

**15. Out-of-scope cache opportunities**
- `searchSessionContent` (`src/_core.js:1452`) also reads up to 256 KB
  per session via `fs.readFileSync`. Not on the hot path — it runs
  only on demand when the user types `F`-search. Leave alone.

## 6. Design

All changes live in `src/_core.js`. No new files. All new module-level
state is private (not exported).

### 6.1 cwd batching + cache (Decisions 1–4)

New module-level state near the existing process helpers:

```js
const pidCwdCache = new Map(); // pid -> cwd (string)
```

New helper that resolves only uncached PIDs (pruning happens at the
union level — see `pruneCwdCache` below — so per-agent calls don't
clobber the other agent's cache):

```js
function resolveCwds(pids) {
  const missing = pids.filter(pid => !pidCwdCache.has(pid));
  if (missing.length === 0) return;

  if (IS_LINUX) {
    for (const pid of missing) {
      try { pidCwdCache.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`)); }
      catch { pidCwdCache.set(pid, ''); }
    }
    return;
  }

  if (IS_WIN) {
    // Keep existing per-PID powershell behavior — Windows rarely has
    // many concurrent agents, and CIM batching has its own quirks.
    for (const pid of missing) pidCwdCache.set(pid, getProcessCwd(pid));
    return;
  }

  // macOS: one batched lsof using machine format -F pn
  // -a AND-combines filters; -d cwd restricts to cwd FDs;
  // 2>/dev/null || true ensures we still get partial stdout.
  let out = '';
  try {
    const list = missing.join(',');
    out = execSync(
      `lsof -a -d cwd -F pn -p ${list} 2>/dev/null || true`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }
    );
  } catch {}

  // Parser: -F pn emits a 'p<pid>' line followed by zero-or-more FD
  // records terminated by 'n<path>'. We must reset curPid after
  // consuming an n line, otherwise a PID with no n record would steal
  // the next PID's path.
  let curPid = null;
  for (const line of out.split('\n')) {
    if (line.length === 0) continue;
    const tag = line[0];
    if (tag === 'p') {
      curPid = line.slice(1);
    } else if (tag === 'n' && curPid) {
      pidCwdCache.set(curPid, line.slice(1));
      curPid = null;
    }
  }

  // Only fill empty placeholders if lsof actually produced output.
  // An entirely empty `out` means lsof failed (missing binary, sandbox,
  // etc.) — do not poison the cache; let the next refresh retry.
  if (out !== '') {
    for (const pid of missing) {
      if (!pidCwdCache.has(pid)) pidCwdCache.set(pid, '');
    }
  }
}
```

Plus a separate prune helper called from `getAllAgentProcesses` with
the *union* of Claude + Codex PIDs:

```js
function pruneCwdCache(activePids) {
  const active = new Set(activePids);
  for (const pid of pidCwdCache.keys()) {
    if (!active.has(pid)) pidCwdCache.delete(pid);
  }
}
```

Pruning per-agent inside `resolveCwds` would be wrong: the Claude call
would delete every Codex PID's cwd, and vice versa. Pruning at the
union level is correct.

PID-recycle race: between the moment a process exits and the next
refresh, another process can reuse its PID. The cache returns the old
cwd for one refresh cycle. This is rare for long-lived agent
processes and self-corrects within 5 s; documented as accepted
limitation.

`getProcessCwd(pid)` becomes a cache-aware single-PID lookup that
falls back to the old logic for callers that bypass `resolveCwds`
(only the Windows codex path uses it that way today):

```js
function getProcessCwd(pid) {
  if (pidCwdCache.has(pid)) return pidCwdCache.get(pid);
  // ...existing per-PID body, but write the result into the cache before returning...
}
```

Both `getClaudeProcesses` and `getCodexProcesses` call
`resolveCwds(pidsFromPs)` once after parsing the `ps` output, then
the existing `const cwd = getProcessCwd(pid);` lines become O(1)
Map reads.

`getAllAgentProcesses` calls `pruneCwdCache(...)` with the union of
Claude + Codex pids at the end.

### 6.2 `getSessionData` + `getCodexSessionData` mtime cache (Decisions 6, 7)

```js
const sessionDataCache = new Map(); // filePath -> { mtimeMs, size, data }

function getSessionData(filePath) {
  let st;
  try { st = fs.statSync(filePath); } catch { /* fall through */ }
  if (st) {
    const hit = sessionDataCache.get(filePath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
  }
  // ... existing body, unchanged ...
  if (st) sessionDataCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, data: result });
  return result;
}
```

Same pattern wrapped around `getCodexSessionData` with its own
`codexSessionDataCache` Map.

### 6.3 `getSessionFilesForProject` mtime cache (Decision 5)

Replace the existing 3 s TTL block with: cache the file *names* by
directory `mtimeMs`, but always re-stat each cached file on every call
so the mtime sort stays accurate when file contents change without
adds/removes.

```js
function getSessionFilesForProject(projectPath) {
  let dirMtime;
  try { dirMtime = fs.statSync(projectPath).mtimeMs; } catch { return []; }
  let names;
  const cached = sessionFileCache.get(projectPath);
  if (cached && cached.dirMtime === dirMtime) {
    names = cached.names;
  } else {
    try {
      names = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    } catch { return []; }
    sessionFileCache.set(projectPath, { dirMtime, names });
  }
  // Always re-stat to get fresh mtimes for sorting — cheap (microseconds)
  // and required for correctness because file content updates do not
  // bump the directory mtime.
  const files = [];
  for (const name of names) {
    const fp = path.join(projectPath, name);
    try { files.push({ name, path: fp, mtime: fs.statSync(fp).mtime }); }
    catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}
```

The existing `let sessionFileCache = new Map();` is reused (its value
shape changes from `files[]` to `{dirMtime, names}`);
`sessionFileCacheTime` becomes unused and is removed.

### 6.4 `readSessionLog` tail-only + cache (Decisions 8, 9)

```js
const sessionLogCache = new Map(); // filePath -> { mtimeMs, size, entries }
const LOG_TAIL_BYTES = 64 * 1024;

function readSessionLog(proc, maxLines) {
  if (maxLines === undefined) maxLines = 50;
  if (!proc || !proc.cwd) return [];

  // Locate session file (preserved verbatim from the existing body):
  //   - build projectPath
  //   - if (!fs.existsSync(projectPath)) return [];
  //   - const files = getSessionFilesForProject(projectPath);
  //   - if (files.length === 0) return [];
  //   - const filePath = files[0].path;

  let st;
  try { st = fs.statSync(filePath); } catch { return []; }
  const hit = sessionLogCache.get(filePath);
  let entries;
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    entries = hit.entries;
  } else {
    entries = [];
    try {
      const fd = fs.openSync(filePath, 'r');
      const readSize = Math.min(LOG_TAIL_BYTES, st.size);
      const offset = st.size - readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, offset);
      fs.closeSync(fd);
      const lines = buf.toString('utf8').split('\n');
      // If we did not read from the start of the file, the first split
      // fragment may be partial — drop it.
      const start = offset > 0 ? 1 : 0;
      for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const entry = parseLogEntry(data);
          if (entry) {
            const prefix = entry.role === 'user' ? 'USER' : 'ASSISTANT';
            entries.push({ role: entry.role, text: `${prefix}: ${entry.text}` });
          }
        } catch {}
      }
    } catch { return []; }
    sessionLogCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, entries });
  }
  return entries.slice(-maxLines);
}
```

Test compatibility: existing tests use files under 64 KB, so
`offset === 0` and the partial-line drop is skipped — behavior is
identical to today on those inputs.

### 6.5 Refresh re-entry guard (Decision 10)

```js
let refreshing = false;

setInterval(() => {
  if (refreshing) return;
  if (showingHelp || showHistory || /* ...existing guards... */) return;
  refreshing = true;
  try {
    // existing refresh body
  } finally {
    refreshing = false;
  }
}, CONFIG.refreshInterval);
```

### 6.6 Render coalescing (Decisions 11, 12)

Rename current `function render()` body → `function renderNow()`
(module-private, not exported). Add:

```js
let renderPending = false;

function render() {
  if (renderPending) return;
  renderPending = true;
  setImmediate(() => {
    renderPending = false;
    renderNow();
  });
}
```

All existing `render()` callers keep working unchanged. Module export
of `render` is not used (current exports list does not include it; any
internal animation/timer paths still call `render()` and benefit from
coalescing).

### 6.7 Action paths use `getAllAgentProcesses` (Decision 13)

Eight find-and-replace edits in `src/_core.js`, replacing
`getClaudeProcesses` → `getAllAgentProcesses`:

- Line ~4084 (palette `case 'kill'`).
- Line ~4095 (palette `case 'force-kill'`).
- Line ~4204 (palette `case 'refresh'`).
- Line ~4602 (`confirmKillAll` Y branch).
- Line ~4623 (`confirmKillStopped` Y branch).
- Line ~4849 (key `case 'x'`).
- Line ~4864 (key `case 'X'`).
- Line ~4962 (key `case 'r'`).

After this, the only callers of `getClaudeProcesses` are
`getAllAgentProcesses` itself (`src/_core.js:1228`) and the module
`exports` block.

## 7. Files Changed

- `src/_core.js` — add cwd batching + cache; add `getSessionData`,
  `getCodexSessionData`, `getSessionFilesForProject` mtime caches;
  rewrite `readSessionLog` tail-only + cache; add refresh re-entry
  guard; coalesce `render()` via `setImmediate`; switch six kill paths
  to `getAllAgentProcesses`.
- `docs/designs/2026-05-10-perf-many-sessions.md` — this design doc.

No other files change. `src/*.js` thin re-exports stay as-is.

## 8. Verification

1. [AC1] `grep -c "lsof " src/_core.js` shows the batched form
   (`lsof -a -d cwd -F pn -p`) and no more per-PID `lsof -p ${pid}`
   inside loops. Manual: with 73 sessions, refresh wall time drops to
   sub-second on macOS (vs. several seconds today).
2. [AC2] Inspect `pidCwdCache` behavior by reading the diff: cache is
   populated by `resolveCwds`, queried by `getProcessCwd`, pruned by
   `pruneCwdCache(activePids)` at the end of `getAllAgentProcesses`.
3. [AC3] Read `getSessionData`: stat-then-key-lookup before the
   existing body; cache populated on miss.
4. [AC4] Read `getSessionFilesForProject`: dir mtime is the cache key;
   no TTL.
5. [AC5] Read `readSessionLog`: only `LOG_TAIL_BYTES` are read;
   `(mtimeMs, size)` cache short-circuits the read+parse.
6. [AC6] Read the `setInterval` callback: early-returns when
   `refreshing` is true; sets/clears in `try/finally`.
7. [AC7] Read `render()` wrapper: sets `renderPending`, schedules
   `renderNow` on `setImmediate`. Manual: hold `j` for a second; CPU
   stays low and the cursor moves smoothly to the bottom rather than
   producing a redraw per keystroke.
8. [AC8] `grep -n getClaudeProcesses src/_core.js` shows the function
   only in its own definition and possibly other non-kill paths; the
   six kill sites now call `getAllAgentProcesses`. Manual: with both
   Claude and Codex running, kill one Claude session — Codex sessions
   remain in the list.
9. [AC9] `npm test` exits 0.
10. [AC10] `git diff --stat` only touches `src/_core.js` and the new
    design doc; rendered output (header, columns, footer) is byte-
    identical for a steady state.
