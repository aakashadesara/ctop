const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getClaudeSubagents, renderSubagentRow, SUBAGENT_ACTIVE_MS } = require('../claude-manager');

describe('getClaudeSubagents', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-subagent-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgentFile(projectDir, sessionId, agentId, lines, ageMs = 0) {
    const dir = path.join(projectDir, sessionId, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `agent-${agentId}.jsonl`);
    fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    if (ageMs > 0) {
      const t = (Date.now() - ageMs) / 1000;
      fs.utimesSync(fp, t, t);
    }
    return fp;
  }

  it('returns empty array for missing session id', () => {
    assert.deepEqual(getClaudeSubagents(tmpDir, null), []);
  });

  it('returns empty array when subagents dir does not exist', () => {
    assert.deepEqual(getClaudeSubagents(tmpDir, 'no-such-session'), []);
  });

  it('detects a fresh sub-agent and extracts description + model', () => {
    writeAgentFile(tmpDir, 'sess-1', 'abc1234', [
      { type: 'user', isSidechain: true, agentId: 'abc1234',
        message: { role: 'user', content: 'Explore the codebase and find auth code.' } },
      { type: 'assistant', isSidechain: true, agentId: 'abc1234',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'On it.' }] } },
    ]);
    const result = getClaudeSubagents(tmpDir, 'sess-1');
    assert.equal(result.length, 1);
    assert.equal(result[0].agentId, 'abc1234');
    assert.match(result[0].description, /^Explore the codebase/);
    assert.equal(result[0].model, 'claude-sonnet-4-6');
    assert.ok(result[0].ageMs < SUBAGENT_ACTIVE_MS);
  });

  it('filters out stale sub-agents (older than the active window)', () => {
    writeAgentFile(tmpDir, 'sess-2', 'oldagent', [
      { type: 'user', message: { role: 'user', content: 'stale prompt' } },
    ], SUBAGENT_ACTIVE_MS + 5000);
    assert.deepEqual(getClaudeSubagents(tmpDir, 'sess-2'), []);
  });

  it('handles multiple sub-agents and sorts by most recent activity', () => {
    writeAgentFile(tmpDir, 'sess-3', 'newer', [
      { type: 'user', message: { role: 'user', content: 'newer task' } },
    ], 1000);
    writeAgentFile(tmpDir, 'sess-3', 'older', [
      { type: 'user', message: { role: 'user', content: 'older task' } },
    ], Math.floor(SUBAGENT_ACTIVE_MS / 2));
    const result = getClaudeSubagents(tmpDir, 'sess-3');
    assert.equal(result.length, 2);
    assert.equal(result[0].agentId, 'newer');
    assert.equal(result[1].agentId, 'older');
  });

  it('skips XML-tagged user content when picking description', () => {
    writeAgentFile(tmpDir, 'sess-4', 'agent99', [
      { type: 'user', message: { role: 'user', content: '<system-reminder>internal</system-reminder>' } },
      { type: 'user', message: { role: 'user', content: 'Actual prompt here.' } },
    ]);
    const result = getClaudeSubagents(tmpDir, 'sess-4');
    assert.equal(result.length, 1);
    assert.equal(result[0].description, 'Actual prompt here.');
  });
});

describe('renderSubagentRow', () => {
  const baseOpts = {
    ctxBarMode: false, isNarrow: false, showCostCol: false, costColW: 9,
    pluginCols: [], showSparklines: false, sparkColW: 10, gitColW: 10,
    listWidth: 200, fixedColsTotal: 130,
  };

  it('renders an indented row containing the description and model', () => {
    const row = renderSubagentRow({
      agentId: 'abc1234567', description: 'Explore: codebase root',
      model: 'claude-sonnet-4-6', ageMs: 2500,
    }, baseOpts);
    // Strip ANSI for content checks
    const plain = row.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[K/g, '');
    assert.match(plain, /SIDECHAIN/);
    assert.match(plain, /Explore: codebase root/);
    assert.match(plain, /sonnet-4-6/);
    assert.match(plain, /2s ago/);
  });

  it('uses "just now" for sub-second-old sub-agents', () => {
    const row = renderSubagentRow({
      agentId: 'x', description: 'task', model: null, ageMs: 200,
    }, baseOpts);
    const plain = row.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[K/g, '');
    assert.match(plain, /just now/);
  });

  it('falls back to placeholder when description/model are missing', () => {
    const row = renderSubagentRow({
      agentId: 'x', description: null, model: null, ageMs: 1500,
    }, baseOpts);
    const plain = row.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[K/g, '');
    assert.match(plain, /sub-agent/);
    assert.match(plain, /SIDECHAIN/);
  });
});
