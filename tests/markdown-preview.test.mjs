import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import ts from 'typescript';

const require = createRequire(new URL('../apps/desktop-web/package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const componentUrl = new URL('../apps/desktop-web/components/MarkdownPreview.tsx', import.meta.url);
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
    if (!url.startsWith(new URL('../apps/desktop-web/components/', import.meta.url).href) || !url.endsWith('.tsx')) return nextLoad(url, context);
    return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
  }
});
const { MarkdownPreview } = await import(componentUrl.href);
hook.deregister();
const render = (content, props = {}) => renderToStaticMarkup(createElement(MarkdownPreview, { content, ...props }));

test('glossary renders semantic table cells and inline Markdown instead of a code block', () => {
  const html = render('---\r\ntype: terms\r\n---\r\n\r\n# 术语表\n\n| 术语 | 中文译名 | 上下文解释 |\n|---|---|---|\n| **GRADE** | 证据分级 | 使用 `GRADE` 评价证据。 |');
  assert.match(html, /<div class="md-table"[^>]*><table>/);
  assert.equal((html.match(/<th>/g) ?? []).length, 3);
  assert.equal((html.match(/<td>/g) ?? []).length, 3);
  assert.match(html, /<strong>GRADE<\/strong>/);
  assert.match(html, /<code>GRADE<\/code>/);
  assert.doesNotMatch(html, /<pre|type: terms|\|---/);
});

test('questions preserve numbering, bold text, hard breaks and answer paragraphs', () => {
  const html = render('# 问答\n\n1. **这项研究的主要动机是什么？**  \n答：需要整合证据。\n\n2. **研究采用了什么设计或框架？**  \n答：动态伞状综述。');
  assert.match(html, /<ol>/);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.match(html, /<strong>这项研究的主要动机是什么？<\/strong><br\/>\n答：需要整合证据。/);
  assert.doesNotMatch(html, /\*\*/);
});

test('links, nested lists, quotes, math and literal fenced code retain their meaning', () => {
  const html = render('> [来源](https://example.com)\n\n- 方法\n  - *详细说明*\n\n$x^2$\n\n```md\n**原始代码**\n```\n\n<script>alert(1)</script>');
  assert.match(html, /<blockquote>/);
  assert.match(html, /<a href="https:\/\/example.com">来源<\/a>/);
  assert.equal((html.match(/<ul>/g) ?? []).length, 2);
  assert.match(html, /<em>详细说明<\/em>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<pre class="md-code"><code class="language-md">\*\*原始代码\*\*/);
  assert.doesNotMatch(html, /<script>/);
});

test('empty or metadata-only artifacts keep the empty state', () => {
  for (const content of [undefined, '  ', '---\ntype: qa\n---']) {
    const html = render(content, { emptyTitle: '暂无阅读材料', emptyText: '请先生成材料。' });
    assert.match(html, /class="markdown-preview empty-output"/);
    assert.match(html, /暂无阅读材料/);
    assert.match(html, /请先生成材料。/);
  }
});


test('MinerU HTML tables render cells, merged rows, captions and inline formatting', () => {
  const html = render('<table><caption>Table 1</caption><tr><td colspan="2">Continued</td></tr><tr><th>Intervention</th><th>Result</th></tr><tr><td rowspan="2"><strong>Therapy</strong><br>Group</td><td>One</td></tr><tr><td>Two<sup>1</sup></td></tr></table>');
  assert.match(html, /<table>/);
  assert.match(html, /<caption>Table 1<\/caption>/);
  assert.match(html, /colSpan="2"/);
  assert.match(html, /rowSpan="2"/);
  assert.match(html, /<strong>Therapy<\/strong><br\/>Group/);
  assert.match(html, /<sup>1<\/sup>/);
  assert.doesNotMatch(html, /&lt;table|&lt;tr|&lt;td/);
});

test('Markdown and HTML figures use task assets and retain captions', () => {
  const html = render('![Figure 1](images/figure.jpg)\n\n<img src="./images/figure2.png" alt="Figure 2">\n\nFigure caption.', { taskId: 'paper' });
  assert.match(html, /src="\/api\/tasks\/paper\/layout\?image=images%2Ffigure.jpg"/);
  assert.match(html, /src="\/api\/tasks\/paper\/layout\?image=images%2Ffigure2.png"/);
  assert.equal((html.match(/loading="lazy"/g) ?? []).length, 2);
  assert.match(html, /Figure caption/);
});

test('raw HTML cannot run scripts, events or unsafe URLs; fenced HTML stays code', () => {
  const html = render('<table onclick="alert(1)"><tr><td style="position:fixed">Safe<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(1)">Link</a><iframe src="https://example.com"></iframe></td></tr></table>\n\n```html\n<table><tr><td>Code</td></tr></table>\n```');
  assert.match(html, /<td>Safe/);
  assert.match(html, /<pre class="md-code"><code class="language-html">&lt;table&gt;/);
  assert.doesNotMatch(html, /<script|onclick=|onerror=|style=|javascript:|<iframe/);
});
