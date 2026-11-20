import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { TextDecoder } from "node:util";
import { extname } from "node:path";
import * as yauzl from "yauzl";
import { AppError } from "../../common/errors/app-error";

interface DetectedFileType {
  ext: string;
  mime: string;
}

const { fileTypeFromBuffer }: {
  fileTypeFromBuffer: (
    buffer: Uint8Array,
  ) => Promise<DetectedFileType | undefined>;
} = createRequire(__filename)("file-type");

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_LESSON_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

export interface ValidatedUpload {
  filename: string;
  mimeType: "application/pdf" | typeof DOCX_MIME_TYPE | "text/plain";
  sizeBytes: number;
  contentHash: string;
}

export interface ValidatedLessonVideoUpload {
  filename: string;
  mimeType: "video/mp4";
  sizeBytes: number;
  contentHash: string;
}

/**
 * Validates an uploaded MP4 by extension, declared MIME and file signature.
 */
export async function validateLessonVideoUpload(
  file: Express.Multer.File,
): Promise<ValidatedLessonVideoUpload> {
  if (
    file.size < 1 ||
    file.size !== file.buffer.length ||
    file.size > MAX_LESSON_VIDEO_SIZE_BYTES
  ) {
    throw new AppError(
      file.size > MAX_LESSON_VIDEO_SIZE_BYTES ? "FILE_TOO_LARGE" : "VALIDATION_FAILED",
      file.size > MAX_LESSON_VIDEO_SIZE_BYTES ? 413 : 422,
      file.size > MAX_LESSON_VIDEO_SIZE_BYTES
        ? "The lesson video exceeds the 100 MB limit"
        : "The uploaded file is empty or invalid",
    );
  }
  const filename = sanitizeFilename(file.originalname);
  if (extname(filename).toLowerCase() !== ".mp4") {
    throw unsupportedVideoFile();
  }
  const declaredMime = file.mimetype.toLowerCase();
  if (!["video/mp4", "application/octet-stream"].includes(declaredMime)) {
    throw unsupportedVideoFile();
  }
  const detected = await fileTypeFromBuffer(file.buffer);
  if (detected?.mime !== "video/mp4") throw unsupportedVideoFile();
  return {
    filename,
    mimeType: "video/mp4",
    sizeBytes: file.size,
    contentHash: createHash("sha256").update(file.buffer).digest("hex"),
  };
}

/**
 * Validates extension, declared MIME, file signature and expanded DOCX size.
 */
export async function validateDocumentUpload(
  file: Express.Multer.File,
  maxExpandedDocxBytes: number,
): Promise<ValidatedUpload> {
  if (file.size < 1 || file.size !== file.buffer.length) {
    throw new AppError("VALIDATION_FAILED", 422, "The uploaded file is empty or invalid");
  }
  const filename = sanitizeFilename(file.originalname);
  const extension = extname(filename).toLowerCase();
  const declaredMime = file.mimetype.toLowerCase();
  const detected = await fileTypeFromBuffer(file.buffer);
  let mimeType: ValidatedUpload["mimeType"];

  if (extension === ".pdf") {
    assertDeclaredMime(
      declaredMime,
      ["application/pdf", "application/octet-stream"],
    );
    if (detected?.mime !== "application/pdf") throw unsupportedFile();
    mimeType = "application/pdf";
  } else if (extension === ".docx") {
    assertDeclaredMime(declaredMime, [
      DOCX_MIME_TYPE,
      "application/zip",
      "application/octet-stream",
    ]);
    if (
      detected?.mime !== "application/zip" &&
      detected?.mime !== DOCX_MIME_TYPE
    ) {
      throw unsupportedFile();
    }
    await validateDocxArchive(file.buffer, maxExpandedDocxBytes);
    mimeType = DOCX_MIME_TYPE;
  } else if (extension === ".txt") {
    assertDeclaredMime(declaredMime, ["text/plain", "application/octet-stream"]);
    if (detected && detected.mime !== "text/plain") throw unsupportedFile();
    decodeTextFile(file.buffer);
    mimeType = "text/plain";
  } else {
    throw unsupportedFile();
  }

  return {
    filename,
    mimeType,
    sizeBytes: file.size,
    contentHash: createHash("sha256").update(file.buffer).digest("hex"),
  };
}

/**
 * Removes client path components and control characters from the display filename.
 */
function sanitizeFilename(originalName: string): string {
  const normalized = originalName.replace(/\\/g, "/");
  const filename = (normalized.split("/").pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  if (!filename || filename === "." || filename === "..") {
    throw new AppError("VALIDATION_FAILED", 422, "A valid filename is required");
  }
  return filename;
}

/**
 * Checks declared multipart MIME without treating it as proof of file content.
 */
function assertDeclaredMime(declaredMime: string, allowed: string[]): void {
  if (!allowed.includes(declaredMime)) throw unsupportedFile();
}

/**
 * Verifies the DOCX package entries and bounds actual decompressed bytes while streaming.
 */
async function validateDocxArchive(
  bytes: Buffer,
  maxExpandedBytes: number,
): Promise<void> {
  let archive: yauzl.ZipFile;
  try {
    archive = await yauzl.fromBufferPromise(bytes, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch {
    throw unsupportedFile();
  }

  let expandedBytes = 0;
  let hasContentTypes = false;
  let hasMainDocument = false;
  try {
    for await (const entry of archive.eachEntry()) {
      if (entry.isEncrypted()) throw unsupportedFile();
      if (expandedBytes + entry.uncompressedSize > maxExpandedBytes) {
        throw new AppError(
          "FILE_TOO_LARGE",
          413,
          "The expanded DOCX file exceeds the configured limit",
        );
      }
      if (entry.fileName === "[Content_Types].xml") hasContentTypes = true;
      if (entry.fileName === "word/document.xml") hasMainDocument = true;

      const stream = await archive.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        expandedBytes += chunk.length;
        if (expandedBytes > maxExpandedBytes) {
          stream.destroy();
          throw new AppError(
            "FILE_TOO_LARGE",
            413,
            "The expanded DOCX file exceeds the configured limit",
          );
        }
      }
      if (expandedBytes > maxExpandedBytes) {
        throw new AppError(
          "FILE_TOO_LARGE",
          413,
          "The expanded DOCX file exceeds the configured limit",
        );
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unsupportedFile();
  } finally {
    archive.close();
  }

  if (!hasContentTypes || !hasMainDocument) throw unsupportedFile();
}

/**
 * Rejects malformed or binary data in a plain UTF-8 text upload.
 */
function decodeTextFile(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unsupportedFile();
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw unsupportedFile();
  }
  return text.replace(/^\uFEFF/, "");
}

/**
 * Creates a non-sensitive error for rejected or malformed file content.
 */
function unsupportedFile(): AppError {
  return new AppError(
    "FILE_TYPE_NOT_ALLOWED",
    415,
    "Only valid PDF, DOCX and UTF-8 TXT files are supported",
  );
}

function unsupportedVideoFile(): AppError {
  return new AppError(
    "FILE_TYPE_NOT_ALLOWED",
    415,
    "Only valid MP4 lesson videos are supported",
  );
}
