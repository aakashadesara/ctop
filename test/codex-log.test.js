const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseCodexLogEntry, readCodexSessionLog, readSessionLog } = require('../claude-manager');

describe('parseCodexLogEntry', () => {
  it('parses a user response_item (input_text)', () => {
    const data = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi codex' }] } };
    assert.deepEqual(parseCodexLogEntry(data), { role: 'user', text: 'hi codex' });
  });

  it('parses an assistant response_item (output_text)', () => {
    const data = { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello. How can I help?' }] } };
    assert.deepEqual(parseCodexLogEntry(data), { role: 'assistant', text: 'Hello. How can I help?' });
  });

  it('joins multiple content blocks with a space', () => {
    const data = { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'one' }, { type: 'text', text: 'two' }] } };
    assert.equal(parseCodexLogEntry(data).text, 'one two');
  });

  it('handles a plain string content payload', () => {
    const data = { type: 'response_item', payload: { type: 'message', role: 'user', content: 'plain string' } };
    assert.equal(parseCodexLogEntry(data).text, 'plain string');
  });

  it('collapses newlines and control chars to single spaces', () => {
    const data = { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'line one\nline two\t\tend' }] } };
    assert.equal(parseCodexLogEntry(data).text, 'line one line two end');
  });

  it('skips injected context (user text wrapped in <...>)', () => {
    const data = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context><cwd>/x</cwd></environment_context>' }] } };
    assert.equal(parseCodexLogEntry(data), null);
  });

  it('skips developer/system roles', () => {
    const dev = { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'instructions' }] } };
    assert.equal(parseCodexLogEntry(dev), null);
  });

  it('skips event_msg lines (covered by response_item, avoids duplicates)', () => {
    assert.equal(parseCodexLogEntry({ type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }), null);
    assert.equal(parseCodexLogEntry({ type: 'event_msg', payload: { type: 'agent_message', message: 'Hi there!' } }), null);
  });

  it('skips metadata and empty/blank lines', () => {
    assert.equal(parseCodexLogEntry({ type: 'session_meta', payload: { id: 'x', cwd: '/y' } }), null);
    assert.equal(parseCodexLogEntry({ type: 'turn_context', payload: { model: 'gpt-5.4' } }), null);
    assert.equal(parseCodexLogEntry({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '   ' }] } }), null);
    assert.equal(parseCodexLogEntry(null), null);
  });
});

