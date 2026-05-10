#!/bin/bash
# mock-sessions.sh — Spawn fake Claude/Codex processes with pre-built JSONL
# session data so ctop has something convincing to display during GIF recording.
#
# Usage:  scripts/mock-sessions.sh          # start mock sessions
#         scripts/mock-sessions.sh cleanup   # kill mocks & remove data
set -euo pipefail

# Resolve /tmp to real path (macOS /tmp -> /private/tmp)
DEMO_ROOT="$(cd /tmp && pwd -P)/ctop-demo"
CLAUDE_PROJECTS="${HOME}/.claude/projects"
PIDFILE="${DEMO_ROOT}/.pids"

# ── Cleanup mode ──────────────────────────────────────────────────────
if [[ "${1:-}" == "cleanup" ]]; then
  echo "Cleaning up mock sessions..."
  if [[ -f "$PIDFILE" ]]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  rm -rf "$DEMO_ROOT"
  rm -rf "${CLAUDE_PROJECTS}/-"*"ctop-demo-"*
  echo "Done."
  exit 0
fi

# ── Setup directories ─────────────────────────────────────────────────
mkdir -p "$DEMO_ROOT"
> "$PIDFILE"

PROJECTS=(
  "ai-chatbot"
  "magic-api"
  "consensus-app"
  "ml-pipeline"
  "docs-site"
)

BRANCHES=(
  "main"
  "feature/auth-flow"
  "fix/rate-limiter"
  "aakash/training-pipeline"
  "docs/api-reference"
)

SLUGS=(
  "ethereal-dancing-fox"
  "validated-cosmic-reef"
  "ancient-silver-mesa"
  "luminous-crystal-wave"
  "frozen-jade-peak"
)

MODELS=(
  "claude-opus-4-6"
  "claude-opus-4-6"
  "claude-sonnet-4-6"
  "claude-opus-4-6"
  "claude-haiku-4-5"
)

TITLES=(
  "Add real-time WebSocket notifications for chat"
  "Implement OAuth2 token refresh with retry logic"
  "Fix rate limiter edge case under concurrent load"
  "Build training data pipeline with validation"
  "Generate API reference docs from OpenAPI spec"
)

