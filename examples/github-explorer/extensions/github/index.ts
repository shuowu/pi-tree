import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Resolve the base directory for cloned repos. */
function reposDir(): string {
  const dataPath = process.env.DATA_PATH || join(require("os").homedir(), ".local", "share", "pi-tree");
  return join(dataPath, "repos");
}

export default function (pi: ExtensionAPI) {
  // 1. Clone a GitHub repository
  pi.registerTool({
    name: "clone_repo",
    label: "Clone GitHub Repo",
    description:
      "Clone a GitHub repository to local storage. After cloning, use the built-in read/grep/find/ls tools with the returned path to explore the codebase.",
    parameters: Type.Object({
      repo: Type.String({
        description:
          'GitHub repo in "owner/repo" format (e.g. "facebook/react") or a full URL.',
      }),
      shallow: Type.Optional(
        Type.Boolean({
          description: "If true, perform a shallow clone (--depth 1). Default true.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const base = reposDir();
      // Normalise: accept "owner/repo" or "https://github.com/owner/repo"
      const repo = params.repo
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "");

      const parts = repo.split("/");
      if (parts.length !== 2) {
        throw new Error(
          `Invalid repo format: "${params.repo}". Use "owner/repo" or a GitHub URL.`,
        );
      }
      const [owner, name] = parts;
      const dest = join(base, owner, name);

      if (existsSync(dest)) {
        return {
          content: [
            {
              type: "text",
              text: `Repository already cloned at: ${dest}\nUse the read/grep/find/ls tools to explore it.`,
            },
          ],
          details: undefined,
        };
      }

      const url = `https://github.com/${owner}/${name}.git`;
      const shallow = params.shallow !== false;
      const cmd = `git clone ${shallow ? "--depth 1 " : ""}${url} ${dest}`;

      try {
        execSync(cmd, { stdio: "pipe", timeout: 120_000 });
      } catch (err: any) {
        throw new Error(`git clone failed: ${err.stderr?.toString() || err.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: `Cloned ${owner}/${name} to: ${dest}\nUse the read/grep/find/ls tools with this path to explore the codebase.`,
          },
        ],
        details: undefined,
      };
    },
  });

  // 2. List cloned repositories
  pi.registerTool({
    name: "list_repos",
    label: "List Cloned Repos",
    description: "List all locally cloned GitHub repositories.",
    parameters: Type.Object({}),
    async execute() {
      const base = reposDir();
      if (!existsSync(base)) {
        return {
          content: [{ type: "text", text: "No repositories cloned yet." }],
          details: undefined,
        };
      }

      const repos: string[] = [];
      try {
        for (const owner of readdirSync(base)) {
          const ownerPath = join(base, owner);
          if (!statSync(ownerPath).isDirectory()) continue;
          for (const name of readdirSync(ownerPath)) {
            if (statSync(join(ownerPath, name)).isDirectory()) {
              repos.push(`${owner}/${name}`);
            }
          }
        }
      } catch {
        // ignore read errors
      }

      if (!repos.length) {
        return {
          content: [{ type: "text", text: "No repositories cloned yet." }],
          details: undefined,
        };
      }

      const list = repos.map((r) => `- ${r} → ${join(base, r)}`).join("\n");
      return {
        content: [{ type: "text", text: `Cloned repositories:\n${list}` }],
        details: undefined,
      };
    },
  });
}
