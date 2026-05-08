const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { searchSessionContent } = require('../claude-manager');

describe('searchSessionContent', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-search-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds matches in user messages', () => {
    const fp = 'search-user.jsonl';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Please fix the authentication bug in the login flow' },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'authentication');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length > 0);
    assert.ok(result.snippets[0].includes('authentication'));
  });

  it('finds matches in assistant messages', () => {
    const fp = 'search-assistant.jsonl';
    const lines = [
      JSON.stringify({
        message: {
          role: 'assistant',
          content: 'I will refactor the database layer to improve performance',
        },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'refactor');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length > 0);
    assert.ok(result.snippets[0].includes('refactor'));
  });

  it('returns no match when query is not found', () => {
    const fp = 'search-nomatch.jsonl';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Hello world' },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'nonexistent-term');
    assert.equal(result.matched, false);
    assert.deepEqual(result.snippets, []);
  });

  it('extracts snippets with surrounding context', () => {
    const fp = 'search-context.jsonl';
    const longText = 'The quick brown fox jumps over the lazy dog and then the fox went to sleep in the barn';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: longText },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'lazy dog');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length > 0);
    // The snippet should contain the match and surrounding context
    assert.ok(result.snippets[0].includes('lazy dog'));
    // Should have context before (not just the match)
    assert.ok(result.snippets[0].length > 'lazy dog'.length);
  });

  it('query is case-insensitive', () => {
    const fp = 'search-case.jsonl';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Fix the Authentication Module' },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'authentication module');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length > 0);
  });

  it('returns at most 3 snippets', () => {
    const fp = 'search-max.jsonl';
    // Create multiple messages each containing the search term
    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: `Message ${i}: fix the bug in module ${i}` },
      }));
    }
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'fix the bug');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length <= 3, `Expected at most 3 snippets but got ${result.snippets.length}`);
  });

  it('handles content array format in messages', () => {
    const fp = 'search-array.jsonl';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Deploy the application to production' }],
        },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'production');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length > 0);
  });

  it('returns no match for empty query', () => {
    const fp = 'search-empty-query.jsonl';
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Some content here' },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, '');
    assert.equal(result.matched, false);
    assert.deepEqual(result.snippets, []);
  });

  it('handles non-existent file gracefully', () => {
    const result = searchSessionContent(tmpDir, 'nonexistent.jsonl', 'test');
    assert.equal(result.matched, false);
    assert.deepEqual(result.snippets, []);
  });

  it('handles corrupt JSON lines gracefully', () => {
    const fp = 'search-corrupt.jsonl';
    const lines = [
      '{ invalid json',
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Valid message with keyword target' },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'target');
    assert.equal(result.matched, true);
    assert.ok(result.snippets.length > 0);
  });

  it('skips non-user non-assistant messages', () => {
    const fp = 'search-system.jsonl';
    const lines = [
      JSON.stringify({
        type: 'system',
        message: { role: 'system', content: 'You are a helpful assistant with keyword' },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'keyword');
    assert.equal(result.matched, false);
    assert.deepEqual(result.snippets, []);
  });

  it('adds ellipsis markers for context snippets', () => {
    const fp = 'search-ellipsis.jsonl';
    // Use a long message so the snippet must be truncated
    const text = 'A'.repeat(30) + ' the target word appears here ' + 'B'.repeat(30);
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: text },
      }),
    ];
    fs.writeFileSync(path.join(tmpDir, fp), lines.join('\n') + '\n');
    const result = searchSessionContent(tmpDir, fp, 'target');
    assert.equal(result.matched, true);
    // Snippet should have leading ... since match is not at start
    assert.ok(result.snippets[0].startsWith('...'), 'Expected leading ellipsis');
    // Snippet should have trailing ... since match is not at end
    assert.ok(result.snippets[0].endsWith('...'), 'Expected trailing ellipsis');
  });
});
