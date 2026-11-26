import { Component, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { BookOpen, ChevronLeft, ChevronRight, Menu as MenuIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCourse, listCourseJoinRequests } from "../../api/courses";
import { listCourseApprovalQueue, listCoachRequests } from "../../api/admin";
import type { CourseListItem } from "../../api/courses";
import type { AuthenticatedUser } from "../../api/auth";
import { useAuth } from "../../auth/useAuth";
import { designTokens } from "../../theme/designTokens";
import { isCourseView } from "../courses/course-utils";
import {
  getCourseNavigation,
  getWorkspaceNavigation,
  type NavigationBadge,
  type WorkspaceNavigationItem,
} from "./workspaceNavigation";

const expandedSidebarWidth = 240;
const collapsedSidebarWidth = 64;

function sidebarStorageKey(userId: string): string {
  return `workspace-sidebar-expanded:${userId}`;
}

function readSidebarPreference(userId: string, defaultExpanded: boolean): boolean {
  try {
    const preference = window.localStorage.getItem(sidebarStorageKey(userId));
    if (preference === "true") return true;
    if (preference === "false") return false;
  } catch {
    return defaultExpanded;
  }
  return defaultExpanded;
}

function SkipLink() {
  return (
    <Box
      component="a"
      href="#main-content"
      sx={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: (theme) => theme.zIndex.tooltip,
        px: 2,
        py: 1,
        transform: "translateY(-200%)",
        borderRadius: 1,
        bgcolor: "background.paper",
        color: "primary.main",
        fontWeight: 700,
        "&:focus": { transform: "translateY(0)" },
      }}
    >
      Skip to main content
    </Box>
  );
}

function isRouteActive(
  route: string | null,
  pathname: string,
  search: string,
  hash: string,
): boolean {
  if (!route) return false;
  const [pathAndQuery = "", routeHash] = route.split("#");
  const [targetPath = "", targetSearch] = pathAndQuery.split("?");
  const matchesPath =
    pathname === targetPath ||
    (targetPath === "/courses" && pathname.startsWith("/courses/"));
  if (!matchesPath) return false;
  if (
    /^\/courses\/[^/]+$/.test(targetPath) &&
    !routeHash &&
    hash &&
    hash !== "#main-content" &&
    pathname === targetPath
  ) {
    return false;
  }
  const matchesHash =
    hash === `#${routeHash}` ||
    (routeHash === "course-join-requests" && hash === "#enrolment-requests-title");
  if (routeHash && !matchesHash) return false;
  if (targetSearch) {
    const expected = new URLSearchParams(targetSearch);
    const current = new URLSearchParams(search);
    for (const [key, value] of expected) {
      if (current.get(key) !== value) return false;
    }
  }
  return true;
}

function flattenNavigation(
  navigation: readonly WorkspaceNavigationItem[],
): WorkspaceNavigationItem[] {
  return navigation.flatMap((item) => [item, ...(item.children ?? [])]);
}

function getBreadcrumbs(
  user: AuthenticatedUser,
  pathname: string,
  search: string,
  hash: string,
  currentCourseName?: string,
) {
  const navigation = getWorkspaceNavigation(user);
  const allItems = flattenNavigation(navigation);
  const home = allItems.find((item) => item.label === "Dashboard");
  const courseList = allItems.find((item) =>
    user.role === "coach"
      ? item.label === "My courses"
      : user.role === "learner"
        ? item.label === "Browse courses"
        : item.label === "Courses",
  );
  const courseListRoute =
    courseList?.route ?? (user.role === "coach" ? "/my-courses" : "/courses");
  const homeLabel = home?.label ?? "Dashboard";

  if (pathname === (home?.route ?? "/")) {
    return [{ label: homeLabel }];
  }

  const courseRoute = pathname.match(/^\/courses\/([^/]+)(?:\/(study|documents))?$/);
  if (courseRoute) {
    const coursePath = `/courses/${courseRoute[1]}`;
    const pageName =
      courseRoute[2] === "study"
        ? "Study tools"
        : courseRoute[2] === "documents"
          ? "Documents"
          : null;

    return pageName
      ? [
          {
            label:
              pageName === "Documents" ? "Courses" : (courseList?.label ?? "Courses"),
            route: courseListRoute,
          },
          { label: currentCourseName ?? "Course", route: coursePath },
          { label: pageName },
        ]
      : [
          { label: courseList?.label ?? "Courses", route: courseListRoute },
          { label: currentCourseName ?? "Course" },
        ];
  }

  const currentPage = allItems.find((item) =>
    isRouteActive(item.route, pathname, search, hash),
  );
  return [
    { label: homeLabel, route: home?.route ?? "/" },
    { label: currentPage?.label ?? "Page" },
  ];
}

