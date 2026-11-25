import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { CoachQuizzesPanel } from "./CoachQuizzesPanel";
import { CourseDetailsPage } from "./CourseDetailsPage";

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const coachId = "37c1dbbd-f72a-4508-a662-3992e2506ca4";
const learnerId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const documentId = "9a7a7701-a1b1-42a4-890d-1b1e54055d0e";
const quizId = "3b22cfde-4ac7-498c-84ad-7d4be50b854c";
const enrolmentId = "407d4918-35a4-4d4a-9c2a-0f4e3a9a7911";

function createAuthContext(user: AuthenticatedUser): AuthContextValue {
  return {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: coachId,
        email: "coach@example.test",
        displayName: "Test coach",
        roleId: "81bf68e2-2767-4ee5-84c3-99359da40ce1",
        status: "active",
        mustChangePassword: false,
      },
      coachRequestCreated: false,
    }),
    signOut: async () => {},
    updatePassword: async () => {},
    retrySessionBootstrap: () => {},
  };
}

function renderCourseDetails(
  user: AuthenticatedUser,
  initialEntry = `/courses/${courseId}`,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AuthContext.Provider value={createAuthContext(user)}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/courses/:courseId" element={<CourseDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("CourseDetailsPage", () => {
  it("shows provider failure details and the request ID for quiz generation errors", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({
          data: [
            {
              id: documentId,
              courseId,
              scope: "course",
              filename: "Cell structure.pdf",
              mimeType: "application/pdf",
              sizeBytes: 120,
              status: "ready",
              errorCode: null,
              errorDetail: null,
              extractionDiagnostics: null,
              chunkCount: 1,
              embeddingModel: "test-model",
              ingestJobId: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              readyAt: "2026-01-01T00:01:00.000Z",
            },
          ],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post("http://localhost:3000/api/v1/quizzes/generate", () =>
        HttpResponse.json(
          {
            error: {
              code: "PROVIDER_UNAVAILABLE",
              message: "An AI provider is unavailable",
              details: {
                providerFailures: [
                  { provider: "inception", code: "LLM_PROVIDER_AUTH_FAILED" },
                  { provider: "groq", code: "LLM_PROVIDER_AUTH_FAILED" },
                ],
              },
              requestId: "quiz-generation-request-1",
            },
          },
          { status: 503 },
        ),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoachQuizzesPanel courseId={courseId} canGenerate />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "Cell structure.pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Generate draft" }));

    expect(
      await screen.findByText(/Inception and Groq rejected an API key/i),
    ).toBeVisible();
    expect(
      await screen.findByText("Request ID: quiz-generation-request-1"),
    ).toBeVisible();
  });

  it("shows a lesson-topic preview and lets an unapproved learner request access", async () => {
    const learnerId = "307d4918-a7f5-4db4-b857-97d8176e305b";
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            description: "An introduction to the course.",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/preview`, () =>
        HttpResponse.json({
          data: {
            courseId,
            lessons: [
              {
                id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
                title: "Cell structure",
              },
            ],
          },
        }),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(`http://localhost:3000/api/v1/courses/${courseId}/join`, () =>
        HttpResponse.json({
          data: {
            id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7913",
            courseId,
            userId: learnerId,
            status: "pending",
            requestedAt: "2026-01-01T00:00:00.000Z",
            decidedBy: null,
            decidedAt: null,
            decisionNote: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
    );
    const learner: AuthenticatedUser = {
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    };
    renderCourseDetails(learner);

    expect(await screen.findByRole("heading", { name: "Course one" })).toBeVisible();
    expect(screen.getByText("An introduction to the course.")).toBeVisible();
    expect(await screen.findByText("Cell structure")).toBeVisible();
    expect(screen.getByRole("button", { name: "Request to join" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Request to join" }));
    expect(
      await screen.findByText("Your request to join this course is pending approval."),
    ).toBeVisible();
  });

  it("does not display cohort counts before the privacy threshold is met", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/insights`, () =>
        HttpResponse.json({
          data: {
            courseId,
            periodStart: "2026-01-01T00:00:00.000Z",
            periodEnd: "2026-01-31T00:00:00.000Z",
            minCohortSizeUsed: 5,
            cohortQualified: false,
            distinctLearnerCount: 2,
            questionCount: null,
            insufficientQuestionCount: null,
            helpfulFeedbackCount: null,
            notHelpfulFeedbackCount: null,
            quizAttemptCount: null,
            quizAverageScore: null,
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/gap-report`, () =>
        HttpResponse.json({ data: null }),
      ),
    );

    const user: AuthenticatedUser = {
      id: coachId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: ["insights:view"],
      permsVersion: 1,
    };
    renderCourseDetails(user, `/courses/${courseId}#course-insights`);

    expect(await screen.findByText(/minimum cohort size \(5\)/i)).toBeVisible();
    expect(screen.queryByText("2", { exact: true })).toBeNull();
  });

  it("keeps coach course sections out of the overview", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            description: "An introduction to the course.",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: { courseId, version: 1, lessons: [] },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    renderCourseDetails({
      id: coachId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: ["course:edit"],
      permsVersion: 1,
    });

    expect(
      await screen.findByRole("heading", { name: "Course overview" }),
    ).toBeVisible();
    expect(screen.getByText("An introduction to the course.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Course lessons" })).toBeNull();
  });

  it("shows a removed learner the coach's recorded reason", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: { id: courseId, name: "Course one" },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/preview`, () =>
        HttpResponse.json({ data: { courseId, lessons: [] } }),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({
          data: [
            {
              id: enrolmentId,
              courseId,
              userId: learnerId,
              status: "removed",
              requestedAt: "2026-01-02T00:00:00.000Z",
              decidedBy: coachId,
              decidedAt: "2026-01-03T00:00:00.000Z",
              decisionNote: "Please follow class guidelines.",
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
              course: {
                id: courseId,
                name: "Course one",
                status: "active",
              },
            },
          ],
        }),
      ),
    );
    renderCourseDetails({
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    });

    expect(
      await screen.findByText(/Coach’s reason: Please follow class guidelines\./),
    ).toBeVisible();
  });

  it("shows the course introduction only in the overview", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            description: "The course introduction belongs on this page.",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
    );
    renderCourseDetails({
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    });

    expect(
      await screen.findByText("The course introduction belongs on this page."),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Lessons" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Class learners" })).toBeNull();
  });

  it("shows only the ordered lessons when Lessons is selected", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            description: "The course introduction belongs on the overview.",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: {
            courseId,
            version: 1,
            lessons: [
              {
                id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
                title: "Cell structure",
                introduction: "Explore how cell structures work.",
                pdfDocumentId: null,
                pdfFilename: null,
                videoDocumentId: null,
                videoFilename: null,
                videoSizeBytes: null,
                videoUrl: null,
              },
            ],
          },
        }),
      ),
    );
    renderCourseDetails(
      {
        id: learnerId,
        email: "learner@example.test",
        displayName: "Test learner",
        role: "learner",
        status: "active",
        mustChangePassword: false,
        permissions: ["content:generate"],
        permsVersion: 1,
      },
      `/courses/${courseId}#course-curriculum`,
    );

    const lessonRow = await screen.findByRole("button", { name: /Cell structure/ });
    expect(
      screen.queryByText("The course introduction belongs on the overview."),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Class learners" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Course quizzes" })).toBeNull();
    expect(lessonRow).toBeVisible();
    expect(screen.queryByText("Explore how cell structures work.")).toBeNull();
    await userEvent.click(lessonRow);
    expect(screen.getByText("Explore how cell structures work.")).toBeVisible();
  });

  it("shows only the learner roster when People is selected", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            description: "The course introduction belongs on the overview.",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/learners`, () =>
        HttpResponse.json({
          data: [
            {
              id: enrolmentId,
              learnerId: "55bf68e2-2767-4ee5-84c3-99359da40ce1",
              displayName: "A classmate",
              enrolledAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        }),
      ),
    );
    renderCourseDetails(
      {
        id: learnerId,
        email: "learner@example.test",
        displayName: "Test learner",
        role: "learner",
        status: "active",
        mustChangePassword: false,
        permissions: ["content:generate"],
        permsVersion: 1,
      },
      `/courses/${courseId}#course-people`,
    );

    expect(
      await screen.findByRole("heading", { name: "Class learners" }),
    ).toBeVisible();
    expect(await screen.findByText("A classmate")).toBeVisible();
    expect(
      screen.queryByText("The course introduction belongs on the overview."),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Lessons" })).toBeNull();
  });

  it("shows the lesson editor to a course owner with edit permission", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: { courseId, version: 1, lessons: [] },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    renderCourseDetails(
      {
        id: coachId,
        email: "coach@example.test",
        displayName: "Test coach",
        role: "coach",
        status: "active",
        mustChangePassword: false,
        permissions: ["course:edit"],
        permsVersion: 1,
      },
      `/courses/${courseId}#course-lessons-editor`,
    );

    expect(
      await screen.findByRole("heading", { name: "Course lessons" }),
    ).toBeVisible();
    await screen.findByText(/No lessons yet/i);
    expect(screen.getByRole("button", { name: "Add lesson" })).toBeEnabled();
  });

  it("lets a course owner remove a learner with a required reason", async () => {
    let learnerIsEnrolled = true;
    let submittedReason: unknown;
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/learners`, () =>
        HttpResponse.json({
          data: learnerIsEnrolled
            ? [
                {
                  id: enrolmentId,
                  learnerId,
                  displayName: "Test learner",
                  enrolledAt: "2026-01-02T00:00:00.000Z",
                },
              ]
            : [],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/join-requests`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(
        `http://localhost:3000/api/v1/enrolments/${enrolmentId}/remove`,
        async ({ request }) => {
          submittedReason = await request.json();
          learnerIsEnrolled = false;
          return HttpResponse.json({
            data: {
              id: enrolmentId,
              courseId,
              userId: learnerId,
              status: "removed",
              requestedAt: "2026-01-02T00:00:00.000Z",
              decidedBy: coachId,
              decidedAt: "2026-01-03T00:00:00.000Z",
              decisionNote: "Please follow class guidelines.",
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
            },
          });
        },
      ),
    );
    renderCourseDetails(
      {
        id: coachId,
        email: "coach@example.test",
        displayName: "Test coach",
        role: "coach",
        status: "active",
        mustChangePassword: false,
        permissions: ["enrolment:approve"],
        permsVersion: 1,
      },
      `/courses/${courseId}#course-people`,
    );

    await screen.findByRole("heading", { name: "Class learners" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Test learner from course" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Test learner from course" }),
    );
    expect(screen.getByRole("button", { name: "Confirm removal" })).toBeDisabled();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Reason for removal" }),
      "  Please follow class guidelines.  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Test learner was removed from this course.",
    );
    expect(submittedReason).toEqual({ reason: "Please follow class guidelines." });
  });

  it("generates and publishes a coach quiz below the lesson editor", async () => {
    let generatedQuiz: {
      id: string;
      lineageId: string;
      version: number;
      courseId: string;
      createdBy: string;
      origin: "coach";
      visibility: "course";
      ownerId: null;
      status: "draft" | "published";
      title: string;
      questions: {
        id: string;
        type: "mcq";
        prompt: string;
        options: { id: string; text: string }[];
        correctOptionId: string;
        explanation: string;
        sourceChunkIds: string[];
      }[];
      sourceDocumentIds: string[];
      sourceChunkIds: string[];
      generationParams: {
        selection: { documentIds: string[]; topic: string };
        count: number;
        types: "mcq"[];
        difficulty: "medium";
      };
      generatedBy: {
        executionId: string;
        provider: "groq";
        model: string;
        promptVersion: string;
      };
      publishedAt: string | null;
      createdAt: string;
      updatedAt: string;
    } | null = null;
    const user = userEvent.setup();
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: { courseId, version: 1, lessons: [] },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({
          data: [
            {
              id: documentId,
              courseId,
              scope: "course",
              filename: "Cell structure.pdf",
              mimeType: "application/pdf",
              sizeBytes: 120,
              status: "ready",
              errorCode: null,
              errorDetail: null,
              extractionDiagnostics: null,
              chunkCount: 1,
              embeddingModel: "test-model",
              ingestJobId: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              readyAt: "2026-01-01T00:01:00.000Z",
            },
          ],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({ data: generatedQuiz ? [generatedQuiz] : [] }),
      ),
      http.get(`http://localhost:3000/api/v1/quizzes/${quizId}`, () => {
        if (!generatedQuiz) {
          return HttpResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
        }
        return HttpResponse.json({ data: generatedQuiz });
      }),
      http.post(
        "http://localhost:3000/api/v1/quizzes/generate",
        async ({ request }) => {
          expect(await request.json()).toEqual({
            courseId,
            selection: { documentIds: [documentId], topic: "Cell structure" },
            count: 5,
            types: ["mcq"],
            difficulty: "medium",
          });
          generatedQuiz = {
            id: quizId,
            lineageId: "5a554a4c-9a9c-467c-9742-1118b71897b9",
            version: 1,
            courseId,
            createdBy: coachId,
            origin: "coach",
            visibility: "course",
            ownerId: null,
            status: "draft",
            title: "Cell structure quiz",
            questions: [
              {
                id: "question-1",
                type: "mcq",
                prompt: "Which structure contains DNA?",
                options: [
                  { id: "option-a", text: "Nucleus" },
                  { id: "option-b", text: "Ribosome" },
                ],
                correctOptionId: "option-a",
                explanation: "The nucleus stores most of a cell's DNA.",
                sourceChunkIds: ["chunk-1"],
              },
            ],
            sourceDocumentIds: [documentId],
            sourceChunkIds: ["chunk-1"],
            generationParams: {
              selection: { documentIds: [documentId], topic: "Cell structure" },
              count: 5,
              types: ["mcq"],
              difficulty: "medium",
            },
            generatedBy: {
              executionId: "b5a2c31f-a22e-43fb-bd51-0124a3c437ac",
              provider: "groq",
              model: "test-model",
              promptVersion: "test-v1",
            },
            publishedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          };
          return HttpResponse.json({ data: generatedQuiz }, { status: 201 });
        },
      ),
      http.patch(
        `http://localhost:3000/api/v1/quizzes/${quizId}`,
        async ({ request }) => {
          expect(await request.json()).toEqual({
            version: 1,
            title: "Cell structure quiz revised",
            questions: [
              {
                type: "mcq",
                prompt: "Which structure stores DNA?",
                options: [
                  { id: "option-a", text: "Nucleus" },
                  { id: "option-b", text: "Ribosome" },
                ],
                correctOptionId: "option-a",
                explanation: "The nucleus stores most of a cell's DNA.",
                sourceChunkIds: ["chunk-1"],
              },
            ],
          });
          if (!generatedQuiz) {
            throw new Error("The generated quiz is missing.");
          }
          generatedQuiz = {
            ...generatedQuiz,
            version: 2,
            title: "Cell structure quiz revised",
            questions: [
              {
                ...generatedQuiz.questions[0]!,
                prompt: "Which structure stores DNA?",
              },
            ],
            updatedAt: "2026-01-01T00:02:00.000Z",
          };
          return HttpResponse.json({ data: generatedQuiz });
        },
      ),
      http.post(
        `http://localhost:3000/api/v1/quizzes/${quizId}/publish`,
        async ({ request }) => {
          expect(await request.json()).toEqual({ version: 2 });
          if (!generatedQuiz) {
            throw new Error("The generated quiz is missing.");
          }
          generatedQuiz = {
            ...generatedQuiz,
            status: "published",
            publishedAt: "2026-01-01T00:03:00.000Z",
            updatedAt: "2026-01-01T00:03:00.000Z",
          };
          return HttpResponse.json({ data: generatedQuiz });
        },
      ),
    );

    renderCourseDetails(
      {
        id: coachId,
        email: "coach@example.test",
        displayName: "Test coach",
        role: "coach",
        status: "active",
        mustChangePassword: false,
        permissions: ["course:edit", "content:generate", "quiz:create"],
        permsVersion: 1,
      },
      `/courses/${courseId}#course-quizzes`,
    );

    expect(
      await screen.findByRole("heading", { name: "Course quizzes" }),
    ).toBeVisible();
    await user.click(await screen.findByLabelText("Cell structure.pdf"));
    await user.type(screen.getByLabelText("Optional topic"), "Cell structure");
    await user.click(screen.getByRole("button", { name: "Generate draft" }));

    expect(await screen.findByRole("textbox", { name: "Question 1" })).toHaveValue(
      "Which structure contains DNA?",
    );
    await user.clear(screen.getByLabelText("Quiz title"));
    await user.type(screen.getByLabelText("Quiz title"), "Cell structure quiz revised");
    const questionField = screen.getByRole("textbox", { name: "Question 1" });
    await user.clear(questionField);
    await user.type(questionField, "Which structure stores DNA?");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "Publish for learners" }));
    expect(
      await screen.findByText("This quiz is available to learners."),
    ).toBeVisible();
  }, 20000);
});
