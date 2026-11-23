import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";
import { getCourse } from "../../api/courses";
import { listCourseDocuments } from "../../api/documents";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { isCourseView } from "../courses/course-utils";
import { FlashcardsPanel, QuizPanel, SummaryPanel } from "./StudyContentPanels";

type StudyTab = "summary" | "flashcards" | "quiz";

function isStudyTab(value: string | null): value is StudyTab {
  return value === "summary" || value === "flashcards" || value === "quiz";
}

export function LearningWorkspacePage() {
  const { courseId = "" } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");

  const courseQuery = useQuery({
    queryKey: ["courses", "detail", courseId],
    queryFn: () => getCourse(courseId),
    enabled: Boolean(courseId),
  });
  const course = courseQuery.data;
  const hasStudyAccess = Boolean(
    user &&
    course &&
    isCourseView(course) &&
    course.status === "active" &&
    (user.role === "learner" || (user.role === "coach" && course.ownerId === user.id)),
  );
  const documentsQuery = useInfiniteQuery({
    queryKey: ["documents", "study", courseId],
    queryFn: ({ pageParam }) =>
      listCourseDocuments(courseId, {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(courseId && hasStudyAccess),
  });
  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data],
  );
  const readyDocuments = documents.filter(
    (document) => document.status === "ready" && document.mimeType !== "video/mp4",
  );
  const canGenerate = Boolean(
    hasStudyAccess && user?.permissions.includes("content:generate"),
  );
  const requestedTab = searchParams.get("tab");
  const activeTab: StudyTab =
    isStudyTab(requestedTab) && !(user?.role === "coach" && requestedTab === "quiz")
      ? requestedTab
      : "summary";

  if (!courseId) {
    return <ErrorNotice message="A course ID is required." />;
  }
  if (user?.role !== "learner" && user?.role !== "coach") {
    return (
      <Alert severity="info">
        Study tools are available to learners and course coaches.
      </Alert>
    );
  }
  if (courseQuery.isLoading) {
    return <LinearProgress aria-label="Loading course" />;
  }
  if (courseQuery.isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(courseQuery.error)} />
        <Button onClick={() => void courseQuery.refetch()}>Retry</Button>
      </Stack>
    );
  }
  if (!courseQuery.data) {
    return <Alert severity="info">Course details are unavailable.</Alert>;
  }
  if (!hasStudyAccess || !course || !isCourseView(course)) {
    return (
      <Alert severity="info">
        Study tools are available to learners with active access and the coach who owns
        this course.
      </Alert>
    );
  }

  function toggleDocument(documentId: string, checked: boolean) {
    setSelectedDocumentIds((current) => {
      if (checked) {
        if (current.length >= 10 || current.includes(documentId)) return current;
        return [...current, documentId];
      }
      return current.filter((id) => id !== documentId);
    });
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Study tools
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {course.name} · Use ready course documents or your personal notes.
        </Typography>
      </Box>

      <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography component="h2" variant="h6">
              Choose source material
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {user.role === "coach"
                ? "Select 1–10 ready course documents."
                : "Select 1–10 ready documents. Only course material you can access and your own personal notes are available."}
            </Typography>
          </Box>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "stretch", sm: "center" }}
            spacing={1}
          >
            <Button
              component={RouterLink}
              to={`/courses/${courseId}/documents`}
              variant="outlined"
              sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}
            >
              {user.role === "coach"
                ? "Manage course documents"
                : "Upload personal notes"}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {user.role === "coach"
                ? "Add course material in the document library. Ready documents become available here."
                : "Upload a PDF, DOCX, or TXT file in the document library. It will be available here after processing."}
            </Typography>
          </Stack>
          {documentsQuery.isLoading && (
            <LinearProgress aria-label="Loading ready documents" />
          )}
          {documentsQuery.isError && (
            <Stack spacing={1} alignItems="flex-start">
              <ErrorNotice message={friendlyMessage(documentsQuery.error)} />
              <Button onClick={() => void documentsQuery.refetch()}>
                Retry documents
              </Button>
            </Stack>
          )}
          {!documentsQuery.isLoading &&
            !documentsQuery.isError &&
            readyDocuments.length === 0 && (
              <Alert
                severity="info"
                action={
                  <Button
                    component={RouterLink}
                    to={`/courses/${courseId}/documents`}
                    color="inherit"
                  >
                    Open library
                  </Button>
                }
              >
                No ready documents are available yet. Upload or wait for ingestion to
                finish before generating study content.
              </Alert>
            )}
          {readyDocuments.length > 0 && (
            <FormGroup>
              {readyDocuments.map((document) => {
                const checked = selectedDocumentIds.includes(document.id);
                return (
                  <FormControlLabel
                    key={document.id}
                    control={
                      <Checkbox
                        checked={checked}
                        disabled={!checked && selectedDocumentIds.length >= 10}
                        onChange={(event) =>
                          toggleDocument(document.id, event.target.checked)
                        }
                      />
                    }
                    label={
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={{ xs: 0, sm: 1 }}
                        alignItems={{ xs: "flex-start", sm: "center" }}
                      >
                        <Typography>{document.filename}</Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={document.scope === "personal" ? "My note" : "Course"}
                        />
                      </Stack>
                    }
                  />
                );
              })}
            </FormGroup>
          )}
          {documentsQuery.hasNextPage && (
            <Button
              onClick={() => void documentsQuery.fetchNextPage()}
              disabled={documentsQuery.isFetchingNextPage}
              sx={{ alignSelf: "flex-start" }}
            >
              {documentsQuery.isFetchingNextPage ? "Loading..." : "Load more documents"}
            </Button>
          )}
          {documentsQuery.isFetchNextPageError && (
            <ErrorNotice message={friendlyMessage(documentsQuery.error)} />
          )}
          <Typography variant="body2" color="text.secondary">
            {selectedDocumentIds.length} of 10 selected
          </Typography>
          <TextField
            label="Optional topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            inputProps={{ maxLength: 200 }}
            helperText="Focus generation on a topic, or leave blank for the selected material."
            fullWidth
          />
        </Stack>
      </Paper>

      {!canGenerate && (
        <Alert severity="warning">
          Your account does not currently have permission to generate learning content.
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onChange={(_event, value: StudyTab) => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set("tab", value);
          setSearchParams(nextParams, { replace: true });
        }}
        aria-label="Study tool type"
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab value="summary" label="Summaries" />
        <Tab value="flashcards" label="Flashcards" />
        {user.role === "learner" && <Tab value="quiz" label="Quizzes" />}
      </Tabs>
      {activeTab === "summary" && (
        <SummaryPanel
          courseId={courseId}
          selectedDocumentIds={selectedDocumentIds}
          topic={topic}
          canGenerate={canGenerate}
        />
      )}
      {activeTab === "flashcards" && (
        <FlashcardsPanel
          courseId={courseId}
          selectedDocumentIds={selectedDocumentIds}
          topic={topic}
          canGenerate={canGenerate}
        />
      )}
      {activeTab === "quiz" && user.role === "learner" && (
        <QuizPanel
          courseId={courseId}
          selectedDocumentIds={selectedDocumentIds}
          topic={topic}
          canGenerate={canGenerate}
        />
      )}
    </Stack>
  );
}
