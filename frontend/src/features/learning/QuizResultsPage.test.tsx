import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { QuizResultsPage } from "./QuizResultsPage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const attemptId = "407d4918-a7f5-4db4-b857-97d8176e305b";

function createAuthContext(user: AuthenticatedUser): AuthContextValue {
  return {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: userId,
        email: "new-user@example.test",
        displayName: "New user",
        roleId: userId,
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

describe("QuizResultsPage", () => {
  it("loads submitted scores and links each result back to its course", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/me/quiz-attempts", () =>
        HttpResponse.json({
          data: [
            {
              id: attemptId,
              quizId: "507d4918-a7f5-4db4-b857-97d8176e305b",
              lineageId: "607d4918-a7f5-4db4-b857-97d8176e305b",
              quizVersion: 1,
              courseId,
              userId,
              quizTitle: "Database basics",
              quizOrigin: "coach",
              answers: [
                {
                  questionId: "question-1",
                  selectedOptionId: "option-1",
                  correct: true,
                },
                {
                  questionId: "question-2",
                  selectedOptionId: "option-2",
                  correct: false,
                },
              ],
              score: 1,
              maxScore: 2,
              startedAt: "2026-01-01T10:00:00.000Z",
              submittedAt: "2026-01-01T10:05:00.000Z",
            },
          ],
        }),
      ),
      http.get(
        `http://localhost:3000/api/v1/me/quiz-attempts/${attemptId}/review`,
        () =>
          HttpResponse.json({
            data: {
              attemptId,
              courseId,
              quizTitle: "Database basics",
              score: 1,
              maxScore: 2,
              submittedAt: "2026-01-01T10:05:00.000Z",
              showFeedback: true,
              questions: [
                {
                  questionId: "question-1",
                  type: "mcq",
                  prompt: "What is a database?",
                  options: [
                    { id: "option-1", text: "An organized collection of data" },
                    { id: "option-2", text: "A programming language" },
                  ],
                  selectedOptionIds: ["option-1"],
                  correctOptionIds: ["option-1"],
                  correct: true,
                  explanation: "Databases organize data.",
                },
              ],
            },
          }),
      ),
    );
    const user: AuthenticatedUser = {
      id: userId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <AuthContext.Provider value={createAuthContext(user)}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <QuizResultsPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    expect(await screen.findByText("Quiz results")).toBeVisible();
    expect(await screen.findByText("1 of 2 correct (50%)")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open course" })).toHaveAttribute(
      "href",
      `/courses/${courseId}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
    expect(await screen.findByText("What is a database?")).toBeVisible();
    expect(screen.getByText("An organized collection of data")).toBeVisible();
    expect(screen.getByText("Databases organize data.")).toBeVisible();
  });
});
