import { Alert, Box, Tab, Tabs, Typography } from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { AdminOperationsPanel } from "./AdminOperationsPanel";
import { AdminSettingsPanel } from "./AdminSettingsPanel";
import { AdminUsersPanel } from "./AdminUsersPanel";
import { CoachRequestsPanel } from "./CoachRequestsPanel";

type AdminSection = "users" | "coach-requests" | "operations" | "settings";

export function AdminPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const sections: Array<{ id: AdminSection; label: string }> = [];
  if (user?.permissions.includes("role:manage")) {
    sections.push({ id: "users", label: "Users" });
  }
  if (user?.permissions.includes("user:manage")) {
    sections.push({ id: "coach-requests", label: "Coach applications" });
  }
  if (
    user?.permissions.includes("executions:view") ||
    user?.permissions.includes("audit:view")
  ) {
    sections.push({ id: "operations", label: "Operations" });
  }
  if (user?.permissions.includes("config:view")) {
    sections.push({ id: "settings", label: "Settings" });
  }

  const requestedSection = sections.find(
    (item) => item.id === searchParams.get("section"),
  )?.id;
  const activeSection = requestedSection ?? sections[0]?.id ?? null;

  if (user?.role !== "admin") {
    return (
      <Alert severity="error">
        Admin access is required. <RouterLink to="/">Return to the dashboard</RouterLink>.
      </Alert>
    );
  }

  return (
    <Box>
      <Typography component="h1" variant="h4" fontWeight={700} sx={{ mb: 1 }}>
        Administration
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Manage accounts and review privacy-safe system metadata.
      </Typography>
      {sections.length === 0 ? (
        <Alert severity="info">
          Your account does not have permission to access an admin section.
        </Alert>
      ) : (
        <>
          <Tabs
            value={activeSection}
            onChange={(_event, value: AdminSection) =>
              setSearchParams({ section: value }, { replace: true })
            }
            aria-label="Admin sections"
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
          >
            {sections.map((item) => (
              <Tab key={item.id} value={item.id} label={item.label} />
            ))}
          </Tabs>
          {activeSection === "users" && <AdminUsersPanel />}
          {activeSection === "coach-requests" && <CoachRequestsPanel />}
          {activeSection === "operations" && <AdminOperationsPanel />}
          {activeSection === "settings" && (
            <AdminSettingsPanel
              canManage={user.permissions.includes("config:manage")}
            />
          )}
        </>
      )}
    </Box>
  );
}
