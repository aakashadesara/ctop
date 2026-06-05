const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  aggregateModelUsage,
  modelFamily,
  getModelColorCode,
  modelColor,
  prettyModelName,
  makeBar,
  formatCostCompact,
  renderBarPanel,
  composeColumns,
} = require('../claude-manager');

describe('Model breakdown (heatmap)', () => {

  describe('aggregateModelUsage', () => {
    it('returns empty array for no turns', () => {
      assert.deepStrictEqual(aggregateModelUsage([]), []);
      assert.deepStrictEqual(aggregateModelUsage(undefined), []);
    });

    it('buckets turns by model and sums token fields', () => {
      const models = aggregateModelUsage([
        { model: 'claude-opus-4-7', inputTokens: 100, outputTokens: 50, cacheCreateTokens: 10, cacheReadTokens: 1000 },
        { model: 'claude-opus-4-7', inputTokens: 100, outputTokens: 50, cacheCreateTokens: 10, cacheReadTokens: 1000 },
        { model: 'claude-haiku-4-5', inputTokens: 10, outputTokens: 5, cacheCreateTokens: 0, cacheReadTokens: 0 },
      ]);
      assert.strictEqual(models.length, 2);
      const opus = models.find(m => m.model === 'claude-opus-4-7');
      assert.strictEqual(opus.turns, 2);
      assert.strictEqual(opus.inputTokens, 200);
      assert.strictEqual(opus.totalTokens, 2320);
    });

    it('computes per-model cost from pricing (opus pricier than haiku for same tokens)', () => {
      const [opus] = aggregateModelUsage([{ model: 'claude-opus-4-7', inputTokens: 1_000_000, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 }]);
      const [haiku] = aggregateModelUsage([{ model: 'claude-haiku-4-5', inputTokens: 1_000_000, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 }]);
      assert.ok(opus.cost > 0);
      assert.ok(haiku.cost > 0);
      assert.ok(opus.cost > haiku.cost);
    });

    it('sorts models by totalTokens descending', () => {
      const models = aggregateModelUsage([
        { model: 'a', inputTokens: 1, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
        { model: 'b', inputTokens: 100, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
      ]);
      assert.strictEqual(models[0].model, 'b');
    });

    it('ignores turns with no model', () => {
      const models = aggregateModelUsage([{ inputTokens: 5 }, { model: null, inputTokens: 5 }]);
      assert.deepStrictEqual(models, []);
    });
  });

  describe('modelFamily', () => {
    it('classifies known families', () => {
      assert.strictEqual(modelFamily('claude-opus-4-8'), 'opus');
      assert.strictEqual(modelFamily('claude-sonnet-4-6'), 'sonnet');
      assert.strictEqual(modelFamily('claude-haiku-4-5'), 'haiku');
      assert.strictEqual(modelFamily('gpt-4.1'), 'gpt');
      assert.strictEqual(modelFamily('kimi-k2'), 'kimi');
      assert.strictEqual(modelFamily('gemini-2.5-pro'), 'gemini');
      assert.strictEqual(modelFamily('ollama/qwen3'), 'local');
    });
    it('returns null for unknown providers', () => {
      assert.strictEqual(modelFamily('some-new-model'), null);
    });
  });

  describe('getModelColorCode / modelColor', () => {
    it('gives distinct shades to different opus versions', () => {
      const codes = ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5'].map(getModelColorCode);
      assert.strictEqual(new Set(codes).size, 4);
    });
    it('is stable for the same model', () => {
      assert.strictEqual(getModelColorCode('kimi-k2'), getModelColorCode('kimi-k2'));
    });
    it('returns a 256-color escape sequence', () => {
      assert.match(modelColor('claude-opus-4-7'), /\x1b\[38;5;\d+m/);
    });
    it('assigns a color to unknown providers without throwing', () => {
      assert.ok(typeof getModelColorCode('totally-unknown-xyz') === 'number');
    });
  });

  describe('prettyModelName', () => {
    it('formats claude model ids', () => {
      assert.strictEqual(prettyModelName('claude-opus-4-8'), 'Opus 4.8');
      assert.strictEqual(prettyModelName('claude-sonnet-4-6'), 'Sonnet 4.6');
    });
    it('strips trailing date stamps', () => {
      assert.strictEqual(prettyModelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
    });
    it('drops provider prefix', () => {
      assert.strictEqual(prettyModelName('ollama/qwen3'), 'qwen3');
    });
    it('handles null', () => {
      assert.strictEqual(prettyModelName(null), 'unknown');
    });
  });

  describe('makeBar', () => {
    it('is empty for zero fraction', () => {
      assert.strictEqual(makeBar(0, 10), '');
    });
    it('fills full width at fraction 1', () => {
      assert.strictEqual(makeBar(1, 10), '█'.repeat(10));
    });
    it('shows a minimum sliver for tiny nonzero fractions', () => {
      assert.strictEqual(makeBar(0.0001, 20), '▏');
    });
    it('clamps fractions above 1 to the width', () => {
      assert.strictEqual([...makeBar(5, 8)].length, 8);
    });
  });

  describe('formatCostCompact', () => {
    it('formats across magnitudes', () => {
      assert.strictEqual(formatCostCompact(29261), '$29.3k');
      assert.strictEqual(formatCostCompact(76), '$76');
      assert.strictEqual(formatCostCompact(5.93), '$5.93');
      assert.strictEqual(formatCostCompact(0), '$0');
      assert.strictEqual(formatCostCompact(0.004), '<$0.01');
      assert.strictEqual(formatCostCompact(null), '--');
    });
  });

  describe('renderBarPanel', () => {
    const models = aggregateModelUsage([
      { model: 'claude-opus-4-7', inputTokens: 1000, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
      { model: 'claude-haiku-4-5', inputTokens: 100, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
    ]);
    it('returns a header line plus one row per model', () => {
      const lines = renderBarPanel(models, 'totalTokens', 'By Model', 44);
      assert.strictEqual(lines.length, 3); // header + 2 rows
      assert.match(lines[0], /By Model/);
    });
    it('caps at six rows', () => {
      const many = aggregateModelUsage(Array.from({ length: 9 }, (_, i) => ({ model: 'm' + i, inputTokens: i + 1 })));
      const lines = renderBarPanel(many, 'totalTokens', 'By Model', 44);
      assert.strictEqual(lines.length, 7); // header + 6
    });
    it('shows a placeholder when there is no usage', () => {
      const lines = renderBarPanel([], 'totalTokens', 'By Model', 44);
      assert.match(lines[1], /no model usage/);
    });
  });

  describe('composeColumns', () => {
    it('pads left lines to a common width and appends the right column after the gap', () => {
      const out = composeColumns(['ab', 'c'], ['X', 'Y'], 2);
      assert.deepStrictEqual(out, ['ab  X', 'c   Y']);
    });
    it('handles unequal column heights', () => {
      const out = composeColumns(['aa'], ['X', 'Y'], 1);
      assert.strictEqual(out.length, 2);
      assert.strictEqual(out[0], 'aa X');
      assert.strictEqual(out[1], '   Y'); // missing left line padded to width 2 + gap 1, then 'Y'
    });
  });

});
