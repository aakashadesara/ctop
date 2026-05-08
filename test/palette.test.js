const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fuzzyMatch, fuzzyScore, filterCommands, COMMANDS } = require('../claude-manager');

describe('fuzzyMatch', () => {
  it('matches exact text', () => {
    assert.equal(fuzzyMatch('kill', 'Kill selected process'), true);
  });

  it('matches case-insensitive', () => {
    assert.equal(fuzzyMatch('KILL', 'Kill selected process'), true);
  });

  it('matches subsequence characters in order', () => {
    assert.equal(fuzzyMatch('ksp', 'Kill selected process'), true);
  });

  it('rejects when characters are not in order', () => {
    assert.equal(fuzzyMatch('psk', 'Kill selected process'), false);
  });

  it('rejects non-matching query', () => {
    assert.equal(fuzzyMatch('xyz', 'Kill selected process'), false);
  });

  it('matches empty query against any text', () => {
    assert.equal(fuzzyMatch('', 'anything'), true);
  });

  it('handles single character match', () => {
    assert.equal(fuzzyMatch('q', 'Quit'), true);
  });

  it('rejects single character not present', () => {
    assert.equal(fuzzyMatch('z', 'Quit'), false);
  });
});

describe('fuzzyScore', () => {
  it('returns -1 for non-matching query', () => {
    assert.equal(fuzzyScore('xyz', 'Kill selected process'), -1);
  });

  it('returns positive score for matching query', () => {
    const score = fuzzyScore('kill', 'Kill selected process');
    assert.ok(score > 0);
  });

  it('gives prefix match higher score', () => {
    const prefixScore = fuzzyScore('ki', 'Kill process');
    const midScore = fuzzyScore('ki', 'a kill');
    assert.ok(prefixScore > midScore, `prefix ${prefixScore} should beat mid ${midScore}`);
  });

  it('gives consecutive match higher score', () => {
    const consecutiveScore = fuzzyScore('kill', 'Kill all');
    const scatteredScore = fuzzyScore('kill', 'knit ill');
    assert.ok(consecutiveScore > scatteredScore, `consecutive ${consecutiveScore} should beat scattered ${scatteredScore}`);
  });

  it('returns score for empty query', () => {
    const score = fuzzyScore('', 'anything');
    assert.equal(score, 0);
  });
});

describe('filterCommands', () => {
  it('returns all commands (up to 10) for empty query', () => {
    const results = filterCommands('');
    assert.equal(results.length, 10);
    // Should be the first 10 commands from COMMANDS
    assert.equal(results[0].name, COMMANDS[0].name);
  });

  it('filters commands by fuzzy match', () => {
    const results = filterCommands('kill');
    assert.ok(results.length > 0);
    for (const cmd of results) {
      assert.ok(fuzzyMatch('kill', cmd.name), `${cmd.name} should match "kill"`);
    }
  });

  it('returns empty array for non-matching query', () => {
    const results = filterCommands('zzzzzzz');
    assert.equal(results.length, 0);
  });

  it('sorts results by score (best match first)', () => {
    const results = filterCommands('sort');
    assert.ok(results.length >= 2);
    // Verify scores are in descending order
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score,
        `${results[i - 1].name} (${results[i - 1].score}) should score >= ${results[i].name} (${results[i].score})`);
    }
  });

  it('limits results to 10 items', () => {
    // "s" matches many commands
    const results = filterCommands('s');
    assert.ok(results.length <= 10);
  });

  it('finds Quit command', () => {
    const results = filterCommands('quit');
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, 'Quit');
  });

  it('finds theme command with partial match', () => {
    const results = filterCommands('thm');
    assert.ok(results.length >= 1);
    const hasTheme = results.some(r => r.name === 'Cycle theme');
    assert.ok(hasTheme, 'should find Cycle theme');
  });
});
