import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../api/auth";
import { AuthContext, type AuthContextValue } from "../auth/auth-context";
import { server } from "../test/server";
import { App } from "./App";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";

function renderApp(user: AuthenticatedUser, initialEntry: string) {
  const authValue: AuthContextValue = {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: userId,
        email: "user@example.test",
        displayName: "Test user",
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

function makeUser(
  role: AuthenticatedUser["role"],
  permissions: string[],
): AuthenticatedUser {
  return {
    id: userId,
    email: `${role}@example.test`,
    displayName: `Test ${role}`,
    role,
    status: "active",
    mustChangePassword: false,
    permissions,
    permsVersion: 1,
  };
}

describe("admin routes", () => {
  it("redirects administrators from the root to the admin dashboard", async () => {
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

    renderApp(makeUser("admin", ["user:manage", "executions:view"]), "/");

    expect(
      await screen.findByRole("heading", { name: "Admin dashboard" }),
    ).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("blocks non-admin roles from admin routes", () => {
    renderApp(makeUser("learner", ["role:manage"]), "/admin/users");

    expect(screen.getByText(/admin access is required/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Users" })).toBeNull();
  });

  it("blocks administrators without the route permission", () => {
    renderApp(makeUser("admin", ["user:manage"]), "/admin/users");

    expect(
      screen.getByText("You do not have permission to view this page."),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Users" })).toBeNull();
  });

  it("keeps administrators out of learner and course-content routes", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/admin/coach-requests", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get("http://localhost:3000/api/v1/admin/courses/approval-queue", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    renderApp(
      makeUser("admin", ["user:manage"]),
      "/courses/507d4918-a7f5-4db4-b857-97d8176e305b/documents",
    );

    expect(
      await screen.findByRole("heading", { name: "Admin dashboard" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Documents" })).toBeNull();
  });
});
