import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { listMyEnrolments } from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { CourseManagementPage } from "./CourseManagementPage";

const pageSize = 20;

export function MyCoursesPage() {
  const { user } = useAuth();

  if (user?.role === "coach") {
    return <CourseManagementPage defaultFilter="owned" pageTitle="My courses" />;
  }
  if (user?.role !== "learner") {
    return (
      <Alert severity="error">This page is available to learners and coaches.</Alert>
    );
  }

  return <LearnerCourses />;
}

function LearnerCourses() {
  const enrolmentsQuery = useInfiniteQuery({
    queryKey: ["enrolments", "mine"],
    queryFn: ({ pageParam }) =>
      listMyEnrolments({
        limit: pageSize,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const enrolments = enrolmentsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          My courses
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Track approved courses and requests waiting for a decision.
        </Typography>
      </Box>
      {enrolmentsQuery.isLoading && (
        <LinearProgress aria-label="Loading your courses" />
      )}
      {enrolmentsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(enrolmentsQuery.error)} />
          <Button onClick={() => void enrolmentsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {!enrolmentsQuery.isLoading &&
        !enrolmentsQuery.isError &&
        enrolments.length === 0 && (
          <Alert
            severity="info"
            action={
              <Button component={RouterLink} to="/courses" color="inherit">
                Browse courses
              </Button>
            }
          >
            You have not requested access to a course yet.
          </Alert>
        )}
      {enrolments.map((enrolment) => (
        <Paper
          component="article"
          key={enrolment.id}
          variant="outlined"
          sx={{ p: { xs: 2, sm: 2.5 } }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1.5}
          >
            <Box>
              <Typography component="h2" variant="h6" fontWeight={650}>
                {enrolment.course.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {enrolment.status === "approved"
                  ? enrolment.course.status === "archived"
                    ? "You have access to this archived course."
                    : "You are enrolled in this course."
                  : enrolment.status === "pending"
                    ? "Your request is waiting for the coach."
                    : enrolment.status === "rejected"
                      ? "Your request was not approved."
                      : "Your access to this course was removed."}
              </Typography>
              {enrolment.decisionNote && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Coach note: {enrolment.decisionNote}
                </Typography>
              )}
            </Box>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
            >
              <Chip
                size="small"
                label={
                  enrolment.status === "approved"
                    ? "Approved"
                    : enrolment.status === "pending"
                      ? "Pending"
                      : enrolment.status === "rejected"
                        ? "Not approved"
                        : "Removed"
                }
                color={
                  enrolment.status === "approved"
                    ? "success"
                    : enrolment.status === "pending"
                      ? "warning"
                      : "default"
                }
              />
              {enrolment.status === "approved" && (
                <Button
                  component={RouterLink}
                  to={`/courses/${enrolment.courseId}`}
                  variant="outlined"
                >
                  Open course
                </Button>
              )}
            </Stack>
          </Stack>
        </Paper>
      ))}
      {enrolmentsQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(enrolmentsQuery.error)} />
      )}
      {enrolmentsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void enrolmentsQuery.fetchNextPage()}
          disabled={enrolmentsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {enrolmentsQuery.isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}
    </Stack>
  );
}
