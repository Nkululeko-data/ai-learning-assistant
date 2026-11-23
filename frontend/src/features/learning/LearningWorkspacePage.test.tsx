import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { LearningWorkspacePage } from "./LearningWorkspacePage";

const learnerId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const documentId = "9a7a7701-a1b1-42a4-890d-1b1e54055d0e";

function createAuthContext(user: AuthenticatedUser): AuthContextValue {
  return {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: learnerId,
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

describe("LearningWorkspacePage", () => {
  it("supports course-owner study tabs as URL-addressable routes", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Coach course",
            ownerId: learnerId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/flashcards`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const coach: AuthenticatedUser = {
      id: learnerId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <AuthContext.Provider value={createAuthContext(coach)}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/courses/${courseId}/study?tab=flashcards`]}>
            <Routes>
              <Route
                path="/courses/:courseId/study"
                element={<LearningWorkspacePage />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    expect(await screen.findByRole("tab", { name: "Flashcards" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("link", { name: "Manage course documents" }),
    ).toHaveAttribute("href", `/courses/${courseId}/documents`);
    expect(screen.queryByRole("tab", { name: "Quizzes" })).toBeNull();
  });

  it("offers personal note uploads even when ready source documents are listed", async () => {
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            ownerId: "37c1dbbd-f72a-4508-a662-3992e2506ca4",
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({
          data: [
            {
              id: documentId,
              courseId,
              scope: "course",
              filename: "Course notes.pdf",
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
            {
              id: "3b22cfde-4ac7-498c-84ad-7d4be50b854c",
              courseId,
              scope: "course",
              filename: "Lesson video.mp4",
              mimeType: "video/mp4",
              sizeBytes: 1024,
              status: "ready",
              errorCode: null,
              errorDetail: null,
              extractionDiagnostics: null,
              chunkCount: null,
              embeddingModel: null,
              ingestJobId: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              readyAt: null,
            },
          ],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/summaries`, () =>
        HttpResponse.json({ data: [], meta: {} }),
      ),
    );

    const user: AuthenticatedUser = {
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate", "document:upload"],
      permsVersion: 1,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <AuthContext.Provider value={createAuthContext(user)}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/courses/${courseId}/study`]}>
            <Routes>
              <Route
                path="/courses/:courseId/study"
                element={<LearningWorkspacePage />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    expect(await screen.findByText("Course notes.pdf")).toBeVisible();
    expect(screen.queryByText("Lesson video.mp4")).toBeNull();
    expect(screen.getByRole("link", { name: "Upload personal notes" })).toHaveAttribute(
      "href",
      `/courses/${courseId}/documents`,
    );
  });
});
