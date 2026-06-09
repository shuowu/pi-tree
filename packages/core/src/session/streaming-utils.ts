/**
 * Streaming callback helpers.
 * Extracted for testability.
 */

/**
 * Wraps a token callback so that a tree snapshot is emitted on the first token.
 * After the first call, subsequent tokens are forwarded directly without
 * triggering another tree update.
 *
 * @param onToken     Original token callback
 * @param onFirstToken Called once on the very first token (e.g. to emit tree snapshot)
 * @returns Wrapped token callback
 */
export function wrapTokenWithEarlyTreeUpdate(
  onToken: (token: string) => Promise<void>,
  onFirstToken: () => Promise<void>,
): (token: string) => Promise<void> {
  let fired = false;
  return async (token: string) => {
    if (!fired) {
      fired = true;
      await onFirstToken();
    }
    await onToken(token);
  };
}
