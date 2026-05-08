const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatStartTime, ctxColor, _colors } = require('../claude-manager');

describe('formatStartTime', () => {
  it('returns "just now" for a date less than 1 minute ago', () => {
    const now = new Date();
    assert.equal(formatStartTime(now), 'just now');
  });

  it('returns "just now" for a date 30 seconds ago', () => {
    const date = new Date(Date.now() - 30 * 1000);
    assert.equal(formatStartTime(date), 'just now');
  });

  it('returns "Xm ago" for a date minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    assert.equal(formatStartTime(date), '5m ago');
  });

  it('returns "1m ago" for exactly 1 minute ago', () => {
    const date = new Date(Date.now() - 60 * 1000);
    assert.equal(formatStartTime(date), '1m ago');
  });

  it('returns "Xh ago" for a date hours ago', () => {
    const date = new Date(Date.now() - 3 * 3600 * 1000);
    assert.equal(formatStartTime(date), '3h ago');
  });

  it('returns "1h ago" for exactly 1 hour ago', () => {
    const date = new Date(Date.now() - 3600 * 1000);
    assert.equal(formatStartTime(date), '1h ago');
  });

  it('returns "Xd ago" for a date days ago', () => {
    const date = new Date(Date.now() - 2 * 86400 * 1000);
    assert.equal(formatStartTime(date), '2d ago');
  });

  it('returns "1d ago" for exactly 1 day ago', () => {
    const date = new Date(Date.now() - 86400 * 1000);
    assert.equal(formatStartTime(date), '1d ago');
  });

  it('prioritises days over hours', () => {
    // 1 day and 5 hours -> should say "1d ago"
    const date = new Date(Date.now() - (86400 + 5 * 3600) * 1000);
    assert.equal(formatStartTime(date), '1d ago');
  });
});

describe('ctxColor', () => {
  it('returns RED for pct < 10', () => {
    assert.equal(ctxColor(0), _colors.RED);
    assert.equal(ctxColor(5), _colors.RED);
    assert.equal(ctxColor(9), _colors.RED);
  });

  it('returns ORANGE for 10 <= pct < 40', () => {
    assert.equal(ctxColor(10), _colors.ORANGE);
    assert.equal(ctxColor(25), _colors.ORANGE);
    assert.equal(ctxColor(39), _colors.ORANGE);
  });

  it('returns YELLOW for 40 <= pct < 70', () => {
    assert.equal(ctxColor(40), _colors.YELLOW);
    assert.equal(ctxColor(55), _colors.YELLOW);
    assert.equal(ctxColor(69), _colors.YELLOW);
  });

  it('returns GREEN for pct >= 70', () => {
    assert.equal(ctxColor(70), _colors.GREEN);
    assert.equal(ctxColor(85), _colors.GREEN);
    assert.equal(ctxColor(100), _colors.GREEN);
  });
});
