import express from "express";
import request from "supertest";
import { createLogger } from "../../src/common/logging/logger";
import { createErrorHandler } from "../../src/common/middleware/error-handler";

test("logs PostgreSQL SQLSTATE on internal errors without exposing it in the response", async () => {
  const logger = createLogger("silent");
  const errorLog = jest.spyOn(logger, "error");
  const app = express();
  app.get("/failure", (_request, _response, next) => {
    next(Object.assign(new Error("database detail"), { code: "42P01" }));
  });
  app.use(createErrorHandler(logger));

  const response = await request(app).get("/failure");

  expect(response.status).toBe(500);
  expect(response.body.error).toMatchObject({
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
  });
  expect(response.body.error.message).not.toContain("42P01");
  expect(errorLog).toHaveBeenCalledWith(
    expect.objectContaining({ databaseErrorCode: "42P01" }),
    "Unhandled request failure",
  );
  expect(JSON.stringify(errorLog.mock.calls)).not.toContain("database detail");
});
