/**
 * Open Library grounding provider.
 *
 * Validates and enriches LLM-proposed book titles against a real catalog so
 * hallucinated titles/authors are dropped and survivors get a cover + link.
 *
 * Chosen because it's free, needs no API key (fits BYOK/local-first), and
 * returns everything a suggestion card needs. Behind the GroundingProvider
 * interface so Google Books can drop in later.
 *
 * The raw search endpoint happily returns "2 Books Collection Set", "…in 30
 * Minutes" summaries, study guides and boxed sets ahead of the real work, so we
 * re-rank results ourselves: title coverage of the proposed title, a penalty for
 * bundle/summary noise, and `edition_count` (canonical works have many editions;
 * derivatives have few) as a popularity signal.
 *
 * Docs: https://openlibrary.org/dev/docs/api/search
 */

import type { GroundedBook, GroundingProvider } from "../types.js";

const SEARCH_URL = "https://openlibrary.org/search.json";
const COVER_URL = "https://covers.openlibrary.org/b/id";
const WORK_URL = "https://openlibrary.org";

/** Fields we ask Open Library to return — keeps the response small. */
const FIELDS = "title,author_name,first_publish_year,cover_i,key,subject,isbn,edition_count";

/** Titles that are almost always derivatives/bundles, not the work we want. */
const NOISE =
  /\b(box(ed)?\s*set|collection\s*set|\d+\s*books?\s*(collection|set|bundle|box)|bundle|summary|summaries|study\s*guide|workbook|companion|in\s*\d+\s*minutes|quicklet|sidekick|instaread|blinkist|conversation\s*starters?|unabridged|abridged|audiobook|audio\s*cd|teacher'?s?\s*guide|key\s*takeaways?|analysis\s+of)\b/i;

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  key?: string; // e.g. "/works/OL12345W"
  subject?: string[];
  isbn?: string[];
  edition_count?: number;
}

/** Normalize a title/author for comparison: lowercase, strip punctuation, collapse spaces. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class OpenLibraryGroundingProvider implements GroundingProvider {
  /** Process-lifetime cache: normalized "title|author" → results. Avoids re-querying (and re-leaking) the same titles. */
  private cache = new Map<string, GroundedBook[]>();

  constructor(private readonly limit = 5) {}

  async search(title: string, author?: string): Promise<GroundedBook[]> {
    const cacheKey = `${norm(title)}|${author ? norm(author) : ""}`;
    if (!cacheKey.replace("|", "")) return [];
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const docs = await this.fetchDocs(title, author);
    const proposedTitle = norm(title);
    const proposedTokens = new Set(proposedTitle.split(" ").filter(Boolean));

    const ranked = docs
      .filter((d) => d.title)
      .map((d) => ({ doc: d, ...this.assess(d, proposedTitle, proposedTokens, author) }))
      // Require the match to actually cover the proposed title — guards against
      // Open Library returning an unrelated popular book for a bad query.
      .filter((r) => r.coverage >= 0.5 || r.exact)
      .sort((a, b) => b.score - a.score);

    const results = ranked.map((r) => this.toGroundedBook(r.doc));
    this.cache.set(cacheKey, results);
    return results;
  }

  /** Precise title/author query first; fall back to free-text if it yields nothing. */
  private async fetchDocs(title: string, author?: string): Promise<OpenLibraryDoc[]> {
    const params = new URLSearchParams();
    params.set("title", title);
    if (author) params.set("author", author);
    params.set("limit", String(this.limit));
    params.set("fields", FIELDS);

    let docs = await this.request(`${SEARCH_URL}?${params.toString()}`);
    if (docs.length === 0) {
      const q = new URLSearchParams({
        q: author ? `${title} ${author}` : title,
        limit: String(this.limit),
        fields: FIELDS,
      });
      docs = await this.request(`${SEARCH_URL}?${q.toString()}`);
    }
    return docs;
  }

  private async request(url: string): Promise<OpenLibraryDoc[]> {
    try {
      const res = await fetch(url, {
        headers: {
          // Open Library asks callers to identify themselves.
          "User-Agent": "pi-tree-reading-list/0.1 (https://github.com/earendil-works/pi-tree)",
        },
      });
      if (!res.ok) {
        console.warn(`[discover] Open Library search failed: ${res.status}`);
        return [];
      }
      const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
      return data.docs ?? [];
    } catch (err) {
      console.warn(`[discover] Open Library search error:`, err);
      return [];
    }
  }

  /** Score a candidate doc against the proposed title/author. Higher is better. */
  private assess(
    doc: OpenLibraryDoc,
    proposedTitle: string,
    proposedTokens: Set<string>,
    author?: string,
  ): { score: number; coverage: number; exact: boolean } {
    const docTitle = norm(doc.title ?? "");
    const docTokens = docTitle.split(" ").filter(Boolean);
    const exact = docTitle === proposedTitle;

    // How much of the proposed title is present in the doc title.
    const overlap = docTokens.filter((t) => proposedTokens.has(t)).length;
    const coverage = proposedTokens.size ? overlap / proposedTokens.size : 0;

    let score = exact ? 5 : coverage * 3;

    // Penalize titles far longer than proposed — the hallmark of bundles.
    const extra = Math.max(0, docTokens.length - proposedTokens.size);
    score -= Math.min(extra, 8) * 0.3;

    // Bundle/summary/study-guide noise.
    if (NOISE.test(doc.title ?? "")) score -= 4;

    // Canonical works have many editions; derivatives have few.
    score += Math.min(Math.log2((doc.edition_count ?? 0) + 1), 6) * 0.5;

    // A cover is a small quality signal.
    if (doc.cover_i) score += 0.5;

    // Author match.
    if (author) {
      const authors = (doc.author_name ?? []).map(norm).join(" ");
      const an = norm(author);
      if (authors.includes(an) || an.split(" ").some((t) => t.length > 2 && authors.includes(t))) {
        score += 1.5;
      }
    }

    return { score, coverage, exact };
  }

  private toGroundedBook(d: OpenLibraryDoc): GroundedBook {
    const ids: Record<string, string> = {};
    if (d.key) ids.openlibrary = d.key;
    if (d.isbn && d.isbn.length) ids.isbn = d.isbn[0];

    return {
      title: d.title ?? "",
      authors: d.author_name ?? [],
      year: d.first_publish_year ?? null,
      coverUrl: d.cover_i ? `${COVER_URL}/${d.cover_i}-M.jpg` : null,
      subjects: (d.subject ?? []).slice(0, 8),
      ids,
      sourceUrl: d.key ? `${WORK_URL}${d.key}` : null,
    };
  }
}
