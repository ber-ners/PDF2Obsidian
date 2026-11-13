export interface BilingualSegment {
  source: string;
  markdown: string;
}

export interface BilingualMarkdownResult {
  segments: BilingualSegment[];
  markdown: string;
  warnings: string[];
}

interface Block {
  kind: string;
  text: string;
}

/** Pair only matching Markdown structures; keep unmatched sections intact. */
export function createBilingualMarkdown(original: string, translated: string): BilingualMarkdownResult {
  const source = stripNoteMetadata(original);
  const target = stripNoteMetadata(translated);
  if (!source || !target || source === target) {
    return { markdown: source || target, warnings: [], segments: splitBlocks(source || target).map(block => ({ source: block.text, markdown: block.text })) };
  }
  const left = splitSections(splitBlocks(source));
  const right = splitSections(splitBlocks(target));
  const warnings: string[] = [];
  if (left.length !== right.length || left.some((section, i) => section.heading?.kind !== right[i]?.heading?.kind)) {
    return {
      markdown: `${source}\n\n${target}`,
      segments: [{ source, markdown: `${source}\n\n${target}` }],
      warnings: ['原文与译文的标题结构不同，已完整保留两份正文，未自动配对。']
    };
  }
  const segments: BilingualSegment[] = [];
  const appendPair = (a: Block, b: Block) => segments.push({ source: a.text, markdown: pairBlocks(a, b) });
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    if (a.heading && b.heading) appendPair(a.heading, b.heading);
    if (a.body.length === b.body.length && a.body.every((block, j) => block.kind === b.body[j]?.kind)) {
      a.body.forEach((block, j) => appendPair(block, b.body[j]!));
    } else {
      // A translator may merge or split paragraphs. Do not shift every later pair.
      const source = a.body.map(block => block.text).join('\n\n');
      const target = b.body.map(block => block.text).join('\n\n');
      segments.push({ source, markdown: [source, target].filter(Boolean).join('\n\n') });
      warnings.push(`“${a.heading?.text.replace(/^#+\s*/, '') ?? '文首'}”段落结构不同，已按整节保留中英内容。`);
    }
  }
  return { markdown: segments.map(segment => segment.markdown).filter(Boolean).join('\n\n'), warnings, segments };
}

export function stripNoteMetadata(markdown: string): string {
  return markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim();
}

function pairBlocks(source: Block, target: Block): string {
  if (source.text === target.text) return source.text;
  if (source.kind.startsWith('heading:')) {
    return `${source.text.replace(/\s+#+\s*$/, '')}　${target.text.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '')}`;
  }
  return `${source.text}\n\n${target.text}`;
}

function splitSections(blocks: Block[]) {
  const sections: Array<{ heading?: Block; body: Block[] }> = [{ body: [] }];
  for (const block of blocks) {
    if (block.kind.startsWith('heading:')) sections.push({ heading: block, body: [] });
    else sections[sections.length - 1]!.body.push(block);
  }
  return sections;
}

function splitBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.trim()) { i++; continue; }
    const start = i;
    const line = lines[i]!;
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    const math = /^\s*\$\$/.test(line);
    const html = /^\s*<(table|pre|div)\b/i.exec(line);
    if (fence) {
      i++;
      const closing = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`);
      while (i < lines.length && !closing.test(lines[i]!)) i++;
      if (i < lines.length) i++;
    } else if (math) {
      i++;
      if (!/^\s*\$\$[\s\S]+\$\$\s*$/.test(line)) {
        while (i < lines.length && !/\$\$\s*$/.test(lines[i]!)) i++;
        if (i < lines.length) i++;
      }
    } else if (html) {
      i++;
      const closing = new RegExp(`</${html[1]}>`, 'i');
      if (!closing.test(line)) {
        while (i < lines.length && !closing.test(lines[i]!)) i++;
        if (i < lines.length) i++;
      }
    } else if (/^#{1,6}\s+/.test(line)) {
      i++;
    } else {
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (/^#{1,6}\s+|^ {0,3}(?:`{3,}|~{3,})|^\s*\$\$|^\s*<(?:table|pre|div)\b/.test(next)) break;
        if (!next.trim()) {
          // Blank lines inside a list do not create independent bilingual pairs.
          let following = i + 1;
          while (following < lines.length && !lines[following]!.trim()) following++;
          if (isList(line) && /^(?:\s+\S|\s*[-+*]\s|\s*\d+[.)]\s)/.test(lines[following] ?? '')) {
            i = following;
            continue;
          }
          break;
        }
        if (isList(next) && !isList(line)) break;
        i++;
      }
    }
    const text = lines.slice(start, i).join('\n').trim();
    const heading = /^(#{1,6})\s+/.exec(text);
    const kind = heading ? `heading:${heading[1]!.length}` : fence ? 'code' : math ? 'math'
      : html ? `html:${html[1]!.toLowerCase()}` : isList(line) ? 'list'
      : /^\s*>/.test(line) ? 'quote' : /^\s*\|/.test(line) ? 'table'
      : /^!\[.*\]\(/.test(line) ? 'image' : 'paragraph';
    blocks.push({ kind, text });
  }
  return blocks;
}

function isList(line: string): boolean {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}
