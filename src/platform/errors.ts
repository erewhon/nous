// Shared error type for shell-only capabilities hit from the browser build.

export class PlatformUnavailableError extends Error {
  constructor(what: string) {
    super(`${what} is not available in the browser build`);
    this.name = "PlatformUnavailableError";
  }
}
