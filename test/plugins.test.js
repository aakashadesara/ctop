const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadPlugins, _state } = require('../claude-manager');

// Helper: create a temp plugin directory with plugin files
function makeTempPluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctop-plugins-'));
  return dir;
}

function writePlugin(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), content);
}

describe('Plugin loading', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempPluginDir();
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads plugins from a directory', () => {
    writePlugin(tmpDir, 'test-plugin.js', `
      module.exports = {
        name: 'test-plugin',
        description: 'A test plugin',
      };
    `);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins.length, 1);
    assert.strictEqual(plugins[0].name, 'test-plugin');
    assert.strictEqual(plugins[0].description, 'A test plugin');
  });

  it('returns empty array when directory does not exist', () => {
    const plugins = loadPlugins(path.join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(plugins, []);
  });

  it('ignores non-.js files', () => {
    writePlugin(tmpDir, 'readme.txt', 'not a plugin');
    writePlugin(tmpDir, 'data.json', '{}');
    writePlugin(tmpDir, 'valid.js', `
      module.exports = { name: 'valid' };
    `);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins.length, 1);
    assert.strictEqual(plugins[0].name, 'valid');
  });

  it('does not crash on invalid plugin files', () => {
    writePlugin(tmpDir, 'bad-syntax.js', 'this is not valid javascript %%%');
    writePlugin(tmpDir, 'good.js', `module.exports = { name: 'good' };`);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins.length, 1);
    assert.strictEqual(plugins[0].name, 'good');
  });

  it('skips plugins without a name', () => {
    writePlugin(tmpDir, 'no-name.js', `module.exports = { description: 'no name' };`);
    writePlugin(tmpDir, 'has-name.js', `module.exports = { name: 'named' };`);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins.length, 1);
    assert.strictEqual(plugins[0].name, 'named');
  });

  it('calls init() on load', () => {
    writePlugin(tmpDir, 'init-plugin.js', `
      let initialized = false;
      module.exports = {
        name: 'init-test',
        init: () => { initialized = true; },
        wasInitialized: () => initialized,
      };
    `);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins.length, 1);
    assert.strictEqual(plugins[0].wasInitialized(), true);
  });
});

describe('Plugin column integration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempPluginDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('column getValue returns correct value', () => {
    writePlugin(tmpDir, 'col-plugin.js', `
      module.exports = {
        name: 'col-test',
        column: {
          header: 'TEST',
          width: 8,
          getValue: (proc) => proc.status || 'N/A',
        },
      };
    `);
    const plugins = loadPlugins(tmpDir);
    const proc = { pid: '123', status: 'ACTIVE', cpu: 0, mem: 0 };
    assert.strictEqual(plugins[0].column.getValue(proc), 'ACTIVE');
  });

  it('column getColor returns ANSI code', () => {
    writePlugin(tmpDir, 'color-plugin.js', `
      module.exports = {
        name: 'color-test',
        column: {
          header: 'CLR',
          width: 6,
          getValue: (proc) => proc.status,
          getColor: (proc) => proc.status === 'ACTIVE' ? '\\x1b[32m' : '\\x1b[31m',
        },
      };
    `);
    const plugins = loadPlugins(tmpDir);
    const activeProc = { status: 'ACTIVE' };
    const deadProc = { status: 'STOPPED' };
    assert.strictEqual(plugins[0].column.getColor(activeProc), '\x1b[32m');
    assert.strictEqual(plugins[0].column.getColor(deadProc), '\x1b[31m');
  });

  it('column getValue handles missing data gracefully', () => {
    writePlugin(tmpDir, 'safe-plugin.js', `
      module.exports = {
        name: 'safe-col',
        column: {
          header: 'SAFE',
          width: 8,
          getValue: (proc) => proc.nonExistent || '--',
        },
      };
    `);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins[0].column.getValue({}), '--');
  });
});

describe('Plugin detailRows integration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempPluginDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detailRows returns row objects', () => {
    writePlugin(tmpDir, 'detail-plugin.js', `
      module.exports = {
        name: 'detail-test',
        detailRows: (proc) => [
          { label: 'Custom', value: proc.pid || 'N/A', color: '\\x1b[36m' },
          { label: 'Extra', value: 'info' },
        ],
      };
    `);
    const plugins = loadPlugins(tmpDir);
    const rows = plugins[0].detailRows({ pid: '42' });
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].label, 'Custom');
    assert.strictEqual(rows[0].value, '42');
    assert.strictEqual(rows[0].color, '\x1b[36m');
    assert.strictEqual(rows[1].label, 'Extra');
    assert.strictEqual(rows[1].value, 'info');
  });

  it('detailRows handles proc with no data', () => {
    writePlugin(tmpDir, 'detail-safe.js', `
      module.exports = {
        name: 'detail-safe',
        detailRows: (proc) => [
          { label: 'Info', value: proc.model || '--' },
        ],
      };
    `);
    const plugins = loadPlugins(tmpDir);
    const rows = plugins[0].detailRows({});
    assert.strictEqual(rows[0].value, '--');
  });
});

describe('Plugin cleanup', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempPluginDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cleanup function is called', () => {
    writePlugin(tmpDir, 'cleanup-plugin.js', `
      let cleaned = false;
      module.exports = {
        name: 'cleanup-test',
        cleanup: () => { cleaned = true; },
        wasCleaned: () => cleaned,
      };
    `);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins[0].wasCleaned(), false);
    plugins[0].cleanup();
    assert.strictEqual(plugins[0].wasCleaned(), true);
  });

  it('multiple plugins can be loaded and cleaned up independently', () => {
    writePlugin(tmpDir, 'pluginA.js', `
      let state = 'init';
      module.exports = {
        name: 'pluginA',
        init: () => { state = 'running'; },
        cleanup: () => { state = 'done'; },
        getState: () => state,
      };
    `);
    writePlugin(tmpDir, 'pluginB.js', `
      let state = 'init';
      module.exports = {
        name: 'pluginB',
        init: () => { state = 'running'; },
        cleanup: () => { state = 'done'; },
        getState: () => state,
      };
    `);
    const plugins = loadPlugins(tmpDir);
    assert.strictEqual(plugins.length, 2);
    // Both should have been initialized
    for (const p of plugins) {
      assert.strictEqual(p.getState(), 'running');
    }
    // Clean up both
    for (const p of plugins) {
      p.cleanup();
    }
    for (const p of plugins) {
      assert.strictEqual(p.getState(), 'done');
    }
  });
});

describe('Plugin _state integration', () => {
  it('plugins can be set and read via _state', () => {
    const fakePlugins = [
      { name: 'fake1', column: { header: 'F1', width: 5, getValue: () => 'v1' } },
      { name: 'fake2', detailRows: () => [{ label: 'L', value: 'V' }] },
    ];
    _state.plugins = fakePlugins;
    assert.strictEqual(_state.plugins.length, 2);
    assert.strictEqual(_state.plugins[0].name, 'fake1');
    assert.strictEqual(_state.plugins[1].name, 'fake2');
    // Reset
    _state.plugins = [];
  });
});
