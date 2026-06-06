/**
 * Ebook Tools Extension
 *
 * Pi extension that wraps the in-process book parsers as Pi tools.
 * When installed via `pi install`, users get ebook conversion tools
 * directly in their terminal.
 *
 * Tools:
 *   ebook_convert  — Convert an ebook file (EPUB/PDF/MOBI) to markdown
 *   ebook_list     — List supported ebook formats
 *
 * Commands:
 *   /convert <path> — Convert an ebook via interactive prompt
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve, basename, relative } from "node:path";
import { readdir, stat } from "node:fs/promises";

// We import parsers using a relative path so this extension works
// both when loaded from the package (pi install) and in development.
// The built dist/ will resolve these correctly.
import { getParser, getSupportedExtensions, registerParser } from "../../src/parsers/index.js";
import { EpubParser } from "../../src/parsers/epub-parser.js";
import { PdfParser } from "../../src/parsers/pdf-parser.js";
import { MobiParser } from "../../src/parsers/mobi-parser.js";

// Ensure parsers are registered (in case this module loads before the
// side-effect registration in parsers/index.ts runs)
registerParser(new EpubParser());
registerParser(new PdfParser());
registerParser(new MobiParser());

export default function ebookTools(pi: ExtensionAPI) {
  // ── ebook_convert tool ──────────────────────────────

  pi.registerTool({
    name: "ebook_convert",
    label: "Ebook Convert",
    description:
      "Convert an ebook file to markdown. Supports EPUB, PDF, MOBI, AZW, AZW3. " +
      "Returns the converted markdown text plus metadata (title, author, year, etc.).",
    parameters: Type.Object({
      input_path: Type.String({
        description:
          "Path to the ebook file (absolute or relative to cwd). " +
          "Supported: " +
          getSupportedExtensions().join(", "),
      }),
      output_path: Type.Optional(
        Type.String({
          description:
            "If provided, write the markdown output to this file path instead of returning it inline.",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const inputAbs = resolve(cwd, params.input_path);

      onUpdate?.({
        content: [
          { type: "text", text: `Converting ${basename(params.input_path)}...` },
        ],
        details: {},
      });

      try {
        const parser = getParser(inputAbs);
        if (!parser) {
          const supported = getSupportedExtensions().join(", ");
          return {
            content: [
              {
                type: "text",
                text: `Unsupported format. Supported extensions: ${supported}`,
              },
            ],
            details: { error: "unsupported_format" },
          };
        }

        const result = await parser.parse(inputAbs);

        // Optionally write to file
        if (params.output_path) {
          const { writeFile, mkdir } = await import("node:fs/promises");
          const { dirname } = await import("node:path");
          const outputAbs = resolve(cwd, params.output_path);
          await mkdir(dirname(outputAbs), { recursive: true });
          await writeFile(outputAbs, result.markdown, "utf-8");

          // Write cover if present
          if (result.cover) {
            const coverPath = resolve(
              dirname(outputAbs),
              `cover${result.cover.ext}`,
            );
            await writeFile(coverPath, result.cover.data);
          }

          const relOutput = relative(cwd, outputAbs);
          return {
            content: [
              {
                type: "text",
                text: [
                  `✓ Converted: ${result.metadata.title || basename(params.input_path)}`,
                  result.metadata.author
                    ? `  Author: ${result.metadata.author}`
                    : null,
                  result.metadata.year
                    ? `  Year: ${result.metadata.year}`
                    : null,
                  `  Output: ${relOutput}`,
                  `  Length: ${result.markdown.length.toLocaleString()} chars`,
                  result.cover ? `  Cover: extracted` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
            details: {
              title: result.metadata.title,
              author: result.metadata.author,
              year: result.metadata.year,
              outputPath: relOutput,
              markdownLength: result.markdown.length,
              hasCover: !!result.cover,
            },
          };
        }

        // Return inline (truncated if very large)
        const MAX_INLINE = 100_000;
        const truncated = result.markdown.length > MAX_INLINE;
        const text = truncated
          ? result.markdown.slice(0, MAX_INLINE) +
            `\n\n... [truncated, ${result.markdown.length.toLocaleString()} chars total. Use output_path to save full content.]`
          : result.markdown;

        return {
          content: [{ type: "text", text }],
          details: {
            title: result.metadata.title,
            author: result.metadata.author,
            year: result.metadata.year,
            markdownLength: result.markdown.length,
            truncated,
            hasCover: !!result.cover,
          },
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text", text: `Error converting ebook: ${err.message}` },
          ],
          details: { error: err.message },
        };
      }
    },
  });

  // ── ebook_formats tool ────────────────────────────

  pi.registerTool({
    name: "ebook_formats",
    label: "Ebook Formats",
    description: "List supported ebook formats for conversion",
    parameters: Type.Object({}),

    async execute() {
      const extensions = getSupportedExtensions();
      return {
        content: [
          {
            type: "text",
            text: `Supported ebook formats: ${extensions.join(", ")}`,
          },
        ],
        details: { formats: extensions },
      };
    },
  });

  // ── /convert command ────────────────────────────────

  pi.registerCommand("convert", {
    description: "Convert an ebook to markdown",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("Usage: /convert <path-to-ebook>", "warning");
        return;
      }
      await pi.sendUserMessage(
        `Convert the ebook at "${args}" to markdown using the ebook_convert tool. Save the output next to the source file.`,
      );
    },
  });
}
