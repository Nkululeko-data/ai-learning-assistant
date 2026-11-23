import { useMemo, useState } from "react";
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
  generateQuiz,
  getCourseQuiz,
  listCourseQuizzes,
  publishQuiz,
  updateCoachQuiz,
  type CoachQuiz,
  type CourseQuiz,
} from "../../api/learning";
import { listCourseDocuments } from "../../api/documents";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

type CoachQuizQuestion = CoachQuiz["questions"][number];
type EditableQuiz = Pick<CoachQuiz, "id" | "version" | "title" | "status"> & {
  questions: CoachQuizQuestion[];
};

interface CoachQuizzesPanelProps {
  courseId: string;
  canGenerate: boolean;
}

function isCoachQuiz(quiz: CourseQuiz): quiz is CoachQuiz {
  return "createdBy" in quiz;
}

function toEditableQuiz(quiz: CoachQuiz): EditableQuiz {
  return {
    id: quiz.id,
    version: quiz.version,
    title: quiz.title,
    status: quiz.status,
    questions: quiz.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      sourceChunkIds: [...question.sourceChunkIds],
    })),
  };
}

function questionContent(question: CoachQuizQuestion) {
  return {
    type: question.type,
    prompt: question.prompt,
    options: question.options.map(({ id, text }) => ({ id, text })),
    correctOptionId: question.correctOptionId,
    explanation: question.explanation,
    sourceChunkIds: question.sourceChunkIds,
  };
}

