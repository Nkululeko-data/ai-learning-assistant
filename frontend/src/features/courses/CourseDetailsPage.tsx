import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";
import { getCourse } from "../../api/courses";
import { getCourseInsights, getGapReport, refreshGapReport } from "../../api/insights";
import { getJob } from "../../api/jobs";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { isCourseView } from "./course-utils";
import { CourseCurriculum } from "./CourseCurriculum";
import { CourseLessonsEditor } from "./CourseLessonsEditor";
import { CoachQuizzesPanel } from "./CoachQuizzesPanel";
import { EnrolmentRequestsPanel } from "./EnrolmentRequestsPanel";

export function CourseDetailsPage() {
  const { courseId = "" } = useParams();
  const { hash } = useLocation();
  const courseQuery = useQuery({
    queryKey: ["courses", "detail", courseId],
    queryFn: () => getCourse(courseId),
    enabled: Boolean(courseId),
  });
  const { user } = useAuth();

  useEffect(() => {
    if (!hash || !courseQuery.data) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [courseQuery.data, hash]);

  if (!courseId) {
    return <ErrorNotice message="A course ID is required." />;
  }
  if (courseQuery.isLoading) {
    return <LinearProgress aria-label="Loading course" />;
  }
  if (courseQuery.isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(courseQuery.error)} />
        <Button onClick={() => void courseQuery.refetch()}>Try again</Button>
      </Stack>
    );
  }
  if (!courseQuery.data) {
    return <Alert severity="info">Course details are unavailable.</Alert>;
  }

  const course = courseQuery.data;
  const ownedCourse =
    isCourseView(course) && user?.role === "coach" && course.ownerId === user.id;
  const canViewInsights = ownedCourse && user?.permissions.includes("insights:view");
  const canUseStudyTools =
    isCourseView(course) &&
    course.status === "active" &&
    user?.role === "learner" &&
    user.permissions.includes("content:generate");
  const canEditLessons =
    ownedCourse &&
    isCourseView(course) &&
    course.status === "active" &&
    user?.permissions.includes("course:edit");
  const canManageQuizzes =
    canEditLessons && user?.permissions.includes("quiz:create");

  if (user?.role === "learner") {
    return (
      <CourseCurriculum
        course={course}
        hasCourseAccess={isCourseView(course)}
        canUseStudyTools={Boolean(canUseStudyTools)}
      />
    );
  }

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/courses" sx={{ alignSelf: "flex-start" }}>
        Back to courses
      </Button>
      <Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1.5}
        >
          <Typography component="h1" variant="h4" fontWeight={700}>
            {course.name}
          </Typography>
          {isCourseView(course) && (
            <Chip
              label={course.status === "active" ? "Active" : "Archived"}
              color={course.status === "active" ? "success" : "default"}
              size="small"
            />
          )}
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
          {course.description || "No description provided."}
        </Typography>
        {isCourseView(course) && (
          <Button
            component={RouterLink}
            to={`/courses/${course.id}/documents`}
            variant="outlined"
            sx={{ mt: 2 }}
          >
            Document library
          </Button>
        )}
        {canUseStudyTools && (
          <Button
            component={RouterLink}
            to={`/courses/${course.id}/study`}
            variant="contained"
            sx={{ mt: 2, ml: { sm: 1 } }}
          >
            Study tools
          </Button>
        )}
        {canEditLessons && (
          <Button
            href="#course-lessons-editor"
            variant="outlined"
            sx={{ mt: 2, ml: { sm: 1 } }}
          >
            Manage lessons
          </Button>
        )}
        {canManageQuizzes && (
          <Button
            href="#course-quizzes"
            variant="outlined"
            sx={{ mt: 2, ml: { sm: 1 } }}
          >
            Manage quizzes
          </Button>
        )}
      </Box>
      {canEditLessons && isCourseView(course) && (
        <CourseLessonsEditor courseId={course.id} />
      )}
      {canManageQuizzes && isCourseView(course) && (
        <CoachQuizzesPanel
          courseId={course.id}
          canGenerate={Boolean(user?.permissions.includes("content:generate"))}
        />
      )}
      {canViewInsights && isCourseView(course) && (
        <CourseInsightsPanel courseId={course.id} />
      )}
      {ownedCourse &&
        user?.permissions.includes("enrolment:approve") &&
        isCourseView(course) && (
          <EnrolmentRequestsPanel
            courseId={course.id}
            active={course.status === "active"}
          />
        )}
    </Stack>
  );
}

