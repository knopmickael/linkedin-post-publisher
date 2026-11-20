import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const failure of ['missing', 'read']) test(`exportação com falha ${failure} não derruba o servidor`, () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/export-probe.ts', failure], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
