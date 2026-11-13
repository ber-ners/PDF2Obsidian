/**
 * Shared workspace path resolution utilities for test suites.
 * Invariant to process.cwd().
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename); // apps/obsidian-plugin/tests/mocks

export const TESTS_DIR = resolve(__dirname, '..');
export const PLUGIN_ROOT = resolve(__dirname, '../..');
export const MONOREPO_ROOT = resolve(__dirname, '../../../..');

export const resolvePlugin = (...segments) => resolve(PLUGIN_ROOT, ...segments);
export const resolveRepo = (...segments) => resolve(MONOREPO_ROOT, ...segments);
