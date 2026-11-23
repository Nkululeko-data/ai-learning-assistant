import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const adminId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const coachId = "417d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";

const admin = {
  id: adminId,
  email: "admin@example.test",
  displayName: "Test administrator",
  role: "admin",
  status: "active",
  mustChangePassword: false,
  permissions: [
    "role:manage",
    "user:manage",
    "executions:view",
    "audit:view",
    "config:view",
    "config:manage",
  ],
  permsVersion: 1,
};

const users = [
  {
    id: adminId,
    email: "admin@example.test",
    displayName: "Test administrator",
    roleId: adminId,
    role: "admin",
    status: "active",
    mustChangePassword: false,
  },
  {
    id: coachId,
    email: "coach@example.test",
    displayName: "Taylor Coach",
    roleId: adminId,
    role: "coach",
    status: "active",
    mustChangePassword: false,
  },
];

const course = {
  id: courseId,
  name: "Biology",
  description: "Course overview metadata",
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
};

async function mockAdminSession(page: Page) {
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: adminId,
            email: admin.email,
            displayName: admin.displayName,
            roleId: adminId,
            status: "active",
            mustChangePassword: false,
          },
          accessToken: "test-access-token",
          accessTokenExpiresIn: 900,
        },
      },
    }),
  );
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: { data: admin } }));
  await page.route("**/api/v1/admin/coach-requests**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            userId: coachId,
            status: "pending",
            requestedAt: "2026-01-01T10:00:00.000Z",
            applicant: { displayName: "Taylor Coach", email: "coach@example.test" },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/admin/courses/approval-queue**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            ...course,
            owner: {
              id: coachId,
              displayName: "Taylor Coach",
              email: "coach@example.test",
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/admin/jobs**", (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    const items =
      status === "failed"
        ? [
            {
              id: "20000000-0000-4000-8000-000000000001",
              type: "generate",
              status: "failed",
              attempts: 2,
              maxAttempts: 3,
              runAfter: "2026-01-01T10:00:00.000Z",
              error: null,
              createdAt: "2026-01-01T10:00:00.000Z",
              updatedAt: "2026-01-01T10:00:00.000Z",
              finishedAt: null,
            },
          ]
        : [];
    return route.fulfill({ json: { data: items } });
  });
  await page.route("**/api/v1/admin/users**", (route) =>
    route.fulfill({ json: { data: users } }),
  );
  await page.route("**/api/v1/courses**", (route) =>
    route.fulfill({ json: { data: [course] } }),
  );
  await page.route("**/api/v1/admin/audit-logs**", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/v1/admin/executions**", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/v1/admin/config", (route) =>
    route.fulfill({
      json: {
        data: {
          insightMinCohortSize: 3,
          insightPeriodDays: 7,
          gapReportsMaxPerCourse: 10,
        },
      },
    }),
  );
}

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}

test("admin dashboard shows real review queues and excludes learner content", async ({
  page,
}) => {
  await mockAdminSession(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coach applications" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Courses awaiting approval" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Jobs that need action" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quick actions" })).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Main" });
  await expect(navigation.getByRole("link", { name: "Chat" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "History" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Documents" })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test("users route has one role-filterable table and confirmation-based actions", async ({
  page,
}) => {
  await mockAdminSession(page);
  await page.goto("/admin/users");

  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  const usersTable = page.getByRole("table", { name: "Users" });
  await expect(usersTable.getByRole("columnheader", { name: "Role" })).toBeVisible();
  await expect(usersTable.getByText("You")).toBeVisible();
  await expect(
    usersTable.getByRole("button", { name: "Actions for Test administrator" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for Taylor Coach" }).click();
  await page.getByRole("menuitem", { name: "Change role" }).click();
  await expect(page.getByRole("dialog", { name: "Change user role" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Actions for Taylor Coach" }).click();
  await page.getByRole("menuitem", { name: "Erase data" }).click();
  await expect(
    page.getByRole("dialog", { name: "Queue privacy erasure?" }),
  ).toContainText("permanently anonymises Taylor Coach's account");
  await expectNoAxeViolations(page);
});

test("course approval queue uses readable rows on mobile", async ({ page }) => {
  await mockAdminSession(page);
  await page.goto("/admin/course-approvals");

  await expect(page.getByRole("heading", { name: "Course approvals" })).toBeVisible();
  const approvalRow = page.locator("article").filter({ hasText: "Biology" });
  await expect(approvalRow).toContainText("Taylor Coach");
  await expect(
    approvalRow.getByRole("button", { name: "Approve course" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const pageFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(pageFits).toBe(true);
  await expectNoAxeViolations(page);
});

test("admin courses remains metadata-only and fits a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminSession(page);
  await page.goto("/courses");

  await expect(page).toHaveURL(/\/admin\/courses$/);
  await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Admin course catalog" })).toContainText(
    "Biology",
  );
  await expect(page.getByText("Course overview metadata")).toHaveCount(0);
  const pageFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(pageFits).toBe(true);
  await expectNoAxeViolations(page);
});
