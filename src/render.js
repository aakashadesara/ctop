// All rendering functions — re-exports from core
const core = require('./_core');

module.exports = {
  renderBrailleBar: core.renderBrailleBar,
  renderContextBarBraille: core.renderContextBarBraille,
  BRAILLE_FILLS: core.BRAILLE_FILLS,
  getCardsPerRow: core.getCardsPerRow,
  renderHistoryChart: core.renderHistoryChart,
  formatHourLabel: core.formatHourLabel,
  formatCompactTokens: core.formatCompactTokens,
};
