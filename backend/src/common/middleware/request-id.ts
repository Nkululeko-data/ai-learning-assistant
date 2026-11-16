import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns a validated request ID and returns it in the response header.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const suppliedId = req.header("x-request-id");
  const requestId =
    suppliedId && requestIdPattern.test(suppliedId) ? suppliedId : randomUUID();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};
