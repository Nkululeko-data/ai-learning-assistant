import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { AdminUsersPanel } from "./AdminUsersPanel";
import { CoachRequestsPanel } from "./CoachRequestsPanel";
import { CourseApprovalsPanel } from "./CourseApprovalsPanel";

const adminId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const coachId = "417d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

function makeUser(
  role: AuthenticatedUser["role"] = "admin",
  permissions: string[] = ["role:manage", "user:manage"],
): AuthenticatedUser {
  return {
    id: adminId,
    email: `${role}@example.test`,
    displayName: `Test ${role}`,
    role,
    status: "active",
    mustChangePassword: false,
    permissions,
    permsVersion: 1,
  };
}

function renderAdminPanel(
  element: ReactNode,
  user = makeUser(),
  initialEntry = "/admin",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  return render(
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

function userRecord(
  id: string,
  displayName: string,
  role: "admin" | "coach" | "learner",
  email: string,
) {
  return {
    id,
    email,
    displayName,
    roleId: "81bf68e2-2767-4ee5-84c3-99359da40ce1",
    role,
    status: "active",
    mustChangePassword: false,
  };
}

describe("Admin users", () => {
  it("uses one role-filterable table and omits actions for the signed-in admin", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/users", () =>
        HttpResponse.json({
          data: [
            userRecord(adminId, "Test administrator", "admin", "admin@example.test"),
            userRecord(coachId, "Test coach", "coach", "coach@example.test"),
          ],
        }),
      ),
    );
    const user = userEvent.setup();

    renderAdminPanel(<AdminUsersPanel />);

    const table = await screen.findByRole("table", { name: "Users" });
    expect(within(table).getByRole("columnheader", { name: "Role" })).toBeVisible();
    expect(within(table).getByText("Test administrator")).toBeVisible();
    expect(within(table).getByText("Test coach")).toBeVisible();
    expect(within(table).getByText("You")).toBeVisible();
    expect(
      within(table).queryByRole("button", { name: "Actions for Test administrator" }),
    ).toBeNull();
    expect(
      within(table).getByRole("button", { name: "Actions for Test coach" }),
    ).toBeVisible();

    await user.click(screen.getByRole("combobox", { name: "Filter by role" }));
    await user.click(screen.getByRole("option", { name: "Coaches" }));

    expect(within(table).queryByText("Test administrator")).toBeNull();
    expect(within(table).getByText("Test coach")).toBeVisible();
  });

  it("opens role and irreversible privacy-erasure confirmations from the actions menu", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/users", () =>
        HttpResponse.json({
          data: [userRecord(coachId, "Test coach", "coach", "coach@example.test")],
        }),
      ),
    );
    const user = userEvent.setup();

    renderAdminPanel(<AdminUsersPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Actions for Test coach" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Change role" }));
    expect(screen.getByRole("dialog", { name: "Change user role" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Change user role" })).toBeNull(),
    );

    await user.click(screen.getByRole("button", { name: "Actions for Test coach" }));
    await user.click(screen.getByRole("menuitem", { name: "Erase data" }));
    expect(
      screen.getByRole("dialog", { name: "Queue privacy erasure?" }),
    ).toHaveTextContent("permanently anonymises Test coach's account");
    expect(screen.getByRole("dialog")).toHaveTextContent("This cannot be undone.");
  });
});

describe("Admin review queues", () => {
  it("shows an empty coach applications state", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/coach-requests", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    renderAdminPanel(<CoachRequestsPanel />);

    expect(
      await screen.findByText("There are no pending coach applications."),
    ).toBeVisible();
  });

  it("sends a course back to its coach with review feedback", async () => {
    let isPending = true;
    let decision: unknown;
    const course = {
      id: courseId,
      name: "Biology",
      description: "Introductory biology",
      ownerId: coachId,
      status: "active",
      approvalStatus: "pending",
      approvalNote: null,
      approvalRequestedAt: "2026-11-20T07:00:00.000Z",
      reviewedBy: null,
      reviewedAt: null,
      version: 1,
      archivedAt: null,
      archivedBy: null,
      createdAt: "2026-11-20T07:00:00.000Z",
      updatedAt: "2026-11-20T07:00:00.000Z",
      owner: {
        id: coachId,
        displayName: "Test coach",
        email: "coach@example.test",
      },
    };
    server.use(
      http.get("http://localhost:3000/api/v1/admin/courses/approval-queue", () =>
        HttpResponse.json({ data: isPending ? [course] : [] }),
      ),
      http.patch(
        `http://localhost:3000/api/v1/admin/courses/${course.id}/approval`,
        async ({ request }) => {
          decision = await request.json();
          isPending = false;
          return HttpResponse.json({
            data: {
              ...course,
              approvalStatus: "changes_requested",
              approvalNote: "Please add an overview.",
              reviewedBy: adminId,
              reviewedAt: "2026-11-23T07:00:00.000Z",
              version: 2,
            },
          });
        },
      ),
    );
    const user = userEvent.setup();

    renderAdminPanel(<CourseApprovalsPanel />);

    await screen.findByRole("heading", { name: "Biology" });
    await user.click(screen.getByRole("button", { name: "Request changes" }));
    await user.type(
      screen.getByRole("textbox", { name: "Feedback for the coach (optional)" }),
      "Please add an overview.",
    );
    await user.click(screen.getByRole("button", { name: "Send back to coach" }));

    expect(
      await screen.findByText("There are no courses waiting for approval."),
    ).toBeVisible();
    expect(decision).toEqual({
      decision: "changes_requested",
      note: "Please add an overview.",
      version: 1,
    });
  });
});
