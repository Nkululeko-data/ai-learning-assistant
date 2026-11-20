import { z } from "zod";
import { apiRequest, apiRequestBlob, apiRequestPage } from "./client";

const idSchema = z.string().uuid();

export const documentSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    scope: z.enum(["course", "personal"]),
    filename: z.string(),
    mimeType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "video/mp4",
    ]),
    sizeBytes: z.number().int().positive(),
    status: z.enum(["uploaded", "processing", "ready", "failed", "deleting"]),
    errorCode: z.string().nullable(),
    errorDetail: z.string().nullable(),
    extractionDiagnostics: z
      .object({
        parser: z.enum(["pdfjs-dist", "mammoth", "utf8"]),
        pageCount: z.number().int().nonnegative(),
        charCount: z.number().int().nonnegative(),
        lowTextPages: z.array(z.number().int().positive()),
        warnings: z.array(z.string()),
      })
      .strict()
      .nullable(),
    chunkCount: z.number().int().nonnegative().nullable(),
    embeddingModel: z.string().nullable(),
    ingestJobId: idSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    readyAt: z.string().nullable(),
  })
  .strict();

const uploadScopeSchema = z.enum(["course", "personal"]);
const deleteResultSchema = z
  .object({
    id: idSchema,
    status: z.literal("deleting"),
    cleanupJobId: idSchema,
  })
  .strict();

export type DocumentView = z.infer<typeof documentSchema>;
export type DocumentScope = z.infer<typeof uploadScopeSchema>;
export type DocumentStatus = DocumentView["status"];
export const MAX_LESSON_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

export async function listCourseDocuments(
  courseId: string,
  input: { limit?: number; cursor?: string } = {},
) {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 20),
  });
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }
  return apiRequestPage(
    `/courses/${encodeURIComponent(courseId)}/documents?${query.toString()}`,
    documentSchema,
  );
}

export async function getDocumentStatus(documentId: string): Promise<DocumentView> {
  return apiRequest(
    `/documents/${encodeURIComponent(documentId)}/status`,
    documentSchema,
  );
}

export async function getCoursePdf(documentId: string): Promise<Blob> {
  return apiRequestBlob(`/documents/${encodeURIComponent(documentId)}/file`, {
    headers: { Accept: "application/pdf" },
  });
}

export async function getCourseVideo(documentId: string): Promise<Blob> {
  return apiRequestBlob(`/documents/${encodeURIComponent(documentId)}/file`, {
    headers: { Accept: "video/mp4" },
  });
}

export async function uploadCourseLessonVideo(
  courseId: string,
  file: File,
): Promise<DocumentView> {
  const body = new FormData();
  body.set("file", file, file.name);
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/lesson-videos`,
    documentSchema,
    {
      method: "POST",
      body,
    },
  );
}

export async function uploadDocument(
  courseId: string,
  scope: DocumentScope,
  file: File,
): Promise<DocumentView> {
  const parsedScope = uploadScopeSchema.parse(scope);
  const body = new FormData();
  body.set("courseId", courseId);
  body.set("scope", parsedScope);
  body.set("file", file, file.name);
  return apiRequest("/documents/upload", documentSchema, {
    method: "POST",
    body,
  });
}

export async function retryDocument(documentId: string): Promise<DocumentView> {
  return apiRequest(
    `/documents/${encodeURIComponent(documentId)}/retry`,
    documentSchema,
    { method: "POST" },
  );
}

export async function deleteDocument(
  documentId: string,
): Promise<z.infer<typeof deleteResultSchema>> {
  return apiRequest(
    `/documents/${encodeURIComponent(documentId)}`,
    deleteResultSchema,
    { method: "DELETE" },
  );
}
