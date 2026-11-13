import { detectMermaidType, sanitizeMermaidCode, validateMermaid } from '../mermaid/index.js';

const heading = '# 阅读图解';

// 主线环节 2–5 个，留一点余量给模型偶尔多写一环。
const maxCards = 6;
// 放宽到 50 行，让 subgraph 分阶段、带边标签的架构图有足够表达空间。
const maxDiagramLines = 50;
const maxTableColumns = 6;
const maxTableRows = 12;

const diagramLabels = new Map<string, string>([
  ['flowchart', '流程与机制'],
  ['sequence', '时序与依赖'],
  ['mindmap', '概念拆解'],
  ['state', '状态流转'],
  ['quadrant', '权衡象限'],
  ['timeline', '演进时间线'],
  ['sankey', '流向与分配'],
  ['xychart', '数值与趋势'],
  ['pie', '构成占比'],
  ['gantt', '时间计划'],
  ['class', '结构关系'],
  ['er', '实体关系'],
  ['git', '分支演进']
]);

export type ReadingVisual =
  | {
    kind: 'diagram';
    code: string;
    label: string;
    type?: string | undefined;
    valid: boolean;
    error?: string | undefined;
  }
  | { kind: 'table'; markdown: string; columns: string[]; rows: string[][]; label: string }
  | { kind: 'none'; label: string; reason?: string | undefined };

export interface ReadingVisualCard {
  /** 环节标题 */
  title: string;
  /** 逻辑衔接：承接上一环的结论或遗留问题 */
  bridge?: string | undefined;
  /** 核心要点：读图时必须抓住的结论或核对点 */
  takeaway: string;
  /** 机制拆解：为什么这样设计、口径如何统一、瓶颈在哪 */
  breakdown: string[];
  /** 原文出处：章节名 / 图号 / 表号 */
  source: string;
  visual: ReadingVisual;
  warnings: string[];
}

export interface ReadingVisualsDocument {
  /** 论文体裁，例如「临床伞状综述与循证评价」 */
  genre?: string | undefined;
  /** 全文主旨，一句话贯通痛点、方案与结论 */
  thesis?: string | undefined;
  /** 逻辑主线：2–5 个递进环节 */
  thread: string[];
  cards: ReadingVisualCard[];
  warnings: string[];
}

