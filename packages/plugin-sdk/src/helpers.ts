/**
 * SDK helper utilities for pi-tree plugins.
 *
 * Reduces boilerplate in tool implementations — DRY wrappers for the
 * repetitive { content: [{ type: "text", text }], details } pattern,
 * error formatting, and shared service wrappers (e.g. Jina Reader).
 */

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

/** The return type of a tool's execute() function. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  details: undefined;
}

/**
 * Create a successful tool result from a text string.
 *
 * @example
 *   return textResult("Book processed successfully.");
 */
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

/**
 * Create a successful tool result from a JSON-serializable object.
 * Stringifies with 2-space indentation for readability.
 *
 * @example
 *   return jsonResult({ sourceId: "abc", title: "My Book" });
 */
export function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

/**
 * Wrap a tool error message and throw a clean Error.
 * Use this in catch blocks to provide consistent, user-friendly error messages.
 *
 * @example
 *   catch (err: any) { throw toolError("read article", err); }
 */
export function toolError(action: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Failed to ${action}: ${message}`);
}

// ---------------------------------------------------------------------------
// Jina Reader helper
// ---------------------------------------------------------------------------

/** Options for fetchViaJina(). */
export interface JinaFetchOptions {
  /** Jina API key for authenticated requests (higher rate limits). */
  apiKey?: string;
  /** Response format. Defaults to "text/markdown". */
  accept?: string;
}

/**
 * Fetch a URL's content via Jina Reader (r.jina.ai).
 * Returns the page content as markdown text.
 *
 * Used by the news plugin (read_article) and paper plugin (readPaper)
 * to extract readable content from web pages.
 *
 * @example
 *   const markdown = await fetchViaJina("https://example.com/article", {
 *     apiKey: services.config.jinaApiKey,
 *   });
 */
export async function fetchViaJina(
  url: string,
  options?: JinaFetchOptions,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: options?.accept ?? "text/markdown",
  };
  if (options?.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(`https://r.jina.ai/${url}`, { headers });
  if (!response.ok) {
    throw new Error(`Jina Reader returned status ${response.status}`);
  }
  return response.text();
}
