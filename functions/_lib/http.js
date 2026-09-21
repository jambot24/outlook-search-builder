import { AuthError } from './auth.js';
import { ValidationError } from './validate.js';

export class LimitError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
  }
}

const MAX_BODY_BYTES = 8 * 1024;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify({ success: status < 400, data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function errorResponse(status, message, data = null) {
  return new Response(JSON.stringify({ success: false, data, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new ValidationError('Expected a JSON body.');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ValidationError('Request body is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Request body is not valid JSON.');
  }
}

// Wraps a handler so known errors become clean responses and unknown ones are logged, not leaked.
export function handle(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (err) {
      if (err instanceof AuthError) return errorResponse(401, err.message);
      if (err instanceof ValidationError) return errorResponse(400, err.message);
      if (err instanceof NotFoundError) return errorResponse(404, err.message);
      if (err instanceof ConflictError) return errorResponse(409, err.message, err.data);
      if (err instanceof LimitError) return errorResponse(429, err.message);
      console.error('Unhandled API error', err?.stack || err);
      return errorResponse(500, 'Something went wrong. Try again.');
    }
  };
}