# Token counts: input, cache_create, cache_read, output
INPUT_TOKENS=(420000 180000 85000 650000 25000)
CACHE_CREATE=(18000 8000 3000 25000 1000)
CACHE_READ=(12000 5000 2000 18000 500)
OUTPUT_TOKENS=(55000 22000 12000 78000 8000)

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Helper: generate a JSONL session file
write_session() {
  local idx="$1"
  local project="${PROJECTS[$idx]}"
  local branch="${BRANCHES[$idx]}"
  local slug="${SLUGS[$idx]}"
  local model="${MODELS[$idx]}"
  local title="${TITLES[$idx]}"
  local inp="${INPUT_TOKENS[$idx]}"
  local cc="${CACHE_CREATE[$idx]}"
  local cr="${CACHE_READ[$idx]}"
  local outp="${OUTPUT_TOKENS[$idx]}"

  local project_dir="${DEMO_ROOT}/${project}"
  # Derive the project dir name the same way ctop does: replace / with -
  local dir_name
  dir_name=$(echo "${project_dir}" | sed 's|/|-|g')
  local claude_dir="${CLAUDE_PROJECTS}/${dir_name}"
  mkdir -p "$project_dir" "$claude_dir"

  local session_file="${claude_dir}/session.jsonl"
  local session_id
  session_id="sess-$(openssl rand -hex 8 2>/dev/null || echo "demo${idx}abc123")"

  # Base timestamp — stagger sessions 2 minutes apart
  local offset_min=$((idx * 2))
  local base_ts
  base_ts=$(date -u -v-${offset_min}M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${offset_min} minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$now")

  # Conversation messages — realistic back-and-forth
  local user_msgs assistant_msgs
  case $idx in
    0)
      user_msgs=(
        "Set up WebSocket server for real-time chat notifications. Use ws library, handle connection lifecycle, and broadcast to relevant rooms."
        "Add reconnection logic with exponential backoff on the client side"
        "Now add typing indicators — broadcast when a user starts/stops typing"
        "Write tests for the WebSocket handler, mock the connection pool"
      )
      assistant_msgs=(
        "I'll set up the WebSocket server with room-based broadcasting. Let me create the handler module first, then integrate it with the existing Express server. The ws library is already in package.json so I'll use that directly."
        "I've added reconnection with exponential backoff starting at 1s, maxing at 30s. The client tracks connection state and queues messages during reconnection. Let me also add a heartbeat ping every 30s to detect stale connections."
        "Typing indicators are now broadcasting via a dedicated channel. Each user gets a debounced 3s timeout — if no new keystrokes arrive, a stop-typing event fires automatically. I've also added a visual indicator component."
        "I've written 12 tests covering connection lifecycle, room broadcasting, reconnection, and typing indicators. All tests use a mock WebSocket server. Let me run them to verify everything passes."
      )
      ;;
    1)
      user_msgs=(
        "Implement OAuth2 token refresh. When an access token expires, automatically refresh it using the stored refresh token before retrying the failed request."
        "Handle the case where the refresh token itself has expired"
        "Add request queuing — if multiple requests hit a 401 simultaneously, only one should trigger the refresh"
      )
      assistant_msgs=(
        "I'll implement an Axios interceptor that catches 401 responses, refreshes the token, and retries. The refresh token is stored in an httpOnly cookie. Let me update the auth middleware and add the interceptor."
        "Good catch. When the refresh token is expired (400 from /auth/refresh), I'll redirect to login and clear all stored tokens. I've also added a flag to prevent infinite refresh loops — if the retry itself gets a 401, we bail immediately."
        "Implemented a request queue using a Promise-based lock. The first 401 triggers the refresh, subsequent requests await the same Promise. Once the new token arrives, all queued requests retry with the fresh token. This prevents thundering herd on the auth endpoint."
      )
      ;;
    2)
      user_msgs=(
        "There's a bug in the rate limiter — under high concurrency some requests bypass the limit. The Redis MULTI/EXEC block isn't atomic enough."
        "Can you switch to a Lua script for atomic increment-and-check?"
      )
      assistant_msgs=(
        "I see the issue. The current implementation does a GET then SET in a transaction, but there's a race window between reading the count and incrementing it. Two requests can read the same count and both pass through. Let me investigate the best fix."
        "Done. I've replaced the MULTI/EXEC with a single Lua script that atomically increments the counter and checks the limit in one round-trip. The script returns the remaining quota so we can set the X-RateLimit-Remaining header accurately. I also added sliding window support."
      )
      ;;
    3)
      user_msgs=(
        "Build a training data pipeline that reads from S3, validates schema, deduplicates, and writes parquet to the output bucket"
        "Add data quality checks — null ratio per column should be under 5%, and flag any PII in text fields"
        "The pipeline needs to handle 50GB+ datasets. Add chunked processing with checkpointing so we can resume after failures."
        "Now wire it up to Airflow with proper retry and alerting"
      )
      assistant_msgs=(
        "I'll use PyArrow for parquet I/O and boto3 for S3. The pipeline will: list objects by prefix, stream each file through validation, deduplicate using xxhash on the content columns, and write partitioned parquet output. Let me scaffold the modules."
        "Added a DataQualityValidator that runs per-batch. Null ratio check is straightforward — I compute it per column and fail the batch if any exceeds 5%. For PII detection I'm using a regex-based approach for emails, SSNs, and phone numbers, plus a spaCy NER model for names. Flagged rows go to a quarantine bucket."
        "Refactored to process data in 256MB chunks using PyArrow's RecordBatchReader. Each chunk gets a checkpoint file in S3 with the byte offset and batch number. On restart, the pipeline scans for the latest checkpoint and resumes from there. Memory usage stays flat regardless of dataset size."
        "Created the Airflow DAG with three tasks: validate, transform, and load. Each task has 3 retries with exponential backoff. I've added Slack alerting on failure via a callback hook. The DAG runs daily at 2am UTC with a 6-hour SLA."
      )
      ;;
    4)
      user_msgs=(
        "Generate API reference documentation from our OpenAPI 3.1 spec. Use a clean, readable format."
        "Add code examples for each endpoint in curl, Python, and TypeScript"
      )
      assistant_msgs=(
        "I'll parse the OpenAPI spec and generate markdown documentation organized by tag/resource. Each endpoint will have: method, path, description, parameters table, request/response body schemas, and status codes. Let me read the spec first."
        "Added code examples for all 24 endpoints. Each example shows curl, Python (requests), and TypeScript (fetch). I've templated the auth headers and base URL so they're consistent. The examples use realistic sample data matching the schema constraints."
      )
      ;;
  esac

  # Write the JSONL file
  {
    # Summary
    echo "{\"summary\": \"${title}\"}"

    # Conversation turns with timestamps
    local num_turns=${#user_msgs[@]}
    for ((t=0; t<num_turns; t++)); do
      local turn_offset=$((t * 3 + 1))
      local ts
      ts=$(date -u -v+${turn_offset}M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "+${turn_offset} minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$now")

      # User message
      echo "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"${user_msgs[$t]}\"},\"timestamp\":\"${ts}\"}"

      # Bump timestamp for assistant response
      local resp_offset=$((turn_offset + 1))
      local resp_ts
      resp_ts=$(date -u -v+${resp_offset}M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "+${resp_offset} minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$now")

      # Assistant message with usage
      local turn_inp=$((inp / num_turns * (t + 1)))
      local turn_outp=$((outp / num_turns * (t + 1)))
      echo "{\"message\":{\"role\":\"assistant\",\"model\":\"${model}\",\"stop_reason\":\"end_turn\",\"content\":[{\"type\":\"text\",\"text\":\"${assistant_msgs[$t]}\"}],\"usage\":{\"input_tokens\":${turn_inp},\"cache_creation_input_tokens\":${cc},\"cache_read_input_tokens\":${cr},\"output_tokens\":${turn_outp},\"service_tier\":\"standard\"}},\"gitBranch\":\"${branch}\",\"slug\":\"${slug}\",\"sessionId\":\"${session_id}\",\"version\":\"1.0.65\",\"userType\":\"pro\",\"timestamp\":\"${resp_ts}\",\"requestId\":\"req-$(openssl rand -hex 6 2>/dev/null || echo "reqabc${t}")\"}"
    done

    # Turn duration
    echo "{\"subtype\":\"turn_duration\",\"durationMs\":$((RANDOM % 8000 + 2000))}"

  } > "$session_file"

  echo "  Created session: ${project} (${model}, ${branch})"
}

