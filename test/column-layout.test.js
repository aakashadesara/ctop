const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getTitleColumnWidth } = require('../claude-manager');

describe('getTitleColumnWidth', () => {
  it('collapses a placeholder-only title/slug column to its header width', () => {
    const processes = [
      { sessionTitle: null, slug: null },
      { sessionTitle: null, slug: '--' },
      { sessionTitle: null, slug: '-' },
    ];

    assert.equal(getTitleColumnWidth(processes), 'TITLE'.length + 1);
  });

  it('keeps the full width when any process has a title or slug', () => {
    assert.equal(getTitleColumnWidth([
      { sessionTitle: null, slug: null },
      { sessionTitle: null, slug: 'fix-directory-column' },
    ]), 22);

    assert.equal(getTitleColumnWidth([
      { sessionTitle: 'Readable session name', slug: null },
    ]), 22);
  });
});
