import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { getQuizAttemptReview, listMyQuizAttempts } from "../../api/learning";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { useState } from "react";

const pageSize = 20;

export function QuizResultsPage() {
  const { user } = useAuth();
  const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
  const attemptsQuery = useInfiniteQuery({
    queryKey: ["quiz-attempts", "mine"],
    queryFn: ({ pageParam }) =>
      listMyQuizAttempts({
        limit: pageSize,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: user?.role === "learner",
  });
  const reviewQuery = useQuery({
    queryKey: ["quiz-attempt-review", reviewAttemptId],
    queryFn: () => {
      if (!reviewAttemptId) throw new Error("No quiz attempt selected");
      return getQuizAttemptReview(reviewAttemptId);
    },
    enabled: reviewAttemptId !== null,
  });
  const attempts =
    attemptsQuery.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (attempt) =>
          (attempt.status ?? "submitted") === "submitted" &&
          Boolean(attempt.submittedAt),
      ) ?? [];

  if (user?.role !== "learner") {
    return <Alert severity="error">Quiz results are available to learners.</Alert>;
  }

  return (
    <Stack className="learnova-quiz-results" spacing={2.5}>
      <div>
        <Typography
          component="h1"
          variant="h4"
          fontWeight={700}
          className="learnova-page-heading"
        >
          Quiz results
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Review your submitted quiz scores and return to the course.
        </Typography>
      </div>
      {attemptsQuery.isLoading && <LinearProgress aria-label="Loading quiz results" />}
      {attemptsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(attemptsQuery.error)} />
          <Button onClick={() => void attemptsQuery.refetch()}>Retry</Button>
        </Stack>
      )}
      {!attemptsQuery.isLoading && !attemptsQuery.isError && attempts.length === 0 && (
        <Alert severity="info">
          You have not submitted a quiz yet. Completed quizzes will appear here.
        </Alert>
      )}
      {attempts.map((attempt) => (
        <Paper
          component="article"
          key={attempt.id}
          variant="outlined"
          className="learnova-result-card"
          sx={{ p: { xs: 2, sm: 2.5 } }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1.5}
          >
            <div>
              <Typography component="h2" variant="h6" fontWeight={650}>
                {attempt.quizTitle ?? "Quiz attempt"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {attempt.quizOrigin === "coach" ? "Coach quiz" : "Practice quiz"}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {attempt.score} of {attempt.maxScore} correct (
                {Math.round((attempt.score / attempt.maxScore) * 100)}%)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Submitted{" "}
                {attempt.submittedAt
                  ? new Date(attempt.submittedAt).toLocaleString()
                  : "date unavailable"}
                {" · "}
                Time taken{" "}
                {attempt.submittedAt
                  ? `${Math.max(
                      0,
                      Math.round(
                        (Date.parse(attempt.submittedAt) -
                          Date.parse(attempt.startedAt)) /
                          1000,
                      ),
                    )} seconds`
                  : "—"}
              </Typography>
            </div>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                variant="contained"
                onClick={() => setReviewAttemptId(attempt.id)}
              >
                Review answers
              </Button>
              <Button
                component={RouterLink}
                to={`/courses/${attempt.courseId}`}
                variant="outlined"
              >
                Open course
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ))}
      {attemptsQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(attemptsQuery.error)} />
      )}
      {attemptsQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void attemptsQuery.fetchNextPage()}
          disabled={attemptsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {attemptsQuery.isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}
      <Dialog
        open={reviewAttemptId !== null}
        onClose={() => setReviewAttemptId(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="quiz-review-title"
      >
        <DialogTitle id="quiz-review-title">
          {reviewQuery.data
            ? `Review: ${reviewQuery.data.quizTitle}`
            : "Review quiz answers"}
        </DialogTitle>
        <DialogContent dividers>
          {reviewQuery.isLoading && <LinearProgress aria-label="Loading quiz review" />}
          {reviewQuery.isError && (
            <Stack spacing={1} alignItems="flex-start">
              <ErrorNotice message={friendlyMessage(reviewQuery.error)} />
              <Button onClick={() => void reviewQuery.refetch()}>Retry</Button>
            </Stack>
          )}
          {reviewQuery.data && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity={reviewQuery.data.showFeedback ? "success" : "info"}>
                {reviewQuery.data.showFeedback
                  ? `You scored ${reviewQuery.data.score} of ${reviewQuery.data.maxScore}. Correct answers and explanations are shown below.`
                  : "Your instructor turned off answer feedback. Your submitted choices are shown, but correct answers are hidden."}
              </Alert>
              {reviewQuery.data.questions.map((question, index) => (
                <Paper
                  component="section"
                  key={question.questionId}
                  variant="outlined"
                  sx={{ p: { xs: 1.5, sm: 2 } }}
                >
                  <Stack spacing={1.5}>
                    <div>
                      <Typography variant="overline" color="text.secondary">
                        Question {index + 1}
                      </Typography>
                      <Typography variant="h6">{question.prompt}</Typography>
                    </div>
                    {reviewQuery.data.showFeedback && (
                      <Chip
                        label={question.correct ? "Correct" : "Incorrect"}
                        color={question.correct ? "success" : "error"}
                        size="small"
                        sx={{ alignSelf: "flex-start" }}
                      />
                    )}
                    <Stack spacing={1}>
                      {question.options.map((option) => {
                        const selected = question.selectedOptionIds.includes(option.id);
                        const correct =
                          reviewQuery.data.showFeedback &&
                          question.correctOptionIds?.includes(option.id);
                        return (
                          <Stack
                            key={option.id}
                            direction={{ xs: "column", sm: "row" }}
                            justifyContent="space-between"
                            alignItems={{ xs: "flex-start", sm: "center" }}
                            spacing={1}
                            sx={{
                              border: 1,
                              borderColor: selected ? "primary.main" : "divider",
                              borderRadius: 1,
                              p: 1.25,
                            }}
                          >
                            <Typography>{option.text}</Typography>
                            <Stack direction="row" spacing={0.75}>
                              {selected && (
                                <Chip
                                  label="Your answer"
                                  color="primary"
                                  size="small"
                                />
                              )}
                              {correct && (
                                <Chip
                                  label="Correct answer"
                                  color="success"
                                  size="small"
                                />
                              )}
                            </Stack>
                          </Stack>
                        );
                      })}
                      {question.selectedOptionIds.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          No answer selected.
                        </Typography>
                      )}
                    </Stack>
                    {reviewQuery.data.showFeedback && question.explanation && (
                      <Typography variant="body2" color="text.secondary">
                        {question.explanation}
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewAttemptId(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
