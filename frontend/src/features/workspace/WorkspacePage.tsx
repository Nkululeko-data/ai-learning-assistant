import { useState } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link as RouterLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";

export function WorkspaceLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  async function handleSignOut() {
    setMenuAnchor(null);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      navigate("/login?logout=unconfirmed", { replace: true });
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary">
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            component={RouterLink}
            to="/"
            variant="h6"
            color="inherit"
            sx={{ textDecoration: "none", flexGrow: 1, fontWeight: 700 }}
          >
            AI Learning Assistant
          </Typography>
          {user && (
            <>
              {user.role === "admin" && (
                <>
                  <Button
                    component={RouterLink}
                    to="/"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    Admin dashboard
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/courses"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    Course catalog
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/admin"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    Administration
                  </Button>
                </>
              )}
              {user.role !== "admin" && (
                <>
                  <Button
                    component={RouterLink}
                    to="/"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    Dashboard
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/courses"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    Courses
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/chat"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    Chat
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/conversations"
                    color="inherit"
                    sx={{ display: { xs: "none", sm: "inline-flex" } }}
                  >
                    History
                  </Button>
                </>
              )}
              <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
                {user.role}
              </Typography>
              <IconButton
                color="inherit"
                aria-label={`Account menu for ${user.displayName}`}
                aria-controls={menuAnchor ? "account-menu" : undefined}
                aria-haspopup="true"
                aria-expanded={Boolean(menuAnchor)}
                onClick={(event) => setMenuAnchor(event.currentTarget)}
              >
                <Avatar sx={{ width: 34, height: 34 }}>
                  {user.displayName.slice(0, 1).toUpperCase()}
                </Avatar>
              </IconButton>
              <Menu
                id="account-menu"
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={() => setMenuAnchor(null)}
              >
                <MenuItem
                  component={RouterLink}
                  to="/change-password"
                  onClick={() => setMenuAnchor(null)}
                >
                  Change password
                </MenuItem>
                <MenuItem onClick={() => void handleSignOut()}>Sign out</MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Outlet />
      </Container>
    </Box>
  );
}
