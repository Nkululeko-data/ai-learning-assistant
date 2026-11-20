import { z } from "zod";

export const maxUploadSizeMb = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .parse(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB ?? "10");

const allowedMimeTypes: Record<string, string[]> = {
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream",
  ],
  ".txt": ["text/plain", "application/octet-stream"],
};

export async function validateDocumentFile(file: File): Promise<string | null> {
  if (file.size < 1) {
    return "The selected file is empty.";
  }
  if (file.size > maxUploadSizeMb * 1024 * 1024) {
    return `Choose a file no larger than ${maxUploadSizeMb} MB.`;
  }

  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const allowedTypes = allowedMimeTypes[extension];
  if (!allowedTypes) {
    return "Choose a PDF, DOCX, or TXT file.";
  }
  if (file.type && !allowedTypes.includes(file.type.toLowerCase())) {
    return `The file type does not match the ${extension.slice(1).toUpperCase()} extension.`;
  }

  return null;
}
