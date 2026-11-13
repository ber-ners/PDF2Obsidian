import YAML from 'yaml';

export function parsePaperMetadata(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown.trimStart());
  if (!match) return {};

  try {
    const parsed: unknown = YAML.parse(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      // Hide absent values; preserve numbers such as a zero citation count.
      const values = (Array.isArray(value) ? value : [value])
        .filter((item): item is string | number | boolean =>
          typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
      const text = values.map(String).map((item) => item.trim()).filter(Boolean).join('、');
      return text ? [[key, text]] : [];
    }));
  } catch {
    return {};
  }
}

export function createMetadataRows(metadata: Record<string, string>): Array<{ label: string; value: string }> {
  const candidates = [
    ['paperTitle', '原文标题'],
    ['translatedTitle', '中文标题'],
    ['authors', '作者'],
    ['year', '年份'],
    ['journal', '期刊/会议'],
    ['publisher', '出版社'],
    ['doi', 'DOI'],
    ['metadataSources', '元数据来源'],
    ['keywords', '关键词'],
    ['fieldsOfStudy', '研究领域']
  ];
  if (!metadata.paperTitle && !metadata.translatedTitle) candidates.unshift(['title', '标题']);
  return candidates.flatMap(([key, label]) => {
    const value = metadata[key] || (key === 'journal' ? metadata.venue : undefined);
    return value ? [{ label, value }] : [];
  });
}
