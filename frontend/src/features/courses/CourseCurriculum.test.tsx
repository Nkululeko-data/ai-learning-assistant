import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { CourseCurriculum } from "./CourseCurriculum";

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const quizId = "9a7a7701-a1b1-42a4-890d-1b1e54055d0e";

afterEach(() => vi.unstubAllGlobals());

describe("CourseCurriculum", () => {
  it("navigates ordered topics and only displays media configured for a lesson", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: {
            courseId,
            version: 1,
            lessons: [
              {
                id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
                title: "Cell structure",
                introduction: "Cells contain structures with specialized functions.",
                pdfDocumentId: null,
                pdfFilename: null,
                videoDocumentId: null,
                videoFilename: null,
                videoSizeBytes: null,
                videoUrl: null,
              },
              {
                id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7913",
                title: "Cell division",
                introduction: "Learn how cells divide and grow.",
                pdfDocumentId: null,
                pdfFilename: null,
                videoDocumentId: null,
                videoFilename: null,
                videoSizeBytes: null,
                videoUrl: "https://youtu.be/dQw4w9WgXcQ",
              },
            ],
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CourseCurriculum
            course={{
              id: courseId,
              name: "Biology",
              description: "An introduction to living systems.",
              ownerId: "37c1dbbd-f72a-4508-a662-3992e2506ca4",
              status: "active",
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }}
            hasCourseAccess
            canUseStudyTools
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const firstLesson = await screen.findByRole("button", { name: /Cell structure/ });
    expect(
      screen.queryByText("Cells contain structures with specialized functions."),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Lesson PDF" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Lesson video" })).toBeNull();

    await userEvent.click(firstLesson);
    expect(
      screen.getByText("Cells contain structures with specialized functions."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next lesson" }));
    expect(await screen.findByText("Learn how cells divide and grow.")).toBeVisible();
    expect(screen.getByTitle("Cell division video")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(screen.getByRole("heading", { name: "Lesson video" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Lesson PDF" })).toBeNull();
  });

  it("plays an uploaded lesson video and releases its object URL", async () => {
    class TestURL extends URL {
      static createObjectURL = vi.fn(() => "blob:lesson-video");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: {
            courseId,
            version: 1,
            lessons: [
              {
                id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
                title: "Cell division",
                introduction: "Learn how cells divide and grow.",
                pdfDocumentId: null,
                pdfFilename: null,
                videoDocumentId: "3b22cfde-4ac7-498c-84ad-7d4be50b854c",
                videoFilename: "cell-division.mp4",
                videoSizeBytes: 1024,
                videoUrl: null,
              },
            ],
          },
        }),
      ),
      http.get(
        "http://localhost:3000/api/v1/documents/3b22cfde-4ac7-498c-84ad-7d4be50b854c/file",
        () =>
          new HttpResponse(new Blob(["video-data"], { type: "video/mp4" }), {
            headers: { "Content-Type": "video/mp4" },
          }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CourseCurriculum
            course={{
              id: courseId,
              name: "Biology",
              description: "An introduction to living systems.",
              ownerId: "37c1dbbd-f72a-4508-a662-3992e2506ca4",
              status: "active",
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }}
            hasCourseAccess
            canUseStudyTools
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Cell division/ }));
    const video = await screen.findByLabelText("Cell division video");
    expect(video).toHaveAttribute("src", "blob:lesson-video");
    expect(video).toHaveAttribute("controls");
    expect(TestURL.createObjectURL).toHaveBeenCalledOnce();
    unmount();
    expect(TestURL.revokeObjectURL).toHaveBeenCalledWith("blob:lesson-video");
  });

  it("shows published course quizzes below lessons without exposing private quizzes", async () => {
    const coachQuiz = {
      id: quizId,
      lineageId: "3b22cfde-4ac7-498c-84ad-7d4be50b854c",
      version: 1,
      courseId,
      origin: "coach",
      visibility: "course",
      status: "published",
      title: "Cell structure quiz",
      questions: [
        {
          id: "question-1",
          type: "mcq",
          prompt: "Which structure stores DNA?",
          options: [
            { id: "option-a", text: "Nucleus" },
            { id: "option-b", text: "Ribosome" },
          ],
        },
      ],
      sourceDocumentIds: [],
      sourceChunkIds: [],
      publishedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    server.use(
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
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({
          data: [
            coachQuiz,
            {
              ...coachQuiz,
              id: "ab32cfde-4ac7-498c-84ad-7d4be50b854c",
              origin: "learner_generated",
              visibility: "private",
              title: "My private quiz",
            },
          ],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/quizzes/${quizId}`, () =>
        HttpResponse.json({ data: coachQuiz }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CourseCurriculum
            course={{
              id: courseId,
              name: "Biology",
              description: "An introduction to living systems.",
              ownerId: "37c1dbbd-f72a-4508-a662-3992e2506ca4",
              status: "active",
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }}
            hasCourseAccess
            canUseStudyTools={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const lessonsHeading = await screen.findByRole("heading", { name: "Lessons" });
    const quizzesHeading = await screen.findByRole("heading", {
      name: "Course quizzes",
    });
    expect(lessonsHeading.compareDocumentPosition(quizzesHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const quizSelect = await screen.findByRole("combobox", {
      name: "Published course quizzes",
    });
    await user.click(quizSelect);
    expect(await screen.findByRole("option", { name: /Cell structure quiz/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /My private quiz/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /Cell structure quiz/ }));

    expect(await screen.findByText("Which structure stores DNA?")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Generate quiz" })).toBeNull();
  });
});
