import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { FlashcardsPanel } from "./StudyContentPanels";

const courseId = "207d4918-a7f5-4db4-b857-97d8176e305b";
const learnerId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const documentId = "607d4918-a7f5-4db4-b857-97d8176e305b";
const jobId = "707d4918-a7f5-4db4-b857-97d8176e305b";
const flashcardSetId = "807d4918-a7f5-4db4-b857-97d8176e305b";
const createdAt = "2026-11-26T12:00:00.000Z";
const apiUrl = "http://localhost:3000/api/v1";

const flashcardSet = {
  id: flashcardSetId,
  courseId,
  createdBy: learnerId,
  ownerId: learnerId,
  visibility: "private",
  status: "published",
  title: "Database basics",
  sourceDocumentIds: [documentId],
  sourceHash: "a".repeat(64),
  version: 1,
  generatedBy: null,
  createdAt,
  cards: [
    {
      id: "907d4918-a7f5-4db4-b857-97d8176e305b",
      front: "What is a database?",
      back: "An organized collection of data.",
      sourceChunkIds: [`${documentId}:0`],
    },
  ],
  generationParams: {
    selection: { documentIds: [documentId] },
    count: 1,
  },
};

function renderFlashcardsPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FlashcardsPanel
        courseId={courseId}
        selectedDocumentIds={[documentId]}
        topic=""
        canGenerate
      />
    </QueryClientProvider>,
  );
}

describe("FlashcardsPanel", () => {
  it("shows queued progress and loads the generated set when the job completes", async () => {
    const user = userEvent.setup();
    let jobStatusPolls = 0;
    server.use(
      http.get(`${apiUrl}/courses/${courseId}/flashcards`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(`${apiUrl}/flashcards/generate`, async ({ request }) => {
        expect(await request.json()).toMatchObject({
          courseId,
          count: 10,
          selection: { documentIds: [documentId] },
        });
        return HttpResponse.json(
          { data: { jobId, status: "queued" } },
          { status: 202 },
        );
      }),
      http.get(`${apiUrl}/jobs/${jobId}`, () => {
        jobStatusPolls += 1;
        const done = jobStatusPolls > 1;
        return HttpResponse.json({
          data: {
            id: jobId,
            type: "generate",
            status: done ? "done" : "queued",
            attempts: done ? 1 : 0,
            maxAttempts: 3,
            runAfter: createdAt,
            error: null,
            ...(done ? { result: { flashcardSetId } } : {}),
            createdAt,
            updatedAt: createdAt,
            finishedAt: done ? createdAt : null,
          },
        });
      }),
      http.get(`${apiUrl}/flashcards/${flashcardSetId}`, () =>
        HttpResponse.json({ data: flashcardSet }),
      ),
    );

    renderFlashcardsPanel();
    await user.click(screen.getByRole("button", { name: "Generate flashcards" }));

    expect(
      await screen.findByText("Your flashcards are queued for generation."),
    ).toBeVisible();
    expect(
      await screen.findByRole(
        "heading",
        { name: "Database basics" },
        {
          timeout: 10_000,
        },
      ),
    ).toBeVisible();
    expect(screen.getByText("What is a database?")).toBeVisible();
  }, 12_000);

  it("offers a retry when a generation job fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${apiUrl}/courses/${courseId}/flashcards`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(`${apiUrl}/flashcards/generate`, () =>
        HttpResponse.json({ data: { jobId, status: "queued" } }, { status: 202 }),
      ),
      http.get(`${apiUrl}/jobs/${jobId}`, () =>
        HttpResponse.json({
          data: {
            id: jobId,
            type: "generate",
            status: "failed",
            attempts: 1,
            maxAttempts: 3,
            runAfter: createdAt,
            error: {
              code: "GENERATION_FAILED",
              message: "The job could not be completed.",
            },
            createdAt,
            updatedAt: createdAt,
            finishedAt: createdAt,
          },
        }),
      ),
    );

    renderFlashcardsPanel();
    await user.click(screen.getByRole("button", { name: "Generate flashcards" }));

    expect(await screen.findByText(/Flashcard generation failed/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
