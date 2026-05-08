const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseLogEntry, readSessionLog } = require('../claude-manager');

describe('parseLogEntry', () => {
  it('parses a user message with string content', () => {
    const data = {
      type: 'user',
      message: { role: 'user', content: 'Please fix the bug' },
    };
    const result = parseLogEntry(data);
    assert.deepEqual(result, { role: 'user', text: 'Please fix the bug' });
  });

  it('parses an assistant message with string content', () => {
    const data = {
      message: { role: 'assistant', content: 'I will fix the bug now.' },
    };
    const result = parseLogEntry(data);
    assert.deepEqual(result, { role: 'assistant', text: 'I will fix the bug now.' });
  });

  it('parses user message with content array (text blocks only)', () => {
    const data = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello there' },
          { type: 'text', text: 'and more text' },
        ],
      },
    };
    const result = parseLogEntry(data);
    assert.deepEqual(result, { role: 'user', text: 'Hello there and more text' });
  });

  it('filters out tool_use blocks from assistant content array', () => {
    const data = {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check that file.' },
          { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/test' } },
        ],
      },
    };
    const result = parseLogEntry(data);
    assert.deepEqual(result, { role: 'assistant', text: 'Let me check that file.' });
  });

  it('returns null for system messages', () => {
    const data = {
      message: { role: 'system', content: 'You are a helpful assistant' },
    };
    const result = parseLogEntry(data);
    assert.equal(result, null);
  });

  it('returns null for entries without a message field', () => {
    const data = { summary: 'Some summary' };
    const result = parseLogEntry(data);
    assert.equal(result, null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(parseLogEntry(null), null);
    assert.equal(parseLogEntry(undefined), null);
  });

  it('returns null for entries with empty text content', () => {
    const data = {
      type: 'user',
      message: { role: 'user', content: '   ' },
    };
    const result = parseLogEntry(data);
    assert.equal(result, null);
  });

  it('filters out user messages starting with < (system-like XML)', () => {
    const data = {
      type: 'user',
      message: { role: 'user', content: '<system-reminder>some instructions</system-reminder>' },
    };
    const result = parseLogEntry(data);
    assert.equal(result, null);
  });

  it('replaces newlines with spaces in text', () => {
    const data = {
      message: { role: 'assistant', content: 'line one\nline two\nline three' },
    };
    const result = parseLogEntry(data);
    assert.equal(result.text, 'line one line two line three');
  });

  it('returns null for tool_result role', () => {
    const data = {
      message: { role: 'tool_result', content: 'file contents here' },
    };
    const result = parseLogEntry(data);
    assert.equal(result, null);
  });

  it('handles content array with only non-text blocks', () => {
    const data = {
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'Bash', input: {} },
        ],
      },
    };
    const result = parseLogEntry(data);
    assert.equal(result, null);
  });
});

describe('readSessionLog', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-log-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupSession(cwd, lines) {
    const projectDirName = cwd.replace(/\//g, '-');
    const projectPath = path.join(tmpDir, '.claude', 'projects', projectDirName);
    fs.mkdirSync(projectPath, { recursive: true });
    const sessionFile = path.join(projectPath, 'session.jsonl');
    fs.writeFileSync(sessionFile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return sessionFile;
  }

  it('reads user and assistant messages from session file', () => {
    const cwd = '/test/project';
    setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: 'Hello' } },
      { message: { role: 'assistant', content: 'Hi there!' } },
    ]);

    const result = readSessionLog({ cwd, pid: '123' });
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].text, 'USER: Hello');
    assert.equal(result[1].role, 'assistant');
    assert.equal(result[1].text, 'ASSISTANT: Hi there!');
  });

  it('filters out system messages and tool calls', () => {
    const cwd = '/test/project2';
    setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: 'Fix the tests' } },
      { message: { role: 'system', content: 'System prompt here' } },
      { message: { role: 'assistant', content: [
        { type: 'text', text: 'I will fix the tests.' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ] } },
      { subtype: 'turn_duration', durationMs: 5000 },
      { summary: 'Fix tests' },
    ]);

    const result = readSessionLog({ cwd, pid: '456' });
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'USER: Fix the tests');
    assert.equal(result[1].text, 'ASSISTANT: I will fix the tests.');
  });

  it('returns empty array for missing session file', () => {
    const result = readSessionLog({ cwd: '/nonexistent/path', pid: '789' });
    assert.deepEqual(result, []);
  });

  it('returns empty array when proc is null', () => {
    const result = readSessionLog(null);
    assert.deepEqual(result, []);
  });

  it('returns empty array when proc has no cwd', () => {
    const result = readSessionLog({ pid: '123' });
    assert.deepEqual(result, []);
  });

  it('truncates to maxLines', () => {
    const cwd = '/test/project3';
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `Message ${i}` } });
    }
    setupSession(cwd, lines);

    const result = readSessionLog({ cwd, pid: '111' }, 5);
    assert.equal(result.length, 5);
    // Should be the last 5
    assert.equal(result[0].text, 'USER: Message 15');
    assert.equal(result[4].text, 'USER: Message 19');
  });

  it('formats user messages with USER prefix', () => {
    const cwd = '/test/project4';
    setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: 'Tell me about X' } },
    ]);

    const result = readSessionLog({ cwd, pid: '222' });
    assert.equal(result.length, 1);
    assert.ok(result[0].text.startsWith('USER:'));
  });

  it('formats assistant messages with ASSISTANT prefix', () => {
    const cwd = '/test/project5';
    setupSession(cwd, [
      { message: { role: 'assistant', content: 'Here is the answer' } },
    ]);

    const result = readSessionLog({ cwd, pid: '333' });
    assert.equal(result.length, 1);
    assert.ok(result[0].text.startsWith('ASSISTANT:'));
  });

  it('handles corrupt JSON lines gracefully', () => {
    const cwd = '/test/project6';
    const projectDirName = cwd.replace(/\//g, '-');
    const projectPath = path.join(tmpDir, '.claude', 'projects', projectDirName);
    fs.mkdirSync(projectPath, { recursive: true });
    const sessionFile = path.join(projectPath, 'session.jsonl');
    const content = [
      '{ invalid json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Valid message' } }),
      'not json at all',
    ].join('\n') + '\n';
    fs.writeFileSync(sessionFile, content);

    const result = readSessionLog({ cwd, pid: '444' });
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'USER: Valid message');
  });

  it('filters XML-like user messages', () => {
    const cwd = '/test/project7';
    setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: '<system>do not show</system>' } },
      { type: 'user', message: { role: 'user', content: 'Real question here' } },
    ]);

    const result = readSessionLog({ cwd, pid: '555' });
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'USER: Real question here');
  });

  it('uses default maxLines of 50 when not specified', () => {
    const cwd = '/test/project8';
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `Msg ${i}` } });
    }
    setupSession(cwd, lines);

    const result = readSessionLog({ cwd, pid: '666' });
    assert.equal(result.length, 50);
    // Should be the last 50
    assert.equal(result[0].text, 'USER: Msg 50');
    assert.equal(result[49].text, 'USER: Msg 99');
  });
});
