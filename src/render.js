// All rendering functions

const { spawn } = require('child_process');
const fs = require('fs');
const {
  ESC, CLEAR, HOME, CLR_LINE, CLR_DOWN, HIDE_CURSOR, SHOW_CURSOR,
  BOLD, DIM, RESET, RED, GREEN, YELLOW, BLUE, CYAN, WHITE,
  BG_BLUE, BG_RED, ORANGE, BG_ORANGE,
  THEMES, THEME_NAMES, ctxColor,
} = require('./colors');
const { formatCost } = require('./cost');
const { formatTokenCount, calculateAggregateStats } = require('./utils');

// Braille-dot context bar rendering
const BRAILLE_FILLS = ['\u2800', '\u2880', '\u28A0', '\u28B0', '\u28B8', '\u28F8', '\u28FC', '\u28FE', '\u28FF'];

function renderBrailleBar(segments, width) {
  if (width <= 0) return '';

  const totalSubs = width * 8;
  const chars = new Array(width);

  let cumSubs = 0;
  const segBounds = [];
  for (const seg of segments) {
    const segSubs = Math.round(seg.value * totalSubs);
    if (segSubs <= 0) {
      segBounds.push({ start: cumSubs, end: cumSubs, color: seg.color });
      continue;
    }
    segBounds.push({ start: cumSubs, end: cumSubs + segSubs, color: seg.color });
    cumSubs += segSubs;
  }
  if (segBounds.length > 0 && cumSubs > 0 && cumSubs < totalSubs) {
    for (let i = segBounds.length - 1; i >= 0; i--) {
      if (segBounds[i].end > segBounds[i].start) {
        segBounds[i].end = totalSubs;
        break;
      }
    }
  }

  for (let ci = 0; ci < width; ci++) {
    const cellStart = ci * 8;
    const cellEnd = cellStart + 8;

    let bestSeg = segBounds.length - 1;
    let bestOverlap = 0;
    for (let si = 0; si < segBounds.length; si++) {
      const oStart = Math.max(cellStart, segBounds[si].start);
      const oEnd = Math.min(cellEnd, segBounds[si].end);
      const overlap = Math.max(0, oEnd - oStart);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSeg = si;
      }
    }

    let filled = 0;
    for (let si = 0; si < segBounds.length; si++) {
      const oStart = Math.max(cellStart, segBounds[si].start);
      const oEnd = Math.min(cellEnd, segBounds[si].end);
      filled += Math.max(0, oEnd - oStart);
    }

    const segColor = segBounds[bestSeg].color;
    const fillSubs = Math.min(8, Math.max(0, bestOverlap));
    chars[ci] = { color: segColor, fill: fillSubs };
  }

  let result = '';
  let prevColor = null;
  for (let ci = 0; ci < width; ci++) {
    const { color, fill } = chars[ci];
    if (color !== prevColor) {
      if (prevColor !== null) result += RESET;
      if (color) result += color;
      prevColor = color;
    }
    result += BRAILLE_FILLS[fill];
  }
  if (prevColor !== null) result += RESET;

  return result;
}

function renderContextBarBraille(proc, width, CONFIG) {
  const CTX_LIMIT = CONFIG.contextLimit;
  const inp = proc.inputTokens || 0;
  const cw = proc.cacheCreateTokens || 0;
  const cr = proc.cacheReadTokens || 0;
  const out = proc.outputTokens || 0;
  const used = inp + cw + cr;
  const free = Math.max(0, CTX_LIMIT - used);

  const total = inp + cw + cr + out + free;
  if (total === 0) {
    return {
      bar: `${DIM}${BRAILLE_FILLS[0].repeat(width)}${RESET}`,
      segments: [{ name: 'free', value: 1, tokens: 0 }]
    };
  }

  const adjustedFree = Math.max(0, free - out);

  const segDefs = [
    { name: 'input',       tokens: inp,           color: GREEN },
    { name: 'cache_write', tokens: cw,            color: BLUE },
    { name: 'cache_read',  tokens: cr,            color: CYAN },
    { name: 'output',      tokens: out,           color: YELLOW },
    { name: 'free',        tokens: adjustedFree,  color: DIM },
  ];

  const segments = segDefs.map(s => ({
    name: s.name,
    value: s.tokens / CTX_LIMIT,
    tokens: s.tokens,
    color: s.color,
  }));

  let sumValues = segments.reduce((s, seg) => s + seg.value, 0);
  if (sumValues > 1) {
    const scale = 1 / sumValues;
    for (const seg of segments) seg.value *= scale;
  }

  const bar = renderBrailleBar(segments, width);
  return { bar, segments };
}

function renderDashboard(columns, state) {
  const stats = calculateAggregateStats(state.allProcesses);
  let out = '';
  const inStr = `In: ${formatTokenCount(stats.totalInput)}`;
  const outStr = `Out: ${formatTokenCount(stats.totalOutput)}`;
  const cacheStr = `Cache: ${formatTokenCount(stats.totalCache)}`;
  out += `${DIM} Tokens  ${RESET}${GREEN}${inStr}${RESET}${DIM} | ${RESET}${YELLOW}${outStr}${RESET}${DIM} | ${RESET}${CYAN}${cacheStr}${RESET}${CLR_LINE}\n`;
  const utilStr = stats.avgContextUtil !== null ? `${stats.avgContextUtil}%` : '--';
  let utilColor = GREEN;
  if (stats.avgContextUtil !== null) {
    if (stats.avgContextUtil > 80) utilColor = RED;
    else if (stats.avgContextUtil > 50) utilColor = YELLOW;
  }
  let costColor = GREEN;
  if (stats.totalCost > 5) costColor = RED;
  else if (stats.totalCost >= 1) costColor = YELLOW;
  out += `${DIM} Avg Ctx ${RESET}${utilColor}${utilStr}${RESET}`;
  out += `${DIM} | Cost: ${RESET}${costColor}${formatCost(stats.totalCost > 0 ? stats.totalCost : null)}${RESET}`;
  out += `${DIM} | Sessions: ${RESET}${GREEN}${stats.active}${RESET}${DIM} active ${RESET}${RED}${stats.dead}${RESET}${DIM} dead ${RESET}${WHITE}${stats.total}${RESET}${DIM} total${RESET}${CLR_LINE}\n`;
  return out;
}

