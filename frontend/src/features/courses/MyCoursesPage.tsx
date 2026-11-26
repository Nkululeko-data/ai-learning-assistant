import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  LinearProgress,
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
import { CourseCard, CourseCardSkeleton } from "./CourseCard";

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
        <Typography
          component="h1"
          variant="h4"
          fontWeight={700}
          className="learnova-page-heading"
        >
          My courses
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Track approved courses and requests waiting for a decision.
        </Typography>
      </Box>
      {enrolmentsQuery.isLoading && (
        <LinearProgress aria-label="Loading your courses" />
      )}
      {enrolmentsQuery.isLoading && (
        <Grid container spacing={2} aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <Grid key={index} size={{ xs: 12, sm: 6, xl: 4 }}>
              <CourseCardSkeleton />
            </Grid>
          ))}
        </Grid>
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
      <Grid container spacing={2}>
        {enrolments.map((enrolment) => (
          <Grid key={enrolment.id} size={{ xs: 12, sm: 6, xl: 4 }}>
            <CourseCard
              course={enrolment.course}
              showViewAction={false}
              actions={
                <Stack spacing={1} width="100%">
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
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
                        variant="contained"
                      >
                        Open course
                      </Button>
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
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
                    <Typography variant="body2" color="text.secondary">
                      Coach note: {enrolment.decisionNote}
                    </Typography>
                  )}
                </Stack>
              }
            />
          </Grid>
        ))}
      </Grid>
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
