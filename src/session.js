// Session data parsing — re-exports from core
const core = require('./_core');

module.exports = {
  getSessionData: core.getSessionData,
  searchSessionContent: core.searchSessionContent,
  getSessionFilesForProject: core.getSessionFilesForProject,
  parseLogEntry: core.parseLogEntry,
  readSessionLog: core.readSessionLog,
};