function renderHeader(columns, state) {
  const title = ' CTOP \u2014 Claude Terminal Operations Panel ';
  let h = '';
  const THEME = state.THEME;

  h += `${THEME.border}${'\u2500'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  const pad = Math.max(0, Math.floor((columns - title.length) / 2));
  const rightPad = Math.max(0, columns - pad - title.length);
  h += `${THEME.headerBg}${WHITE}${BOLD}${' '.repeat(pad)}${title}${' '.repeat(rightPad)}${RESET}${CLR_LINE}\n`;

  h += `${THEME.border}${'\u2500'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  return h;
}

function getCardsPerRow() {
  const { columns } = process.stdout;
  const cardWidth = 34;
  const gap = 1;
  const detailPaneWidth = 42;
  const showDetail = columns >= 140;
  const availWidth = showDetail ? columns - detailPaneWidth - 1 : columns;
  return Math.max(1, Math.floor((availWidth + gap) / (cardWidth + gap)));
}

function renderDetailPane(proc, startRow, paneCol, paneWidth, availRows, state, CONFIG) {
  if (!proc) return '';
  const THEME = state.THEME;
  let output = '';
  const inner = paneWidth - 2;

  const drawLine = (row, content) => `${ESC}[${row};${paneCol}H${content}`;

  const colW = Math.floor((inner - 2) / 2);
  const truncVal = (v, maxLen) => {
    const s = (v || '--').toString();
    return s.length > maxLen ? s.substring(0, maxLen - 1) + '\u2026' : s;
  };
  const pairRow = (row, lbl1, val1, c1, lbl2, val2, c2) => {
    const maxV1 = colW - lbl1.length - 1;
    const maxV2 = lbl2 ? colW - lbl2.length - 1 : 0;
    const v1 = truncVal(val1, Math.max(2, maxV1));
    const v2 = lbl2 ? truncVal(val2, Math.max(2, maxV2)) : '';
    const l1 = `${DIM}${lbl1}${RESET} ${c1 || ''}${v1}${c1 ? RESET : ''}`;
    const l2 = lbl2 ? `${DIM}${lbl2}${RESET} ${c2 || ''}${v2}${c2 ? RESET : ''}` : '';
    const vis1 = lbl1.length + 1 + v1.length;
    const vis2 = lbl2 ? lbl2.length + 1 + v2.length : 0;
    const pad1 = Math.max(1, colW - vis1);
    const pad2 = Math.max(0, colW - vis2);
    return drawLine(row, `${DIM}\u2502${RESET} ${l1}${' '.repeat(pad1)}${l2}${' '.repeat(pad2)} ${DIM}\u2502${RESET}`);
  };

  const fullRow = (row, lbl, val, c) => {
    const maxV = inner - 2 - lbl.length - 1;
    const tv = truncVal(val, Math.max(2, maxV));
    const vis = lbl.length + 1 + tv.length;
    const pad = Math.max(0, inner - 2 - vis);
    return drawLine(row, `${DIM}\u2502${RESET} ${DIM}${lbl}${RESET} ${c || ''}${tv}${c ? RESET : ''}${' '.repeat(pad)} ${DIM}\u2502${RESET}`);
  };

  let r = startRow;

  const heading = ' Session Detail ';
  const bLen = paneWidth - 2 - heading.length;
  output += drawLine(r++, `${DIM}\u250C${'\u2500'.repeat(Math.floor(bLen / 2))}${RESET}${BOLD}${CYAN}${heading}${RESET}${DIM}${'\u2500'.repeat(bLen - Math.floor(bLen / 2))}\u2510${RESET}`);

  let sc = GREEN;
  if (proc.isZombie) sc = RED;
  else if (proc.isStopped) sc = YELLOW;
  else if (!proc.isActive) sc = DIM;

  const ctxPct = proc.contextPct !== null ? proc.contextPct : 100;
  const cc = ctxColor(ctxPct, state);

  const inTok = proc.inputTokens != null ? proc.inputTokens.toLocaleString() : '--';
  const cachCreate = proc.cacheCreateTokens != null ? proc.cacheCreateTokens.toLocaleString() : '--';
  const cachRead = proc.cacheReadTokens != null ? proc.cacheReadTokens.toLocaleString() : '--';
  const outTok = proc.outputTokens != null ? proc.outputTokens.toLocaleString() : '--';
  const turnMs = proc.lastTurnMs != null ? (proc.lastTurnMs / 1000).toFixed(1) + 's' : '--';

  let dir = proc.cwd || '--';
  if (dir.startsWith(process.env.HOME)) dir = '~' + dir.substring(process.env.HOME.length);

  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'PID:', proc.pid, CYAN, 'Status:', proc.status, sc);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'CTX:', ctxPct + '%', cc, 'Model:', (proc.model || '--').replace(/^claude-/, ''), CYAN);
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Branch:', proc.gitBranch || '--', YELLOW);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Started:', proc.startTime, '', 'CPU:', proc.cpu.toFixed(1) + '%', proc.cpu > 50 ? RED : proc.cpu > 20 ? YELLOW : '');
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'MEM:', proc.mem.toFixed(1) + '%', '', 'Stat:', proc.stat, DIM);

  if (r < startRow + availRows - 1)
    output += drawLine(r++, `${DIM}\u251C${'\u2500'.repeat(paneWidth - 2)}\u2524${RESET}`);

  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'In:', inTok, '', 'Out:', outTok, GREEN);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Cache W:', cachCreate, '', 'Cache R:', cachRead, '');
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Turn:', turnMs, '', 'Stop:', proc.stopReason || '--', DIM);

  if (r < startRow + availRows - 1) {
    const costStr = formatCost(proc.cost);
    let costColor = GREEN;
    if (proc.cost !== null && proc.cost > 5) costColor = RED;
    else if (proc.cost !== null && proc.cost >= 1) costColor = YELLOW;
    output += fullRow(r++, 'Cost:', costStr, costColor);
  }

  // Context bar
  const CTX_LIMIT = CONFIG.contextLimit;
  const hasTokens = proc.inputTokens != null;
  if (hasTokens && r + 5 < startRow + availRows - 1) {
    const barHeading = ' Context Window ';
    const bhLen = paneWidth - 2 - barHeading.length;
    output += drawLine(r++, `${DIM}\u251C${'\u2500'.repeat(Math.floor(bhLen / 2))}${RESET}${BOLD}${CYAN}${barHeading}${RESET}${DIM}${'\u2500'.repeat(bhLen - Math.floor(bhLen / 2))}\u2524${RESET}`);

    const barW = inner - 2;
    const inp = proc.inputTokens || 0;
    const cw = proc.cacheCreateTokens || 0;
    const cr = proc.cacheReadTokens || 0;
    const out = proc.outputTokens || 0;
    const used = inp + cw + cr;
    const free = Math.max(0, CTX_LIMIT - used);

    let bar;
    const legendChar = CONFIG.contextBarStyle === 'braille' ? '\u28FF' : '\u2588';
    const freeChar = CONFIG.contextBarStyle === 'braille' ? '\u2800' : '\u2591';

    if (CONFIG.contextBarStyle === 'braille') {
      const result = renderContextBarBraille(proc, barW, CONFIG);
      bar = result.bar;
    } else {
      const seg = (v) => Math.max(v > 0 ? 1 : 0, Math.round(v / CTX_LIMIT * barW));
      let sInp = seg(inp);
      let sCw = seg(cw);
      let sCr = seg(cr);
      let sOut = seg(out);
      let sFree = seg(free);
      let total = sInp + sCw + sCr + sOut + sFree;
      if (total > barW) sFree = Math.max(0, sFree - (total - barW));
      else if (total < barW) sFree += (barW - total);

      bar = `${GREEN}${'\u2588'.repeat(sInp)}${RESET}` +
            `${BLUE}${'\u2588'.repeat(sCw)}${RESET}` +
            `${CYAN}${'\u2588'.repeat(sCr)}${RESET}` +
            `${YELLOW}${'\u2588'.repeat(sOut)}${RESET}` +
            `${DIM}${'\u2591'.repeat(sFree)}${RESET}`;
    }
    output += drawLine(r++, `${DIM}\u2502${RESET} ${bar} ${DIM}\u2502${RESET}`);

    const pct = (v) => (v / CTX_LIMIT * 100).toFixed(0) + '%';
    const lPad = (s, w) => s.length >= w ? s.substring(0, w) : s + ' '.repeat(w - s.length);
    const legendW = Math.floor((inner - 2) / 2);
    const l1a = `${GREEN}${legendChar}${RESET} ${DIM}Input${RESET} ${pct(inp)}`;
    const l1b = `${BLUE}${legendChar}${RESET} ${DIM}Cache W${RESET} ${pct(cw)}`;
    const l1aVis = 8 + pct(inp).length;
    const l1bVis = 10 + pct(cw).length;
    output += drawLine(r++, `${DIM}\u2502${RESET} ${l1a}${' '.repeat(Math.max(1, inner - 2 - l1aVis - l1bVis))}${l1b} ${DIM}\u2502${RESET}`);
    const l2a = `${CYAN}${legendChar}${RESET} ${DIM}Cache R${RESET} ${pct(cr)}`;
    const l2b = `${YELLOW}${legendChar}${RESET} ${DIM}Output${RESET} ${pct(out)}`;
    const l2aVis = 10 + pct(cr).length;
    const l2bVis = 9 + pct(out).length;
    output += drawLine(r++, `${DIM}\u2502${RESET} ${l2a}${' '.repeat(Math.max(1, inner - 2 - l2aVis - l2bVis))}${l2b} ${DIM}\u2502${RESET}`);
    const l3 = `${DIM}${freeChar} Free ${pct(free)}${RESET}`;
    const l3Vis = 7 + pct(free).length;
    output += drawLine(r++, `${DIM}\u2502${RESET} ${l3}${' '.repeat(Math.max(0, inner - 2 - l3Vis))} ${DIM}\u2502${RESET}`);
  }

  if (r < startRow + availRows - 1)
    output += drawLine(r++, `${DIM}\u251C${'\u2500'.repeat(paneWidth - 2)}\u2524${RESET}`);

  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Slug:', proc.slug || '--', DIM);
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Session:', proc.sessionId ? proc.sessionId.substring(0, inner - 12) : '--', DIM);
  if (r < startRow + availRows - 1) {
    const maxDir = inner - 6;
    const dirDisplay = dir.length > maxDir ? '...' + dir.substring(dir.length - maxDir + 3) : dir;
    output += fullRow(r++, 'Dir:', dirDisplay, DIM);
  }
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Ver:', proc.version || '--', DIM, 'Tier:', proc.serviceTier || '--', DIM);
  if (r < startRow + availRows - 1)
    output += fullRow(r++, 'Time:', proc.timestamp || '--', DIM);
  if (r < startRow + availRows - 1)
    output += pairRow(r++, 'Stat:', proc.stat, DIM, 'Type:', proc.userType || '--', DIM);

  // Search matches section
  if (state.searchQuery && state.searchResults.has(proc.pid)) {
    const snippets = state.searchResults.get(proc.pid);
    if (r < startRow + availRows - 1) {
      const matchHeading = ' Search Matches ';
      const mhLen = paneWidth - 2 - matchHeading.length;
      output += drawLine(r++, `${DIM}\u251C${'\u2500'.repeat(Math.floor(mhLen / 2))}${RESET}${BOLD}${GREEN}${matchHeading}${RESET}${DIM}${'\u2500'.repeat(mhLen - Math.floor(mhLen / 2))}\u2524${RESET}`);
    }
    for (let si = 0; si < snippets.length && r < startRow + availRows - 1; si++) {
      let snip = snippets[si].replace(/\n/g, ' ');
      const maxSnipLen = inner - 4;
      if (snip.length > maxSnipLen) snip = snip.substring(0, maxSnipLen - 1) + '\u2026';
      const pad = Math.max(0, inner - 2 - snip.length - 2);
      output += drawLine(r++, `${DIM}\u2502${RESET} ${GREEN}\u25B8${RESET} ${snip}${' '.repeat(pad)} ${DIM}\u2502${RESET}`);
    }
  }

  while (r < startRow + availRows - 1) {
    output += drawLine(r++, `${DIM}\u2502${' '.repeat(paneWidth - 2)}\u2502${RESET}`);
  }

  output += drawLine(r, `${DIM}\u2514${'\u2500'.repeat(paneWidth - 2)}\u2518${RESET}`);

  return output;
}

