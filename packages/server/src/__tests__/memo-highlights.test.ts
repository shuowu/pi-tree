/**
 * Highlights are memos with an anchor — create, list by source, recolor.
 * Runs against a fresh temp DB, so it also exercises the anchor migration.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Memo, MemoAnchor } from "@pi-tree/shared";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-hl-test-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");
vi.stubEnv("DATA_PATH", TEST_DATA_PATH);

const { app } = await import("../app.js");
const { resetDb } = await import("../db/index.js");
const { resetServerConfig } = await import("../config.js");

beforeAll(() => {
  mkdirSync(join(TEST_DATA_PATH, "library"), { recursive: true });
});

afterAll(() => {
  resetDb();
  resetServerConfig();
  vi.unstubAllEnvs();
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

const USER = "hl-user";
const anchor: MemoAnchor = {
  kind: "book",
  chapter: "OEBPS/text/Chapter01.xhtml",
  exact: "stop trying to beat the market",
  prefix: "The first step is to ",
  suffix: ". Index funds",
  color: "yellow",
};

async function post(path: string, body: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("memo highlights", () => {
  let highlight: Memo;

  it("creates a memo with an anchor", async () => {
    const res = await post(`/api/memos/${USER}`, {
      title: anchor.exact,
      content: anchor.exact,
      sourceId: "book-a",
      origin: "selection",
      anchor,
    });
    expect(res.status).toBe(201);
    highlight = await res.json();
    expect(highlight.anchor).toEqual(anchor);
  });

  it("lists only anchored memos for a source when asked", async () => {
    await post(`/api/memos/${USER}`, { title: "plain note", content: "no anchor", sourceId: "book-a" });
    await post(`/api/memos/${USER}`, { title: "other book", content: "x", sourceId: "book-b", anchor });

    const all = (await (await app.request(`/api/memos/${USER}?source=book-a`)).json()).memos as Memo[];
    expect(all).toHaveLength(2);

    const anchored = (await (await app.request(`/api/memos/${USER}?source=book-a&anchored=true`)).json())
      .memos as Memo[];
    expect(anchored.map((m) => m.id)).toEqual([highlight.id]);
    expect(all.find((m) => m.title === "plain note")?.anchor).toBeNull();
  });

  it("updates the anchor (recolor)", async () => {
    const res = await post(`/api/memos/${USER}/${highlight.id}`, { anchor: { ...anchor, color: "green" } }, "PUT");
    expect(res.status).toBe(200);
    expect((await res.json()).anchor.color).toBe("green");
  });
});
