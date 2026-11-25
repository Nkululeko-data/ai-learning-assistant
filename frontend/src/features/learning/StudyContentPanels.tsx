import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  generateFlashcards,
  generateQuiz,
  generateSummary,
  getFlashcardSet,
  getLearnerQuiz,
  getSummary,
  listCourseFlashcards,
  listCourseQuizzes,
  listCourseSummaries,
  publishFlashcards,
  publishSummary,
  submitQuizAttempt,
  type FlashcardSet,
  type LearnerQuiz,
  type LearningSummary,
  type QuizAttemptResult,
} from "../../api/learning";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

interface PanelProps {
  courseId: string;
  selectedDocumentIds: string[];
  topic: string;
  canGenerate: boolean;
  canPublish?: boolean;
}

export function SummaryPanel({
  courseId,
  selectedDocumentIds,
  topic,
  canGenerate,
  canPublish = false,
}: PanelProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const summariesQuery = useInfiniteQuery({
    queryKey: ["learning", "summaries", courseId],
    queryFn: ({ pageParam }) =>
      listCourseSummaries(courseId, {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const selectedSummaryQuery = useQuery({
    queryKey: ["learning", "summary", selectedId],
    queryFn: () => getSummary(selectedId),
    enabled: Boolean(selectedId),
  });
  const generateMutation = useMutation({
    mutationFn: () =>
      generateSummary({ courseId, documentIds: selectedDocumentIds, topic }),
    onSuccess: async (summary) => {
      setSelectedId(summary.id);
      await queryClient.invalidateQueries({
        queryKey: ["learning", "summaries", courseId],
      });
    },
  });
  const publishMutation = useMutation({
    mutationFn: (summary: LearningSummary) =>
      publishSummary(summary.id, summary.version),
    onSuccess: async (publishedSummary) => {
      setSelectedId(publishedSummary.id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["learning", "summaries", courseId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["learning", "summary", publishedSummary.id],
        }),
      ]);
    },
  });
  const summaries = summariesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const summary: LearningSummary | undefined = selectedSummaryQuery.data;

  return (
    <Stack spacing={2} component="section" aria-labelledby="summary-panel-title">
      <Typography id="summary-panel-title" component="h2" variant="h5">
        Summaries
      </Typography>
      <Button
        variant="contained"
        disabled={
          !canGenerate || selectedDocumentIds.length === 0 || generateMutation.isPending
        }
        onClick={() => generateMutation.mutate()}
        sx={{ alignSelf: "flex-start" }}
      >
        {generateMutation.isPending ? "Generating summary..." : "Generate summary"}
      </Button>
      {generateMutation.error && (
        <ErrorNotice message={friendlyMessage(generateMutation.error)} />
      )}
      {publishMutation.error && (
        <ErrorNotice message={friendlyMessage(publishMutation.error)} />
      )}
      <SavedContentSelect
        label="Saved summaries"
        value={selectedId}
        onChange={setSelectedId}
        items={summaries.map((item) => ({
          id: item.id,
          label: `${item.title} · v${item.version}`,
        }))}
        isLoading={summariesQuery.isLoading}
        isError={summariesQuery.isError}
        error={summariesQuery.error}
        onRetry={() => void summariesQuery.refetch()}
      />
      {summariesQuery.hasNextPage && (
        <Button
          onClick={() => void summariesQuery.fetchNextPage()}
          disabled={summariesQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {summariesQuery.isFetchingNextPage ? "Loading..." : "Load more summaries"}
        </Button>
      )}
      {summariesQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(summariesQuery.error)} />
      )}
      {selectedSummaryQuery.isLoading && (
        <LinearProgress aria-label="Loading selected summary" />
      )}
      {selectedSummaryQuery.isError && (
        <ErrorNotice message={friendlyMessage(selectedSummaryQuery.error)} />
      )}
      {summary && (
        <Card variant="outlined">
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 2 }}
            >
              <Typography component="h3" variant="h6">
                {summary.title}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Chip label={summary.status} size="small" />
                <Chip label={`Version ${summary.version}`} size="small" />
              </Stack>
            </Stack>
            <Stack spacing={2}>
              {summary.blocks.map((block, index) => (
                <Box key={`${block.heading}-${index}`}>
                  <Typography component="h4" fontWeight={650}>
                    {block.heading}
                  </Typography>
                  <Typography sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                    {block.text}
                  </Typography>
                </Box>
              ))}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 2 }}
            >
              Generated {new Date(summary.createdAt).toLocaleString()}
            </Typography>
            {canPublish && summary.status === "draft" && (
              <Button
                variant="contained"
                sx={{ mt: 2 }}
                disabled={publishMutation.isPending}
                onClick={() => publishMutation.mutate(summary)}
              >
                {publishMutation.isPending ? "Publishing..." : "Publish to course"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

export function FlashcardsPanel({
  courseId,
  selectedDocumentIds,
  topic,
  canGenerate,
  canPublish = false,
}: PanelProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [count, setCount] = useState("10");
  const [revealed, setRevealed] = useState<{ id: string; cardIds: Set<string> } | null>(
    null,
  );
  const flashcardsQuery = useInfiniteQuery({
    queryKey: ["learning", "flashcards", courseId],
    queryFn: ({ pageParam }) =>
      listCourseFlashcards(courseId, {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const selectedSetQuery = useQuery({
    queryKey: ["learning", "flashcard-set", selectedId],
    queryFn: () => getFlashcardSet(selectedId),
    enabled: Boolean(selectedId),
  });
  const generateMutation = useMutation({
    mutationFn: () =>
      generateFlashcards({
        courseId,
        documentIds: selectedDocumentIds,
        topic,
        count: Number(count),
      }),
    onSuccess: async (set) => {
      setSelectedId(set.id);
      await queryClient.invalidateQueries({
        queryKey: ["learning", "flashcards", courseId],
      });
    },
  });
  const publishMutation = useMutation({
    mutationFn: (set: FlashcardSet) => publishFlashcards(set.id, set.version),
    onSuccess: async (publishedSet) => {
      setSelectedId(publishedSet.id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["learning", "flashcards", courseId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["learning", "flashcard-set", publishedSet.id],
        }),
      ]);
    },
  });
  const sets = flashcardsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const flashcardSet: FlashcardSet | undefined = selectedSetQuery.data;
  const parsedCount = Number(count);
  const validCount =
    Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;
  const revealedIds =
    flashcardSet && revealed?.id === flashcardSet.id
      ? revealed.cardIds
      : new Set<string>();

  return (
    <Stack spacing={2} component="section" aria-labelledby="flashcards-panel-title">
      <Typography id="flashcards-panel-title" component="h2" variant="h5">
        Flashcards
      </Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <TextField
          label="Number of cards"
          type="number"
          size="small"
          value={count}
          onChange={(event) => setCount(event.target.value)}
          inputProps={{ min: 1, max: 50, step: 1 }}
          sx={{ maxWidth: 180 }}
        />
        <Button
          variant="contained"
          disabled={
            !canGenerate ||
            selectedDocumentIds.length === 0 ||
            !validCount ||
            generateMutation.isPending
          }
          onClick={() => generateMutation.mutate()}
        >
          {generateMutation.isPending ? "Generating..." : "Generate flashcards"}
        </Button>
      </Stack>
      {generateMutation.error && (
        <ErrorNotice message={friendlyMessage(generateMutation.error)} />
      )}
      {publishMutation.error && (
        <ErrorNotice message={friendlyMessage(publishMutation.error)} />
      )}
      <SavedContentSelect
        label="Saved flashcard sets"
        value={selectedId}
        onChange={setSelectedId}
        items={sets.map((item) => ({
          id: item.id,
          label: `${item.title} · v${item.version}`,
        }))}
        isLoading={flashcardsQuery.isLoading}
        isError={flashcardsQuery.isError}
        error={flashcardsQuery.error}
        onRetry={() => void flashcardsQuery.refetch()}
      />
      {flashcardsQuery.hasNextPage && (
        <Button
          onClick={() => void flashcardsQuery.fetchNextPage()}
          disabled={flashcardsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {flashcardsQuery.isFetchingNextPage ? "Loading..." : "Load more sets"}
        </Button>
      )}
      {flashcardsQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(flashcardsQuery.error)} />
      )}
      {selectedSetQuery.isLoading && (
        <LinearProgress aria-label="Loading selected flashcards" />
      )}
      {selectedSetQuery.isError && (
        <ErrorNotice message={friendlyMessage(selectedSetQuery.error)} />
      )}
      {flashcardSet && (
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1}
          >
            <Typography component="h3" variant="h6">
              {flashcardSet.title}
            </Typography>
            <Chip label={flashcardSet.status} size="small" />
          </Stack>
          {canPublish && flashcardSet.status === "draft" && (
            <Button
              variant="contained"
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate(flashcardSet)}
              sx={{ alignSelf: "flex-start" }}
            >
              {publishMutation.isPending ? "Publishing..." : "Publish to course"}
            </Button>
          )}
          {flashcardSet.cards.map((card, index) => {
            const isRevealed = revealedIds.has(card.id);
            return (
              <Card key={card.id} variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary" fontWeight={700}>
                    Card {index + 1}
                  </Typography>
                  <Typography fontWeight={650}>{card.front}</Typography>
                  {isRevealed && (
                    <Typography sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                      {card.back}
                    </Typography>
                  )}
                  <Button
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() =>
                      setRevealed((current) => {
                        const cardIds =
                          current?.id === flashcardSet.id
                            ? new Set(current.cardIds)
                            : new Set<string>();
                        if (cardIds.has(card.id)) cardIds.delete(card.id);
                        else cardIds.add(card.id);
                        return { id: flashcardSet.id, cardIds };
                      })
                    }
                  >
                    {isRevealed ? "Hide answer" : "Show answer"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

export function QuizPanel({
  courseId,
  selectedDocumentIds,
  topic,
  canGenerate,
  showGenerator = true,
  courseWideOnly = false,
  title = "Quizzes",
}: PanelProps & {
  showGenerator?: boolean;
  courseWideOnly?: boolean;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [types, setTypes] = useState<Array<"mcq" | "true_false">>(["mcq"]);
  const [quizState, setQuizState] = useState<{
    quizId: string;
    answers: Record<string, string[]>;
    result: QuizAttemptResult | null;
  } | null>(null);
  const quizzesQuery = useInfiniteQuery({
    queryKey: ["learning", "quizzes", courseId],
    queryFn: ({ pageParam }) =>
      listCourseQuizzes(courseId, {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const selectedQuizQuery = useQuery({
    queryKey: ["learning", "quiz", selectedId],
    queryFn: () => getLearnerQuiz(selectedId),
    enabled: Boolean(selectedId),
  });
  const generateMutation = useMutation({
    mutationFn: () =>
      generateQuiz({
        courseId,
        documentIds: selectedDocumentIds,
        topic,
        count: Number(count),
        types,
        difficulty,
      }),
    onSuccess: async (quiz) => {
      setSelectedId(quiz.id);
      setQuizState({ quizId: quiz.id, answers: {}, result: null });
      await queryClient.invalidateQueries({
        queryKey: ["learning", "quizzes", courseId],
      });
    },
  });
  const attemptMutation = useMutation({
    mutationFn: (input: {
      quizId: string;
      answers: Array<
        | { questionId: string; selectedOptionId: string }
        | { questionId: string; selectedOptionIds: string[] }
      >;
    }) => submitQuizAttempt(input.quizId, input.answers),
    onSuccess: (result, input) =>
      setQuizState((current) =>
        current?.quizId === input.quizId ? { ...current, result } : current,
      ),
  });
  const quizzes = quizzesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const availableQuizzes = courseWideOnly
    ? quizzes.filter(
        (item) => item.visibility === "course" && item.status === "published",
      )
    : quizzes;
  const quiz: LearnerQuiz | undefined = selectedQuizQuery.data;
  const parsedCount = Number(count);
  const validCount =
    Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;
  const currentState: NonNullable<typeof quizState> =
    quizState && quizState.quizId === quiz?.id
      ? quizState
      : { quizId: quiz?.id ?? "", answers: {}, result: null };
  const canSubmit = Boolean(
    quiz &&
    quiz.status === "published" &&
    quiz.questions.length > 0 &&
    quiz.questions.every(
      (question) => (currentState.answers[question.id] ?? []).length > 0,
    ) &&
    !attemptMutation.isPending,
  );
  const resultsByQuestion = new Map(
    (currentState.result?.results ?? []).map((result) => [result.questionId, result]),
  );

  function toggleType(type: "mcq" | "true_false", checked: boolean) {
    setTypes((current) => {
      if (checked) return current.includes(type) ? current : [...current, type];
      return current.filter((value) => value !== type);
    });
  }

  return (
    <Stack spacing={2} component="section" aria-labelledby="quiz-panel-title">
      <Typography id="quiz-panel-title" component="h2" variant="h5">
        {title}
      </Typography>
      {showGenerator && (
        <>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                label="Number of questions"
                type="number"
                size="small"
                value={count}
                onChange={(event) => setCount(event.target.value)}
                inputProps={{ min: 1, max: 50, step: 1 }}
                sx={{ maxWidth: 200 }}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="quiz-difficulty-label">Difficulty</InputLabel>
                <Select
                  labelId="quiz-difficulty-label"
                  label="Difficulty"
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(event.target.value as "easy" | "medium" | "hard")
                  }
                >
                  <MenuItem value="easy">Easy</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="hard">Hard</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" spacing={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={types.includes("mcq")}
                    onChange={(event) => toggleType("mcq", event.target.checked)}
                  />
                }
                label="Multiple choice"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={types.includes("true_false")}
                    onChange={(event) => toggleType("true_false", event.target.checked)}
                  />
                }
                label="True or false"
              />
            </Stack>
            {types.length === 0 && (
              <Alert severity="warning">Choose at least one question type.</Alert>
            )}
            <Button
              variant="contained"
              disabled={
                !canGenerate ||
                selectedDocumentIds.length === 0 ||
                !validCount ||
                types.length === 0 ||
                generateMutation.isPending
              }
              onClick={() => generateMutation.mutate()}
              sx={{ alignSelf: "flex-start" }}
            >
              {generateMutation.isPending ? "Generating quiz..." : "Generate quiz"}
            </Button>
          </Stack>
          {generateMutation.error && (
            <ErrorNotice message={friendlyMessage(generateMutation.error)} />
          )}
        </>
      )}
      <SavedContentSelect
        label={courseWideOnly ? "Published course quizzes" : "Available quizzes"}
        emptyMessage={
          courseWideOnly
            ? "No published coach quizzes are available for this course yet."
            : "No quizzes are available yet."
        }
        value={selectedId}
        onChange={(value) => {
          setSelectedId(value);
          setQuizState(null);
        }}
        items={availableQuizzes.map((item) => ({
          id: item.id,
          label: `${item.title} · v${item.version}`,
        }))}
        isLoading={quizzesQuery.isLoading}
        isError={quizzesQuery.isError}
        error={quizzesQuery.error}
        onRetry={() => void quizzesQuery.refetch()}
      />
      {quizzesQuery.hasNextPage && (
        <Button
          onClick={() => void quizzesQuery.fetchNextPage()}
          disabled={quizzesQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {quizzesQuery.isFetchingNextPage ? "Loading..." : "Load more quizzes"}
        </Button>
      )}
      {quizzesQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(quizzesQuery.error)} />
      )}
      {selectedQuizQuery.isLoading && <LinearProgress aria-label="Loading quiz" />}
      {selectedQuizQuery.isError && (
        <ErrorNotice message={friendlyMessage(selectedQuizQuery.error)} />
      )}
      {attemptMutation.error && (
        <ErrorNotice message={friendlyMessage(attemptMutation.error)} />
      )}
      {quiz && (
        <Stack spacing={2}>
          <Box>
            <Typography component="h3" variant="h6">
              {quiz.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {quiz.questions.length} questions
            </Typography>
            {quiz.description && (
              <Typography sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                {quiz.description}
              </Typography>
            )}
          </Box>
          {currentState.result && (
            <Alert severity="success" role="status">
              Score: {currentState.result.attempt.score} of{" "}
              {currentState.result.attempt.maxScore}
            </Alert>
          )}
          {quiz.status !== "published" && (
            <Alert severity="info">
              This quiz is not published and cannot be submitted.
            </Alert>
          )}
          {quiz.questions.map((question, index) => {
            const result = resultsByQuestion.get(question.id);
            return (
              <Box
                key={question.id}
                component="section"
                aria-labelledby={`quiz-question-${index}`}
                sx={{ pt: 2, borderTop: 1, borderColor: "divider" }}
              >
                <Typography
                  id={`quiz-question-${index}`}
                  component="h4"
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ mb: 1 }}
                >
                  Question {index + 1} ·{" "}
                  {question.type === "mcq"
                    ? "Single choice"
                    : question.type === "multiple_choice"
                      ? "Multiple choice"
                      : "True or false"}
                </Typography>
                <Typography fontWeight={650} sx={{ mb: 1 }}>
                  {question.prompt}
                </Typography>
                {question.type === "multiple_choice" ? (
                  <FormGroup aria-label={`Answers for question ${index + 1}`}>
                    {question.options.map((option) => (
                      <FormControlLabel
                        key={option.id}
                        control={
                          <Checkbox
                            checked={(currentState.answers[question.id] ?? []).includes(
                              option.id,
                            )}
                            onChange={(event) => {
                              const selected = new Set(
                                currentState.answers[question.id] ?? [],
                              );
                              if (event.target.checked) selected.add(option.id);
                              else selected.delete(option.id);
                              setQuizState({
                                quizId: quiz.id,
                                answers: {
                                  ...currentState.answers,
                                  [question.id]: [...selected],
                                },
                                result: null,
                              });
                            }}
                            disabled={
                              Boolean(currentState.result) ||
                              quiz.status !== "published"
                            }
                          />
                        }
                        label={option.text}
                      />
                    ))}
                  </FormGroup>
                ) : (
                  <RadioGroup
                    aria-label={`Answer for question ${index + 1}`}
                    value={(currentState.answers[question.id] ?? [])[0] ?? ""}
                    onChange={(event) =>
                      setQuizState({
                        quizId: quiz.id,
                        answers: {
                          ...currentState.answers,
                          [question.id]: [event.target.value],
                        },
                        result: null,
                      })
                    }
                  >
                    {question.options.map((option) => (
                      <FormControlLabel
                        key={option.id}
                        value={option.id}
                        control={<Radio />}
                        disabled={
                          Boolean(currentState.result) || quiz.status !== "published"
                        }
                        label={option.text}
                      />
                    ))}
                  </RadioGroup>
                )}
                {result && (
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    <Chip
                      label={result.correct ? "Correct" : "Incorrect"}
                      color={result.correct ? "success" : "error"}
                      size="small"
                      sx={{ alignSelf: "flex-start" }}
                    />
                    {!result.correct && (
                      <Typography variant="body2">
                        Correct answer{question.type === "multiple_choice" ? "s" : ""}:{" "}
                        {"correctOptionIds" in result
                          ? question.options
                              .filter((option) =>
                                result.correctOptionIds.includes(option.id),
                              )
                              .map((option) => option.text)
                              .join(", ") || "Unavailable"
                          : (question.options.find(
                              (option) => option.id === result.correctOptionId,
                            )?.text ?? "Unavailable")}
                      </Typography>
                    )}
                    <Typography variant="body2">{result.explanation}</Typography>
                  </Stack>
                )}
              </Box>
            );
          })}
          {currentState.result ? (
            <Button
              variant="outlined"
              onClick={() =>
                setQuizState({ quizId: quiz.id, answers: {}, result: null })
              }
              sx={{ alignSelf: "flex-start" }}
            >
              Try again
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={!canSubmit}
              onClick={() => {
                if (!quiz) return;
                attemptMutation.mutate({
                  quizId: quiz.id,
                  answers: quiz.questions.map((question) =>
                    question.type === "multiple_choice"
                      ? {
                          questionId: question.id,
                          selectedOptionIds: currentState.answers[question.id] ?? [],
                        }
                      : {
                          questionId: question.id,
                          selectedOptionId:
                            (currentState.answers[question.id] ?? [])[0] ?? "",
                        },
                  ),
                });
              }}
              sx={{ alignSelf: "flex-start" }}
            >
              {attemptMutation.isPending ? "Submitting..." : "Submit answers"}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function SavedContentSelect({
  label,
  value,
  onChange,
  items,
  isLoading,
  isError,
  error,
  onRetry,
  emptyMessage,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  items: Array<{ id: string; label: string }>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry(): void;
  emptyMessage?: string;
}) {
  const labelId = `saved-content-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (isLoading)
    return <LinearProgress aria-label={`Loading ${label.toLowerCase()}`} />;
  if (isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(error)} />
        <Button onClick={onRetry}>Retry</Button>
      </Stack>
    );
  }
  if (items.length === 0) {
    return (
      <Alert severity="info">
        {emptyMessage ?? "No saved content yet. Generate some from selected documents."}
      </Alert>
    );
  }

  return (
    <FormControl fullWidth size="small">
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <MenuItem value="">Select saved content</MenuItem>
        {items.map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {item.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
