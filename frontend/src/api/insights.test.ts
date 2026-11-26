import { describe, expect, it } from "vitest";
import { gapReportSchema } from "./insights";

describe("gapReportSchema", () => {
  it("accepts unknown aggregate counters without inventing values", () => {
    const report = gapReportSchema.parse({
      id: "fbec7114-d04b-46ac-894d-4134eae8c2be",
      courseId: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-31T00:00:00.000Z",
      totalGapQuestions: null,
      minCohortSizeUsed: 5,
      topics: [],
      otherCount: null,
      generatedBy: null,
      createdAt: "2026-01-31T00:00:00.000Z",
    });

    expect(report.totalGapQuestions).toBeNull();
    expect(report.otherCount).toBeNull();
  });
});
