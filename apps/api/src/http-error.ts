// Thrown to stop a request with a particular response, for example from
// inside a transaction so that it also rolls back. The error handler turns it
// into `{ error: message }` with this status.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