export function buildReadingVisualsPrompt(input: { title: string; context: string }): string {
  return [
    `为《${input.title}》制作一组「阅读图解」，目标是让人顺着图把这篇论文的逻辑读下来，而不是看几张孤立的统计小图。`,
    '',
    '先在内部完成两步规划，再一次性输出结果：',
    '第一步（全局骨架）：判断论文体裁，用一句话说清全文主旨（痛点 → 方案 → 结论），并按论文真实结构拆出 2–5 个递进环节，形成一条逻辑主线。',
    '第二步（逐环成图）：沿着主线一环一环往下画，每一环只回答一个「读者在这一步必须看懂什么」。',
    '',
    '严格输出下面的结构，不要写前言、结语、自我评价或多余解释：',
    '',
    heading,
    '',
    '体裁：论文体裁（例如：临床伞状综述与循证评价 / 方法学论文 / 单中心回顾性队列 / 机制研究）',
    '',
    '主旨：一句话贯通全文痛点、核心方案与结论',
    '',
    '主线：证据整合与 GRADE 分级方法学 -> 跨阶段核心干预疗效矩阵 -> 作用机制与临床转化路径',
    '',
    '## 环节标题（一个具体的机制、步骤或权衡，不要写成「结果」「讨论」这类空标题）',
    '',
    '衔接：一句话说明本环节承接上一环的哪个结论，或补上了哪个缺口。第一环写清全文要解决的起点问题。',
    '',
    '要点：一句话给出读这张图时必须抓住的结论、反直觉之处或需要核对的口径（不超过 120 字，不要复述图里的标签）。',
    '',
    '这里放一个完整的 ```mermaid 代码块，或一张完整的 Markdown 对照表；确实不适合画图时，写一行：（无图，仅文字说明）',
    '',
    '拆解：',
    '- 3–5 条：这条结论背后的机制、为什么这样设计、口径是否可比、瓶颈或例外在哪',
    '',
    '出处：原文可核对的章节名、图号或表号；没有编号就写原文小标题，禁止猜测编号。',
    '',
    '图表类型按「读者要理解什么」来选，不要为了好看凑图：',
    '- 步骤、机制、因果链、模块数据流 → flowchart TD（阶段多时用 subgraph 分组，边上写清流转内容，例如 A -->|标准化效应量| B）。',
    '- 多个分组、证据等级、方法学口径的横向对比 → Markdown 对照表（最多 6 列、12 行），不要硬画成图。',
    '- 数值随条件变化、剂量-效应、时间趋势 → xychart-beta，只用正文明确报告的数值，一张图只画一个指标并标注单位。',
    '- 两个维度的取舍（疗效 vs 安全性、成本 vs 效果、收益 vs 风险） → quadrantChart。',
    '- 多主体之间的先后调用或依赖 → sequenceDiagram；阶段演进 → timeline；概念层级 → mindmap；状态迁移 → stateDiagram-v2。',
    '',
    '硬性约束：',
    '1. 数量 2–5 张，张数与主线环节数一致；宁可少而深，不要多而浅，也不要两张图讲同一件事。',
    '2. 主线的每一项是与对应卡片标题一致的短标签（4–14 字），不要写「环节一 / 第一部分 / Step 1」这类空序号；卡片标题也不要带序号前缀，界面会自动编号。',
    '3. 只使用正文明确给出的数值、样本量、效应量与编号。原文没报告的写「原文未报告」，绝不自行推算或编造。',
    '4. 箭头必须对应原文的因果、流程或数据流向，不能只为了排版好看。',
    '5. 节点标签以中文为主，保留必要英文术语；标签里出现括号、冒号、逗号、斜杠、百分号等符号时，必须整体加双引号，例如 NodeA["编码器 (Transformer Encoder)"]。',
    '6. 单张图不超过 50 行，禁止 click、超链接、HTML 与外部资源指令。',
    '7. 每张卡片的「衔接」要能把上一环接起来，读完 2–5 条的衔接与要点，应该能复述全文论证链。',
    '',
    '论文内容（含大纲与正文摘录）',
    input.context
  ].join('\n');
}

export interface ReadingSourceContextInput {
  original?: string | undefined;
  translated?: string | undefined;
  maxChars: number;
}

export interface ReadingSourceContext {
  /** 可直接拼进 prompt 的上下文块 */
  prompt: string;
  /** 从正文中提取的标题大纲 */
  outline: string[];
  /** 被剔除的后置噪音章节标题 */
  removedSections: string[];
}

const backMatterHeadings = new Set([
  'references', 'reference', 'reference list', 'bibliography', 'works cited', 'literature cited',
  'references and notes', 'notes and references',
  'acknowledgment', 'acknowledgments', 'acknowledgement', 'acknowledgements',
  'author contributions', 'authors contributions', 'author contribution', 'contribution', 'contributions',
  'contributors', 'contributor information',
  'competing interests', 'competing interest', 'conflict of interest', 'conflicts of interest',
  'declaration of interests', 'declarations', 'declaration of competing interest',
  'funding', 'financial support', 'funding sources', 'role of the funding source', 'role of funding source',
  'data availability', 'availability of data', 'data availability statement', 'data sharing',
  'supplementary material', 'supplementary materials', 'supplementary information', 'supporting information',
  'appendix', 'appendices', 'abbreviations', 'ethics statement', 'ethics approval',
  'author affiliations', 'authors affiliations', 'authors affiliation', 'affiliations', 'affiliation',
  'author information', 'author details', 'author list', 'authors',
  'correspondence', 'corresponding author', 'corresponding authors',
  'provenance and peer review', 'provenance', 'peer review',
  'copyright', 'license', 'orcid', 'permissions', 'reprints',
  '参考文献', '参考书目', '致谢', '作者贡献', '作者贡献声明', '作者单位', '作者信息', '作者简介',
  '通讯作者', '通信作者', '利益冲突', '利益声明', '利益冲突声明', '基金资助', '基金项目', '资助信息',
  '数据可用性', '数据可用性声明', '数据共享', '补充材料', '附录', '缩略语', '版权',
  '来源与同行评审', '同行评审', '伦理声明', '伦理批准'
]);

