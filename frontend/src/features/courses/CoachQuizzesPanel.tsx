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
  createManualQuiz,
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
type EditableQuiz = Pick<
  CoachQuiz,
  "id" | "version" | "title" | "description" | "status"
> & {
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
    description: quiz.description,
    status: quiz.status,
    questions: quiz.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      sourceChunkIds: [...question.sourceChunkIds],
      ...(question.type === "multiple_choice"
        ? { correctOptionIds: [...question.correctOptionIds] }
        : {}),
    })),
  };
}

function questionContent(question: CoachQuizQuestion) {
  const common = {
    type: question.type,
    prompt: question.prompt,
    options: question.options.map(({ id, text }) => ({ id, text })),
    explanation: question.explanation,
  };
  if (question.type === "multiple_choice") {
    return { ...common, correctOptionIds: question.correctOptionIds };
  }
  return {
    ...common,
    correctOptionId: question.correctOptionId,
    sourceChunkIds: question.sourceChunkIds,
  };
}

function optionId(): string {
  return crypto.randomUUID();
}

function createQuestion(type: CoachQuizQuestion["type"]): CoachQuizQuestion {
  const id = optionId();
  const options =
    type === "true_false"
      ? [
          { id: "true", text: "True" },
          { id: "false", text: "False" },
        ]
      : [
          { id: optionId(), text: "" },
          { id: optionId(), text: "" },
        ];
  if (type === "multiple_choice") {
    return {
      id,
      type,
      prompt: "",
      options,
      correctOptionIds: [],
      explanation: "",
      sourceChunkIds: [],
    };
  }
  return {
    id,
    type,
    prompt: "",
    options,
    correctOptionId: "",
    explanation: "",
    sourceChunkIds: [],
  };
}

function isQuestionValid(question: CoachQuizQuestion): boolean {
  const optionIds = question.options.map((option) => option.id);
  if (
    !question.prompt.trim() ||
    question.options.length < 2 ||
    question.options.length > 5 ||
    new Set(optionIds).size !== optionIds.length ||
    question.options.some((option) => !option.text.trim())
  ) {
    return false;
  }
  if (question.type === "multiple_choice") {
    return (
      question.correctOptionIds.length > 0 &&
      new Set(question.correctOptionIds).size === question.correctOptionIds.length &&
      question.correctOptionIds.every((id) => optionIds.includes(id))
    );
  }
  if (question.type === "true_false") {
    return (
      optionIds.length === 2 &&
      optionIds.includes("true") &&
      optionIds.includes("false") &&
      Boolean(question.correctOptionId) &&
      optionIds.includes(question.correctOptionId ?? "")
    );
  }
  return (
    Boolean(question.correctOptionId) &&
    optionIds.includes(question.correctOptionId ?? "")
  );
}

