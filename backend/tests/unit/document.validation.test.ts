jest.mock("file-type", () => ({
  fileTypeFromBuffer: async (buffer: Uint8Array) => {
    const bytes = Buffer.from(buffer);
    if (bytes.subarray(0, 5).toString() === "%PDF-") {
      return { ext: "pdf", mime: "application/pdf" };
    }
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    ) {
      return { ext: "zip", mime: "application/zip" };
    }
    return undefined;
  },
}));

import { validateDocumentUpload } from "../../src/modules/documents/document.validation";
import { AppError } from "../../src/common/errors/app-error";

describe("document upload validation", () => {
  test("accepts UTF-8 text and stores only a sanitized display filename", async () => {
    const file = {
      originalname: "..\\course\\lesson.txt",
      mimetype: "text/plain",
      size: Buffer.byteLength("A valid lesson."),
      buffer: Buffer.from("A valid lesson.", "utf8"),
    } as Express.Multer.File;

    await expect(validateDocumentUpload(file, 1024)).resolves.toMatchObject({
      filename: "lesson.txt",
      mimeType: "text/plain",
      sizeBytes: file.size,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("rejects a file whose extension does not match its content", async () => {
    const bytes = Buffer.from("not a PDF");
    const file = {
      originalname: "lesson.pdf",
      mimetype: "application/pdf",
      size: bytes.length,
      buffer: bytes,
    } as Express.Multer.File;

    await expect(validateDocumentUpload(file, 1024)).rejects.toMatchObject({
      code: "FILE_TYPE_NOT_ALLOWED",
      statusCode: 415,
    } satisfies Partial<AppError>);
  });
});