function normalizeHeadingText(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*+|\*+$/g, '')
    // 「来源与同行评审：非约稿」这类标题把冒号后的说明截掉再比对
    .split(/[：:]/)[0]
    ?.replace(/\s+/g, ' ')
    .replace(/[.。]$/, '')
    .trim()
    .toLowerCase() ?? '';
}

function isBackMatterHeading(line: string): boolean {
  const raw = line.trim();
  if (!raw || raw.length > 100) return false;
  const isMarkdownHeading = /^#{1,6}\s/.test(raw);
  // 非标题行必须是短标题形态（无句读），避免正文句子里出现 references 被误伤。
  if (!isMarkdownHeading && (raw.length > 40 || /[。；;！!？?]/.test(raw))) return false;
  if (/\|/.test(raw)) return false;

  const text = normalizeHeadingText(raw);
  if (!text) return false;
  if (backMatterHeadings.has(text)) return true;
  const withoutParenthetical = text.replace(/[（(].*?[)）]/g, '').trim();
  if (backMatterHeadings.has(withoutParenthetical)) return true;
  return [...backMatterHeadings].some((entry) => (entry.includes(' ') || entry.length >= 4) && text.startsWith(entry));
}

// 无标题的参考文献块：连续出现的「编号 + 年份 / doi」条目，MinerU 常常不给它加标题。
const referenceEntry = /^\s*\d{1,3}[.)]?\s+\S.*(?:((?:19|20)\d{2})[;:.,]|doi|10\.\d{4,9}\/)/i;

function findReferenceListStart(lines: string[], fromIndex: number, toIndex: number): number {
  for (let index = fromIndex; index < toIndex; index += 1) {
    const line = lines[index] ?? '';
    if (!referenceEntry.test(line)) continue;
    let hits = 1;
    let checked = 1;
    for (let probe = index + 1; probe < lines.length && checked < 10; probe += 1) {
      const candidate = lines[probe] ?? '';
      if (!candidate.trim()) continue;
      checked += 1;
      if (referenceEntry.test(candidate)) hits += 1;
    }
    // 10 行里至少 6 行是文献条目，才认为是参考文献块
    if (hits >= Math.max(6, Math.ceil(checked * 0.6))) return index;
  }
  return -1;
}

/**
 * 去掉 frontmatter 与文末噪音章节（参考文献、致谢、作者单位、利益冲突、附录等），
 * 并抽取标题大纲，避免长论文被「掐头去尾」时丢掉方法与结果章节。
 */
