/**
 * Zod schemas for plugin manifest validation.
 *
 * Validates the `piTree` and `pi` fields in a plugin's package.json.
 * Used by the agent registry at startup to catch typos, missing fields,
 * and structural errors before they cause silent runtime failures.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// piTree.sourceType.addSource.fields[]
// ---------------------------------------------------------------------------

export const addSourceFieldSchema = z.object({
  /** Form field key — maps to the source property or metadata key */
  key: z.string().min(1),
  /** Human-readable label shown above the input */
  label: z.string().min(1),
  /** Placeholder text inside the input */
  placeholder: z.string().optional(),
  /** Input type: text (default) or number */
  type: z.enum(["text", "number"]).optional(),
  /** Whether this field is required to create a source */
  required: z.boolean().optional(),
  /** If set, value goes into metadata[metadataKey] instead of top-level source property */
  metadataKey: z.string().optional(),
});

// ---------------------------------------------------------------------------
// piTree.sourceType.addSource
// ---------------------------------------------------------------------------

export const addSourceSchema = z.object({
  /** Subtitle shown below the tab header in the Add Source modal */
  subtitle: z.string().min(1),
  /** Whether this tab supports file upload */
  hasFileUpload: z.boolean().optional(),
  /** Accepted file extensions for upload (e.g. [".epub", ".pdf"]) */
  acceptedExtensions: z.array(z.string()).optional(),
  /** Form fields to render. Can be empty for URL-only source types. */
  fields: z.array(addSourceFieldSchema).optional(),
});

// ---------------------------------------------------------------------------
// piTree.sourceType.badges[]
// ---------------------------------------------------------------------------

export const badgeSchema = z.object({
  /** Source property to check (e.g. "hasMarkdown", "source", "status") */
  field: z.string().min(1),
  /** If set, check equality (source[field] === value). If omitted, check truthiness. */
  value: z.string().optional(),
  /** Badge label text shown on the library card */
  label: z.string().min(1),
  /** Badge color */
  color: z.enum(["green", "amber", "blue", "red"]),
});

// ---------------------------------------------------------------------------
// piTree.sourceType — the big one
// ---------------------------------------------------------------------------

export const sourceTypeManifestSchema = z.object({
  /** Unique source type key (e.g. "book", "news", "paper"). Must be lowercase alphanumeric + hyphens. */
  key: z.string().min(1).regex(/^[a-z0-9-]+$/, "key must be lowercase alphanumeric with hyphens"),
  /** Human-readable label (e.g. "Book", "News Feed") */
  label: z.string().optional(),
  /** Lucide icon name in kebab-case (e.g. "book-open", "newspaper") */
  icon: z.string().optional(),
  /** Available session modes (e.g. ["reading", "qa", "custom"]) */
  sessionModes: z.array(z.string().min(1)).optional(),
  /** Default mode when auto-creating the first session */
  defaultMode: z.string().optional(),
  /** If set, skip the welcome screen and auto-create a session with this mode */
  autoStartMode: z.string().optional(),
  /** Whether this source type supports processing (e.g. EPUB → Markdown conversion) */
  hasProcessing: z.boolean().optional(),
  /** Search placeholder text for the library filter bar */
  searchPlaceholder: z.string().optional(),
  /** Chat input placeholder text */
  chatPlaceholder: z.string().optional(),
  /** Keyword matched in @mentions (e.g. "News", "Paper"). If omitted, source titles are fuzzy-matched. */
  mentionKeyword: z.string().optional(),
  /** Fixed source ID for singleton source types (e.g. "news"). If omitted, resolved via title search. */
  fixedSourceId: z.string().optional(),
  /** Session reuse strategy */
  sessionStrategy: z.enum(["reuse-same-mode", "time-based"]).optional(),
  /** For time-based strategy: hours after which to suggest asking the user (default: 4) */
  askAfterHours: z.number().positive().optional(),
  /** For time-based strategy: hours after which session is considered stale (default: 12) */
  staleAfterHours: z.number().positive().optional(),
  /** Relative path from $DATA_PATH to a JSON config file that provides routing context */
  routingContextFile: z.string().optional(),
  /** Human-readable label describing the routing context (e.g. "feeds and tags") */
  routingContextLabel: z.string().optional(),
  /** Configuration for the "Add Source" modal tab */
  addSource: addSourceSchema.optional(),
  /** Template for the library card subtitle. Supports {field} placeholders (e.g. "{author}, {year}"). */
  cardSubtitle: z.string().optional(),
  /** Badge definitions for library cards */
  badges: z.array(badgeSchema).optional(),
  /** Custom system context prompt template. Each array element is one line. */
  systemContext: z.array(z.string()).optional(),
  /** Prompt template for #tag mentions. `{tags}` is replaced with the tag list. */
  tagPromptTemplate: z.string().optional(),
  /** Prompt template for :qualifier mentions. `{qualifier}` is replaced with the value. */
  qualifierPromptTemplate: z.string().optional(),
});

