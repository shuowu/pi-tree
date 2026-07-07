/**
 * Book DiscoverProvider — recommends books NOT already in the library.
 *
 * The LLM proposes titles from the interest model; each is validated against
 * Open Library so only real, resolvable books survive. Books already in the
 * library are excluded — they're the signal, not the recommendation.
 */

import type {
  Candidate,
  DiscoverContext,
  DiscoverProvider,
  InterestModel,
} from "../types.js";
import { OpenLibraryGroundingProvider } from "../grounding/open-library.js";

interface ProposedBook {
  title: string;
  author?: string;
  reason: string;
}

/** Normalize a title for comparison: lowercase, strip punctuation, collapse spaces. */
function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** True if two normalized titles are equal or one meaningfully contains the other. */
function titleMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.includes(short);
}

export class BookDiscoverProvider implements DiscoverProvider {
  readonly sourceType = "book";

  /** Grounding is book-specific, so the provider owns it. */
  private grounding = new OpenLibraryGroundingProvider();

  async getCandidates(interest: InterestModel, ctx: DiscoverContext): Promise<Candidate[]> {
    // Only recommends books not already in the library, which requires grounding.
    if (!ctx.allowExternalLookup) return [];
    return this.groundedSuggestions(interest, ctx);
  }

  // -------------------------------------------------------------------------
  // Grounded LLM suggestions (LLM proposes → Open Library validates)
  // -------------------------------------------------------------------------

  private async groundedSuggestions(interest: InterestModel, ctx: DiscoverContext): Promise<Candidate[]> {
    ctx.log("Proposing books from your interests…");
    const proposed = await this.propose(interest, ctx);
    if (proposed.length === 0) return [];
    ctx.log(`Validating ${proposed.length} titles against Open Library…`);

    const ownedTitles = interest.ownedSources.map((s) => normTitle(s.title));
    const isOwned = (t: string) => ownedTitles.some((o) => titleMatch(o, t));
    const seen = new Set<string>();
    const out: Candidate[] = [];

    for (const p of proposed) {
      const titleKey = normTitle(p.title);
      if (isOwned(titleKey) || seen.has(titleKey)) continue;

      const hits = await this.grounding.search(p.title, p.author);
      const match = hits[0];
      if (!match) continue; // unresolvable → drop (likely hallucinated)

      const matchKey = normTitle(match.title);
      if (isOwned(matchKey) || seen.has(matchKey)) continue;
      seen.add(titleKey);
      seen.add(matchKey);

      out.push({
        kind: "acquire",
        sourceType: "book",
        title: match.title,
        author: match.authors[0] ?? p.author,
        year: match.year,
        coverUrl: match.coverUrl,
        url: match.sourceUrl,
        reason: p.reason,
        ids: match.ids,
      });
      if (out.length >= ctx.count) break;
    }

    return out;
  }

  private async propose(interest: InterestModel, ctx: DiscoverContext): Promise<ProposedBook[]> {
    const ownedList = interest.ownedSources
      .map((s) => `- ${s.title}${s.author ? ` (${s.author})` : ""}`)
      .join("\n") || "(none yet)";

    const diversityHint =
      ctx.diversity >= 0.6
        ? "Bias toward broadening: include some books from adjacent fields that extend the reader beyond their current topics."
        : ctx.diversity <= 0.2
          ? "Stay tightly on-topic: closely related to the concepts below."
          : "Mostly on-topic, but include one or two that broaden the reader's horizons.";

    // Over-fetch so we still hit `count` after grounding drops unresolvable titles.
    const ask = Math.max(ctx.count * 2, ctx.count + 3);

    const prompt = [
      "You recommend nonfiction books to a reader based on what they have been reading.",
      "",
      "Their reading so far (concepts they've engaged with, notes they kept):",
      interest.digest,
      "",
      "Books already in their library (DO NOT recommend these):",
      ownedList,
      "",
      `Suggest ${ask} books they do NOT already own that build on the concepts above.`,
      diversityHint,
      "Each reason MUST tie the book to a specific concept or theme from their reading — one sentence.",
      "Prefer well-known, real books (correct title and author) so they can be found in a catalog.",
      "",
      'Respond with ONLY a JSON array, no prose, no code fences:',
      '[{"title": "...", "author": "...", "reason": "..."}]',
    ].join("\n");

    const raw = await ctx.llm(prompt);
    return this.parseProposals(raw);
  }

  private parseProposals(raw: string): ProposedBook[] {
    // Tolerate code fences / surrounding prose by extracting the first JSON array.
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x.title === "string" && typeof x.reason === "string")
        .map((x) => ({
          title: x.title.trim(),
          author: typeof x.author === "string" ? x.author.trim() : undefined,
          reason: x.reason.trim(),
        }));
    } catch {
      return [];
    }
  }
}
