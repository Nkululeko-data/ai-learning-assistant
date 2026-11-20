import { useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { friendlyMessage } from "../../api/client";
import { submitFeedback, type FeedbackRating } from "../../api/feedback";
import type { ConversationMessage } from "../../api/chat";
import { ErrorNotice } from "../../components/ErrorNotice";

export function ChatMessage({
  message,
  courseId,
}: {
  message: ConversationMessage;
  courseId: string;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rating, setRating] = useState<FeedbackRating>("helpful");
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const feedbackMutation = useMutation({
    mutationFn: submitFeedback,
    onSuccess: () => {
      setSubmitted(true);
      setFeedbackOpen(false);
    },
  });

  function openFeedback(selectedRating: FeedbackRating) {
    feedbackMutation.reset();
    setSubmitted(false);
    setRating(selectedRating);
    setComment("");
    setFeedbackOpen(true);
  }

  function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedComment = comment.trim();
    feedbackMutation.mutate({
      messageId: message.id,
      conversationId: message.conversationId,
      courseId,
      rating,
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    });
  }

  return (
    <Card
      component="article"
      variant="outlined"
      aria-label={`${message.role === "assistant" ? "Assistant" : "You"} message`}
    >
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="overline" color="text.secondary">
            {message.role === "assistant" ? "AI Learning Assistant" : "You"}
          </Typography>
          {message.role === "assistant" &&
            message.groundingStatus === "insufficient" && (
              <Alert severity="warning" role="status" aria-live="polite">
                <Typography component="span" fontWeight={700}>
                  Not found in course material.
                </Typography>{" "}
                {message.content}
              </Alert>
            )}
          {message.role === "assistant" && message.groundingStatus === "unverified" && (
            <Alert severity="warning" role="status" aria-live="polite">
              <Typography component="span" fontWeight={700}>
                Unable to verify an answer from course material.
              </Typography>{" "}
              {message.content}
            </Alert>
          )}
          {(message.role === "user" ||
            message.groundingStatus === "grounded" ||
            message.groundingStatus === null) && (
            <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {message.content}
            </Typography>
          )}
          {message.role === "assistant" &&
            message.groundingStatus === "grounded" &&
            message.citations.length > 0 && (
              <Box component="section" aria-label="Answer citations">
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Sources
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {message.citations.map((citation) => (
                    <Chip
                      key={`${citation.marker}-${citation.chunkId}`}
                      variant="outlined"
                      label={`${citation.documentName} · ${
                        citation.pageStart === citation.pageEnd
                          ? `p. ${citation.pageStart}`
                          : `pp. ${citation.pageStart}–${citation.pageEnd}`
                      }${citation.section ? ` · ${citation.section}` : ""}`}
                      aria-label={`Citation ${citation.marker}: ${citation.documentName}, page ${citation.pageStart}${
                        citation.pageEnd !== citation.pageStart
                          ? ` to ${citation.pageEnd}`
                          : ""
                      }${citation.section ? `, ${citation.section}` : ""}`}
                    />
                  ))}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  The API does not provide the cited passage for preview.
                </Typography>
              </Box>
            )}
          {message.role === "assistant" && message.groundingStatus && (
            <>
              {submitted && (
                <Alert severity="success" role="status">
                  Thanks for your feedback.
                </Alert>
              )}
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => openFeedback("helpful")}
                  disabled={feedbackMutation.isPending}
                >
                  Helpful
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => openFeedback("not_helpful")}
                  disabled={feedbackMutation.isPending}
                >
                  Not helpful
                </Button>
              </Stack>
              {feedbackMutation.isError && (
                <ErrorNotice message={friendlyMessage(feedbackMutation.error)} />
              )}
            </>
          )}
        </Stack>
      </CardContent>
      <Dialog
        open={feedbackOpen}
        onClose={() => {
          if (!feedbackMutation.isPending) setFeedbackOpen(false);
        }}
        aria-labelledby={`feedback-title-${message.id}`}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleFeedbackSubmit}>
          <DialogTitle id={`feedback-title-${message.id}`}>
            {rating === "helpful" ? "Helpful answer" : "Not-helpful answer"}
          </DialogTitle>
          <DialogContent>
            <TextField
              label="Comment (optional)"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              multiline
              minRows={3}
              fullWidth
              inputProps={{ maxLength: 1000 }}
              sx={{ mt: 1 }}
            />
            {feedbackMutation.isError && (
              <Box sx={{ mt: 2 }}>
                <ErrorNotice message={friendlyMessage(feedbackMutation.error)} />
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setFeedbackOpen(false)}
              disabled={feedbackMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={feedbackMutation.isPending}
            >
              {feedbackMutation.isPending ? "Sending..." : "Send feedback"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Card>
  );
}
