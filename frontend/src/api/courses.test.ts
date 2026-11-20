import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { listAllMyCourses, listCourses } from "./courses";
import { server } from "../test/server";

describe("course API", () => {
  it("preserves the backend cursor when loading a paginated course list", async () => {
    server.use(
      http.get("http://localhost:3000/api/v1/courses", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe("1");
        expect(url.searchParams.get("cursor")).toBe("cursor-token");
        return HttpResponse.json({
          data: [
            {
              id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911",
              name: "Course one",
            },
          ],
          meta: { nextCursor: "next-cursor" },
        });
      }),
    );

    const page = await listCourses({ limit: 1, cursor: "cursor-token" });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.name).toBe("Course one");
    expect(page.nextCursor).toBe("next-cursor");
  });

  it("loads every page of courses owned by the coach", async () => {
    const firstCourse = {
      id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911",
      name: "Course one",
      ownerId: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7921",
      status: "active",
      version: 1,
      createdAt: "2026-11-20T07:00:00.000Z",
      updatedAt: "2026-11-20T07:00:00.000Z",
    };
    const secondCourse = {
      ...firstCourse,
      id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
      name: "Course two",
    };
    server.use(
      http.get("http://localhost:3000/api/v1/me/courses", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe("100");
        if (url.searchParams.has("cursor")) {
          expect(url.searchParams.get("cursor")).toBe("next-cursor");
          return HttpResponse.json({ data: [secondCourse] });
        }
        return HttpResponse.json({
          data: [firstCourse],
          meta: { nextCursor: "next-cursor" },
        });
      }),
    );

    const courses = await listAllMyCourses();

    expect(courses.map((course) => course.id)).toEqual([
      firstCourse.id,
      secondCourse.id,
    ]);
  });
});
