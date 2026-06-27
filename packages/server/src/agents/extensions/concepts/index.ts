import { Type } from "typebox";
import { definePiTreeExtension, jsonResult, textResult, toolError } from "@pi-tree/plugin-sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export default definePiTreeExtension((pi, services) => {
  // ---------------------------------------------------------------------------
  // 1. Search Concepts — cross-source concept search
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "search_concepts",
    label: "Search Concepts",
    description:
      "Search for concepts across all sources in the library. Returns matching concepts with source attributions.",
    parameters: Type.Object({
      query: Type.String({ description: "Concept name or keyword to search for." }),
    }),
    async execute(_toolCallId, params) {
      try {
        const query = params.query.toLowerCase();
        const sources = await services.sources.list();
        const grouped = new Map<
          string,
          { descriptions: string[]; sources: { id: string; title: string }[] }
        >();

        for (const source of sources) {
          const conceptsPath = join(
            services.dataPath,
            "sources",
            source.id,
            "analysis",
            "concepts.json",
          );
          if (!existsSync(conceptsPath)) continue;

          try {
            const data = JSON.parse(readFileSync(conceptsPath, "utf-8"));
            const conceptList = Array.isArray(data) ? data : data.concepts;
            if (!Array.isArray(conceptList)) continue;

            for (const concept of conceptList) {
              if (!concept.term || !concept.term.toLowerCase().includes(query)) continue;

              const key = concept.term.toLowerCase();
              if (!grouped.has(key)) {
                grouped.set(key, { descriptions: [], sources: [] });
              }
              const entry = grouped.get(key)!;
              if (concept.description && !entry.descriptions.includes(concept.description)) {
                entry.descriptions.push(concept.description);
              }
              entry.sources.push({ id: source.id, title: source.title });
            }
          } catch {
            // Skip unparseable files
          }
        }

        if (grouped.size === 0) {
          return textResult(`No concepts matching "${params.query}" found across sources.`);
        }

        const results = Array.from(grouped.entries()).map(([term, data]) => ({
          term,
          descriptions: data.descriptions,
          sources: data.sources,
        }));

        return jsonResult(results);
      } catch (err) {
        throw toolError("search concepts", err);
      }
    },
  });

  // ---------------------------------------------------------------------------
  // 2. List Concepts — per-source concept listing
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "list_concepts",
    label: "List Concepts",
    description: "List all key concepts and relations for a specific source.",
    parameters: Type.Object({
      source_id: Type.String({ description: "The source ID to list concepts for." }),
    }),
    async execute(_toolCallId, params) {
      try {
        const conceptsPath = join(
          services.dataPath,
          "sources",
          params.source_id,
          "analysis",
          "concepts.json",
        );
        if (!existsSync(conceptsPath)) {
          return textResult(`No concepts file found for source ${params.source_id}.`);
        }

        const concepts = JSON.parse(readFileSync(conceptsPath, "utf-8"));
        return jsonResult(concepts);
      } catch (err) {
        throw toolError("list concepts", err);
      }
    },
  });
});
