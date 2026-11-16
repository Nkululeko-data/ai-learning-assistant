export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown;

  /**
   * Creates a safe, typed application error for API responses.
   */
  public constructor(
    code: string,
    statusCode: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ConflictError extends AppError {
  /**
   * Creates a conflict error for duplicate or stale writes.
   */
  public constructor(message: string, details?: unknown) {
    super("CONFLICT", 409, message, details);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends AppError {
  /**
   * Creates a not-found error without disclosing protected resource details.
   */
  public constructor(message = "Resource not found") {
    super("NOT_FOUND", 404, message);
    this.name = "NotFoundError";
  }
}
