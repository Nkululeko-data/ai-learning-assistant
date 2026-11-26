import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { getCourseQuizPerformance, type QuizPerformance } from "../../api/learning";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

type LearnerFilter = "all" | "not_attempted" | "below_threshold";
type LearnerSort = "name" | "attempts" | "latest" | "best";

function percentage(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadQuizResults(quiz: QuizPerformance) {
  const header = [
    "Learner",
    "Attempts",
    "Latest score (%)",
    "Best score (%)",
    "Time taken (seconds)",
    "Submission date",
    "Attempted",
  ];
  const rows = quiz.learners.map((learner) => [
    learner.displayName,
    learner.attempts,
    learner.latestScore,
    learner.bestScore,
    learner.timeTakenSeconds,
    learner.submittedAt,
    learner.attempted ? "Yes" : "No",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${quiz.quizId}-results.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function QuizReport({
  quiz,
  filter,
  threshold,
  sort,
  onFilterChange,
  onSortChange,
}: {
  quiz: QuizPerformance;
  filter: LearnerFilter;
  threshold: number;
  sort: LearnerSort;
  onFilterChange(value: LearnerFilter): void;
  onSortChange(value: LearnerSort): void;
}) {
  const learners = quiz.learners
    .filter((learner) => {
      if (filter === "not_attempted") return !learner.attempted;
      if (filter === "below_threshold") {
        return !learner.attempted || (learner.latestScore ?? 0) < threshold;
      }
      return true;
    })
    .sort((left, right) => {
      if (sort === "attempts") return right.attempts - left.attempts;
      if (sort === "latest") {
        return (right.latestScore ?? -1) - (left.latestScore ?? -1);
      }
      if (sort === "best") return (right.bestScore ?? -1) - (left.bestScore ?? -1);
      return left.displayName.localeCompare(right.displayName);
    });
  const hardestQuestions = [...quiz.questions].sort(
    (left, right) =>
      (left.correctPercent ?? Number.POSITIVE_INFINITY) -
      (right.correctPercent ?? Number.POSITIVE_INFINITY),
  );

  return (
    <Accordion variant="outlined" className="learnova-quiz-report">
      <AccordionSummary>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
          sx={{ width: "100%", pr: 1 }}
        >
          <Typography fontWeight={700}>{quiz.title}</Typography>
          <Chip
            size="small"
            label={`${quiz.learnersAttempted}/${quiz.learnerCount} learners attempted`}
            color={quiz.status === "published" ? "success" : "default"}
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2.5}>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Chip label={`Completion ${quiz.completionRate}%`} variant="outlined" />
            <Chip
              label={`Average ${percentage(quiz.averageScore)}`}
              variant="outlined"
            />
            <Chip
              label={`Highest ${percentage(quiz.highestScore)}`}
              variant="outlined"
            />
            <Chip label={`Lowest ${percentage(quiz.lowestScore)}`} variant="outlined" />
            <Chip label={`${quiz.questionCount} questions`} variant="outlined" />
          </Stack>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id={`learner-filter-value-${quiz.quizId}`}>
                Filter learners
              </InputLabel>
              <Select
                labelId={`learner-filter-value-${quiz.quizId}`}
                value={filter}
                label="Filter learners"
                onChange={(event) =>
                  onFilterChange(event.target.value as LearnerFilter)
                }
              >
                <MenuItem value="all">All learners</MenuItem>
                <MenuItem value="not_attempted">Not attempted</MenuItem>
                <MenuItem value="below_threshold">
                  Not attempted / below threshold
                </MenuItem>
              </Select>
            </FormControl>
            {filter === "below_threshold" && (
              <Typography variant="body2" color="text.secondary">
                Threshold: {threshold}%
              </Typography>
            )}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id={`learner-sort-${quiz.quizId}`}>Sort by</InputLabel>
              <Select
                labelId={`learner-sort-${quiz.quizId}`}
                value={sort}
                label="Sort by"
                onChange={(event) => onSortChange(event.target.value as LearnerSort)}
              >
                <MenuItem value="name">Name</MenuItem>
                <MenuItem value="attempts">Attempts</MenuItem>
                <MenuItem value="latest">Latest score</MenuItem>
                <MenuItem value="best">Best score</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              Showing {learners.length} learner{learners.length === 1 ? "" : "s"}
            </Typography>
            <Button
              variant="outlined"
              onClick={() => downloadQuizResults(quiz)}
              sx={{ ml: { sm: "auto" } }}
            >
              Export CSV
            </Button>
          </Stack>

          {learners.length === 0 ? (
            <Alert severity="info">No learners match this filter.</Alert>
          ) : (
            <Paper variant="outlined" sx={{ overflowX: "auto" }}>
              <Table size="small" aria-label={`Results for ${quiz.title}`}>
                <TableHead>
                  <TableRow>
                    <TableCell>Learner</TableCell>
                    <TableCell>Attempts</TableCell>
                    <TableCell>Latest score</TableCell>
                    <TableCell>Best score</TableCell>
                    <TableCell>Time taken</TableCell>
                    <TableCell>Submission date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {learners.map((learner) => (
                    <TableRow
                      key={learner.userId}
                      sx={{
                        backgroundColor:
                          !learner.attempted || (learner.latestScore ?? 0) < threshold
                            ? "action.hover"
                            : undefined,
                      }}
                    >
                      <TableCell>{learner.displayName}</TableCell>
                      <TableCell>{learner.attempts}</TableCell>
                      <TableCell>{percentage(learner.latestScore)}</TableCell>
                      <TableCell>{percentage(learner.bestScore)}</TableCell>
                      <TableCell>{duration(learner.timeTakenSeconds)}</TableCell>
                      <TableCell>
                        {learner.submittedAt
                          ? new Date(learner.submittedAt).toLocaleString()
                          : "Not submitted"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}

          <Box>
            <Typography component="h4" variant="subtitle1" fontWeight={700}>
              Question accuracy
            </Typography>
            {hardestQuestions.length === 0 ? (
              <Typography color="text.secondary">No questions in this quiz.</Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {hardestQuestions.map((question) => (
                  <Stack
                    key={question.questionId}
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Typography>{question.prompt}</Typography>
                    <Chip
                      size="small"
                      label={`${percentage(question.correctPercent)} correct · ${question.responses} responses`}
                    />
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function CoachQuizPerformancePanel({ courseId }: { courseId: string }) {
  const [filter, setFilter] = useState<LearnerFilter>("all");
  const [sort, setSort] = useState<LearnerSort>("name");
  const [threshold, setThreshold] = useState(50);
  const performanceQuery = useQuery({
    queryKey: ["learning", "quiz-performance", courseId],
    queryFn: () => getCourseQuizPerformance(courseId),
  });
  const performance = performanceQuery.data ?? [];

  if (performanceQuery.isLoading) {
    return <LinearProgress aria-label="Loading quiz performance" />;
  }
  if (performanceQuery.isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(performanceQuery.error)} />
        <Button onClick={() => void performanceQuery.refetch()}>
          Retry performance
        </Button>
      </Stack>
    );
  }
  if (performance.length === 0) {
    return <Alert severity="info">No coach quizzes are available to report yet.</Alert>;
  }

  return (
    <Stack
      component="section"
      spacing={2}
      aria-labelledby="coach-quiz-performance-title"
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1}
      >
        <Box>
          <Typography
            id="coach-quiz-performance-title"
            component="h2"
            variant="h5"
            fontWeight={700}
          >
            Quiz performance
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
            Scores are percentages. Completion uses currently approved learners;
            averages include all submitted attempts.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            label="Attention threshold (%)"
            type="number"
            value={threshold}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 100) {
                setThreshold(value);
              }
            }}
            inputProps={{ min: 0, max: 100, step: 1 }}
            size="small"
            sx={{ width: 180 }}
          />
        </Stack>
      </Stack>
      {performance.map((quiz) => (
        <QuizReport
          key={quiz.quizId}
          quiz={quiz}
          filter={filter}
          threshold={threshold}
          sort={sort}
          onFilterChange={setFilter}
          onSortChange={setSort}
        />
      ))}
    </Stack>
  );
}
