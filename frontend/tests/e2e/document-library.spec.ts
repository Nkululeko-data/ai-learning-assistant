import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const coachId = "417d4918-a7f5-4db4-b857-97d8176e305b";
const readyDocumentId = "11111111-1111-4111-8111-111111111111";
const failedDocumentId = "22222222-2222-4222-8222-222222222222";

const coach = {
  id: coachId,
  email: "coach@example.test",
  displayName: "Taylor Coach",
  role: "coach",
  status: "active",
  mustChangePassword: false,
  permissions: ["document:upload", "document:delete"],
  permsVersion: 1,
};

const courseCoach = {
  ...coach,
  permissions: [
    "document:upload",
    "document:delete",
    "course:edit",
    "quiz:create",
    "content:generate",
    "enrolment:approve",
    "insights:view",
  ],
};

const learner = {
  id: "517d4918-a7f5-4db4-b857-97d8176e305b",
  email: "learner@example.test",
  displayName: "Sam Learner",
  role: "learner",
  status: "active",
  mustChangePassword: false,
  permissions: ["document:upload", "document:delete"],
  permsVersion: 1,
};

const course = {
  id: courseId,
  name: "Database Systems",
  description: "Course overview metadata",
  ownerId: coachId,
  status: "active",
  approvalStatus: "approved",
  approvalNote: null,
  approvalRequestedAt: null,
  reviewedBy: null,
  reviewedAt: null,
  version: 1,
  archivedAt: null,
  archivedBy: null,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
};

const documents = [
  {
    id: readyDocumentId,
    courseId,
    scope: "course",
    filename: "relational-model.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    status: "ready",
    errorCode: null,
    errorDetail: null,
    extractionDiagnostics: null,
    chunkCount: 8,
    embeddingModel: "gemini-embedding-001",
    ingestJobId: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:01:00.000Z",
    readyAt: "2026-01-01T10:01:00.000Z",
  },
  {
    id: failedDocumentId,
    courseId,
    scope: "course",
    filename: "research-notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4096,
    status: "failed",
    errorCode: "DOCUMENT_NO_TEXT",
    errorDetail: "No readable text was found in this file.",
    extractionDiagnostics: {
      parser: "pdfjs-dist",
      pageCount: 2,
      charCount: 0,
      lowTextPages: [1, 2],
      warnings: ["The PDF may contain scanned images."],
    },
    chunkCount: null,
    embeddingModel: null,
    ingestJobId: null,
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:01:00.000Z",
    readyAt: null,
  },
];

/** Provides an isolated learner or coach session and document API responses. */
async function mockDocumentSession(page: Page, user = coach) {
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            roleId: user.id,
            status: "active",
            mustChangePassword: false,
          },
          accessToken: "test-access-token",
          accessTokenExpiresIn: 900,
        },
      },
    }),
  );
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: { data: user } }));
  await page.route(`**/api/v1/courses/${courseId}`, (route) =>
    route.fulfill({ json: { data: course } }),
  );
  await page.route(`**/api/v1/courses/${courseId}/documents**`, (route) =>
    route.fulfill({ json: { data: documents } }),
  );
  await page.route(`**/api/v1/documents/${failedDocumentId}/status`, (route) =>
    route.fulfill({ json: { data: documents[1] } }),
  );
}

/** Fails the test if axe finds an accessibility violation on the current viewport. */
async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}

test("documents use a responsive table, clear deletion confirmation, and accessible status", async ({
  page,
}) => {
  await mockDocumentSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/courses/${courseId}/documents`);

  await expect(page.getByRole("heading", { name: "Document library" })).toBeVisible();
  const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumbs).toContainText("Courses");
  await expect(breadcrumbs).toContainText("Database Systems");
  await expect(breadcrumbs).toContainText("Documents");
  await expect(breadcrumbs.getByRole("link", { name: "Courses" })).toHaveAttribute(
    "href",
    "/my-courses",
  );
  await expect(page.getByRole("button", { name: /Back to course/i })).toHaveCount(0);

  const table = page.getByRole("table", { name: "Course documents" });
  for (const column of ["Name", "Status", "Size", "Uploaded", "Actions"]) {
    await expect(table.getByRole("columnheader", { name: column })).toBeVisible();
  }
  await expect(table.getByText("Ready")).toBeVisible();
  await expect(
    table.getByText("No readable text was found in this file."),
  ).toBeVisible();
  await expect(page.getByText("Filtering loaded documents.")).toBeVisible();
  const helperText = page.getByText("Filtering loaded documents.", { exact: true });
  const helperTextSize = await helperText.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(helperTextSize).toBeGreaterThanOrEqual(16);

  const failedRow = table.getByRole("row", { name: /research-notes\.pdf/ });
  await failedRow.getByRole("button", { name: "Delete research-notes.pdf" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete document?" });
  await expect(deleteDialog).toContainText("This cannot be undone.");
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const deleteButton = failedRow.getByRole("button", {
    name: "Delete research-notes.pdf",
  });
  const feedbackTransitionDuration = await deleteButton.evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(Number.parseFloat(feedbackTransitionDuration)).toBeGreaterThan(0.001);

  await deleteButton.click();
  const dialogTransitionDuration = await page
    .locator(".MuiDialog-container")
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(dialogTransitionDuration)).toBeLessThan(0.001);
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();

  const desktopFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(desktopFits).toBe(true);
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 900, height: 900 });
  const tabletFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(tabletFits).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table.getByRole("columnheader", { name: "Size" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Uploaded" })).toHaveCount(0);
  const mobileFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(mobileFits).toBe(true);
  await expectNoAxeViolations(page);
});

test("learners see personal-note scope and cannot select course material", async ({
  page,
}) => {
  await mockDocumentSession(page, learner);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/courses/${courseId}/documents`);

  await expect(
    page.getByText("Your personal note is visible only to you."),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Personal note" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Course material" })).toBeDisabled();
  await expect(
    page.getByText("Only the course coach can publish shared course material."),
  ).toBeVisible();

  const pageFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(pageFits).toBe(true);
  await expectNoAxeViolations(page);
});

test("course sidebar displays one coach section at a time", async ({ page }) => {
  await mockDocumentSession(page, courseCoach);
  await page.route(`**/api/v1/courses/${courseId}/lessons`, (route) =>
    route.fulfill({
      json: { data: { courseId, version: 1, lessons: [] } },
    }),
  );
  await page.route(`**/api/v1/courses/${courseId}/quizzes**`, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/courses/${courseId}`);

  const courseNavigation = page.getByRole("navigation", {
    name: "Course: Database Systems",
  });
  await expect(page.getByRole("heading", { name: "Course overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course lessons" })).toHaveCount(0);
  await expect(
    courseNavigation.getByRole("link", { name: "Overview" }),
  ).toHaveAttribute("aria-current", "page");

  await courseNavigation.getByRole("link", { name: "Lessons" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/courses/${courseId}#course-lessons-editor$`),
  );
  await expect(page.getByRole("heading", { name: "Course lessons" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course quizzes" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Class learners" })).toHaveCount(0);
  await expect(courseNavigation.getByRole("link", { name: "Lessons" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await courseNavigation.getByRole("link", { name: "Quizzes" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}#course-quizzes$`));
  await expect(page.getByRole("heading", { name: "Course quizzes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course lessons" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Class learners" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(mobileFits).toBe(true);
  await expectNoAxeViolations(page);
});
