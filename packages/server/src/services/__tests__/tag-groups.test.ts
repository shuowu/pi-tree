import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTagGroups, expandTagGroups, saveTagGroup } from "../tag-groups.js";

const FILE = "sources/news/tag-groups.json";

let dataPath: string;

beforeEach(() => {
  dataPath = mkdtempSync(join(tmpdir(), "tag-groups-test-"));
});

afterEach(() => {
  rmSync(dataPath, { recursive: true, force: true });
});

function writeGroups(groups: unknown) {
  mkdirSync(join(dataPath, "sources/news"), { recursive: true });
  writeFileSync(join(dataPath, FILE), JSON.stringify(groups), "utf-8");
}

describe("loadTagGroups", () => {
  it("returns {} when the file is missing or no file is configured", () => {
    expect(loadTagGroups(dataPath, FILE)).toEqual({});
    expect(loadTagGroups(dataPath, undefined)).toEqual({});
  });

  it("loads groups and lowercases names", () => {
    writeGroups({ Morning: ["ai", "tech"] });
    expect(loadTagGroups(dataPath, FILE)).toEqual({ morning: ["ai", "tech"] });
  });

  it("returns {} on invalid JSON or non-object shapes", () => {
    mkdirSync(join(dataPath, "sources/news"), { recursive: true });
    writeFileSync(join(dataPath, FILE), "not json", "utf-8");
    expect(loadTagGroups(dataPath, FILE)).toEqual({});
    writeGroups(["array", "not", "object"]);
    expect(loadTagGroups(dataPath, FILE)).toEqual({});
  });

  it("skips non-array group values and non-string members", () => {
    writeGroups({ good: ["ai"], bad: "not-an-array", mixed: ["ai", 42] });
    expect(loadTagGroups(dataPath, FILE)).toEqual({ good: ["ai"], mixed: ["ai"] });
  });
});

describe("expandTagGroups", () => {
  const groups = { morning: ["ai", "tech", "finance"] };

  it("expands a group name to its member tags", () => {
    expect(expandTagGroups(["morning"], groups)).toEqual({
      tags: ["ai", "tech", "finance"],
      groups: ["morning"],
    });
  });

  it("is case-insensitive on group names", () => {
    expect(expandTagGroups(["Morning"], groups).tags).toEqual(["ai", "tech", "finance"]);
  });

  it("passes plain tags through and deduplicates against group members", () => {
    expect(expandTagGroups(["morning", "crypto", "ai"], groups)).toEqual({
      tags: ["ai", "tech", "finance", "crypto"],
      groups: ["morning"],
    });
  });

  it("returns tags unchanged when no group matches", () => {
    expect(expandTagGroups(["ai", "tech"], {})).toEqual({
      tags: ["ai", "tech"],
      groups: [],
    });
  });
});

describe("saveTagGroup", () => {
  it("creates the file and directory on first save", () => {
    const groups = saveTagGroup(dataPath, FILE, "morning", ["ai", "tech"]);
    expect(groups).toEqual({ morning: ["ai", "tech"] });
    expect(JSON.parse(readFileSync(join(dataPath, FILE), "utf-8"))).toEqual({
      morning: ["ai", "tech"],
    });
  });

  it("updates an existing group and preserves the others", () => {
    saveTagGroup(dataPath, FILE, "morning", ["ai"]);
    const groups = saveTagGroup(dataPath, FILE, "weekend", ["papers"]);
    expect(groups).toEqual({ morning: ["ai"], weekend: ["papers"] });
  });

  it("lowercases and deduplicates member tags", () => {
    expect(saveTagGroup(dataPath, FILE, "Morning", ["AI", "ai", "Tech"])).toEqual({
      morning: ["ai", "tech"],
    });
  });

  it("deletes a group when tags is empty", () => {
    saveTagGroup(dataPath, FILE, "morning", ["ai"]);
    expect(saveTagGroup(dataPath, FILE, "morning", [])).toEqual({});
  });
});
