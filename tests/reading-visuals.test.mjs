import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReadingSourceContext,
  parseReadingVisualsDocument,
  prepareReadingVisuals,
  sanitizeMermaidCode
} from '../packages/core/dist/index.js';

const sample = `# 阅读图解

体裁：临床伞状综述与循证评价

主旨：针对双相障碍缺乏全病程统一循证指南的痛点，整合 77 项 Meta 分析的 2510 项关联并做 GRADE 分级，确立跨时相与分年龄段的核心有效干预矩阵。

主线：证据整合与分级方法学 -> 跨阶段核心干预疗效矩阵 -> 作用机制与临床转化路径

## 证据整合与 GRADE 质量分级机制

衔接：承接双相障碍治疗证据碎片化的背景，先确立如何从海量文献中筛选并量化评估证据确定性。

要点：虽然纳入 2510 项关联，但仅 9.4%（236 项）达到高确定性证据，任何"有效"结论都必须以 GRADE 分级为前提，这一点常被临床读者忽略。

\`\`\`mermaid
flowchart TD
    A[文献检索] --> B["纳入 77 项 Meta 分析"]
    B --> C{异质性 I² > 50%?}
    C -->|是| D["降级为低/极低确定性"]
    C -->|否| E["进入 GRADE 分级"]
    E --> F[高确定性 236 项]
\`\`\`

拆解：
- 为什么重算随机效应模型：消除原始 Meta 分析间的模型异质性，统一效应量口径（SMD/OR）。
- 核心降级瓶颈：超过 57% 的证据因研究间异质性或小样本偏倚被降为低/极低确定性。

出处：方法部分"动态伞状综述"、结果部分图 1 与表 1

## 跨阶段核心干预疗效矩阵

衔接：在分级口径确立后，才能比较不同时相的干预效果。

要点：躁狂相与抑郁相的有效药物集合并不重合，跨时相"通吃"的只有锂盐等少数选项。

\`\`\`mermaid
flowchart TD
    A[急性躁狂] --->>>> B[急性抑郁]
    B --> C[维持期]
\`\`\`

拆解：
- 急性躁狂以抗精神病药为主，抑郁相以喹硫平、鲁拉西酮证据最强。
- 维持期证据集中于锂盐，停药复发率显著上升。

出处：结果部分表 2

## 作用机制与临床转化路径

衔接：疗效矩阵落地需要机制解释与剂量、监测约束。

要点：原文未给出机制层面的直接证据，转化路径主要基于间接推断。

（无图，仅文字说明）

拆解：
- 机制部分属于作者推论，不能当作证据等级结论引用。

出处：讨论部分第 3 段
`;

test('parseReadingVisualsDocument reads overview and all cards', () => {
  const doc = parseReadingVisualsDocument(sample);
  assert.equal(doc.genre, '临床伞状综述与循证评价');
  assert.match(doc.thesis ?? '', /2510 项关联/);
  assert.equal(doc.thread.length, 3);
  assert.equal(doc.cards.length, 3);
  assert.match(doc.cards[0].title, /GRADE/);
  assert.match(doc.cards[0].bridge ?? '', /证据碎片化/);
  assert.equal(doc.cards[0].breakdown.length, 2);
  assert.match(doc.cards[0].source, /图 1 与表 1/);
  assert.equal(doc.cards[0].visual.kind, 'diagram');
  assert.equal(doc.cards[0].visual.kind === 'diagram' && doc.cards[0].visual.valid, true);
});

test('long takeaway is kept instead of silently dropping the card', () => {
  const doc = parseReadingVisualsDocument(sample);
  assert.ok((doc.cards[0].takeaway.length ?? 0) > 60);
  assert.equal(doc.cards.length, 3);
});

