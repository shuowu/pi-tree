import { definePiTreeExtension, textResult, jsonResult } from "@pi-tree/plugin-sdk";
import { Type } from "typebox";
import { searchPapers, getPaperInfo, readPaper } from "./services/arxiv.js";

export default definePiTreeExtension((pi, services) => {
  // 1. Search arXiv
  pi.registerTool({
    name: "search_papers",
    label: "Search Papers",
    description:
      "Search arXiv for academic papers by keyword, author, or category. Returns titles, abstracts, and arXiv IDs.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Search query. Supports arXiv field prefixes: ti: (title), au: (author), abs: (abstract), cat: (category). Examples: "transformer attention", "au:hinton AND ti:deep learning", "cat:cs.AI".',
      }),
      max_results: Type.Optional(
        Type.Number({
          description: "Max results to return (default 10, max 50).",
        }),
      ),
      sort_by: Type.Optional(
        Type.Union(
          [
            Type.Literal("relevance"),
            Type.Literal("lastUpdatedDate"),
            Type.Literal("submittedDate"),
          ],
          { description: "Sort order (default: relevance)." },
        ),
      ),
    }),
    async execute(_toolCallId, params) {
      const entries = await searchPapers(params.query, params.max_results, params.sort_by);

      if (!entries.length) {
        return textResult("No papers found for this query.");
      }

      const summary = entries
        .map(
          (e, i) =>
            `${i + 1}. **${e.title}**\n   ${e.authors.slice(0, 5).join(", ")}${e.authors.length > 5 ? ` (+${e.authors.length - 5} more)` : ""}\n   ${e.published.slice(0, 10)} · ${e.categories.slice(0, 3).join(", ")}\n   ID: ${e.arxivId}\n   ${e.summary.slice(0, 200)}…`,
        )
        .join("\n\n");

      return textResult(`Found ${entries.length} papers:\n\n${summary}`);
    },
  });

  // 2. Get paper metadata
  pi.registerTool({
    name: "get_paper_info",
    label: "Get Paper Info",
    description:
      "Get detailed metadata for a specific arXiv paper: title, authors, abstract, categories, and links.",
    parameters: Type.Object({
      arxiv_id: Type.String({
        description:
          'arXiv paper ID (e.g. "2301.07041") or full URL (e.g. "https://arxiv.org/abs/2301.07041").',
      }),
    }),
    async execute(_toolCallId, params) {
      const e = await getPaperInfo(params.arxiv_id);

      const info = {
        arxivId: e.arxivId,
        title: e.title,
        authors: e.authors,
        published: e.published,
        updated: e.updated,
        categories: e.categories,
        abstract: e.summary,
        links: {
          abstract: e.abstractUrl,
          pdf: e.pdfUrl,
          html: e.ar5ivUrl,
        },
      };

      return jsonResult(info);
    },
  });

  // 3. Read paper full text
  pi.registerTool({
    name: "read_paper",
    label: "Read Paper",
    description:
      "Read the full text of an academic paper. For arXiv papers, fetches the HTML version (ar5iv) for best quality. For other URLs, falls back to Jina Reader.",
    parameters: Type.Object({
      source: Type.String({
        description:
          'arXiv ID (e.g. "2301.07041"), arXiv URL, or any paper URL. arXiv papers use ar5iv HTML for best results.',
      }),
    }),
    async execute(_toolCallId, params) {
      const text = await readPaper(params.source, services.config?.jinaApiKey);

      return textResult(text);
    },
  });
});
