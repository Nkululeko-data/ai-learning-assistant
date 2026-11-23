import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { AdminCoursesPage } from "./AdminCoursesPage";

const adminId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const coachId = "417d4918-a7f5-4db4-b857-97d8176e305b";
const newCoachId = "517d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

function renderCoursesPage() {
  const user: AuthenticatedUser = {
    id: adminId,
    email: "admin@example.test",
    displayName: "Test administrator",
    role: "admin",
    status: "active",
    mustChangePassword: false,
    permissions: ["user:manage"],
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
          <AdminCoursesPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

function makeCourse(ownerId: string, status: "active" | "archived" = "active") {
  return {
    id: courseId,
    name: "Biology",
    description: "Private course details are not part of this listing.",
    ownerId,
    status,
    approvalStatus: "pending" as const,
    approvalNote: null,
    approvalRequestedAt: "2026-01-01T10:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
    version: 1,
    archivedAt: status === "archived" ? "2026-01-02T10:00:00.000Z" : null,
    archivedBy: status === "archived" ? adminId : null,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
  };
}

function makeCoach(id: string, displayName: string) {
  return {
    id,
    email: `${displayName.toLocaleLowerCase().replace(" ", ".")}@example.test`,
    displayName,
    roleId: adminId,
    role: "coach",
    status: "active",
    mustChangePassword: false,
  };
}

describe("AdminCoursesPage", () => {
  it("lists course-level metadata and supports owner reassignment and archive", async () => {
    let course = makeCourse(coachId);
    let ownerRequest: unknown;
    let archiveRequest: unknown;
    server.use(
      http.get("http://localhost:3000/api/v1/courses", () =>
        HttpResponse.json({ data: [course] }),
      ),
      http.get("http://localhost:3000/api/v1/admin/users", () =>
        HttpResponse.json({
          data: [
            makeCoach(coachId, "Taylor Coach"),
            makeCoach(newCoachId, "Jamie Coach"),
          ],
        }),
      ),
      http.patch(
        `http://localhost:3000/api/v1/admin/courses/${courseId}/owner`,
        async ({ request }) => {
          ownerRequest = await request.json();
          course = { ...course, ownerId: newCoachId, version: 2 };
          return HttpResponse.json({ data: course });
        },
      ),
      http.patch(
        `http://localhost:3000/api/v1/admin/courses/${courseId}`,
        async ({ request }) => {
          archiveRequest = await request.json();
          course = {
            ...course,
            status: "archived",
            archivedAt: "2026-01-03T10:00:00.000Z",
            archivedBy: adminId,
            version: 3,
          };
          return HttpResponse.json({ data: course });
        },
      ),
    );
    const user = userEvent.setup();

    renderCoursesPage();

    const table = await screen.findByRole("table", { name: "Admin course catalog" });
    expect(table).toHaveTextContent("Biology");
    expect(table).toHaveTextContent("Taylor Coach");
    expect(table).not.toHaveTextContent("Private course details");
    await user.click(
      screen.getByRole("button", { name: "Reassign owner for Biology" }),
    );
    await user.click(screen.getByRole("combobox", { name: "New owner" }));
    await user.click(screen.getByRole("option", { name: /Jamie Coach/ }));
    await user.click(screen.getByRole("button", { name: "Save owner" }));

    expect(ownerRequest).toEqual({ ownerId: newCoachId, version: 1 });
    expect(await within(table).findByText(/Jamie Coach/)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Reassign course owner" }),
      ).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "Archive Biology" }));
    expect(screen.getByRole("dialog", { name: "Archive course?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Archive course" }));

    expect(archiveRequest).toEqual({ status: "archived", version: 2 });
    expect(await screen.findByText("archived")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Archive Biology" })).toBeNull();
  });
});
