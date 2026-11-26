import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  decideCourseApproval,
  listCourseApprovalQueue,
  type CourseApproval,
} from "../../api/admin";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";
import { AdminLoadingSkeleton } from "./AdminLoadingSkeleton";

export function CourseApprovalsPanel() {
  const queryClient = useQueryClient();
  const [selectedCourse, setSelectedCourse] = useState<CourseApproval | null>(null);
  const [note, setNote] = useState("");
  const approvalsQuery = useInfiniteQuery({
    queryKey: ["admin", "course-approvals"],
    queryFn: ({ pageParam }) =>
      listCourseApprovalQueue({
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const decisionMutation = useMutation({
    mutationFn: ({
      course,
      decision,
      decisionNote,
    }: {
      course: CourseApproval;
      decision: "approved" | "changes_requested";
      decisionNote?: string;
    }) =>
      decideCourseApproval(course.id, {
        decision,
        version: course.version,
        ...(decisionNote ? { note: decisionNote } : {}),
      }),
    onSuccess: async () => {
      setSelectedCourse(null);
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "course-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
      ]);
    },
  });
  const approvalQueueError: unknown = approvalsQuery.error;

  const courses = approvalsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack spacing={2}>
      <div>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Course approvals
        </Typography>
        <Typography color="text.secondary">
          Approve courses before learners can discover or join them, or send them back
          to the coach with requested changes.
        </Typography>
      </div>
      {decisionMutation.error && (
        <ErrorNotice message={friendlyMessage(decisionMutation.error)} />
      )}
      {approvalsQuery.isLoading && (
        <AdminLoadingSkeleton label="Loading course approval queue" />
      )}
      {approvalsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(approvalsQuery.error)} />
          <Button onClick={() => void approvalsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {!approvalsQuery.isLoading && !approvalsQuery.isError && courses.length === 0 ? (
        <Alert severity="info">There are no courses waiting for approval.</Alert>
      ) : !approvalsQuery.isLoading && !approvalsQuery.isError ? (
        <Stack spacing={0}>
          {courses.map((course) => (
            <Box
              key={course.id}
              component="article"
              sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography component="h2" variant="h6">
                    {course.name}
                  </Typography>
                  <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {course.owner.displayName} · {course.owner.email}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 1,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {course.description || "No description provided."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Submitted{" "}
                    {course.approvalRequestedAt
                      ? new Date(course.approvalRequestedAt).toLocaleString()
                      : "at an unknown time"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="contained"
                    disabled={decisionMutation.isPending}
                    onClick={() =>
                      decisionMutation.mutate({ course, decision: "approved" })
                    }
                  >
                    Approve course
                  </Button>
                  <Button
                    disabled={decisionMutation.isPending}
                    onClick={() => {
                      setSelectedCourse(course);
                      setNote("");
                    }}
                  >
                    Request changes
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : null}
      {approvalsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void approvalsQuery.fetchNextPage()}
          disabled={approvalsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {approvalsQuery.isFetchingNextPage ? "Loading..." : "Load more courses"}
        </Button>
      )}
      {approvalsQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(approvalQueueError)} />
      )}

      <Dialog
        open={selectedCourse !== null}
        onClose={() => setSelectedCourse(null)}
        aria-labelledby="course-changes-title"
      >
        <DialogTitle id="course-changes-title">Request course changes</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {selectedCourse?.name} will remain unavailable to learners until the coach
            resubmits it and it is approved.
          </Typography>
          <TextField
            label="Feedback for the coach (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            inputProps={{ maxLength: 1000 }}
            multiline
            minRows={2}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedCourse(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!selectedCourse || decisionMutation.isPending}
            onClick={() => {
              if (!selectedCourse) return;
              decisionMutation.mutate({
                course: selectedCourse,
                decision: "changes_requested",
                ...(note.trim() ? { decisionNote: note.trim() } : {}),
              });
            }}
          >
            Send back to coach
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
