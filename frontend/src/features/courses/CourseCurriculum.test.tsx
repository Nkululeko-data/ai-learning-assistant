import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { CourseCurriculum } from "./CourseCurriculum";

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

afterEach(() => vi.unstubAllGlobals());

describe("CourseCurriculum", () => {
  it("does not reuse the paginated enrolment cache when opening a course preview", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/preview`, () =>
        HttpResponse.json({ data: { courseId, lessons: [] } }),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["enrolments", "mine"], {
      pages: [{ items: [] }],
      pageParams: [undefined],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CourseCurriculum
            course={{
              id: courseId,
              name: "Biology",
              description: "An introduction to living systems.",
            }}
            hasCourseAccess={false}
            canUseStudyTools={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const requestButton = await screen.findByRole("button", {
      name: "Request to join",
    });
    await waitFor(() => expect(requestButton).toBeEnabled());
  });

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
});
