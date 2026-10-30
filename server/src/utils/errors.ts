export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, 'FORBIDDEN', msg);
export const badRequest = (msg = 'Invalid request.') => new HttpError(400, 'BAD_REQUEST', msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, 'NOT_FOUND', msg);
