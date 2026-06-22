/**
 * Unit tests for YouTube service pure functions.
 *
 * Tests extractVideoId (URL/ID parsing) and isYouTubeUrl (URL detection).
 */
import { describe, it, expect } from "vitest";
import { extractVideoId, isYouTubeUrl } from "../services/youtube.js";

// ---------------------------------------------------------------------------
// extractVideoId
// ---------------------------------------------------------------------------

describe("extractVideoId", () => {
  it("extracts from standard watch URL", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from short URL", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from embed URL", () => {
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from shorts URL", () => {
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from URL with extra query params", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLx")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from URL with feature param before v", () => {
    expect(extractVideoId("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts bare 11-char video ID", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts ID with hyphens and underscores", () => {
    expect(extractVideoId("a1B-c2D_e3F")).toBe("a1B-c2D_e3F");
  });

  it("returns null for empty string", () => {
    expect(extractVideoId("")).toBeNull();
  });

  it("returns null for random text", () => {
    expect(extractVideoId("not a youtube url")).toBeNull();
  });

  it("returns null for non-YouTube URL", () => {
    expect(extractVideoId("https://vimeo.com/12345")).toBeNull();
  });

  it("returns null for ID that's too short", () => {
    expect(extractVideoId("abc123")).toBeNull();
  });

  it("returns null for ID that's too long", () => {
    expect(extractVideoId("dQw4w9WgXcQx")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isYouTubeUrl
// ---------------------------------------------------------------------------

describe("isYouTubeUrl", () => {
  it("returns true for a valid YouTube URL", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("returns true for a bare video ID", () => {
    expect(isYouTubeUrl("dQw4w9WgXcQ")).toBe(true);
  });

  it("returns false for non-YouTube input", () => {
    expect(isYouTubeUrl("hello world")).toBe(false);
  });
});
