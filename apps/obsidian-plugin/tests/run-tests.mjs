#!/usr/bin/env node
/**
 * Standalone test runner for Obsidian Plugin test suites.
 * Executes all 4 test tiers using node:test.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testFiles = [
  join(__dirname, 'tier1-feature.test.mjs'),
  join(__dirname, 'tier2-boundary.test.mjs'),
  join(__dirname, 'tier3-combination.test.mjs'),
  join(__dirname, 'tier4-application.test.mjs')
];

console.log('='.repeat(70));
console.log('PDF2obsidian Obsidian Plugin — 4-Tier Test Runner');
console.log('='.repeat(70));

const child = spawn(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  cwd: join(__dirname, '../../..')
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('\n[PASS] All test tiers completed with 100% pass rate.');
  } else {
    console.error(`\n[FAIL] Test runner exited with code ${code}`);
  }
  process.exit(code ?? 1);
});
