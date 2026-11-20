import { useMemo } from "react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AuthPage } from "../features/auth/AuthPage";
import { ChangePasswordPage } from "../features/auth/ChangePasswordPage";
import { ChatWorkspacePage } from "../features/chat/ChatWorkspacePage";
import { ConversationHistoryPage } from "../features/chat/ConversationHistoryPage";
import { CourseDetailsPage } from "../features/courses/CourseDetailsPage";
import { CourseManagementPage } from "../features/courses/CourseManagementPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { DocumentLibraryPage } from "../features/documents/DocumentLibraryPage";
import { AdminPage } from "../features/admin/AdminPage";
import { WorkspaceLayout } from "../features/workspace/WorkspacePage";
import { LearningWorkspacePage } from "../features/learning/LearningWorkspacePage";

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

export function App() {
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          primary: { main: "#153a5b" },
          secondary: { main: "#007c78" },
          background: { default: "#f5f7fa" },
        },
        shape: { borderRadius: 10 },
        typography: {
          fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
        },
        components: {
          MuiButton: {
            defaultProps: { disableElevation: true },
          },
        },
      }),
    [],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<AuthenticatedRoutes />}>
          <Route element={<WorkspaceRoutes />}>
            <Route element={<WorkspaceLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="courses" element={<CourseManagementPage />} />
              <Route path="courses/:courseId" element={<CourseDetailsPage />} />
              <Route
                path="courses/:courseId/study"
                element={<LearningWorkspacePage />}
              />
              <Route
                path="courses/:courseId/documents"
                element={<DocumentLibraryPage />}
              />
              <Route path="chat" element={<ChatWorkspacePage />} />
              <Route path="conversations" element={<ConversationHistoryPage />} />
            </Route>
          </Route>
          <Route path="/change-password" element={<ChangePasswordPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
