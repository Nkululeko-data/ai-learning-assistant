import { z } from "zod";

export const documentUploadFieldsSchema = z
  .object({
    courseId: z.string().uuid(),
    scope: z.enum(["course", "personal"]),
  })
  .strict();

export const documentListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

