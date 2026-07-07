/**
 * Discover pipeline types.
 *
 * The plugin-facing contract (InterestModel, Candidate, DiscoverProvider,
 * DiscoverContext, …) lives in @pi-tree/plugin-sdk so plugins can implement
 * providers. Re-exported here for server-internal convenience. Book-only
 * grounding types stay local.
 *
 * See local-docs/READING-LIST.md.
 */

export type {
  OwnedSource,
  InterestModel,
  CandidateKind,
  Candidate,
  LlmRunner,
  DiscoverContext,
  DiscoverProvider,
} from "@pi-tree/plugin-sdk";

// ---------------------------------------------------------------------------
// Grounding — book-specific: validate/enrich LLM-proposed titles against a catalog
// ---------------------------------------------------------------------------

export interface GroundedBook {
  title: string;
  authors: string[];
  year: number | null;
  coverUrl: string | null;
  subjects: string[];
  ids: Record<string, string>;
  /** Canonical page for the work (link-out target). */
  sourceUrl: string | null;
}

export interface GroundingProvider {
  /**
   * Resolve an LLM-proposed book against a real catalog. Returns real books
   * ranked best-match-first (canonical work preferred over bundles/summaries),
   * or [] if nothing matches well enough.
   */
  search(title: string, author?: string): Promise<GroundedBook[]>;
}
