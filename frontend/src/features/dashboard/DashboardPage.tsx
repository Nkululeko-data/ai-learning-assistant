import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  MessageCircle,
  Plus,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  listAllMyEnrolments,
  listCourseJoinRequests,
  listAllMyCourses,
  listCourses,
  getCourseLessons,
  type EnrolmentView,
  type JoinRequest,
} from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { getCourseInsights } from "../../api/insights";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { CourseCard, CourseCardSkeleton } from "../courses/CourseCard";
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
  const continueCourse = learnerCourses.find(
    (enrolment) => enrolment.course.status === "active",
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
  const canCreateCourses =
    user?.role === "coach" && user.permissions.includes("course:create");
  const canEditCourses =
    user?.role === "coach" && user.permissions.includes("course:edit");
  const canCreateQuizzes =
    user?.role === "coach" &&
    user.permissions.includes("course:edit") &&
    user.permissions.includes("quiz:create");
  const coachCourseSetupRoute = canCreateCourses
    ? "/my-courses?create=1"
    : "/my-courses";
  const primaryManagedCourse = coachCourses.find(
    (course) => course.status === "active",
  );
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
  const lessonQueries = useQueries({
    queries: canEditCourses
      ? coachOwnedCourses.map((course) => ({
          queryKey: ["courses", "lessons", course.id],
          queryFn: () => getCourseLessons(course.id),
        }))
      : [],
  });
  const lessonLoading =
    courseListIsLoading || lessonQueries.some((query) => query.isPending);
  const lessonError = lessonQueries.find((query) => query.isError)?.error;
  const lessonCount = lessonQueries.reduce(
    (total, query) => total + (query.data?.lessons.length ?? 0),
    0,
  );
  const learnerEnrollmentCount = qualifiedInsights.reduce(
    (total, insight) => total + (insight.distinctLearnerCount ?? 0),
    0,
  );
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
    <Stack spacing={{ xs: 3, md: 4 }}>
      {user?.role === "learner" ? (
        <Paper
          component="section"
          className="learnova-welcome-panel"
          sx={{ p: { xs: 2.5, sm: 3.5, md: 4.5 } }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={3}
          >
            <Stack spacing={1.5} sx={{ position: "relative", zIndex: 1 }}>
              <Typography className="learnova-welcome-eyebrow">
                YOUR LEARNING SPACE
              </Typography>
              <Typography
                component="h1"
                className="learnova-welcome-title"
                variant="h3"
              >
                Welcome back, {user.displayName}
              </Typography>
              <Typography className="learnova-welcome-copy">
                Make room for a new idea today. Your courses, study tools, and AI
                learning companion are ready when you are.
              </Typography>
              <Button
                component={RouterLink}
                to={continueCourse ? `/courses/${continueCourse.courseId}` : "/courses"}
                variant="contained"
                color="secondary"
                endIcon={<ArrowRight size={18} aria-hidden="true" />}
                sx={{
                  alignSelf: "flex-start",
                  mt: 0.5,
                  px: 2.25,
                  bgcolor: "secondary.main",
                  color: "common.white",
                  "&:hover": { bgcolor: "secondary.dark" },
                }}
              >
                {continueCourse ? "Continue learning" : "Explore courses"}
              </Button>
            </Stack>
            <Box className="learnova-welcome-art" aria-hidden="true">
              <Sparkles size={64} strokeWidth={1.25} />
            </Box>
          </Stack>
        </Paper>
      ) : (
        <Paper
          component="section"
          className="learnova-welcome-panel"
          sx={{ p: { xs: 2.5, sm: 3.5, md: 4.5 } }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={3}
          >
            <Stack spacing={1.5} sx={{ position: "relative", zIndex: 1 }}>
              <Typography className="learnova-welcome-eyebrow">
                YOUR TEACHING WORKSPACE
              </Typography>
              <Typography
                component="h1"
                className="learnova-welcome-title"
                variant="h3"
              >
                Welcome, {user?.displayName}
              </Typography>
              <Typography className="learnova-welcome-copy">
                Build thoughtful courses, shape great lessons, and support your learners
                from one focused workspace.
              </Typography>
              <Button
                component={RouterLink}
                to={canCreateCourses ? "/my-courses?create=1" : "/my-courses"}
                variant="contained"
                color="secondary"
                endIcon={<ArrowRight size={18} aria-hidden="true" />}
                sx={{
                  alignSelf: "flex-start",
                  mt: 0.5,
                  px: 2.25,
                  bgcolor: "secondary.main",
                  color: "common.white",
                  "&:hover": { bgcolor: "secondary.dark" },
                }}
              >
                {canCreateCourses ? "Create a course" : "View my courses"}
              </Button>
            </Stack>
            <Box className="learnova-welcome-art" aria-hidden="true">
              <BookOpen size={64} strokeWidth={1.25} />
            </Box>
          </Stack>
        </Paper>
      )}

      {user?.role === "coach" && (
        <>
          <Box component="section" aria-labelledby="coach-dashboard-title">
            <Typography
              id="coach-dashboard-title"
              component="h2"
              variant="h5"
              className="learnova-page-heading learnova-section-heading"
            >
              Your teaching workspace
            </Typography>
            <Grid container spacing={1.5}>
              {canCreateCourses && (
                <QuickAccessCard
                  title="Create a course"
                  description="Start a new learning space for your learners."
                  to="/my-courses?create=1"
                  icon={Plus}
                />
              )}
              {canEditCourses && (
                <QuickAccessCard
                  title="Manage lessons"
                  description={
                    primaryManagedCourse
                      ? `Organize the curriculum for ${primaryManagedCourse.name}.`
                      : "Open your course list to create or reactivate a course before adding lessons."
                  }
                  to={
                    primaryManagedCourse
                      ? `/courses/${primaryManagedCourse.id}#course-lessons-editor`
                      : coachCourseSetupRoute
                  }
                  icon={BookOpen}
                />
              )}
              {canCreateQuizzes && (
                <QuickAccessCard
                  title="Quizzes & assessments"
                  description={
                    primaryManagedCourse
                      ? `Create or review assessments for ${primaryManagedCourse.name}.`
                      : "Open your course list to create or reactivate a course before adding assessments."
                  }
                  to={
                    primaryManagedCourse
                      ? `/courses/${primaryManagedCourse.id}#course-quizzes`
                      : coachCourseSetupRoute
                  }
                  icon={BrainCircuit}
                />
              )}
              {canReviewRequests && primaryManagedCourse && (
                <QuickAccessCard
                  title="Access requests"
                  description="Review learners waiting to join a course."
                  to={`/courses/${primaryManagedCourse.id}#course-join-requests`}
                  icon={UsersRound}
                />
              )}
            </Grid>
          </Box>

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
                  icon={BookOpen}
                  value={
                    courseListIsLoading
                      ? "…"
                      : courseListIsError
                        ? "—"
                        : coachOwnedCourses.length
                  }
                />
              </Grid>
              {canEditCourses && (
                <Grid size={{ xs: 6, md: 3 }}>
                  <OverviewMetric
                    label="Total lessons"
                    icon={BookOpen}
                    value={lessonLoading ? "…" : lessonError ? "—" : lessonCount}
                  />
                </Grid>
              )}
              <Grid size={{ xs: 6, md: 3 }}>
                <OverviewMetric
                  label="Active courses"
                  icon={CheckCircle2}
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
                    icon={ClipboardCheck}
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
                      label="Learner enrollments"
                      value={
                        insightLoading
                          ? "…"
                          : insightError || !insightTotalsAvailable
                            ? "—"
                            : learnerEnrollmentCount
                      }
                      icon={UsersRound}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <OverviewMetric
                      label="Learner questions"
                      icon={MessageCircle}
                      value={insightLoading ? "…" : insightError ? "—" : questionCount}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <OverviewMetric
                      label="Quiz attempts"
                      icon={BrainCircuit}
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
                Learner and activity totals include only courses that meet the privacy
                threshold. Learner enrollments count course-level learner cohorts, so a
                learner enrolled in multiple courses is counted once per course.
              </Typography>
            )}
            {lessonError && (
              <Stack spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
                <ErrorNotice message={friendlyMessage(lessonError)} />
                <Button
                  onClick={() =>
                    void Promise.all(lessonQueries.map((query) => query.refetch()))
                  }
                >
                  Retry lesson totals
                </Button>
              </Stack>
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
                          to={`/courses/${course.id}#course-join-requests`}
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
                  className="learnova-page-heading"
                >
                  Your learning
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  Pick up where you left off or see what is waiting for approval.
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
                <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <OverviewMetric
                      label="Enrolled courses"
                      value={learnerCourses.length}
                      icon={BookOpen}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <OverviewMetric
                      label="Pending requests"
                      value={pendingEnrolments.length}
                      icon={History}
                    />
                  </Grid>
                </Grid>

                {learnerCourses.length > 0 && (
                  <Grid container spacing={2}>
                    {learnerCourses.map((enrolment) => (
                      <Grid key={enrolment.id} size={{ xs: 12, sm: 6, xl: 4 }}>
                        <LearnerCourseCard
                          enrolment={enrolment}
                          canUseStudyTools={user.permissions.includes(
                            "content:generate",
                          )}
                        />
                      </Grid>
                    ))}
                  </Grid>
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

          <Box component="section" aria-labelledby="learner-tools-title">
            <Typography
              id="learner-tools-title"
              component="h2"
              variant="h5"
              fontWeight={700}
              className="learnova-page-heading learnova-section-heading"
            >
              Your study tools
            </Typography>
            <Grid container spacing={1.5}>
              <QuickAccessCard
                title="AI Tutor"
                description="Ask questions about the courses you can access."
                to="/chat"
                icon={MessageCircle}
              />
              <QuickAccessCard
                title="Quizzes"
                description={
                  continueCourse
                    ? `Practice or take a course quiz in ${continueCourse.course.name}.`
                    : "Join a course to access its quizzes."
                }
                to={
                  continueCourse
                    ? `/courses/${continueCourse.courseId}/study?tab=quiz`
                    : "/courses"
                }
                icon={BrainCircuit}
              />
              <QuickAccessCard
                title="Study materials"
                description={
                  continueCourse
                    ? `Open lessons and documents for ${continueCourse.course.name}.`
                    : "Browse courses to find learning materials."
                }
                to={
                  continueCourse
                    ? `/courses/${continueCourse.courseId}/documents`
                    : "/courses"
                }
                icon={FileText}
              />
              <QuickAccessCard
                title="Quiz results"
                description="Review submitted quizzes and your answers."
                to="/quiz-results"
                icon={BrainCircuit}
              />
              <QuickAccessCard
                title="Learning history"
                description="Return to your saved AI Tutor conversations."
                to="/history"
                icon={History}
              />
            </Grid>
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
              <Grid container spacing={1.5}>
                {pendingEnrolments.map((enrolment) => (
                  <Grid key={enrolment.id} size={{ xs: 12, sm: 6 }}>
                    <Paper
                      component="article"
                      variant="outlined"
                      sx={{ p: 2, height: "100%" }}
                    >
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", sm: "center" }}
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
                        <Typography
                          variant="body2"
                          color="warning.dark"
                          fontWeight={700}
                        >
                          Pending
                        </Typography>
                      </Stack>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
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
          <Typography
            id="dashboard-courses-title"
            component="h2"
            variant="h5"
            className="learnova-page-heading"
          >
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
        {courseListIsLoading && (
          <>
            <LinearProgress aria-label="Loading courses" />
            <Grid container spacing={2} aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <Grid key={index} size={{ xs: 12, sm: 6, xl: 4 }}>
                  <CourseCardSkeleton />
                </Grid>
              ))}
            </Grid>
          </>
        )}
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
          <Grid container spacing={2}>
            {dashboardCourses.map((course) => (
              <Grid key={course.id} size={{ xs: 12, sm: 6, xl: 4 }}>
                <CourseCard
                  course={course}
                  lessonCount={
                    user?.role === "coach" && canEditCourses
                      ? lessonQueries.find(
                          (query) => query.data?.courseId === course.id,
                        )?.data?.lessons.length
                      : undefined
                  }
                  actions={
                    user?.role === "coach" &&
                    isCourseView(course) &&
                    course.ownerId === user.id ? (
                      <>
                        {user.permissions.includes("course:edit") &&
                          course.status === "active" && (
                            <Button
                              component={RouterLink}
                              to={`/courses/${course.id}#course-lessons-editor`}
                              size="small"
                            >
                              Manage lessons
                            </Button>
                          )}
                        {user.permissions.includes("quiz:create") &&
                          course.status === "active" && (
                            <Button
                              component={RouterLink}
                              to={`/courses/${course.id}#course-quizzes`}
                              size="small"
                            >
                              Manage quizzes
                            </Button>
                          )}
                        <Button
                          component={RouterLink}
                          to={`/courses/${course.id}/documents`}
                          size="small"
                        >
                          Manage materials
                        </Button>
                      </>
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
              </Grid>
            ))}
          </Grid>
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

function OverviewMetric({
  label,
  value,
  icon: Icon = BookOpen,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
}) {
  return (
    <Paper
      component="dl"
      variant="outlined"
      className="learnova-stat-card"
      sx={{ m: 0 }}
    >
      <Box className="learnova-stat-icon" aria-hidden="true">
        <Icon size={21} />
      </Box>
      <Box>
        <Typography component="dt" color="text.secondary" variant="body2">
          {label}
        </Typography>
        <Typography component="dd" className="learnova-stat-value" sx={{ m: 0 }}>
          {value}
        </Typography>
      </Box>
    </Paper>
  );
}

function QuickAccessCard({
  title,
  description,
  to,
  icon: Icon,
}: {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
}) {
  return (
    <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
      <Box
        component={RouterLink}
        to={to}
        className="learnova-quick-card"
        aria-label={`${title}: ${description}`}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box className="learnova-quick-icon" aria-hidden="true">
            <Icon size={20} />
          </Box>
          <Box>
            <Typography component="h3" fontWeight={700}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          </Box>
        </Stack>
        <ArrowRight size={17} aria-hidden="true" />
      </Box>
    </Grid>
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