describe('readCodexSessionLog', () => {
  let tmpDir;
  let origHome;
  const SESSION_ID = '019ef179-71bc-7d61-a633-6e59c2bf04c8';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-codex-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Build a realistic codex rollout file under ~/.codex/sessions/YYYY/MM/DD.
  function setupCodexSession(cwd, lines, sessionId = SESSION_ID) {
    const dayDir = path.join(tmpDir, '.codex', 'sessions', '2026', '06', '22');
    fs.mkdirSync(dayDir, { recursive: true });
    const filePath = path.join(dayDir, `rollout-2026-06-22T18-35-28-${sessionId}.jsonl`);
    fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return filePath;
  }

  // A two-turn conversation as codex actually records it: response_item messages
  // plus the redundant event_msg + developer/context noise that must be dropped.
  function conversationLines(cwd) {
    return [
      { timestamp: '2026-06-22T22:36:00Z', type: 'session_meta', payload: { id: SESSION_ID, cwd, cli_version: '1.0.0', git: { branch: 'main' } } },
      { timestamp: '2026-06-22T22:36:01Z', type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: '2026-06-22T22:36:02Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'developer instructions' }] } },
      { timestamp: '2026-06-22T22:36:03Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context><cwd>${cwd}</cwd></environment_context>` }] } },
      { timestamp: '2026-06-22T22:36:20Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
      { timestamp: '2026-06-22T22:36:20Z', type: 'event_msg', payload: { type: 'user_message', message: 'hello' } },
      { timestamp: '2026-06-22T22:36:22Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Hello. How can I help?' } },
      { timestamp: '2026-06-22T22:36:22Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello. How can I help?' }] } },
      { timestamp: '2026-06-22T22:36:45Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi codex' }] } },
      { timestamp: '2026-06-22T22:36:45Z', type: 'event_msg', payload: { type: 'user_message', message: 'hi codex' } },
      { timestamp: '2026-06-22T22:36:46Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Hi. What are we working on?' } },
      { timestamp: '2026-06-22T22:36:46Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi. What are we working on?' }] } },
    ];
  }

  it('renders the conversation, dropping context/developer/event_msg duplicates', () => {
    const cwd = '/test/codex-project';
    const filePath = setupCodexSession(cwd, conversationLines(cwd));

    const result = readCodexSessionLog({ agentType: 'codex', codexSessionPath: filePath });
    assert.deepEqual(result.map(e => e.text), [
      'USER: hello',
      'ASSISTANT: Hello. How can I help?',
      'USER: hi codex',
      'ASSISTANT: Hi. What are we working on?',
    ]);
    assert.deepEqual(result.map(e => e.role), ['user', 'assistant', 'user', 'assistant']);
  });

  it('resolves the file by sessionId when no path is given', () => {
    const cwd = '/test/codex-byid';
    setupCodexSession(cwd, conversationLines(cwd));

    const result = readCodexSessionLog({ agentType: 'codex', sessionId: SESSION_ID });
    assert.equal(result.length, 4);
    assert.equal(result[0].text, 'USER: hello');
  });

  it('resolves the file by cwd when neither path nor id is given', () => {
    const cwd = '/test/codex-bycwd';
    setupCodexSession(cwd, conversationLines(cwd));

    const result = readCodexSessionLog({ agentType: 'codex', cwd });
    assert.equal(result.length, 4);
    assert.equal(result[3].text, 'ASSISTANT: Hi. What are we working on?');
  });

  it('is reachable through readSessionLog via agentType dispatch', () => {
    const cwd = '/test/codex-dispatch';
    const filePath = setupCodexSession(cwd, conversationLines(cwd));

    const result = readSessionLog({ agentType: 'codex', codexSessionPath: filePath, cwd });
    assert.equal(result.length, 4);
    assert.equal(result[0].text, 'USER: hello');
  });

  it('truncates to maxLines (keeps the most recent)', () => {
    const cwd = '/test/codex-trunc';
    const filePath = setupCodexSession(cwd, conversationLines(cwd));

    const result = readCodexSessionLog({ agentType: 'codex', codexSessionPath: filePath }, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'USER: hi codex');
    assert.equal(result[1].text, 'ASSISTANT: Hi. What are we working on?');
  });

  it('formats timestamps as HH:MM:SS from the line timestamp', () => {
    const cwd = '/test/codex-ts';
    const filePath = setupCodexSession(cwd, conversationLines(cwd));

    const result = readCodexSessionLog({ agentType: 'codex', codexSessionPath: filePath });
    assert.match(result[0].timestamp, /^\d{2}:\d{2}:\d{2}$/);
  });

  it('tolerates corrupt JSON lines', () => {
    const cwd = '/test/codex-corrupt';
    const dayDir = path.join(tmpDir, '.codex', 'sessions', '2026', '06', '22');
    fs.mkdirSync(dayDir, { recursive: true });
    const filePath = path.join(dayDir, `rollout-2026-06-22T18-35-28-${SESSION_ID}.jsonl`);
    fs.writeFileSync(filePath, [
      '{ not valid json',
      JSON.stringify({ timestamp: '2026-06-22T22:36:20Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'survives' }] } }),
      'garbage',
    ].join('\n') + '\n');

    const result = readCodexSessionLog({ agentType: 'codex', codexSessionPath: filePath });
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'USER: survives');
  });

  it('returns [] when the session file is missing', () => {
    assert.deepEqual(readCodexSessionLog({ agentType: 'codex', codexSessionPath: path.join(tmpDir, 'nope.jsonl'), cwd: '/no/match' }), []);
  });

  it('returns [] when ~/.codex/sessions does not exist', () => {
    assert.deepEqual(readCodexSessionLog({ agentType: 'codex', cwd: '/test/x' }), []);
  });
});
