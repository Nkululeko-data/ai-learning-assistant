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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decideCoachRequest,
  listCoachRequests,
  type CoachRequest,
} from "../../api/admin";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";
import { AdminLoadingSkeleton } from "./AdminLoadingSkeleton";

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

  const requests = requestsQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Coach applications
        </Typography>
        <Typography color="text.secondary">
          Review pending requests. Approval grants the applicant the coach role.
        </Typography>
      </Box>
      {decisionMutation.error && (
        <ErrorNotice message={friendlyMessage(decisionMutation.error)} />
      )}
      {requestsQuery.isLoading && (
        <AdminLoadingSkeleton label="Loading coach applications" />
      )}
      {requestsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(requestsQuery.error)} />
          <Button onClick={() => void requestsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {!requestsQuery.isLoading && !requestsQuery.isError && requests.length === 0 ? (
        <Alert severity="info">There are no pending coach applications.</Alert>
      ) : !requestsQuery.isLoading && !requestsQuery.isError ? (
        <Stack spacing={0}>
          {requests.map((request) => (
            <Box
              key={request.id}
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
                    {request.applicant.displayName}
                  </Typography>
                  <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {request.applicant.email}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Requested {new Date(request.requestedAt).toLocaleString()}
                  </Typography>
                  {request.message && (
                    <Typography
                      sx={{
                        mt: 2,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {request.message}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : null}

      <Dialog
        open={selectedRequest !== null}
        onClose={() => setSelectedRequest(null)}
        aria-labelledby="coach-decision-title"
      >
        <DialogTitle id="coach-decision-title">
          {decision === "approved"
            ? "Approve coach application?"
            : "Reject coach application?"}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {selectedRequest?.applicant.displayName} ({selectedRequest?.applicant.email}
            )
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