function renderPaneMode(state, CONFIG) {
  const { columns, rows } = process.stdout;
  const THEME = state.THEME;
  const cardWidth = 34;
  const cardHeight = 8;
  const cardGapX = 1;
  const cardGapY = 1;
  const cardsPerRow = getCardsPerRow();
  let output = HOME + HIDE_CURSOR;

  output += renderHeader(columns, state);

  const activeCount = state.allProcesses.filter(p => p.isActive).length;
  const deadCount = state.allProcesses.filter(p => !p.isActive).length;
  const paneTotalCost = state.allProcesses.reduce((sum, p) => sum + (p.cost || 0), 0);
  let statsLine = `${DIM} Active: ${RESET}${GREEN}${activeCount}${RESET}${DIM} | Dead/Stopped: ${RESET}${RED}${deadCount}${RESET}`;
  let paneCostColor = GREEN;
  if (paneTotalCost > 5) paneCostColor = RED;
  else if (paneTotalCost >= 1) paneCostColor = YELLOW;
  statsLine += `${DIM} | Total Cost: ${RESET}${paneCostColor}${formatCost(paneTotalCost > 0 ? paneTotalCost : null)}${RESET}`;
  if (state.sortMode !== 'age') statsLine += `${DIM} | Sort: ${RESET}${CYAN}${state.sortMode}${state.sortReverse ? ' \u2191' : ''}${RESET}`;
  if (state.filterText) statsLine += `${DIM} | Filter: ${RESET}${YELLOW}"${state.filterText}"${RESET}${DIM} (${state.processes.length}/${state.allProcesses.length})${RESET}`;
  if (state.filterInput) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} /${state.filterText}\u2588 ${RESET}`;
  if (state.searchMode) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} Search: ${state.searchQuery}\u2588 ${RESET}`;
  else if (state.searchQuery) statsLine += `${DIM} | Search: ${RESET}${YELLOW}"${state.searchQuery}"${RESET}${DIM} (${state.searchResults.size} matches)${RESET}`;
  const notifLabel = state.notificationsEnabled ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  statsLine += `${DIM} | Notif: ${RESET}${notifLabel}`;
  statsLine += `${DIM} | ${state.lastRefresh.toLocaleTimeString()} ${RESET}`;
  output += statsLine + `${CLR_LINE}\n`;

  if (state.showDashboard) { output += renderDashboard(columns, state); }

  if (state.statusMessage) {
    output += `${YELLOW} ${state.statusMessage}${RESET}${CLR_LINE}\n`;
    state.statusMessage = '';
  }

  output += `${DIM}${'\u2500'.repeat(columns)}${RESET}${CLR_LINE}\n`;

  const totalRows = Math.ceil(state.processes.length / cardsPerRow);
  const headerLines = 6 + (state.showDashboard ? 2 : 0);
  const footerLines = 2;
  const availableSpace = rows - headerLines - footerLines;
  const maxVisibleCardRows = Math.max(1, Math.floor((availableSpace + cardGapY) / (cardHeight + cardGapY)));

  const scrollRow = Math.max(0, state.paneRow - Math.floor(maxVisibleCardRows / 2));
  const endRow = Math.min(totalRows, scrollRow + maxVisibleCardRows);

  if (state.processes.length === 0) {
    output += `${CLR_LINE}\n${DIM}  No Claude Code processes found.${RESET}${CLR_LINE}\n`;
  }

  for (let r = scrollRow; r < endRow; r++) {
    const rowCards = [];
    for (let c = 0; c < cardsPerRow; c++) {
      const idx = r * cardsPerRow + c;
      if (idx < state.processes.length) {
        rowCards.push({ proc: state.processes[idx], idx });
      }
    }

    for (let line = 0; line < cardHeight; line++) {
      let lineStr = '';
      for (let ci = 0; ci < rowCards.length; ci++) {
        const { proc, idx } = rowCards[ci];
        const isSelected = idx === state.selectedIndex;
        const selStart = isSelected ? `${THEME.selection}${WHITE}${BOLD}` : '';
        const selEnd = isSelected ? RESET : RESET;

        let cell = '';
        if (line === 0) {
          cell = `${selStart}\u250C${'\u2500'.repeat(cardWidth - 2)}\u2510${selEnd}`;
        } else if (line === cardHeight - 1) {
          cell = `${selStart}\u2514${'\u2500'.repeat(cardWidth - 2)}\u2518${selEnd}`;
        } else {
          let content = '';
          const inner = cardWidth - 4;
          if (line === 1) {
            let statusColor = isSelected ? '' : THEME.active;
            if (proc.isZombie) statusColor = isSelected ? '' : THEME.zombie;
            else if (proc.isStopped) statusColor = isSelected ? '' : THEME.stopped;
            else if (!proc.isActive) statusColor = isSelected ? '' : THEME.sleeping;
            const statusDot = proc.isActive ? '\u25CF' : proc.isZombie ? '\u2717' : '\u25CB';
            const pidPart = `PID:${proc.pid}`;
            const statusPart = `${statusDot} ${proc.status}`;
            const gap = inner - pidPart.length - proc.status.length - 2;
            content = `${selStart}\u2502 ${pidPart}${' '.repeat(Math.max(1, gap))}${isSelected ? '' : statusColor}${statusPart}${isSelected ? '' : RESET}${selStart} \u2502${selEnd}`;
          } else if (line === 2) {
            const cpuStr = `CPU:${proc.cpu.toFixed(1)}%`;
            const memStr = `MEM:${proc.mem.toFixed(1)}%`;
            const gap = inner - cpuStr.length - memStr.length;
            content = `${selStart}\u2502 ${cpuStr}${' '.repeat(Math.max(1, gap))}${memStr} \u2502${selEnd}`;
          } else if (line === 3) {
            const ctxPct = proc.contextPct !== null ? proc.contextPct : 100;
            const cc = isSelected ? '' : ctxColor(ctxPct, state);
            const ctxLabel = `CTX: ${ctxPct}%`;
            const ctxStr = `${cc}${ctxLabel}${isSelected ? '' : RESET}`;
            content = `${selStart}\u2502 ${ctxStr}${' '.repeat(Math.max(0, inner - ctxLabel.length))} \u2502${selEnd}`;
          } else if (line === 4) {
            const m = proc.model ? proc.model.replace(/^claude-/, '') : '--';
            const b = proc.gitBranch || '--';
            const mLen = Math.min(m.length, Math.floor(inner / 2));
            const bLen = Math.min(b.length, inner - mLen - 1);
            const mStr = m.substring(0, mLen);
            const bStr = b.substring(0, bLen);
            const mbGap = inner - mStr.length - bStr.length;
            const mc = isSelected ? '' : THEME.accent;
            const bc = isSelected ? '' : THEME.stopped;
            content = `${selStart}\u2502 ${mc}${mStr}${isSelected ? '' : RESET}${selStart}${' '.repeat(Math.max(1, mbGap))}${bc}${bStr}${isSelected ? '' : RESET}${selStart} \u2502${selEnd}`;
          } else if (line === 5) {
            let slugStr = proc.slug || '--';
            if (slugStr.length > inner) slugStr = slugStr.substring(0, inner - 1) + '\u2026';
            content = `${selStart}\u2502 ${isSelected ? '' : DIM}${slugStr.padEnd(inner)}${isSelected ? '' : RESET}${selStart} \u2502${selEnd}`;
          } else if (line === 6) {
            let title = proc.title;
            if (title.length > inner) {
              title = title.substring(0, inner - 1) + '\u2026';
            }
            content = `${selStart}\u2502 ${title.padEnd(inner)} \u2502${selEnd}`;
          }
          cell = content;
        }
        lineStr += cell;
        if (ci < rowCards.length - 1) lineStr += ' '.repeat(cardGapX);
      }
      output += lineStr + `${CLR_LINE}\n`;
    }
    if (r < endRow - 1) output += `${CLR_LINE}\n`;
  }

  if (totalRows > maxVisibleCardRows) {
    output += `${CLR_LINE}\n${DIM}  Showing rows ${scrollRow + 1}-${endRow} of ${totalRows}${RESET}${CLR_LINE}`;
  }

  output += CLR_DOWN;

  const paneDetailWidth = 42;
  const showPaneDetail = columns >= 140;
  if (showPaneDetail && state.processes[state.selectedIndex]) {
    const paneStartRow = 5;
    const fLines = 2;
    const availDetailRows = rows - paneStartRow - fLines;
    const paneStartCol = columns - paneDetailWidth;
    output += renderDetailPane(state.processes[state.selectedIndex], paneStartRow, paneStartCol, paneDetailWidth, availDetailRows, state, CONFIG);
  }

  if (!showPaneDetail && state.processes[state.selectedIndex]) {
    const cardRows = Math.ceil(state.processes.length / cardsPerRow);
    const visibleCardRows = Math.min(cardRows, Math.max(1, Math.floor((rows - 6 - 2 + cardGapY) / (cardHeight + cardGapY))));
    const contentEnd = 6 + visibleCardRows * (cardHeight + cardGapY);
    const fLines = 2;
    const bottomPaneStart = contentEnd + 1;
    const availBottomRows = rows - fLines - bottomPaneStart;
    if (availBottomRows >= 8) {
      const bottomPaneWidth = Math.min(columns, 80);
      const bottomPaneCol = Math.max(1, Math.floor((columns - bottomPaneWidth) / 2) + 1);
      output += renderDetailPane(state.processes[state.selectedIndex], bottomPaneStart, bottomPaneCol, bottomPaneWidth, availBottomRows, state, CONFIG);
    }
  }

  output += `${ESC}[${rows - 1};1H`;
  output += `${DIM}${'\u2500'.repeat(columns)}${RESET}${CLR_LINE}`;
  output += `${ESC}[${rows};1H`;
  output += `${BOLD} KEYS:${RESET} `;
  output += `${CYAN}hjkl${RESET} Nav  `;
  output += `${RED}x${RESET} Kill  ${RED}X${RESET} Force  `;
  output += `${CYAN}o${RESET} Open  `;
  output += `${CYAN}s${RESET} Sort  ${CYAN}/${RESET} Filter  ${CYAN}F${RESET} Search  `;
  output += `${CYAN}T${RESET} Theme  ${CYAN}d${RESET} Dash  ${CYAN}n${RESET} Notif  ${CYAN}P${RESET} List  ${CYAN}r${RESET} Refresh  ${CYAN}q${RESET} Quit  ${CYAN}?${RESET} Help${CLR_LINE}`;

  process.stdout.write(output);
}