export function CoachQuizzesPanel({ courseId, canGenerate }: CoachQuizzesPanelProps) {
  const queryClient = useQueryClient();
  const [creationMethod, setCreationMethod] = useState<"ai" | "manual">("ai");
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [types, setTypes] = useState<Array<"mcq" | "true_false">>(["mcq"]);
  const [draft, setDraft] = useState<EditableQuiz | null>(null);
  const [preview, setPreview] = useState(false);

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
  const manualDraft =
    coachQuiz !== undefined && coachQuiz.sourceDocumentIds.length === 0;

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
  const createManualMutation = useMutation({
    mutationFn: () =>
      createManualQuiz({
        courseId,
        title: manualTitle,
        description: manualDescription,
        questions: [],
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
  const saveMutation = useMutation({
    mutationFn: (input: EditableQuiz) =>
      updateCoachQuiz(input.id, {
        version: input.version,
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
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
      currentDraft.description !== coachQuiz.description ||
      JSON.stringify(currentDraft.questions.map(questionContent)) !==
        JSON.stringify(coachQuiz.questions.map(questionContent))),
  );
  const validDraft = Boolean(
    currentDraft &&
    currentDraft.title.trim() &&
    currentDraft.questions.length > 0 &&
    currentDraft.questions.every(
      (question) =>
        isQuestionValid(question) &&
        (manualDraft || Boolean(question.explanation?.trim())),
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

  function updateQuestion(
    index: number,
    update: (question: CoachQuizQuestion) => CoachQuizQuestion,
  ) {
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
              questionIndex === index ? update(question) : question,
            ),
          }
        : current;
    });
  }

  function addQuestion() {
    setDraft((current) => {
      const base = current ?? (coachQuiz ? toEditableQuiz(coachQuiz) : null);
      return base
        ? { ...base, questions: [...base.questions, createQuestion("mcq")] }
        : current;
    });
  }

  function removeQuestion(index: number) {
    setDraft((current) => {
      const base = current ?? (coachQuiz ? toEditableQuiz(coachQuiz) : null);
      return base
        ? {
            ...base,
            questions: base.questions.filter(
              (_question, questionIndex) => questionIndex !== index,
            ),
          }
        : current;
    });
  }

  function moveQuestion(index: number, offset: -1 | 1) {
    setDraft((current) => {
      const base = current ?? (coachQuiz ? toEditableQuiz(coachQuiz) : null);
      const target = index + offset;
      if (!base || target < 0 || target >= base.questions.length) return current;
      const questions = [...base.questions];
      const currentQuestion = questions[index];
      const targetQuestion = questions[target];
      if (!currentQuestion || !targetQuestion) return current;
      questions[index] = targetQuestion;
      questions[target] = currentQuestion;
      return { ...base, questions };
    });
  }

  function changeQuestionType(index: number, type: CoachQuizQuestion["type"]) {
    updateQuestion(index, (question) => ({
      ...createQuestion(type),
      id: question.id,
      prompt: question.prompt,
      explanation: question.explanation ?? "",
      sourceChunkIds: [...question.sourceChunkIds],
    }));
  }

  function setCorrectOption(index: number, optionId: string, checked: boolean) {
    updateQuestion(index, (question) => {
      if (question.type === "multiple_choice") {
        const correctOptionIds = checked
          ? [...new Set([...question.correctOptionIds, optionId])]
          : question.correctOptionIds.filter((id) => id !== optionId);
        return { ...question, correctOptionIds };
      }
      return { ...question, correctOptionId: checked ? optionId : "" };
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
          Choose how to create a course quiz. Drafts are not visible to learners until
          published.
        </Typography>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant={creationMethod === "ai" ? "contained" : "outlined"}
          onClick={() => setCreationMethod("ai")}
        >
          Generate with AI
        </Button>
        <Button
          variant={creationMethod === "manual" ? "contained" : "outlined"}
          onClick={() => setCreationMethod("manual")}
        >
          Create manually
        </Button>
      </Stack>

      {creationMethod === "ai" && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography component="h3" variant="h6">
                Generate a quiz draft
              </Typography>
              {!canGenerate && (
                <Alert severity="warning">
                  Your account can review existing quizzes but cannot generate new
                  drafts.
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
                      onChange={(event) =>
                        toggleType("true_false", event.target.checked)
                      }
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
      )}

      {creationMethod === "manual" && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography component="h3" variant="h6">
                Create a quiz manually
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This quiz will be linked to the course currently open. Manual quiz
                creation does not use AI or require course documents.
              </Typography>
              {!canGenerate && (
                <Alert severity="warning">
                  Your account can review quizzes but cannot create new drafts.
                </Alert>
              )}
              <TextField
                label="Quiz title"
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                inputProps={{ maxLength: 200 }}
                disabled={!canGenerate}
                required
              />
              <TextField
                label="Instructions or description"
                value={manualDescription}
                onChange={(event) => setManualDescription(event.target.value)}
                inputProps={{ maxLength: 2000 }}
                multiline
                minRows={2}
                disabled={!canGenerate}
              />
              <Button
                variant="contained"
                onClick={() => createManualMutation.mutate()}
                disabled={
                  !canGenerate || !manualTitle.trim() || createManualMutation.isPending
                }
                sx={{ alignSelf: "flex-start" }}
              >
                {createManualMutation.isPending
                  ? "Creating draft..."
                  : "Create manual draft"}
              </Button>
              {createManualMutation.error && (
                <ErrorNotice message={friendlyMessage(createManualMutation.error)} />
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

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
              <TextField
                label="Instructions or description"
                value={currentDraft.description ?? ""}
                onChange={(event) =>
                  setDraft((current) => {
                    const base =
                      current &&
                      current.id === coachQuiz.id &&
                      current.version === coachQuiz.version
                        ? current
                        : toEditableQuiz(coachQuiz);
                    return { ...base, description: event.target.value };
                  })
                }
                inputProps={{ maxLength: 2000 }}
                multiline
                minRows={2}
                disabled={coachQuiz.status === "superseded" || preview}
              />
              <Button
                variant="outlined"
                onClick={() => setPreview((current) => !current)}
                sx={{ alignSelf: "flex-start" }}
              >
                {preview ? "Return to editing" : "Preview quiz"}
              </Button>
              {currentDraft.questions.map((question, index) => (
                <Box
                  key={question.id}
                  component="section"
                  aria-labelledby={`draft-question-${index}`}
                  sx={{ pt: 2, borderTop: 1, borderColor: "divider" }}
                >
                  <Stack spacing={1.5}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      justifyContent="space-between"
                      alignItems={{ xs: "stretch", sm: "center" }}
                      spacing={1}
                    >
                      <Typography
                        id={`draft-question-${index}`}
                        component="h4"
                        variant="subtitle1"
                        fontWeight={700}
                      >
                        Question {index + 1}
                      </Typography>
                      {!preview && manualDraft && coachQuiz.status !== "superseded" && (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                          <Button
                            size="small"
                            onClick={() => moveQuestion(index, -1)}
                            disabled={index === 0}
                          >
                            Move up
                          </Button>
                          <Button
                            size="small"
                            onClick={() => moveQuestion(index, 1)}
                            disabled={index === currentDraft.questions.length - 1}
                          >
                            Move down
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => removeQuestion(index)}
                          >
                            Delete
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                    {preview ? (
                      <>
                        <Typography>{question.prompt || "Question text"}</Typography>
                        <Box component="ul" sx={{ my: 0, pl: 3 }}>
                          {question.options.map((option) => (
                            <Typography key={option.id} component="li">
                              {option.text || "Answer option"}
                            </Typography>
                          ))}
                        </Box>
                      </>
                    ) : (
                      <>
                        <FormControl size="small">
                          <InputLabel id={`question-type-${index}`}>
                            Question type
                          </InputLabel>
                          <Select
                            labelId={`question-type-${index}`}
                            label="Question type"
                            value={question.type}
                            onChange={(event) =>
                              changeQuestionType(
                                index,
                                event.target.value as CoachQuizQuestion["type"],
                              )
                            }
                            disabled={coachQuiz.status === "superseded" || !manualDraft}
                          >
                            <MenuItem value="mcq">Single choice</MenuItem>
                            <MenuItem value="multiple_choice">Multiple choice</MenuItem>
                            <MenuItem value="true_false">True/False</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          label={`Question ${index + 1}`}
                          value={question.prompt}
                          onChange={(event) =>
                            updateQuestion(index, (current) => ({
                              ...current,
                              prompt: event.target.value,
                            }))
                          }
                          multiline
                          inputProps={{ maxLength: 2000 }}
                          disabled={coachQuiz.status === "superseded"}
                        />
                        {question.type === "multiple_choice" ? (
                          <FormGroup
                            aria-label={`Correct answers for question ${index + 1}`}
                          >
                            {question.options.map((option, optionIndex) => (
                              <Stack
                                key={option.id}
                                direction={{ xs: "column", sm: "row" }}
                                spacing={1}
                                alignItems={{ xs: "stretch", sm: "center" }}
                              >
                                <FormControlLabel
                                  control={
                                    <Checkbox
                                      checked={question.correctOptionIds.includes(
                                        option.id,
                                      )}
                                      onChange={(event) =>
                                        setCorrectOption(
                                          index,
                                          option.id,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                  }
                                  label={`Correct option ${optionIndex + 1}`}
                                  disabled={coachQuiz.status === "superseded"}
                                />
                                <TextField
                                  label={`Option ${optionIndex + 1}`}
                                  value={option.text}
                                  onChange={(event) =>
                                    updateQuestion(index, (current) => ({
                                      ...current,
                                      options: current.options.map((item) =>
                                        item.id === option.id
                                          ? { ...item, text: event.target.value }
                                          : item,
                                      ),
                                    }))
                                  }
                                  inputProps={{ maxLength: 500 }}
                                  fullWidth
                                  disabled={coachQuiz.status === "superseded"}
                                />
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() =>
                                    updateQuestion(index, (current) => ({
                                      ...current,
                                      options: current.options.filter(
                                        (item) => item.id !== option.id,
                                      ),
                                      correctOptionIds:
                                        current.type === "multiple_choice"
                                          ? current.correctOptionIds.filter(
                                              (id) => id !== option.id,
                                            )
                                          : [],
                                    }))
                                  }
                                  disabled={
                                    coachQuiz.status === "superseded" || !manualDraft
                                  }
                                >
                                  Remove option
                                </Button>
                              </Stack>
                            ))}
                          </FormGroup>
                        ) : (
                          <RadioGroup
                            aria-label={`Correct answer for question ${index + 1}`}
                            value={question.correctOptionId ?? ""}
                            onChange={(event) =>
                              setCorrectOption(index, event.target.value, true)
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
                                    updateQuestion(index, (current) => ({
                                      ...current,
                                      options: current.options.map((item) =>
                                        item.id === option.id
                                          ? { ...item, text: event.target.value }
                                          : item,
                                      ),
                                    }))
                                  }
                                  inputProps={{ maxLength: 500 }}
                                  fullWidth
                                  disabled={
                                    coachQuiz.status === "superseded" ||
                                    question.type === "true_false"
                                  }
                                />
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() =>
                                    updateQuestion(index, (current) => ({
                                      ...current,
                                      options: current.options.filter(
                                        (item) => item.id !== option.id,
                                      ),
                                      correctOptionId:
                                        current.type === "multiple_choice"
                                          ? ""
                                          : current.correctOptionId === option.id
                                            ? ""
                                            : current.correctOptionId,
                                    }))
                                  }
                                  disabled={
                                    coachQuiz.status === "superseded" ||
                                    !manualDraft ||
                                    question.type === "true_false"
                                  }
                                >
                                  Remove option
                                </Button>
                              </Stack>
                            ))}
                          </RadioGroup>
                        )}
                        {manualDraft &&
                          question.type !== "true_false" &&
                          question.options.length < 5 && (
                            <Button
                              variant="outlined"
                              onClick={() =>
                                updateQuestion(index, (current) => ({
                                  ...current,
                                  options: [
                                    ...current.options,
                                    { id: optionId(), text: "" },
                                  ],
                                }))
                              }
                              disabled={coachQuiz.status === "superseded"}
                              sx={{ alignSelf: "flex-start" }}
                            >
                              Add answer option
                            </Button>
                          )}
                        <TextField
                          label={`Optional explanation ${index + 1}`}
                          value={question.explanation ?? ""}
                          onChange={(event) =>
                            updateQuestion(index, (current) => ({
                              ...current,
                              explanation: event.target.value,
                            }))
                          }
                          multiline
                          inputProps={{ maxLength: 2000 }}
                          disabled={coachQuiz.status === "superseded"}
                        />
                      </>
                    )}
                  </Stack>
                </Box>
              ))}
              {!preview && manualDraft && coachQuiz.status !== "superseded" && (
                <Button
                  variant="outlined"
                  onClick={addQuestion}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Add question
                </Button>
              )}
              <Box>
                <Button
                  variant="outlined"
                  onClick={() => saveMutation.mutate(currentDraft)}
                  disabled={
                    !draftIsDirty ||
                    !currentDraft.title.trim() ||
                    (!manualDraft && !validDraft) ||
                    saveMutation.isPending ||
                    coachQuiz.status === "superseded"
                  }
                >
                  {saveMutation.isPending
                    ? "Saving..."
                    : manualDraft && coachQuiz.status === "draft"
                      ? "Save draft"
                      : "Save changes"}
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
