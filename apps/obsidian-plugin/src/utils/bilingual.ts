/**
 * Utilities for aligned bilingual text presentation and layout block linking.
 *
 * Implements section- and paragraph-level alignment of English and Chinese texts,
 * math formula and code block invariance preservation, and bi-directional linking
 * with MinerU layout blocks.
 */

import type { LayoutBlock } from './coordinates';
import katex from 'katex';

export interface BilingualSegmentItem {
  id: string;
  sourceText: string;
  translatedText?: string;
  combinedMarkdown: string;
  blockIds: string[];
  role?: string;
  headingLevel?: number;
}

export interface MarkdownSection {
  heading: string | null;
  paragraphs: string[];
  raw: string;
}

export function isInvariantBlock(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
    (trimmed.startsWith('```') && trimmed.endsWith('```')) ||
    /^!\[.*\]\(.*\)$/.test(trimmed)
  );
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderMathSafely(tex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false
    });
  } catch {
    return `<span class="katex-error" style="color: var(--text-error); font-family: monospace;">${escapeHtml(tex)}</span>`;
  }
}

export function hasChinese(text: string): boolean {
  return /[\p{Script=Han}]/u.test(text || '');
}

export function splitIntoSections(markdown: string): MarkdownSection[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let currentHeading: string | null = null;
  let currentParas: string[] = [];
  let buffer: string[] = [];
  let inCodeBlock = false;
  let inMathBlock = false;

  const flushBuffer = () => {
    if (buffer.length > 0) {
      const p = buffer.join('\n').trim();
      if (p) currentParas.push(p);
      buffer = [];
    }
  };

  const flushSection = () => {
    flushBuffer();
    if (currentHeading || currentParas.length > 0) {
      sections.push({
        heading: currentHeading,
        paragraphs: currentParas,
        raw: (currentHeading ? currentHeading + '\n\n' : '') + currentParas.join('\n\n')
      });
    }
    currentHeading = null;
    currentParas = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    } else if (trimmed.startsWith('$$') && !trimmed.endsWith('$$') && trimmed.length > 2) {
      inMathBlock = !inMathBlock;
    } else if (trimmed === '$$') {
      inMathBlock = !inMathBlock;
    }

    if (!inCodeBlock && !inMathBlock && /^#{1,6}\s+/.test(line)) {
      flushSection();
      currentHeading = line.trim();
    } else if (!inCodeBlock && !inMathBlock && trimmed === '') {
      flushBuffer();
    } else {
      buffer.push(line);
    }
  }
  flushSection();
  return sections;
}

/**
 * Creates aligned bilingual markdown text from English source and Chinese translation.
 * Pairs headings on a single line separated by an ideographic space (`\u3000`),
 * aligns body paragraphs pairwise, and preserves math equations and code blocks intact.
 */