# ── Create mock sessions ──────────────────────────────────────────────
echo "Setting up mock sessions..."

for i in "${!PROJECTS[@]}"; do
  write_session "$i"
done

# ── Spawn fake processes ──────────────────────────────────────────────
echo "Spawning mock processes..."

# We create tiny Node.js scripts named "claude" and "codex" so they
# show up correctly in ps output. Node keeps the script path in the
# command column (unlike bash which shows the interpreter).
MOCK_BIN="${DEMO_ROOT}/bin"
mkdir -p "$MOCK_BIN"

# Claude mock — a Node.js script that just idles
cat > "${MOCK_BIN}/claude" << 'SCRIPT'
#!/usr/bin/env node
// Mock Claude Code process for ctop demo recording
setInterval(() => {}, 60000);
SCRIPT
chmod +x "${MOCK_BIN}/claude"

# Codex mock
cat > "${MOCK_BIN}/codex" << 'SCRIPT'
#!/usr/bin/env node
// Mock Codex CLI process for ctop demo recording
setInterval(() => {}, 60000);
SCRIPT
chmod +x "${MOCK_BIN}/codex"

# Spawn a process per project (first 4 as claude, last as codex)
for i in "${!PROJECTS[@]}"; do
  project="${PROJECTS[$i]}"
  project_dir="${DEMO_ROOT}/${project}"

  if [[ $i -lt 4 ]]; then
    (cd "$project_dir" && exec "${MOCK_BIN}/claude" --mode repl --project "$project") &
  else
    (cd "$project_dir" && exec "${MOCK_BIN}/codex" --session "$project") &
  fi
  echo $! >> "$PIDFILE"
done

echo ""
echo "Mock sessions ready. PIDs saved to ${PIDFILE}"
echo "Run 'scripts/mock-sessions.sh cleanup' to tear down."
echo ""
