import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfBlocks } from '../apps/desktop-web/lib/pdf-blocks.ts';
import { linkBilingualSegments } from '../apps/desktop-web/lib/bilingual-links.ts';
import { rehypePdfSemantics } from '../apps/desktop-web/lib/rehype-pdf-semantics.ts';

const p = (value) => ({type:'element',tagName:'p',children:[{type:'text',value}]});
const root = (...children) => ({type:'root',children});

test('MinerU roles retain image body, caption and notes in reading order', () => {
  const blocks = parsePdfBlocks([
    {page_idx:0,type:'image',img_path:'images/a.jpg',image_caption:['Fig 1 | Study flow'],image_footnote:['Source: trial.']},
    {page_idx:0,type:'text',text:'Results',text_level:2},
    {page_idx:0,type:'page_footnote',text:'* Additional information.'},
    {page_idx:0,type:'footer',text:'Journal DOI'},
    {page_idx:0,type:'text',text:'Normal body.'}
  ]);
  assert.deepEqual(blocks[0].parts.map(part=>part.role),['image','caption','footnote']);
  assert.deepEqual(blocks.map(block=>block.role),['image','title','footnote','footer','body']);
  assert.equal(blocks[1].headingLevel,2);
});

test('table caption and notes stay outside the table body', () => {
  const [block] = parsePdfBlocks([{page_idx:1,type:'table',img_path:'images/a.jpg',table_caption:['Table 1'],table_body:'<table><tr><td>A</td></tr></table>',table_footnote:['Notes.']}]);
  assert.deepEqual(block.parts.map(part=>part.role),['caption','table','footnote']);
});

test('bilingual captions and notes inherit the source role without styling the body', () => {
  const blocks=parsePdfBlocks([{page_idx:0,type:'image',img_path:'images/a.jpg',image_caption:['Fig 1 | Study flow'],image_footnote:['Source: trial.']},
    {page_idx:0,type:'text',text:'Body.'}]);
  const linked=linkBilingualSegments([
    {source:'![](images/a.jpg)  \nFig 1 | Study flow',markdown:'![](images/a.jpg)  \nFig 1 | Study flow\n\n图1 | 研究流程'},
    {source:'Source: trial.',markdown:'Source: trial.\n\n来源：试验。'},
    {source:'Body.',markdown:'Body.\n\n正文。'}],blocks);
  assert.deepEqual(linked.map(segment=>segment.role),['caption','footnote','body']);
});

test('image paragraphs become figures with a caption below the image', () => {
  const tree=root({type:'element',tagName:'p',children:[{type:'element',tagName:'img',properties:{src:'a.jpg'}},{type:'element',tagName:'br'}, {type:'text',value:'Fig 1 | Study flow'}]});
  rehypePdfSemantics()(tree);
  assert.equal(tree.children[0].tagName,'figure');
  assert.equal(tree.children[0].children[0].tagName,'img');
  assert.equal(tree.children[0].children[1].tagName,'figcaption');
  assert.equal(tree.children[0].children[1].properties.dataPdfRole,'caption');
});

test('notes use small-text roles in both languages; mixed body paragraphs stay normal', () => {
  const tree=root(p('Source: trial.'),p('来源：试验。'));
  rehypePdfSemantics({role:'footnote'})(tree);
  assert.ok(tree.children.every(node=>node.properties.dataPdfRole==='footnote'));
  const mixed=root(p('Notes.'),p('Body.'));
  rehypePdfSemantics({annotations:[{text:'Notes.',role:'footnote'}]})(mixed);
  assert.deepEqual(mixed.children.map(node=>node.properties.dataPdfRole),['footnote','body']);
});

test('semantic titles render as headings and footers stay distinguishable', () => {
  const tree=root(p('Results'),p('Journal DOI'));
  rehypePdfSemantics({annotations:[{text:'Results',role:'title',level:2},{text:'Journal DOI',role:'footer'}]})(tree);
  assert.equal(tree.children[0].tagName,'h2');
  assert.equal(tree.children[1].properties.dataPdfRole,'footer');
});

test('HTML-only tables are preserved even without an extracted image or caption', () => {
  const blocks=parsePdfBlocks([{page_idx:0,type:'table',table_body:'<table><tr><td>A</td></tr></table>'}]);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].parts[0].role,'table');
});