export function stripReadingNoise(markdown: string): { body: string; removedSections: string[] } {
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  const lines = withoutFrontmatter.split('\n');
  const removedSections: string[] = [];
  const threshold = withoutFrontmatter.length * 0.3;
  const searchFrom = Math.floor(lines.length * 0.35);

  let offset = 0;
  let cutIndex = -1;
  for (const [index, line] of lines.entries()) {
    if (offset > threshold && isBackMatterHeading(line)) {
      cutIndex = index;
      removedSections.push(line.replace(/^#{1,6}\s*/, '').replace(/[*_]/g, '').trim());
      break;
    }
    offset += line.length + 1;
  }

  // 没有标题的参考文献块也要切掉，否则「尾部 35%」全是文献条目。
  const referenceStart = findReferenceListStart(lines, searchFrom, cutIndex >= 0 ? cutIndex : lines.length);
  if (referenceStart >= 0 && (cutIndex < 0 || referenceStart < cutIndex)) {
    cutIndex = referenceStart;
    removedSections.push('参考文献（无标题）');
  }

  const body = (cutIndex >= 0 ? lines.slice(0, cutIndex) : lines).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, removedSections };
}

/** 提取 markdown 标题大纲，保证方法 / 结果 / 讨论这些关键章节一定进上下文。 */
export function extractReadingOutline(markdown: string, limit = 60): string[] {
  const outline: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,4})\s+(.{1,80})$/.exec(line.trim());
    if (!match) continue;
    const text = match[2]?.replace(/[*_`]/g, '').trim();
    if (!text) continue;
    const entry = `${'  '.repeat(Math.max(0, (match[1]?.length ?? 1) - 1))}- ${text}`;
    if (!outline.includes(entry)) outline.push(entry);
    if (outline.length >= limit) break;
  }
  return outline;
}

function truncateHeadTail(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) return markdown;
  // 去掉文末噪音后，尾部就是讨论与结论，比例 65/35 比原先的 72/28 更适合收束论点。
  const headLength = Math.floor(maxChars * 0.65);
  const tailLength = maxChars - headLength;
  return [
    markdown.slice(0, headLength).trim(),
    '',
    '[中间内容因长度限制省略]',
    '',
    markdown.slice(-tailLength).trim()
  ].join('\n');
}

/**
 * 构造阅读材料的上下文：中英双语 + 提纯后的正文 + 全文大纲。
 * Core、Desktop Web 与 Obsidian 插件共用同一份实现，避免三端截断口径不一致。
 */
export function buildReadingSourceContext(input: ReadingSourceContextInput): ReadingSourceContext {
  const original = stripReadingNoise(input.original ?? '');
  const translated = stripReadingNoise(input.translated ?? '');
  const removedSections = [...new Set([...original.removedSections, ...translated.removedSections])];

  const originalBudget = Math.floor(input.maxChars / 2);
  const translatedBudget = input.maxChars - originalBudget;
  const sourceBody = translated.body || original.body;
  const outline = extractReadingOutline(sourceBody.length ? sourceBody : original.body);

  const blocks: string[] = [];
  if (outline.length) {
    blocks.push('## 全文大纲', outline.join('\n'), '');
  }

  if (original.body) {
    blocks.push('## 原文摘录（术语与指标依据）', truncateHeadTail(original.body, originalBudget), '');
  }

  if (translated.body) {
    blocks.push('## 译文摘录（中文表达依据）', truncateHeadTail(translated.body, translatedBudget), '');
  } else if (original.body) {
    // 没有译文时把剩余预算还给原文，避免上下文凭空缩水一半。
    blocks.push('## 补充原文', truncateHeadTail(original.body.slice(originalBudget), translatedBudget));
  }

  return {
    prompt: blocks.join('\n').trim(),
    outline,
    removedSections
  };
}

export function parseReadingVisuals(content = ''): ReadingVisualCard[] {
  return parseReadingVisualsDocument(content).cards;
}

export function parseReadingVisualsDocument(content = ''): ReadingVisualsDocument {
  const markdown = content.replace(/\r\n/g, '\n');
  const empty: ReadingVisualsDocument = { thread: [], cards: [], warnings: [] };
  if (!/^#\s*阅读图解[ \t]*$/m.test(markdown)) return empty;

  const [metaPart = '', ...cardParts] = markdown.split(/^##[ \t]+/m);
  const warnings: string[] = [];
  const genre = matchMetaField(metaPart, '体裁');
  const thesis = matchMetaField(metaPart, '主旨');
  const rawThread = splitThread(matchMetaField(metaPart, '主线'));

  const cards: ReadingVisualCard[] = [];
  for (const part of cardParts) {
    const card = parseCard(part);
    if (!card) continue;
    cards.push(card);
    if (cards.length >= maxCards) break;
  }

  // 模型常把主线照抄成「环节一 -> 环节二」，这类占位词没有导航价值，直接回退到卡片标题。
  const thread = resolveThread(rawThread, cards);

  if (!cards.length) warnings.push('reading-visuals: no card matched the contract');
  if (!thread.length) warnings.push('reading-visuals: missing overview thread');

  return { genre, thesis, thread, cards, warnings };
}

const placeholderThread = /^(?:环节|阶段|步骤|部分|第[一二三四五六七八九十百零\d]+(?:部分|步|环|环节)?|steps?\s*\d+|parts?\s*\d+)\s*[一二三四五六七八九十百零\d]*$/i;

// 「环节一：xxx」「第 2 部分 - xxx」「Step 3: xxx」这类前缀由界面统一编号，解析时剥掉。
const sequencePrefix = /^(?:环节|阶段|步骤|部分|第[一二三四五六七八九十百零\d]+(?:部分|步|环|环节)?|steps?\s*\d+|parts?\s*\d+)\s*[一二三四五六七八九十百零\d]*\s*[：:、.．\-—)）]\s*/i;

function stripSequencePrefix(title: string): string {
  const stripped = title.replace(sequencePrefix, '').trim();
  return stripped.length >= 2 ? stripped : title;
}

function resolveThread(thread: string[], cards: ReadingVisualCard[]): string[] {
  const fromCards = cards.map((card) => card.title).slice(0, 8);
  if (!thread.length) return fromCards;
  const usable = thread.filter((item) => !placeholderThread.test(item));
  if (usable.length === thread.length) return thread;
  // 有占位词时优先用卡片标题重排；标题数量不够就退回可用的主线项。
  return fromCards.length ? fromCards : usable;
}

function matchMetaField(text: string, label: string): string | undefined {
  const match = new RegExp(`^[ \\t]*(?:[-*]\\s*)?[*_]{0,2}${label}[*_]{0,2}[：:][ \\t]*(.+)$`, 'm').exec(text);
  const value = match?.[1]?.replace(/[*_`]/g, '').trim();
  return value ? value : undefined;
}