function renderListMode(state, CONFIG) {
  const { columns, rows } = process.stdout;
  const THEME = state.THEME;
  const detailPaneWidth = 42;
  const showDetailPane = columns >= 140;
  const listWidth = showDetailPane ? columns - detailPaneWidth - 1 : columns;
  let output = HOME + HIDE_CURSOR;

  output += renderHeader(columns, state);

  const activeCount = state.allProcesses.filter(p => p.isActive).length;
  const deadCount = state.allProcesses.filter(p => !p.isActive).length;
  const totalCost = state.allProcesses.reduce((sum, p) => sum + (p.cost || 0), 0);
  let statsLine = `${DIM} Active: ${RESET}${GREEN}${activeCount}${RESET}${DIM} | Dead/Stopped: ${RESET}${RED}${deadCount}${RESET}`;
  let totalCostColor = GREEN;
  if (totalCost > 5) totalCostColor = RED;
  else if (totalCost >= 1) totalCostColor = YELLOW;
  statsLine += `${DIM} | Total Cost: ${RESET}${totalCostColor}${formatCost(totalCost > 0 ? totalCost : null)}${RESET}`;
  if (state.sortMode !== 'age') statsLine += `${DIM} | Sort: ${RESET}${CYAN}${state.sortMode}${state.sortReverse ? ' \u2191' : ''}${RESET}`;
  if (state.filterText) statsLine += `${DIM} | Filter: ${RESET}${YELLOW}"${state.filterText}"${RESET}${DIM} (${state.processes.length}/${state.allProcesses.length})${RESET}`;
  if (state.filterInput) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} /${state.filterText}\u2588 ${RESET}`;
  if (state.searchMode) statsLine += `${DIM} | ${RESET}${BG_BLUE}${WHITE} Search: ${state.searchQuery}\u2588 ${RESET}`;
  else if (state.searchQuery) statsLine += `${DIM} | Search: ${RESET}${YELLOW}"${state.searchQuery}"${RESET}${DIM} (${state.searchResults.size} matches)${RESET}`;
  const notifLabel2 = state.notificationsEnabled ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  statsLine += `${DIM} | Notif: ${RESET}${notifLabel2}`;
  statsLine += `${DIM} | ${state.lastRefresh.toLocaleTimeString()} ${RESET}`;
  output += statsLine + `${CLR_LINE}\n`;

  if (state.showDashboard) { output += renderDashboard(columns, state); }

  if (state.statusMessage) {
    output += `${YELLOW} ${state.statusMessage}${RESET}${CLR_LINE}\n`;
    state.statusMessage = '';
  }

  output += `${DIM}${'\u2500'.repeat(listWidth)}${RESET}${CLR_LINE}\n`;

  const ctxBarMode = listWidth >= 160;
  const ctxColW = ctxBarMode ? 16 : 6;
  const isNarrow = listWidth < 120;
  const showCostCol = listWidth >= 140;
  const costColW = 9;
  const fixedColsTotal = isNarrow
    ? 8 + 10 + ctxColW + 12 + 14 + 7 + 7 + 2
    : 8 + 10 + ctxColW + 12 + 32 + 22 + 14 + (showCostCol ? costColW : 0) + 7 + 7 + 2;
  output += `${BOLD}${CYAN}`;
  if (isNarrow) {
    output += `  ${'PID'.padEnd(8)}${'STATUS'.padEnd(10)}${'CTX'.padEnd(ctxColW)}${'STARTED'.padEnd(12)}${'MODEL'.padEnd(14)}${'CPU%'.padEnd(7)}MEM%`;
  } else {
    output += `  ${'PID'.padEnd(8)}${'STATUS'.padEnd(10)}${'CTX'.padEnd(ctxColW)}${'STARTED'.padEnd(12)}${'BRANCH'.padEnd(32)}${'SLUG'.padEnd(22)}${'MODEL'.padEnd(14)}`;
    if (showCostCol) output += `${'COST'.padEnd(costColW)}`;
    output += `${'DIRECTORY'.padEnd(Math.max(0, listWidth - fixedColsTotal))}${'CPU%'.padEnd(7)}MEM%`;
  }
  output += `${RESET}${CLR_LINE}\n`;
  output += `${DIM}${'\u2500'.repeat(listWidth)}${RESET}${CLR_LINE}\n`;

  const maxVisible = rows - 10 - (state.showDashboard ? 2 : 0);
  const startIdx = Math.max(0, state.selectedIndex - Math.floor(maxVisible / 2));
  const endIdx = Math.min(state.processes.length, startIdx + maxVisible);

  if (state.processes.length === 0) {
    output += `${CLR_LINE}\n${DIM}  No Claude Code processes found.${RESET}${CLR_LINE}\n`;
  }

  for (let i = startIdx; i < endIdx; i++) {
    const proc = state.processes[i];
    const isSelected = i === state.selectedIndex;

    const hasSearchMatch = state.searchQuery && state.searchResults.has(proc.pid);
    if (isSelected) {
      output += `${THEME.selection}${WHITE}${BOLD}> `;
    } else if (hasSearchMatch) {
      output += `${THEME.active}* ${RESET}`;
    } else {
      output += '  ';
    }

    output += `${isSelected ? '' : THEME.accent}${proc.pid.padEnd(8)}`;

    let stClr = THEME.active;
    if (proc.isZombie) stClr = THEME.zombie;
    else if (proc.isStopped) stClr = THEME.stopped;
    else if (!proc.isActive) stClr = THEME.sleeping;
    output += `${isSelected ? '' : stClr}${proc.status.padEnd(10)}${isSelected ? '' : RESET}`;

    const ctxPct = proc.contextPct !== null ? proc.contextPct : 100;
    if (ctxBarMode) {
      const barLen = 10;
      if (CONFIG.contextBarStyle === 'braille') {
        const filledValue = ctxPct / 100;
        const freeValue = 1 - filledValue;
        const cc = isSelected ? '' : ctxColor(ctxPct, state);
        const ccEnd = isSelected ? '' : RESET;
        const brailleBar = renderBrailleBar(
          [{ value: filledValue, color: cc || '' }, { value: freeValue, color: DIM }],
          barLen
        );
        output += `${brailleBar}${ccEnd} ${cc}${(ctxPct + '%').padStart(4)}${ccEnd} `;
      } else {
        const filled = Math.round(ctxPct / 100 * barLen);
        const empty = barLen - filled;
        if (isSelected) {
          output += `${'\u2588'.repeat(filled)}${'\u2591'.repeat(empty)} ${(ctxPct + '%').padStart(4)} `;
        } else {
          const cc = ctxColor(ctxPct, state);
          output += `${cc}${'\u2588'.repeat(filled)}${RESET}${DIM}${'\u2591'.repeat(empty)}${RESET} ${cc}${(ctxPct + '%').padStart(4)}${RESET} `;
        }
      }
    } else {
      if (!isSelected) output += ctxColor(ctxPct, state);
      output += `${(ctxPct + '%').padEnd(6)}`;
      if (!isSelected) output += RESET;
    }

    output += `${proc.startTime.padEnd(12)}`;

    if (!isNarrow) {
      const branchStr = proc.gitBranch || '--';
      output += `${isSelected ? '' : THEME.stopped}${branchStr.substring(0, 31).padEnd(32)}${isSelected ? '' : RESET}`;

      const slugStr = proc.slug || '--';
      output += `${isSelected ? '' : THEME.border}${slugStr.substring(0, 21).padEnd(22)}${isSelected ? '' : RESET}`;
    }

    const modelStr = proc.model ? proc.model.replace(/^claude-/, '') : '--';
    output += `${isSelected ? '' : THEME.accent}${modelStr.substring(0, 13).padEnd(14)}${isSelected ? '' : RESET}`;

    if (showCostCol && !isNarrow) {
      const costStr = formatCost(proc.cost);
      if (!isSelected) {
        if (proc.cost !== null && proc.cost > 5) output += THEME.zombie;
        else if (proc.cost !== null && proc.cost >= 1) output += THEME.stopped;
        else output += THEME.cost;
      }
      output += `${costStr.padEnd(costColW)}`;
      if (!isSelected) output += RESET;
    }

    if (!isNarrow) {
      const dirMaxLen = listWidth - fixedColsTotal;
      let dir = proc.cwd || '';
      if (dir.startsWith(process.env.HOME)) {
        dir = '~' + dir.substring(process.env.HOME.length);
      }
      if (dir.length > dirMaxLen) {
        dir = '...' + dir.substring(dir.length - dirMaxLen + 3);
      }
      output += `${isSelected ? '' : DIM}${dir.padEnd(Math.max(0, dirMaxLen))}${isSelected ? '' : RESET}`;
    }

    const cpuStr = proc.cpu.toFixed(1);
    if (!isSelected) {
      if (proc.cpu > 50) output += RED;
      else if (proc.cpu > 20) output += YELLOW;
    }
    output += `${cpuStr.padEnd(7)}`;
    if (!isSelected) output += RESET;

    output += `${proc.mem.toFixed(1)}`;

    output += `${isSelected ? RESET : ''}${CLR_LINE}\n`;

    if (!showDetailPane && isSelected && (proc.model || proc.stopReason)) {
      let detail = '   ';
      if (proc.model) detail += ` ${CYAN}${proc.model}${RESET}`;
      if (proc.stopReason) detail += `  ${DIM}stop: ${proc.stopReason}${RESET}`;
      output += `${detail}${CLR_LINE}\n`;
    }
  }

  if (state.processes.length > maxVisible) {
    output += `${CLR_LINE}\n${DIM}  Showing ${startIdx + 1}-${endIdx} of ${state.processes.length} processes${RESET}${CLR_LINE}`;
  }

  output += CLR_DOWN;

  if (showDetailPane && state.processes[state.selectedIndex]) {
    const paneStartRow = 5;
    const fLines = 2;
    const availRows = rows - paneStartRow - fLines;
    const paneStartCol = listWidth + 2;
    output += renderDetailPane(state.processes[state.selectedIndex], paneStartRow, paneStartCol, detailPaneWidth, availRows, state, CONFIG);
  }

  if (!showDetailPane && state.processes[state.selectedIndex]) {
    const headerLines = 8;
    const listLines = endIdx - startIdx + (state.processes.length > maxVisible ? 1 : 0);
    let extraLines = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (i === state.selectedIndex && (state.processes[i].model || state.processes[i].stopReason)) extraLines++;
    }
    const contentEnd = headerLines + listLines + extraLines;
    const fLines = 2;
    const bottomPaneStart = contentEnd + 1;
    const availBottomRows = rows - fLines - bottomPaneStart;
    if (availBottomRows >= 8) {
      const bottomPaneWidth = Math.min(columns, 80);
      const bottomPaneCol = Math.max(1, Math.floor((columns - bottomPaneWidth) / 2) + 1);
      output += renderDetailPane(state.processes[state.selectedIndex], bottomPaneStart, bottomPaneCol, bottomPaneWidth, availBottomRows, state, CONFIG);
    }
  }

  output += `${ESC}[${rows - 1};1H`;
  output += `${DIM}${'\u2500'.repeat(columns)}${RESET}${CLR_LINE}`;
  output += `${ESC}[${rows};1H`;
  output += `${BOLD} KEYS:${RESET} `;
  output += `${CYAN}jk${RESET} Nav  `;
  output += `${RED}x${RESET} Kill  ${RED}X${RESET} Force  `;
  output += `${CYAN}o${RESET} Open  `;
  output += `${CYAN}s${RESET} Sort  ${CYAN}/${RESET} Filter  ${CYAN}F${RESET} Search  `;
  output += `${CYAN}T${RESET} Theme  ${CYAN}d${RESET} Dash  ${CYAN}n${RESET} Notif  ${CYAN}P${RESET} Pane  ${CYAN}r${RESET} Refresh  ${CYAN}q${RESET} Quit  ${CYAN}?${RESET} Help${CLR_LINE}`;

  process.stdout.write(output);
}

function render(state, CONFIG) {
  if (state.viewMode === 'pane') return renderPaneMode(state, CONFIG);
  return renderListMode(state, CONFIG);
}

function showHelp(state) {
  const { columns } = process.stdout;
  let output = CLEAR;

  output += renderHeader(columns, state);
  output += '\n';

  output += `${BOLD}NAVIGATION:${RESET}\n`;
  output += `  ${CYAN}\u2191 / k${RESET}     Move selection up\n`;
  output += `  ${CYAN}\u2193 / j${RESET}     Move selection down\n`;
  output += `  ${CYAN}\u2190 / h${RESET}     Move selection left (pane mode)\n`;
  output += `  ${CYAN}\u2192 / l${RESET}     Move selection right (pane mode)\n`;
  output += `  ${CYAN}g${RESET}         Jump to first process\n`;
  output += `  ${CYAN}G${RESET}         Jump to last process\n`;
  output += `  ${CYAN}P${RESET}         Toggle pane/grid view\n\n`;

  output += `${BOLD}ACTIONS:${RESET}\n`;
  output += `  ${CYAN}x${RESET}         Kill selected process (SIGTERM - graceful)\n`;
  output += `  ${CYAN}X${RESET}         Force kill selected process (SIGKILL)\n`;
  output += `  ${CYAN}K${RESET}         Kill ALL Claude processes (with confirmation)\n`;
  output += `  ${CYAN}A${RESET}         Kill ALL stopped/dead processes (with confirmation)\n`;
  output += `  ${CYAN}o${RESET}         Open working directory in file manager\n`;
  output += `  ${CYAN}e${RESET}         Open working directory in editor ($EDITOR or code)\n`;
  output += `  ${CYAN}t${RESET}         Open new terminal tab in working directory\n`;
  output += `  ${CYAN}r${RESET}         Refresh process list\n`;
  output += `  ${CYAN}d${RESET}         Toggle aggregate dashboard stats\n`;
  output += `  ${CYAN}n${RESET}         Toggle desktop notifications on/off\n\n`;

  output += `${BOLD}APPEARANCE:${RESET}\n`;
  output += `  ${CYAN}T${RESET}         Cycle color theme (${THEME_NAMES.join(', ')})\n`;
  output += `  ${DIM}Current:${RESET}  ${state.currentThemeName}\n\n`;

  output += `${BOLD}OTHER:${RESET}\n`;
  output += `  ${CYAN}q / ESC${RESET}   Quit the manager\n`;
  output += `  ${CYAN}?${RESET}         Show this help\n\n`;

  output += `${BOLD}PROCESS STATUS:${RESET}\n`;
  output += `  ${GREEN}ACTIVE${RESET}    Process is running normally\n`;
  output += `  ${YELLOW}STOPPED${RESET}   Process is suspended (can be resumed)\n`;
  output += `  ${RED}ZOMBIE${RESET}    Process has terminated but not reaped\n`;
  output += `  ${DIM}SLEEPING${RESET}  Process is idle/waiting\n\n`;

  output += `${BOLD}SORT & FILTER:${RESET}\n`;
  output += `  ${CYAN}s${RESET}         Cycle sort: age \u2192 cpu \u2192 mem \u2192 context\n`;
  output += `  ${CYAN}S${RESET}         Reverse sort order\n`;
  output += `  ${CYAN}/${RESET}         Start typing to filter (branch, model, dir, slug)\n`;
  output += `  ${CYAN}F${RESET}         Full-text search session content\n`;
  output += `  ${CYAN}ESC${RESET}       Clear active filter or search\n\n`;

  output += `${DIM}Press any key to return...${RESET}`;

  process.stdout.write(output);
}

module.exports = {
  render, renderHeader, renderListMode, renderPaneMode, renderDetailPane,
  renderDashboard, renderBrailleBar, renderContextBarBraille,
  showHelp, getCardsPerRow,
  BRAILLE_FILLS,
};
