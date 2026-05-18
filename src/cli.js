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

// Lazy require helpers — keep cli.js itself cheap to load.
function loadCore() {
  return require('./_core');
}
function loadFmt() {
  return require('./cli-format');
}

function findProc(procs, pid) {
  const n = String(pid);
  return procs.find(p => String(p.pid) === n) || null;
}

// --- Subcommand handlers ---

function cmdLs(args) {
  if (args.flags.help || args.flags.h) {
    process.stdout.write(`Usage: ctop ls [--agent claude|codex|opencode] [--cwd PATH] [--status active|sleeping|all] [--json]

List running agent sessions.

  --agent X   Filter by agent backend
  --cwd P     Filter by working directory (prefix match)
  --status S  Filter by status. Default: all
  --json      Machine-parseable JSON output
`);
    return 0;
  }
  const core = loadCore();
  const fmt = loadFmt();
  let procs = core.getAllAgentProcesses();
  if (args.flags.agent) {
    procs = procs.filter(p => p.agentType === args.flags.agent);
  }
  if (args.flags.cwd) {
    procs = procs.filter(p => p.cwd && p.cwd.startsWith(args.flags.cwd));
  }
  if (args.flags.status && args.flags.status !== 'all') {
    const want = String(args.flags.status).toUpperCase();
    procs = procs.filter(p => p.status === want);
  }
  const summaries = procs.map(fmt.summarize);
  if (args.flags.json) {
    process.stdout.write(fmt.toJson(summaries));
  } else {
    process.stdout.write(fmt.formatLsHuman(summaries));
  }
  return 0;
}

function cmdGet(args) {
  if (args.flags.help || args.flags.h) {
    process.stdout.write(`Usage: ctop get <pid> [--json]

Show full detail for one session.
`);
    return 0;
  }
  const pid = args.positional[0];
  if (!pid) {
    process.stderr.write('ctop get: missing required <pid> argument\n');
    return 1;
  }
  const core = loadCore();
  const fmt = loadFmt();
  const procs = core.getAllAgentProcesses();
  const proc = findProc(procs, pid);
  if (!proc) {
    if (args.flags.json) {
      process.stdout.write(fmt.toJson(null));
      return 1;
    }
    process.stderr.write(`ctop get: pid ${pid} is not a known agent session\n`);
    return 1;
  }
  const detail = fmt.detail(proc);
  if (args.flags.json) {
    process.stdout.write(fmt.toJson(detail));
  } else {
    process.stdout.write(fmt.formatGetHuman(detail));
  }
  return 0;
}

function cmdStats(args) {
  if (args.flags.help || args.flags.h) {
    process.stdout.write(`Usage: ctop stats [--json]

Aggregate stats across all running sessions.
`);
    return 0;
  }
  const core = loadCore();
  const fmt = loadFmt();
  const procs = core.getAllAgentProcesses();
  const stats = core.calculateAggregateStats(procs);
  if (args.flags.json) {
    process.stdout.write(fmt.toJson(stats));
  } else {
    process.stdout.write(fmt.formatStatsHuman(stats));
  }
  return 0;
}

// --- Router ---

function run(subcommand, rawArgs) {
  const args = parseArgs(rawArgs);
  let code = 1;
  try {
    switch (subcommand) {
      case 'ls':    code = cmdLs(args); break;
      case 'get':   code = cmdGet(args); break;
      case 'stats': code = cmdStats(args); break;
      default:
        process.stderr.write(`ctop: subcommand "${subcommand}" not yet implemented\n`);
        code = 1;
    }
  } catch (err) {
    process.stderr.write(`ctop ${subcommand}: ${err.message}\n`);
    code = 2;
  }
  // Use exitCode instead of exit() — process.exit forcibly terminates and
  // can truncate stdout writes that are still draining to a pipe.
  process.exitCode = code;
}

module.exports = {
  KNOWN_SUBCOMMANDS,
  isSubcommand,
  parseArgs,
  printRootHelp,
  run,
  // Exposed for unit testing without spawning child processes.
  _handlers: { cmdLs, cmdGet, cmdStats },
};
