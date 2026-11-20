import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { CourseManagementPage } from "./CourseManagementPage";

const learnerId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const enrolmentId = "407d4918-a7f5-4db4-b857-97d8176e305b";

const coursePage = {
  data: [
    {
      id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911",
      name: "Course one",
      description: "Course description",
    },
  ],
};

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

function renderCourseManagement(user: AuthenticatedUser) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AuthContext.Provider value={createAuthContext(user)}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CourseManagementPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("CourseManagementPage", () => {
  it("shows creation controls only for a coach with course:create permission", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/courses", () =>
        HttpResponse.json(coursePage),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    const learner: AuthenticatedUser = {
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["course:create"],
      permsVersion: 1,
    };
    const learnerView = renderCourseManagement(learner);
    await screen.findByRole("heading", { name: "Course one" });
    expect(screen.queryByRole("button", { name: "Create course" })).toBeNull();
    learnerView.unmount();

    const coach: AuthenticatedUser = {
      ...learner,
      id: "37c1dbbd-f72a-4508-a662-3992e2506ca4",
      role: "coach",
      permissions: ["course:create"],
    };
    renderCourseManagement(coach);
    expect(await screen.findByRole("button", { name: "Create course" })).toBeVisible();
  });

  it("lets a learner request course access and reflects the pending status", async () => {
    let hasPendingRequest = false;
    const enrolment = {
      id: enrolmentId,
      courseId,
      userId: learnerId,
      status: "pending",
      requestedAt: "2026-11-20T07:00:00.000Z",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: "2026-11-20T07:00:00.000Z",
      updatedAt: "2026-11-20T07:00:00.000Z",
    };
    server.use(
      http.get("http://localhost:3000/api/v1/courses", () =>
        HttpResponse.json(coursePage),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({
          data: hasPendingRequest
            ? [
                {
                  ...enrolment,
                  course: {
                    id: courseId,
                    name: "Course one",
                    description: "Course description",
                    status: "active",
                  },
                },
              ]
            : [],
        }),
      ),
      http.post(`http://localhost:3000/api/v1/courses/${courseId}/join`, () => {
        hasPendingRequest = true;
        return HttpResponse.json({ data: enrolment }, { status: 201 });
      }),
    );

    renderCourseManagement({
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    });

    await screen.findByRole("heading", { name: "Course one" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Request to join" }),
    );
    expect(await screen.findByText("Request pending")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Pending requests" }));
    expect(screen.getByRole("heading", { name: "Course one" })).toBeVisible();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search courses" }),
      "missing",
    );
    expect(
      await screen.findByText("No courses match this search and filter."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("heading", { name: "Course one" })).toBeVisible();
  });
});
