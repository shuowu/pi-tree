import { describe, it, expect } from "vitest";
import { parseClassifierAnswer } from "../intent-classifier.js";

const IDS = ["discover"];

describe("parseClassifierAnswer", () => {
  it("maps a bare destination answer", () => {
    expect(parseClassifierAnswer("discover", IDS)).toEqual({
      destination: "discover",
      sourceTypes: [],
    });
  });

  it("extracts content types after the destination", () => {
    expect(parseClassifierAnswer("discover book", IDS)).toEqual({
      destination: "discover",
      sourceTypes: ["book"],
    });
    expect(parseClassifierAnswer("discover feed", IDS)).toEqual({
      destination: "discover",
      sourceTypes: ["news"],
    });
  });

  it("maps none to null", () => {
    expect(parseClassifierAnswer("none", IDS).destination).toBeNull();
  });

  it("maps unsure to null so routing falls through to the LLM router", () => {
    expect(parseClassifierAnswer("unsure", IDS).destination).toBeNull();
  });

  it("uses the latest label when reasoning text mentions others first", () => {
    expect(
      parseClassifierAnswer(
        "The user might want discover, but they already follow feeds. Answer: none",
        IDS,
      ).destination,
    ).toBeNull();
    expect(
      parseClassifierAnswer(
        "This is not none — they want recommendations. Answer: discover",
        IDS,
      ).destination,
    ).toBe("discover");
  });

  it("treats unsure after a destination mention as fall-through", () => {
    expect(
      parseClassifierAnswer("Could be discover... unsure", IDS).destination,
    ).toBeNull();
  });

  it("returns null when no label appears", () => {
    expect(parseClassifierAnswer("I don't know", IDS).destination).toBeNull();
    expect(parseClassifierAnswer("", IDS).destination).toBeNull();
  });
});
