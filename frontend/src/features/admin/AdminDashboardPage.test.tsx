import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { AdminDashboardPage } from "./AdminDashboardPage";

const adminId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const coachId = "417d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

function renderDashboard() {
  const user: AuthenticatedUser = {
    id: adminId,
    email: "admin@example.test",
    displayName: "Test administrator",
    role: "admin",
    status: "active",
    mustChangePassword: false,
    permissions: ["user:manage", "executions:view"],
    permsVersion: 1,
  };
  const authValue: AuthContextValue = {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: adminId,
        email: "user@example.test",
        displayName: "Test user",
        roleId: adminId,
        status: "active",
        mustChangePassword: false,
      },
      coachRequestCreated: false,
    }),
    signOut: async () => {},
    updatePassword: async () => {},
    retrySessionBootstrap: () => {},
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AdminDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("AdminDashboardPage", () => {
  it("shows compact review rows with counts and route links", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/coach-requests", () =>
        HttpResponse.json({
          data: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              userId: coachId,
              status: "pending",
              requestedAt: "2026-01-01T10:00:00.000Z",
              applicant: {
                displayName: "Taylor Coach",
                email: "coach@example.test",
              },
            },
            {
              id: "10000000-0000-4000-8000-000000000002",
              userId: adminId,
              status: "pending",
              requestedAt: "2026-01-01T10:00:00.000Z",
              applicant: {
                displayName: "Jamie Coach",
                email: "jamie@example.test",
              },
            },
          ],
        }),
      ),
      http.get("http://localhost:3000/api/v1/admin/courses/approval-queue", () =>
        HttpResponse.json({
          data: [
            {
              id: courseId,
              name: "Biology",
              ownerId: coachId,
              status: "active",
              approvalStatus: "pending",
              approvalNote: null,
              approvalRequestedAt: "2026-01-01T10:00:00.000Z",
              reviewedBy: null,
              reviewedAt: null,
              version: 1,
              archivedAt: null,
              archivedBy: null,
              createdAt: "2026-01-01T10:00:00.000Z",
              updatedAt: "2026-01-01T10:00:00.000Z",
              owner: {
                id: coachId,
                displayName: "Taylor Coach",
                email: "coach@example.test",
              },
            },
          ],
        }),
      ),
      http.get("http://localhost:3000/api/v1/admin/jobs", ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        const count = status === "failed" ? 1 : status === "dead" ? 2 : 0;
        return HttpResponse.json({
          data: Array.from({ length: count }, (_, index) => ({
            id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            type: "generate",
            status,
            attempts: 2,
            maxAttempts: 3,
            runAfter: "2026-01-01T10:00:00.000Z",
            error: null,
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-01T10:00:00.000Z",
            finishedAt: null,
          })),
        });
      }),
    );

    renderDashboard();

    const coachRow = await screen.findByRole("listitem", {
      name: /coach applications/i,
    });
    expect(coachRow).toHaveTextContent("2");
    expect(within(coachRow).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/admin/coach-applications",
    );
    const coursesRow = screen.getByRole("listitem", {
      name: /courses awaiting approval/i,
    });
    expect(coursesRow).toHaveTextContent("1");
    expect(within(coursesRow).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/admin/course-approvals",
    );
    const jobsRow = await screen.findByRole("listitem", {
      name: /jobs that need action/i,
    });
    expect(jobsRow).toHaveTextContent("3");
    expect(within(jobsRow).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/admin/operations/jobs",
    );
    expect(screen.queryByRole("heading", { name: "Quick actions" })).toBeNull();
    expect(
      screen.queryByText(/Welcome, Test administrator\. Manage platform access/),
    ).toBeNull();
  });

  it("uses the specified plain empty state when all queues are clear", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/coach-requests", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get("http://localhost:3000/api/v1/admin/courses/approval-queue", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get("http://localhost:3000/api/v1/admin/jobs", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    renderDashboard();

    expect(await screen.findByText("Nothing needs attention right now.")).toBeVisible();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
