import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import ts from 'typescript';
import { createFrontmatter, extractPaperAuthors, extractPaperMetadata } from '../packages/core/dist/index.js';

const require = createRequire(new URL('../apps/desktop-web/package.json', import.meta.url));
const YAML = require('yaml');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const webRoot = new URL('../apps/desktop-web/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(webRoot)) {
      for (const extension of ['.tsx', '.ts']) {
        const candidate = new URL(specifier + extension, context.parentURL);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(webRoot) || !/\.tsx?$/.test(url)) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
      }).outputText };
  }
});
const { parsePaperMetadata, createMetadataRows } = await import('../apps/desktop-web/lib/paper-metadata.ts');
const { repairPaperMetadata } = await import('../apps/desktop-web/lib/repair-paper-metadata.ts');
const { MetadataView } = await import('../apps/desktop-web/components/MetadataView.tsx');
hook.deregister();

const source = readFileSync(new URL('./fixtures/paper-authors.md', import.meta.url), 'utf8');
const title = source.split('\n')[0].slice(2);
const expectedAuthors = [
  'Michele De Prisco', 'Vincenzo Oliva', 'Alessandro Miola', 'Michele Fornaro', 'Elena Dragioti',
  'Giovanni Croatto', 'Andre F Carvalho', 'Michael Berk', 'Katerina Nikolitch', 'Gayatri Saraf',
  'Lakshmi N Yatham', 'Kamyar Keramatian', 'Risa Shorr', 'Mark A Frye', 'Balwinder Singh',
  'Damir Krinitski', 'Mikkel Højlund', 'Alessandro Serretti', 'Giuseppe Fanelli', 'Fabiano A Gomes',
  'Anne Sofie Hansen', 'Rene Ernst Nielsen', 'Paolo Fusar-Poli', 'Pasquale Paribello', 'Mirko Manchia',
  'Anees Bahji', 'Gustavo Vazquez', 'Spyridon Siafis', 'Stefan Leucht', 'Ayşegül Yildiz',
  'Richard Delorme', 'Ayal Schaffer', 'Brendon Stubbs', 'Ruby Rubaiyat', 'Eduard Vieta',
  'Christoph U Correll', 'David Moher', 'Samuele Cortese', 'Jess G Fiedorowicz', 'Joaquim Radua',
  'Corentin J Gosling', 'Marco Solmi'
];

test('affiliation commas never split names and long author lists remain complete', () => {
  assert.deepEqual(extractPaperAuthors(source), expectedAuthors);
  assert.deepEqual(extractPaperMetadata({ markdown: source, title, config: { enrichFromMarkdown: true } }).authors, expectedAuthors);
});

test('HTML, LaTeX and Unicode affiliation markers are removed before name splitting', () => {
  assert.deepEqual(extractPaperAuthors('# Paper\n\nJane Doe<sup>1,2</sup>, John Smith \\({}^{3,4}\\), María López⁵†'),
    ['Jane Doe', 'John Smith', 'María López']);
  assert.deepEqual(extractPaperAuthors('# Paper\n\nJane Doe[1], John Smith (2) and María López3'),
    ['Jane Doe', 'John Smith', 'María López']);
});

test('YAML titles, folded blocks, arrays and quoted escapes keep their full values', () => {
  const content = createFrontmatter({ title: '中文标题', paperTitle: title, translatedTitle: '中文标题',
    authors: expectedAuthors, missing: null, citationCount: 0, extra: { nested: 'hidden' },
    quoted: 'A "quoted" title \\ path' }, '');
  assert.match(content, /paperTitle: "[^\n]+\n/);
  const metadata = parsePaperMetadata(content);
  assert.equal(metadata.paperTitle, title);
  assert.equal(metadata.authors, expectedAuthors.join('、'));
  assert.equal(metadata.quoted, 'A "quoted" title \\ path');
  assert.equal(metadata.citationCount, '0');
  assert.equal(metadata.missing, undefined);
  assert.equal(metadata.extra, undefined);
  assert.equal(parsePaperMetadata('---\r\npaperTitle: >-\r\n  Full title\r\n  continued\r\n---').paperTitle, 'Full title continued');
  assert.deepEqual(parsePaperMetadata('---\ntitle: [broken\n---'), {});
});

test('legacy notes recover the entire author list and matching citations without changing valid notes', () => {
  const broken = createFrontmatter({ title: '中文标题', paperTitle: title,
    authors: ['Michele De Prisco', '$^{', '}$ Vincenzo Oliva'], year: 2026, journal: 'BMJ' },
    '# 中文标题\n\n- 作者：Michele De Prisco, $^{, }$ Vincenzo Oliva\n\nUser annotation.');
  const fixed = repairPaperMetadata(broken, createFrontmatter({ title }, source));
  const metadata = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(fixed)[1]);
  assert.deepEqual(metadata.authors, expectedAuthors);
  assert.ok(metadata.citationBibtex.includes('Marco Solmi'));
  assert.doesNotMatch(metadata.citationApa, /\$|\^\{/);
  assert.ok(fixed.includes(`- 作者：${expectedAuthors.join(', ')}`));
  assert.ok(fixed.endsWith('User annotation.\n'));
  assert.equal(repairPaperMetadata(fixed, source), fixed);
  assert.equal(repairPaperMetadata(broken, '# No authors'), broken);
});

test('metadata renders full titles, clean authors and venue fallback without duplicate title rows', () => {
  const content = createFrontmatter({ title: '中文标题', translatedTitle: '中文标题', paperTitle: title,
    authors: expectedAuthors, venue: 'Conference' }, '');
  const html = renderToStaticMarkup(createElement(MetadataView, { content }));
  assert.ok(html.includes(title));
  assert.ok(html.includes('Corentin J Gosling、Marco Solmi'));
  assert.ok(html.includes('Conference'));
  assert.doesNotMatch(html, /<span>标题<\/span>|\$\^/);
  assert.deepEqual(createMetadataRows({ title: 'Legacy paper' }), [{ label: '标题', value: 'Legacy paper' }]);
});
