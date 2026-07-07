/**
 * Discover contract — the reading-list pipeline's plugin-facing types.
 *
 * The generic pipeline (interest model → candidate generation → rank → present)
 * lives in the server. Only candidate generation is per-source-type, behind the
 * `DiscoverProvider` seam: a plugin implements one and registers it at setup()
 * via `PluginRouteContext.discover.registerProvider`.
 *
 * See local-docs/READING-LIST.md.
 */

/** A source already in the user's library, with the concepts extracted from it. */
export interface OwnedSource {
  id: string;
  type: string;
  title: string;
  author: string;
  /** Concept terms extracted for this source (from analysis/concepts.json). */
  concepts: string[];
  /** Whether the user has actually opened a session on it. */
  engaged: boolean;
}

/** Distilled interest signals, fed to every provider. Source-type-agnostic. */
export interface InterestModel {
  /** Weighted/ordered concept terms the user has engaged with. */
  topics: string[];
  /** A compact prose digest of the signals, ready to drop into a prompt. */
  digest: string;
  /** Sources already owned — used for concept-bridges and to exclude duplicates. */
  ownedSources: OwnedSource[];
  /** Free-form tags the user applied to sources. */
  tags: string[];
}

/** Which section a candidate belongs to and how the client acts on it. */
export type CandidateKind =
  /** Already owned → the client can start a reading session immediately. */
  | "shelf"
  /** Not owned → an acquisition suggestion (link out, or a one-click add). */
  | "acquire";

/** One suggestion, uniform across source types. */
export interface Candidate {
  kind: CandidateKind;
  /** Source type this candidate is (e.g. "book", "news"). */
  sourceType: string;
  title: string;
  author?: string;
  year?: number | null;
  coverUrl?: string | null;
  /** External link (acquire) — e.g. an Open Library page or a feed's site. */
  url?: string | null;
  /** One-line reason tied to a specific concept/source/memo. Mandatory. */
  reason: string;
  /** For shelf candidates: the owned source id, so the client can open it. */
  sourceId?: string;
  /** External identifiers (isbn, openlibrary work key, …). */
  ids?: Record<string, string>;
  /** Relevance score 0..1, provider-assigned; used for ordering. */
  score?: number;
  /**
   * When present, the client offers a one-click "add" that subscribes this feed
   * to the News collection (RSS or YouTube-channel feed). Set by the news provider.
   */
  addFeed?: { id: string; name: string; url: string; tags: string[] };
}

/** A minimal LLM runner: prompt in, full completion text out. */
export type LlmRunner = (prompt: string) => Promise<string>;

/** Everything a provider needs, injected by the DiscoverService. */
export interface DiscoverContext {
  /** Run a single LLM completion (ephemeral in-memory agent). */
  llm: LlmRunner;
  /** Whether external network lookups are permitted (privacy switch). */
  allowExternalLookup: boolean;
  /** Target number of candidates per section. */
  count: number;
  /** 0 = on-topic … 1 = broaden. */
  diversity: number;
  /** Report a human-readable progress step (surfaced live to the user). */
  log: (message: string) => void;
}

/** The per-source-type extension point. */
export interface DiscoverProvider {
  /** Source type this provider generates candidates for. */
  sourceType: string;
  /** Return real, resolvable candidates for this type, already grounded. */
  getCandidates(interest: InterestModel, ctx: DiscoverContext): Promise<Candidate[]>;
}

/** Registry surface exposed to plugins at setup() for registering a provider. */
export interface DiscoverRegistryApi {
  registerProvider(provider: DiscoverProvider): void;
}
