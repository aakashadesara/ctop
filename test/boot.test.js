const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('boot animation config', () => {
  it('DEFAULT_CONFIG has bootAnimation set to true', () => {
    const { DEFAULT_CONFIG } = require('../claude-manager');
    assert.equal(DEFAULT_CONFIG.bootAnimation, true);
  });

  it('loadConfig includes bootAnimation key', () => {
    const { loadConfig } = require('../claude-manager');
    const config = loadConfig();
    // bootAnimation may be true or false depending on user's ~/.ctoprc
    assert.equal(typeof config.bootAnimation, 'boolean');
  });

  describe('config file parsing', () => {
    let tmpDir;
    let rcPath;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-boot-test-'));
      rcPath = path.join(tmpDir, '.ctoprc');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads bootAnimation: false from .ctoprc', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ bootAnimation: false }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.bootAnimation, false);
    });

    it('keeps bootAnimation true when .ctoprc does not set it', () => {
      fs.writeFileSync(rcPath, JSON.stringify({ refreshInterval: 3000 }));
      const { loadConfig } = require('../claude-manager');
      const config = loadConfig({ rcPath });
      assert.equal(config.bootAnimation, true);
    });
  });

  describe('--no-animation flag', () => {
    it('is parsed by loadConfig when present in argv', () => {
      // Temporarily inject the flag into process.argv
      const originalArgv = process.argv;
      process.argv = ['node', 'ctop', '--no-animation'];
      try {
        const { loadConfig } = require('../claude-manager');
        const config = loadConfig();
        assert.equal(config.bootAnimation, false);
      } finally {
        process.argv = originalArgv;
      }
    });
  });
});

describe('playBootAnimation and sleep', () => {
  it('sleep function is exported', () => {
    const { sleep } = require('../claude-manager');
    assert.equal(typeof sleep, 'function');
  });

  it('sleep returns a promise', () => {
    const { sleep } = require('../claude-manager');
    const result = sleep(1);
    assert.ok(result instanceof Promise);
  });

  it('playBootAnimation function is exported', () => {
    const { playBootAnimation } = require('../claude-manager');
    assert.equal(typeof playBootAnimation, 'function');
  });
});
