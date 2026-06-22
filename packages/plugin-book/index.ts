import { Type } from "typebox";
import { definePiTreeExtension, textResult, toolError } from "@pi-tree/plugin-sdk";
import { join } from "node:path";
import { processBook } from "./services/process-book.js";

export default definePiTreeExtension((pi, services) => {
  const sourcesBasePath = join(services.dataPath, "sources");

  pi.registerTool({
    name: "process_book",
    label: "Process Book",
    description:
      "Parse an uploaded ebook file (epub, mobi, azw, azw3, pdf) into markdown. " +
      "Extracts the text content, metadata, cover image, and generates a candidate " +
      "table of contents. Call this for newly uploaded books that have status 'pending'.",
    parameters: Type.Object({
      source_id: Type.String({
        description: "The source ID of the uploaded book to process.",
      }),
    }),
    async execute(_toolCallId, params) {
      const result = await processBook(params.source_id, {
        sourcesBasePath,
        sources: services.sources,
      });

      if (result.alreadyProcessed) {
        return textResult(`Book '${result.sourceId}' already has markdown content. Status set to ready.`);
      }

      return textResult([
        `Successfully processed book '${result.sourceId}'.`,
        `Title: ${result.title}`,
        `Author: ${result.author}`,
        `Content: ${result.lines} lines of markdown`,
        `Headings found: ${result.headings}`,
        `Cover image: ${result.hasCover ? "yes" : "no"}`,
        `Candidate toc.json written to analysis/toc.json.`,
        ``,
        `The book is now ready for reading.`,
      ].join("\n"));
    },
  });
});
