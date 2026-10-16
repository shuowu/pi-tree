import { EPub } from "epub2";
import { extname, join } from "node:path";
import { stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";

/**
 * Read-side access to a source's original.epub for the in-app reader.
 * Paths are zip-internal (e.g. "EPUB/xhtml/Section003.xhtml"); the client
 * resolves relative links against the chapter path and asks for files by it.
 */

export interface EpubTocEntry {
  title: string;
  level: number;
  /** Zip path, optionally with a #fragment */
  href: string;
}

export interface EpubBookInfo {
  title?: string;
  /** Reading order — zip paths of the spine documents */
  spine: string[];
  toc: EpubTocEntry[];
}

interface CachedEpub {
  epub: EPub;
  mtimeMs: number;
  /** zip path → media type from the manifest */
  mediaTypes: Map<string, string>;
}

const CACHE_LIMIT = 8;
const cache = new Map<string, Promise<CachedEpub>>();

const EXT_TYPES: Record<string, string> = {
  ".xhtml": "application/xhtml+xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Path to a source's EPUB, or null when it has none (or the id could escape
 * the sources dir). Uploads store `original.epub`; library imports keep the
 * file as-is under `book/`, used when it's the only EPUB there.
 */
export function epubPath(sourcesBasePath: string, sourceId: string): string | null {
  if (!sourceId || sourceId.startsWith(".") || /[\\/]/.test(sourceId)) return null;
  const dir = join(sourcesBasePath, sourceId);
  const original = join(dir, "original.epub");
  if (existsSync(original)) return original;
  try {
    const epubs = readdirSync(join(dir, "book")).filter((f) => f.toLowerCase().endsWith(".epub"));
    if (epubs.length === 1) return join(dir, "book", epubs[0]);
  } catch {
    /* no book/ dir */
  }
  return null;
}

async function openEpub(filePath: string): Promise<CachedEpub> {
  const { mtimeMs } = await stat(filePath);
  const cached = cache.get(filePath);
  if (cached) {
    const entry = await cached.catch(() => null);
    if (entry && entry.mtimeMs === mtimeMs) {
      // Refresh LRU position
      cache.delete(filePath);
      cache.set(filePath, cached);
      return entry;
    }
    cache.delete(filePath);
  }

  const loading = Promise.resolve(EPub.createAsync(filePath) as Promise<EPub>).then((epub) => {
    const mediaTypes = new Map<string, string>();
    for (const item of manifestItems(epub)) {
      const href = item.href as string | undefined;
      const type = (item["media-type"] ?? item.mediaType) as string | undefined;
      if (href && type) mediaTypes.set(safeDecode(href), type);
    }
    return { epub, mtimeMs, mediaTypes };
  });
  cache.set(filePath, loading);
  loading.catch(() => cache.delete(filePath));
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  return loading;
}

/** Parse an EPUB3 nav document's toc list into flat entries (fallback when there's no NCX). */
export function parseNavToc(navHtml: string, navPath: string): EpubTocEntry[] {
  const tocNav =
    navHtml.match(/<nav[^>]*epub:type=["'][^"']*toc[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? "";
  const dir = navPath.includes("/") ? navPath.slice(0, navPath.lastIndexOf("/") + 1) : "";
  const entries: EpubTocEntry[] = [];
  let depth = -1;
  const re = /<(\/?)(ol|ul)\b[^>]*>|<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tocNav))) {
    if (m[2]) {
      depth += m[1] ? -1 : 1;
      continue;
    }
    const title = m[4].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    entries.push({ title, level: Math.max(depth, 0), href: resolveZipPath(dir, m[3]) });
  }
  return entries;
}

/** Resolve a relative href against a zip directory ("EPUB/xhtml/"), normalizing ./ and ../ */
export function resolveZipPath(dir: string, href: string): string {
  const [path, frag] = href.split("#", 2);
  const parts = (dir + safeDecode(path)).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/") + (frag !== undefined ? `#${frag}` : "");
}

export async function getEpubInfo(filePath: string): Promise<EpubBookInfo> {
  const { epub } = await openEpub(filePath);
  const spine = epub.flow
    .map((item) => item.href as string | undefined)
    .filter((href): href is string => Boolean(href))
    .map((href) => safeDecode(href));

  let toc: EpubTocEntry[] = epub.toc
    .filter((t) => t.href && t.title)
    .map((t) => ({ title: String(t.title).trim(), level: Number(t.level) || 0, href: safeDecode(t.href as string) }));

  if (toc.length === 0) {
    const nav = manifestItems(epub).find((item) =>
      String(item.properties ?? "").split(/\s+/).includes("nav"),
    );
    if (nav?.href) {
      const navPath = safeDecode(nav.href as string);
      const html = await readZipFile(epub, navPath).then((b) => b.toString("utf-8")).catch(() => "");
      toc = parseNavToc(html, navPath);
    }
  }
  return { title: epub.metadata.title ?? undefined, spine, toc };
}

function manifestItems(epub: EPub): Array<Record<string, unknown>> {
  return Object.values(epub.manifest as Record<string, Record<string, unknown>>);
}

function readZipFile(epub: EPub, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    epub.zip.readFile(path, (err: unknown, data: Buffer) => (err ? reject(err) : resolve(data)));
  });
}

/** Read one file out of the EPUB. Returns null when the path isn't in the archive. */
export async function readEpubFile(
  filePath: string,
  zipPath: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const { epub, mediaTypes } = await openEpub(filePath);
  // Only serve names that actually exist in the archive (zip names may be URI-encoded or not)
  const name = epub.zip.names.find((n) => n === zipPath || safeDecode(n) === zipPath);
  if (!name) return null;
  const data = await readZipFile(epub, name);
  const mimeType =
    mediaTypes.get(zipPath) ?? EXT_TYPES[extname(zipPath).toLowerCase()] ?? "application/octet-stream";
  return { data, mimeType };
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}
