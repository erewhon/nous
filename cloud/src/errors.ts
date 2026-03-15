import { HTTPException } from "hono/http-exception";

export function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

export function unauthorized(message = "Unauthorized"): HTTPException {
  return new HTTPException(401, { message });
}

export function forbidden(message = "Forbidden"): HTTPException {
  return new HTTPException(403, { message });
}

export function notFound(message = "Not found"): HTTPException {
  return new HTTPException(404, { message });
}

export function conflict(message: string): HTTPException {
  return new HTTPException(409, { message });
}

export function preconditionFailed(message = "Precondition failed"): HTTPException {
  return new HTTPException(412, { message });
}