test('invalid mermaid keeps narrative and exposes the source', () => {
  const doc = parseReadingVisualsDocument(sample);
  const broken = doc.cards[1];
  assert.ok(broken);
  assert.equal(broken.title, '跨阶段核心干预疗效矩阵');
  // 语法错误的图仍然保留代码与文字，交由 UI 展示源码排错框
  assert.equal(broken.visual.kind, 'diagram');
  if (broken.visual.kind === 'diagram') {
    assert.equal(broken.visual.valid, false);
    assert.ok(broken.visual.error);
    assert.match(broken.visual.code, /急性躁狂/);
  }
  assert.ok(broken.takeaway.length > 0);
  assert.ok(broken.breakdown.length > 0);
  assert.ok(broken.source.length > 0);
  // 关键：坏图不能把卡片从文档里抹掉
  assert.equal(doc.cards.length, 3);
});

test('card without a diagram is preserved with text only', () => {
  const doc = parseReadingVisualsDocument(sample);
  const last = doc.cards[2];
  assert.ok(last);
  assert.equal(last.visual.kind, 'none');
  assert.match(last.takeaway, /原文未给出机制/);
  // 「无图」占位不能被当成要点的续行
  assert.equal(/无图/.test(last.takeaway), false);
  assert.equal(last.breakdown.length, 1);
});