function CourseInsightsPanel({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollDeadline, setPollDeadline] = useState<number | null>(null);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const insightsQuery = useQuery({
    queryKey: ["insights", courseId],
    queryFn: () => getCourseInsights(courseId),
  });
  const gapReportQuery = useQuery({
    queryKey: ["gap-report", courseId],
    queryFn: () => getGapReport(courseId),
  });
  const refreshMutation = useMutation({
    mutationFn: () => refreshGapReport(courseId),
    onSuccess: (result) => {
      setJobId(result.jobId);
      setPollDeadline(Date.now() + 120_000);
      setPollingTimedOut(false);
    },
  });
  const jobQuery = useQuery({
    queryKey: ["jobs", jobId],
    queryFn: () => getJob(jobId ?? ""),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && ["done", "failed", "dead"].includes(status)) {
        return false;
      }
      if (pollDeadline !== null && Date.now() >= pollDeadline) {
        return false;
      }
      return 2_000;
    },
  });
  const insights = insightsQuery.data;
  const gapReport = gapReportQuery.data;
  const job = jobQuery.data;
  const jobActive = job?.status === "queued" || job?.status === "running";
  const jobTerminal = Boolean(job && ["done", "failed", "dead"].includes(job.status));
  const pollingExpired = pollingTimedOut && jobActive;

  useEffect(() => {
    if (jobQuery.data?.status === "done") {
      void queryClient.invalidateQueries({
        queryKey: ["gap-report", courseId],
      });
    }
  }, [courseId, jobQuery.data?.status, queryClient]);

  useEffect(() => {
    if (!jobActive || pollDeadline === null) {
      return;
    }
    const timeout = window.setTimeout(
      () => setPollingTimedOut(true),
      Math.max(0, pollDeadline - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [jobActive, pollDeadline]);

  return (
    <Stack component="section" spacing={2} aria-labelledby="course-insights-title">
      <Typography id="course-insights-title" component="h2" variant="h5">
        Course insights
      </Typography>
      {insightsQuery.isLoading && (
        <LinearProgress aria-label="Loading course insights" />
      )}
      {insightsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(insightsQuery.error)} />
          <Button onClick={() => void insightsQuery.refetch()}>Retry insights</Button>
        </Stack>
      )}
      {insights && !insights.cohortQualified && (
        <Alert severity="info" role="status">
          Aggregate insights are hidden until the minimum cohort size (
          {insights.minCohortSizeUsed}) is reached.
        </Alert>
      )}
      {insights?.cohortQualified && (
        <>
          <Typography color="text.secondary">
            Aggregates for {new Date(insights.periodStart).toLocaleDateString()}–
            {new Date(insights.periodEnd).toLocaleDateString()}. Individual learner
            activity is not displayed.
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 4 }}>
              <MetricCard label="Questions" value={insights.questionCount} />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <MetricCard
                label="Insufficient evidence"
                value={insights.insufficientQuestionCount}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <MetricCard label="Quiz attempts" value={insights.quizAttemptCount} />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <MetricCard
                label="Helpful feedback"
                value={insights.helpfulFeedbackCount}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <MetricCard
                label="Not-helpful feedback"
                value={insights.notHelpfulFeedbackCount}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <MetricCard
                label="Average quiz score"
                value={
                  insights.quizAverageScore === null
                    ? null
                    : `${Math.round(insights.quizAverageScore * 100)}%`
                }
              />
            </Grid>
          </Grid>
        </>
      )}

      <Card variant="outlined">
        <CardContent>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            spacing={2}
          >
            <Box>
              <Typography component="h3" variant="h6" fontWeight={650}>
                Knowledge-gap report
              </Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                Course-level themes are shown only when the cohort threshold is met.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || jobActive || jobTerminal}
            >
              {refreshMutation.isPending || jobActive
                ? "Refreshing..."
                : job?.status === "done"
                  ? "Report refreshed"
                  : job?.status === "failed" || job?.status === "dead"
                    ? "Retry unavailable"
                    : "Refresh report"}
            </Button>
          </Stack>
          {refreshMutation.isError && (
            <Box sx={{ mt: 2 }}>
              <ErrorNotice message={friendlyMessage(refreshMutation.error)} />
            </Box>
          )}
          {gapReportQuery.isLoading && (
            <LinearProgress sx={{ mt: 2 }} aria-label="Loading gap report" />
          )}
          {gapReportQuery.isError && (
            <Stack spacing={1} alignItems="flex-start" sx={{ mt: 2 }}>
              <ErrorNotice message={friendlyMessage(gapReportQuery.error)} />
              <Button onClick={() => void gapReportQuery.refetch()}>
                Retry gap report
              </Button>
            </Stack>
          )}
          {jobQuery.isError && (
            <Stack spacing={1} alignItems="flex-start" sx={{ mt: 2 }}>
              <ErrorNotice message={friendlyMessage(jobQuery.error)} />
              <Button onClick={() => void jobQuery.refetch()}>Check job status</Button>
            </Stack>
          )}
          {job && (
            <Alert
              severity={
                job.status === "failed" || job.status === "dead" ? "error" : "info"
              }
              role="status"
              aria-live="polite"
              sx={{ mt: 2 }}
            >
              Gap-report job status: {job.status}.
              {(job.status === "failed" || job.status === "dead") &&
                " Course-level retry is not exposed by the API."}
              {pollingExpired && " Automatic status checks paused after two minutes."}
            </Alert>
          )}
          {pollingExpired && (
            <Button
              onClick={() => void jobQuery.refetch()}
              disabled={jobQuery.isFetching}
              sx={{ mt: 1, alignSelf: "flex-start" }}
            >
              Check status
            </Button>
          )}
          {gapReport && gapReport.topics.length > 0 && (
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {gapReport.topics.map((topic) => (
                <Box key={topic.topicId}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                  >
                    <Typography fontWeight={600}>{topic.theme}</Typography>
                    <Chip
                      size="small"
                      label={`${topic.questionCount} questions · ${topic.trend}`}
                    />
                  </Stack>
                  <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                    {topic.suggestedAction}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
          {gapReport && gapReport.topics.length === 0 && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              No cohort-qualified topic aggregates are available in the latest report.
            </Typography>
          )}
          {!gapReport && !gapReportQuery.isLoading && !gapReportQuery.isError && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              No gap report has been generated yet.
            </Typography>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography color="text.secondary" variant="body2">
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
          {value ?? "—"}
        </Typography>
      </CardContent>
    </Card>
  );
}
