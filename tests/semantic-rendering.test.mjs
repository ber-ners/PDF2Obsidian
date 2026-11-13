import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import ts from 'typescript';
const require = createRequire(new URL('../apps/desktop-web/package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const app = new URL('../apps/desktop-web/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(app) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      for (const ext of ['.tsx', '.ts']) if (existsSync(new URL(url.href + ext))) return {url:url.href+ext,shortCircuit:true};
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith(app) || !/\.(?:tsx|ts)$/.test(url)) return next(url, context);
    return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{
      compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}
    }).outputText};
  }
});
const { MarkdownContent } = await import(new URL('../apps/desktop-web/components/MarkdownContent.tsx', import.meta.url));
hook.deregister();
const render = (markdown, props={}) => renderToStaticMarkup(createElement(MarkdownContent,{markdown,...props}));

test('actual renderer places figure captions under images and preserves safe links and math',()=>{
  const html=render('![](images/a.jpg)  \nFig 1 | Study flow\n\n[Source](https://example.com) $x^2$',{taskId:'task'});
  assert.match(html,/<figure/);
  assert.ok(html.indexOf('<img')<html.indexOf('<figcaption'));
  assert.match(html,/class="md-semantic-caption"/);
  assert.match(html,/image=images%2Fa.jpg/);
  assert.match(html,/class="katex"/);
});

test('actual renderer retains HTML tables and strips scripts and event handlers',()=>{
  const html=render('<table><tr><td colspan="2">A</td></tr></table>\n\n<script>alert(1)</script>\n\n<img src="a.jpg" onerror="alert(2)" />');
  assert.match(html,/<td colSpan="2">A<\/td>/i);
  assert.doesNotMatch(html,/<script|onerror|alert\(/i);
});

test('both languages receive the note role without converting ordinary body into a note',()=>{
  const note=render('Source: trial.\n\n来源：试验。',{role:'footnote'});
  assert.equal((note.match(/class="md-semantic-footnote"/g)??[]).length,2);
  assert.match(render('Ordinary body.'),/class="md-semantic-body"/);
});
