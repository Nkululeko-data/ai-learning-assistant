import { describe, expect, it } from "vitest";
import { maxUploadSizeMb, validateDocumentFile } from "./file-validation";

describe("validateDocumentFile", () => {
  it("accepts supported extensions and matching browser MIME types", async () => {
    const pdf = new File(["pdf"], "course.pdf", { type: "application/pdf" });
    const docx = new File(["docx"], "course.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const txt = new File(["course notes"], "notes.txt", { type: "text/plain" });

    await expect(validateDocumentFile(pdf)).resolves.toBeNull();
    await expect(validateDocumentFile(docx)).resolves.toBeNull();
    await expect(validateDocumentFile(txt)).resolves.toBeNull();
  });

  it("rejects mismatched types, unsupported extensions, empty files, and oversized uploads", async () => {
    const mismatched = new File(["data"], "course.pdf", { type: "text/plain" });
    const unsupported = new File(["data"], "course.doc", {
      type: "application/msword",
    });
    const empty = new File([], "empty.pdf", { type: "application/pdf" });
    const oversized = new File(
      [new Uint8Array(maxUploadSizeMb * 1024 * 1024 + 1)],
      "large.pdf",
      { type: "application/pdf" },
    );

    await expect(validateDocumentFile(mismatched)).resolves.toMatch(/does not match/i);
    await expect(validateDocumentFile(unsupported)).resolves.toMatch(
      /PDF, DOCX, or TXT/i,
    );
    await expect(validateDocumentFile(empty)).resolves.toMatch(/empty/i);
    await expect(validateDocumentFile(oversized)).resolves.toMatch(/no larger than/i);
  });
});
