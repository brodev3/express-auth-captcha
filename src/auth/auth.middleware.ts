import type { RequestHandler } from "express";

export const requireAuthenticated: RequestHandler = (request, response, next): void => {
  if (!request.session.auth) {
    response.redirect(303, "/login");
    return;
  }

  next();
};
