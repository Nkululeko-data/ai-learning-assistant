export type SeedRoleName = "learner" | "coach" | "admin";

export const roleDefinitions: Array<{
  name: SeedRoleName;
  description: string;
}> = [
  { name: "learner", description: "Learner account" },
  { name: "coach", description: "Coach account" },
  { name: "admin", description: "Administrator account" },
];

export const permissionDefinitions = [
  "course:create",
  "course:edit",
  "course:archive",
  "document:upload",
  "document:delete",
  "enrolment:approve",
  "insights:view",
  "feedback:review",
  "content:generate",
  "quiz:create",
  "user:manage",
  "role:manage",
  "config:manage",
  "config:view",
  "audit:view",
  "executions:view",
];

export const baselinePermissions: Record<SeedRoleName, string[]> = {
  learner: [
    "document:upload",
    "document:delete",
    "content:generate",
    "quiz:create",
  ],
  coach: [
    "course:create",
    "course:edit",
    "course:archive",
    "document:upload",
    "document:delete",
    "enrolment:approve",
    "insights:view",
    "feedback:review",
    "content:generate",
    "quiz:create",
  ],
  admin: [
    "user:manage",
    "role:manage",
    "config:manage",
    "config:view",
    "audit:view",
    "executions:view",
  ],
};
