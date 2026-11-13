import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import ts from 'typescript';

const require = createRequire(new URL('../apps/desktop-web/package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const components = new URL('../apps/desktop-web/components/', import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/apps/desktop-web/')) {
      for (const extension of ['.tsx', '.ts']) {
        const candidate = new URL(specifier + extension, context.parentURL);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(components.href) || !url.endsWith('.tsx')) return nextLoad(url, context);
    return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
  }
});
const { BilingualMarkdown } = await import(new URL('BilingualMarkdown.tsx', components));
const { LinkedMarkdown } = await import(new URL('LinkedMarkdown.tsx', components));
const { scrollToMarkdownBlock } = await import(new URL('MarkdownViewport.tsx', components));
hook.deregister();

const segments = Array.from({ length: 250 }, (_, index) => ({
  source: `Source ${index}`, markdown: `Source ${index}\n\n译文 ${index}`, blockIds: [`block-${index}`]
}));
const blocks = segments.map((segment, index) => ({
  id: `block-${index}`, markdown: segment.source, page: index + 1, type: 'text', bbox: [0, 0, 100, 100]
}));

test('a long note starts with readable content without parsing every distant paragraph', () => {
  const html = renderToStaticMarkup(createElement(BilingualMarkdown, { taskId: 'note', content: '', segments, blocks }));
  assert.match(html, /<p[^>]*>Source 0<\/p>/);
  assert.match(html, /译文 0/);
  assert.doesNotMatch(html, /Source 249|译文 249/);
  assert.equal((html.match(/<section /g) ?? []).length, 250);
  assert.equal((html.match(/data-mounted="true"/g) ?? []).length, 1);
});

test('a PDF click renders a distant bilingual target in the same commit', () => {
  const html = renderToStaticMarkup(createElement(BilingualMarkdown, {
    taskId: 'note', content: '', segments, blocks, selection: { id: 'block-249', source: 'pdf', sequence: 1 }
  }));
  assert.match(html, /data-segment-index="249"[^>]*data-active="true"[^>]*data-mounted="true"/);
  assert.match(html, /Source 249/);
  assert.match(html, /译文 249/);
  assert.doesNotMatch(html, /Source 248/);
});

test('a PDF click also renders distant original text without mounting the full document', () => {
  const html = renderToStaticMarkup(createElement(LinkedMarkdown, {
    taskId: 'note', blocks, onSelect() {}, selection: { id: 'block-249', source: 'pdf', sequence: 1 }
  }));
  assert.match(html, /Source 249/);
  assert.doesNotMatch(html, /Source 248/);
  assert.equal((html.match(/data-mounted="true"/g) ?? []).length, 2);
});

test('PDF navigation scrolls only its own Markdown viewport and aligns oversized blocks at the top', () => {
  const calls = [];
  const viewport = { scrollTop: 1000, clientHeight: 600, getBoundingClientRect: () => ({ top: 100 }), scrollTo: options => calls.push(options) };
  const node = { offsetHeight: 200, closest: () => viewport, getBoundingClientRect: () => ({ top: 900 }) };
  scrollToMarkdownBlock(node);
  assert.deepEqual(calls.pop(), { top: 1600, behavior: 'auto' });
  node.offsetHeight = 1200;
  scrollToMarkdownBlock(node);
  assert.deepEqual(calls.pop(), { top: 1800, behavior: 'auto' });
  node.getBoundingClientRect = () => ({ top: -2000 });
  scrollToMarkdownBlock(node);
  assert.deepEqual(calls.pop(), { top: 0, behavior: 'auto' });
});
