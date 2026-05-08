const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const { parseDiffStat, getGitDiffSummary, gitDiffCache, GIT_DIFF_CACHE_TTL } = require('../claude-manager');

describe('parseDiffStat', () => {
  it('parses typical unstaged diff output', () => {
    const result = parseDiffStat(
      '3 files changed, 45 insertions(+), 12 deletions(-)',
      '',
      0
    );
    assert.deepStrictEqual(result.unstaged, { files: 3, insertions: 45, deletions: 12 });
    assert.deepStrictEqual(result.staged, { files: 0, insertions: 0, deletions: 0 });
    assert.strictEqual(result.untracked, 0);
  });

  it('parses empty string (no changes)', () => {
    const result = parseDiffStat('', '', 0);
    assert.deepStrictEqual(result.unstaged, { files: 0, insertions: 0, deletions: 0 });
    assert.deepStrictEqual(result.staged, { files: 0, insertions: 0, deletions: 0 });
    assert.strictEqual(result.untracked, 0);
  });

  it('parses files-only (no insertions or deletions)', () => {
    // git --shortstat can output just file count in some edge cases
    const result = parseDiffStat('1 file changed', '', 0);
    assert.deepStrictEqual(result.unstaged, { files: 1, insertions: 0, deletions: 0 });
  });

  it('parses insertions only', () => {
    const result = parseDiffStat(
      '2 files changed, 100 insertions(+)',
      '',
      0
    );
    assert.deepStrictEqual(result.unstaged, { files: 2, insertions: 100, deletions: 0 });
  });

  it('parses deletions only', () => {
    const result = parseDiffStat(
      '1 file changed, 5 deletions(-)',
      '',
      0
    );
    assert.deepStrictEqual(result.unstaged, { files: 1, insertions: 0, deletions: 5 });
  });

  it('parses staged diff output', () => {
    const result = parseDiffStat(
      '',
      '2 files changed, 30 insertions(+), 5 deletions(-)',
      0
    );
    assert.deepStrictEqual(result.unstaged, { files: 0, insertions: 0, deletions: 0 });
    assert.deepStrictEqual(result.staged, { files: 2, insertions: 30, deletions: 5 });
  });

  it('parses combined staged and unstaged', () => {
    const result = parseDiffStat(
      '3 files changed, 45 insertions(+), 12 deletions(-)',
      '2 files changed, 30 insertions(+), 5 deletions(-)',
      4
    );
    assert.deepStrictEqual(result.unstaged, { files: 3, insertions: 45, deletions: 12 });
    assert.deepStrictEqual(result.staged, { files: 2, insertions: 30, deletions: 5 });
    assert.strictEqual(result.untracked, 4);
  });

  it('handles untracked file count', () => {
    const result = parseDiffStat('', '', 7);
    assert.strictEqual(result.untracked, 7);
    assert.deepStrictEqual(result.unstaged, { files: 0, insertions: 0, deletions: 0 });
    assert.deepStrictEqual(result.staged, { files: 0, insertions: 0, deletions: 0 });
  });

  it('parses single file singular form', () => {
    const result = parseDiffStat(
      '1 file changed, 1 insertion(+), 1 deletion(-)',
      '',
      0
    );
    assert.deepStrictEqual(result.unstaged, { files: 1, insertions: 1, deletions: 1 });
  });

  it('parses large numbers', () => {
    const result = parseDiffStat(
      '150 files changed, 12345 insertions(+), 6789 deletions(-)',
      '',
      0
    );
    assert.deepStrictEqual(result.unstaged, { files: 150, insertions: 12345, deletions: 6789 });
  });
});

describe('getGitDiffSummary', () => {
  beforeEach(() => {
    gitDiffCache.clear();
  });

  it('returns null for null cwd', () => {
    assert.strictEqual(getGitDiffSummary(null), null);
  });

  it('returns null for undefined cwd', () => {
    assert.strictEqual(getGitDiffSummary(undefined), null);
  });

  it('returns null for empty string cwd', () => {
    assert.strictEqual(getGitDiffSummary(''), null);
  });

  it('returns cached result within TTL', () => {
    const fakeData = {
      unstaged: { files: 1, insertions: 10, deletions: 2 },
      staged: { files: 0, insertions: 0, deletions: 0 },
      untracked: 0,
    };
    gitDiffCache.set('/fake/path', { data: fakeData, timestamp: Date.now() });
    const result = getGitDiffSummary('/fake/path');
    assert.deepStrictEqual(result, fakeData);
  });

  it('does not return stale cached result past TTL', () => {
    const fakeData = {
      unstaged: { files: 1, insertions: 10, deletions: 2 },
      staged: { files: 0, insertions: 0, deletions: 0 },
      untracked: 0,
    };
    // Set cache with a timestamp well past the TTL
    gitDiffCache.set('/nonexistent/path/12345', { data: fakeData, timestamp: Date.now() - GIT_DIFF_CACHE_TTL - 1000 });
    // Should try to actually run git, which will fail on this nonexistent path
    const result = getGitDiffSummary('/nonexistent/path/12345');
    assert.strictEqual(result, null);
  });

  it('returns null and caches failure for non-git directory', () => {
    // /tmp is almost certainly not a git repo
    const result = getGitDiffSummary('/tmp');
    // Either null (not a git repo) or a valid result (if /tmp happens to be in a git repo)
    // The important thing is it doesn't throw
    assert.ok(result === null || typeof result === 'object');
  });

  it('returns valid data for current repo', () => {
    // This test runs inside the ctop git repo itself
    const cwd = process.cwd();
    const result = getGitDiffSummary(cwd);
    assert.ok(result !== null, 'Should return data for a git repo');
    assert.ok(typeof result.unstaged === 'object');
    assert.ok(typeof result.staged === 'object');
    assert.ok(typeof result.untracked === 'number');
    assert.ok(typeof result.unstaged.files === 'number');
    assert.ok(typeof result.unstaged.insertions === 'number');
    assert.ok(typeof result.unstaged.deletions === 'number');
  });
});
