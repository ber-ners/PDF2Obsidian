import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['dev', 'build', 'start'].includes(mode)) throw new Error('Unknown workspace command');
const packages = ['providers', 'core', 'pipeline', 'tasks'];
if (mode !== 'start') {
  for (const name of packages) {
    const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `packages/${name}/tsconfig.json`], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
await import('./prepare-pdf-worker.mjs');
const child = spawn(process.execPath, [fileURLToPath(new URL('../apps/desktop-web/node_modules/next/dist/bin/next', import.meta.url)), mode, ...(mode === 'build' ? [] : ['-H', '127.0.0.1', '-p', '3001'])], { cwd: fileURLToPath(new URL('../apps/desktop-web/', import.meta.url)), stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
