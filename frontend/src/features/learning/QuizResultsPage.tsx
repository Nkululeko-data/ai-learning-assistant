import { Alert, Button, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { listMyQuizAttempts } from "../../api/learning";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";

const pageSize = 20;

export function QuizResultsPage() {
  const { user } = useAuth();
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
  const attempts = attemptsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  if (user?.role !== "learner") {
    return <Alert severity="error">Quiz results are available to learners.</Alert>;
  }

  return (
    <Stack spacing={2.5}>
      <div>
        <Typography component="h1" variant="h4" fontWeight={700}>
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
                Quiz attempt
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {attempt.score} of {attempt.maxScore} correct (
                {Math.round((attempt.score / attempt.maxScore) * 100)}%)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Submitted {new Date(attempt.submittedAt).toLocaleString()}
              </Typography>
            </div>
            <Button
              component={RouterLink}
              to={`/courses/${attempt.courseId}`}
              variant="outlined"
            >
              Open course
            </Button>
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
    </Stack>
  );
}
