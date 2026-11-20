import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { QuizPanel } from "./StudyContentPanels";

const courseId = "207d4918-a7f5-4db4-b857-97d8176e305b";
const learnerId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const quizId = "407d4918-a7f5-4db4-b857-97d8176e305b";
const lineageId = "507d4918-a7f5-4db4-b857-97d8176e305b";
const documentId = "607d4918-a7f5-4db4-b857-97d8176e305b";
const attemptId = "707d4918-a7f5-4db4-b857-97d8176e305b";

function renderQuizPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuizPanel
        courseId={courseId}
        selectedDocumentIds={[documentId]}
        topic=""
        canGenerate
      />
    </QueryClientProvider>,
  );
}

describe("QuizPanel", () => {
  it("keeps answer keys hidden until the learner submits the quiz", async () => {
    const user = userEvent.setup();
    const submitHandler = vi.fn();
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post("http://localhost:3000/api/v1/quizzes/generate", () =>
        HttpResponse.json({
          data: {
            id: quizId,
            lineageId,
            version: 1,
            courseId,
            origin: "learner_generated",
            visibility: "private",
            status: "published",
            title: "Test quiz",
            questions: [
              {
                id: "question-1",
                type: "mcq",
                prompt: "Which choice is correct?",
                options: [
                  { id: "option-a", text: "Choice A" },
                  { id: "option-b", text: "Choice B" },
                ],
              },
            ],
            sourceDocumentIds: [documentId],
            sourceChunkIds: ["chunk-1"],
            publishedAt: "2026-11-20T06:00:00.000Z",
            createdAt: "2026-11-20T06:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/quizzes/${quizId}`, () =>
        HttpResponse.json({
          data: {
            id: quizId,
            lineageId,
            version: 1,
            courseId,
            origin: "learner_generated",
            visibility: "private",
            status: "published",
            title: "Test quiz",
            questions: [
              {
                id: "question-1",
                type: "mcq",
                prompt: "Which choice is correct?",
                options: [
                  { id: "option-a", text: "Choice A" },
                  { id: "option-b", text: "Choice B" },
                ],
              },
            ],
            sourceDocumentIds: [documentId],
            sourceChunkIds: ["chunk-1"],
            publishedAt: "2026-11-20T06:00:00.000Z",
            createdAt: "2026-11-20T06:00:00.000Z",
          },
        }),
      ),
      http.post(
        `http://localhost:3000/api/v1/quizzes/${quizId}/attempts`,
        async ({ request }) => {
          submitHandler(await request.json());
          return HttpResponse.json({
            data: {
              attempt: {
                id: attemptId,
                quizId,
                lineageId,
                quizVersion: 1,
                courseId,
                userId: learnerId,
                answers: [
                  {
                    questionId: "question-1",
                    selectedOptionId: "option-b",
                    correct: true,
                  },
                ],
                score: 1,
                maxScore: 1,
                startedAt: "2026-11-20T06:00:00.000Z",
                submittedAt: "2026-11-20T06:00:01.000Z",
              },
              results: [
                {
                  questionId: "question-1",
                  selectedOptionId: "option-b",
                  correctOptionId: "option-b",
                  explanation: "PRIVATE_EXPLANATION",
                  correct: true,
                },
              ],
            },
          });
        },
      ),
    );

    renderQuizPanel();
    await user.click(screen.getByRole("button", { name: "Generate quiz" }));
    expect(await screen.findByText("Which choice is correct?")).toBeVisible();
    expect(screen.queryByText("PRIVATE_EXPLANATION")).toBeNull();
    expect(screen.queryByText("option-b")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Choice B" }));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));

    expect(await screen.findByText("Score: 1 of 1")).toBeVisible();
    expect(await screen.findByText("PRIVATE_EXPLANATION")).toBeVisible();
    await waitFor(() => {
      expect(submitHandler).toHaveBeenCalledWith({
        answers: [{ questionId: "question-1", selectedOptionId: "option-b" }],
      });
    });
  });
});
