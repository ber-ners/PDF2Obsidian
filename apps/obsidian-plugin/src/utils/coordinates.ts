/**
 * Coordinate mapping, normalization, and semantic classification for MinerU layout blocks.
 *
 * Maps normalized 0..1000 MinerU coordinates directly to CSS percentage styles
 * for zoom-invariant and device-pixel-ratio independent overlay rendering.
 */

export type SemanticRole =
  | 'title'
  | 'body'
  | 'equation'
  | 'table'
  | 'image'
  | 'caption'
  | 'footnote'
  | 'reference'
  | 'header'
  | 'footer';

export interface BboxStyles {
  left: string;
  top: string;
  width: string;
  height: string;
}

export interface LayoutBlock {
  id: string;
  page: number; // 1-indexed PDF page number
  bbox?: [number, number, number, number]; // [x0, y0, x1, y1] normalized to 0..1000
  type: string;
  role: SemanticRole;
  markdown: string;
  image?: string;
  continuationOf?: string;
}

/**
 * Sanitizes and validates a raw bounding box array.
 * Clamps coordinates to integers within [0, 1000].
 * Returns undefined if array is invalid or has non-positive area.
 */
export function sanitizeBbox(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;

  const [x0, y0, x1, y1] = raw.map((n) => Math.min(1000, Math.max(0, Math.round(n))));
  if (x1 <= x0 || y1 <= y0) return undefined;

  return [x0, y0, x1, y1];
}

/**
 * Computes exact CSS percentage positioning styles from normalized MinerU coordinates (0..1000).
 * Formula:
 *   left   = x0 / 10 %
 *   top    = y0 / 10 %
 *   width  = (x1 - x0) / 10 %
 *   height = (y1 - y0) / 10 %
 */
export function calculateBboxStyles(bbox: unknown): BboxStyles | null {
  const sanitized = sanitizeBbox(bbox);
  if (!sanitized) {
    return null;
  }
  const [x0, y0, x1, y1] = sanitized;
  return {
    left: `${x0 / 10}%`,
    top: `${y0 / 10}%`,
    width: `${(x1 - x0) / 10}%`,
    height: `${(y1 - y0) / 10}%`
  };
}

/**
 * Classifies MinerU block type into standard semantic role taxonomy.
 */
export function classifyBlockRole(type?: string, textLevel?: number): SemanticRole {
  if (type === 'title' || (typeof textLevel === 'number' && textLevel >= 1 && textLevel <= 6)) {
    return 'title';
  }
  if (type === 'equation' || type === 'interline_equation') {
    return 'equation';
  }
  if (type === 'table' || type === 'table_body') {
    return 'table';
  }
  if (type === 'image' || type === 'chart' || type === 'image_body') {
    return 'image';
  }
  if (type === 'table_caption' || type === 'image_caption' || type === 'caption') {
    return 'caption';
  }
  if (type === 'footnote') {
    return 'footnote';
  }
  if (type === 'reference' || type === 'ref_text') {
    return 'reference';
  }
  if (type === 'header') {
    return 'header';
  }
  if (type === 'footer') {
    return 'footer';
  }
  return 'body';
}

/**
 * Parses and normalizes raw MinerU content_list items into structured LayoutBlocks.
 * Preserves multi-page and cross-column continuation relationships.
 */
export function parseMineruBlocks(rawItems: unknown): LayoutBlock[] {
  if (!Array.isArray(rawItems)) return [];
  const blocks: LayoutBlock[] = [];
  let lastBodyId: string | null = null;

  for (let idx = 0; idx < rawItems.length; idx++) {
    const item = rawItems[idx];
    if (!item || typeof item !== 'object') continue;

    const rawItem = item as Record<string, unknown>;
    if (typeof rawItem.page_idx !== 'number' || rawItem.page_idx < 0) continue;

    const page = rawItem.page_idx + 1;
    const blockId = `block-${idx}`;
    const bbox = sanitizeBbox(rawItem.bbox);
    const type = typeof rawItem.type === 'string' ? rawItem.type : 'text';
    const textLevel = typeof rawItem.text_level === 'number' ? rawItem.text_level : undefined;
    const role = classifyBlockRole(type, textLevel);

    let markdown = typeof rawItem.text === 'string' ? rawItem.text.trim() : '';
    if (role === 'title' && textLevel) {
      markdown = `${'#'.repeat(textLevel)} ${markdown}`;
    } else if (role === 'table' && typeof rawItem.table_body === 'string') {
      markdown = rawItem.table_body;
    } else if (role === 'caption') {
      if (Array.isArray(rawItem.table_caption)) {
        markdown = rawItem.table_caption.join(' ');
      } else if (Array.isArray(rawItem.image_caption)) {
        markdown = rawItem.image_caption.join(' ');
      }
    }

    const block: LayoutBlock = {
      id: blockId,
      page,
      bbox,
      type,
      role,
      markdown,
      image: typeof rawItem.img_path === 'string' ? rawItem.img_path : undefined
    };

    // Continuation handling
    if (!markdown && typeof rawItem.continuationOf === 'string') {
      block.continuationOf = rawItem.continuationOf;
    } else if (!markdown && role === 'body' && lastBodyId) {
      block.continuationOf = lastBodyId;
    } else if (role === 'body' && markdown) {
      lastBodyId = blockId;
    }

    blocks.push(block);
  }

  return blocks;
}

