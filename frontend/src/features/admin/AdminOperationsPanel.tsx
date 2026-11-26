import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAdminJobs,
  listAuditLogs,
  listExecutions,
  retryAdminJob,
  type AdminJobStatus,
} from "../../api/admin";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { AdminLoadingSkeleton } from "./AdminLoadingSkeleton";
import { AdminStatusChip } from "./AdminStatusChip";

type OperationsSection = "jobs" | "audit" | "executions";

export function AdminOperationsPanel({ section }: { section: OperationsSection }) {
  const title = {
    jobs: "Jobs",
    audit: "Audit log",
    executions: "AI executions",
  }[section];
  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          {title}
        </Typography>
      </Box>
      {section === "jobs" && <AdminJobsPanel />}
      {section === "audit" && <AuditLogPanel />}
      {section === "executions" && <ExecutionPanel />}
    </Stack>
  );
}

function AdminJobsPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | AdminJobStatus>("all");
  const jobsQuery = useInfiniteQuery({
    queryKey: ["admin", "jobs", status],
    queryFn: ({ pageParam }) =>
      listAdminJobs({
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(status === "all" ? {} : { status }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const retryMutation = useMutation({
    mutationFn: retryAdminJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
  });
  const jobs = jobsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack spacing={2}>
      <FormControl size="small" sx={{ maxWidth: 240 }}>
        <InputLabel id="admin-job-status-label">Job status</InputLabel>
        <Select
          labelId="admin-job-status-label"
          label="Job status"
          value={status}
          onChange={(event) => setStatus(event.target.value as "all" | AdminJobStatus)}
        >
          <MenuItem value="all">All statuses</MenuItem>
          <MenuItem value="queued">Queued</MenuItem>
          <MenuItem value="running">Running</MenuItem>
          <MenuItem value="done">Done</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
          <MenuItem value="dead">Dead</MenuItem>
        </Select>
      </FormControl>
      {jobsQuery.isLoading && <AdminLoadingSkeleton label="Loading jobs" rows={4} />}
      {jobsQuery.isError && !jobsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(jobsQuery.error)} />
          <Button onClick={() => void jobsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {retryMutation.error && (
        <ErrorNotice message={friendlyMessage(retryMutation.error)} />
      )}
      {!jobsQuery.isLoading && !jobsQuery.isError && jobs.length === 0 && (
        <Alert severity="info">No jobs match this status.</Alert>
      )}
      {jobs.length > 0 && (
        <Stack spacing={0}>
          {jobs.map((job) => (
            <Box
              key={job.id}
              component="article"
              sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
              >
                <Box>
                  <Typography fontWeight={650}>{job.type}</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {job.id}
                  </Typography>
                </Box>
                <AdminStatusChip status={job.status} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Attempts: {job.attempts}/{job.maxAttempts}
                {" · "}Updated {new Date(job.updatedAt).toLocaleString()}
              </Typography>
              {job.error && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                  {job.error.code}: {job.error.message}
                </Typography>
              )}
              {user?.permissions.includes("user:manage") &&
                (job.status === "failed" || job.status === "dead") && (
                  <Button
                    size="small"
                    sx={{ mt: 1 }}
                    disabled={retryMutation.isPending}
                    onClick={() => retryMutation.mutate(job.id)}
                  >
                    Retry job
                  </Button>
                )}
            </Box>
          ))}
        </Stack>
      )}
      {jobsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void jobsQuery.fetchNextPage()}
          disabled={jobsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {jobsQuery.isFetchingNextPage ? "Loading..." : "Load more jobs"}
        </Button>
      )}
      {jobsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(jobsQuery.error)} />
          <Button onClick={() => void jobsQuery.fetchNextPage()}>
            Retry loading more
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function AuditLogPanel() {
  const logsQuery = useInfiniteQuery({
    queryKey: ["admin", "audit-logs"],
    queryFn: ({ pageParam }) =>
      listAuditLogs({ limit: 20, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const logs = logsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack spacing={2}>
      {logsQuery.isLoading && (
        <AdminLoadingSkeleton label="Loading audit log" rows={4} />
      )}
      {logsQuery.isError && !logsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(logsQuery.error)} />
          <Button onClick={() => void logsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {!logsQuery.isLoading && !logsQuery.isError && logs.length === 0 && (
        <Alert severity="info">No audit records are available.</Alert>
      )}
      {logs.length > 0 && (
        <Stack spacing={0}>
          {logs.map((entry) => (
            <Box
              key={entry.id}
              component="article"
              sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Typography fontWeight={650}>{entry.action}</Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {entry.actorRole} · {entry.targetType} · {entry.targetId}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(entry.createdAt).toLocaleString()} · Request{" "}
                {entry.requestId ?? "—"}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
      {logsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void logsQuery.fetchNextPage()}
          disabled={logsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {logsQuery.isFetchingNextPage ? "Loading..." : "Load more records"}
        </Button>
      )}
      {logsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(logsQuery.error)} />
          <Button onClick={() => void logsQuery.fetchNextPage()}>
            Retry loading more
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function ExecutionPanel() {
  const executionsQuery = useInfiniteQuery({
    queryKey: ["admin", "executions"],
    queryFn: ({ pageParam }) =>
      listExecutions({ limit: 20, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const executions = executionsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack spacing={2}>
      {executionsQuery.isLoading && (
        <AdminLoadingSkeleton label="Loading AI executions" rows={4} />
      )}
      {executionsQuery.isError && !executionsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(executionsQuery.error)} />
          <Button onClick={() => void executionsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {!executionsQuery.isLoading &&
        !executionsQuery.isError &&
        executions.length === 0 && (
          <Alert severity="info">No AI execution records are available.</Alert>
        )}
      {executions.length > 0 && (
        <Stack spacing={0}>
          {executions.map((entry) => (
            <Box
              key={entry.id}
              component="article"
              sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
              >
                <Typography fontWeight={650}>
                  {entry.graph} / {entry.node}
                </Typography>
                <AdminStatusChip status={entry.status} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1, overflowWrap: "anywhere" }}>
                {entry.provider ?? "No provider"} / {entry.model ?? "No model"}
                {" · "}
                {entry.durationMs} ms
                {" · "}Retries {entry.retryCount}
                {" · "}Tokens{" "}
                {entry.tokenUsage
                  ? `${entry.tokenUsage.input} in / ${entry.tokenUsage.output} out`
                  : "not recorded"}
              </Typography>
              {entry.errorCode && (
                <Typography variant="body2" color="error">
                  {entry.errorCode}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {new Date(entry.createdAt).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
      {executionsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void executionsQuery.fetchNextPage()}
          disabled={executionsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {executionsQuery.isFetchingNextPage ? "Loading..." : "Load more executions"}
        </Button>
      )}
      {executionsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(executionsQuery.error)} />
          <Button onClick={() => void executionsQuery.fetchNextPage()}>
            Retry loading more
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
