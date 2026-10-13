export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const forbidden = (message = 'Your role does not allow this action.') => new HttpError(403, message);
export const conflict = (message, details) => new HttpError(409, message, details);

export function idParam(req, name = 'id') {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw bad('Invalid id');
  return id;
}

export function mustFind(row, what = 'Record') {
  if (!row) throw notFound(`${what} not found`);
  return row;
}