// =========================================================================
// Splitter, Viewport, and Selection State Management Utilities
// =========================================================================

export const DEFAULT_STORAGE_KEY = 'pdf2obsidian.reader.split';
export const DEFAULT_SPLIT_STORAGE_KEY = DEFAULT_STORAGE_KEY;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

export function clampSplitRatio(val: number, min = MIN_SPLIT_RATIO, max = MAX_SPLIT_RATIO): number {
  if (typeof val !== 'number' || isNaN(val)) return DEFAULT_SPLIT_RATIO;
  return Math.min(max, Math.max(min, val));
}

// Backward-compatibility alias
export const clampRatio = clampSplitRatio;

export function stepSplitRatio(current: number, delta: number, min = MIN_SPLIT_RATIO, max = MAX_SPLIT_RATIO): number {
  return clampSplitRatio(parseFloat((current + delta).toFixed(4)), min, max);
}

// Backward-compatibility alias
export const stepRatio = stepSplitRatio;

export function handleSplitterKey(
  key: string,
  currentRatio: number,
  min = MIN_SPLIT_RATIO,
  max = MAX_SPLIT_RATIO,
  defaultRatio = DEFAULT_SPLIT_RATIO
): number {
  if (key === 'ArrowLeft') return stepSplitRatio(currentRatio, -0.02, min, max);
  if (key === 'ArrowRight') return stepSplitRatio(currentRatio, 0.02, min, max);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  if (key === 'Enter') return defaultRatio;
  return currentRatio;
}

export function calculateCanvasDimensions(
  viewportWidth: number,
  viewportHeight: number,
  dpr: number
): { width: number; height: number } {
  return {
    width: Math.ceil(viewportWidth * dpr),
    height: Math.ceil(viewportHeight * dpr)
  };
}

export function getPageNumbers(numPages: number): number[] {
  if (!numPages || numPages <= 0) return [];
  return Array.from({ length: numPages }, (_, i) => i + 1);
}

// Backward-compatibility alias
export const generatePageNumbers = getPageNumbers;

export function groupBlocksByPage(blocks: LayoutBlock[]): Map<number, LayoutBlock[]> {
  const map = new Map<number, LayoutBlock[]>();
  for (const b of blocks) {
    const pageList = map.get(b.page) || [];
    pageList.push(b);
    map.set(b.page, pageList);
  }
  return map;
}

export interface ReaderSelectionState {
  activeBlockId: string | null;
  activeSegmentId: string | null;
  source: 'pdf' | 'markdown' | null;
  sequence: number;
}

export function createInitialSelectionState(): ReaderSelectionState {
  return {
    activeBlockId: null,
    activeSegmentId: null,
    source: null,
    sequence: 0
  };
}

export function updateSelectionState(
  prev: ReaderSelectionState | null | undefined,
  selectedId: string,
  source: 'pdf' | 'markdown',
  segments?: Array<{ id: string; blockIds?: string[] }>
): ReaderSelectionState {
  const seq = (prev?.sequence || 0) + 1;
  if (source === 'pdf') {
    const matchingSeg = segments?.find((s) => s.blockIds?.includes(selectedId));
    return {
      activeBlockId: selectedId,
      activeSegmentId: matchingSeg ? matchingSeg.id : null,
      source: 'pdf',
      sequence: seq
    };
  } else {
    const seg = segments?.find((s) => s.id === selectedId);
    const targetBlockId =
      seg && seg.blockIds && seg.blockIds.length > 0
        ? seg.blockIds[0]
        : selectedId.startsWith('block-')
          ? selectedId
          : null;
    return {
      activeBlockId: targetBlockId,
      activeSegmentId: selectedId,
      source: 'markdown',
      sequence: seq
    };
  }
}

// Backward-compatibility aliases
export const updateReaderSelection = updateSelectionState;
export const updateSelection = (
  current: { sequence: number; activeBlockId?: string | null; activeSegmentId?: string | null; source?: 'pdf' | 'markdown' | null },
  segments: Array<{ id: string; blockIds?: string[] }>,
  targetId: string,
  source: 'pdf' | 'markdown'
) => updateSelectionState(current as ReaderSelectionState, targetId, source, segments);

export function clearSelectionState(prev?: ReaderSelectionState | { sequence: number } | null): ReaderSelectionState {
  return {
    activeBlockId: null,
    activeSegmentId: null,
    source: null,
    sequence: (prev?.sequence || 0) + 1
  };
}

// Backward-compatibility aliases
export const clearReaderSelection = clearSelectionState;
export const clearSelection = clearSelectionState;

export function isSegmentActive(
  segment: { id: string; blockIds?: string[] },
  selection?: { activeBlockId?: string | null; activeSegmentId?: string | null } | null
): boolean {
  if (!selection) return false;
  return Boolean(
    (selection.activeBlockId && segment.blockIds && segment.blockIds.includes(selection.activeBlockId)) ||
    (selection.activeSegmentId && selection.activeSegmentId === segment.id)
  );
}

