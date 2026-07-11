/**
 * Tag groups — named bundles of feed tags for routing.
 *
 * A source type can declare `tagGroupsFile` (relative to $DATA_PATH) in its
 * manifest, e.g. `sources/news/tag-groups.json`:
 *
 *   { "morning": ["ai", "tech", "finance"], "weekend": ["papers", "crypto"] }
 *
 * A `#morning` mention then expands to its member tags wherever mentions are
 * resolved (deterministic route + resolve_mentions tool). Groups reference
 * tags — not feeds — so newly tagged feeds are picked up automatically.
 * Group names share the `#tag` namespace; expansion is one level (a group
 * member that happens to name another group is treated as a plain tag).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export type TagGroups = Record<string, string[]>;

export interface ExpandedTags {
  /** Deduplicated tags with group names replaced by their members. */
  tags: string[];
  /** Names of the groups that were expanded (for titles/labels). */
  groups: string[];
}

/** Load tag groups from a file. Returns {} when missing or invalid. */
export function loadTagGroups(dataPath: string, tagGroupsFile: string | undefined): TagGroups {
  if (!tagGroupsFile) return {};
  const filePath = join(dataPath, tagGroupsFile);
  if (!existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const groups: TagGroups = {};
    for (const [name, tags] of Object.entries(raw)) {
      if (Array.isArray(tags)) {
        groups[name.toLowerCase()] = tags.filter((t): t is string => typeof t === "string");
      }
    }
    return groups;
  } catch {
    return {};
  }
}

/** Expand group names in a tag list to their member tags (order-preserving, deduplicated). */
export function expandTagGroups(tags: string[], groups: TagGroups): ExpandedTags {
  const out: string[] = [];
  const seen = new Set<string>();
  const matched: string[] = [];
  for (const tag of tags) {
    const members = groups[tag.toLowerCase()];
    if (members) {
      matched.push(tag.toLowerCase());
      for (const m of members) {
        if (!seen.has(m)) {
          seen.add(m);
          out.push(m);
        }
      }
    } else if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return { tags: out, groups: matched };
}

/**
 * Create, update, or delete a tag group. An empty `tags` array deletes the
 * group. Returns the updated group map.
 */
export function saveTagGroup(
  dataPath: string,
  tagGroupsFile: string,
  name: string,
  tags: string[],
): TagGroups {
  const groups = loadTagGroups(dataPath, tagGroupsFile);
  const key = name.toLowerCase();
  if (tags.length === 0) {
    delete groups[key];
  } else {
    groups[key] = [...new Set(tags.map((t) => t.toLowerCase()))];
  }
  const filePath = join(dataPath, tagGroupsFile);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(groups, null, 2) + "\n", "utf-8");
  return groups;
}
