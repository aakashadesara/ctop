const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMouseEvent,
  listViewRowToIndex,
  chooseFooterShortcuts,
  renderFooterShortcuts,
  findFooterShortcutAt,
  renderConfirmPrompt,
  findConfirmChoiceAt,
  _state,
} = require('../claude-manager');

describe('parseMouseEvent', () => {
  it('parses left click press', () => {
    // SGR format: \x1b[<0;10;5M  (button 0 = left, col 10, row 5, M = press)
    const evt = parseMouseEvent('\x1b[<0;10;5M');
    assert.ok(evt);
    assert.equal(evt.button, 0);
    assert.equal(evt.col, 10);
    assert.equal(evt.row, 5);
    assert.equal(evt.isRelease, false);
    assert.equal(evt.isScroll, false);
  });

  it('parses right click press', () => {
    // button 2 = right click
    const evt = parseMouseEvent('\x1b[<2;20;15M');
    assert.ok(evt);
    assert.equal(evt.button, 2);
    assert.equal(evt.col, 20);
    assert.equal(evt.row, 15);
    assert.equal(evt.isRelease, false);
    assert.equal(evt.isScroll, false);
  });

  it('parses scroll up', () => {
    // button 64 = scroll up (64 & 3 = 0 for button, 64 set for scroll)
    const evt = parseMouseEvent('\x1b[<64;10;5M');
    assert.ok(evt);
    assert.equal(evt.isScroll, true);
    assert.equal(evt.scrollUp, true);
    assert.equal(evt.scrollDown, false);
  });

  it('parses scroll down', () => {
    // button 65 = scroll down (64 + 1; 64 set for scroll, bit 0 set for down)
    const evt = parseMouseEvent('\x1b[<65;10;5M');
    assert.ok(evt);
    assert.equal(evt.isScroll, true);
    assert.equal(evt.scrollUp, false);
    assert.equal(evt.scrollDown, true);
  });

  it('parses release event', () => {
    // lowercase 'm' = release
    const evt = parseMouseEvent('\x1b[<0;10;5m');
    assert.ok(evt);
    assert.equal(evt.button, 0);
    assert.equal(evt.isRelease, true);
  });

  it('returns null for invalid input', () => {
    assert.equal(parseMouseEvent('hello'), null);
    assert.equal(parseMouseEvent('\x1b[A'), null);  // arrow key
    assert.equal(parseMouseEvent(''), null);
    assert.equal(parseMouseEvent('j'), null);
  });
});

describe('listViewRowToIndex', () => {
  beforeEach(() => {
    _state.selectedIndex = 0;
    _state.showDashboard = false;
    _state.viewMode = 'list';
    _state.processes = [];
    _state.allProcesses = [];
  });

  it('maps header rows to -1', () => {
    // Rows 1-7 are header (border, title, border, stats, sep, col headers, sep)
    // With dashboard off, headerLines = 7; data starts at row 8 (1-based)
    // listViewRowToIndex: dataRow = row - 7 - 1 = row - 8
    // Row 1 => dataRow = -7 => -1
    assert.equal(listViewRowToIndex(1), -1);
    assert.equal(listViewRowToIndex(7), -1);
  });

  it('maps first data row to startIdx', () => {
    // With selectedIndex=0 and enough terminal rows, startIdx=0
    // First data row is row 8 (1-based) => dataRow = 8 - 7 - 1 = 0 => index 0
    _state.selectedIndex = 0;
    const idx = listViewRowToIndex(8);
    assert.equal(idx, 0);
  });

  it('maps subsequent rows correctly', () => {
    _state.selectedIndex = 0;
    // Row 9 => dataRow = 1 => index 1
    assert.equal(listViewRowToIndex(9), 1);
    // Row 10 => dataRow = 2 => index 2
    assert.equal(listViewRowToIndex(10), 2);
  });

  it('accounts for dashboard offset', () => {
    _state.showDashboard = true;
    // With dashboard, headerLines = 9; data starts at row 10
    // Row 10 => dataRow = 10 - 9 - 1 = 0 => index 0
    assert.equal(listViewRowToIndex(10), 0);
    // Row 8 is now in the header area
    assert.equal(listViewRowToIndex(8), -1);
  });
});

describe('clickable footer shortcuts', () => {
  beforeEach(() => {
    _state.footerHitboxes = [];
    _state.confirmHitboxes = [];
    _state.confirmMessage = '';
  });

  it('always keeps help visible even at tiny widths', () => {
    const visible = chooseFooterShortcuts(12).map(s => s.key);
    assert.ok(visible.includes('?'));
  });

  it('includes purge stopped/dead shortcut at normal widths', () => {
    const visible = chooseFooterShortcuts(120).map(s => s.key);
    assert.ok(visible.includes('A'));
  });

  it('drops low-priority shortcuts before high-priority shortcuts on narrow widths', () => {
    const visible = chooseFooterShortcuts(60).map(s => s.key);
    assert.ok(visible.includes('?'));
    assert.ok(visible.includes('x'));
    assert.ok(visible.includes('A'));
    assert.equal(visible.includes('T'), false);
  });

  it('maps a footer token hitbox to the dispatched key', () => {
    renderFooterShortcuts(120, 24);
    const hitbox = _state.footerHitboxes.find(hit => hit.key === 'A');
    assert.ok(hitbox);

    const hit = findFooterShortcutAt(24, hitbox.colStart);
    assert.ok(hit);
    assert.equal(hit.key, 'A');
  });

  it('does not map clicks outside footer hitboxes', () => {
    renderFooterShortcuts(120, 24);
    assert.equal(findFooterShortcutAt(23, 1), null);
  });
});

describe('clickable confirmation prompt', () => {
  beforeEach(() => {
    _state.confirmHitboxes = [];
    _state.confirmMessage = '';
  });

  it('maps yes and no prompt buttons to confirmation keys', () => {
    _state.confirmMessage = 'Kill ALL 2 stopped/dead processes?';
    renderConfirmPrompt(80, 22);

    const yes = _state.confirmHitboxes.find(hit => hit.key === 'y');
    const no = _state.confirmHitboxes.find(hit => hit.key === 'n');
    assert.ok(yes);
    assert.ok(no);

    assert.equal(findConfirmChoiceAt(22, yes.colStart).key, 'y');
    assert.equal(findConfirmChoiceAt(22, no.colStart).key, 'n');
  });

  it('does not map clicks outside the prompt buttons', () => {
    _state.confirmMessage = 'Kill ALL 2 stopped/dead processes?';
    renderConfirmPrompt(80, 22);
    assert.equal(findConfirmChoiceAt(22, 1), null);
  });
});
