/** An error that is safe to show to the client: it carries its own status and code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
