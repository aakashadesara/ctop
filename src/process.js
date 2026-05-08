// Process detection and management — re-exports from core
const core = require('./_core');

module.exports = {
  IS_MAC: core.IS_MAC,
  IS_LINUX: core.IS_LINUX,
  IS_WIN: core.IS_WIN,
  PLATFORM: core.PLATFORM,
  buildKillCommand: core.buildKillCommand,
  cwdToProjectDirName: core.cwdToProjectDirName,
};
