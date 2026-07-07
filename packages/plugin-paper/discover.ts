/**
 * Paper DiscoverProvider — recommends arXiv papers to read next.
 *
 * Unlike books (LLM proposes titles → grounded against a catalog), arXiv results
 * are already real, so grounding is unnecessary: we build a query from the reader's
 * interest topics, fetch real papers, then have the LLM select + annotate the best
 * ones. Excludes papers already in the library.
 */

import type {
  Candidate,
  DiscoverContext,
  DiscoverProvider,
  InterestModel,
} from "@pi-tree/plugin-sdk";
import { searchPapers, type ArxivEntry } from "./services/arxiv.js";

interface Pick {
  i: number;
  reason: string;
}

export class PaperDiscoverProvider implements DiscoverProvider {
  readonly sourceType = "paper";

  async getCandidates(interest: InterestModel, ctx: DiscoverContext): Promise<Candidate[]> {
    // Fetching arXiv is a network call — honour the privacy switch.
    if (!ctx.allowExternalLookup || interest.topics.length === 0) return [];

    ctx.log("Searching arXiv for related papers…");
    const papers = await this.fetchPapers(interest.topics);
    if (papers.length === 0) return [];

    // Exclude papers already in the library (by normalized title / arXiv id).
    const owned = interest.ownedSources.filter((s) => s.type === "paper");
    const ownedTitles = owned.map((s) => norm(s.title));
    const fresh = papers.filter((p) => !ownedTitles.some((t) => titleMatch(t, norm(p.title))));
    if (fresh.length === 0) return [];

    ctx.log(`Selecting the best of ${fresh.length} papers…`);
    const picks = await this.selectAndAnnotate(interest, ctx, fresh);
    return picks
      .map(({ i, reason }): Candidate | null => {
        const p = fresh[i];
        if (!p) return null;
        return {
          kind: "acquire",
          sourceType: "paper",
          title: p.title,
          author: p.authors[0],
          year: yearOf(p.published),
          url: p.abstractUrl,
          reason,
          ids: { arxiv: p.arxivId },
        };
      })
      .filter((c): c is Candidate => c !== null)
      .slice(0, ctx.count);
  }

  // -------------------------------------------------------------------------
  // Fetch — build a query from interest topics; arXiv results are already real
  // -------------------------------------------------------------------------

  private async fetchPapers(topics: string[]): Promise<ArxivEntry[]> {
    const query = topics
      .slice(0, 6)
      .map((t) => `all:"${t.replace(/"/g, "")}"`)
      .join(" OR ");
    try {
      let papers = await searchPapers(query, 14);
      if (papers.length === 0 && topics[0]) {
        papers = await searchPapers(topics[0], 14);
      }
      return dedupeById(papers);
    } catch (err) {
      console.warn("[discover] arXiv search failed:", err);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Select + annotate the best papers for this reader
  // -------------------------------------------------------------------------

  private async selectAndAnnotate(
    interest: InterestModel,
    ctx: DiscoverContext,
    papers: ArxivEntry[],
  ): Promise<Pick[]> {
    const list = papers
      .map((p, i) => `${i}. ${p.title}\n   ${p.summary.slice(0, 240)}`)
      .join("\n");

    const prompt = [
      "You recommend academic papers to a reader based on what they have been reading.",
      "",
      "Their interests (concepts and notes):",
      interest.digest,
      "",
      "Candidate papers (real arXiv results):",
      list,
      "",
      `Select the ${ctx.count} best-fitting papers for this reader.`,
      "Each reason must tie the paper to a specific concept/theme from their interests — one sentence.",
      "",
      'Respond with ONLY a JSON array, best first, no prose, no code fences:',
      '[{"i": <paper number>, "reason": "..."}]',
    ].join("\n");

    const parsed = this.parse(await ctx.llm(prompt), papers.length);
    // Fallback: if the model returned nothing usable, take the top results.
    if (parsed.length === 0) {
      return papers.slice(0, ctx.count).map((_, i) => ({
        i,
        reason: "Relevant to the topics you've been reading about.",
      }));
    }
    return parsed;
  }

  private parse(raw: string, n: number): Pick[] {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];
      const seen = new Set<number>();
      return arr
        .filter((x) => x && Number.isInteger(x.i) && x.i >= 0 && x.i < n && typeof x.reason === "string")
        .filter((x) => (seen.has(x.i) ? false : (seen.add(x.i), true)))
        .map((x) => ({ i: x.i, reason: x.reason.trim() }));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** True if two normalized titles are the same or one contains the other. */
function titleMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.includes(short);
}

function yearOf(published: string): number | null {
  const y = parseInt(published.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function dedupeById(papers: ArxivEntry[]): ArxivEntry[] {
  const seen = new Set<string>();
  const out: ArxivEntry[] = [];
  for (const p of papers) {
    if (seen.has(p.arxivId)) continue;
    seen.add(p.arxivId);
    out.push(p);
  }
  return out;
}
