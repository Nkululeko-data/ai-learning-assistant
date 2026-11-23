import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { QuizResultsPage } from "./QuizResultsPage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

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
              id: "407d4918-a7f5-4db4-b857-97d8176e305b",
              quizId: "507d4918-a7f5-4db4-b857-97d8176e305b",
              lineageId: "607d4918-a7f5-4db4-b857-97d8176e305b",
              quizVersion: 1,
              courseId,
              userId,
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
  });
});
