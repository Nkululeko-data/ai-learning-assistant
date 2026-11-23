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
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  listAllMyEnrolments,
  listCourseJoinRequests,
  listAllMyCourses,
  listCourses,
  type EnrolmentView,
  type JoinRequest,
} from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { getCourseInsights } from "../../api/insights";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { CourseCard } from "../courses/CourseCard";
import { isCourseView } from "../courses/course-utils";

const dashboardCoursePageSize = 6;

export function DashboardPage() {
  const { user } = useAuth();
  const coursesQuery = useInfiniteQuery({
    queryKey: ["courses", dashboardCoursePageSize],
    queryFn: ({ pageParam }) =>
      listCourses({
        limit: dashboardCoursePageSize,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: user?.role === "learner",
  });
  const learnerEnrolmentsQuery = useQuery({
    queryKey: ["enrolments", "mine", "dashboard"],
    queryFn: listAllMyEnrolments,
    enabled: user?.role === "learner",
  });
  const myCoursesQuery = useQuery({
    queryKey: ["courses", "mine"],
    queryFn: listAllMyCourses,
    enabled: user?.role === "coach",
  });
  const coachCourses = user?.role === "coach" ? (myCoursesQuery.data ?? []) : [];
  const learnerEnrolments = learnerEnrolmentsQuery.data ?? [];
  const learnerCourses = learnerEnrolments.filter(
    (enrolment) => enrolment.status === "approved",
  );
  const pendingEnrolments = learnerEnrolments.filter(
    (enrolment) => enrolment.status === "pending",
  );
  const learnerCourseIds = new Set(
    learnerEnrolments
      .filter(
        (enrolment) =>
          enrolment.status === "approved" || enrolment.status === "pending",
      )
      .map((enrolment) => enrolment.courseId),
  );
  const courses =
    user?.role === "coach"
      ? coachCourses
      : (coursesQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const dashboardCourses =
    user?.role === "coach"
      ? [...coachCourses]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, 6)
      : courses.filter((course) => !learnerCourseIds.has(course.id));
  const coachOwnedCourses = coachCourses;
  const courseListIsLoading =
    user?.role === "coach" ? myCoursesQuery.isLoading : coursesQuery.isLoading;
  const courseListIsError =
    user?.role === "coach" ? myCoursesQuery.isError : coursesQuery.isError;
  const courseListError =
    user?.role === "coach" ? myCoursesQuery.error : coursesQuery.error;
  const refetchCourseList = () =>
    user?.role === "coach" ? myCoursesQuery.refetch() : coursesQuery.refetch();
  const canReviewRequests =
    user?.role === "coach" && user.permissions.includes("enrolment:approve");
  const canViewInsights =
    user?.role === "coach" && user.permissions.includes("insights:view");
  const pendingRequestQueries = useQueries({
    queries: canReviewRequests
      ? coachOwnedCourses
          .filter((course) => course.status === "active")
          .map((course) => ({
            queryKey: ["enrolments", "dashboard", course.id, "pending"],
            queryFn: () =>
              listCourseJoinRequests(course.id, { limit: 5, status: "pending" }),
          }))
      : [],
  });
  const insightQueries = useQueries({
    queries: canViewInsights
      ? coachOwnedCourses.map((course) => ({
          queryKey: ["insights", "dashboard", course.id],
          queryFn: () => getCourseInsights(course.id),
        }))
      : [],
  });
  const pendingRequests = pendingRequestQueries.flatMap((query, index) =>
    (query.data?.items ?? []).map((request) => ({
      request,
      course: coachOwnedCourses.filter((course) => course.status === "active")[index],
    })),
  );
  const recentPendingRequests = pendingRequests
    .filter(
      (
        item,
      ): item is {
        request: JoinRequest;
        course: (typeof coachOwnedCourses)[number];
      } => item.course !== undefined,
    )
    .sort(
      (left, right) =>
        Date.parse(right.request.requestedAt) - Date.parse(left.request.requestedAt),
    )
    .slice(0, 5);
  const pendingRequestsHaveMore = pendingRequestQueries.some(
    (query) => query.data?.nextCursor !== undefined,
  );
  const pendingRequestCount =
    pendingRequests.length === 0
      ? "0"
      : `${pendingRequests.length}${pendingRequestsHaveMore ? "+" : ""}`;
  const pendingRequestLoading =
    courseListIsLoading || pendingRequestQueries.some((query) => query.isPending);
  const pendingRequestError = pendingRequestQueries.find(
    (query) => query.isError,
  )?.error;
  const qualifiedInsights = insightQueries.flatMap((query) =>
    query.data?.cohortQualified ? [query.data] : [],
  );
  const insightLoading = insightQueries.some((query) => query.isPending);
  const insightError = insightQueries.find((query) => query.isError)?.error;
  const insightTotalsAvailable =
    canViewInsights && !insightLoading && !insightError && qualifiedInsights.length > 0;
  const questionCount = insightTotalsAvailable
    ? qualifiedInsights.reduce(
        (total, insight) => total + (insight.questionCount ?? 0),
        0,
      )
    : "—";
  const quizAttemptCount = insightTotalsAvailable
    ? qualifiedInsights.reduce(
        (total, insight) => total + (insight.quizAttemptCount ?? 0),
        0,
      )
    : "—";
  return (
    <Stack spacing={4}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          {user?.role === "coach" ? "Coach dashboard" : `Welcome, ${user?.displayName}`}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {user?.role === "coach"
            ? "Your course health, learner requests, and teaching resources at a glance."
            : "Your courses and learning workspace."}
        </Typography>
      </Box>

      {user?.role === "coach" && (
        <>
          <Box component="section" aria-labelledby="coach-overview-title">
            <Typography
              id="coach-overview-title"
              component="h2"
              variant="h5"
              sx={{ mb: 2 }}
            >
              At a glance
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, md: 3 }}>
                <OverviewMetric
                  label="My courses"
                  value={
                    courseListIsLoading
                      ? "…"
                      : courseListIsError
                        ? "—"
                        : coachOwnedCourses.length
                  }
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <OverviewMetric
                  label="Active courses"
                  value={
                    courseListIsLoading
                      ? "…"
                      : courseListIsError
                        ? "—"
                        : coachOwnedCourses.filter(
                            (course) => course.status === "active",
                          ).length
                  }
                />
              </Grid>
              {canReviewRequests && (
                <Grid size={{ xs: 6, md: 3 }}>
                  <OverviewMetric
                    label="Pending requests"
                    value={
                      courseListIsLoading || pendingRequestLoading
                        ? "…"
                        : courseListIsError || pendingRequestError
                          ? "—"
                          : pendingRequestCount
                    }
                  />
                </Grid>
              )}
              {canViewInsights && (
                <>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <OverviewMetric
                      label="Learner questions"
                      value={insightLoading ? "…" : insightError ? "—" : questionCount}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <OverviewMetric
                      label="Quiz attempts"
                      value={
                        insightLoading ? "…" : insightError ? "—" : quizAttemptCount
                      }
                    />
                  </Grid>
                </>
              )}
            </Grid>

            {canViewInsights && (
              <Typography variant="body2" color="text.secondary">
                Activity totals include only courses that meet the privacy threshold.
              </Typography>
            )}
          </Box>

          {canReviewRequests && (
            <Box component="section" aria-labelledby="coach-attention-title">
              <Typography
                id="coach-attention-title"
                component="h2"
                variant="h5"
                sx={{ mb: 2 }}
              >
                Needs your attention
              </Typography>
              {pendingRequestError && (
                <Stack spacing={1} alignItems="flex-start">
                  <ErrorNotice message={friendlyMessage(pendingRequestError)} />
                  <Button
                    onClick={() =>
                      void Promise.all(
                        pendingRequestQueries.map((query) => query.refetch()),
                      )
                    }
                  >
                    Retry requests
                  </Button>
                </Stack>
              )}
              {pendingRequestLoading && (
                <LinearProgress aria-label="Loading pending requests" />
              )}
              {!pendingRequestLoading &&
                !courseListIsLoading &&
                !courseListIsError &&
                !pendingRequestError &&
                recentPendingRequests.length === 0 && (
                  <Alert severity="success">
                    No pending learner requests. Your courses are up to date.
                  </Alert>
                )}
              {recentPendingRequests.length > 0 && (
                <Stack spacing={0}>
                  {recentPendingRequests.map(({ request, course }) => (
                    <Box
                      key={request.id}
                      component="article"
                      sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
                    >
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", sm: "center" }}
                      >
                        <Box>
                          <Typography fontWeight={650}>
                            {request.applicant.displayName}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Requested access to {course.name} ·{" "}
                            {new Date(request.requestedAt).toLocaleDateString()}
                          </Typography>
                        </Box>
                        <Button
                          component={RouterLink}
                          to={`/courses/${course.id}#enrolment-requests-title`}
                          size="small"
                        >
                          Review request
                        </Button>
                      </Stack>
                    </Box>
                  ))}
                  {pendingRequestsHaveMore && (
                    <Typography variant="body2" color="text.secondary">
                      More requests are waiting in your courses. Open a course to review
                      its full queue.
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>
          )}

          {canViewInsights && insightError && (
            <Stack spacing={1} alignItems="flex-start">
              <ErrorNotice message={friendlyMessage(insightError)} />
              <Button
                onClick={() =>
                  void Promise.all(insightQueries.map((query) => query.refetch()))
                }
              >
                Retry course activity
              </Button>
            </Stack>
          )}
        </>
      )}

      {user?.role === "learner" && (
        <Stack spacing={3}>
          <Box component="section" aria-labelledby="learner-overview-title">
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={1.5}
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography
                  id="learner-overview-title"
                  component="h2"
                  variant="h5"
                  fontWeight={700}
                >
                  Your learning
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  Open an enrolled course or check on a pending access request.
                </Typography>
              </Box>
              <Button
                component={RouterLink}
                to="/courses"
                variant="contained"
                sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}
              >
                Browse courses
              </Button>
            </Stack>

            {learnerEnrolmentsQuery.isLoading && (
              <LinearProgress aria-label="Loading your course enrolments" />
            )}
            {learnerEnrolmentsQuery.isError && (
              <Stack spacing={1} alignItems="flex-start">
                <ErrorNotice message={friendlyMessage(learnerEnrolmentsQuery.error)} />
                <Button onClick={() => void learnerEnrolmentsQuery.refetch()}>
                  Retry course access
                </Button>
              </Stack>
            )}
            {learnerEnrolmentsQuery.isSuccess && (
              <>
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <OverviewMetric
                      label="Enrolled courses"
                      value={learnerCourses.length}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <OverviewMetric
                      label="Pending requests"
                      value={pendingEnrolments.length}
                    />
                  </Grid>
                </Grid>

                {learnerCourses.length > 0 && (
                  <Stack spacing={0}>
                    {learnerCourses.map((enrolment) => (
                      <LearnerCourseCard
                        key={enrolment.id}
                        enrolment={enrolment}
                        canUseStudyTools={user.permissions.includes("content:generate")}
                      />
                    ))}
                  </Stack>
                )}
                {learnerCourses.length === 0 && pendingEnrolments.length === 0 && (
                  <Alert severity="info" role="status">
                    You have not joined a course yet. Browse the catalog to find a
                    course to study.
                  </Alert>
                )}
              </>
            )}
          </Box>

          {pendingEnrolments.length > 0 && (
            <Box component="section" aria-labelledby="pending-enrolments-title">
              <Typography
                id="pending-enrolments-title"
                component="h2"
                variant="h6"
                fontWeight={700}
                sx={{ mb: 1.5 }}
              >
                Waiting for access
              </Typography>
              <Stack spacing={0}>
                {pendingEnrolments.map((enrolment) => (
                  <Box
                    key={enrolment.id}
                    component="article"
                    sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="flex-start"
                      spacing={1}
                    >
                      <Box>
                        <Typography fontWeight={650}>
                          {enrolment.course.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Requested{" "}
                          {new Date(enrolment.requestedAt).toLocaleDateString()}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="warning.dark" fontWeight={700}>
                        Pending
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      )}

      <Box component="section" aria-labelledby="dashboard-courses-title">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={1}
          sx={{ mb: 2 }}
        >
          <Typography id="dashboard-courses-title" component="h2" variant="h5">
            {user?.role === "coach" ? "My courses" : "Explore courses"}
          </Typography>
          <Button
            component={RouterLink}
            to={user?.role === "coach" ? "/my-courses" : "/courses"}
            variant="outlined"
          >
            {user?.role === "coach" ? "View my courses" : "View all courses"}
          </Button>
        </Stack>
        {courseListIsLoading && <LinearProgress aria-label="Loading courses" />}
        {courseListIsError && (
          <Stack spacing={1} alignItems="flex-start">
            <ErrorNotice message={friendlyMessage(courseListError)} />
            <Button onClick={() => void refetchCourseList()}>Try again</Button>
          </Stack>
        )}
        {!courseListIsLoading &&
          !courseListIsError &&
          dashboardCourses.length === 0 && (
            <Alert severity="info" role="status">
              {user?.role === "coach"
                ? "You do not own any courses yet. Create a course to start building your learning workspace."
                : "You are up to date. No additional courses are available right now."}
            </Alert>
          )}
        {dashboardCourses.length > 0 && (
          <Stack spacing={0}>
            {dashboardCourses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                actions={
                  user?.role === "coach" &&
                  isCourseView(course) &&
                  course.ownerId === user.id ? (
                    <Button
                      component={RouterLink}
                      to={`/courses/${course.id}/documents`}
                      size="small"
                    >
                      Manage materials
                    </Button>
                  ) : user?.role === "learner" &&
                    isCourseView(course) &&
                    course.status === "active" &&
                    user.permissions.includes("content:generate") ? (
                    <Button
                      component={RouterLink}
                      to={`/courses/${course.id}/study`}
                      size="small"
                    >
                      Study tools
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </Stack>
        )}
        {user?.role === "learner" && coursesQuery.hasNextPage && (
          <Button
            sx={{ mt: 2 }}
            onClick={() => void coursesQuery.fetchNextPage()}
            disabled={coursesQuery.isFetchingNextPage}
          >
            {coursesQuery.isFetchingNextPage ? "Loading..." : "Load more courses"}
          </Button>
        )}
        {user?.role === "learner" && coursesQuery.isFetchNextPageError && (
          <Stack spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
            <ErrorNotice message={friendlyMessage(coursesQuery.error)} />
            <Button
              onClick={() => void coursesQuery.fetchNextPage()}
              disabled={coursesQuery.isFetchingNextPage}
            >
              Retry loading courses
            </Button>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <Box component="dl" sx={{ m: 0 }}>
      <Typography component="dt" color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography component="dd" variant="body1" fontWeight={700} sx={{ m: 0 }}>
        {value}
      </Typography>
    </Box>
  );
}

function LearnerCourseCard({
  enrolment,
  canUseStudyTools,
}: {
  enrolment: EnrolmentView;
  canUseStudyTools: boolean;
}) {
  const { course } = enrolment;
  return (
    <CourseCard
      course={course}
      actions={
        <>
          <Chip
            size="small"
            color={course.status === "active" ? "success" : "default"}
            label={course.status === "active" ? "Enrolled" : "Archived"}
          />
          {course.status === "active" && canUseStudyTools && (
            <Button
              component={RouterLink}
              to={`/courses/${course.id}/study`}
              size="small"
            >
              Study tools
            </Button>
          )}
        </>
      }
    />
  );
}
