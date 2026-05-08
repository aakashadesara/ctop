const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { parseMouseEvent, listViewRowToIndex, _state } = require('../claude-manager');

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
