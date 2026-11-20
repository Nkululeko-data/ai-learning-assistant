import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { CourseLessonsEditor } from "./CourseLessonsEditor";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({
    user: { role: "coach", permissions: ["document:upload"] },
  }),
}));

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const documentId = "9a7a7701-a1b1-42a4-890d-1b1e54055d0e";
const videoId = "3b22cfde-4ac7-498c-84ad-7d4be50b854c";

describe("CourseLessonsEditor", () => {
  it("keeps saved lessons compact until the coach opens one to edit", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: {
            courseId,
            version: 3,
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
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <CourseLessonsEditor courseId={courseId} />
      </QueryClientProvider>,
    );

    const lessonRow = await screen.findByRole("button", { name: /Cell structure/ });
    expect(screen.queryByRole("textbox", { name: "Topic" })).toBeNull();
    await user.click(lessonRow);
    expect(await screen.findByRole("textbox", { name: "Topic" })).toHaveValue(
      "Cell structure",
    );
  });

  it("uploads an MP4 and saves it with the lesson and its optional course PDF", async () => {
    let savedBody: unknown;
    let uploadedVideo = false;
    const pdfDocument = {
      id: documentId,
      courseId,
      scope: "course",
      filename: "cell-guide.pdf",
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
    };
    const videoDocument = {
      ...pdfDocument,
      id: videoId,
      filename: "cell-cycle.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024 * 1024,
      chunkCount: null,
      embeddingModel: null,
      readyAt: null,
    };
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/lessons`, () =>
        HttpResponse.json({
          data: { courseId, version: 3, lessons: [] },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({
          data: uploadedVideo ? [pdfDocument, videoDocument] : [pdfDocument],
        }),
      ),
      http.post(
        `http://localhost:3000/api/v1/courses/${courseId}/lesson-videos`,
        async ({ request }) => {
          const body = await request.formData();
          const file = body.get("file");
          expect(file).not.toBeNull();
          if (!file || typeof file === "string") {
            throw new Error("The video upload did not include a file.");
          }
          expect(file.type).toBe("video/mp4");
          uploadedVideo = true;
          return HttpResponse.json({ data: videoDocument }, { status: 201 });
        },
      ),
      http.put(
        `http://localhost:3000/api/v1/courses/${courseId}/lessons`,
        async ({ request }) => {
          savedBody = await request.json();
          return HttpResponse.json({
            data: {
              courseId,
              version: 4,
              lessons: [
                {
                  id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
                  title: "Cell structure",
                  introduction: "Explore how cell structures work.",
                  pdfDocumentId: documentId,
                  pdfFilename: "cell-guide.pdf",
                  videoDocumentId: videoId,
                  videoFilename: "cell-cycle.mp4",
                  videoSizeBytes: 1024 * 1024,
                  videoUrl: null,
                },
              ],
            },
          });
        },
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <CourseLessonsEditor courseId={courseId} />
      </QueryClientProvider>,
    );

    await screen.findByText(/No lessons yet/i);
    await user.click(screen.getByRole("button", { name: "Add lesson" }));
    await user.type(screen.getByRole("textbox", { name: "Topic" }), "Cell structure");
    await user.type(
      screen.getByRole("textbox", { name: "Introduction" }),
      "Explore how cell structures work.",
    );
    await user.click(screen.getByRole("combobox", { name: "Optional PDF" }));
    await user.click(await screen.findByRole("option", { name: "cell-guide.pdf" }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error("The lesson video file input is missing.");
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["video"], "cell-cycle.mp4", { type: "video/mp4" })],
      },
    });
    await screen.findByText("cell-cycle.mp4 · 1.0 MB");
    await user.click(screen.getByRole("button", { name: "Save lessons" }));

    expect(await screen.findByText("Course lessons saved.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /youtube|vimeo/i })).toBeNull();
    expect(savedBody).toEqual({
      version: 3,
      lessons: [
        {
          id: expect.any(String),
          title: "Cell structure",
          introduction: "Explore how cell structures work.",
          pdfDocumentId: documentId,
          videoDocumentId: videoId,
          videoUrl: null,
        },
      ],
    });
  }, 10000);
});
