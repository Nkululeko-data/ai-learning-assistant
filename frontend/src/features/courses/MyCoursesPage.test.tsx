import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { MyCoursesPage } from "./MyCoursesPage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const approvedCourseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

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

function renderPage(user: AuthenticatedUser) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AuthContext.Provider value={createAuthContext(user)}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MyCoursesPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("MyCoursesPage", () => {
  it("shows approved, pending, and rejected enrolments with their states", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({
          data: [
            {
              id: "407d4918-a7f5-4db4-b857-97d8176e305b",
              courseId: approvedCourseId,
              userId,
              status: "approved",
              requestedAt: "2026-01-01T10:00:00.000Z",
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
              createdAt: "2026-01-01T10:00:00.000Z",
              updatedAt: "2026-01-01T10:00:00.000Z",
              course: {
                id: approvedCourseId,
                name: "Foundations",
                status: "active",
              },
            },
            {
              id: "507d4918-a7f5-4db4-b857-97d8176e305b",
              courseId: "d2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
              userId,
              status: "pending",
              requestedAt: "2026-01-02T10:00:00.000Z",
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
              createdAt: "2026-01-02T10:00:00.000Z",
              updatedAt: "2026-01-02T10:00:00.000Z",
              course: {
                id: "d2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
                name: "Applied Systems",
                status: "active",
              },
            },
            {
              id: "607d4918-a7f5-4db4-b857-97d8176e305b",
              courseId: "e2d7a840-35a4-4d4a-9c2a-0f4e3a9a7913",
              userId,
              status: "rejected",
              requestedAt: "2026-01-03T10:00:00.000Z",
              decidedBy: null,
              decidedAt: null,
              decisionNote: "Please review the prerequisites.",
              createdAt: "2026-01-03T10:00:00.000Z",
              updatedAt: "2026-01-03T10:00:00.000Z",
              course: {
                id: "e2d7a840-35a4-4d4a-9c2a-0f4e3a9a7913",
                name: "Advanced Topics",
                status: "active",
              },
            },
          ],
        }),
      ),
    );
    const learner: AuthenticatedUser = {
      id: userId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    };

    renderPage(learner);

    expect(await screen.findByText("Foundations")).toBeVisible();
    expect(screen.getByText("Approved")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open course" })).toHaveAttribute(
      "href",
      `/courses/${approvedCourseId}`,
    );
    expect(screen.getByText("Applied Systems")).toBeVisible();
    expect(screen.getByText("Your request is waiting for the coach.")).toBeVisible();
    expect(screen.getByText("Advanced Topics")).toBeVisible();
    expect(screen.getByText(/Coach note:/)).toHaveTextContent(
      "Please review the prerequisites.",
    );
    expect(screen.getByText("Your request was not approved.")).toBeVisible();
  });

  it("uses the coach course list and keeps course creation available", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/me/courses", () =>
        HttpResponse.json({
          data: [
            {
              id: approvedCourseId,
              name: "Coach course",
              ownerId: userId,
              status: "active",
              approvalStatus: "pending",
              approvalNote: null,
              approvalRequestedAt: null,
              reviewedBy: null,
              reviewedAt: null,
              version: 1,
              archivedAt: null,
              archivedBy: null,
              createdAt: "2026-01-01T10:00:00.000Z",
              updatedAt: "2026-01-01T10:00:00.000Z",
            },
          ],
        }),
      ),
    );
    const coach: AuthenticatedUser = {
      id: userId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: ["course:create"],
      permsVersion: 1,
    };

    renderPage(coach);

    expect(await screen.findByText("Coach course")).toBeVisible();
    expect(screen.getByText("Awaiting admin approval")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create course" })).toBeVisible();
  });
});
