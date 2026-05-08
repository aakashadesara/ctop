// Cost calculation

// Pricing per million tokens (USD) — as of 2025
const MODEL_PRICING = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-4-6': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-haiku-4-5': { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  // Older models
  'claude-sonnet-4-5-20250514': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'claude-3-opus-20240229': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
};

function calculateCost(proc) {
  if (!proc.model || proc.inputTokens == null) return null;
  // Try exact match, then prefix match
  let pricing = MODEL_PRICING[proc.model];
  if (!pricing) {
    // Try matching by model family
    const modelLower = proc.model.toLowerCase();
    if (modelLower.includes('opus')) pricing = MODEL_PRICING['claude-opus-4-6'];
    else if (modelLower.includes('haiku')) pricing = MODEL_PRICING['claude-haiku-4-5'];
    else pricing = MODEL_PRICING['claude-sonnet-4-6']; // default to sonnet
  }
  const cost = (
    (proc.inputTokens || 0) * pricing.input / 1_000_000 +
    (proc.outputTokens || 0) * pricing.output / 1_000_000 +
    (proc.cacheCreateTokens || 0) * pricing.cacheWrite / 1_000_000 +
    (proc.cacheReadTokens || 0) * pricing.cacheRead / 1_000_000
  );
  return cost;
}

function formatCost(cost) {
  if (cost === null) return '--';
  if (cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(2);
}

module.exports = { MODEL_PRICING, calculateCost, formatCost };