function splitThread(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:->|→|—>|⇒|›|=>)\s*/)
    .map((item) => item.replace(/^[\d０-９]+[.、)）]\s*/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

interface CardDraft {
  title: string;
  bridge: string[];
  takeaway: string[];
  breakdown: string[];
  source: string[];
  codeBlocks: string[];
  tableLines: string[];
}

function parseCard(raw: string): ReadingVisualCard | undefined {
  const lines = raw.split('\n');
  const title = (lines.shift() ?? '').trim().replace(/^#+\s*/, '');
  if (!title) return undefined;
  const draft: CardDraft = {
    title,
    bridge: [],
    takeaway: [],
    breakdown: [],
    source: [],
    codeBlocks: [],
    tableLines: []
  };

  let mode: 'idle' | 'bridge' | 'takeaway' | 'breakdown' | 'source' = 'idle';
  let inFence = false;
  let fenceLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (inFence) {
      if (trimmed.startsWith('```')) {
        inFence = false;
        if (fenceLines.length) draft.codeBlocks.push(fenceLines.join('\n'));
        fenceLines = [];
      } else {
        fenceLines.push(rawLine);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      inFence = true;
      fenceLines = [];
      continue;
    }

    const labeled = /^(?:\*\*)?(衔接|要点|拆解|出处|机制|读图要点)(?:\*\*)?[：:]\s*(.*)$/.exec(trimmed);
    if (labeled) {
      const label = labeled[1] === '机制' ? '拆解' : labeled[1] === '读图要点' ? '要点' : labeled[1];
      const rest = (labeled[2] ?? '').replace(/^\*\*|\*\*$/g, '').trim();
      if (label === '衔接') {
        mode = 'bridge';
        if (rest) draft.bridge.push(rest);
      } else if (label === '要点') {
        mode = 'takeaway';
        if (rest) draft.takeaway.push(rest);
      } else if (label === '拆解') {
        mode = 'breakdown';
        if (rest) draft.breakdown.push(rest.replace(/^[-*+]\s*/, ''));
      } else {
        mode = 'source';
        if (rest) draft.source.push(rest);
      }
      continue;
    }

    if (!trimmed) continue;

    // 模型按约定写的「无图」占位，不属于任何字段，直接忽略。
    if (/^[（(]?\s*无图/.test(trimmed)) {
      mode = 'idle';
      continue;
    }

    if (/^\|/.test(trimmed)) {
      draft.tableLines.push(trimmed);
      mode = 'idle';
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) continue;

    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (bullet) {
      const item = (bullet[1] ?? '').trim();
      if (mode === 'source') draft.source.push(item);
      else draft.breakdown.push(item);
      mode = 'breakdown';
      continue;
    }

    // 无标签的续行：按当前语义归位，绝不因为格式抖动丢内容。
    if (mode === 'source') draft.source.push(trimmed);
    else if (mode === 'bridge') draft.bridge.push(trimmed);
    else if (mode === 'takeaway') draft.takeaway.push(trimmed);
    else if (mode === 'breakdown') draft.breakdown.push(trimmed);
  }

  if (inFence && fenceLines.length) draft.codeBlocks.push(fenceLines.join('\n'));

  const takeaway = draft.takeaway.join(' ').replace(/\s+/g, ' ').trim();
  const bridge = draft.bridge.join(' ').replace(/\s+/g, ' ').trim();
  const source = draft.source.join(' ').replace(/\s+/g, ' ').trim();
  const breakdown = draft.breakdown
    .map((item) => item.replace(/\s+/g, ' ').replace(/[*_`]/g, '').trim())
    .filter(Boolean);

  const hasVisualInput = draft.codeBlocks.length > 0 || draft.tableLines.length > 0;
  if (!takeaway && !breakdown.length && !hasVisualInput) return undefined;

  const visual = buildVisual(draft.codeBlocks, draft.tableLines.join('\n'));
  const warnings: string[] = [];
  if (!takeaway) warnings.push('missing takeaway');
  if (!source) warnings.push('missing source');

  return {
    title: stripSequencePrefix(title.replace(/[*_`]/g, '')),
    bridge: bridge || undefined,
    takeaway: takeaway || '（本次生成未给出要点，可直接读图与下方拆解）',
    breakdown,
    source: source || '原文未标注章节或图表编号',
    visual,
    warnings
  };
}

function buildVisual(codeBlocks: string[], tableMarkdown: string): ReadingVisual {
  for (const block of codeBlocks) {
    const code = sanitizeMermaidCode(block);
    if (!code) continue;
    const type = detectMermaidType(code);
    if (!type) continue;
    const label = diagramLabels.get(type) ?? type;
    const lineCount = code.split('\n').length;
    if (lineCount > maxDiagramLines) {
      return {
        kind: 'diagram',
        code,
        label,
        type,
        valid: false,
        error: `图表代码 ${lineCount} 行，超过 ${maxDiagramLines} 行上限，已保留卡片文字并展示源码`
      };
    }

    const result = validateMermaid(code);
    return {
      kind: 'diagram',
      code,
      label,
      type: result.type ?? type,
      valid: result.valid,
      error: result.valid ? undefined : (result.error ?? 'Mermaid 语法校验未通过')
    };
  }

  const table = parseTable(tableMarkdown);
  if (table) return table;

  return { kind: 'none', label: '文字说明', reason: codeBlocks.length ? '图表代码无法识别为 Mermaid 语法' : undefined };
}

function parseTable(markdown: string): ReadingVisual | undefined {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return undefined;
  if (!lines.every((line) => line.startsWith('|') && line.endsWith('|'))) return undefined;

  const parsedRows = lines.map((line) => line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()));
  const columns = parsedRows[0];
  const divider = parsedRows[1];
  const rows = parsedRows.slice(2);
  if (!columns || !divider) return undefined;
  if (columns.length < 2 || columns.length > maxTableColumns) return undefined;
  if (divider.length !== columns.length || !divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return undefined;
  if (rows.length > maxTableRows) return undefined;
  if (!rows.every((row) => row.length === columns.length)) return undefined;

  return { kind: 'table', markdown: lines.join('\n'), columns, rows, label: '对照表' };
}

/**
 * 把模型输出整理成稳定结构：卡片顺序、字段顺序与代码块都规范化，
 * 单张图语法失败时保留整张卡片（衔接 / 要点 / 拆解 / 出处），不再静默删卡。
 */
export function prepareReadingVisuals(raw: string): string | undefined {
  const document = parseReadingVisualsDocument(raw);
  if (!document.cards.length) return undefined;

  const head: string[] = [heading, ''];
  if (document.genre) head.push(`体裁：${document.genre}`, '');
  if (document.thesis) head.push(`主旨：${document.thesis}`, '');
  if (document.thread.length) head.push(`主线：${document.thread.join(' -> ')}`, '');

  const cards = document.cards.map((card) => {
    const block: string[] = [`## ${card.title}`, ''];
    if (card.bridge) block.push(`衔接：${card.bridge}`, '');
    block.push(`要点：${card.takeaway}`, '');

    if (card.visual.kind === 'diagram') {
      block.push('```mermaid', card.visual.code, '```', '');
    } else if (card.visual.kind === 'table') {
      block.push(card.visual.markdown, '');
    } else {
      block.push('（无图，仅文字说明）', '');
    }

    if (card.breakdown.length) {
      block.push('拆解：', ...card.breakdown.map((item) => `- ${item}`), '');
    }

    block.push(`出处：${card.source}`);
    return block.join('\n');
  });

  return [...head, ...cards].join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
