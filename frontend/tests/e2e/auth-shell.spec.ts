import { expect, test } from "@playwright/test";

test("shows the sign-in form when there is no active session", async ({ page }) => {
  let refreshRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/auth/refresh")) {
      refreshRequests += 1;
    }
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI Learning Assistant" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(refreshRequests).toBe(1);
});
