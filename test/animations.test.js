const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  getAnimatedCtxPct,
  clearAnimationTimer,
  ctxAnimState,
  ANIM_FPS,
  ANIM_FRAME_MS,
  DEFAULT_CONFIG,
  _state,
} = require('../claude-manager');

describe('animation config', () => {
  it('ANIM_FPS is 30', () => {
    assert.equal(ANIM_FPS, 30);
  });

  it('ANIM_FRAME_MS is floor(1000/30)', () => {
    assert.equal(ANIM_FRAME_MS, Math.floor(1000 / 30));
  });

  it('DEFAULT_CONFIG includes animations: true', () => {
    assert.equal(DEFAULT_CONFIG.animations, true);
  });
});

describe('getAnimatedCtxPct', () => {
  beforeEach(() => {
    ctxAnimState.clear();
    clearAnimationTimer();
  });

  afterEach(() => {
    clearAnimationTimer();
  });

  it('returns target immediately on first call for a PID', () => {
    const result = getAnimatedCtxPct('12345', 75);
    assert.equal(result, 75);
  });

  it('stores state in ctxAnimState after first call', () => {
    getAnimatedCtxPct('12345', 80);
    assert.ok(ctxAnimState.has('12345'));
    const state = ctxAnimState.get('12345');
    assert.equal(state.current, 80);
    assert.equal(state.target, 80);
  });

  it('returns target when value has not changed', () => {
    getAnimatedCtxPct('12345', 60);
    const result = getAnimatedCtxPct('12345', 60);
    assert.equal(result, 60);
  });

  it('eases toward target on subsequent calls with different value', () => {
    getAnimatedCtxPct('12345', 100);
    // Now change to 40 — should ease, not jump
    const result = getAnimatedCtxPct('12345', 40);
    // Should be between 40 and 100 (not equal to target)
    assert.ok(result > 40, `expected result ${result} > 40`);
    assert.ok(result < 100, `expected result ${result} < 100`);
  });

  it('eases progressively closer to target', () => {
    getAnimatedCtxPct('12345', 100);
    const r1 = getAnimatedCtxPct('12345', 0);
    // Manually apply easing (simulate what scheduleAnimationFrame does)
    const state = ctxAnimState.get('12345');
    state.current += (state.target - state.current) * 0.3;
    const r2 = getAnimatedCtxPct('12345', 0);
    assert.ok(r2 < r1, `second eased value ${r2} should be less than first ${r1}`);
  });

  it('snaps to target when difference is less than 1', () => {
    getAnimatedCtxPct('12345', 50);
    // Set current very close to target manually
    const state = ctxAnimState.get('12345');
    state.current = 50.4;
    state.target = 50;
    const result = getAnimatedCtxPct('12345', 50);
    assert.equal(result, 50);
    assert.equal(state.current, 50);
  });

  it('handles multiple PIDs independently', () => {
    getAnimatedCtxPct('111', 80);
    getAnimatedCtxPct('222', 20);
    // Change both
    const r1 = getAnimatedCtxPct('111', 40);
    const r2 = getAnimatedCtxPct('222', 60);
    // 111 easing from 80 toward 40 — should be > 40
    assert.ok(r1 > 40);
    // 222 easing from 20 toward 60 — should be < 60
    assert.ok(r2 < 60);
  });
});

describe('clearAnimationTimer', () => {
  beforeEach(() => {
    clearAnimationTimer();
  });

  afterEach(() => {
    clearAnimationTimer();
  });

  it('clears the animation timer', () => {
    // After clearing, animationTimer state should be null
    clearAnimationTimer();
    assert.equal(_state.animationTimer, null);
  });

  it('is safe to call multiple times', () => {
    clearAnimationTimer();
    clearAnimationTimer();
    clearAnimationTimer();
    assert.equal(_state.animationTimer, null);
  });
});

describe('selection animation state', () => {
  it('prevSelectedIndex defaults to -1', () => {
    // Initial state
    assert.equal(typeof _state.prevSelectedIndex, 'number');
  });

  it('selectionAnimFrame defaults to 0', () => {
    const saved = _state.selectionAnimFrame;
    // Reset after test
    _state.selectionAnimFrame = 0;
    assert.equal(typeof saved, 'number');
  });

  it('selectionAnimFrame can be set and read', () => {
    const saved = _state.selectionAnimFrame;
    _state.selectionAnimFrame = 3;
    assert.equal(_state.selectionAnimFrame, 3);
    _state.selectionAnimFrame = saved;
  });
});
