import { lazy, Suspense, useMemo } from "react";
import { Alert, CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Link as RouterLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { AuthPage } from "../features/auth/AuthPage";
import { AdminDashboardPage } from "../features/admin/AdminDashboardPage";
import { CourseApprovalsPanel } from "../features/admin/CourseApprovalsPanel";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { WorkspaceLayout } from "../features/workspace/WorkspacePage";
import { designTokens } from "../theme/designTokens";

const ChangePasswordPage = lazy(() =>
  import("../features/auth/ChangePasswordPage").then((module) => ({
    default: module.ChangePasswordPage,
  })),
);
const ChatWorkspacePage = lazy(() =>
  import("../features/chat/ChatWorkspacePage").then((module) => ({
    default: module.ChatWorkspacePage,
  })),
);
const ConversationHistoryPage = lazy(() =>
  import("../features/chat/ConversationHistoryPage").then((module) => ({
    default: module.ConversationHistoryPage,
  })),
);
const CourseDetailsPage = lazy(() =>
  import("../features/courses/CourseDetailsPage").then((module) => ({
    default: module.CourseDetailsPage,
  })),
);
const CourseManagementPage = lazy(() =>
  import("../features/courses/CourseManagementPage").then((module) => ({
    default: module.CourseManagementPage,
  })),
);
const MyCoursesPage = lazy(() =>
  import("../features/courses/MyCoursesPage").then((module) => ({
    default: module.MyCoursesPage,
  })),
);
const AdminCoursesPage = lazy(() =>
  import("../features/admin/AdminCoursesPage").then((module) => ({
    default: module.AdminCoursesPage,
  })),
);
const AdminOperationsPanel = lazy(() =>
  import("../features/admin/AdminOperationsPanel").then((module) => ({
    default: module.AdminOperationsPanel,
  })),
);
const AdminSettingsPanel = lazy(() =>
  import("../features/admin/AdminSettingsPanel").then((module) => ({
    default: module.AdminSettingsPanel,
  })),
);
const AdminUsersPanel = lazy(() =>
  import("../features/admin/AdminUsersPanel").then((module) => ({
    default: module.AdminUsersPanel,
  })),
);
const CoachRequestsPanel = lazy(() =>
  import("../features/admin/CoachRequestsPanel").then((module) => ({
    default: module.CoachRequestsPanel,
  })),
);
const DocumentLibraryPage = lazy(() =>
  import("../features/documents/DocumentLibraryPage").then((module) => ({
    default: module.DocumentLibraryPage,
  })),
);
const LearningWorkspacePage = lazy(() =>
  import("../features/learning/LearningWorkspacePage").then((module) => ({
    default: module.LearningWorkspacePage,
  })),
);
const QuizResultsPage = lazy(() =>
  import("../features/learning/QuizResultsPage").then((module) => ({
    default: module.QuizResultsPage,
  })),
);

function AuthenticatedRoutes() {
  const { user, status } = useAuth();
  if (status === "loading") {
    return <main aria-busy="true">Checking your session…</main>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function WorkspaceRoutes() {
  const { user } = useAuth();
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

function LoginRoute() {
  const { user, status } = useAuth();
  if (status === "loading") {
    return <main aria-busy="true">Checking your session…</main>;
  }
  return user ? <Navigate to="/" replace /> : <AuthPage />;
}

function DashboardRoute() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Navigate to="/admin" replace /> : <DashboardPage />;
}

function AdminRoute({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: string;
}) {
  const { user } = useAuth();
  if (user?.role !== "admin") {
    return (
      <Alert severity="error">
        Admin access is required.{" "}
        <RouterLink to="/">Return to the dashboard</RouterLink>.
      </Alert>
    );
  }
  if (permission && !user.permissions.includes(permission)) {
    return (
      <Alert severity="error">You do not have permission to view this page.</Alert>
    );
  }
  return children;
}

function NonAdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === "admin" ? <Navigate to="/admin" replace /> : children;
}

function CourseCatalogRoute() {
  const { user } = useAuth();
  return user?.role === "admin" ? (
    <Navigate to="/admin/courses" replace />
  ) : (
    <CourseManagementPage />
  );
}

export function App() {
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          primary: {
            main: designTokens.color.primary,
            contrastText: designTokens.color.surface,
          },
          secondary: {
            main: designTokens.color.accent,
            dark: designTokens.color.accentActive,
            contrastText: designTokens.color.surface,
          },
          background: {
            default: designTokens.color.page,
            paper: designTokens.color.surface,
          },
          text: {
            primary: designTokens.color.textPrimary,
            secondary: designTokens.color.textSecondary,
          },
        },
        spacing: designTokens.spacingUnit,
        shape: { borderRadius: designTokens.radiusUnit },
        typography: {
          fontFamily: designTokens.typography.bodyFamily,
          h1: {
            fontFamily: designTokens.typography.headingFamily,
            fontSize: designTokens.typography.scale.h1,
            lineHeight: 1.15,
          },
          h2: {
            fontFamily: designTokens.typography.headingFamily,
            fontSize: designTokens.typography.scale.h2,
            lineHeight: 1.2,
          },
          h3: {
            fontFamily: designTokens.typography.headingFamily,
            fontSize: designTokens.typography.scale.h3,
            lineHeight: 1.2,
          },
          h4: {
            fontFamily: designTokens.typography.headingFamily,
            fontSize: designTokens.typography.scale.h4,
            lineHeight: 1.25,
          },
          h5: {
            fontFamily: designTokens.typography.headingFamily,
            fontSize: designTokens.typography.scale.h5,
            lineHeight: 1.25,
          },
          h6: {
            fontFamily: designTokens.typography.headingFamily,
            fontSize: designTokens.typography.scale.h6,
            lineHeight: 1.3,
          },
          body1: {
            fontSize: designTokens.typography.scale.body1,
            lineHeight: 1.5,
          },
          body2: {
            fontSize: designTokens.typography.scale.body2,
            lineHeight: 1.45,
          },
          caption: {
            fontSize: designTokens.typography.scale.caption,
            lineHeight: 1.35,
          },
          button: {
            fontSize: designTokens.typography.scale.body1,
            fontWeight: 600,
            textTransform: "none",
          },
        },
        components: {
          MuiButton: {
            defaultProps: { disableElevation: true },
            styleOverrides: {
              root: {
                borderRadius: designTokens.radiusUnit * 2,
                textTransform: "none",
              },
              containedSecondary: {
                "&:hover, &:active": {
                  backgroundColor: designTokens.color.accentActive,
                },
              },
            },
          },
          MuiButtonBase: {
            styleOverrides: {
              root: {
                "&.Mui-focusVisible": {
                  outline: "none",
                  boxShadow: `0 0 0 2px ${designTokens.color.focusRingGap}, 0 0 0 4px ${designTokens.color.accentActive}`,
                },
              },
            },
          },
          MuiTab: {
            styleOverrides: {
              root: { textTransform: "none" },
            },
          },
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: designTokens.color.page,
                color: designTokens.color.textPrimary,
              },
              "::selection": {
                backgroundColor: designTokens.color.selection,
                color: designTokens.color.textPrimary,
              },
              ":focus-visible": {
                outline: `2px solid ${designTokens.color.accentActive}`,
                outlineOffset: 2,
                boxShadow: `0 0 0 2px ${designTokens.color.focusRingGap}, 0 0 0 4px ${designTokens.color.accentActive}`,
              },
              "input, textarea": {
                caretColor: designTokens.color.accent,
              },
              "@media (prefers-reduced-motion: reduce)": {
                "*, *::before, *::after": {
                  animationDuration: "0.01ms !important",
                  animationIterationCount: "1 !important",
                  scrollBehavior: "auto !important",
                },
                ".MuiBackdrop-root, .MuiCollapse-root, .MuiDialog-container, .MuiDialog-paper, .MuiDrawer-paper, .MuiMenu-paper, .MuiPopover-paper":
                  {
                    transitionDuration: "0.01ms !important",
                  },
              },
            },
          },
        },
      }),
    [],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Suspense fallback={<main aria-busy="true">Loading page…</main>}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<AuthenticatedRoutes />}>
            <Route element={<WorkspaceRoutes />}>
              <Route element={<WorkspaceLayout />}>
                <Route index element={<DashboardRoute />} />
                <Route
                  path="admin"
                  element={
                    <AdminRoute>
                      <AdminDashboardPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/users"
                  element={
                    <AdminRoute permission="role:manage">
                      <AdminUsersPanel />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/coach-applications"
                  element={
                    <AdminRoute permission="user:manage">
                      <CoachRequestsPanel />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/course-approvals"
                  element={
                    <AdminRoute permission="user:manage">
                      <CourseApprovalsPanel />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/courses"
                  element={
                    <AdminRoute permission="user:manage">
                      <AdminCoursesPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/operations/jobs"
                  element={
                    <AdminRoute permission="executions:view">
                      <AdminOperationsPanel section="jobs" />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/operations/audit"
                  element={
                    <AdminRoute permission="audit:view">
                      <AdminOperationsPanel section="audit" />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/operations/executions"
                  element={
                    <AdminRoute permission="executions:view">
                      <AdminOperationsPanel section="executions" />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin/operations/settings"
                  element={
                    <AdminRoute permission="config:view">
                      <AdminSettingsRoute />
                    </AdminRoute>
                  }
                />
                <Route
                  path="my-courses"
                  element={
                    <NonAdminRoute>
                      <MyCoursesPage />
                    </NonAdminRoute>
                  }
                />
                <Route path="courses" element={<CourseCatalogRoute />} />
                <Route
                  path="courses/:courseId"
                  element={
                    <NonAdminRoute>
                      <CourseDetailsPage />
                    </NonAdminRoute>
                  }
                />
                <Route
                  path="courses/:courseId/study"
                  element={
                    <NonAdminRoute>
                      <LearningWorkspacePage />
                    </NonAdminRoute>
                  }
                />
                <Route
                  path="courses/:courseId/documents"
                  element={
                    <NonAdminRoute>
                      <DocumentLibraryPage />
                    </NonAdminRoute>
                  }
                />
                <Route
                  path="chat"
                  element={
                    <NonAdminRoute>
                      <ChatWorkspacePage />
                    </NonAdminRoute>
                  }
                />
                <Route
                  path="history"
                  element={
                    <NonAdminRoute>
                      <ConversationHistoryPage />
                    </NonAdminRoute>
                  }
                />
                <Route
                  path="quiz-results"
                  element={
                    <NonAdminRoute>
                      <QuizResultsPage />
                    </NonAdminRoute>
                  }
                />
                <Route
                  path="conversations"
                  element={
                    <NonAdminRoute>
                      <ConversationHistoryPage />
                    </NonAdminRoute>
                  }
                />
              </Route>
            </Route>
            <Route path="/change-password" element={<ChangePasswordPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ThemeProvider>
  );
}

function AdminSettingsRoute() {
  const { user } = useAuth();
  return (
    <AdminSettingsPanel
      canManage={user?.permissions.includes("config:manage") ?? false}
    />
  );
}
