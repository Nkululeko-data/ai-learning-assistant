import { z } from "zod";
import { apiRequest, apiRequestPage } from "./client";

const idSchema = z.string().uuid();

export const courseCardSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    description: z.string().optional(),
  })
  .strict();

export const courseViewSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    description: z.string().optional(),
    ownerId: idSchema,
    status: z.enum(["active", "archived"]),
    approvalStatus: z.enum(["pending", "approved", "changes_requested"]).optional(),
    approvalNote: z.string().nullable().optional(),
    approvalRequestedAt: z.string().nullable().optional(),
    reviewedBy: idSchema.nullable().optional(),
    reviewedAt: z.string().nullable().optional(),
    version: z.number().int().positive(),
    archivedAt: z.string().nullable().optional(),
    archivedBy: idSchema.nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const courseLessonSchema = z
  .object({
    id: idSchema,
    title: z.string(),
    introduction: z.string(),
    pdfDocumentId: idSchema.nullable(),
    pdfFilename: z.string().nullable(),
    videoDocumentId: idSchema.nullable(),
    videoFilename: z.string().nullable(),
    videoSizeBytes: z.number().int().positive().nullable(),
    videoUrl: z.string().nullable(),
  })
  .strict();

export const courseLessonsSchema = z
  .object({
    courseId: idSchema,
    version: z.number().int().positive(),
    lessons: z.array(courseLessonSchema),
  })
  .strict();

export const coursePreviewSchema = z
  .object({
    courseId: idSchema,
    lessons: z
      .array(
        z
          .object({
            id: idSchema,
            title: z.string(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const courseListItemSchema = z.union([courseViewSchema, courseCardSchema]);

export const enrolmentSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    userId: idSchema,
    status: z.enum(["pending", "approved", "rejected", "removed"]),
    requestedAt: z.string(),
    decidedBy: idSchema.nullable().optional(),
    decidedAt: z.string().nullable().optional(),
    decisionNote: z.string().max(1000).nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const enrolmentViewSchema = enrolmentSchema.extend({
  course: courseCardSchema.extend({
    status: z.enum(["active", "archived"]),
  }),
});

export const courseLearnerSchema = z
  .object({
    id: idSchema,
    learnerId: idSchema,
    displayName: z.string(),
    enrolledAt: z.string(),
  })
  .strict();

export const joinRequestSchema = enrolmentSchema.extend({
  applicant: z
    .object({
      id: idSchema,
      displayName: z.string(),
      email: z.string().email(),
    })
    .strict(),
});

const createCourseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

const updateCourseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(["active", "archived"]).optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.status !== undefined,
    "At least one course field must be provided",
  );

export type CourseCard = z.infer<typeof courseCardSchema>;
export type CourseView = z.infer<typeof courseViewSchema>;
export type CourseLesson = z.infer<typeof courseLessonSchema>;
export type CourseLessons = z.infer<typeof courseLessonsSchema>;
export type CoursePreview = z.infer<typeof coursePreviewSchema>;
export type CourseListItem = z.infer<typeof courseListItemSchema>;
export type Enrolment = z.infer<typeof enrolmentSchema>;
export type EnrolmentView = z.infer<typeof enrolmentViewSchema>;
export type JoinRequest = z.infer<typeof joinRequestSchema>;
export type CourseLearner = z.infer<typeof courseLearnerSchema>;
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>;

export interface CoursePage {
  items: CourseListItem[];
  nextCursor?: string;
}

export async function listCourses(
  input: {
    limit?: number;
    cursor?: string;
  } = {},
): Promise<CoursePage> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 20),
  });
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }
  return apiRequestPage(`/courses?${query.toString()}`, courseListItemSchema);
}

export async function listMyCourses(input: { limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
  if (input.cursor) query.set("cursor", input.cursor);
  return apiRequestPage(`/me/courses?${query.toString()}`, courseViewSchema);
}

export async function listAllMyCourses(): Promise<CourseView[]> {
  const courses: CourseView[] = [];
  let cursor: string | undefined;
  do {
    const page = await listMyCourses({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    courses.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return courses;
}

export async function getCourse(courseId: string): Promise<CourseListItem> {
  return apiRequest(`/courses/${encodeURIComponent(courseId)}`, courseListItemSchema);
}

export async function getCourseLessons(courseId: string): Promise<CourseLessons> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/lessons`,
    courseLessonsSchema,
  );
}

export async function getCoursePreview(courseId: string): Promise<CoursePreview> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/preview`,
    coursePreviewSchema,
  );
}

export async function updateCourseLessons(
  courseId: string,
  input: {
    version: number;
    lessons: Array<
      Pick<
        CourseLesson,
        | "id"
        | "title"
        | "introduction"
        | "pdfDocumentId"
        | "videoDocumentId"
        | "videoUrl"
      >
    >;
  },
): Promise<CourseLessons> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/lessons`,
    courseLessonsSchema,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

export async function createCourse(input: CreateCourseInput): Promise<CourseView> {
  const parsedInput = createCourseInputSchema.parse(input);
  return apiRequest("/courses", courseViewSchema, {
    method: "POST",
    body: JSON.stringify(parsedInput),
  });
}

export async function updateCourse(
  courseId: string,
  input: UpdateCourseInput,
): Promise<CourseView> {
  const parsedInput = updateCourseInputSchema.parse(input);
  return apiRequest(`/courses/${encodeURIComponent(courseId)}`, courseViewSchema, {
    method: "PATCH",
    body: JSON.stringify(parsedInput),
  });
}

export async function submitCourseForApproval(
  courseId: string,
  version: number,
): Promise<CourseView> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/submit-for-approval`,
    courseViewSchema,
    {
      method: "POST",
      body: JSON.stringify({ version }),
    },
  );
}

export async function requestCourseJoin(courseId: string): Promise<Enrolment> {
  return apiRequest(`/courses/${encodeURIComponent(courseId)}/join`, enrolmentSchema, {
    method: "POST",
  });
}

export async function listMyEnrolments(
  input: { limit?: number; cursor?: string } = {},
) {
  const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
  if (input.cursor) query.set("cursor", input.cursor);
  return apiRequestPage(`/me/enrolments?${query.toString()}`, enrolmentViewSchema);
}

export async function listAllMyEnrolments(): Promise<EnrolmentView[]> {
  const enrolments: EnrolmentView[] = [];
  let cursor: string | undefined;
  do {
    const page = await listMyEnrolments({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    enrolments.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return enrolments;
}

export async function listCourseJoinRequests(
  courseId: string,
  input: { limit?: number; cursor?: string; status?: Enrolment["status"] } = {},
) {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.status) query.set("status", input.status);
  return apiRequestPage(
    `/courses/${encodeURIComponent(courseId)}/join-requests?${query.toString()}`,
    joinRequestSchema,
  );
}

export async function listCourseLearners(
  courseId: string,
  input: { limit?: number; cursor?: string } = {},
) {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
  if (input.cursor) query.set("cursor", input.cursor);
  return apiRequestPage(
    `/courses/${encodeURIComponent(courseId)}/learners?${query.toString()}`,
    courseLearnerSchema,
  );
}

export async function removeCourseLearner(
  enrolmentId: string,
  reason: string,
): Promise<Enrolment> {
  return apiRequest(
    `/enrolments/${encodeURIComponent(enrolmentId)}/remove`,
    enrolmentSchema,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export async function decideCourseJoinRequest(
  enrolmentId: string,
  input: { status: "approved" | "rejected"; decisionNote?: string },
) {
  return apiRequest(`/enrolments/${encodeURIComponent(enrolmentId)}`, enrolmentSchema, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
