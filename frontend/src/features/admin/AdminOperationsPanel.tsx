import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
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

type OperationsSection = "jobs" | "audit" | "executions";

export function AdminOperationsPanel() {
  const { user } = useAuth();
  const sections: Array<{ id: OperationsSection; label: string }> = [];
  if (user?.permissions.includes("executions:view")) {
    sections.push({ id: "jobs", label: "Jobs" });
    sections.push({ id: "executions", label: "AI executions" });
  }
  if (user?.permissions.includes("audit:view")) {
    sections.push({ id: "audit", label: "Audit log" });
  }
  const [section, setSection] = useState<OperationsSection | null>(null);
  const activeSection = sections.some((item) => item.id === section)
    ? section
    : (sections[0]?.id ?? null);

  if (!activeSection) {
    return <Alert severity="info">You do not have permission to view operations.</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h2" variant="h5" fontWeight={650}>
          Operations
        </Typography>
        <Typography color="text.secondary">
          Review safe job, audit, and AI execution metadata. Content and job payloads are not shown.
        </Typography>
      </Box>
      <Tabs
        value={activeSection}
        onChange={(_event, value: OperationsSection) => setSection(value)}
        aria-label="Admin operations"
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {sections.map((item) => (
          <Tab key={item.id} value={item.id} label={item.label} />
        ))}
      </Tabs>
      {activeSection === "jobs" && <AdminJobsPanel />}
      {activeSection === "audit" && <AuditLogPanel />}
      {activeSection === "executions" && <ExecutionPanel />}
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
      {jobsQuery.isLoading && <LinearProgress aria-label="Loading jobs" />}
      {jobsQuery.isError && <ErrorNotice message={friendlyMessage(jobsQuery.error)} />}
      {retryMutation.error && (
        <ErrorNotice message={friendlyMessage(retryMutation.error)} />
      )}
      {!jobsQuery.isLoading && !jobsQuery.isError && jobs.length === 0 && (
        <Alert severity="info">No jobs match this status.</Alert>
      )}
      {jobs.map((job) => (
        <Card key={job.id} variant="outlined">
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
              spacing={1}
            >
              <Box>
                <Typography fontWeight={650}>{job.type}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {job.id}
                </Typography>
              </Box>
              <Chip label={job.status} size="small" />
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
          </CardContent>
        </Card>
      ))}
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
        <ErrorNotice message={friendlyMessage(jobsQuery.error)} />
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
      {logsQuery.isLoading && <LinearProgress aria-label="Loading audit log" />}
      {logsQuery.isError && <ErrorNotice message={friendlyMessage(logsQuery.error)} />}
      {!logsQuery.isLoading && !logsQuery.isError && logs.length === 0 && (
        <Alert severity="info">No audit records are available.</Alert>
      )}
      {logs.map((entry) => (
        <Card key={entry.id} variant="outlined">
          <CardContent>
            <Typography fontWeight={650}>{entry.action}</Typography>
            <Typography variant="body2">
              {entry.actorRole} · {entry.targetType} · {entry.targetId}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(entry.createdAt).toLocaleString()} · Request {entry.requestId ?? "—"}
            </Typography>
          </CardContent>
        </Card>
      ))}
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
        <ErrorNotice message={friendlyMessage(logsQuery.error)} />
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
  const executions =
    executionsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack spacing={2}>
      {executionsQuery.isLoading && (
        <LinearProgress aria-label="Loading AI executions" />
      )}
      {executionsQuery.isError && (
        <ErrorNotice message={friendlyMessage(executionsQuery.error)} />
      )}
      {!executionsQuery.isLoading &&
        !executionsQuery.isError &&
        executions.length === 0 && (
          <Alert severity="info">No AI execution records are available.</Alert>
        )}
      {executions.map((entry) => (
        <Card key={entry.id} variant="outlined">
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
              spacing={1}
            >
              <Typography fontWeight={650}>
                {entry.graph} / {entry.node}
              </Typography>
              <Chip label={entry.status} size="small" />
            </Stack>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {entry.provider ?? "No provider"} / {entry.model ?? "No model"}
              {" · "}{entry.durationMs} ms
              {" · "}Retries {entry.retryCount}
              {" · "}Tokens {entry.tokenUsage
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
          </CardContent>
        </Card>
      ))}
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
        <ErrorNotice message={friendlyMessage(executionsQuery.error)} />
      )}
    </Stack>
  );
}
