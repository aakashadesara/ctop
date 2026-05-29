const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePsLine } = require('../claude-manager');

describe('parsePsLine', () => {
  it('parses a standard ps -eo line with a 5-field lstart', () => {
    const line = ' 12345 aakash  1.2  0.3 S+    Sun Feb 23 15:44:00 2025 /usr/local/bin/claude --foo bar';
    const r = parsePsLine(line);
    assert.equal(r.pid, '12345');
    assert.equal(r.cpu, '1.2');
    assert.equal(r.mem, '0.3');
    assert.equal(r.stat, 'S+');
    assert.equal(r.command, '/usr/local/bin/claude --foo bar');
    assert.equal(r.startDate.getFullYear(), 2025);
    assert.equal(r.isActive, true);
    assert.equal(r.isZombie, false);
    assert.equal(r.isStopped, false);
  });

  it('flags zombie processes from the stat column', () => {
    const line = ' 99 user  0.0  0.0 Z     Sun Feb 23 15:44:00 2025 /bin/zombie';
    const r = parsePsLine(line);
    assert.equal(r.isZombie, true);
    assert.equal(r.isActive, false);
    assert.equal(r.isStopped, false);
  });

  it('flags stopped processes from the stat column', () => {
    const line = '100 user  0.0  0.0 T     Sun Feb 23 15:44:00 2025 /bin/halted';
    const r = parsePsLine(line);
    assert.equal(r.isStopped, true);
    assert.equal(r.isActive, false);
    assert.equal(r.isZombie, false);
  });

  it('joins multi-word commands back together', () => {
    const line = '42 u  0  0 S Sun Feb 23 15:44:00 2025 node /path/to/script.js --flag=value other arg';
    const r = parsePsLine(line);
    assert.equal(r.command, 'node /path/to/script.js --flag=value other arg');
  });
});
