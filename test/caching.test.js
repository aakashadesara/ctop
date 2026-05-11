const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getSessionData, getCodexSessionData, readSessionLog } = require('../claude-manager');

// --- getSessionData caching ---

describe('getSessionData caching', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns identical object on second call when file is unchanged', () => {
    const fp = path.join(tmpDir, 'stable.jsonl');
    fs.writeFileSync(fp, JSON.stringify({ summary: 'Cached title' }) + '\n');

    const first = getSessionData(fp);
    const second = getSessionData(fp);
    assert.equal(first.title, 'Cached title');
    // Cache should return the exact same object reference
    assert.equal(first, second);
  });

  it('returns fresh data after file content changes', () => {
    const fp = path.join(tmpDir, 'changing.jsonl');
    fs.writeFileSync(fp, JSON.stringify({ summary: 'Original' }) + '\n');
    const first = getSessionData(fp);
    assert.equal(first.title, 'Original');

    // Overwrite with new content — mtime and/or size change
    fs.writeFileSync(fp, JSON.stringify({ summary: 'Updated title here' }) + '\n');
    const second = getSessionData(fp);
    assert.equal(second.title, 'Updated title here');
    assert.notEqual(first, second);
  });
});

// --- getCodexSessionData caching ---

describe('getCodexSessionData caching', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-codex-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns identical object on second call when file is unchanged', () => {
    const fp = path.join(tmpDir, 'codex-stable.jsonl');
    const line = JSON.stringify({
      type: 'session_meta',
      payload: { id: 'sess-1', cwd: '/tmp', cli_version: '1.0' },
    });
    fs.writeFileSync(fp, line + '\n');

    const first = getCodexSessionData(fp);
    const second = getCodexSessionData(fp);
    assert.equal(first.sessionId, 'sess-1');
    assert.equal(first, second);
  });

  it('returns fresh data after file content changes', () => {
    const fp = path.join(tmpDir, 'codex-changing.jsonl');
    fs.writeFileSync(fp, JSON.stringify({
      type: 'session_meta',
      payload: { id: 'sess-1', cwd: '/tmp' },
    }) + '\n');
    const first = getCodexSessionData(fp);
    assert.equal(first.sessionId, 'sess-1');

    fs.writeFileSync(fp, JSON.stringify({
      type: 'session_meta',
      payload: { id: 'sess-2', cwd: '/tmp' },
    }) + '\n');
    const second = getCodexSessionData(fp);
    assert.equal(second.sessionId, 'sess-2');
    assert.notEqual(first, second);
  });
});

// --- readSessionLog tail-reading and caching ---

describe('readSessionLog tail-reading', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-logtail-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupSession(cwd, content) {
    const projectDirName = cwd.replace(/\//g, '-');
    const projectPath = path.join(tmpDir, '.claude', 'projects', projectDirName);
    fs.mkdirSync(projectPath, { recursive: true });
    const sessionFile = path.join(projectPath, 'session.jsonl');
    if (typeof content === 'string') {
      fs.writeFileSync(sessionFile, content);
    } else {
      fs.writeFileSync(sessionFile, content.map(l => JSON.stringify(l)).join('\n') + '\n');
    }
    return sessionFile;
  }

  it('reads tail of file larger than 64KB and drops partial first line', () => {
    const cwd = '/test/large-log';

    // Build a file >64KB. Each JSONL line is ~80 bytes, so ~1000 lines = ~80KB.
    // Put a distinctive message at the start that should NOT appear in tail output,
    // and distinctive messages near the end that SHOULD appear.
    const lines = [];
    // Pad the beginning with enough lines to push past 64KB
    for (let i = 0; i < 900; i++) {
      lines.push(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: `Padding message number ${String(i).padStart(4, '0')}` },
      }));
    }
    // Add a distinctive line near the end
    lines.push(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'NEAR_THE_END_MARKER' },
    }));
    lines.push(JSON.stringify({
      message: { role: 'assistant', content: 'FINAL_RESPONSE_MARKER' },
    }));

    const content = lines.join('\n') + '\n';
    // Verify the file is actually >64KB
    assert.ok(Buffer.byteLength(content) > 64 * 1024, 'Test file must be >64KB');

    setupSession(cwd, content);

    const result = readSessionLog({ cwd, pid: '900' }, 200);

    // Should contain the end markers
    const texts = result.map(e => e.text);
    assert.ok(texts.some(t => t.includes('NEAR_THE_END_MARKER')), 'Should include near-end marker');
    assert.ok(texts.some(t => t.includes('FINAL_RESPONSE_MARKER')), 'Should include final marker');

    // Should NOT contain very early messages (they're before the 64KB tail window)
    assert.ok(!texts.some(t => t.includes('number 0000')), 'Should not include earliest messages');
  });

  it('still reads full file when file is under 64KB', () => {
    const cwd = '/test/small-log';
    setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: 'First message' } },
      { message: { role: 'assistant', content: 'Second message' } },
    ]);

    const result = readSessionLog({ cwd, pid: '100' });
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'USER: First message');
    assert.equal(result[1].text, 'ASSISTANT: Second message');
  });

  it('returns cached entries on second call when file is unchanged', () => {
    const cwd = '/test/cache-hit';
    setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: 'Cached log entry' } },
    ]);

    const first = readSessionLog({ cwd, pid: '200' });
    const second = readSessionLog({ cwd, pid: '200' });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0].text, second[0].text);
  });

  it('returns fresh entries after file is modified', () => {
    const cwd = '/test/cache-invalidate';
    const sessionFile = setupSession(cwd, [
      { type: 'user', message: { role: 'user', content: 'Original log' } },
    ]);

    const first = readSessionLog({ cwd, pid: '300' });
    assert.equal(first.length, 1);
    assert.equal(first[0].text, 'USER: Original log');

    // Append a new line — changes mtime and size
    fs.appendFileSync(sessionFile,
      JSON.stringify({ message: { role: 'assistant', content: 'New response' } }) + '\n');

    const second = readSessionLog({ cwd, pid: '300' });
    assert.equal(second.length, 2);
    assert.equal(second[1].text, 'ASSISTANT: New response');
  });

  it('does not lose valid lines when partial first line is dropped in large file', () => {
    const cwd = '/test/partial-drop';

    // Create a file where the 64KB boundary falls in the middle of a JSON line.
    // We'll make lines of known size to control where the boundary lands.
    const lines = [];
    // Each line is exactly 100 bytes (padded) to make size predictable
    const targetSize = 70 * 1024; // 70KB > 64KB threshold
    let currentSize = 0;
    let i = 0;
    while (currentSize < targetSize) {
      const msg = `Test message ${String(i).padStart(5, '0')}`;
      const jsonLine = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: msg },
      });
      lines.push(jsonLine);
      currentSize += Buffer.byteLength(jsonLine) + 1; // +1 for newline
      i++;
    }

    const content = lines.join('\n') + '\n';
    setupSession(cwd, content);

    const result = readSessionLog({ cwd, pid: '400' }, 1000);

    // Every returned entry should be valid (no partial JSON artifacts)
    for (const entry of result) {
      assert.ok(entry.role === 'user', 'All entries should have valid role');
      assert.ok(entry.text.startsWith('USER: Test message'), `Entry should be valid: ${entry.text}`);
    }

    // We should have gotten entries (not an empty result from parse failures)
    assert.ok(result.length > 0, 'Should have parsed some entries from tail');
  });
});
