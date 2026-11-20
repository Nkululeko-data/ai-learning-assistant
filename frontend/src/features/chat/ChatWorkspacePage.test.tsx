import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { ChatWorkspacePage } from "./ChatWorkspacePage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const conversationId = "3eb0d2cf-35d3-4775-94da-f0c18c4481a7";
const userMessageId = "e16a869a-955c-4c8f-afeb-2e4454e1b46e";
const assistantMessageId = "4e3c2c26-3c70-4b6d-bcdf-1a677fcbba4e";
const executionId = "5a554a4c-9a9c-467c-9742-1118b71897b9";
const feedbackId = "a394683c-f3d0-41fb-8fe0-f2a39b51bd70";

function createAuthContext(user: AuthenticatedUser): AuthContextValue {
  return {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: userId,
        email: "learner@example.test",
        displayName: "Test learner",
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

describe("ChatWorkspacePage", () => {
  it("shows insufficient evidence without citations and submits optional feedback", async () => {
    let asked = false;
    server.use(
      http.get("http://localhost:3000/api/v1/courses", () =>
        HttpResponse.json({
          data: [
            {
              id: courseId,
              name: "Course one",
              ownerId: "37c1dbbd-f72a-4508-a662-3992e2506ca4",
              status: "active",
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("http://localhost:3000/api/v1/conversations", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post("http://localhost:3000/api/v1/chat/ask", async ({ request }) => {
        expect(await request.json()).toEqual({
          courseId,
          question: "What is not in the course?",
        });
        asked = true;
        return HttpResponse.json({
          data: {
            conversationId,
            userMessageId,
            messageId: assistantMessageId,
            executionId,
            groundingStatus: "insufficient",
            answer: null,
            message: "The course material doesn't cover this question.",
            citations: [],
            retrievalScoreTop: null,
            suggestedAction: null,
          },
        });
      }),
      http.get(`http://localhost:3000/api/v1/conversations/${conversationId}`, () =>
        HttpResponse.json({
          data: {
            conversation: {
              id: conversationId,
              userId,
              courseId,
              title: "What is not in the course?",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            messages: asked
              ? [
                  {
                    id: userMessageId,
                    conversationId,
                    role: "user",
                    content: "What is not in the course?",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    executionId: null,
                    intent: null,
                    groundingStatus: null,
                    citations: [],
                    retrievalScoreTop: null,
                  },
                  {
                    id: assistantMessageId,
                    conversationId,
                    role: "assistant",
                    content: "The course material doesn't cover this question.",
                    createdAt: "2026-01-01T00:00:01.000Z",
                    executionId,
                    intent: "question",
                    groundingStatus: "insufficient",
                    citations: [],
                    retrievalScoreTop: null,
                  },
                ]
              : [],
          },
        }),
      ),
      http.post("http://localhost:3000/api/v1/feedback", async ({ request }) => {
        expect(await request.json()).toEqual({
          messageId: assistantMessageId,
          conversationId,
          courseId,
          rating: "not_helpful",
          comment: "Please show a relevant source.",
        });
        return HttpResponse.json(
          {
            data: {
              id: feedbackId,
              messageId: assistantMessageId,
              conversationId,
              courseId,
              userId,
              rating: "not_helpful",
              comment: "Please show a relevant source.",
              groundingStatus: "insufficient",
              createdAt: "2026-01-01T00:00:02.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
          },
          { status: 201 },
        );
      }),
    );

    const user: AuthenticatedUser = {
      id: userId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: [],
      permsVersion: 1,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <AuthContext.Provider value={createAuthContext(user)}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/chat?courseId=${courseId}`]}>
            <Routes>
              <Route path="/chat" element={<ChatWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    fireEvent.change(await screen.findByLabelText("Ask about this course"), {
      target: { value: "What is not in the course?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Not found in course material.")).toBeVisible();
    expect(screen.queryByText("Sources")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not helpful" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Comment (optional)"), {
      target: { value: "Please show a relevant source." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send feedback" }));

    expect(await screen.findByText("Thanks for your feedback.")).toBeVisible();
  });
});