test('prepareReadingVisuals round-trips without losing cards', () => {
  const prepared = prepareReadingVisuals(sample);
  assert.ok(prepared);
  const reparsed = parseReadingVisualsDocument(prepared);
  assert.equal(reparsed.cards.length, 3);
  assert.equal(reparsed.thread.length, 3);
  assert.match(prepared, /^# 阅读图解$/m);
  assert.match(prepared, /^体裁：/m);
  assert.match(prepared, /^主线：/m);
  assert.match(prepared, /^拆解：$/m);
  // 顺序固定：衔接 -> 要点 -> 图 -> 拆解 -> 出处
  const order = ['衔接：', '要点：', '```mermaid', '拆解：', '出处：'].map((token) => prepared.indexOf(token));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('prepareReadingVisuals returns undefined when no card survives', () => {
  assert.equal(prepareReadingVisuals('# 阅读图解\n\n随便一段话。'), undefined);
});

test('sanitizeMermaidCode quotes special-character labels and drops click handlers', () => {
  const cleaned = sanitizeMermaidCode([
    'flowchart TD',
    '    A[编码器 (Transformer Encoder)] --> B{准确率 > 90%?}',
    '    click A "https://example.com"'
  ].join('\n'));

  assert.match(cleaned, /A\["编码器 \(Transformer Encoder\)"\]/);
  assert.match(cleaned, /B\{"准确率 > 90%\?"\}/);
  assert.equal(/click/i.test(cleaned), false);
});

test('sanitizeMermaidCode leaves quoted labels and plain labels untouched', () => {
  const source = [
    'flowchart LR',
    '    A["原始输入 (Raw Input)"] --> B[标准化]',
    '    B --> C[输出]'
  ].join('\n');
  assert.equal(sanitizeMermaidCode(source), source);
});

test('buildReadingSourceContext strips back matter and keeps an outline', () => {
  const original = [
    '---',
    'title: demo',
    '---',
    '# Title',
    '## Abstract',
    'Background text.',
    '## Methods',
    'We did things.',
    '## Results',
    'We found things.',
    '## Discussion',
    'Limitations exist.',
    '## References',
    '1. Smith J. et al. 2020.',
    '2. Doe A. et al. 2021.',
    '## Acknowledgments',
    'We thank everyone.',
    '## Competing interests',
    'None.'
  ].join('\n');

  const context = buildReadingSourceContext({ original, maxChars: 4000 });
  assert.match(context.prompt, /全文大纲/);
  assert.match(context.prompt, /## Methods/);
  assert.match(context.prompt, /## Discussion/);
  assert.equal(/Smith J\. et al\./.test(context.prompt), false);
  assert.equal(/We thank everyone/.test(context.prompt), false);
  assert.ok(context.removedSections.length >= 1);
});

test('buildReadingSourceContext blends original and translated excerpts', () => {
  const context = buildReadingSourceContext({
    original: '# Paper\n## Methods\nOriginal method text.',
    translated: '# 论文\n## 方法\n译文方法段落。',
    maxChars: 4000
  });
  assert.match(context.prompt, /原文摘录/);
  assert.match(context.prompt, /译文摘录/);
  assert.match(context.prompt, /译文方法段落/);
});

test('strips AUTHOR AFFILIATIONS / provenance headings that carry punctuation', () => {
  const filler = Array.from({ length: 12 }, (_, index) =>
    `We report subgroup finding ${index} in detail across phases and age groups of bipolar disorder.`
  );
  const original = [
    '## Results',
    ...filler,
    '## Conclusions',
    'We conclude.',
    '## AUTHOR AFFILIATIONS',
    'Department of Psychiatry, University of Oxford, Oxford, UK',
    '## Provenance and peer review: Not commissioned; externally peer reviewed.',
    'Handled by an external editor.'
  ].join('\n');

  const context = buildReadingSourceContext({ original, maxChars: 8000 });
  assert.match(context.prompt, /We conclude/);
  assert.equal(/AUTHOR AFFILIATIONS/.test(context.prompt), false);
  assert.equal(/Department of Psychiatry/.test(context.prompt), false);
  assert.equal(/Provenance and peer review/.test(context.prompt), false);
});

test('cuts a heading-less numbered reference list', () => {
  const refs = Array.from({ length: 10 }, (_, index) =>
    `${index + 1} Author N${index}, Coauthor M. Trial of drug ${index}. N Engl J Med 2021;384:123-31. doi:10.1056/NEJMoa20${index}`
  );
  const original = [
    '## Results',
    'Trial data reported here.',
    '## Conclusions',
    'Closing remarks.',
    '',
    ...refs
  ].join('\n');

  const context = buildReadingSourceContext({ original, maxChars: 8000 });
  assert.match(context.prompt, /Closing remarks/);
  assert.equal(/N Engl J Med 2021/.test(context.prompt), false);
  assert.ok(context.removedSections.some((section) => section.includes('参考文献')));
});

test('does not treat in-text year mentions as a reference list', () => {
  const body = [
    '## Results',
    'In 2021; the trial enrolled 240 patients with bipolar disorder.',
    'A 2019 cohort showed similar effects across age groups.',
    'The 2020 guideline recommended lithium as first line.',
    'Our 2022 analysis replicated the pattern in older adults.'
  ].join('\n');

  const context = buildReadingSourceContext({ original: body, maxChars: 4000 });
  assert.match(context.prompt, /2022 analysis replicated/);
  assert.equal(context.removedSections.length, 0);
});

test('parses table visual and preserves it through round-trip', () => {
  const markdown = `# 阅读图解

体裁：干预性试验方法学对比

主旨：横向比对三种给药方案的有效性与不良反应发生率。

主线：方案比对矩阵

## 方案疗效与安全性对照

要点：三组方案在总有效率上无统计学差异，但 C 组胃肠道不良反应发生率显著更低。

| 方案 | 样本量 (n) | 总有效率 (%) | 不良反应率 (%) |
| --- | --- | --- | --- |
| 方案 A | 120 | 85.2 | 14.5 |
| 方案 B | 118 | 84.7 | 13.8 |
| 方案 C | 122 | 86.1 | 4.9 |

拆解：
- A/B 方案机制接近，疗效相当。
- C 方案由于缓释设计，耐受性明显改善。

出处：结果部分表 3
`;

  const doc = parseReadingVisualsDocument(markdown);
  assert.equal(doc.cards.length, 1);
  const card = doc.cards[0];
  assert.equal(card.visual.kind, 'table');
  if (card.visual.kind === 'table') {
    assert.deepEqual(card.visual.columns, ['方案', '样本量 (n)', '总有效率 (%)', '不良反应率 (%)']);
    assert.equal(card.visual.rows.length, 3);
    assert.equal(card.visual.rows[2][0], '方案 C');
  }

  const prepared = prepareReadingVisuals(markdown);
  assert.ok(prepared);
  assert.match(prepared, /\| 方案 \| 样本量 \(n\) \|/);
  const reparsed = parseReadingVisualsDocument(prepared);
  assert.equal(reparsed.cards[0].visual.kind, 'table');
});
