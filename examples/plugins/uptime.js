module.exports = {
  name: 'uptime',
  description: 'Show process uptime in human-readable format',
  column: {
    header: 'UPTIME',
    width: 10,
    getValue: (proc) => proc.startTime || '--',
  },
};
