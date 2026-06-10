const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { fullScreenOverlayActive, _state } = require('../claude-manager');

// Regression guard for the heatmap/timeline "flicker away" bug: the spinner and
// animation timers call render() on a cadence, and render() draws the main list/pane
// view. While a full-screen overlay is open, that repaints over it (heatmap/palette)
// or re-CLEARs it (timeline/history/help) every frame. fullScreenOverlayActive() is the
// gate both timers check before rendering — this locks in exactly which modes pause it.

const OVERLAY_FLAGS = ['showingHelp', 'showHistory', 'showTimeline', 'showHeatmap', 'showPalette'];

beforeEach(() => {
  for (const f of OVERLAY_FLAGS) _state[f] = false;
});

describe('fullScreenOverlayActive', () => {
  it('is false when no overlay is open (timers render normally)', () => {
    assert.equal(fullScreenOverlayActive(), false);
  });

  for (const flag of OVERLAY_FLAGS) {
    it(`is true while ${flag} is open (timers must not repaint over it)`, () => {
      _state[flag] = true;
      assert.equal(fullScreenOverlayActive(), true);
    });
  }

  it('goes back to false once the overlay closes', () => {
    _state.showHeatmap = true;
    assert.equal(fullScreenOverlayActive(), true);
    _state.showHeatmap = false;
    assert.equal(fullScreenOverlayActive(), false);
  });
});