export function CoachQuizzesPanel({ courseId, canGenerate }: CoachQuizzesPanelProps) {
  const queryClient = useQueryClient();
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [types, setTypes] = useState<Array<"mcq" | "true_false">>(["mcq"]);
  const [draft, setDraft] = useState<EditableQuiz | null>(null);

  const documentsQuery = useInfiniteQuery({
    queryKey: ["documents", "coach-quizzes", courseId],
    queryFn: ({ pageParam }) =>
      listCourseDocuments(courseId, {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: canGenerate,
  });
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
    queryKey: ["learning", "course-quiz", selectedQuizId],
    queryFn: () => getCourseQuiz(selectedQuizId),
    enabled: Boolean(selectedQuizId),
  });

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data],
  );
  const readyDocuments = documents.filter(
    (document) => document.status === "ready" && document.mimeType !== "video/mp4",
  );
  const quizzes = quizzesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedQuiz = selectedQuizQuery.data;
  const coachQuiz =
    selectedQuiz && isCoachQuiz(selectedQuiz) ? selectedQuiz : undefined;
  const currentDraft =
    coachQuiz && draft?.id === coachQuiz.id && draft.version === coachQuiz.version
      ? draft
      : coachQuiz
        ? toEditableQuiz(coachQuiz)
        : null;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const generated = await generateQuiz({
        courseId,
        documentIds: selectedDocumentIds,
        topic,
        count: Number(count),
        types,
        difficulty,
      });
      if (!isCoachQuiz(generated)) {
        throw new Error("The generated quiz was not returned as a coach draft.");
      }
      return generated;
    },
    onSuccess: async (quiz) => {
      setSelectedQuizId(quiz.id);
      setDraft(toEditableQuiz(quiz));
      queryClient.setQueryData(["learning", "course-quiz", quiz.id], quiz);
      await queryClient.invalidateQueries({
        queryKey: ["learning", "quizzes", courseId],
      });
    },
  });
  const saveMutation = useMutation({
    mutationFn: (input: EditableQuiz) =>
      updateCoachQuiz(input.id, {
        version: input.version,
        title: input.title,
        questions: input.questions,
      }),
    onSuccess: async (quiz) => {
      setSelectedQuizId(quiz.id);
      setDraft(toEditableQuiz(quiz));
      queryClient.setQueryData(["learning", "course-quiz", quiz.id], quiz);
      await queryClient.invalidateQueries({
        queryKey: ["learning", "quizzes", courseId],
      });
    },
  });
  const publishMutation = useMutation({
    mutationFn: (quiz: CoachQuiz) => publishQuiz(quiz.id, quiz.version),
    onSuccess: async (quiz) => {
      setDraft(toEditableQuiz(quiz));
      queryClient.setQueryData(["learning", "course-quiz", quiz.id], quiz);
      await queryClient.invalidateQueries({
        queryKey: ["learning", "quizzes", courseId],
      });
    },
  });

  const parsedCount = Number(count);
  const validCount =
    Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;
  const draftIsDirty = Boolean(
    coachQuiz &&
    currentDraft &&
    (currentDraft.title !== coachQuiz.title ||
      JSON.stringify(currentDraft.questions.map(questionContent)) !==
        JSON.stringify(coachQuiz.questions.map(questionContent))),
  );
  const validDraft = Boolean(
    currentDraft &&
    currentDraft.title.trim() &&
    currentDraft.questions.length > 0 &&
    currentDraft.questions.every(
      (question) =>
        question.prompt.trim() &&
        question.explanation.trim() &&
        question.options.length >= 2 &&
        question.options.every((option) => option.text.trim()) &&
        question.options.some((option) => option.id === question.correctOptionId),
    ),
  );

  function toggleDocument(documentId: string, checked: boolean) {
    setSelectedDocumentIds((current) => {
      if (checked) {
        if (current.length >= 10 || current.includes(documentId)) return current;
        return [...current, documentId];
      }
      return current.filter((id) => id !== documentId);
    });
  }

  function updateQuestion(index: number, patch: Partial<CoachQuizQuestion>) {
    setDraft((current) => {
      const base =
        current && current.id === coachQuiz?.id && current.version === coachQuiz.version
          ? current
          : coachQuiz
            ? toEditableQuiz(coachQuiz)
            : null;
      return base
        ? {
            ...base,
            questions: base.questions.map((question, questionIndex) =>
              questionIndex === index ? { ...question, ...patch } : question,
            ),
          }
        : current;
    });
  }

  function toggleType(type: "mcq" | "true_false", checked: boolean) {
    setTypes((current) => {
      if (checked) return current.includes(type) ? current : [...current, type];
      return current.filter((value) => value !== type);
    });
  }

  return (
    <Stack
      component="section"
      spacing={2}
      aria-labelledby="coach-quizzes-title"
      id="course-quizzes"
    >
      <Box>
        <Typography
          id="coach-quizzes-title"
          component="h2"
          variant="h5"
          fontWeight={700}
        >
          Course quizzes
        </Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
          Generate a draft from course material, review the questions, then publish it
          for learners.
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h3" variant="h6">
              Generate a quiz draft
            </Typography>
            {!canGenerate && (
              <Alert severity="warning">
                Your account can review existing quizzes but cannot generate new drafts.
              </Alert>
            )}
            {documentsQuery.isLoading && (
              <LinearProgress aria-label="Loading quiz source documents" />
            )}
            {documentsQuery.isError && (
              <Stack spacing={1} alignItems="flex-start">
                <ErrorNotice message={friendlyMessage(documentsQuery.error)} />
                <Button onClick={() => void documentsQuery.refetch()}>
                  Retry course documents
                </Button>
              </Stack>
            )}
            {!documentsQuery.isLoading &&
              !documentsQuery.isError &&
              readyDocuments.length === 0 && (
                <Alert severity="info">
                  Add and process course documents before generating a quiz.
                </Alert>
              )}
            {readyDocuments.length > 0 && (
              <>
                <FormGroup>
                  {readyDocuments.map((document) => (
                    <FormControlLabel
                      key={document.id}
                      control={
                        <Checkbox
                          checked={selectedDocumentIds.includes(document.id)}
                          disabled={
                            !selectedDocumentIds.includes(document.id) &&
                            selectedDocumentIds.length >= 10
                          }
                          onChange={(event) =>
                            toggleDocument(document.id, event.target.checked)
                          }
                        />
                      }
                      label={document.filename}
                    />
                  ))}
                </FormGroup>
                {documentsQuery.hasNextPage && (
                  <Button
                    onClick={() => void documentsQuery.fetchNextPage()}
                    disabled={documentsQuery.isFetchingNextPage}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    {documentsQuery.isFetchingNextPage
                      ? "Loading..."
                      : "Load more documents"}
                  </Button>
                )}
              </>
            )}
            {documentsQuery.isFetchNextPageError && (
              <ErrorNotice message={friendlyMessage(documentsQuery.error)} />
            )}
            <TextField
              label="Optional topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              inputProps={{ maxLength: 200 }}
              helperText="Leave blank to cover the selected material."
              disabled={!canGenerate}
            />
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
                disabled={!canGenerate}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="coach-quiz-difficulty-label">Difficulty</InputLabel>
                <Select
                  labelId="coach-quiz-difficulty-label"
                  label="Difficulty"
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(event.target.value as "easy" | "medium" | "hard")
                  }
                  disabled={!canGenerate}
                >
                  <MenuItem value="easy">Easy</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="hard">Hard</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={types.includes("mcq")}
                    onChange={(event) => toggleType("mcq", event.target.checked)}
                    disabled={!canGenerate}
                  />
                }
                label="Multiple choice"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={types.includes("true_false")}
                    onChange={(event) => toggleType("true_false", event.target.checked)}
                    disabled={!canGenerate}
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
              onClick={() => generateMutation.mutate()}
              disabled={
                !canGenerate ||
                selectedDocumentIds.length === 0 ||
                !validCount ||
                types.length === 0 ||
                generateMutation.isPending
              }
              sx={{ alignSelf: "flex-start" }}
            >
              {generateMutation.isPending ? "Generating draft..." : "Generate draft"}
            </Button>
            {generateMutation.error && (
              <ErrorNotice message={friendlyMessage(generateMutation.error)} />
            )}
          </Stack>
        </CardContent>
      </Card>

      <FormControl fullWidth>
        <InputLabel id="saved-course-quizzes-label">Saved course quizzes</InputLabel>
        <Select
          labelId="saved-course-quizzes-label"
          label="Saved course quizzes"
          value={selectedQuizId}
          onChange={(event) => {
            setSelectedQuizId(event.target.value);
            setDraft(null);
          }}
        >
          <MenuItem value="">Select a quiz</MenuItem>
          {quizzes.map((quiz) => (
            <MenuItem key={quiz.id} value={quiz.id}>
              {quiz.title} · v{quiz.version} · {quiz.status}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {quizzesQuery.isLoading && <LinearProgress aria-label="Loading course quizzes" />}
      {quizzesQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(quizzesQuery.error)} />
          <Button onClick={() => void quizzesQuery.refetch()}>Retry quizzes</Button>
        </Stack>
      )}
      {quizzesQuery.isSuccess && quizzes.length === 0 && (
        <Typography color="text.secondary">
          No course quizzes yet. Your generated drafts will appear here.
        </Typography>
      )}
      {quizzesQuery.hasNextPage && (
        <Button
          onClick={() => void quizzesQuery.fetchNextPage()}
          disabled={quizzesQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {quizzesQuery.isFetchingNextPage ? "Loading..." : "Load more quizzes"}
        </Button>
      )}
      {selectedQuizQuery.isLoading && (
        <LinearProgress aria-label="Loading selected course quiz" />
      )}
      {selectedQuizQuery.isError && (
        <ErrorNotice message={friendlyMessage(selectedQuizQuery.error)} />
      )}
      {selectedQuiz && !coachQuiz && (
        <Alert severity="info">
          This quiz is not a coach-authored quiz and cannot be edited here.
        </Alert>
      )}
      {coachQuiz && currentDraft && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "flex-start", sm: "center" }}
              >
                <Typography component="h3" variant="h6">
                  Review quiz
                </Typography>
                <Chip
                  size="small"
                  label={coachQuiz.status}
                  color={coachQuiz.status === "published" ? "success" : "default"}
                />
              </Stack>
              {coachQuiz.status === "draft" ? (
                <Alert severity="info">
                  Drafts are not visible to learners until published.
                </Alert>
              ) : coachQuiz.status === "published" ? (
                <Alert severity="success">This quiz is available to learners.</Alert>
              ) : (
                <Alert severity="warning">
                  This quiz version has been replaced and is read-only.
                </Alert>
              )}
              <TextField
                label="Quiz title"
                value={currentDraft.title}
                onChange={(event) =>
                  setDraft((current) => {
                    const base =
                      current &&
                      current.id === coachQuiz.id &&
                      current.version === coachQuiz.version
                        ? current
                        : toEditableQuiz(coachQuiz);
                    return { ...base, title: event.target.value };
                  })
                }
                inputProps={{ maxLength: 200 }}
                disabled={coachQuiz.status === "superseded"}
              />
              {currentDraft.questions.map((question, index) => (
                <Box
                  key={question.id}
                  component="section"
                  aria-labelledby={`draft-question-${index}`}
                  sx={{ pt: 2, borderTop: 1, borderColor: "divider" }}
                >
                  <Stack spacing={1.5}>
                    <Typography
                      id={`draft-question-${index}`}
                      component="h4"
                      variant="subtitle1"
                      fontWeight={700}
                    >
                      Question {index + 1} ·{" "}
                      {question.type === "mcq" ? "Multiple choice" : "True or false"}
                    </Typography>
                    <TextField
                      label={`Question ${index + 1}`}
                      value={question.prompt}
                      onChange={(event) =>
                        updateQuestion(index, { prompt: event.target.value })
                      }
                      multiline
                      inputProps={{ maxLength: 2000 }}
                      disabled={coachQuiz.status === "superseded"}
                    />
                    <RadioGroup
                      aria-label={`Correct answer for question ${index + 1}`}
                      value={question.correctOptionId}
                      onChange={(event) =>
                        updateQuestion(index, {
                          correctOptionId: event.target.value,
                        })
                      }
                    >
                      {question.options.map((option, optionIndex) => (
                        <Stack
                          key={option.id}
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          alignItems={{ xs: "stretch", sm: "center" }}
                        >
                          <FormControlLabel
                            value={option.id}
                            control={<Radio />}
                            label={`Correct option ${optionIndex + 1}`}
                            disabled={coachQuiz.status === "superseded"}
                          />
                          <TextField
                            label={`Option ${optionIndex + 1}`}
                            value={option.text}
                            onChange={(event) =>
                              updateQuestion(index, {
                                options: question.options.map((currentOption) =>
                                  currentOption.id === option.id
                                    ? { ...currentOption, text: event.target.value }
                                    : currentOption,
                                ),
                              })
                            }
                            inputProps={{ maxLength: 500 }}
                            fullWidth
                            disabled={coachQuiz.status === "superseded"}
                          />
                        </Stack>
                      ))}
                    </RadioGroup>
                    <TextField
                      label={`Explanation ${index + 1}`}
                      value={question.explanation}
                      onChange={(event) =>
                        updateQuestion(index, { explanation: event.target.value })
                      }
                      multiline
                      inputProps={{ maxLength: 2000 }}
                      disabled={coachQuiz.status === "superseded"}
                    />
                  </Stack>
                </Box>
              ))}
              <Box>
                <Button
                  variant="outlined"
                  onClick={() => saveMutation.mutate(currentDraft)}
                  disabled={
                    !draftIsDirty ||
                    !validDraft ||
                    saveMutation.isPending ||
                    coachQuiz.status === "superseded"
                  }
                >
                  {saveMutation.isPending ? "Saving..." : "Save changes"}
                </Button>
                {coachQuiz.status === "draft" && (
                  <Button
                    variant="contained"
                    onClick={() => publishMutation.mutate(coachQuiz)}
                    disabled={draftIsDirty || !validDraft || publishMutation.isPending}
                    sx={{ ml: 1 }}
                  >
                    {publishMutation.isPending
                      ? "Publishing..."
                      : "Publish for learners"}
                  </Button>
                )}
              </Box>
              {saveMutation.error && (
                <ErrorNotice message={friendlyMessage(saveMutation.error)} />
              )}
              {publishMutation.error && (
                <ErrorNotice message={friendlyMessage(publishMutation.error)} />
              )}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