export function createBilingualMarkdown(sourceMd: string, targetMd: string): string {
  if (!sourceMd && !targetMd) return '';
  if (!targetMd) return sourceMd;
  if (!sourceMd) return targetMd;

  const sourceSections = splitIntoSections(sourceMd);
  const targetSections = splitIntoSections(targetMd);

  const combinedSections: string[] = [];
  const maxSec = Math.max(sourceSections.length, targetSections.length);

  for (let i = 0; i < maxSec; i++) {
    const src = sourceSections[i];
    const tgt = targetSections[i];

    if (!src && tgt) {
      combinedSections.push(tgt.raw);
      continue;
    }
    if (src && !tgt) {
      combinedSections.push(src.raw);
      continue;
    }
    if (!src || !tgt) continue;

    // Align section heading
    let headerLine = '';
    if (src.heading && tgt.heading) {
      const level = src.heading.match(/^#+/)?.[0] || '#';
      const srcTitle = src.heading.replace(/^#+\s*/, '').trim();
      const tgtTitle = tgt.heading.replace(/^#+\s*/, '').trim();
      headerLine = `${level} ${srcTitle}\u3000${tgtTitle}\n\n`;
    } else if (src.heading) {
      headerLine = `${src.heading}\n\n`;
    }

    // Align paragraphs within section
    const alignedParagraphs: string[] = [];
    const srcParas = src.paragraphs;
    const tgtParas = tgt.paragraphs;
    const maxP = Math.max(srcParas.length, tgtParas.length);

    for (let p = 0; p < maxP; p++) {
      const sp = srcParas[p];
      const tp = tgtParas[p];

      if (sp && tp) {
        if (isInvariantBlock(sp)) {
          alignedParagraphs.push(sp);
        } else {
          alignedParagraphs.push(`${sp}\n\n${tp}`);
        }
      } else if (sp) {
        alignedParagraphs.push(sp);
      } else if (tp) {
        alignedParagraphs.push(tp);
      }
    }

    combinedSections.push(headerLine + alignedParagraphs.join('\n\n'));
  }

  return combinedSections.join('\n\n').trim();
}

/**
 * Normalizes text for matching layout blocks, preserving Unicode letters and digits.
 */
function normalizeText(text: string): string {
  return (text || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

/**
 * Links bilingual text segments to MinerU layout blocks.
 * Associates continuation blocks with their parent segments.
 * Unicode-aware matching preserves CJK characters and avoids empty string false matches.
 */
export function linkBilingualSegments(
  segments: Array<Partial<BilingualSegmentItem> & Record<string, any>>,
  blocks: LayoutBlock[]
): BilingualSegmentItem[] {
  return segments.map((seg, idx) => {
    const sourceNorm = normalizeText(seg.sourceText || '');
    const transNorm = normalizeText(seg.translatedText || '');
    const combinedNorm = normalizeText(seg.combinedMarkdown || '');
    const matchedBlockIds: string[] = [];

    for (const b of blocks) {
      const blockNorm = normalizeText(b.markdown || '');
      if (!blockNorm) continue;

      const matchesSource =
        sourceNorm.length > 0 &&
        (sourceNorm === blockNorm ||
          sourceNorm.includes(blockNorm) ||
          blockNorm.includes(sourceNorm) ||
          sourceNorm.slice(0, 30) === blockNorm.slice(0, 30));

      const matchesTrans =
        transNorm.length > 0 &&
        (transNorm === blockNorm ||
          transNorm.includes(blockNorm) ||
          blockNorm.includes(transNorm) ||
          transNorm.slice(0, 30) === blockNorm.slice(0, 30));

      const matchesCombined =
        combinedNorm.length > 0 &&
        (combinedNorm === blockNorm ||
          combinedNorm.includes(blockNorm) ||
          blockNorm.includes(combinedNorm));

      if (matchesSource || matchesTrans || matchesCombined) {
        matchedBlockIds.push(b.id);
      }
    }

    // Check continuation blocks whose parent is already matched
    for (const b of blocks) {
      if (b.continuationOf && matchedBlockIds.includes(b.continuationOf) && !matchedBlockIds.includes(b.id)) {
        matchedBlockIds.push(b.id);
      }
    }

    const assignedBlockIds =
      seg.blockIds && seg.blockIds.length > 0
        ? seg.blockIds
        : matchedBlockIds.length > 0
          ? matchedBlockIds
          : [`block-${idx}`];

    return {
      id: seg.id || `seg-${idx}`,
      sourceText: seg.sourceText || '',
      translatedText: seg.translatedText,
      combinedMarkdown: seg.combinedMarkdown || seg.sourceText || '',
      blockIds: assignedBlockIds,
      role: seg.role,
      headingLevel: seg.headingLevel
    };
  });
}

/**
 * Parses aligned bilingual markdown into structured BilingualSegmentItem list.
 * Faithfully pairs interleaved English and Chinese paragraphs into { sourceText, translatedText, role } segments.
 */
export function parseBilingualMarkdown(bilingualMarkdown: string): BilingualSegmentItem[] {
  if (!bilingualMarkdown) return [];

  // Strip YAML frontmatter block if present
  const cleanedMarkdown = bilingualMarkdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

  const sections = splitIntoSections(cleanedMarkdown);
  const segments: BilingualSegmentItem[] = [];
  let segIndex = 0;

  for (const sec of sections) {
    const isExplicitBilingualSection = Boolean(sec.heading && sec.heading.includes('\u3000'));

    if (sec.heading) {
      const headingMatch = sec.heading.match(/^(#{1,6})\s+(.*)$/);
      const level = headingMatch ? headingMatch[1].length : 1;
      const headingBody = headingMatch ? headingMatch[2] : sec.heading;

      let enTitle = headingBody;
      let zhTitle: string | undefined = undefined;

      if (headingBody.includes('\u3000')) {
        const parts = headingBody.split('\u3000');
        enTitle = parts[0].trim();
        zhTitle = parts.slice(1).join('\u3000').trim();
      }

      segments.push({
        id: `seg-${segIndex++}`,
        sourceText: enTitle,
        translatedText: zhTitle,
        combinedMarkdown: sec.heading,
        blockIds: [],
        role: 'title',
        headingLevel: level
      });
    }

    const paras = sec.paragraphs;
    let i = 0;

    while (i < paras.length) {
      const para = paras[i];

      if (isInvariantBlock(para)) {
        const role = para.startsWith('$$') ? 'equation' : para.startsWith('```') ? 'code' : 'image';
        segments.push({
          id: `seg-${segIndex++}`,
          sourceText: para,
          translatedText: undefined,
          combinedMarkdown: para,
          blockIds: [],
          role
        });
        i++;
        continue;
      }

      // Check if para itself has subparts already separated by multiple newlines
      const subParts = para.split(/\n\n+/);
      if (subParts.length >= 2) {
        const en = subParts[0].trim();
        const zh = subParts.slice(1).join('\n\n').trim();
        segments.push({
          id: `seg-${segIndex++}`,
          sourceText: en,
          translatedText: zh,
          combinedMarkdown: para,
          blockIds: [],
          role: 'body'
        });
        i++;
        continue;
      }

      // Lookahead pairing with next paragraph
      const nextPara = i + 1 < paras.length ? paras[i + 1] : null;

      const canPairWithNext =
        nextPara !== null &&
        !isInvariantBlock(nextPara) &&
        (
          (!hasChinese(para) && hasChinese(nextPara)) ||
          (hasChinese(para) && !hasChinese(nextPara)) ||
          (/^(en|eng|english)\b/i.test(para) && /^(zh|chi|chinese)\b/i.test(nextPara)) ||
          (isExplicitBilingualSection && (hasChinese(nextPara) || hasChinese(para))) ||
          (!hasChinese(para) && !hasChinese(nextPara) && paras.length === 2 && !sec.heading)
        );

      if (canPairWithNext && nextPara) {
        segments.push({
          id: `seg-${segIndex++}`,
          sourceText: para.trim(),
          translatedText: nextPara.trim(),
          combinedMarkdown: `${para}\n\n${nextPara}`,
          blockIds: [],
          role: 'body'
        });
        i += 2; // Consume both paragraphs
      } else {
        segments.push({
          id: `seg-${segIndex++}`,
          sourceText: para.trim(),
          translatedText: undefined,
          combinedMarkdown: para.trim(),
          blockIds: [],
          role: 'body'
        });
        i++;
      }
    }
  }

  return segments;
}

