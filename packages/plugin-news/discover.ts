/**
 * News feed DiscoverProvider — recommends new feeds to subscribe to.
 *
 * Unlike the book provider (which recommends works to acquire), this extends the
 * user's *feeds collection*: RSS/Atom sites and YouTube channels (whose per-channel
 * RSS endpoint makes "add a channel" the same as "add a feed").
 *
 * Grounding for feeds = "resolve a proposed source to a real, working feed URL and
 * validate it parses." We only ever surface feeds that actually fetch + parse, so
 * a broken/hallucinated suggestion never reaches the user.
 */

import type {
  Candidate,
  DiscoverContext,
  DiscoverProvider,
  InterestModel,
} from "@pi-tree/plugin-sdk";
import type { IRssService } from "./rss-service.js";

interface ProposedFeed {
  name: string;
  kind: "rss" | "youtube";
  /** Homepage, feed URL, or YouTube channel URL/handle. */
  url: string;
  tags?: string[];
  reason: string;
}

interface ResolvedFeed {
  feedUrl: string;
  title: string;
  siteUrl: string;
}

const UA = { "User-Agent": "Mozilla/5.0 pi-tree-reading-list/0.1 (+https://github.com/earendil-works/pi-tree)" };
const FETCH_TIMEOUT_MS = 8000;
const COMMON_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/index.xml", "/atom.xml", "/feed.xml"];

export class NewsFeedDiscoverProvider implements DiscoverProvider {
  readonly sourceType = "news";

  constructor(private readonly rss: IRssService) {}

