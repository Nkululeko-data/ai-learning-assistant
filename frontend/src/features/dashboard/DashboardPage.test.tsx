import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { CourseManagementPage } from "../courses/CourseManagementPage";
import { server } from "../../test/server";
import { DashboardPage } from "./DashboardPage";

const adminId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const coachId = "407d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "507d4918-a7f5-4db4-b857-97d8176e305b";
const learnerId = "607d4918-a7f5-4db4-b857-97d8176e305b";
const requestId = "707d4918-a7f5-4db4-b857-97d8176e305b";
const pendingCourseId = "807d4918-a7f5-4db4-b857-97d8176e305b";
const exploreCourseId = "907d4918-a7f5-4db4-b857-97d8176e305b";

function renderDashboard(user: AuthenticatedUser, includeCourseRoute = false) {
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
        email: "admin@example.test",
        displayName: "Test administrator",
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
        <MemoryRouter>
          {includeCourseRoute ? (
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/courses" element={<CourseManagementPage />} />
            </Routes>
          ) : (
            <DashboardPage />
          )}
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("DashboardPage", () => {
  it("shows coach-owned courses and course-management actions", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/me/courses", () =>
        HttpResponse.json({
          data: [
            {
              id: courseId,
              name: "Biology",
              description: "Course overview",
              ownerId: coachId,
              status: "active",
              version: 1,
              createdAt: "2026-11-20T07:00:00.000Z",
              updatedAt: "2026-11-20T07:00:00.000Z",
            },
          ],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/join-requests`, () =>
        HttpResponse.json({
          data: [
            {
              id: requestId,
              courseId,
              userId: learnerId,
              status: "pending",
              requestedAt: "2026-11-20T07:30:00.000Z",
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
              createdAt: "2026-11-20T07:30:00.000Z",
              updatedAt: "2026-11-20T07:30:00.000Z",
              applicant: {
                id: learnerId,
                displayName: "Taylor Learner",
                email: "taylor@example.test",
              },
            },
          ],
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/insights`, () =>
        HttpResponse.json({
          data: {
            courseId,
            periodStart: "2026-10-20T00:00:00.000Z",
            periodEnd: "2026-11-20T00:00:00.000Z",
            minCohortSizeUsed: 3,
            cohortQualified: true,
            distinctLearnerCount: 5,
            questionCount: 12,
            insufficientQuestionCount: 2,
            helpfulFeedbackCount: 4,
            notHelpfulFeedbackCount: 1,
            quizAttemptCount: 7,
            quizAverageScore: 0.8,
          },
        }),
      ),
    );

    renderDashboard({
      id: coachId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: [
        "course:create",
        "document:upload",
        "insights:view",
        "enrolment:approve",
      ],
      permsVersion: 1,
    });

    expect(
      await screen.findByRole("heading", { name: "Coach dashboard" }),
    ).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Biology" })).toBeVisible();
    expect(await screen.findByText("Taylor Learner")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review request" })).toHaveAttribute(
      "href",
      `/courses/${courseId}#enrolment-requests-title`,
    );
    expect(screen.getByText("12")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage materials" })).toHaveAttribute(
      "href",
      `/courses/${courseId}/documents`,
    );
    expect(screen.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "At a glance" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Document processing" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Study tools" })).toBeNull();
  });

  it("separates enrolled, pending, and discoverable courses for learners", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/courses", () =>
        HttpResponse.json({
          data: [
            {
              id: courseId,
              name: "Biology",
              description: "Course overview",
              ownerId: coachId,
              status: "active",
              version: 1,
              createdAt: "2026-11-20T07:00:00.000Z",
              updatedAt: "2026-11-20T07:00:00.000Z",
            },
            { id: pendingCourseId, name: "Chemistry", description: "Atoms and bonds" },
            { id: exploreCourseId, name: "Astronomy", description: "The night sky" },
          ],
        }),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({
          data: [
            {
              id: requestId,
              courseId,
              userId: learnerId,
              status: "approved",
              requestedAt: "2026-11-19T07:00:00.000Z",
              decidedBy: coachId,
              decidedAt: "2026-11-19T08:00:00.000Z",
              decisionNote: null,
              createdAt: "2026-11-19T07:00:00.000Z",
              updatedAt: "2026-11-19T08:00:00.000Z",
              course: {
                id: courseId,
                name: "Biology",
                description: "Course overview",
                status: "active",
              },
            },
            {
              id: "a07d4918-a7f5-4db4-b857-97d8176e305b",
              courseId: pendingCourseId,
              userId: learnerId,
              status: "pending",
              requestedAt: "2026-11-20T07:30:00.000Z",
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
              createdAt: "2026-11-20T07:30:00.000Z",
              updatedAt: "2026-11-20T07:30:00.000Z",
              course: {
                id: pendingCourseId,
                name: "Chemistry",
                description: "Atoms and bonds",
                status: "active",
              },
            },
          ],
        }),
      ),
    );

    renderDashboard({
      id: learnerId,
      email: "learner@example.test",
      displayName: "Taylor Learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["content:generate"],
      permsVersion: 1,
    });

    expect(await screen.findByRole("heading", { name: "Your learning" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Document processing" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Biology" })).toBeVisible();
    expect(screen.getByText("Enrolled")).toBeVisible();
    expect(screen.getByText("Chemistry")).toBeVisible();
    expect(screen.getByText("Pending")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Astronomy" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Study tools" })).toHaveAttribute(
      "href",
      `/courses/${courseId}/study`,
    );
    expect(screen.queryByRole("heading", { name: "Recent activity" })).toBeNull();
  });

  it("navigates from the learner dashboard to the Courses page", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/courses", () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get("http://localhost:3000/api/v1/me/enrolments", () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const user = userEvent.setup();
    renderDashboard(
      {
        id: learnerId,
        email: "learner@example.test",
        displayName: "Taylor Learner",
        role: "learner",
        status: "active",
        mustChangePassword: false,
        permissions: [],
        permsVersion: 1,
      },
      true,
    );

    await user.click(await screen.findByRole("link", { name: "Browse courses" }));
    expect(
      await screen.findByRole("heading", { name: "Find your next course" }),
    ).toBeVisible();
    expect(
      await screen.findByText(
        "There are no courses to display right now. Try again later.",
      ),
    ).toBeVisible();
  });
});
