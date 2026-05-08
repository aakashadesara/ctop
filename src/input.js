// Input handling — re-exports from core
const core = require('./_core');

module.exports = {
  parseMouseEvent: core.parseMouseEvent,
  listViewRowToIndex: core.listViewRowToIndex,
  paneViewClickToIndex: core.paneViewClickToIndex,
  openDirectory: core.openDirectory,
  cycleTheme: core.cycleTheme,
};
