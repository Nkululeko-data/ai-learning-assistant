import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { WorkspaceLayout } from "./WorkspacePage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "b1fa6e02-9d06-48ba-a97a-3ca612ab5f4e";
let approvalQueueRequestedLimit: string | null = null;

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

function makeAuthContext(user: AuthenticatedUser): AuthContextValue {
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

function LocationOutput() {
  const location = useLocation();
  if (location.pathname === "/courses/crash") {
    throw new Error("Course page rendering failed");
  }
  return (
    <div>{location.pathname === "/courses" ? "Courses route" : "Current route"}</div>
  );
}

function renderWorkspace(
  user: AuthenticatedUser,
  initialEntry = "/",
  coachRequests: unknown[] = [],
) {
  server.use(
    http.get("http://localhost:3000/api/v1/admin/coach-requests", () =>
      HttpResponse.json({ data: coachRequests }),
    ),
    http.get(
      "http://localhost:3000/api/v1/admin/courses/approval-queue",
      ({ request }) => {
        approvalQueueRequestedLimit = new URL(request.url).searchParams.get("limit");
        return HttpResponse.json({ data: [], meta: {} });
      },
    ),
    http.get("http://localhost:3000/api/v1/courses/:courseId", ({ params }) =>
      HttpResponse.json({
        data: {
          id: params.courseId,
          name: "Applied Systems",
          description: "Course description",
          ownerId: userId,
          status: "active",
          approvalStatus: "approved",
          approvalNote: null,
          approvalRequestedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          version: 1,
          archivedAt: null,
          archivedBy: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      }),
    ),
    http.get("http://localhost:3000/api/v1/courses/:courseId/join-requests", () =>
      HttpResponse.json({ data: [], meta: {} }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={makeAuthContext(user)}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<WorkspaceLayout />}>
              <Route index element={<LocationOutput />} />
              <Route path="admin" element={<LocationOutput />} />
              <Route path="admin/operations/audit" element={<LocationOutput />} />
              <Route path="my-courses" element={<LocationOutput />} />
              <Route path="courses" element={<LocationOutput />} />
              <Route path="courses/:courseId" element={<LocationOutput />} />
              <Route path="courses/:courseId/study" element={<LocationOutput />} />
              <Route path="courses/:courseId/documents" element={<LocationOutput />} />
              <Route path="chat" element={<LocationOutput />} />
              <Route path="history" element={<LocationOutput />} />
              <Route path="quiz-results" element={<LocationOutput />} />
              <Route path="conversations" element={<LocationOutput />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function mockViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) =>
      ({
        matches:
          (query === "(max-width: 767px)" && width < 768) ||
          (query === "(min-width: 768px) and (max-width: 1023px)" &&
            width >= 768 &&
            width <= 1023),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  window.localStorage.clear();
  approvalQueueRequestedLimit = null;
  vi.restoreAllMocks();
});

describe("WorkspaceLayout", () => {
  it("shows a recoverable error instead of a blank page after a route render failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWorkspace(makeUser("learner", ["content:generate"]), "/courses/crash");

    expect(
      screen.getByText(
        "This page could not be displayed. Try again or choose another page.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("provides skip navigation, active route state, breadcrumbs, and account details", async () => {
    const user = userEvent.setup();
    renderWorkspace(makeUser("learner", ["content:generate"]), "/courses");

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse courses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
      "Dashboard",
    );

    await user.click(
      screen.getByRole("button", { name: "Account menu for Test learner" }),
    );
    expect(screen.getByText("Test learner")).toBeVisible();
    expect(screen.getByText("Learner")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Change password" })).toBeVisible();
  });

  it("shows only permission-eligible admin destinations", () => {
    renderWorkspace(makeUser("admin", ["user:manage"]), "/admin");

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(4);
    expect(within(navigation).getByRole("link", { name: "Courses" })).toBeVisible();
    expect(
      within(navigation).getByRole("link", { name: /Coach applications/ }),
    ).toBeVisible();
    expect(
      within(navigation).getByRole("link", { name: /Course approvals/ }),
    ).toBeVisible();
    expect(within(navigation).queryByRole("link", { name: "Chat" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "History" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Documents" })).toBeNull();
    expect(
      within(screen.getByRole("banner")).queryByRole("link", {
        name: "Courses",
      }),
    ).toBeNull();
  });

  it("shows learner destinations and removes generic chat/history from coaches", () => {
    const { unmount } = renderWorkspace(makeUser("learner", ["content:generate"]), "/");
    const learnerNavigation = screen.getByRole("navigation", { name: "Main" });
    expect(within(learnerNavigation).getAllByRole("link")).toHaveLength(6);
    expect(
      within(learnerNavigation).getByRole("link", { name: "My courses" }),
    ).toHaveAttribute("href", "/my-courses");
    expect(
      within(learnerNavigation).getByRole("link", { name: "Browse courses" }),
    ).toHaveAttribute("href", "/courses");
    expect(
      within(learnerNavigation).getByRole("link", { name: "History" }),
    ).toHaveAttribute("href", "/history");
    expect(
      within(learnerNavigation).getByRole("link", { name: "Quiz results" }),
    ).toHaveAttribute("href", "/quiz-results");

    unmount();
    renderWorkspace(makeUser("coach", ["course:create"]), "/");
    const coachNavigation = screen.getByRole("navigation", { name: "Main" });
    expect(within(coachNavigation).getAllByRole("link")).toHaveLength(2);
    expect(
      within(coachNavigation).getByRole("link", { name: "My courses" }),
    ).toBeVisible();
    expect(within(coachNavigation).queryByRole("link", { name: "Chat" })).toBeNull();
    expect(within(coachNavigation).queryByRole("link", { name: "History" })).toBeNull();
  });

  it("marks the selected course section as active", async () => {
    renderWorkspace(
      makeUser("coach", [
        "course:edit",
        "enrolment:approve",
        "quiz:create",
        "content:generate",
        "insights:view",
      ]),
      `/courses/${courseId}#course-quizzes`,
    );

    const courseNavigation = await screen.findByRole("navigation", {
      name: "Course: Applied Systems",
    });
    expect(
      within(courseNavigation).getByRole("link", { name: "Quizzes" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(courseNavigation).getByRole("link", { name: "Overview" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  it("shows permitted course links and the course name for course routes", async () => {
    renderWorkspace(
      makeUser("coach", [
        "course:edit",
        "enrolment:approve",
        "quiz:create",
        "content:generate",
        "insights:view",
      ]),
      `/courses/${courseId}/documents`,
    );

    const courseNavigation = await screen.findByRole("navigation", {
      name: "Course: Applied Systems",
    });
    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", {
        name: "Courses",
      }),
    ).toHaveAttribute("href", "/my-courses");
    expect(
      within(courseNavigation).getByRole("link", { name: "Lessons" }),
    ).toHaveAttribute("href", `/courses/${courseId}#course-lessons-editor`);
    expect(
      within(courseNavigation).getByRole("link", { name: "Documents" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(courseNavigation).getByRole("link", { name: /Join requests/ }),
    ).toHaveAttribute("href", `/courses/${courseId}#course-join-requests`);
    expect(
      within(courseNavigation).getByRole("link", { name: "Quizzes" }),
    ).toHaveAttribute("href", `/courses/${courseId}#course-quizzes`);
    expect(
      within(courseNavigation).getByRole("link", { name: "Summaries" }),
    ).toHaveAttribute("href", `/courses/${courseId}/study?tab=summary`);
    expect(
      within(courseNavigation).getByRole("link", { name: "Flashcards" }),
    ).toHaveAttribute("href", `/courses/${courseId}/study?tab=flashcards`);
    expect(
      within(courseNavigation).getByRole("link", { name: "Insights" }),
    ).toHaveAttribute("href", `/courses/${courseId}#course-insights`);
    expect(
      within(courseNavigation).getByRole("link", {
        name: "Ask about this course",
      }),
    ).toHaveAttribute("href", `/chat?courseId=${courseId}`);
  });

  it("keeps admin navigation outside learner content and exposes operations routes", () => {
    renderWorkspace(
      makeUser("admin", [
        "role:manage",
        "user:manage",
        "executions:view",
        "audit:view",
        "config:view",
      ]),
      "/admin/operations/audit",
    );

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", {
        name: "Dashboard",
      }),
    ).toHaveAttribute("href", "/admin");
    expect(within(navigation).getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(within(navigation).getByRole("link", { name: "Audit log" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(navigation).getByRole("link", { name: "Jobs" })).toHaveAttribute(
      "href",
      "/admin/operations/jobs",
    );
    expect(within(navigation).queryByRole("link", { name: "Chat" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "History" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Documents" })).toBeNull();
  });

  it("counts pending applications on the first 100 and caps the badge at 99+", async () => {
    const coachRequests = Array.from({ length: 100 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      userId,
      status: "pending",
      requestedAt: "2026-01-01T10:00:00.000Z",
      applicant: {
        displayName: `Applicant ${index}`,
        email: `applicant-${index}@example.test`,
      },
    }));
    renderWorkspace(makeUser("admin", ["user:manage"]), "/", coachRequests);

    const applicationsLink = await screen.findByRole("link", {
      name: /Coach applications/,
    });
    await waitFor(() =>
      expect(applicationsLink).toHaveAttribute("aria-description", "100 pending"),
    );
    expect(within(applicationsLink).getByText("99+")).toBeVisible();
    await waitFor(() => expect(approvalQueueRequestedLimit).toBe("100"));
  });

  it("hides admin navigation when the effective permissions grant no admin sections", () => {
    renderWorkspace(makeUser("admin", []));

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(navigation).queryByRole("link", { name: "Admin dashboard" }),
    ).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "Operations" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Courses" })).toBeNull();
  });

  it("uses an accessible icon rail by default at tablet width", () => {
    mockViewport(800);
    renderWorkspace(makeUser("coach", ["course:create"]), "/my-courses");

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "My courses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "My courses" })).toHaveAttribute(
      "aria-label",
      "My courses",
    );
  });

  it("stores a manual sidebar preference per user", async () => {
    mockViewport(800);
    const user = userEvent.setup();
    renderWorkspace(makeUser("coach", ["course:create"]), "/courses");

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(window.localStorage.getItem(`workspace-sidebar-expanded:${userId}`)).toBe(
      "true",
    );
  });

  it("keeps the sidebar usable when browser storage is unavailable", async () => {
    mockViewport(800);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });

    const user = userEvent.setup();
    renderWorkspace(makeUser("coach", ["course:create"]), "/my-courses");

    expect(screen.getByRole("link", { name: "My courses" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  });

  it("opens a mobile drawer and closes it with Escape, returning focus to its trigger", async () => {
    mockViewport(600);
    const user = userEvent.setup();
    renderWorkspace(makeUser("learner", ["content:generate"]));

    const menuButton = screen.getByRole("button", { name: "Open navigation menu" });
    await user.click(menuButton);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull(),
    );
    expect(menuButton).toHaveFocus();
  });

  it("closes the mobile drawer after navigating", async () => {
    mockViewport(600);
    const user = userEvent.setup();
    renderWorkspace(makeUser("learner", ["content:generate"]));

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(screen.getByRole("link", { name: "Browse courses" }));

    expect(await screen.findByText("Courses route")).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull(),
    );
  });
});
