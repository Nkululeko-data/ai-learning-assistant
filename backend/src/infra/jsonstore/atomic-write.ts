import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes JSON to a temporary file, flushes it, and atomically renames it into place.
 */
export async function writeJsonAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx");
  let writeError: unknown;
  let closeError: unknown;
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    writeError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    closeError = error;
  }
  if (writeError !== undefined || closeError !== undefined) {
    const failure =
      writeError !== undefined && closeError !== undefined
        ? new AggregateError(
            [writeError, closeError],
            "JSON file write and close failed",
          )
        : writeError ?? closeError;
    await removeTemporaryFile(temporaryPath, failure);
    throw failure;
  }

  try {
    await replaceFileWithRetry(temporaryPath, filePath);
  } catch (error) {
    await removeTemporaryFile(temporaryPath, error);
    throw error;
  }
}

/**
 * Retries transient Windows file-sharing failures without weakening atomic replacement.
 */
async function replaceFileWithRetry(
  temporaryPath: string,
  filePath: string,
): Promise<void> {
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await rename(temporaryPath, filePath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt === maximumAttempts) {
        throw error;
      }
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, attempt * 20),
      );
    }
  }
}

/**
 * Removes an incomplete temporary file and preserves both the primary and cleanup failures.
 */
async function removeTemporaryFile(
  temporaryPath: string,
  originalError: unknown,
): Promise<void> {
  try {
    await unlink(temporaryPath);
  } catch (cleanupError) {
    if (isMissingFileError(cleanupError)) return;
    throw new AggregateError(
      [originalError, cleanupError],
      "JSON write failed and the temporary file could not be removed",
    );
  }
}

/**
 * Returns whether a filesystem error indicates that a temporary file is absent.
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Identifies filesystem sharing errors that may clear after a short delay on Windows.
 */
function isTransientRenameError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["EPERM", "EACCES", "EBUSY"].includes(String(error.code))
  );
}
