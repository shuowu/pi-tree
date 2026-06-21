/**
 * Pure mention-parsing logic extracted from the router extension.
 *
 * Two-pass approach:
 *   Pass 1 — keyword mentions: @Keyword, @Keyword:Feed, @Keyword#tag
 *   Pass 2 — source-title fuzzy search for remaining @mentions
 */

export interface MentionKeywordConfig {
  key: string;
  mentionKeyword?: string;
  fixedSourceId?: string;
  defaultMode: string;
  sessionModes: string[];
  sessionStrategy?: string;
}

export interface SourceSearchResult {
  id: string;
  title: string;
  type: string;
}

export interface ParsedMention {
  raw: string;
  sourceType: string | null;
  sourceId?: string | null;
  sourceTitle?: string;
  defaultMode?: string;
  sessionModes?: string[];
  sessionStrategy?: string;
  tags?: string[];
  /** Generic qualifier from `:value` syntax (e.g. feed name, channel, database) */
  qualifier?: string;
  error?: string;
}

export interface MentionParseResult {
  mentions: ParsedMention[];
  plainText: string;
  /** YouTube URL detected in the message (if any) */
  youtubeUrl?: string;
}

export function parseMentions(
  message: string,
  sourceTypeConfigs: MentionKeywordConfig[],
  searchSources: (query: string) => SourceSearchResult[],
): MentionParseResult {
  // Build keyword → config lookup
  const keywordMap = new Map<string, MentionKeywordConfig>();
  for (const st of sourceTypeConfigs) {
    if (st.mentionKeyword) {
      keywordMap.set(st.mentionKeyword.toLowerCase(), st);
    }
  }

  const mentions: ParsedMention[] = [];
  const consumedRanges: Array<[number, number]> = [];

  // Pass 0: detect YouTube URLs
  const youtubeUrlRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?[^\s]*v=[a-zA-Z0-9_-]{11}|youtu\.be\/[a-zA-Z0-9_-]{11}|youtube\.com\/(?:embed|v|shorts)\/[a-zA-Z0-9_-]{11})[^\s]*/gi;
  const ytMatch = youtubeUrlRegex.exec(message);
  const youtubeUrl = ytMatch ? ytMatch[0] : undefined;

  // Pass 1: keyword mentions — @Keyword, @Keyword:Qualifier, @Keyword#tag
  const keywordRegex = /@(\w+)(?::([^#@\s][^#@]*))?(?:#(\w+))?/g;
  let match: RegExpExecArray | null;

  while ((match = keywordRegex.exec(message)) !== null) {
    const [raw, keyword, qualifier, tag] = match;
    const keyLower = keyword.toLowerCase();

    const sourceType = keywordMap.get(keyLower);
    if (sourceType) {
      const mention: ParsedMention = {
        raw,
        sourceType: sourceType.key,
        sourceId: sourceType.fixedSourceId ?? null,
        defaultMode: sourceType.defaultMode,
        sessionModes: sourceType.sessionModes,
      };
      if (tag) mention.tags = [tag];
      if (qualifier) mention.qualifier = qualifier.trim();
      if (sourceType.sessionStrategy) mention.sessionStrategy = sourceType.sessionStrategy;
      mentions.push(mention);
      consumedRanges.push([match.index, match.index + raw.length]);
    }
  }

  // Pass 2: remaining @mentions as source-title fuzzy search
  const titleRegex = /@(\w+(?:\s+\w+)*)/g;
  while ((match = titleRegex.exec(message)) !== null) {
    const [raw, keyword] = match;
    const start = match.index;
    const end = start + raw.length;

    // Skip if this range overlaps with a keyword match from pass 1
    if (consumedRanges.some(([s, e]) => start < e && end > s)) continue;

    const sources = searchSources(keyword);
    if (sources.length > 0) {
      const best = sources[0];
      const stInfo = sourceTypeConfigs.find(st => st.key === best.type);
      mentions.push({
        raw,
        sourceType: best.type,
        sourceId: best.id,
        sourceTitle: best.title,
        defaultMode: stInfo?.defaultMode ?? "reading",
        sessionModes: stInfo?.sessionModes ?? ["reading"],
      });
    } else {
      mentions.push({
        raw,
        sourceType: null,
        sourceId: null,
        error: `No source found matching "${keyword}"`,
      });
    }
    consumedRanges.push([start, end]);
  }

  // Build plain text by removing all consumed mention ranges
  const sortedRanges = [...consumedRanges].sort((a, b) => b[0] - a[0]);
  let plainText = message;
  for (const [start, end] of sortedRanges) {
    plainText = plainText.slice(0, start) + plainText.slice(end);
  }
  plainText = plainText.replace(/\s+/g, " ").trim();

  return { mentions, plainText, ...(youtubeUrl ? { youtubeUrl } : {}) };
}
