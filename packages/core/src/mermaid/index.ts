import { render, detectType, supports, type RenderOptions, type RenderResult } from 'pele';

export interface MermaidValidationResult {
  valid: boolean;
  type?: string;
  error?: string;
}

/**
 * Validates a Mermaid diagram string using Pele.
 * Returns whether it is valid, the detected diagram type, and error message if invalid.
 */
export function validateMermaid(source: string): MermaidValidationResult {
  const trimmed = source.trim();
  if (!trimmed) {
    return { valid: false, error: 'Empty Mermaid diagram source' };
  }

  const detected = detectType(trimmed);
  if (!detected) {
    return { valid: false, error: 'No diagram type detected for the given text' };
  }

  if (!supports(trimmed)) {
    return { valid: false, type: detected, error: `Diagram type '${detected}' is not supported by Pele` };
  }

  try {
    const result = render(trimmed);
    return { valid: true, type: result.type };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, type: detected, error: message };
  }
}

/**
 * Sanitizes and repairs common LLM-generated Mermaid syntax issues,
 * such as unquoted special characters and parentheses inside node brackets.
 */
export function sanitizeMermaidCode(raw: string): string {
  if (!raw) return '';

  let cleaned = raw.trim();
  // Strip code fences if whole block was passed
  cleaned = cleaned.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 交互指令属于安全隐患，且 LLM 常把正文链接误写成 click，直接剔除而不是让整张图报废。
  cleaned = cleaned
    .split('\n')
    .filter((line) => !/^\s*(?:click|links?)\b/i.test(line))
    .join('\n')
    .trim();

  // 逐行修复节点标签：括号、冒号、逗号、斜杠、百分号等符号未加引号是最常见的崩溃原因。
  cleaned = cleaned.split('\n').map(repairNodeLabels).join('\n');

  return cleaned;
}

interface LabelPattern {
  pattern: RegExp;
  open: string;
  close: string;
}

// 只接受「闭合符号后面是空白 / 行尾 / 连线」的形态，避免把正文里的括号误判成节点。
const labelContinuation = String.raw`(?=\s|$|;|-->|-.->|==>|---|===)`;
const labelPatterns: LabelPattern[] = [
  {
    pattern: new RegExp(String.raw`([A-Za-z0-9_\-\u4e00-\u9fff]+)\[([^"\[\]\n]*?)\]${labelContinuation}`, 'g'),
    open: '[',
    close: ']'
  },
  {
    pattern: new RegExp(String.raw`([A-Za-z0-9_\-\u4e00-\u9fff]+)\{([^"{}\n]*?)\}${labelContinuation}`, 'g'),
    open: '{',
    close: '}'
  },
  {
    pattern: new RegExp(String.raw`([A-Za-z0-9_\-\u4e00-\u9fff]+)\(\(([^"()\n]+?)\)\)${labelContinuation}`, 'g'),
    open: '((',
    close: '))'
  },
  {
    pattern: new RegExp(String.raw`([A-Za-z0-9_\-\u4e00-\u9fff]+)\(([^"()\n]+?)\)${labelContinuation}`, 'g'),
    open: '(',
    close: ')'
  }
];

