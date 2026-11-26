import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { CoachQuiz, ManualQuizQuestionContent } from "../../api/learning";
import { server } from "../../test/server";
import { CoachQuizzesPanel } from "./CoachQuizzesPanel";

const courseId = "207d4918-a7f5-4db4-b857-97d8176e305b";
const coachId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const quizId = "407d4918-a7f5-4db4-b857-97d8176e305b";

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  server.use(
    http.get(
      `http://localhost:3000/api/v1/courses/${courseId}/quizzes/performance`,
      () => HttpResponse.json({ data: [] }),
    ),
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <CoachQuizzesPanel courseId={courseId} canGenerate />
    </QueryClientProvider>,
  );
}

describe("CoachQuizzesPanel", () => {
  it("creates and saves a manual multiple-choice draft without source documents", async () => {
    const user = userEvent.setup();
    const createHandler = vi.fn();
    const updateHandler = vi.fn();
    const storedQuiz: { current: CoachQuiz | null } = { current: null };

    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/quizzes`, () =>
        HttpResponse.json({
          data: storedQuiz.current ? [storedQuiz.current] : [],
        }),
      ),
      http.post("http://localhost:3000/api/v1/quizzes/manual", async ({ request }) => {
        const body = await request.json();
        createHandler(body);
        const input = body as {
          title: string;
          description?: string;
          questions: ManualQuizQuestionContent[];
        };
        storedQuiz.current = {
          id: quizId,
          lineageId: quizId,
          version: 1,
          courseId,
          createdBy: coachId,
          origin: "coach",
          visibility: "course",
          ownerId: null,
          status: "draft",
          title: input.title,
          description: input.description,
          questions: [],
          sourceDocumentIds: [],
          sourceChunkIds: [],
          generationParams: null,
          generatedBy: null,
          publishedAt: null,
          createdAt: "2026-11-25T10:00:00.000Z",
          updatedAt: "2026-11-25T10:00:00.000Z",
        };
        return HttpResponse.json({ data: storedQuiz.current }, { status: 201 });
      }),
      http.get(`http://localhost:3000/api/v1/quizzes/${quizId}`, () =>
        HttpResponse.json({ data: storedQuiz.current }),
      ),
      http.patch(
        `http://localhost:3000/api/v1/quizzes/${quizId}`,
        async ({ request }) => {
          const body = await request.json();
          updateHandler(body);
          const input = body as {
            title: string;
            description?: string;
            questions: ManualQuizQuestionContent[];
          };
          if (!storedQuiz.current) throw new Error("Manual quiz draft was not created");
          storedQuiz.current = {
            ...storedQuiz.current,
            title: input.title,
            description: input.description,
            questions: input.questions.map((question, index) => ({
              ...question,
              id: `question-${index + 1}`,
              explanation: question.explanation ?? "",
              sourceChunkIds: [],
            })),
            updatedAt: "2026-11-25T10:01:00.000Z",
          };
          return HttpResponse.json({ data: storedQuiz.current });
        },
      ),
    );

    renderPanel();
    await user.click(screen.getByRole("button", { name: "Create manually" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Quiz title" }), {
      target: { value: "Database quiz" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Instructions or description" }),
      {
        target: { value: "Select every correct answer." },
      },
    );
    await user.click(screen.getByRole("button", { name: "Create manual draft" }));

    expect(await screen.findByRole("heading", { name: "Review quiz" })).toBeVisible();
    expect(createHandler).toHaveBeenCalledWith({
      courseId,
      title: "Database quiz",
      description: "Select every correct answer.",
      dueAt: null,
      maxAttempts: null,
      showFeedback: true,
      questions: [],
    });

    await user.click(screen.getByRole("button", { name: "Add question" }));
    const questionSection = screen.getByRole("region", { name: "Question 1" });
    fireEvent.change(
      within(questionSection).getByRole("textbox", { name: "Question 1" }),
      { target: { value: "Which are databases?" } },
    );
    await user.click(
      within(questionSection).getByRole("combobox", { name: "Question type" }),
    );
    await user.click(await screen.findByRole("option", { name: "Multiple choice" }));
    fireEvent.change(
      within(questionSection).getByRole("textbox", { name: "Option 1" }),
      {
        target: { value: "PostgreSQL" },
      },
    );
    fireEvent.change(
      within(questionSection).getByRole("textbox", { name: "Option 2" }),
      {
        target: { value: "MongoDB" },
      },
    );
    await user.click(
      within(questionSection).getByRole("checkbox", { name: "Correct option 1" }),
    );
    await user.click(
      within(questionSection).getByRole("checkbox", { name: "Correct option 2" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview quiz" }));
    expect(screen.getByText("Which are databases?")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Question 1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Return to editing" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(updateHandler).toHaveBeenCalled());
    expect(updateHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        title: "Database quiz",
        description: "Select every correct answer.",
        questions: [
          expect.objectContaining({
            type: "multiple_choice",
            prompt: "Which are databases?",
            correctOptionIds: expect.any(Array),
          }),
        ],
      }),
    );
    const savedQuestion = storedQuiz.current?.questions[0];
    expect(savedQuestion).toMatchObject({
      type: "multiple_choice",
      prompt: "Which are databases?",
      options: [{ text: "PostgreSQL" }, { text: "MongoDB" }],
    });
    if (savedQuestion?.type === "multiple_choice") {
      expect(savedQuestion.correctOptionIds).toHaveLength(2);
    }
  }, 20_000);
});
