import { useState } from "react";
import {
  Alert,
  Box,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideCoachRequest,
  listCoachRequests,
  type CoachRequest,
} from "../../api/admin";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

type Decision = "approved" | "rejected";

export function CoachRequestsPanel() {
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<CoachRequest | null>(null);
  const [decision, setDecision] = useState<Decision>("approved");
  const [decisionNote, setDecisionNote] = useState("");
  const requestsQuery = useQuery({
    queryKey: ["admin", "coach-requests", "pending"],
    queryFn: () => listCoachRequests("pending"),
  });
  const decisionMutation = useMutation({
    mutationFn: ({
      requestId,
      status,
      note,
    }: {
      requestId: string;
      status: Decision;
      note: string;
    }) =>
      decideCoachRequest(requestId, {
        status,
        ...(note.trim() ? { decisionNote: note.trim() } : {}),
      }),
    onSuccess: async () => {
      setSelectedRequest(null);
      setDecisionNote("");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "coach-requests"],
      });
    },
  });

  if (requestsQuery.isLoading) {
    return <LinearProgress aria-label="Loading coach applications" />;
  }
  if (requestsQuery.isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(requestsQuery.error)} />
        <Button onClick={() => void requestsQuery.refetch()}>Retry</Button>
      </Stack>
    );
  }

  const requests = requestsQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h2" variant="h5" fontWeight={650}>
          Coach applications
        </Typography>
        <Typography color="text.secondary">
          Review pending requests. Approval grants the applicant the coach role.
        </Typography>
      </Box>
      {decisionMutation.error && (
        <ErrorNotice message={friendlyMessage(decisionMutation.error)} />
      )}
      {requests.length === 0 ? (
        <Alert severity="info">There are no pending coach applications.</Alert>
      ) : (
        <Stack spacing={2}>
          {requests.map((request) => (
            <Card key={request.id} variant="outlined">
              <CardContent>
                <Typography variant="h6">{request.applicant.displayName}</Typography>
                <Typography color="text.secondary">
                  {request.applicant.email}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Requested {new Date(request.requestedAt).toLocaleString()}
                </Typography>
                {request.message && (
                  <Typography sx={{ mt: 2, whiteSpace: "pre-wrap" }}>
                    {request.message}
                  </Typography>
                )}
              </CardContent>
              <CardActions>
                <Button
                  variant="contained"
                  disabled={decisionMutation.isPending}
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
        </Stack>
      )}

      <Dialog
        open={selectedRequest !== null}
        onClose={() => setSelectedRequest(null)}
        aria-labelledby="coach-decision-title"
      >
        <DialogTitle id="coach-decision-title">
          {decision === "approved" ? "Approve coach application?" : "Reject coach application?"}
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
                requestId: selectedRequest.id,
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
