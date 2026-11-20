import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeEditorialText } from '../src/editorial-policy.js';

test('hashtags são normalizadas e o limite inclui fonte e hashtags', () => {
  assert.equal(composeEditorialText('Conceitos práticos.', ['Kubernetes', '#CloudNative', 'DevOps']), 'Conceitos práticos.\n\n#Kubernetes #CloudNative #DevOps');
  const suffix = '\n\n#a #b #c\n\nFonte: https://example.com/';
  const exact = composeEditorialText('x'.repeat(3000 - suffix.length), ['a', 'b', 'c'], 'https://example.com/');
  assert.equal(exact.length, 3000);
  assert.throws(() => composeEditorialText('x'.repeat(3001 - suffix.length), ['a', 'b', 'c'], 'https://example.com/'), /3.000/);
  for (const tags of [['a', 'A', 'c'], ['duas palavras', 'b', 'c'], ['a', 'b']]) assert.throws(() => composeEditorialText('Texto', tags), /hashtag/i);
});
