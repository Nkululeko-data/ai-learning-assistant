import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  decideCourseJoinRequest,
  listCourseJoinRequests,
  type JoinRequest,
} from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

type Decision = "approved" | "rejected";

export function EnrolmentRequestsPanel({
  courseId,
  active,
}: {
  courseId: string;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<JoinRequest | null>(null);
  const [decision, setDecision] = useState<Decision>("approved");
  const [decisionNote, setDecisionNote] = useState("");
  const requestsQuery = useInfiniteQuery({
    queryKey: ["enrolments", "course", courseId, "pending"],
    queryFn: ({ pageParam }) =>
      listCourseJoinRequests(courseId, {
        limit: 20,
        status: "pending",
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const decisionMutation = useMutation({
    mutationFn: ({
      enrolmentId,
      status,
      note,
    }: {
      enrolmentId: string;
      status: Decision;
      note: string;
    }) =>
      decideCourseJoinRequest(enrolmentId, {
        status,
        ...(note.trim() ? { decisionNote: note.trim() } : {}),
      }),
    onSuccess: async () => {
      setSelectedRequest(null);
      setDecisionNote("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["enrolments", "course", courseId],
        }),
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
      ]);
    },
  });
  const requests =
    requestsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack component="section" spacing={2} aria-labelledby="enrolment-requests-title">
      <div>
        <Typography id="enrolment-requests-title" component="h2" variant="h5">
          Learner enrolment requests
        </Typography>
        <Typography color="text.secondary">
          Approving a request gives the learner access to this course and its material.
        </Typography>
      </div>
      {requestsQuery.isLoading && (
        <LinearProgress aria-label="Loading enrolment requests" />
      )}
      {requestsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(requestsQuery.error)} />
          <Button onClick={() => void requestsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {decisionMutation.error && (
        <ErrorNotice message={friendlyMessage(decisionMutation.error)} />
      )}
      {!requestsQuery.isLoading &&
        !requestsQuery.isError &&
        requests.length === 0 && (
          <Alert severity="info">There are no pending enrolment requests.</Alert>
        )}
      {requests.map((request) => (
        <Card key={request.id} variant="outlined">
          <CardContent>
            <Typography variant="h6">{request.applicant.displayName}</Typography>
            <Typography color="text.secondary">{request.applicant.email}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Requested {new Date(request.requestedAt).toLocaleString()}
            </Typography>
          </CardContent>
          <CardActions>
            <Button
              variant="contained"
              disabled={!active || decisionMutation.isPending}
              onClick={() => {
                setSelectedRequest(request);
                setDecision("approved");
              }}
            >
              Approve
            </Button>
            <Button
              color="error"
              disabled={decisionMutation.isPending}
              onClick={() => {
                setSelectedRequest(request);
                setDecision("rejected");
              }}
            >
              Reject
            </Button>
          </CardActions>
        </Card>
      ))}
      {requestsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void requestsQuery.fetchNextPage()}
          disabled={requestsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {requestsQuery.isFetchingNextPage ? "Loading..." : "Load more requests"}
        </Button>
      )}
      {requestsQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(requestsQuery.error)} />
      )}

      <Dialog
        open={selectedRequest !== null}
        onClose={() => setSelectedRequest(null)}
        aria-labelledby="enrolment-decision-title"
      >
        <DialogTitle id="enrolment-decision-title">
          {decision === "approved" ? "Approve learner?" : "Reject request?"}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {selectedRequest?.applicant.displayName} ({selectedRequest?.applicant.email})
          </Typography>
          <TextField
            label="Decision note (optional)"
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.target.value)}
            inputProps={{ maxLength: 1000 }}
            multiline
            minRows={2}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedRequest(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={decision === "approved" ? "primary" : "error"}
            disabled={
              !selectedRequest ||
              decisionMutation.isPending ||
              decisionNote.length > 1000
            }
            onClick={() => {
              if (!selectedRequest) return;
              decisionMutation.mutate({
                enrolmentId: selectedRequest.id,
                status: decision,
                note: decisionNote,
              });
            }}
          >
            Confirm {decision}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
