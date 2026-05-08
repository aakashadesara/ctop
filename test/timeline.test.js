const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSessionTimeline, formatElapsed } = require('../claude-manager');

describe('parseSessionTimeline', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-timeline-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJsonl(lines) {
    const filePath = path.join(tmpDir, 'session.jsonl');
    fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return filePath;
  }

  it('parses user messages as type "user"', () => {
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: 'Hello world' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'user');
    assert.equal(result.events[0].summary, 'Hello world');
  });

  it('parses assistant messages as type "assistant"', () => {
    const filePath = writeJsonl([
      { timestamp: '2025-01-01T10:00:00Z', message: { role: 'assistant', content: 'I can help with that.' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'assistant');
    assert.equal(result.events[0].summary, 'I can help with that.');
  });

  it('detects tool_use blocks in assistant messages', () => {
    const filePath = writeJsonl([
      { timestamp: '2025-01-01T10:00:00Z', message: { role: 'assistant', content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/test.js' } },
      ] } },
    ]);
    const result = parseSessionTimeline(filePath);
    // Should have both an assistant text event and a tool_use event
    const assistantEvts = result.events.filter(e => e.type === 'assistant');
    const toolEvts = result.events.filter(e => e.type === 'tool_use');
    assert.equal(assistantEvts.length, 1);
    assert.equal(toolEvts.length, 1);
    assert.equal(toolEvts[0].summary, 'Read');
  });

  it('detects tool_result events', () => {
    const filePath = writeJsonl([
      { type: 'tool_result', timestamp: '2025-01-01T10:00:05Z', message: { role: 'tool', content: 'file contents' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'tool_result');
  });

  it('extracts timestamps and calculates startTime/endTime', () => {
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: 'Start' } },
      { timestamp: '2025-01-01T10:05:00Z', message: { role: 'assistant', content: 'Done' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.startTime, new Date('2025-01-01T10:00:00Z').getTime());
    assert.equal(result.endTime, new Date('2025-01-01T10:05:00Z').getTime());
  });

  it('calculates totalDuration between first and last event', () => {
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: 'Start' } },
      { timestamp: '2025-01-01T10:02:30Z', message: { role: 'assistant', content: 'End' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.totalDuration, 150000); // 2m30s = 150000ms
  });

  it('calculates duration_ms between consecutive events', () => {
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: 'Q1' } },
      { timestamp: '2025-01-01T10:00:10Z', message: { role: 'assistant', content: 'A1' } },
      { type: 'user', timestamp: '2025-01-01T10:01:00Z', message: { role: 'user', content: 'Q2' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events[0].duration_ms, 10000); // 10s between Q1 and A1
    assert.equal(result.events[1].duration_ms, 50000); // 50s between A1 and Q2
  });

  it('returns empty result for null filePath', () => {
    const result = parseSessionTimeline(null);
    assert.deepEqual(result.events, []);
    assert.equal(result.startTime, null);
    assert.equal(result.endTime, null);
    assert.equal(result.totalDuration, 0);
  });

  it('returns empty result for missing file', () => {
    const result = parseSessionTimeline('/nonexistent/file.jsonl');
    assert.deepEqual(result.events, []);
    assert.equal(result.totalDuration, 0);
  });

  it('returns empty result for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '');
    const result = parseSessionTimeline(filePath);
    assert.deepEqual(result.events, []);
    assert.equal(result.totalDuration, 0);
  });

  it('handles corrupt JSON lines gracefully', () => {
    const filePath = path.join(tmpDir, 'corrupt.jsonl');
    const content = [
      '{ invalid json here',
      JSON.stringify({ type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: 'Valid' } }),
      'not valid',
    ].join('\n') + '\n';
    fs.writeFileSync(filePath, content);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'user');
  });

  it('filters out system-like XML user messages', () => {
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: '<system>instructions</system>' } },
      { type: 'user', timestamp: '2025-01-01T10:00:01Z', message: { role: 'user', content: 'Real question' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].summary, 'Real question');
  });

  it('truncates summary to 40 characters', () => {
    const longText = 'A'.repeat(100);
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: longText } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events[0].summary.length, 40);
  });

  it('handles user message with content array', () => {
    const filePath = writeJsonl([
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: {
        role: 'user',
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'second part' },
        ],
      } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'user');
    assert.ok(result.events[0].summary.includes('First part'));
  });

  it('skips non-conversation entries like summary and subtype', () => {
    const filePath = writeJsonl([
      { summary: 'Session summary' },
      { subtype: 'turn_duration', durationMs: 5000 },
      { type: 'user', timestamp: '2025-01-01T10:00:00Z', message: { role: 'user', content: 'Hello' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'user');
  });

  it('handles events without timestamps', () => {
    const filePath = writeJsonl([
      { type: 'user', message: { role: 'user', content: 'No timestamp' } },
    ]);
    const result = parseSessionTimeline(filePath);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].timestamp, null);
    assert.equal(result.startTime, null);
    assert.equal(result.totalDuration, 0);
  });

  it('handles multiple tool_use blocks in single assistant message', () => {
    const filePath = writeJsonl([
      { timestamp: '2025-01-01T10:00:00Z', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
        { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
      ] } },
    ]);
    const result = parseSessionTimeline(filePath);
    const toolEvts = result.events.filter(e => e.type === 'tool_use');
    assert.equal(toolEvts.length, 2);
    assert.equal(toolEvts[0].summary, 'Read');
    assert.equal(toolEvts[1].summary, 'Bash');
  });
});

describe('formatElapsed', () => {
  it('formats milliseconds', () => {
    assert.equal(formatElapsed(500), '500ms');
  });

  it('formats seconds', () => {
    assert.equal(formatElapsed(5000), '5.0s');
    assert.equal(formatElapsed(30500), '30.5s');
  });

  it('formats minutes and seconds', () => {
    assert.equal(formatElapsed(90000), '1m 30s');
    assert.equal(formatElapsed(300000), '5m 0s');
  });

  it('formats hours and minutes', () => {
    assert.equal(formatElapsed(3660000), '1h 1m');
    assert.equal(formatElapsed(7200000), '2h 0m');
  });
});
