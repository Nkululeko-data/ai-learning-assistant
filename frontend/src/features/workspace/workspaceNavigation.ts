import {
  BookOpen,
  BrainCircuit,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  MessageCircle,
  Settings,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CourseListItem } from "../../api/courses";
import type { AuthenticatedUser } from "../../api/auth";
import { isCourseView } from "../courses/course-utils";

type UserRole = AuthenticatedUser["role"];
export type NavigationBadge = "coachApplications" | "courseApprovals" | "joinRequests";

export interface WorkspaceNavigationItem {
  roles: readonly UserRole[];
  permission: readonly string[] | null;
  route: string | null;
  label: string;
  icon: LucideIcon;
  badge?: NavigationBadge;
  children?: readonly WorkspaceNavigationItem[];
}

const adminSections = [
  "user:manage",
  "role:manage",
  "executions:view",
  "audit:view",
  "config:view",
] as const;

const adminRole: readonly UserRole[] = ["admin"];
const learnerAndCoachRoles: readonly UserRole[] = ["learner", "coach"];

export const workspaceNavigation: readonly WorkspaceNavigationItem[] = [
  {
    roles: ["learner", "coach"],
    permission: null,
    route: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    roles: adminRole,
    permission: adminSections,
    route: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    roles: ["learner", "coach"],
    permission: null,
    route: "/my-courses",
    label: "My courses",
    icon: BookOpen,
  },
  {
    roles: ["learner"],
    permission: null,
    route: "/courses",
    label: "Browse courses",
    icon: BookOpen,
  },
  {
    roles: ["learner"],
    permission: null,
    route: "/chat",
    label: "Chat",
    icon: MessageCircle,
  },
  {
    roles: ["learner"],
    permission: null,
    route: "/history",
    label: "History",
    icon: History,
  },
  {
    roles: ["learner"],
    permission: null,
    route: "/quiz-results",
    label: "Quiz results",
    icon: BrainCircuit,
  },
  {
    roles: adminRole,
    permission: ["role:manage"],
    route: "/admin/users",
    label: "Users",
    icon: UsersRound,
  },
  {
    roles: adminRole,
    permission: ["user:manage"],
    route: "/admin/coach-applications",
    label: "Coach applications",
    icon: ClipboardCheck,
    badge: "coachApplications",
  },
  {
    roles: adminRole,
    permission: ["user:manage"],
    route: "/admin/course-approvals",
    label: "Course approvals",
    icon: BookOpen,
    badge: "courseApprovals",
  },
  {
    roles: adminRole,
    permission: ["user:manage"],
    route: "/admin/courses",
    label: "Courses",
    icon: BookOpen,
  },
  {
    roles: adminRole,
    permission: adminSections,
    route: null,
    label: "Operations",
    icon: Settings,
    children: [
      {
        roles: adminRole,
        permission: ["executions:view"],
        route: "/admin/operations/jobs",
        label: "Jobs",
        icon: FileText,
      },
      {
        roles: adminRole,
        permission: ["audit:view"],
        route: "/admin/operations/audit",
        label: "Audit log",
        icon: History,
      },
      {
        roles: adminRole,
        permission: ["executions:view"],
        route: "/admin/operations/executions",
        label: "AI executions",
        icon: BrainCircuit,
      },
      {
        roles: adminRole,
        permission: ["config:view"],
        route: "/admin/operations/settings",
        label: "Settings",
        icon: Settings,
      },
    ],
  },
];

function isPermitted(
  user: AuthenticatedUser,
  permission: readonly string[] | null,
): boolean {
  return (
    permission === null ||
    permission.some((required) => user.permissions.includes(required))
  );
}

function isVisible(user: AuthenticatedUser, item: WorkspaceNavigationItem): boolean {
  return item.roles.includes(user.role) && isPermitted(user, item.permission);
}

export function getWorkspaceNavigation(
  user: AuthenticatedUser,
): WorkspaceNavigationItem[] {
  return workspaceNavigation.flatMap((item) => {
    if (!isVisible(user, item)) return [];
    if (!item.children) return [item];

    const children = item.children.filter((child) => isVisible(user, child));
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

export function getCourseNavigation(
  user: AuthenticatedUser,
  course: CourseListItem,
): WorkspaceNavigationItem[] {
  const courseId = course.id;
  const coursePath = `/courses/${courseId}`;
  const courseView = isCourseView(course) ? course : null;
  const learnerHasAccess = user.role === "learner" && courseView?.status === "active";
  const coachOwnsCourse = user.role === "coach" && courseView?.ownerId === user.id;
  const canUseCourseContent = learnerHasAccess || coachOwnsCourse;

  const items: WorkspaceNavigationItem[] = [
    {
      roles: learnerAndCoachRoles,
      permission: null,
      route: coursePath,
      label: "Overview",
      icon: LayoutDashboard,
    },
  ];

  if (!canUseCourseContent) return items;

  const canEditLessons =
    coachOwnsCourse &&
    courseView?.status === "active" &&
    user.permissions.includes("course:edit");

  if (learnerHasAccess || canEditLessons) {
    items.push({
      roles: learnerAndCoachRoles,
      permission: null,
      route: `${coursePath}#${user.role === "coach" ? "course-lessons-editor" : "course-curriculum"}`,
      label: "Lessons",
      icon: BookOpen,
    });
  }
  items.push({
    roles: learnerAndCoachRoles,
    permission: null,
    route: `${coursePath}/documents`,
    label: "Documents",
    icon: FileText,
  });
  items.push({
    roles: learnerAndCoachRoles,
    permission: user.role === "coach" ? ["enrolment:approve"] : null,
    route: `${coursePath}#course-people`,
    label: "People",
    icon: UsersRound,
  });

  if (user.role === "coach" && user.permissions.includes("enrolment:approve")) {
    items.push({
      roles: ["coach"],
      permission: ["enrolment:approve"],
      route: `${coursePath}#course-join-requests`,
      label: "Join requests",
      icon: ClipboardCheck,
      badge: "joinRequests",
    });
  }

  const canUseQuiz =
    user.role === "learner" ||
    (canEditLessons && user.permissions.includes("quiz:create"));
  if (canUseQuiz) {
    items.push({
      roles: learnerAndCoachRoles,
      permission: null,
      route:
        user.role === "coach"
          ? `${coursePath}#course-quizzes`
          : `${coursePath}/study?tab=quiz`,
      label: "Quizzes",
      icon: BrainCircuit,
    });
  }

  if (
    courseView?.status === "active" &&
    user.permissions.includes("content:generate")
  ) {
    items.push(
      {
        roles: learnerAndCoachRoles,
        permission: ["content:generate"],
        route: `${coursePath}/study?tab=summary`,
        label: "Summaries",
        icon: FileText,
      },
      {
        roles: learnerAndCoachRoles,
        permission: ["content:generate"],
        route: `${coursePath}/study?tab=flashcards`,
        label: "Flashcards",
        icon: BookOpen,
      },
    );
  }

  if (user.role === "coach" && user.permissions.includes("insights:view")) {
    items.push({
      roles: ["coach"],
      permission: ["insights:view"],
      route: `${coursePath}#course-insights`,
      label: "Insights",
      icon: BrainCircuit,
    });
  }

  items.push({
    roles: learnerAndCoachRoles,
    permission: null,
    route: `/chat?courseId=${encodeURIComponent(courseId)}`,
    label: "Ask about this course",
    icon: MessageCircle,
  });

  return items.filter((item) => isVisible(user, item));
}
