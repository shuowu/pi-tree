// ---------------------------------------------------------------------------
// arXiv API helpers — pure, testable functions (no Pi SDK dependency)
// ---------------------------------------------------------------------------

const ARXIV_API = "https://export.arxiv.org/api/query";
const AR5IV_BASE = "https://ar5iv.labs.arxiv.org/html";

export interface ArxivEntry {
  arxivId: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  pdfUrl: string;
  abstractUrl: string;
  ar5ivUrl: string;
}

/** Parse arXiv Atom XML response into structured entries. */
export function parseArxivEntries(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryBlocks = xml.split("<entry>").slice(1); // skip feed preamble

  for (const block of entryBlocks) {
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].trim() : "";
    };
    const getAll = (tag: string) => {
      const results: string[] = [];
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
      let m;
      while ((m = re.exec(block))) results.push(m[1].trim());
      return results;
    };
    const getAttr = (tag: string, attr: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*/?>`, "g"));
      if (!m) return [];
      return m.map((s) => {
        const a = s.match(new RegExp(`${attr}="([^"]*)"`));
        return a ? a[1] : "";
      }).filter(Boolean);
    };

    const id = get("id");
    // Extract arXiv ID from URL like http://arxiv.org/abs/2301.07041v1
    const arxivId = id.replace(/^.*\/abs\//, "").replace(/v\d+$/, "");
    const categories = getAttr("category", "term");

    entries.push({
      arxivId,
      title: get("title").replace(/\s+/g, " "),
      summary: get("summary").replace(/\s+/g, " "),
      authors: getAll("name"),
      published: get("published"),
      updated: get("updated"),
      categories,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      abstractUrl: `https://arxiv.org/abs/${arxivId}`,
      ar5ivUrl: `${AR5IV_BASE}/${arxivId}`,
    });
  }
  return entries;
}

/** Normalize arXiv ID from various input formats (URL, PDF link, versioned). */
export function normalizeArxivId(input: string): string {
  return input
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/\.pdf$/, "")
    .replace(/v\d+$/, "");
}

/** Search arXiv for papers. */
export async function searchPapers(
  query: string,
  maxResults?: number,
  sortBy?: string,
): Promise<ArxivEntry[]> {
  const max = Math.min(maxResults ?? 10, 50);
  const sort = sortBy ?? "relevance";
  const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&start=0&max_results=${max}&sortBy=${sort}&sortOrder=descending`;

  const res = await fetch(url, {
    headers: { "User-Agent": "pi-tree/1.0" },
  });
  if (!res.ok) throw new Error(`arXiv API returned ${res.status}`);
  const xml = await res.text();
  return parseArxivEntries(xml);
}

/** Get metadata for a specific paper by arXiv ID or URL. */
export async function getPaperInfo(arxivId: string): Promise<ArxivEntry> {
  const id = normalizeArxivId(arxivId);

  const url = `${ARXIV_API}?id_list=${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "pi-tree/1.0" },
  });
  if (!res.ok) throw new Error(`arXiv API returned ${res.status}`);
  const xml = await res.text();
  const entries = parseArxivEntries(xml);

  if (!entries.length) {
    throw new Error(`Paper "${id}" not found on arXiv.`);
  }
  return entries[0];
}

/** Read full paper text from ar5iv or via Jina Reader. */
export async function readPaper(
  source: string,
  jinaApiKey?: string,
): Promise<string> {
  let url: string;
  const input = source.trim();

  // Detect arXiv ID or URL
  const arxivIdMatch = input.match(
    /(?:arxiv\.org\/(?:abs|pdf|html)\/)?(\d{4}\.\d{4,5})/,
  );
  if (arxivIdMatch || /^\d{4}\.\d{4,5}$/.test(input)) {
    const id = arxivIdMatch ? arxivIdMatch[1] : input;
    // Use ar5iv HTML version — much better than PDF extraction
    url = `${AR5IV_BASE}/${id}`;
  } else if (input.startsWith("http")) {
    url = input;
  } else {
    throw new Error(
      `Cannot parse "${input}". Provide an arXiv ID (e.g. "2301.07041") or a URL.`,
    );
  }

  // For ar5iv, fetch directly and convert to readable text.
  // For other URLs, use Jina Reader.
  const isAr5iv = url.startsWith(AR5IV_BASE);
  const fetchUrl = isAr5iv ? url : `https://r.jina.ai/${url}`;

  const headers: Record<string, string> = {
    "User-Agent": "pi-tree/1.0",
  };
  if (!isAr5iv) {
    headers["Accept"] = "text/markdown";
    if (jinaApiKey) {
      headers["Authorization"] = `Bearer ${jinaApiKey}`;
    }
  }

  const res = await fetch(fetchUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch paper (${res.status}): ${isAr5iv ? "ar5iv may not have this paper — try a different ID or use a direct URL" : "URL may be inaccessible"}`,
    );
  }

  let text = await res.text();

  // For ar5iv HTML, do a basic HTML → text conversion (strip tags, keep structure)
  if (isAr5iv) {
    text = html2text(text);
  }

  // Truncate extremely long papers to avoid context overflow
  const MAX_CHARS = 120_000;
  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      "\n\n[… paper truncated — ask about specific sections for more detail]";
  }

  return text;
}

// ---------------------------------------------------------------------------
// Minimal HTML → text (for ar5iv pages, no deps)
// ---------------------------------------------------------------------------

/** Convert HTML to readable markdown text (for ar5iv pages). */
export function html2text(html: string): string {
  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let text = bodyMatch ? bodyMatch[1] : html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");

  // Convert headers to markdown
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");

  // Convert paragraphs and divs to newlines
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "- ");
  text = text.replace(/<\/li>/gi, "\n");

  // Convert bold/italic
  text = text.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");
  text = text.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*");

  // Convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
