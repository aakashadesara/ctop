// Subcommand router for non-interactive ctop usage.
// Loaded only when argv[2] matches one of KNOWN_SUBCOMMANDS — never imports
// _core at module load, so it stays cheap when not used.

const KNOWN_SUBCOMMANDS = new Set([
  'ls', 'get', 'log', 'search', 'diff', 'stats',
  'whoami', 'alerts', 'kill', 'notify',
]);

function isSubcommand(arg) {
  return typeof arg === 'string' && KNOWN_SUBCOMMANDS.has(arg);
}

function printRootHelp() {
  process.stdout.write(`ctop subcommands (run \`ctop <cmd> --help\` for details):

  ls          List all running agent sessions
  get <pid>   Show full detail for one session
  log <pid>   Print conversation transcript
  search <q>  Full-text search session content
  diff <pid>  Show git diff for session's cwd
  stats       Aggregate stats across all sessions
  whoami      Detect the calling session
  alerts      Show low-context / idle / ghost warnings
  kill <pid>  Send SIGTERM (or SIGKILL with --force)
  notify      Send a desktop notification

Run \`ctop\` with no args to enter the interactive TUI.
`);
}

// Parses a flat arg list into { positional: string[], flags: {key: value|true} }.
// Supports --flag, --flag value, --flag=value, and short bool flags like -h.
function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (a.startsWith('-') && a.length > 1) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// Entry point — dispatched from claude-manager when argv[2] is a known subcommand.
function run(subcommand, rawArgs) {
  const args = parseArgs(rawArgs);

  if (args.flags.help || args.flags.h) {
    // Per-subcommand help text comes in subsequent commits as each is wired.
    process.stdout.write(`Usage: ctop ${subcommand} [args]\n\nThis subcommand is not yet implemented.\n`);
    process.exit(0);
  }

  // Stub — real handlers are wired in subsequent commits.
  process.stderr.write(`ctop: subcommand "${subcommand}" not yet implemented\n`);
  process.exit(1);
}

module.exports = {
  KNOWN_SUBCOMMANDS,
  isSubcommand,
  parseArgs,
  printRootHelp,
  run,
};
