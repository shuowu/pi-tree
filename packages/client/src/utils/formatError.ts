/**
 * Extract a human-readable message from a raw error string.
 * Provider errors often arrive as JSON blobs — this tries to pull out
 * the meaningful `message` field and strip internal codes/request IDs.
 */
export function formatErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    // Anthropic-style: { error: { message: "..." } }
    // OpenAI-style:    { error: { message: "...", code: "..." } }
    // Google-style:    { error: { message: "...", status: "..." } }
    const inner = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof inner === "string") {
      return cleanErrorText(inner);
    }
  } catch {
    // Not JSON — use as-is
  }
  return raw;
}

/** Strip internal codes, request IDs, and bracket wrappers from error text. */
function cleanErrorText(text: string): string {
  return (
    text
      // Strip leading bracketed numeric codes like "[1309]"
      .replace(/^\[\d+\]\s*/g, "")
      // Strip remaining bracketed numeric codes
      .replace(/\[\d+\]\s*/g, "")
      // Strip bracketed hex request IDs (20+ chars)
      .replace(/\[[0-9a-f]{20,}\]\s*/g, "")
      // Unwrap content that's entirely inside [...] brackets
      .replace(/^\[(.+)\]$/s, "$1")
      // Normalize trailing CJK period to ASCII period
      .replace(/[。]$/g, ".")
      .trim()
  );
}
