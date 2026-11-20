import { z } from "zod";

export const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(64)
      .optional(),
  })
  .strict();

export const createCourseRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const updateCourseRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(["active", "archived"]).optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (body) => body.name !== undefined || body.description !== undefined || body.status !== undefined,
    "At least one course field must be provided",
  );

const supportedVideoHosts = new Set([
  "m.youtube.com",
  "youtu.be",
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "youtube.com",
  "player.vimeo.com",
  "vimeo.com",
  "www.vimeo.com",
]);

const externalVideoUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        supportedVideoHosts.has(url.hostname.toLowerCase())
      );
    } catch {
      return false;
    }
  }, "Use a secure YouTube or Vimeo video link");

const courseLessonRequestSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    introduction: z.string().trim().min(1).max(4000),
    pdfDocumentId: z.string().uuid().nullable(),
    videoDocumentId: z.string().uuid().nullable(),
    videoUrl: externalVideoUrlSchema.nullable(),
  })
  .strict();

export const updateCourseLessonsRequestSchema = z
  .object({
    version: z.number().int().positive(),
    lessons: z.array(courseLessonRequestSchema).max(100),
  })
  .strict()
  .superRefine(({ lessons }, context) => {
    const ids = lessons.map((lesson) => lesson.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["lessons"],
        message: "Lesson IDs must be unique",
      });
    }
    lessons.forEach((lesson, index) => {
      if (lesson.videoDocumentId !== null && lesson.videoUrl !== null) {
        context.addIssue({
          code: "custom",
          path: ["lessons", index, "videoDocumentId"],
          message: "A lesson can have either an uploaded video or a legacy video link",
        });
      }
    });
  });

export const enrolmentListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "approved", "rejected", "removed"]).optional(),
});

export const enrolmentDecisionRequestSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    decisionNote: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const reassignCourseOwnerRequestSchema = z
  .object({
    ownerId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const adminCourseStatusRequestSchema = z
  .object({
    status: z.enum(["active", "archived"]),
    version: z.number().int().positive(),
  })
  .strict();

export type CreateCourseRequest = z.infer<typeof createCourseRequestSchema>;
export type UpdateCourseRequest = z.infer<typeof updateCourseRequestSchema>;
export type UpdateCourseLessonsRequest = z.infer<typeof updateCourseLessonsRequestSchema>;
export type EnrolmentDecisionRequest = z.infer<typeof enrolmentDecisionRequestSchema>;
