const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

describe('loadConfig', () => {
  // We need to re-require the module with different argv and rc files each time.
  // Since loadConfig is called at module load time (sets CONFIG), we test it
  // by calling the exported loadConfig function directly.

  it('returns default values when no rc file or flags exist', () => {
    const { DEFAULT_CONFIG } = require('../claude-manager');
    assert.equal(DEFAULT_CONFIG.refreshInterval, 5000);
    assert.equal(DEFAULT_CONFIG.contextLimit, 1000000);
    assert.equal(DEFAULT_CONFIG.defaultView, 'list');
    assert.equal(DEFAULT_CONFIG.theme, 'default');
  });

  it('loadConfig returns an object with expected keys', () => {
    const { loadConfig } = require('../claude-manager');
    const config = loadConfig();
    assert.ok('refreshInterval' in config);
    assert.ok('contextLimit' in config);
    assert.ok('defaultView' in config);
    assert.ok('theme' in config);
  });

  describe('config file parsing', () => {
    let tmpDir;
    let rcPath;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-test-'));
      rcPath = path.join(tmpDir, '.ctoprc');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads refreshInterval from .ctoprc', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ refreshInterval: 10000 }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.refreshInterval, 10000);
    });

    it('reads contextLimit from .ctoprc', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ contextLimit: 500000 }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.contextLimit, 500000);
    });

    it('reads defaultView from .ctoprc', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ defaultView: 'pane' }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.defaultView, 'pane');
    });

    it('reads theme from .ctoprc', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ theme: 'minimal' }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.theme, 'minimal');
    });

    it('ignores invalid defaultView values', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ defaultView: 'grid' }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.defaultView, 'list');
    });

    it('ignores invalid theme values', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ theme: 'dark' }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.theme, 'default');
    });
  });
});