  async getCandidates(interest: InterestModel, ctx: DiscoverContext): Promise<Candidate[]> {
    // Resolving feeds requires network fetches — honour the privacy switch.
    if (!ctx.allowExternalLookup) return [];

    const existing = await this.rss.listFeeds().catch(() => []);
    const existingUrls = new Set(existing.map((f) => normUrl(f.url)));
    const existingDomains = new Set(
      existing.map((f) => domainOf(f.url)).filter((d) => d && !d.includes("youtube.com")),
    );

    ctx.log("Proposing feeds and channels to follow…");
    const proposals = await this.propose(interest, ctx, existing.map((f) => f.name));
    if (proposals.length) ctx.log(`Resolving & validating ${proposals.length} feeds…`);
    const out: Candidate[] = [];
    const seen = new Set<string>();

    for (const p of proposals) {
      if (out.length >= ctx.count) break;
      const resolved = await this.resolve(p).catch(() => null);
      if (!resolved) continue;

      const key = normUrl(resolved.feedUrl);
      if (seen.has(key) || existingUrls.has(key)) continue;
      // For non-YouTube, also skip a site the user already follows via another path.
      const dom = domainOf(resolved.feedUrl);
      if (p.kind !== "youtube" && dom && existingDomains.has(dom)) continue;
      seen.add(key);

      out.push({
        kind: "acquire",
        sourceType: "news",
        title: resolved.title || p.name,
        reason: p.reason,
        url: resolved.siteUrl,
        addFeed: {
          id: slugify(resolved.title || p.name),
          name: resolved.title || p.name,
          url: resolved.feedUrl,
          tags: (p.tags ?? []).slice(0, 4),
        },
      });
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Proposal (LLM)
  // -------------------------------------------------------------------------

  private async propose(
    interest: InterestModel,
    ctx: DiscoverContext,
    existingNames: string[],
  ): Promise<ProposedFeed[]> {
    const diversityHint =
      ctx.diversity >= 0.6
        ? "Include some sources from adjacent fields that broaden the reader beyond their current topics."
        : ctx.diversity <= 0.2
          ? "Stay tightly on-topic."
          : "Mostly on-topic, with one or two that broaden horizons.";
    const ask = Math.max(ctx.count * 2, ctx.count + 3);

    const prompt = [
      "You recommend RSS feeds and YouTube channels to follow, based on what a reader has been reading.",
      "",
      "Their interests (concepts and notes):",
      interest.digest,
      "",
      "Feeds they ALREADY follow (do NOT recommend these):",
      existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(none yet)",
      "",
      `Suggest ${ask} high-quality sources they likely don't follow yet.`,
      diversityHint,
      "Prefer well-known publications, blogs, and YouTube channels that actually publish feeds.",
      "For each, give the real homepage URL (for a site) or channel URL (for YouTube, e.g. https://www.youtube.com/@handle).",
      "If you know the exact RSS/Atom feed URL, put THAT in url instead — it's more reliable.",
      "Each reason must tie the source to a specific concept/theme from their interests — one sentence.",
      "",
      'Respond with ONLY a JSON array, no prose, no code fences:',
      '[{"name":"...","kind":"rss"|"youtube","url":"...","tags":["..."],"reason":"..."}]',
    ].join("\n");

    return this.parse(await ctx.llm(prompt));
  }

  private parse(raw: string): ProposedFeed[] {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x.name === "string" && typeof x.url === "string" && typeof x.reason === "string")
        .map((x) => ({
          name: x.name.trim(),
          kind: x.kind === "youtube" ? "youtube" : "rss",
          url: x.url.trim(),
          tags: Array.isArray(x.tags) ? x.tags.filter((t: unknown) => typeof t === "string") : [],
          reason: x.reason.trim(),
        }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Grounding — resolve a proposal to a real, validated feed URL
  // -------------------------------------------------------------------------

  private async resolve(p: ProposedFeed): Promise<ResolvedFeed | null> {
    if (p.kind === "youtube") return this.resolveYouTube(p);
    return this.resolveRss(p);
  }

  private async resolveRss(p: ProposedFeed): Promise<ResolvedFeed | null> {
    const site = safeUrl(p.url);
    if (!site) return null;

    // Candidate feed URLs, in priority order: the proposed URL itself, then
    // common feed paths off its origin.
    const tries = [p.url, ...COMMON_PATHS.map((path) => new URL(path, site.origin).href)];
    for (const u of dedupeStrings(tries)) {
      const xml = await fetchText(u);
      if (xml && isFeed(xml)) {
        return { feedUrl: u, title: feedTitle(xml) || p.name, siteUrl: site.origin };
      }
    }

    // Fallback: homepage <link rel="alternate"> autodiscovery.
    const html = await fetchText(site.href);
    for (const u of discoverFeedLinks(html, site.href)) {
      const xml = await fetchText(u);
      if (xml && isFeed(xml)) {
        return { feedUrl: u, title: feedTitle(xml) || p.name, siteUrl: site.href };
      }
    }
    return null;
  }

  private async resolveYouTube(p: ProposedFeed): Promise<ResolvedFeed | null> {
    // Already a channel feed?
    if (/youtube\.com\/feeds\/videos\.xml/i.test(p.url)) {
      const xml = await fetchText(p.url);
      return xml && isFeed(xml) ? { feedUrl: p.url, title: feedTitle(xml) || p.name, siteUrl: p.url } : null;
    }
    // channel_id directly in URL?
    let channelId = p.url.match(/channel\/(UC[\w-]+)/)?.[1] ?? p.url.match(/channel_id=(UC[\w-]+)/)?.[1] ?? null;
    let siteUrl = p.url;
    if (!channelId) {
      // Fetch the channel page and read ITS own id (canonical / externalId),
      // never the first "channelId" (which is often a *related* channel).
      const html = await fetchText(p.url);
      channelId =
        html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)">/)?.[1] ??
        html.match(/"externalId":"(UC[\w-]+)"/)?.[1] ??
        null;
    }
    if (!channelId) return null;
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const xml = await fetchText(feedUrl);
    if (!xml || !isFeed(xml)) return null;
    return { feedUrl, title: feedTitle(xml) || p.name, siteUrl: `https://www.youtube.com/channel/${channelId}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: controller.signal });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function isFeed(xml: string): boolean {
  return /<rss[\s>]|<feed[\s>]/i.test(xml) && /<item[\s>]|<entry[\s>]/i.test(xml);
}

function feedTitle(xml: string): string {
  const m = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

function discoverFeedLinks(html: string, base: string): string[] {
  return [...html.matchAll(/<link[^>]+>/gi)]
    .map((m) => m[0])
    .filter((t) => /alternate/i.test(t) && /(rss|atom)\+xml/i.test(t))
    .map((t) => {
      const h = t.match(/href=["']([^"']+)["']/i);
      try {
        return h ? new URL(h[1], base).href : null;
      } catch {
        return null;
      }
    })
    .filter((u): u is string => Boolean(u));
}

function safeUrl(u: string): URL | null {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`);
  } catch {
    return null;
  }
}

function normUrl(u: string): string {
  return u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function domainOf(u: string): string {
  return safeUrl(u)?.hostname.replace(/^www\./, "") ?? "";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "feed";
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}
