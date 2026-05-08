const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  buildKillCommand,
  cwdToProjectDirName,
  openDirectory,
  PLATFORM,
  IS_MAC,
  IS_LINUX,
  IS_WIN,
} = require('../claude-manager');

describe('Platform detection', () => {
  it('PLATFORM matches os.platform()', () => {
    assert.strictEqual(PLATFORM, os.platform());
  });

  it('exactly one platform flag is true', () => {
    const flags = [IS_MAC, IS_LINUX, IS_WIN];
    const trueCount = flags.filter(Boolean).length;
    // On the current platform, exactly one should be true (or zero on an unknown OS)
    assert.ok(trueCount <= 1, `Expected at most one platform flag true, got ${trueCount}`);
    // On common CI platforms, at least one should be true
    if (['darwin', 'linux', 'win32'].includes(os.platform())) {
      assert.strictEqual(trueCount, 1, 'Expected exactly one platform flag true on a known OS');
    }
  });

  it('IS_WIN is true only when platform is win32', () => {
    assert.strictEqual(IS_WIN, os.platform() === 'win32');
  });
});

describe('buildKillCommand', () => {
  // These tests verify the command string construction regardless of current platform.
  // The actual IS_WIN flag determines the branch at runtime, so we test the function
  // output on whatever platform we run on and verify the non-Windows branch too.

  it('returns a string', () => {
    const cmd = buildKillCommand('1234', false);
    assert.strictEqual(typeof cmd, 'string');
    assert.ok(cmd.length > 0);
  });

  it('includes PID in the command', () => {
    const cmd = buildKillCommand('9999', false);
    assert.ok(cmd.includes('9999'), `Expected PID in command: ${cmd}`);
  });

  it('graceful kill does not include force flag', () => {
    const cmd = buildKillCommand('100', false);
    if (IS_WIN) {
      assert.ok(!cmd.includes('/F'), 'Windows graceful kill should not include /F');
      assert.ok(cmd.includes('taskkill'), 'Windows kill should use taskkill');
    } else {
      assert.ok(cmd.includes('kill -15'), 'Unix graceful kill should use signal 15');
    }
  });

  it('force kill includes force flag', () => {
    const cmd = buildKillCommand('100', true);
    if (IS_WIN) {
      assert.ok(cmd.includes('/F'), 'Windows force kill should include /F');
      assert.ok(cmd.includes('taskkill'), 'Windows kill should use taskkill');
    } else {
      assert.ok(cmd.includes('kill -9'), 'Unix force kill should use signal 9');
    }
  });

  it('on non-Windows, uses kill with signal numbers', () => {
    if (IS_WIN) return; // skip on Windows
    assert.match(buildKillCommand('42', false), /kill -15 42/);
    assert.match(buildKillCommand('42', true), /kill -9 42/);
  });
});

describe('cwdToProjectDirName', () => {
  it('converts Unix path by replacing / with -', () => {
    assert.strictEqual(cwdToProjectDirName('/Users/foo/project'), '-Users-foo-project');
  });

  it('converts Windows path by replacing \\ with - and removing :', () => {
    assert.strictEqual(cwdToProjectDirName('C:\\Users\\foo\\project'), 'C-Users-foo-project');
  });

  it('handles mixed separators', () => {
    assert.strictEqual(cwdToProjectDirName('C:\\Users/foo\\bar'), 'C-Users-foo-bar');
  });

  it('handles root Unix path', () => {
    assert.strictEqual(cwdToProjectDirName('/'), '-');
  });

  it('handles Windows drive root', () => {
    assert.strictEqual(cwdToProjectDirName('C:\\'), 'C-');
  });

  it('handles path with no separators', () => {
    assert.strictEqual(cwdToProjectDirName('myproject'), 'myproject');
  });
});

describe('openDirectory Windows support', () => {
  let tmpDir;

  it('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-win-test-'));
  });

  it('finder mode returns explorer on Windows', () => {
    if (!IS_WIN) return; // only runs on Windows
    const result = openDirectory(tmpDir, 'finder');
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(result.command, 'explorer');
    assert.deepStrictEqual(result.args, [tmpDir]);
  });

  it('terminal mode returns cmd on Windows', () => {
    if (!IS_WIN) return; // only runs on Windows
    const result = openDirectory(tmpDir, 'terminal');
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(result.command, 'cmd');
    assert.ok(result.args.includes('/c'));
    assert.ok(result.message.includes(tmpDir));
  });

  it('finder mode still works on current platform', () => {
    // This test runs on any platform to ensure the refactor didn't break anything
    const result = openDirectory(tmpDir, 'finder');
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.command, 'Expected a command');
    assert.ok(result.message.includes(tmpDir));
  });

  it('editor mode still works on current platform', () => {
    const origEditor = process.env.EDITOR;
    process.env.EDITOR = 'vim';
    try {
      const result = openDirectory(tmpDir, 'editor');
      assert.ok(!result.error, `Unexpected error: ${result.error}`);
      assert.strictEqual(result.command, 'vim');
    } finally {
      if (origEditor !== undefined) process.env.EDITOR = origEditor;
      else delete process.env.EDITOR;
    }
  });

  it('terminal mode still works on current platform', () => {
    const result = openDirectory(tmpDir, 'terminal');
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.command, 'Expected a command');
    assert.ok(result.message.includes(tmpDir));
  });

  it('cleanup', () => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Windows path handling in fallback titles', () => {
  // Test that the path-splitting regex handles both / and \
  it('splits Unix paths correctly', () => {
    const parts = '/Users/foo/project'.split(/[\\/]/).filter(Boolean);
    assert.deepStrictEqual(parts, ['Users', 'foo', 'project']);
  });

  it('splits Windows paths correctly', () => {
    const parts = 'C:\\Users\\foo\\project'.split(/[\\/]/).filter(Boolean);
    assert.deepStrictEqual(parts, ['C:', 'Users', 'foo', 'project']);
  });

  it('splits mixed paths correctly', () => {
    const parts = 'C:\\Users/foo\\bar'.split(/[\\/]/).filter(Boolean);
    assert.deepStrictEqual(parts, ['C:', 'Users', 'foo', 'bar']);
  });

  it('constructs fallback title from Windows path', () => {
    const cwd = 'C:\\Users\\dev\\my-project';
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    const title = parts.length >= 2
      ? parts[parts.length - 2] + '/' + parts[parts.length - 1]
      : parts[parts.length - 1] || cwd;
    assert.strictEqual(title, 'dev/my-project');
  });

  it('constructs fallback title from Unix path', () => {
    const cwd = '/home/dev/my-project';
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    const title = parts.length >= 2
      ? parts[parts.length - 2] + '/' + parts[parts.length - 1]
      : parts[parts.length - 1] || cwd;
    assert.strictEqual(title, 'dev/my-project');
  });
});
