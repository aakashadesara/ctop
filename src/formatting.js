// Shared text and number formatters used by the TUI renderer (_core.js)
// and the pipeable CLI formatters (cli-format.js). Zero deps — only uses
// built-in Intl.Segmenter for grapheme width.

// --- ANSI & visual width (used by the TUI renderer) ---

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const _segmenter = new Intl.Segmenter();

function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33BF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0x9FFF) ||
    (cp >= 0xA960 && cp <= 0xA97F) ||
    (cp >= 0xAC00 && cp <= 0xD7FF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x3FFFD);
}

const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;

function segmentWidth(seg) {
  const cp = seg.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) return 0;
  if (cp === 0x200B || cp === 0xFEFF) return 0;
  if (isWide(cp)) return 2;
  if (EMOJI_PRESENTATION_RE.test(seg)) return 2;
  return 1;
}

function visualWidth(str) {
  let w = 0;
  for (const { segment } of _segmenter.segment(stripAnsi(str)))
    w += segmentWidth(segment);
  return w;
}

function visualTruncate(str, maxWidth) {
  const clean = stripAnsi(str).replace(/[\x00-\x1f\x7f]/g, ' ');
  let w = 0, result = '';
  for (const { segment } of _segmenter.segment(clean)) {
    const cw = segmentWidth(segment);
    if (w + cw > maxWidth) break;
    w += cw; result += segment;
  }
  return result;
}

function visualPadEnd(str, width) {
  const vw = visualWidth(str);
  return str + ' '.repeat(Math.max(0, width - vw));
}

// --- Plain-text padding & truncation (used by the pipeable CLI) ---

function truncate(str, max) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Pads a string to width with spaces (right-pad). Width counts in chars,
// not visual cells; CLI output is plain ASCII so they match.
function pad(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s;
  return s + ' '.repeat(width - s.length);
}

// --- Number / cost formatters ---

// digits=2 keeps the legacy "<$0.01" threshold for the TUI's compact display.
// digits>2 (e.g., the `ctop get` detail view) skips it so users see the exact
// fractional cost instead of a rounded sentinel.
function formatCost(cost, digits = 2) {
  if (cost === null) return '--';
  if (digits === 2 && cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(digits);
}

function formatTokenCount(n) {
  if (n == null) return '--';
  return n.toLocaleString('en-US');
}

function formatCompactTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

module.exports = {
  // ANSI / visual
  stripAnsi,
  isWide,
  segmentWidth,
  visualWidth,
  visualTruncate,
  visualPadEnd,
  // Plain text
  pad,
  truncate,
  // Numbers / cost
  formatCost,
  formatTokenCount,
  formatCompactTokens,
  formatDuration,
};
