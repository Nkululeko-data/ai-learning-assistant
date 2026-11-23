import { Alert, Box, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  listAdminJobs,
  listCoachRequests,
  listCourseApprovalQueue,
} from "../../api/admin";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";

const attentionPageSize = 100;
const refreshInterval = 5 * 60 * 1000;

export function AdminDashboardPage() {
  const { user } = useAuth();
  const canReviewApplications = user?.permissions.includes("user:manage") ?? false;
  const canReviewJobs = user?.permissions.includes("executions:view") ?? false;
  const coachRequestsQuery = useQuery({
    queryKey: ["admin", "coach-requests", "pending"],
    queryFn: () => listCoachRequests("pending"),
    enabled: canReviewApplications,
    refetchInterval: refreshInterval,
  });
  const courseApprovalsQuery = useQuery({
    queryKey: ["admin", "course-approvals", "attention"],
    queryFn: () => listCourseApprovalQueue({ limit: attentionPageSize }),
    enabled: canReviewApplications,
    refetchInterval: refreshInterval,
  });
  const failedJobsQuery = useQuery({
    queryKey: ["admin", "jobs", "attention", "failed"],
    queryFn: () => listAdminJobs({ limit: attentionPageSize, status: "failed" }),
    enabled: canReviewJobs,
    refetchInterval: refreshInterval,
  });
  const deadJobsQuery = useQuery({
    queryKey: ["admin", "jobs", "attention", "dead"],
    queryFn: () => listAdminJobs({ limit: attentionPageSize, status: "dead" }),
    enabled: canReviewJobs,
    refetchInterval: refreshInterval,
  });

  const queries = [
    ...(canReviewApplications ? [coachRequestsQuery, courseApprovalsQuery] : []),
    ...(canReviewJobs ? [failedJobsQuery, deadJobsQuery] : []),
  ];
  const isLoading = queries.some((query) => query.isPending);
  const errors = queries.filter((query) => query.isError);
  const rows = [];
  if (
    canReviewApplications &&
    coachRequestsQuery.data &&
    coachRequestsQuery.data.length > 0
  ) {
    rows.push({
      key: "coach-applications",
      count: String(coachRequestsQuery.data.length),
      title: "Coach applications",
      detail: "Waiting for review.",
      href: "/admin/coach-applications",
    });
  }
  if (
    canReviewApplications &&
    courseApprovalsQuery.data &&
    courseApprovalsQuery.data.items.length > 0
  ) {
    rows.push({
      key: "course-approvals",
      count: countLabel(
        courseApprovalsQuery.data.items.length,
        courseApprovalsQuery.data.nextCursor !== undefined,
      ),
      title: "Courses awaiting approval",
      detail: "Ready for an admin decision.",
      href: "/admin/course-approvals",
    });
  }
  if (
    canReviewJobs &&
    failedJobsQuery.data &&
    deadJobsQuery.data &&
    failedJobsQuery.data.items.length + deadJobsQuery.data.items.length > 0
  ) {
    const jobsCount =
      failedJobsQuery.data.items.length + deadJobsQuery.data.items.length;
    rows.push({
      key: "jobs",
      count: countLabel(
        jobsCount,
        failedJobsQuery.data.nextCursor !== undefined ||
          deadJobsQuery.data.nextCursor !== undefined,
      ),
      title: "Jobs that need action",
      detail: "Failed or dead jobs may be retried.",
      href: "/admin/operations/jobs",
    });
  }
  const hasAvailableQueues = canReviewApplications || canReviewJobs;

  return (
    <Stack spacing={4}>
      <Typography component="h1" variant="h4" fontWeight={700}>
        Admin dashboard
      </Typography>
      <Box component="section" aria-labelledby="needs-attention-title">
        <Typography
          id="needs-attention-title"
          component="h2"
          variant="h5"
          fontWeight={650}
          sx={{ mb: 1.5 }}
        >
          Needs attention
        </Typography>
        {isLoading && <LinearProgress aria-label="Loading items needing attention" />}
        {errors.map((query, index) => (
          <Stack key={index} spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
            <ErrorNotice message={friendlyMessage(query.error)} />
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </Stack>
        ))}
        {rows.length > 0 && (
          <Stack component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
            {rows.map((row) => (
              <Box
                component="li"
                key={row.key}
                aria-label={row.title}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: { xs: 1.5, sm: 2 },
                  py: 1.5,
                  "&:not(:last-child)": {
                    borderBottom: 1,
                    borderColor: "divider",
                  },
                }}
              >
                <Typography
                  component="span"
                  variant="h6"
                  fontWeight={700}
                  sx={{ minWidth: 48, fontVariantNumeric: "tabular-nums" }}
                >
                  {row.count}
                </Typography>
                <Box sx={{ flex: 1 }}>
                  <Typography component="h3" variant="body1" fontWeight={650}>
                    {row.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {row.detail}
                  </Typography>
                </Box>
                <Button component={RouterLink} to={row.href} variant="outlined">
                  Review
                </Button>
              </Box>
            ))}
          </Stack>
        )}
        {!isLoading &&
          errors.length === 0 &&
          rows.length === 0 &&
          hasAvailableQueues && (
            <Typography>Nothing needs attention right now.</Typography>
          )}
        {!hasAvailableQueues && (
          <Alert severity="info">
            No attention queues are available for this account.
          </Alert>
        )}
      </Box>
    </Stack>
  );
}

function countLabel(count: number, hasMore: boolean): string {
  return `${count}${hasMore ? "+" : ""}`;
}
