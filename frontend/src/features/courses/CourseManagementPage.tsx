import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createCourse,
  listMyEnrolments,
  listCourses,
  requestCourseJoin,
  updateCourse,
  type CourseView,
} from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { CourseCard } from "./CourseCard";
import { CourseFormDialog, type CourseFormValues } from "./CourseFormDialog";
import { isCourseView } from "./course-utils";

const coursePageSize = 20;
type CourseFilter = "all" | "enrolled" | "pending" | "discover" | "owned" | "archived";

export function CourseManagementPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseView | null>(null);
  const [statusCourse, setStatusCourse] = useState<CourseView | null>(null);
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("all");
  const [searchText, setSearchText] = useState("");

  const coursesQuery = useInfiniteQuery({
    queryKey: ["courses", coursePageSize],
    queryFn: ({ pageParam }) =>
      listCourses({
        limit: coursePageSize,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const enrolmentsQuery = useInfiniteQuery({
    queryKey: ["enrolments", "mine"],
    queryFn: ({ pageParam }) =>
      listMyEnrolments({ limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: user?.role === "learner",
  });

  const requestJoinMutation = useMutation({
    mutationFn: requestCourseJoin,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
        queryClient.invalidateQueries({ queryKey: ["enrolments", "mine"] }),
      ]);
    },
  });
  const createMutation = useMutation({
    mutationFn: createCourse,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      courseId,
      version,
      status,
      values,
    }: {
      courseId: string;
      version: number;
      status?: "active" | "archived";
      values?: Partial<CourseFormValues>;
    }) => {
      const input = {
        version,
        ...(status ? { status } : {}),
        ...(values ? { name: values.name, description: values.description } : {}),
      };
      return updateCourse(courseId, input);
    },
    onSuccess: () => {
      setEditingCourse(null);
      setStatusCourse(null);
      return queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });

  const courses = coursesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const enrolments = enrolmentsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const enrolmentByCourse = new Map(
    enrolments.map((enrolment) => [enrolment.courseId, enrolment]),
  );
  const canCreate =
    user?.role === "coach" && user.permissions.includes("course:create");
  const canEdit = user?.role === "coach" && user.permissions.includes("course:edit");
  const canArchive =
    user?.role === "coach" && user.permissions.includes("course:archive");
  const canAdministerCourses =
    user?.role === "admin" && user.permissions.includes("user:manage");
  const ownedCourses = courses.filter(
    (course) => isCourseView(course) && course.ownerId === user?.id,
  );
  const enrolledCourseCount = courses.filter(isCourseView).length;
  const pendingRequestCount = enrolments.filter(
    (enrolment) => enrolment.status === "pending",
  ).length;
  const courseCountLabel = coursesQuery.isLoading
    ? "Loading courses"
    : coursesQuery.isError
      ? "Courses unavailable"
      : `${courses.length} shown`;
  const filterOptions: Array<{ value: CourseFilter; label: string }> =
    user?.role === "learner"
      ? [
          { value: "all", label: "All courses" },
          { value: "enrolled", label: "My learning" },
          { value: "pending", label: "Pending requests" },
          { value: "discover", label: "Discover" },
        ]
      : user?.role === "coach"
        ? [
            { value: "all", label: "All courses" },
            { value: "owned", label: "My courses" },
            { value: "archived", label: "Archived" },
          ]
        : [{ value: "all", label: "All courses" }];
  const activeCourseFilter = filterOptions.some(
    (option) => option.value === courseFilter,
  )
    ? courseFilter
    : "all";
  const normalizedSearch = searchText.trim().toLowerCase();
  const visibleCourses = courses.filter((course) => {
    const enrolment = enrolmentByCourse.get(course.id);
    const matchesFilter =
      activeCourseFilter === "all" ||
      (activeCourseFilter === "enrolled" &&
        (enrolment?.status === "approved" || isCourseView(course))) ||
      (activeCourseFilter === "pending" && enrolment?.status === "pending") ||
      (activeCourseFilter === "discover" &&
        enrolment?.status !== "approved" &&
        enrolment?.status !== "pending" &&
        !isCourseView(course)) ||
      (activeCourseFilter === "owned" &&
        isCourseView(course) &&
        course.ownerId === user?.id) ||
      (activeCourseFilter === "archived" &&
        isCourseView(course) &&
        course.status === "archived");
    const searchableText = `${course.name} ${course.description ?? ""}`.toLowerCase();
    return matchesFilter && searchableText.includes(normalizedSearch);
  });
  const actionError =
    createMutation.error ?? updateMutation.error ?? requestJoinMutation.error;

  async function saveCourse(values: CourseFormValues) {
    if (editingCourse) {
      const hasNameChange = values.name !== editingCourse.name;
      const hasDescriptionChange =
        values.description !== (editingCourse.description ?? "");
      await updateMutation.mutateAsync({
        courseId: editingCourse.id,
        version: editingCourse.version,
        values: {
          ...(hasNameChange ? { name: values.name } : {}),
          ...(hasDescriptionChange ? { description: values.description } : {}),
        },
      });
      return;
    }
    await createMutation.mutateAsync({
      name: values.name,
      ...(values.description ? { description: values.description } : {}),
    });
    setCreateOpen(false);
  }

  function canManageCourse(course: CourseView) {
    return user?.role === "coach" && course.ownerId === user.id;
  }

  function courseActions(course: CourseView) {
    if (!canManageCourse(course)) {
      return undefined;
    }
    return (
      <>
        {canEdit && course.status === "active" && (
          <Button
            size="small"
            onClick={() => setEditingCourse(course)}
            aria-label={`Edit ${course.name}`}
          >
            Edit
          </Button>
        )}
        {canArchive && (
          <Button
            size="small"
            color={course.status === "active" ? "error" : "primary"}
            onClick={() => setStatusCourse(course)}
            aria-label={
              course.status === "active"
                ? `Archive ${course.name}`
                : `Reactivate ${course.name}`
            }
          >
            {course.status === "active" ? "Archive" : "Reactivate"}
          </Button>
        )}
      </>
    );
  }

  return (
    <Stack spacing={3}>
      <Paper
        sx={{
          overflow: "hidden",
          borderRadius: 3,
          color: "common.white",
          background: (theme) =>
            `linear-gradient(120deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main} 70%, ${theme.palette.secondary.dark})`,
        }}
      >
        <Box sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
          >
            <Box>
              <Typography
                variant="overline"
                sx={{ color: "rgba(255,255,255,0.75)", letterSpacing: 1.2 }}
              >
                COURSE WORKSPACE
              </Typography>
              <Typography component="h1" variant="h3" fontWeight={750}>
                {user?.role === "learner"
                  ? "Find your next course"
                  : user?.role === "coach"
                    ? "Your courses"
                    : "Course catalog"}
              </Typography>
              <Typography
                sx={{ mt: 1, maxWidth: 680, color: "rgba(255,255,255,0.82)" }}
              >
                {user?.role === "admin"
                  ? "Browse course listings. Course settings and content stay with their owners."
                  : user?.role === "learner"
                    ? "Explore topics, request access, and return to courses you have joined."
                    : "Create courses, manage your curriculum, and keep teaching materials organized."}
              </Typography>
            </Box>
            {canCreate && (
              <Button
                variant="contained"
                color="secondary"
                onClick={() => setCreateOpen(true)}
                sx={{ flexShrink: 0 }}
              >
                Create course
              </Button>
            )}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 2.5 }}
          >
            <Chip
              label={courseCountLabel}
              sx={{ color: "common.white", bgcolor: "rgba(255,255,255,0.14)" }}
            />
            {user?.role === "learner" && (
              <>
                <Chip
                  label={
                    coursesQuery.isLoading
                      ? "Checking your learning"
                      : `${enrolledCourseCount} in your learning`
                  }
                  sx={{ color: "common.white", bgcolor: "rgba(255,255,255,0.14)" }}
                />
                <Chip
                  label={
                    enrolmentsQuery.isLoading
                      ? "Checking requests"
                      : `${pendingRequestCount} pending requests`
                  }
                  sx={{ color: "common.white", bgcolor: "rgba(255,255,255,0.14)" }}
                />
              </>
            )}
            {user?.role === "coach" && (
              <Chip
                label={`${ownedCourses.length} owned by you`}
                sx={{ color: "common.white", bgcolor: "rgba(255,255,255,0.14)" }}
              />
            )}
          </Stack>
        </Box>
      </Paper>

      {canAdministerCourses && (
        <Alert severity="info">
          This catalog is read-only for administrators. Course owners manage course
          settings and learning content.
        </Alert>
      )}
      {actionError && <ErrorNotice message={friendlyMessage(actionError)} />}
      {user?.role === "learner" && enrolmentsQuery.isError && (
        <ErrorNotice message={friendlyMessage(enrolmentsQuery.error)} />
      )}
      {coursesQuery.isLoading && <LinearProgress aria-label="Loading courses" />}
      {coursesQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(coursesQuery.error)} />
          <Button onClick={() => void coursesQuery.refetch()}>Try again</Button>
        </Stack>
      )}
      {!coursesQuery.isLoading && !coursesQuery.isError && courses.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
          <Stack spacing={1.5} alignItems="flex-start">
            <Typography component="h2" variant="h5" fontWeight={700}>
              {canCreate ? "Your course space is ready" : "No courses are available"}
            </Typography>
            <Typography color="text.secondary">
              {canCreate
                ? "Create your first course to start organizing lessons and learning materials."
                : "There are no courses to display right now. Try again later."}
            </Typography>
            {canCreate && (
              <Button variant="contained" onClick={() => setCreateOpen(true)}>
                Create your first course
              </Button>
            )}
          </Stack>
        </Paper>
      )}
      {courses.length > 0 && (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "stretch", sm: "center" }}
                spacing={1}
              >
                <TextField
                  type="search"
                  label="Search courses"
                  placeholder="Search by title or description"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  size="small"
                  sx={{ width: { xs: "100%", sm: 360 } }}
                />
                <Typography variant="body2" color="text.secondary">
                  Showing {visibleCourses.length} of {courses.length} loaded courses
                </Typography>
              </Stack>
              <Tabs
                value={activeCourseFilter}
                onChange={(_, value: CourseFilter) => setCourseFilter(value)}
                variant="scrollable"
                allowScrollButtonsMobile
                aria-label="Filter courses"
                sx={{
                  minHeight: 42,
                  "& .MuiTab-root": { minHeight: 42, textTransform: "none" },
                }}
              >
                {filterOptions.map((option) => (
                  <Tab key={option.value} value={option.value} label={option.label} />
                ))}
              </Tabs>
            </Stack>
          </Paper>

          {visibleCourses.length > 0 ? (
            <Grid container spacing={2}>
              {visibleCourses.map((course) => {
                const enrolment = enrolmentByCourse.get(course.id);
                const learnerActions =
                  user?.role === "learner" && !isCourseView(course) ? (
                    enrolment?.status === "pending" ? (
                      <Chip label="Request pending" size="small" />
                    ) : (
                      <Button
                        size="small"
                        disabled={
                          enrolmentsQuery.isLoading ||
                          enrolmentsQuery.isError ||
                          requestJoinMutation.isPending
                        }
                        onClick={() => requestJoinMutation.mutate(course.id)}
                      >
                        {enrolment?.status === "rejected" ||
                        enrolment?.status === "removed"
                          ? "Request again"
                          : "Request to join"}
                      </Button>
                    )
                  ) : undefined;
                return (
                  <Grid key={course.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                    <CourseCard
                      course={course}
                      actions={
                        isCourseView(course) ? courseActions(course) : learnerActions
                      }
                    />
                  </Grid>
                );
              })}
            </Grid>
          ) : (
            <Alert
              severity="info"
              action={
                <Button
                  color="inherit"
                  onClick={() => {
                    setSearchText("");
                    setCourseFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              No courses match this search and filter.
            </Alert>
          )}
        </Stack>
      )}
      {coursesQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void coursesQuery.fetchNextPage()}
          disabled={coursesQuery.isFetchingNextPage}
        >
          {coursesQuery.isFetchingNextPage ? "Loading..." : "Load more courses"}
        </Button>
      )}
      {coursesQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(coursesQuery.error)} />
      )}

      {(createOpen || editingCourse !== null) && (
        <CourseFormDialog
          key={editingCourse?.id ?? "new-course"}
          open
          course={editingCourse ?? undefined}
          onClose={() => {
            setCreateOpen(false);
            setEditingCourse(null);
          }}
          onSave={saveCourse}
        />
      )}

      <Dialog
        open={statusCourse !== null}
        onClose={() => setStatusCourse(null)}
        aria-labelledby="course-status-title"
      >
        <DialogTitle id="course-status-title">
          {statusCourse?.status === "active" ? "Archive course?" : "Reactivate course?"}
        </DialogTitle>
        <DialogContent>
          {updateMutation.error && (
            <Box sx={{ mb: 2 }}>
              <ErrorNotice message={friendlyMessage(updateMutation.error)} />
            </Box>
          )}
          {statusCourse?.status === "active"
            ? `“${statusCourse.name}” will no longer accept new enrolment requests.`
            : `“${statusCourse?.name}” will become active again.`}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusCourse(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={statusCourse?.status === "active" ? "error" : "primary"}
            disabled={updateMutation.isPending}
            onClick={() => {
              if (!statusCourse) return;
              updateMutation.mutate({
                courseId: statusCourse.id,
                version: statusCourse.version,
                status: statusCourse.status === "active" ? "archived" : "active",
              });
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
