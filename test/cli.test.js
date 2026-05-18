const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ENTRY = path.join(__dirname, '..', 'claude-manager');

// Spawn the CLI with the given subcommand + args, capture stdout/stderr/exit.
// On systems with no running agents, the commands should still succeed and
// return empty results — the contract is "no crashes on empty state."
function ctop(...argv) {
  const res = spawnSync('node', [ENTRY, ...argv], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 32 * 1024 * 1024, // 32MB — accommodate users with many sessions
  });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
}

describe('cli.parseArgs', () => {
  const { parseArgs } = require('../src/cli');

  it('parses positional and flag args', () => {
    const r = parseArgs(['ls', '--json', '--agent', 'claude']);
    assert.deepStrictEqual(r.positional, ['ls']);
    assert.strictEqual(r.flags.json, true);
    assert.strictEqual(r.flags.agent, 'claude');
  });

  it('supports --flag=value form', () => {
    const r = parseArgs(['--tail=20']);
    assert.strictEqual(r.flags.tail, '20');
  });

  it('treats trailing --flag with no value as boolean true', () => {
    const r = parseArgs(['--force']);
    assert.strictEqual(r.flags.force, true);
  });

  it('treats short flags as booleans', () => {
    const r = parseArgs(['-h']);
    assert.strictEqual(r.flags.h, true);
  });
});

describe('cli.isSubcommand', () => {
  const { isSubcommand } = require('../src/cli');

  it('returns true for known subcommands', () => {
    assert.strictEqual(isSubcommand('ls'), true);
    assert.strictEqual(isSubcommand('whoami'), true);
    assert.strictEqual(isSubcommand('kill'), true);
  });
  it('returns false for unknown or non-string', () => {
    assert.strictEqual(isSubcommand('foo'), false);
    assert.strictEqual(isSubcommand(undefined), false);
    assert.strictEqual(isSubcommand(123), false);
  });
});

describe('ctop ls (integration)', () => {
  it('exits 0 even when no agents are running', () => {
    const r = ctop('ls', '--json');
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  });

  it('outputs valid JSON array with --json', () => {
    const r = ctop('ls', '--json');
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed));
  });

  it('outputs human table by default (or empty-state message)', () => {
    const r = ctop('ls');
    assert.strictEqual(r.status, 0);
    // Either a header row or the no-sessions message
    assert.ok(/PID/.test(r.stdout) || /No agent sessions running/.test(r.stdout));
  });

  it('respects --agent filter', () => {
    const r = ctop('ls', '--agent', 'claude', '--json');
    const parsed = JSON.parse(r.stdout);
    assert.ok(parsed.every(p => p.agent === 'claude'));
  });

  it('--help prints usage and exits 0', () => {
    const r = ctop('ls', '--help');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Usage: ctop ls/);
  });
});

describe('ctop get (integration)', () => {
  it('errors when pid is missing', () => {
    const r = ctop('get');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /missing required/);
  });

  it('errors when pid is not an agent session', () => {
    const r = ctop('get', '999999');
    assert.strictEqual(r.status, 1);
  });

  it('outputs null JSON for unknown pid with --json', () => {
    const r = ctop('get', '999999', '--json');
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stdout.trim(), 'null');
  });
});

describe('ctop stats (integration)', () => {
  it('exits 0 even with no sessions', () => {
    const r = ctop('stats');
    assert.strictEqual(r.status, 0);
  });

  it('returns the aggregate shape with --json', () => {
    const r = ctop('stats', '--json');
    const parsed = JSON.parse(r.stdout);
    assert.ok('total' in parsed);
    assert.ok('totalCost' in parsed);
    assert.ok('avgContextUtil' in parsed);
  });
});

describe('ctop log (integration)', () => {
  it('errors when pid is missing', () => {
    const r = ctop('log');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /missing required/);
  });
  it('errors for unknown pid', () => {
    const r = ctop('log', '999999');
    assert.strictEqual(r.status, 1);
  });
  it('--help exits 0', () => {
    const r = ctop('log', '--help');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Usage: ctop log/);
  });
});

describe('ctop search (integration)', () => {
  it('errors when query is missing', () => {
    const r = ctop('search');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /missing required/);
  });
  it('returns valid JSON array (possibly empty)', () => {
    const r = ctop('search', '__definitely_no_match_xyz__', '--json');
    assert.strictEqual(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed));
  });
});

describe('ctop diff (integration)', () => {
  it('errors when arg is missing', () => {
    const r = ctop('diff');
    assert.strictEqual(r.status, 1);
  });
  it('returns null for non-git cwd in --json mode', () => {
    const r = ctop('diff', '/tmp', '--json');
    assert.strictEqual(r.status, 0);
    // /tmp is usually not a git repo; either null or an object — both valid
    const parsed = JSON.parse(r.stdout);
    assert.ok(parsed === null || typeof parsed === 'object');
  });
});

describe('ctop dispatch', () => {
  it('passes through to TUI for unknown first arg', () => {
    // We can't easily exec the TUI in a test, but we can confirm that
    // an unknown subcommand is NOT treated as a subcommand by isSubcommand —
    // which means claude-manager will fall through to core.main().
    const { isSubcommand } = require('../src/cli');
    assert.strictEqual(isSubcommand('--refresh'), false);
    assert.strictEqual(isSubcommand('foobar'), false);
  });
});
