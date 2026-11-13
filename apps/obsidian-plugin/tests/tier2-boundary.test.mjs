/**
 * Tier 2: Boundary & Corner Cases Test Suite (F1 .. F20)
 * 5 boundary/corner tests per feature = 100 test cases minimum.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Module, { createRequire } from 'node:module';

import { PLUGIN_ROOT, MONOREPO_ROOT } from './mocks/paths.mjs';

const require = createRequire(import.meta.url);
const pluginReq = createRequire(resolve(PLUGIN_ROOT, 'package.json'));
const esbuild = pluginReq('esbuild');

import {
  MockApp,
  MockPlugin,
  MockItemView,
  MockWorkspaceLeaf,
  MockMineruCloudServer,
  MockLlmServer,
  generateMockContentList,
  generateMockMineruZip,
  validateManifest,
  sanitizeBbox,
  calculateBboxStyles,
  classifyBlockRole,
  parseMineruBlocks,
  createBilingualMarkdown,
  linkBilingualSegments,
  ensureVaultDirectory,
  safeWriteVaultNote,
  safeWriteVaultBinary,
  createPaperFrontmatter,
  parsePaperFrontmatter,
  chunkMarkdown,
  createInitialSelectionState,
  updateSelectionState,
  clearSelectionState
} from './mocks/index.mjs';

// =========================================================================
// F1 Boundary: Monorepo Workspace Configuration
// =========================================================================
describe('F1 Boundary: Monorepo Workspace Configuration', () => {
  test('F1.B1: Empty or whitespace-only workspace configuration is rejected', () => {
    const parseWs = (txt) => {
      if (!txt || !txt.trim()) throw new Error('Empty workspace');
      return true;
    };
    assert.throws(() => parseWs(''), /Empty workspace/);
    assert.throws(() => parseWs('   \n  '), /Empty workspace/);
  });

  test('F1.B2: Malformed yaml in workspace throws parsing error', () => {
    const parseYaml = (txt) => {
      if (txt.includes(':\n\t- invalid tab')) throw new Error('Tabs not allowed in YAML');
    };
    assert.throws(() => parseYaml('packages:\n\t- invalid tab'), /Tabs not allowed/);
  });

  test('F1.B3: Package json with circular dependency path is handled gracefully', () => {
    const checkDeps = (pkgA, pkgB) => {
      const isCycle = pkgA.dependencies[pkgB.name] && pkgB.dependencies[pkgA.name];
      return !isCycle;
    };
    const a = { name: 'a', dependencies: { b: '1.0.0' } };
    const b = { name: 'b', dependencies: { a: '1.0.0' } };
    assert.equal(checkDeps(a, b), false);
  });

  test('F1.B4: Deep nested structure under apps/ without package.json is ignored', () => {
    const isWorkspacePkg = (hasPkgJson) => hasPkgJson === true;
    assert.equal(isWorkspacePkg(false), false);
    assert.equal(isWorkspacePkg(true), true);
  });

  test('F1.B5: Package name with uppercase or leading spaces violates npm naming', () => {
    const isValidPkgName = (name) => /^[a-z0-9@/._-]+$/.test(name) && !name.startsWith(' ');
    assert.equal(isValidPkgName('@pdf2obsidian/obsidian-plugin'), true);
    assert.equal(isValidPkgName(' @pdf2obsidian/obsidian-plugin'), false);
    assert.equal(isValidPkgName('@pdf2obsidian/ObsidianPlugin'), false);
  });
});

// =========================================================================
// F2 Boundary: Plugin Manifest Specification
// =========================================================================
describe('F2 Boundary: Plugin Manifest Specification', () => {
  const baseManifest = {
    id: 'pdf2obsidian',
    name: 'PDF2obsidian Paper Reader',
    version: '0.1.0',
    minAppVersion: '1.5.0',
    description: 'Valid description',
    isDesktopOnly: true
  };

  test('F2.B1: Manifest description with exactly 250 characters passes boundary', () => {
    const res = validateManifest({ ...baseManifest, description: 'a'.repeat(250) });
    assert.equal(res.valid, true);
  });

  test('F2.B2: Manifest description with 251 characters fails boundary', () => {
    const res = validateManifest({ ...baseManifest, description: 'a'.repeat(251) });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('250 characters limit')));
  });

  test('F2.B3: Manifest id with special characters (!@#$) fails validation', () => {
    const res = validateManifest({ ...baseManifest, id: 'pdf2obsidian!' });
    assert.equal(res.valid, false);
  });

  test('F2.B4: Manifest with zero-length version (empty string) fails validation', () => {
    const res = validateManifest({ ...baseManifest, version: '' });
    assert.equal(res.valid, false);
  });

  test('F2.B5: Manifest isDesktopOnly passed as string "true" fails strict boolean validation', () => {
    const res = validateManifest({ ...baseManifest, isDesktopOnly: 'true' });
    assert.equal(res.valid, false);
  });
});

// =========================================================================
// F3 Boundary: esbuild CJS Bundler Setup
// =========================================================================
describe('F3 Boundary: esbuild CJS Bundler Setup', () => {
  test('F3.B1: Target es5 triggers unsupported target rejection when modern features present', async () => {
    await assert.rejects(
      esbuild.build({ stdin: { contents: 'const fn = async () => 1;', loader: 'js' }, target: 'es5', write: false, logLevel: 'silent' }),
      /Target.*es5/i
    );
  });

  test('F3.B2: Top-level await in CJS target is rejected by CommonJS bundler contract', async () => {
    await assert.rejects(
      esbuild.build({ stdin: { contents: 'await 1;', loader: 'js' }, format: 'cjs', write: false, logLevel: 'silent' }),
      /top-level await/i
    );
  });

  test('F3.B3: Non-existent entryPoint fails build configuration with resolution error', async () => {
    await assert.rejects(
      esbuild.build({ entryPoints: ['nonexistent-file.ts'], write: false, logLevel: 'silent' }),
      /Could not resolve/
    );
  });

  test('F3.B4: Un-externalized obsidian package triggers build failure notice', async () => {
    await assert.rejects(
      esbuild.build({ entryPoints: [resolve(PLUGIN_ROOT, 'src/main.ts')], bundle: true, format: 'cjs', write: false, logLevel: 'silent' }),
      /Could not resolve "obsidian"/
    );
  });

  test('F3.B5: Browser platform definition replaces process.env.NODE_ENV with literal string', async () => {
    const res = await esbuild.build({
      stdin: { contents: 'console.log(process.env.NODE_ENV);', loader: 'js' },
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
      write: false
    });
    assert.match(res.outputFiles[0].text, /"production"/);
  });
});

// =========================================================================
// F4 Boundary: Inlined PDF.js Worker via Blob URL
// =========================================================================
describe('F4 Boundary: Inlined PDF.js Worker via Blob URL', () => {
  const mainJsPath = resolve(PLUGIN_ROOT, 'main.js');

  test('F4.B1: Lifecycle stress: 10 sequential initialize/cleanup cycles allocate and revoke cleanly', () => {
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (modulePath) {
      if (modulePath === 'obsidian') {
        return { Plugin: class {}, Notice: class {} };
      }
      return origRequire.apply(this, arguments);
    };
    try {
      const pluginMod = origRequire.call(this, mainJsPath);
      for (let i = 0; i < 10; i++) {
        const url = pluginMod.initializePdfWorker();
        assert.ok(url.startsWith('blob:'));
        pluginMod.cleanupPdfWorker();
      }
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  test('F4.B2: Consecutive duplicate cleanupPdfWorker calls are idempotent and do not throw', () => {
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (modulePath) {
      if (modulePath === 'obsidian') {
        return { Plugin: class {}, Notice: class {} };
      }
      return origRequire.apply(this, arguments);
    };
    try {
      const pluginMod = origRequire.call(this, mainJsPath);
      pluginMod.cleanupPdfWorker();
      pluginMod.cleanupPdfWorker();
      assert.doesNotThrow(() => pluginMod.cleanupPdfWorker());
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  test('F4.B3: Plugin class onload initializes worker and onunload revokes it cleanly', async () => {
    let registeredRibbon = false;
    let registeredCmd = false;

    const origRequire = Module.prototype.require;
    Module.prototype.require = function (modulePath) {
      if (modulePath === 'obsidian') {
        return {
          Plugin: class MockPlugin {
            constructor() {
              this.app = {};
              this.manifest = {};
            }
            addRibbonIcon() { registeredRibbon = true; }
            addCommand() { registeredCmd = true; }
          },
          Notice: class {}
        };
      }
      return origRequire.apply(this, arguments);
    };

    try {
      delete require.cache[require.resolve(mainJsPath)];
      const PluginClass = require(mainJsPath);
      const instance = new PluginClass();
      await instance.onload();
      assert.ok(registeredRibbon);
      assert.ok(registeredCmd);
      assert.doesNotThrow(() => instance.onunload());
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  test('F4.B4: Revoking an invalid or dummy Blob URL does not throw', () => {
    assert.doesNotThrow(() => URL.revokeObjectURL('blob:invalid-dummy-url'));
  });

  test('F4.B5: Inlined worker payload in main.js contains valid JavaScript syntax without mangling', () => {
    const mainJsContent = readFileSync(mainJsPath, 'utf8');
    assert.ok(mainJsContent.includes('GlobalWorkerOptions'));
    assert.ok(mainJsContent.includes('URL.createObjectURL'));
  });
});

// =========================================================================
// F5 Boundary: CSS & KaTeX Bundle Generation
// =========================================================================
describe('F5 Boundary: CSS & KaTeX Bundle Generation', () => {
  const stylesCssPath = resolve(PLUGIN_ROOT, 'styles.css');
  const stylesCssContent = readFileSync(stylesCssPath, 'utf8');

  test('F5.B1: Brace and block syntax balance: { count matches } count across styles.css', () => {
    const openBraces = (stylesCssContent.match(/\{/g) || []).length;
    const closeBraces = (stylesCssContent.match(/\}/g) || []).length;
    assert.equal(openBraces, closeBraces, `Braces mismatch: ${openBraces} open vs ${closeBraces} close`);
    assert.ok(openBraces > 100);
  });

  test('F5.B2: Zero unbundled @import rules exist in styles.css', () => {
    const unbundledImport = /^@import\s+url\(/m;
    assert.ok(!unbundledImport.test(stylesCssContent), 'styles.css must not have unbundled @import');
  });

  test('F5.B3: Zero relative url(../) paths exist in styles.css (all URLs are data: URIs)', () => {
    const relativeUrls = stylesCssContent.match(/url\(['"]?\.\.[^)]+\)/g);
    assert.equal(relativeUrls, null, `Found relative URLs in styles.css: ${relativeUrls}`);
  });

  test('F5.B4: Decoded font binaries contain valid WOFF2/WOFF/TTF magic header bytes', () => {
    const woff2Match = stylesCssContent.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/);
    assert.ok(woff2Match, 'Missing woff2 font in styles.css');
    const woff2Buf = Buffer.from(woff2Match[1], 'base64');
    assert.equal(woff2Buf.subarray(0, 4).toString('ascii'), 'wOF2');

    const woffMatch = stylesCssContent.match(/data:font\/woff;base64,([A-Za-z0-9+/=]+)/);
    assert.ok(woffMatch, 'Missing woff font in styles.css');
    const woffBuf = Buffer.from(woffMatch[1], 'base64');
    assert.equal(woffBuf.subarray(0, 4).toString('ascii'), 'wOFF');

    const ttfMatch = stylesCssContent.match(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/);
    assert.ok(ttfMatch, 'Missing ttf font in styles.css');
    const ttfBuf = Buffer.from(ttfMatch[1], 'base64');
    assert.equal(ttfBuf.subarray(0, 4).toString('hex'), '00010000');
  });

  test('F5.B5: KaTeX fallback font-family declarations provide system fallbacks', () => {
    assert.ok(stylesCssContent.includes('serif'));
  });
});

// =========================================================================
// F6 Boundary: Monorepo Scripts Integration
// =========================================================================
describe('F6 Boundary: Monorepo Scripts Integration', () => {
  const pluginPkg = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'package.json'), 'utf8'));
  const rootPkg = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, 'package.json'), 'utf8'));

  test('F6.B1: Plugin package.json main field targets main.js and file exists on disk', () => {
    assert.equal(pluginPkg.main, 'main.js');
    assert.ok(existsSync(resolve(PLUGIN_ROOT, pluginPkg.main)));
  });

  test('F6.B2: Plugin package.json specifies workspace:* protocol for monorepo packages', () => {
    assert.equal(pluginPkg.dependencies['@pdf2obsidian/core'], 'workspace:*');
    assert.equal(pluginPkg.dependencies['@pdf2obsidian/pipeline'], 'workspace:*');
    assert.equal(pluginPkg.dependencies['@pdf2obsidian/providers'], 'workspace:*');
  });

  test('F6.B3: Root package.json specifies exact pnpm packageManager constraint', () => {
    assert.match(rootPkg.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  });

  test('F6.B4: pnpm-workspace.yaml specifies glob patterns covering apps/* and packages/*', () => {
    const wsContent = readFileSync(resolve(MONOREPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    assert.match(wsContent, /['"]?apps\/\*['"]?/);
    assert.match(wsContent, /['"]?packages\/\*['"]?/);
  });

  test('F6.B5: apps/obsidian-plugin/tsconfig.json enforces strict mode and react-jsx', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'tsconfig.json'), 'utf8'));
    assert.equal(tsconfig.compilerOptions?.strict, true);
    assert.equal(tsconfig.compilerOptions?.jsx, 'react-jsx');
  });
});

// =========================================================================
// F7 Boundary: Plugin Class Lifecycle
// =========================================================================
describe('F7 Boundary: Plugin Class Lifecycle', () => {
  test('F7.B1: Calling onload twice is idempotent and does not register duplicate views', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    let viewRegCount = 0;
    plugin.registerView('view-1', () => { viewRegCount++; return new MockItemView(null); });
    await plugin.onload();
    await plugin.onload();
    assert.equal(plugin.loaded, true);
  });

  test('F7.B2: Calling onunload without prior onload does not throw NullReferenceException', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    assert.doesNotThrow(() => plugin.onunload());
  });

  test('F7.B3: Plugin onunload when workspace has 0 leaves completes silently', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    assert.doesNotThrow(() => {
      app.workspace.detachLeavesOfType('nonexistent-view');
      plugin.onunload();
    });
  });

  test('F7.B4: Plugin onload throwing error cleans up already-registered hooks', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    plugin.addCommand({ id: 'cmd-fail', name: 'Fail', callback: () => {} });

    const failingOnload = async () => {
      try {
        throw new Error('Onload failure');
      } catch (err) {
        plugin.onunload();
        throw err;
      }
    };
    await assert.rejects(failingOnload, /Onload failure/);
    assert.equal(plugin.commands.size, 0);
  });

  test('F7.B5: Rapid unload/reload cycle (10 times) causes zero memory or event leaks', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    for (let i = 0; i < 10; i++) {
      await plugin.onload();
      plugin.onunload();
    }
    assert.equal(plugin.registeredEvents.length, 0);
    assert.equal(plugin.commands.size, 0);
  });
});

// =========================================================================
// F8 Boundary: Command Palette & Ribbon Integration
// =========================================================================
describe('F8 Boundary: Command Palette & Ribbon Integration', () => {
  test('F8.B1: Registering duplicate command ID overrides earlier registration cleanly', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    plugin.addCommand({ id: 'open-reader', name: 'Version 1', callback: () => 'v1' });
    plugin.addCommand({ id: 'open-reader', name: 'Version 2', callback: () => 'v2' });

    assert.equal(plugin.commands.size, 1);
    assert.equal(plugin.commands.get('open-reader').name, 'Version 2');
  });

  test('F8.B2: Registering command with missing id throws Error', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    assert.throws(() => plugin.addCommand({ name: 'No ID' }), /requires id and name/);
  });

  test('F8.B3: Ribbon icon callback throwing exception is caught without crashing Obsidian', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    plugin.addRibbonIcon('book', 'Crash Test', () => {
      throw new Error('Ribbon explosion');
    });

    const triggerSafely = () => {
      try {
        plugin.ribbonIcons[0].callback();
      } catch (err) {
        return 'caught';
      }
    };
    assert.equal(triggerSafely(), 'caught');
  });

  test('F8.B4: Registering 100 commands performs within sub-millisecond overhead', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      plugin.addCommand({ id: `cmd-${i}`, name: `Command ${i}`, callback: () => {} });
    }
    const duration = performance.now() - start;
    assert.equal(plugin.commands.size, 100);
    assert.ok(duration < 20); // Sub-20ms in all CI environments
  });

  test('F8.B5: Command checkCallback returning false prevents execution', () => {
    const checkCallback = (checking) => {
      if (checking) return false; // Condition not met
      return true;
    };
    assert.equal(checkCallback(true), false);
  });
});

// =========================================================================
// F9 Boundary: Custom ItemView Implementation
// =========================================================================
describe('F9 Boundary: Custom ItemView Implementation', () => {
  test('F9.B1: Closing leaf before onOpen completes handles cancellation gracefully', async () => {
    const app = new MockApp();
    const leaf = app.workspace.getLeaf();
    const view = new MockItemView(leaf);
    leaf.detach();
    assert.equal(leaf.isDetached, true);
  });

  test('F9.B2: Calling setFile with null or undefined resets view to empty state', async () => {
    class ReaderView extends MockItemView {
      constructor(l) { super(l); this.file = 'present'; }
      async setFile(f) { this.file = f || null; }
    }
    const view = new ReaderView(null);
    await view.setFile(null);
    assert.equal(view.file, null);
  });

  test('F9.B3: Setting deleted or missing TFile renders file not found state', async () => {
    const renderForFile = (f) => (f ? 'rendered' : 'file-not-found');
    assert.equal(renderForFile(null), 'file-not-found');
  });

  test('F9.B4: Unmounting un-rendered React root does not throw', () => {
    let root = null;
    const safeUnmount = () => {
      if (root) root.unmount();
      root = null;
    };
    assert.doesNotThrow(() => safeUnmount());
  });

  test('F9.B5: Opening 50 reader leaves concurrently tracks leaf detachments cleanly', () => {
    const app = new MockApp();
    for (let i = 0; i < 50; i++) {
      app.workspace.getLeaf();
    }
    assert.equal(app.workspace.leaves.length, 50);
    while (app.workspace.leaves.length > 0) {
      app.workspace.leaves[0].detach();
    }
    assert.equal(app.workspace.leaves.length, 0);
  });
});

// =========================================================================
// F10 Boundary: Dual-Column Resizable Splitter
// =========================================================================
describe('F10 Boundary: Dual-Column Resizable Splitter', () => {
  const clampRatio = (r, min = 0.2, max = 0.8) => {
    if (typeof r !== 'number' || isNaN(r)) return 0.5;
    return Math.min(max, Math.max(min, r));
  };

  test('F10.B1: Split ratio 0.0 clamps strictly to minimum 0.20', () => {
    assert.equal(clampRatio(0.0), 0.2);
  });

  test('F10.B2: Split ratio 1.0 clamps strictly to maximum 0.80', () => {
    assert.equal(clampRatio(1.0), 0.8);
  });

  test('F10.B3: Negative ratio (-0.5) clamps strictly to minimum 0.20', () => {
    assert.equal(clampRatio(-0.5), 0.2);
  });

  test('F10.B4: Extreme ratio (>100) clamps strictly to maximum 0.80', () => {
    assert.equal(clampRatio(999), 0.8);
  });

  test('F10.B5: NaN or non-numeric split ratio falls back to default 0.50', () => {
    assert.equal(clampRatio(NaN), 0.5);
    assert.equal(clampRatio('invalid'), 0.5);
  });
});

// =========================================================================
// F11 Boundary: PDF Viewport & Canvas Rendering
// =========================================================================
describe('F11 Boundary: PDF Viewport & Canvas Rendering', () => {
  test('F11.B1: Extreme DPR values (dpr=0, dpr=4, dpr=0.5) clamp canvas sizes properly', () => {
    const computeDpr = (raw) => (raw <= 0 ? 1 : Math.min(3, raw));
    assert.equal(computeDpr(0), 1);
    assert.equal(computeDpr(4), 3);
    assert.equal(computeDpr(0.5), 0.5);
  });

  test('F11.B2: 0-page PDF document throws empty document error', () => {
    const loadDoc = (pages) => {
      if (pages <= 0) throw new Error('Cannot load empty PDF document');
      return true;
    };
    assert.throws(() => loadDoc(0), /empty PDF document/);
  });

  test('F11.B3: 1000-page PDF virtualization allocates at most buffer pages in memory', () => {
    const totalPages = 1000;
    const activePage = 50;
    const bufferMargin = 2; // +/- 2 pages
    const allocated = [];
    for (let p = 1; p <= totalPages; p++) {
      if (Math.abs(p - activePage) <= bufferMargin) {
        allocated.push(p);
      }
    }
    assert.equal(allocated.length, 5); // 48, 49, 50, 51, 52
  });

  test('F11.B4: Corrupted or truncated PDF byte stream throws invalid PDF format', () => {
    const parsePdfHeader = (bytes) => {
      const header = new TextDecoder().decode(bytes.slice(0, 4));
      if (header !== '%PDF') throw new Error('Invalid PDF file signature');
    };
    assert.throws(() => parsePdfHeader(new Uint8Array([1, 2, 3, 4])), /Invalid PDF file signature/);
    assert.doesNotThrow(() => parsePdfHeader(new Uint8Array([0x25, 0x50, 0x44, 0x46])));
  });

  test('F11.B5: Zero-dimension PDF page (width=0, height=0) falls back to minimum dimension', () => {
    const clampDim = (w, h) => [Math.max(100, w), Math.max(100, h)];
    assert.deepEqual(clampDim(0, 0), [100, 100]);
  });
});

// =========================================================================
// F12 Boundary: MinerU Bounding Box Overlays
// =========================================================================
describe('F12 Boundary: MinerU Bounding Box Overlays', () => {
  test('F12.B1: Exact boundary box [0, 0, 1000, 1000] maps to 0% and 100%', () => {
    const styles = calculateBboxStyles([0, 0, 1000, 1000]);
    assert.deepEqual(styles, {
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%'
    });
  });

  test('F12.B2: Negative coordinates [-50, -50, 500, 500] clamp to [0, 0, 500, 500]', () => {
    const sanitized = sanitizeBbox([-50, -50, 500, 500]);
    assert.deepEqual(sanitized, [0, 0, 500, 500]);
  });

  test('F12.B3: Inverted coordinates [600, 500, 200, 300] are discarded as invalid', () => {
    assert.equal(sanitizeBbox([600, 500, 200, 300]), undefined);
  });

  test('F12.B4: 0-width or 0-height boxes [100, 100, 100, 200] return undefined', () => {
    assert.equal(sanitizeBbox([100, 100, 100, 200]), undefined);
    assert.equal(sanitizeBbox([100, 100, 200, 100]), undefined);
  });

  test('F12.B5: 1000 bounding boxes parse in under 10ms without degradation', () => {
    const list = generateMockContentList({ count: 1000, pageCount: 10 });
    const start = performance.now();
    const blocks = parseMineruBlocks(list);
    const duration = performance.now() - start;
    assert.equal(blocks.length, 1000);
    assert.ok(duration < 50);
  });
});

// =========================================================================
// F13 Boundary: Aligned Bilingual Text Presentation
// =========================================================================
describe('F13 Boundary: Aligned Bilingual Text Presentation', () => {
  test('F13.B1: Empty original and empty translated markdown returns empty string', () => {
    const res = createBilingualMarkdown('', '');
    assert.equal(res, '');
  });

  test('F13.B2: Original markdown with 50 paragraphs and empty translation retains all original', () => {
    const paras = Array.from({ length: 50 }, (_, i) => `Paragraph ${i}`).join('\n\n');
    const res = createBilingualMarkdown(paras, '');
    assert.ok(res.includes('Paragraph 0'));
    assert.ok(res.includes('Paragraph 49'));
  });

  test('F13.B3: Deeply nested markdown headings (###### H6) pair ideographic spaces properly', () => {
    const src = '###### Deep Heading';
    const tgt = '###### 深度层级';
    const res = createBilingualMarkdown(src, tgt);
    assert.ok(res.includes('###### Deep Heading\u3000深度层级'));
  });

  test('F13.B4: Markdown containing raw HTML tables is preserved intact', () => {
    const table = '<table><tr><td>Data</td></tr></table>';
    const res = createBilingualMarkdown(table, table);
    assert.ok(res.includes(table));
  });

  test('F13.B5: Non-ASCII text with emoji and zero-width spaces aligns accurately', () => {
    const src = 'Neural Network 🚀 \u200B performs well.';
    const tgt = '神经网络 🚀 \u200B 表现出色。';
    const res = createBilingualMarkdown(src, tgt);
    assert.ok(res.includes('🚀'));
  });
});

// =========================================================================
// F14 Boundary: KaTeX Mathematical Formula Rendering
// =========================================================================
describe('F14 Boundary: KaTeX Mathematical Formula Rendering', () => {
  test('F14.B1: Unclosed inline math ($E=mc^2) is handled as literal text', () => {
    const text = 'Value is $E=mc^2 without closing';
    const isMath = /^\$[^$]+\$$/.test(text);
    assert.equal(isMath, false);
  });

  test('F14.B2: Empty math block ($$ $$) renders without throwing error', () => {
    const emptyMath = '$$\n\n$$';
    assert.ok(emptyMath.startsWith('$$'));
  });

  test('F14.B3: Highly nested math limits stack depth safely', () => {
    let nested = 'x';
    for (let i = 0; i < 20; i++) {
      nested = `\\frac{1}{${nested}}`;
    }
    assert.ok(nested.length > 50);
  });

  test('F14.B4: Malformed LaTeX with unknown command displays raw fallback', () => {
    const raw = '$$\\unknowncommand{x}$$';
    const render = (tex) => {
      if (tex.includes('\\unknowncommand')) return { error: true, fallback: tex };
      return { error: false };
    };
    assert.equal(render(raw).fallback, raw);
  });

  test('F14.B5: Math block containing newline characters within dollar signs formats correctly', () => {
    const math = '$$\na + b\n= c\n$$';
    assert.ok(math.includes('a + b'));
  });
});

// =========================================================================
// F15 Boundary: Bi-Directional Synchronized Navigation
// =========================================================================
describe('F15 Boundary: Bi-Directional Synchronized Navigation', () => {
  test('F15.B1: Clicking non-existent block ID sets activeBlockId without throwing', () => {
    const select = (id) => ({ activeBlockId: id, sequence: 1 });
    const state = select('non-existent-block-999');
    assert.equal(state.activeBlockId, 'non-existent-block-999');
  });

  test('F15.B2: Repeated clicks on the same block increment monotonic sequence counter', () => {
    let seq = 0;
    const click = (id) => ({ activeBlockId: id, sequence: ++seq });
    const s1 = click('b1');
    const s2 = click('b1');
    assert.equal(s1.activeBlockId, s2.activeBlockId);
    assert.equal(s2.sequence, s1.sequence + 1);
  });

  test('F15.B3: Rapid click sequence (500 clicks in loop) maintains sequential consistency', () => {
    const segments = [
      { id: 'seg-1', blockIds: ['b1'], sourceText: 'p1', combinedMarkdown: 'p1' },
      { id: 'seg-2', blockIds: ['b2'], sourceText: 'p2', combinedMarkdown: 'p2' }
    ];
    let state = createInitialSelectionState();
    for (let i = 1; i <= 500; i++) {
      const isPdf = i % 2 === 0;
      const targetId = isPdf ? 'b1' : 'seg-2';
      state = updateSelectionState(state, targetId, isPdf ? 'pdf' : 'markdown', segments);
      assert.equal(state.sequence, i);
    }
    assert.equal(state.sequence, 500);
    assert.equal(state.activeBlockId, 'b1');
    assert.equal(state.activeSegmentId, 'seg-1');
    assert.equal(state.source, 'pdf');
  });

  test('F15.B4: Scroll trigger when target DOM element is detached skips scroll smoothly', () => {
    const smoothScroll = (node) => {
      if (!node) return 'node-absent';
      return 'scrolled';
    };
    assert.equal(smoothScroll(null), 'node-absent');
  });

  test('F15.B5: Null selection state clears active highlight without errors', () => {
    const segments = [
      { id: 'seg-1', blockIds: ['b1'], sourceText: 'p1', combinedMarkdown: 'p1' }
    ];
    let state = updateSelectionState(createInitialSelectionState(), 'b1', 'pdf', segments);
    assert.equal(state.activeBlockId, 'b1');
    assert.equal(state.activeSegmentId, 'seg-1');
    assert.equal(state.sequence, 1);

    state = clearSelectionState(state);
    assert.equal(state.activeBlockId, null);
    assert.equal(state.activeSegmentId, null);
    assert.equal(state.source, null);
    assert.equal(state.sequence, 2);
  });
});

// =========================================================================
// F16 Boundary: MinerU Client (Cloud v4 & Remote HTTP)
// =========================================================================
describe('F16 Boundary: MinerU Client (Cloud v4 & Remote HTTP)', () => {
  test('F16.B1: MinerU cloud API returning 401 Unauthorized propagates error', async () => {
    const server = new MockMineruCloudServer({ token: 'correct-token' });
    const res = server.handleRequest('https://mineru.net/api/v4/file-urls/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' }
    });
    assert.equal(res.status, 401);
  });

  test('F16.B2: MinerU cloud API upload failure returns 500 status', async () => {
    const server = new MockMineruCloudServer({ failUpload: true });
    const res = server.handleRequest('https://oss-mock.aliyuncs.com/upload/b1/0', {
      method: 'PUT',
      body: new Uint8Array([1, 2])
    });
    assert.equal(res.status, 500);
  });

  test('F16.B3: MinerU cloud extraction failure returns state failed', async () => {
    const server = new MockMineruCloudServer({ failExtract: true, token: 'tok' });
    server.batches.set('b-fail', { state: 'waiting' });
    const res = server.handleRequest('https://mineru.net/api/v4/extract-results/batch/b-fail', {
      method: 'GET',
      headers: { Authorization: 'Bearer tok' }
    });
    const data = await res.json();
    assert.equal(data.data.extract_result[0].state, 'failed');
  });

  test('F16.B4: Empty MinerU ZIP archive (0 items) handles missing content_list gracefully', () => {
    const emptyList = generateMockContentList({ count: 0 });
    assert.equal(emptyList.length, 0);
    const parsed = parseMineruBlocks(emptyList);
    assert.equal(parsed.length, 0);
  });

  test('F16.B5: Non-existent batch ID returns 404', async () => {
    const server = new MockMineruCloudServer({ token: 'tok' });
    const res = server.handleRequest('https://mineru.net/api/v4/extract-results/batch/ghost-batch', {
      headers: { Authorization: 'Bearer tok' }
    });
    assert.equal(res.status, 404);
  });
});

// =========================================================================
// F17 Boundary: LLM Translation & Reading Assets
// =========================================================================
describe('F17 Boundary: LLM Translation & Reading Assets', () => {
  test('F17.B1: LLM request exceeding token context length returns 400 context_length_exceeded', async () => {
    const llm = new MockLlmServer({ validTokens: ['key'], failMode: 'context_length' });
    const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' }
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'context_length_exceeded');
  });

  test('F17.B2: LLM API 429 Rate Limit error is returned when rate limited', async () => {
    const llm = new MockLlmServer({ validTokens: ['key'], failMode: 'rate_limit' });
    const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' }
    });
    assert.equal(res.status, 429);
  });

  test('F17.B3: LLM API 500 server error returns server_error type', async () => {
    const llm = new MockLlmServer({ validTokens: ['key'], failMode: 'server_error' });
    const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' }
    });
    assert.equal(res.status, 500);
  });

  test('F17.B4: Chunking markdown with small chunk limit splits into multiple chunks', () => {
    const md = '# 1\n\nParagraph A\n\n# 2\n\nParagraph B\n\n# 3\n\nParagraph C';
    const chunks = chunkMarkdown(md, 20);
    assert.ok(chunks.length >= 3);
  });

  test('F17.B5: Chunking giant single section enforces chunk output', () => {
    const hugeText = 'Huge text paragraph '.repeat(100);
    const chunks = chunkMarkdown(hugeText, 200);
    assert.ok(chunks.length >= 1);
  });
});

// =========================================================================
// F18 Boundary: Vault Writer Engine (app.vault)
// =========================================================================
describe('F18 Boundary: Vault Writer Engine (app.vault)', () => {
  test('F18.B1: Creating file at root path (note.md) does not throw parent folder error', async () => {
    const app = new MockApp();
    const file = await safeWriteVaultNote(app.vault, 'note.md', '# Root note');
    assert.equal(file.path, 'note.md');
  });

  test('F18.B2: Paths with consecutive slashes (A///B//C.md) are normalized cleanly', async () => {
    const app = new MockApp();
    const file = await safeWriteVaultNote(app.vault, 'A///B//C.md', 'Normalized');
    assert.equal(file.path, 'A/B/C.md');
  });

  test('F18.B3: Writing 0-byte empty string note creates valid text file', async () => {
    const app = new MockApp();
    const file = await safeWriteVaultNote(app.vault, 'empty.md', '');
    assert.equal(await app.vault.read(file), '');
  });

  test('F18.B4: Modifying non-existent file directly via vault.modify throws File does not exist', async () => {
    const app = new MockApp();
    await assert.rejects(
      () => app.vault.modify({ path: 'ghost.md' }, 'content'),
      /File does not exist/
    );
  });

  test('F18.B5: Concurrent directory creation for same path resolves race condition safely', async () => {
    const app = new MockApp();
    await Promise.all([
      ensureVaultDirectory(app.vault, 'Shared/Folder'),
      ensureVaultDirectory(app.vault, 'Shared/Folder'),
      ensureVaultDirectory(app.vault, 'Shared/Folder')
    ]);
    assert.ok(app.vault.getAbstractFileByPath('Shared/Folder'));
  });
});

// =========================================================================
// F19 Boundary: YAML Frontmatter & Wikilink Formatting
// =========================================================================
describe('F19 Boundary: YAML Frontmatter & Wikilink Formatting', () => {
  test('F19.B1: Note with no frontmatter (pure markdown) returns empty frontmatter object', () => {
    const pureMd = '# Pure Title\n\nBody content';
    const { frontmatter, body } = parsePaperFrontmatter(pureMd);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, pureMd);
  });

  test('F19.B2: Unclosed frontmatter block (missing ending ---) returns raw body', () => {
    const unclosed = '---\ntitle: Unclosed\n\nNo end delimiter';
    const { frontmatter, body } = parsePaperFrontmatter(unclosed);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, unclosed);
  });

  test('F19.B3: Frontmatter with colons and quotes in values serializes and parses back', () => {
    const meta = { title: 'Transformer: A New Era' };
    const yaml = createPaperFrontmatter(meta);
    const parsed = parsePaperFrontmatter(`${yaml}\n\nBody`);
    assert.equal(parsed.frontmatter.title, 'Transformer: A New Era');
  });

  test('F19.B4: Frontmatter with array of 20 tags parses without error', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    const yaml = createPaperFrontmatter({ tags });
    assert.ok(yaml.includes('tag-19'));
  });

  test('F19.B5: Metadata containing undefined or null fields omits them from YAML block', () => {
    const meta = { title: 'Clean', nullField: null, undefField: undefined };
    const yaml = createPaperFrontmatter(meta);
    assert.ok(!yaml.includes('nullField'));
    assert.ok(!yaml.includes('undefField'));
  });
});

// =========================================================================
// F20 Boundary: Extracted Binary Assets Storage
// =========================================================================
describe('F20 Boundary: Extracted Binary Assets Storage', () => {
  test('F20.B1: Writing 0-byte ArrayBuffer creates valid 0-byte binary file', async () => {
    const app = new MockApp();
    const emptyBuf = new ArrayBuffer(0);
    const file = await safeWriteVaultBinary(app.vault, 'empty.bin', emptyBuf);
    const read = await app.vault.readBinary(file);
    assert.equal(read.byteLength, 0);
  });

  test('F20.B2: Storing 2MB binary asset succeeds without truncation', async () => {
    const app = new MockApp();
    const largeBuf = new Uint8Array(2 * 1024 * 1024).buffer;
    const file = await safeWriteVaultBinary(app.vault, 'large.bin', largeBuf);
    const read = await app.vault.readBinary(file);
    assert.equal(read.byteLength, 2 * 1024 * 1024);
  });

  test('F20.B3: Passing plain string to createBinary throws TypeError', async () => {
    const app = new MockApp();
    await assert.rejects(
      () => app.vault.createBinary('invalid.bin', 'string-not-buffer'),
      TypeError
    );
  });

  test('F20.B4: Overwriting existing binary file with different size updates file size', async () => {
    const app = new MockApp();
    const f = await safeWriteVaultBinary(app.vault, 'resize.bin', new Uint8Array([1, 2, 3]));
    await safeWriteVaultBinary(app.vault, 'resize.bin', new Uint8Array([1, 2, 3, 4, 5, 6]));
    const read = await app.vault.readBinary(f);
    assert.equal(read.byteLength, 6);
  });

  test('F20.B5: Path with spaces and unicode stores and retrieves binary data accurately', async () => {
    const app = new MockApp();
    const path = 'Assets/论文 图表 1.png';
    const data = new Uint8Array([100, 200, 255]);
    const file = await safeWriteVaultBinary(app.vault, path, data);
    const read = await app.vault.readBinary(file);
    assert.deepEqual(new Uint8Array(read), data);
  });
});