const needsQuote = /[()（）[\]{}:：,，&/\\%|<>"'=+#@~;]/;

// 这些行不是节点定义，改动会破坏 xychart / sequence / timeline 等原生语法。
const nonNodeLine = /^\s*(?:subgraph|end\b|classDef|class\b|style\b|linkStyle|direction|title\b|accTitle|accDescr|bar\b|line\b|x-axis|y-axis|xychart|quadrant|axis\b|section\b|dateFormat|note\b|participant|actor)/;

function repairNodeLabels(line: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? '';
  const body = line.slice(indent.length);
  if (!body || nonNodeLine.test(body)) return line;
  // 时序图的消息文本里常常带括号，误加引号会污染消息内容。
  if (/->>|-->>|->>|:/.test(body) && !/[\[{]/.test(body)) return line;

  // 已经加过引号的片段整体跳过，避免二次包裹。
  const segments = body.split(/("[^"]*")/g);
  const repaired = segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      let next = segment;
      for (const { pattern, open, close } of labelPatterns) {
        next = next.replace(pattern, (match, id: string, content: string) => {
          const trimmed = content.trim();
          if (!trimmed || !needsQuote.test(trimmed)) return match;
          return `${id}${open}"${trimmed.replace(/"/g, "'")}"${close}`;
        });
      }
      return next;
    })
    .join('');

  return `${indent}${repaired}`;
}

/**
 * Extracts the first Mermaid code block from a markdown document.
 */
export function extractMermaidCode(markdown: string): string | null {
  if (!markdown) return null;
  const match = /```mermaid\s*([\s\S]*?)```/i.exec(markdown);
  return match && match[1] ? sanitizeMermaidCode(match[1]) : null;
}

/**
 * Generates an optimized, highly structured prompt for creating an academic paper flowchart
 * designed specifically for rapid comprehension.
 */
export function buildPaperWorkflowPrompt(input: {
  title: string;
  translatedTitle?: string;
  context: string;
  focus?: 'methodology' | 'experiment' | 'overview';
}): string {
  const { title, translatedTitle = title, context, focus = 'methodology' } = input;

  const focusGuide = focus === 'experiment'
    ? '重点梳理实验链路：数据集准备 -> 对比基准 (Baselines) -> 消融实验设计 -> 评价指标 (Metrics) -> 核心结论。'
    : focus === 'overview'
    ? '重点梳理全篇逻辑全景：问题提出与背景 -> 现有方法瓶颈 -> 本文核心方案 -> 实验验证链路 -> 核心贡献。'
    : '重点梳理核心方法论与算法架构：数据输入 -> 特征工程/编码 -> 核心算法机制与创新模块 -> 损失函数/优化目标 -> 最终输出。';

  return [
    `请为学术论文《${title}》（中文名：《${translatedTitle}》）生成结构化研究流程图 workflow.md，核心目标是辅助读者快速直观理解论文脉络。`,
    '',
    `流程图侧重点：${focusGuide}`,
    '',
    '硬性要求：',
    '1. 第一行标题必须是 `# 论文流程图`。',
    '2. 必须包含返回索引链接：`返回索引：[[INDEX_LINK]]`，保持 INDEX_LINK 原样。',
    '3. 必须包含且仅包含一个规范的 ```mermaid ... ``` 代码块：',
    '   - 必须使用 `flowchart TD`（从上至下）或 `flowchart LR`（从左至右）格式。',
    '   - 必须使用 `subgraph` 划分 3 到 5 个清晰阶段（例如：输入准备、核心模型架构、训练与优化、实验评估与产出）。',
    '   - 节点文本必须简洁、严谨，包含中英文对照说明，例如：NodeA["原始输入数据<br/>(Raw Input)"]。',
    '   - 包含特殊符号或括号的节点标签必须使用双引号包裹，例如：NodeB["编码器 (Transformer Encoder)"]，避免解析错误。',
    '   - 连线上注明流转关系或数据变换（例如：`-->|特征提取|`、`-->|反向传播|`）。',
    '4. 在 Mermaid 代码块下方，提供【流程阶段深度解析】：',
    '   - 分章节逐一解释流程图中的每个阶段与关键步骤。',
    '   - 说明论文的关键创新点（Key Innovation）和核心解决思路。',
    '   - 说明核心输入、输出及评估方式。',
    '5. 内容必须严格基于论文文本，不臆造虚假信息。',
    '',
    '论文内容节选：',
    context
  ].join('\n');
}

/**
 * Synchronously renders Mermaid diagram source code to an SVG string using Pele.
 */
export function renderMermaidSvg(source: string, options?: RenderOptions): RenderResult {
  return render(source, options);
}

export { detectType as detectMermaidType, supports as supportsMermaid, type RenderOptions, type RenderResult };
