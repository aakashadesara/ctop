const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  formatSessionMarkdown,
  formatSessionJSON,
  formatSessionCSV,
  csvEscape,
} = require('../claude-manager');

const fullProc = {
  pid: 12345,
  model: 'claude-sonnet-4-6',
  status: 'ACTIVE',
  startTime: '2h ago',
  cost: 1.25,
  contextPct: 42,
  inputTokens: 100000,
  outputTokens: 5000,
  cacheCreateTokens: 20000,
  cacheReadTokens: 80000,
  gitBranch: 'main',
  slug: 'my-project',
  cwd: '/home/user/project',
  cpu: 12.5,
  mem: 3.2,
};

describe('formatSessionMarkdown', () => {
  it('formats full proc data correctly', () => {
    const md = formatSessionMarkdown(fullProc);
    assert.ok(md.includes('## Claude Session Report'), 'should have header');
    assert.ok(md.includes('**Model:** claude-sonnet-4-6'), 'should have model');
    assert.ok(md.includes('**Status:** ACTIVE'), 'should have status');
    assert.ok(md.includes('**Started:** 2h ago'), 'should have start time');
    assert.ok(md.includes('**Cost:** $1.25'), 'should have cost');
    assert.ok(md.includes('42% free'), 'should have context pct');
    assert.ok(md.includes('100,000 input'), 'should have input tokens');
    assert.ok(md.includes('5,000 output'), 'should have output tokens');
    assert.ok(md.includes('80,000 cache read'), 'should have cache read tokens');
    assert.ok(md.includes('**Branch:** main'), 'should have branch');
    assert.ok(md.includes('**Directory:** /home/user/project'), 'should have directory');
    assert.ok(md.includes('**PID:** 12345'), 'should have PID');
  });

  it('handles missing/null fields gracefully', () => {
    const proc = {
      pid: 99,
      status: 'STOPPED',
      startTime: 'just now',
      cost: null,
      model: null,
      contextPct: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      gitBranch: null,
      cwd: null,
    };
    const md = formatSessionMarkdown(proc);
    assert.ok(md.includes('**Model:** unknown'), 'null model should be unknown');
    assert.ok(md.includes('**Cost:** --'), 'null cost should be --');
    assert.ok(md.includes('**Context:** N/A'), 'null context should be N/A');
    assert.ok(md.includes('0 input'), 'null inputTokens should be 0');
    assert.ok(md.includes('0 output'), 'null outputTokens should be 0');
    assert.ok(md.includes('0 cache read'), 'null cacheReadTokens should be 0');
    assert.ok(md.includes('**Branch:** N/A'), 'null branch should be N/A');
    assert.ok(md.includes('**Directory:** N/A'), 'null cwd should be N/A');
  });

  it('handles zero cost as <$0.01', () => {
    const proc = { ...fullProc, cost: 0 };
    const md = formatSessionMarkdown(proc);
    assert.ok(md.includes('**Cost:** <$0.01'), 'zero cost should show <$0.01');
  });
});

describe('formatSessionJSON', () => {
  it('produces valid JSON with all fields', () => {
    const jsonStr = formatSessionJSON(fullProc);
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.pid, 12345);
    assert.strictEqual(parsed.model, 'claude-sonnet-4-6');
    assert.strictEqual(parsed.status, 'ACTIVE');
    assert.strictEqual(parsed.cost, 1.25);
    assert.strictEqual(parsed.contextPct, 42);
    assert.strictEqual(parsed.tokens.input, 100000);
    assert.strictEqual(parsed.tokens.output, 5000);
    assert.strictEqual(parsed.tokens.cacheCreate, 20000);
    assert.strictEqual(parsed.tokens.cacheRead, 80000);
    assert.strictEqual(parsed.branch, 'main');
    assert.strictEqual(parsed.slug, 'my-project');
    assert.strictEqual(parsed.cwd, '/home/user/project');
    assert.strictEqual(parsed.cpu, 12.5);
    assert.strictEqual(parsed.mem, 3.2);
  });

  it('produces valid JSON with null/missing fields', () => {
    const proc = { pid: 1, status: 'STOPPED' };
    const jsonStr = formatSessionJSON(proc);
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.pid, 1);
    assert.strictEqual(parsed.model, undefined);
    assert.strictEqual(parsed.tokens.input, undefined);
  });

  it('output is pretty-printed with 2-space indent', () => {
    const jsonStr = formatSessionJSON(fullProc);
    // pretty-printed JSON has newlines and indentation
    assert.ok(jsonStr.includes('\n'), 'should have newlines');
    assert.ok(jsonStr.includes('  "pid"'), 'should have 2-space indent');
  });
});

describe('formatSessionCSV', () => {
  it('has correct headers', () => {
    const csv = formatSessionCSV(fullProc);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], 'pid,model,status,cost,context_pct,input_tokens,output_tokens,cache_read_tokens,branch,directory');
  });

  it('has correct values for full proc', () => {
    const csv = formatSessionCSV(fullProc);
    const lines = csv.split('\n');
    const values = lines[1].split(',');
    assert.strictEqual(values[0], '12345');
    assert.strictEqual(values[1], 'claude-sonnet-4-6');
    assert.strictEqual(values[2], 'ACTIVE');
    assert.strictEqual(values[3], '1.25');
    assert.strictEqual(values[4], '42');
    assert.strictEqual(values[5], '100000');
    assert.strictEqual(values[6], '5000');
    assert.strictEqual(values[7], '80000');
    assert.strictEqual(values[8], 'main');
    assert.strictEqual(values[9], '/home/user/project');
  });

  it('handles missing fields with defaults', () => {
    const proc = { pid: 1, status: 'STOPPED', cost: null };
    const csv = formatSessionCSV(proc);
    const lines = csv.split('\n');
    const values = lines[1];
    assert.ok(values.startsWith('1,'), 'should start with pid');
    assert.ok(values.includes(',0,'), 'null cost should be 0');
  });
});

describe('csvEscape', () => {
  it('does not escape simple values', () => {
    assert.strictEqual(csvEscape('hello'), 'hello');
    assert.strictEqual(csvEscape('12345'), '12345');
  });

  it('wraps values containing commas in quotes', () => {
    assert.strictEqual(csvEscape('hello,world'), '"hello,world"');
  });

  it('wraps values containing double quotes and doubles them', () => {
    assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
  });

  it('wraps values containing newlines', () => {
    assert.strictEqual(csvEscape('line1\nline2'), '"line1\nline2"');
  });

  it('handles values with commas in directory paths', () => {
    const proc = { ...fullProc, cwd: '/home/user/my,project' };
    const csv = formatSessionCSV(proc);
    // The CSV should still be parseable - the directory with comma should be quoted
    assert.ok(csv.includes('"/home/user/my,project"'), 'directory with comma should be quoted');
  });

  it('handles values with commas in branch names', () => {
    const proc = { ...fullProc, gitBranch: 'feature/foo,bar' };
    const csv = formatSessionCSV(proc);
    assert.ok(csv.includes('"feature/foo,bar"'), 'branch with comma should be quoted');
  });
});
