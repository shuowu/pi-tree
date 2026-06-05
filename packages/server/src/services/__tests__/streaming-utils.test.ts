import { describe, it, expect, vi } from "vitest";
import { wrapTokenWithEarlyTreeUpdate } from "../streaming-utils.js";

describe("wrapTokenWithEarlyTreeUpdate", () => {
  it("calls onFirstToken on the first token only", async () => {
    const onToken = vi.fn();
    const onFirstToken = vi.fn();

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);

    await wrapped("token-1");
    await wrapped("token-2");
    await wrapped("token-3");

    expect(onFirstToken).toHaveBeenCalledTimes(1);
  });

  it("calls onToken for every token", async () => {
    const onToken = vi.fn();
    const onFirstToken = vi.fn();

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);

    await wrapped("a");
    await wrapped("b");
    await wrapped("c");

    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenNthCalledWith(1, "a");
    expect(onToken).toHaveBeenNthCalledWith(2, "b");
    expect(onToken).toHaveBeenNthCalledWith(3, "c");
  });

  it("calls onFirstToken before onToken on the first call", async () => {
    const callOrder: string[] = [];
    const onToken = vi.fn(async () => { callOrder.push("token"); });
    const onFirstToken = vi.fn(async () => { callOrder.push("firstToken"); });

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);
    await wrapped("x");

    expect(callOrder).toEqual(["firstToken", "token"]);
  });

  it("does not call onFirstToken on subsequent calls", async () => {
    const callOrder: string[] = [];
    const onToken = vi.fn(async () => { callOrder.push("token"); });
    const onFirstToken = vi.fn(async () => { callOrder.push("firstToken"); });

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);
    await wrapped("x");
    await wrapped("y");

    expect(callOrder).toEqual(["firstToken", "token", "token"]);
  });

  it("handles empty string token correctly", async () => {
    const onToken = vi.fn();
    const onFirstToken = vi.fn();

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);
    await wrapped("");
    await wrapped("real-token");

    // Even empty string triggers first-token callback
    expect(onFirstToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenNthCalledWith(1, "");
    expect(onToken).toHaveBeenNthCalledWith(2, "real-token");
  });

  it("propagates errors from onFirstToken", async () => {
    const onToken = vi.fn();
    const onFirstToken = vi.fn(async () => {
      throw new Error("tree snapshot failed");
    });

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);
    await expect(wrapped("x")).rejects.toThrow("tree snapshot failed");
    // onToken should NOT have been called since onFirstToken threw
    expect(onToken).not.toHaveBeenCalled();
  });

  it("propagates errors from onToken", async () => {
    const onToken = vi.fn(async () => {
      throw new Error("write failed");
    });
    const onFirstToken = vi.fn();

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);
    await expect(wrapped("x")).rejects.toThrow("write failed");
    // onFirstToken should still have been called
    expect(onFirstToken).toHaveBeenCalledTimes(1);
  });

  it("works with a single token", async () => {
    const onToken = vi.fn();
    const onFirstToken = vi.fn();

    const wrapped = wrapTokenWithEarlyTreeUpdate(onToken, onFirstToken);
    await wrapped("only-one");

    expect(onFirstToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith("only-one");
  });
});