function getBadgeLabel(label: string, count?: number): string {
  return count === undefined ? label : `${label}, ${count} pending`;
}

function SidebarLink({
  item,
  expanded,
  active,
  badgeCount,
  onNavigate,
}: {
  item: WorkspaceNavigationItem;
  expanded: boolean;
  active: boolean;
  badgeCount?: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const accessibleLabel = getBadgeLabel(item.label, badgeCount);
  const link = (
    <ListItemButton
      component={RouterLink}
      to={item.route ?? "/"}
      aria-label={expanded ? undefined : accessibleLabel}
      aria-description={
        expanded && badgeCount !== undefined ? `${badgeCount} pending` : undefined
      }
      aria-current={active ? "page" : undefined}
      className={active ? "active" : undefined}
      onClick={onNavigate}
      sx={{
        minHeight: 44,
        mx: 1,
        mb: 0.5,
        px: expanded ? 1.5 : 0,
        justifyContent: expanded ? "flex-start" : "center",
        borderRadius: 1,
        color: "inherit",
        "&.active": {
          bgcolor: designTokens.color.onPrimarySubtle,
          fontWeight: 700,
        },
        "&.active:hover, &:hover": {
          bgcolor: designTokens.color.onPrimarySubtle,
        },
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: expanded ? 36 : 0,
          justifyContent: "center",
          color: "inherit",
        }}
      >
        {badgeCount === undefined ? (
          <Icon aria-hidden="true" size={20} />
        ) : (
          <Badge aria-hidden="true" badgeContent={badgeCount} max={99} color="error">
            <Icon aria-hidden="true" size={20} />
          </Badge>
        )}
      </ListItemIcon>
      {expanded && <ListItemText primary={item.label} />}
    </ListItemButton>
  );

  return (
    <ListItem disablePadding>
      {expanded ? (
        link
      ) : (
        <Tooltip title={accessibleLabel} placement="right">
          {link}
        </Tooltip>
      )}
    </ListItem>
  );
}

interface SidebarContentProps {
  user: AuthenticatedUser;
  navigation: WorkspaceNavigationItem[];
  course?: CourseListItem;
  courseLoading: boolean;
  courseError: boolean;
  badgeCounts: Partial<Record<NavigationBadge, number>>;
  badgeError: boolean;
  pathname: string;
  search: string;
  hash: string;
  expanded: boolean;
  onToggleExpanded?: () => void;
  onNavigate?: () => void;
}

function SidebarContent({
  user,
  navigation,
  course,
  courseLoading,
  courseError,
  badgeCounts,
  badgeError,
  pathname,
  search,
  hash,
  expanded,
  onToggleExpanded,
  onNavigate,
}: SidebarContentProps) {
  const courseNavigation = course ? getCourseNavigation(user, course) : [];
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        component="section"
        aria-label="Learnova workspace"
        className="learnova-brand-lockup"
        sx={{
          minHeight: 64,
          justifyContent: expanded ? "flex-start" : "center",
          px: expanded ? 2 : 0,
        }}
      >
        <Tooltip
          title={expanded ? "" : "Learnova"}
          placement="right"
          disableHoverListener={expanded}
        >
          <Box
            component="span"
            role={expanded ? undefined : "img"}
            aria-label={expanded ? undefined : "Learnova"}
            className="learnova-brand-mark"
          >
            <BookOpen aria-hidden="true" size={21} />
          </Box>
        </Tooltip>
        {expanded && (
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              noWrap
              sx={{ color: "common.white", lineHeight: 1.1 }}
            >
              Learnova
            </Typography>
            <Typography
              variant="overline"
              noWrap
              sx={{
                display: "block",
                mt: 0.4,
                color: "rgba(246, 244, 238, 0.62)",
                fontSize: "0.61rem",
                lineHeight: 1,
                letterSpacing: "0.12em",
              }}
            >
              {user.role === "admin" ? "Admin workspace" : "Learning space"}
            </Typography>
          </Box>
        )}
      </Box>
      <Divider sx={{ borderColor: designTokens.color.onPrimarySubtle }} />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Box component="nav" id="primary-navigation" aria-label="Main" sx={{ py: 1 }}>
          <List disablePadding>
            {navigation.map((item) => {
              const children = item.children ?? [];
              const childIsActive = children.some((child) =>
                isRouteActive(child.route, pathname, search, hash),
              );
              const active =
                isRouteActive(item.route, pathname, search, hash) || childIsActive;

              if (children.length === 0 || !item.route) {
                if (children.length === 0) {
                  return (
                    <SidebarLink
                      key={`${item.route}-${item.label}`}
                      item={item}
                      expanded={expanded}
                      active={active}
                      badgeCount={item.badge ? badgeCounts[item.badge] : undefined}
                      onNavigate={onNavigate}
                    />
                  );
                }

                const Icon = item.icon;
                const groupExpanded = expandedGroups[item.label] ?? childIsActive;
                const groupButton = (
                  <ListItemButton
                    aria-label={item.label}
                    aria-expanded={groupExpanded}
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [item.label]: !groupExpanded,
                      }))
                    }
                    className={active ? "active" : undefined}
                    sx={{
                      minHeight: 44,
                      mx: 1,
                      mb: 0.5,
                      px: expanded ? 1.5 : 0,
                      justifyContent: expanded ? "flex-start" : "center",
                      borderRadius: 1,
                      color: "inherit",
                      "&.active, &:hover": {
                        bgcolor: designTokens.color.onPrimarySubtle,
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: expanded ? 36 : 0,
                        justifyContent: "center",
                        color: "inherit",
                      }}
                    >
                      <Icon aria-hidden="true" size={20} />
                    </ListItemIcon>
                    {expanded && <ListItemText primary={item.label} />}
                  </ListItemButton>
                );

                return (
                  <ListItem key={item.label} disablePadding sx={{ display: "block" }}>
                    {expanded ? (
                      groupButton
                    ) : (
                      <Tooltip title={item.label} placement="right">
                        {groupButton}
                      </Tooltip>
                    )}
                    <Collapse in={groupExpanded} unmountOnExit>
                      <List disablePadding sx={{ pl: expanded ? 1.5 : 0 }}>
                        {children.map((child) => (
                          <SidebarLink
                            key={`${child.route}-${child.label}`}
                            item={child}
                            expanded={expanded}
                            active={isRouteActive(child.route, pathname, search, hash)}
                            onNavigate={onNavigate}
                          />
                        ))}
                      </List>
                    </Collapse>
                  </ListItem>
                );
              }
              return null;
            })}
          </List>
        </Box>
        {courseLoading && (
          <Typography role="status" variant="body2" sx={{ px: 2, py: 1 }}>
            Loading course...
          </Typography>
        )}
        {courseError && (
          <Typography role="status" variant="body2" sx={{ px: 2, py: 1 }}>
            Course navigation is unavailable.
          </Typography>
        )}
        {course && (
          <Box component="nav" aria-label={`Course: ${course.name}`} sx={{ py: 1 }}>
            <Divider sx={{ borderColor: designTokens.color.onPrimarySubtle }} />
            {expanded && (
              <Typography
                component="h2"
                variant="subtitle2"
                fontWeight={700}
                noWrap
                sx={{ px: 2, py: 1.5 }}
              >
                {course.name}
              </Typography>
            )}
            <List disablePadding>
              {courseNavigation.map((item) => (
                <SidebarLink
                  key={`${item.route}-${item.label}`}
                  item={item}
                  expanded={expanded}
                  active={isRouteActive(item.route, pathname, search, hash)}
                  badgeCount={item.badge ? badgeCounts[item.badge] : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </List>
          </Box>
        )}
        {badgeError && (
          <Typography role="status" variant="caption" sx={{ px: 2, py: 1 }}>
            Some pending counts are unavailable.
          </Typography>
        )}
      </Box>
      {onToggleExpanded && (
        <Box sx={{ mt: "auto", px: 1, pb: 1 }}>
          <Tooltip
            title={expanded ? "Collapse sidebar" : "Expand sidebar"}
            placement="right"
          >
            <IconButton
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={expanded}
              onClick={onToggleExpanded}
              sx={{
                width: "100%",
                minHeight: 44,
                borderRadius: 1,
                color: "inherit",
                justifyContent: expanded ? "flex-end" : "center",
                "&:hover": { bgcolor: designTokens.color.onPrimarySubtle },
              }}
            >
              {expanded ? (
                <ChevronLeft aria-hidden="true" size={20} />
              ) : (
                <ChevronRight aria-hidden="true" size={20} />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}

export function WorkspaceLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const courseId = location.pathname.match(/^\/courses\/([^/]+)/)?.[1];
  const courseQuery = useQuery({
    queryKey: ["courses", "detail", courseId],
    queryFn: () => getCourse(courseId ?? ""),
    enabled: Boolean(courseId),
  });
  const coachApplicationsQuery = useQuery({
    queryKey: ["admin", "coach-requests", "pending"],
    queryFn: () => listCoachRequests("pending"),
    enabled: Boolean(
      user?.role === "admin" && user.permissions.includes("user:manage"),
    ),
    refetchInterval: 5 * 60 * 1000,
  });
  const courseApprovalsQuery = useQuery({
    queryKey: ["admin", "course-approvals", "sidebar"],
    queryFn: () => listCourseApprovalQueue({ limit: 100 }),
    enabled: Boolean(
      user?.role === "admin" && user.permissions.includes("user:manage"),
    ),
    refetchInterval: 5 * 60 * 1000,
  });
  const canLoadJoinRequestsCount = Boolean(
    user?.role === "coach" &&
    user.permissions.includes("enrolment:approve") &&
    courseQuery.data &&
    isCourseView(courseQuery.data) &&
    courseQuery.data.ownerId === user.id,
  );
  const joinRequestsQuery = useQuery({
    queryKey: ["enrolments", "course", courseId, "pending", "sidebar-count"],
    queryFn: () => {
      if (!courseId) throw new Error("Course ID is required.");
      return listCourseJoinRequests(courseId, { limit: 100, status: "pending" });
    },
    enabled: canLoadJoinRequestsCount,
    refetchInterval: 5 * 60 * 1000,
  });
  const isMobile = useMediaQuery("(max-width: 767px)", { noSsr: true });
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)", {
    noSsr: true,
  });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [mobileDrawerState, setMobileDrawerState] = useState(() => ({
    pathname: location.pathname,
    open: false,
  }));
  const mobileDrawerOpen =
    mobileDrawerState.pathname === location.pathname && mobileDrawerState.open;
  const setMobileDrawerOpen = (open: boolean) =>
    setMobileDrawerState({ pathname: location.pathname, open });
  const [sidebarExpanded, setSidebarExpanded] = useState(() =>
    user ? readSidebarPreference(user.id, !isTablet) : !isTablet,
  );

  if (!user) return null;

  const currentUserId = user.id;
  const navigation = getWorkspaceNavigation(user);
  const badgeCounts: Partial<Record<NavigationBadge, number>> = {};
  if (coachApplicationsQuery.data) {
    badgeCounts.coachApplications = Math.min(coachApplicationsQuery.data.length, 100);
  }
  if (courseApprovalsQuery.data) {
    badgeCounts.courseApprovals = courseApprovalsQuery.data.items.length;
  }
  if (joinRequestsQuery.data) {
    badgeCounts.joinRequests = joinRequestsQuery.data.items.length;
  }
  const badgeError =
    coachApplicationsQuery.isError ||
    courseApprovalsQuery.isError ||
    joinRequestsQuery.isError;
  const expanded = isMobile || sidebarExpanded;
  const sidebarWidth = expanded ? expandedSidebarWidth : collapsedSidebarWidth;

  function toggleSidebar() {
    const next = !sidebarExpanded;
    setSidebarExpanded(next);
    try {
      window.localStorage.setItem(sidebarStorageKey(currentUserId), String(next));
    } catch {
      // The sidebar remains usable when browser storage is unavailable.
    }
  }

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
    <Box
      className="learnova-workspace"
      sx={{ minHeight: "100vh", display: "flex", bgcolor: "background.default" }}
    >
      <SkipLink />
      <Drawer
        className="learnova-sidebar"
        variant={isMobile ? "temporary" : "permanent"}
        open={!isMobile || mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        sx={{
          width: sidebarWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            boxSizing: "border-box",
            width: sidebarWidth,
            overflowX: "hidden",
            bgcolor: "primary.main",
            color: "primary.contrastText",
            borderRight: 0,
            position: isMobile ? "fixed" : "sticky",
            top: 0,
            height: "100vh",
            transition: "width 180ms ease-out",
            "@media (prefers-reduced-motion: reduce)": {
              transition: "none",
            },
          },
        }}
      >
        <SidebarContent
          user={user}
          navigation={navigation}
          course={courseQuery.data}
          courseLoading={Boolean(courseId) && courseQuery.isLoading}
          courseError={Boolean(courseId) && courseQuery.isError}
          badgeCounts={badgeCounts}
          badgeError={badgeError}
          pathname={location.pathname}
          search={location.search}
          hash={location.hash}
          expanded={expanded}
          onNavigate={isMobile ? () => setMobileDrawerOpen(false) : undefined}
          onToggleExpanded={isMobile ? undefined : toggleSidebar}
        />
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar
          className="learnova-topbar"
          component="header"
          position="sticky"
          color="inherit"
          elevation={0}
          sx={{
            bgcolor: "background.paper",
            color: "text.primary",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Toolbar sx={{ minHeight: 56, gap: 1.5 }}>
            {isMobile && (
              <IconButton
                aria-label={
                  mobileDrawerOpen ? "Close navigation menu" : "Open navigation menu"
                }
                aria-controls="primary-navigation"
                aria-expanded={mobileDrawerOpen}
                onClick={() => setMobileDrawerOpen(true)}
                edge="start"
              >
                <MenuIcon aria-hidden="true" size={20} />
              </IconButton>
            )}
            <Breadcrumbs aria-label="Breadcrumb" sx={{ minWidth: 0 }}>
              {getBreadcrumbs(
                user,
                location.pathname,
                location.search,
                location.hash,
                courseQuery.data?.name,
              ).map((crumb, index) =>
                crumb.route ? (
                  <Link
                    key={`${crumb.route}-${crumb.label}`}
                    component={RouterLink}
                    to={crumb.route}
                    color="inherit"
                    underline="hover"
                    noWrap
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <Typography
                    key={`${index}-${crumb.label}`}
                    color="text.primary"
                    noWrap
                  >
                    {crumb.label}
                  </Typography>
                ),
              )}
            </Breadcrumbs>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton
              color="inherit"
              aria-label={`Account menu for ${user.displayName}`}
              aria-controls={menuAnchor ? "account-menu" : undefined}
              aria-haspopup="true"
              aria-expanded={Boolean(menuAnchor)}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              sx={{
                borderRadius: "50%",
                "& .MuiAvatar-root": {
                  bgcolor: "primary.main",
                  color: "common.white",
                  fontWeight: 700,
                },
              }}
            >
              <Avatar sx={{ width: 36, height: 36 }}>
                {user.displayName.slice(0, 1).toUpperCase()}
              </Avatar>
            </IconButton>
            <Menu
              id="account-menu"
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
            >
              <Box sx={{ px: 2, py: 1 }}>
                <Typography fontWeight={700}>{user.displayName}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                </Typography>
              </Box>
              <Divider />
              <MenuItem
                component={RouterLink}
                to="/change-password"
                onClick={() => setMenuAnchor(null)}
              >
                Change password
              </MenuItem>
              <MenuItem onClick={() => void handleSignOut()}>Sign out</MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        <Box
          component="main"
          id="main-content"
          className="learnova-content"
          tabIndex={-1}
          sx={{
            width: "100%",
            maxWidth: 1440,
            mx: "auto",
            scrollMarginTop: 64,
            px: { xs: 2, sm: 3, md: 4 },
            py: { xs: 3, md: 5 },
            "&:focus": {
              outline: `2px solid ${designTokens.color.accentActive}`,
              outlineOffset: 4,
            },
          }}
        >
          <PageErrorBoundary
            resetKey={`${location.pathname}${location.search}${location.hash}`}
          >
            <Outlet />
          </PageErrorBoundary>
        </Box>
      </Box>
    </Box>
  );
}

class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean }
> {
  public state = { hasError: false };

  public static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  public componentDidUpdate(previousProps: Readonly<{ resetKey: string }>): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Workspace page failed to render.", error, info);
  }

  private retry = (): void => {
    this.setState({ hasError: false });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={this.retry}>
              Try again
            </Button>
          }
        >
          This page could not be displayed. Try again or choose another page.
        </Alert>
      );
    }
    return this.props.children;
  }
}
