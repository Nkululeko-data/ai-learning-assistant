import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { AdminPage } from "./AdminPage";

const adminId = "307d4918-a7f5-4db4-b857-97d8176e305b";

function createAuthContext(user: AuthenticatedUser): AuthContextValue {
  return {
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
}

function renderAdminPage(user: AuthenticatedUser, initialEntry = "/admin") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AuthContext.Provider value={createAuthContext(user)}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AdminPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("AdminPage", () => {
  it("denies the admin workspace to non-admin roles", () => {
    renderAdminPage({
      id: adminId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["role:manage"],
      permsVersion: 1,
    });

    expect(screen.getByText(/admin access is required/i)).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Users" })).toBeNull();
  });

  it("shows safe user roles and prevents changing the signed-in admin", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/users", () =>
        HttpResponse.json({
          data: [
            {
              id: adminId,
              email: "admin@example.test",
              displayName: "Test administrator",
              roleId: "81bf68e2-2767-4ee5-84c3-99359da40ce1",
              role: "admin",
              status: "active",
              mustChangePassword: false,
            },
          ],
        }),
      ),
    );

    renderAdminPage({
      id: adminId,
      email: "admin@example.test",
      displayName: "Test administrator",
      role: "admin",
      status: "active",
      mustChangePassword: false,
      permissions: ["role:manage"],
      permsVersion: 1,
    });

    expect(await screen.findByText("Test administrator")).toBeVisible();
    expect(screen.getByText("admin", { selector: ".MuiChip-label" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Change role" })).toBeDisabled();
  });

  it("opens the admin section selected from the dashboard quick action", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/coach-requests", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    renderAdminPage(
      {
        id: adminId,
        email: "admin@example.test",
        displayName: "Test administrator",
        role: "admin",
        status: "active",
        mustChangePassword: false,
        permissions: ["user:manage", "role:manage"],
        permsVersion: 1,
      },
      "/admin?section=coach-requests",
    );

    expect(await screen.findByText("There are no pending coach applications.")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Coach applications" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