// ---------------------------------------------------------------------------
// piTree.ui
// ---------------------------------------------------------------------------

export const pluginUISchema = z.object({
  /** Path to the content panel component (relative to package.json) */
  contentPanel: z.string().optional(),
});

// ---------------------------------------------------------------------------
// piTree — top-level manifest
// ---------------------------------------------------------------------------

export const piTreeManifestSchema = z.object({
  /** Source type registration */
  sourceType: sourceTypeManifestSchema.optional(),
  /** Path to the routes module (relative to package.json), e.g. "./routes.ts" */
  routes: z.string().optional(),
  /** URL prefix for mounting routes, e.g. "/api/news". Defaults to /api/{pluginName} */
  routePrefix: z.string().regex(/^\//, "routePrefix must start with /").optional(),
  /** Client-side UI component declarations */
  ui: pluginUISchema.optional(),
}).refine(
  (data) => !data.routePrefix || data.routes,
  { message: "routePrefix requires routes to be set", path: ["routePrefix"] },
);

// ---------------------------------------------------------------------------
// pi — Pi SDK extension/skill registration (separate from piTree)
// ---------------------------------------------------------------------------

export const piSdkManifestSchema = z.object({
  /** Extension entry points (relative paths, e.g. ["./index.ts"]) */
  extensions: z.array(z.string()).optional(),
  /** Skill directories (relative paths, e.g. ["./skills"]) */
  skills: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Combined validation helper
// ---------------------------------------------------------------------------

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a plugin's manifest fields from its parsed package.json.
 * Returns structured errors and warnings for logging.
 */
export function validatePluginManifest(
  pkg: Record<string, unknown>,
  pluginName: string,
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate piTree field
  if (pkg.piTree) {
    const result = piTreeManifestSchema.safeParse(pkg.piTree);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length ? `piTree.${issue.path.join(".")}` : "piTree";
        errors.push(`[${pluginName}] ${path}: ${issue.message}`);
      }
    } else {
      const data = result.data;

      // Semantic warnings (valid structure but potentially misconfigured)
      if (data.sourceType) {
        const st = data.sourceType;
        if (st.autoStartMode && st.sessionModes && !st.sessionModes.includes(st.autoStartMode)) {
          warnings.push(
            `[${pluginName}] piTree.sourceType.autoStartMode "${st.autoStartMode}" is not in sessionModes [${st.sessionModes.join(", ")}]`,
          );
        }
        if (st.defaultMode && st.sessionModes && !st.sessionModes.includes(st.defaultMode)) {
          warnings.push(
            `[${pluginName}] piTree.sourceType.defaultMode "${st.defaultMode}" is not in sessionModes [${st.sessionModes.join(", ")}]`,
          );
        }
        if (st.sessionStrategy === "time-based") {
          if (st.askAfterHours && st.staleAfterHours && st.askAfterHours >= st.staleAfterHours) {
            warnings.push(
              `[${pluginName}] piTree.sourceType.askAfterHours (${st.askAfterHours}) >= staleAfterHours (${st.staleAfterHours})`,
            );
          }
        }
        if (st.routingContextFile && !st.routingContextLabel) {
          warnings.push(
            `[${pluginName}] piTree.sourceType.routingContextFile is set but routingContextLabel is missing`,
          );
        }
      }

      if (data.routePrefix && !data.routePrefix.startsWith("/api/")) {
        warnings.push(
          `[${pluginName}] piTree.routePrefix "${data.routePrefix}" doesn't follow the /api/* convention`,
        );
      }
    }
  }

  // Validate pi field
  if (pkg.pi) {
    const result = piSdkManifestSchema.safeParse(pkg.pi);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length ? `pi.${issue.path.join(".")}` : "pi";
        errors.push(`[${pluginName}] ${path}: ${issue.message}`);
      }
    }
  }

  // Warn if neither pi nor piTree is present
  if (!pkg.piTree && !pkg.pi) {
    warnings.push(`[${pluginName}] package.json has neither "piTree" nor "pi" field — is this a pi-tree plugin?`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
