const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDirectory } = require('../claude-manager');

describe('openDirectory', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('returns error when cwd is empty', () => {
    it('returns error for empty string', () => {
      const result = openDirectory('', 'finder');
      assert.ok(result.error);
      assert.strictEqual(result.error, 'No working directory for this process');
    });

    it('returns error for null', () => {
      const result = openDirectory(null, 'finder');
      assert.ok(result.error);
      assert.strictEqual(result.error, 'No working directory for this process');
    });

    it('returns error for undefined', () => {
      const result = openDirectory(undefined, 'editor');
      assert.ok(result.error);
      assert.strictEqual(result.error, 'No working directory for this process');
    });
  });

  describe('returns error when cwd does not exist', () => {
    it('returns error for non-existent directory', () => {
      const result = openDirectory('/tmp/does-not-exist-abc123xyz', 'finder');
      assert.ok(result.error);
      assert.match(result.error, /Directory does not exist/);
      assert.match(result.error, /does-not-exist-abc123xyz/);
    });

    it('returns error for non-existent directory with editor mode', () => {
      const result = openDirectory('/no/such/path', 'editor');
      assert.ok(result.error);
      assert.match(result.error, /Directory does not exist/);
    });

    it('returns error for non-existent directory with terminal mode', () => {
      const result = openDirectory('/no/such/path', 'terminal');
      assert.ok(result.error);
      assert.match(result.error, /Directory does not exist/);
    });
  });

  describe('constructs correct command for macOS (finder mode)', () => {
    it('uses "open" command on macOS', () => {
      // This test runs on macOS (the current platform)
      if (os.platform() !== 'darwin') {
        return; // skip on non-macOS
      }
      const result = openDirectory(tmpDir, 'finder');
      assert.ok(!result.error, `Unexpected error: ${result.error}`);
      assert.strictEqual(result.command, 'open');
      assert.deepStrictEqual(result.args, [tmpDir]);
      assert.strictEqual(result.message, `Opened ${tmpDir}`);
    });
  });

  describe('constructs correct command for macOS (editor mode)', () => {
    it('uses $EDITOR if set (GUI editor)', () => {
      const origEditor = process.env.EDITOR;
      process.env.EDITOR = 'code';
      try {
        const result = openDirectory(tmpDir, 'editor');
        assert.ok(!result.error, `Unexpected error: ${result.error}`);
        assert.strictEqual(result.command, 'code');
        assert.deepStrictEqual(result.args, [tmpDir]);
        assert.ok(result.message.includes('Opened in editor'));
      } finally {
        if (origEditor !== undefined) {
          process.env.EDITOR = origEditor;
        } else {
          delete process.env.EDITOR;
        }
      }
    });

    it('falls back to "code" when $EDITOR is not set', () => {
      const origEditor = process.env.EDITOR;
      delete process.env.EDITOR;
      try {
        const result = openDirectory(tmpDir, 'editor');
        assert.ok(!result.error, `Unexpected error: ${result.error}`);
        assert.strictEqual(result.command, 'code');
        assert.deepStrictEqual(result.args, [tmpDir]);
        assert.ok(result.message.includes('Opened in editor'));
      } finally {
        if (origEditor !== undefined) {
          process.env.EDITOR = origEditor;
        } else {
          delete process.env.EDITOR;
        }
      }
    });
  });

  describe('constructs correct command for macOS (terminal mode)', () => {
    it('uses open on macOS', () => {
      if (os.platform() !== 'darwin') {
        return; // skip on non-macOS
      }
      const result = openDirectory(tmpDir, 'terminal');
      assert.ok(!result.error, `Unexpected error: ${result.error}`);
      assert.strictEqual(result.command, 'open');
      assert.ok(result.args.includes('-a'));
      assert.ok(result.args.includes('Terminal'));
      assert.strictEqual(result.message, `Opened terminal in ${tmpDir}`);
    });
  });

  describe('constructs correct command for Linux', () => {
    // On macOS we can still verify the structure by checking the platform branch logic.
    // Since openDirectory reads IS_MAC/IS_LINUX globals, we test the behavior
    // on the current platform. On macOS, finder => 'open', on Linux => 'xdg-open'.
    it('finder mode returns correct command for current platform', () => {
      const result = openDirectory(tmpDir, 'finder');
      assert.ok(!result.error);
      if (os.platform() === 'darwin') {
        assert.strictEqual(result.command, 'open');
      } else if (os.platform() === 'linux') {
        assert.strictEqual(result.command, 'xdg-open');
      }
      assert.deepStrictEqual(result.args, [tmpDir]);
      assert.strictEqual(result.message, `Opened ${tmpDir}`);
    });

    it('terminal mode returns correct command for current platform', () => {
      const result = openDirectory(tmpDir, 'terminal');
      assert.ok(!result.error);
      if (os.platform() === 'darwin') {
        assert.strictEqual(result.command, 'open');
      } else if (os.platform() === 'linux') {
        assert.ok(
          result.command === 'x-terminal-emulator' || result.command === 'gnome-terminal' || result.command === 'xterm',
          `Expected x-terminal-emulator, gnome-terminal or xterm, got ${result.command}`
        );
      }
      assert.ok(result.message.includes(tmpDir));
    });
  });

  describe('returns correct message format', () => {
    it('finder mode message contains the path', () => {
      const result = openDirectory(tmpDir, 'finder');
      assert.ok(!result.error);
      assert.ok(result.message.includes(tmpDir));
      assert.match(result.message, /^Opened /);
    });

    it('editor mode message contains "Opened in editor"', () => {
      const result = openDirectory(tmpDir, 'editor');
      assert.ok(!result.error);
      assert.match(result.message, /Opened in editor/);
      assert.ok(result.message.includes(tmpDir));
    });

    it('terminal mode message contains "Opened terminal in"', () => {
      const result = openDirectory(tmpDir, 'terminal');
      assert.ok(!result.error);
      assert.match(result.message, /^Opened terminal in /);
      assert.ok(result.message.includes(tmpDir));
    });
  });

  describe('handles unknown mode', () => {
    it('returns error for unknown mode', () => {
      const result = openDirectory(tmpDir, 'unknown');
      assert.ok(result.error);
      assert.match(result.error, /Unknown mode/);
    });
  });
});
