#!/usr/bin/env node
/**
 * Post-build: copy non-TS assets from src/ into dist/.
 *
 * tsc only compiles .ts files. Runtime assets like skill markdowns,
 * profile YAMLs, and prompt templates need to be copied separately.
 */
const { cpSync } = require("fs");

const copies = [
  { src: "src/agents/skills",   dst: "dist/agents/skills" },
  { src: "src/agents/prompts",  dst: "dist/agents/prompts" },
  { src: "src/profiles",        dst: "dist/profiles" },
];

for (const { src, dst } of copies) {
  cpSync(src, dst, {
    recursive: true,
    filter: (f) => !f.endsWith(".ts"),
  });
}

console.log("[postbuild] Copied non-TS assets to dist/");
