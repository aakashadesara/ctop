const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getSessionData } = require('../claude-manager');

describe('getSessionData', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default null values for a non-existent file', () => {
    const result = getSessionData('/no/such/file.jsonl');
    assert.equal(result.title, null);
    assert.equal(result.contextPct, null);
    assert.equal(result.model, null);
    assert.equal(result.stopReason, null);
    assert.equal(result.gitBranch, null);
  });

  it('returns default null values for an empty file', () => {
    const fp = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(fp, '');
    const result = getSessionData(fp);
    assert.equal(result.title, null);
    assert.equal(result.contextPct, null);
  });

  it('extracts title from a summary field', () => {
    const fp = path.join(tmpDir, 'summary.jsonl');
    const lines = [
      JSON.stringify({ summary: 'Fix authentication bug in login flow' }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.title, 'Fix authentication bug in login flow');
  });

  it('truncates title to 50 chars for summary', () => {
    const fp = path.join(tmpDir, 'long-summary.jsonl');
    const longTitle = 'A'.repeat(100);
    const lines = [
      JSON.stringify({ summary: longTitle }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.title.length, 50);
  });

  it('extracts title from first user message if no summary', () => {
    const fp = path.join(tmpDir, 'user-msg.jsonl');
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Please fix the tests' },
      }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.title, 'Please fix the tests');
  });

  it('extracts title from user message with content array', () => {
    const fp = path.join(tmpDir, 'user-msg-array.jsonl');
    const lines = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Refactor the database layer' }],
        },
      }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.title, 'Refactor the database layer');
  });

  it('skips user messages starting with < (XML-like)', () => {
    const fp = path.join(tmpDir, 'xml-skip.jsonl');
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '<system>do not use</system>' },
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Real user question here' },
      }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.title, 'Real user question here');
  });

  it('parses usage data from assistant message at end of file', () => {
    const fp = path.join(tmpDir, 'usage.jsonl');
    const lines = [
      JSON.stringify({ summary: 'Test task' }),
      JSON.stringify({
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 50000,
            cache_creation_input_tokens: 10000,
            cache_read_input_tokens: 20000,
            output_tokens: 5000,
            service_tier: 'standard',
          },
        },
        gitBranch: 'feature-x',
        slug: 'test-slug',
        sessionId: 'sess-123',
        version: '1.0.0',
        userType: 'pro',
        timestamp: '2025-01-15T10:00:00Z',
        requestId: 'req-456',
      }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.model, 'claude-sonnet-4-20250514');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(result.gitBranch, 'feature-x');
    assert.equal(result.slug, 'test-slug');
    assert.equal(result.sessionId, 'sess-123');
    assert.equal(result.inputTokens, 50000);
    assert.equal(result.cacheCreateTokens, 10000);
    assert.equal(result.cacheReadTokens, 20000);
    assert.equal(result.outputTokens, 5000);
    assert.equal(result.serviceTier, 'standard');
  });

  it('calculates contextPct correctly from usage data', () => {
    const fp = path.join(tmpDir, 'ctx-pct.jsonl');
    // total used = 100000 + 20000 + 30000 = 150000
    // contextLimit default = 200000
    // remaining = 50000, pct = 50000/200000 * 100 = 25
    const lines = [
      JSON.stringify({
        message: {
          usage: {
            input_tokens: 100000,
            cache_creation_input_tokens: 20000,
            cache_read_input_tokens: 30000,
            output_tokens: 1000,
          },
        },
      }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.contextPct, 25);
  });

  it('clamps contextPct to 0 when usage exceeds limit', () => {
    const fp = path.join(tmpDir, 'over-limit.jsonl');
    // total used = 200000 + 50000 = 250000 > 200000 limit
    const lines = [
      JSON.stringify({
        message: {
          usage: {
            input_tokens: 200000,
            cache_creation_input_tokens: 50000,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.contextPct, 0);
  });

  it('parses turn_duration subtype', () => {
    const fp = path.join(tmpDir, 'turn-dur.jsonl');
    const lines = [
      JSON.stringify({ summary: 'Task' }),
      JSON.stringify({ subtype: 'turn_duration', durationMs: 4500 }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.lastTurnMs, 4500);
  });

  it('handles corrupt JSON lines gracefully', () => {
    const fp = path.join(tmpDir, 'corrupt.jsonl');
    const lines = [
      '{ invalid json',
      'not json at all',
      JSON.stringify({ summary: 'Still works' }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    const result = getSessionData(fp);
    assert.equal(result.title, 'Still works');
  });

  it('handles a file with only corrupt lines', () => {
    const fp = path.join(tmpDir, 'all-corrupt.jsonl');
    fs.writeFileSync(fp, '{ bad }\n{ also bad }\n');
    const result = getSessionData(fp);
    assert.equal(result.title, null);
    assert.equal(result.contextPct, null);
  });
});
