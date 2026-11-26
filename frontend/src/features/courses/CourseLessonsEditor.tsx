import { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getCourseLessons,
  updateCourseLessons,
  type CourseLesson,
} from "../../api/courses";
import {
  listCourseDocuments,
  MAX_LESSON_VIDEO_SIZE_BYTES,
  uploadCourseLessonVideo,
} from "../../api/documents";
import { friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";

type LessonDraft = CourseLesson;
type LessonInput = Pick<
  CourseLesson,
  "id" | "title" | "introduction" | "pdfDocumentId" | "videoUrl" | "videoDocumentId"
>;

function toLessonInput(lesson: LessonDraft): LessonInput {
  return {
    id: lesson.id,
    title: lesson.title,
    introduction: lesson.introduction,
    pdfDocumentId: lesson.pdfDocumentId,
    videoDocumentId: lesson.videoDocumentId,
    videoUrl: lesson.videoUrl,
  };
}

export function CourseLessonsEditor({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [videoValidationErrors, setVideoValidationErrors] = useState<
    Record<string, string>
  >({});
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [lessonToRemove, setLessonToRemove] = useState<{
    index: number;
    title: string;
  } | null>(null);
  const [draft, setDraft] = useState<{
    courseId: string;
    lessons: LessonDraft[];
  } | null>(null);
  const lessonsQuery = useQuery({
    queryKey: ["courses", "lessons", courseId],
    queryFn: () => getCourseLessons(courseId),
  });
  const documentsQuery = useInfiniteQuery({
    queryKey: ["documents", "course-lesson-editor", courseId],
    queryFn: ({ pageParam }) =>
      listCourseDocuments(courseId, {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const coursePdfs = useMemo(
    () =>
      (documentsQuery.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (document) =>
          document.scope === "course" &&
          document.mimeType === "application/pdf" &&
          document.status === "ready",
      ),
    [documentsQuery.data],
  );
  const savedLessons = lessonsQuery.data?.lessons ?? [];
  const lessons = draft?.courseId === courseId ? draft.lessons : savedLessons;
  const isDirty =
    JSON.stringify(lessons.map(toLessonInput)) !==
    JSON.stringify(savedLessons.map(toLessonInput));
  const hasIncompleteLesson = lessons.some(
    (lesson) => !lesson.title.trim() || !lesson.introduction.trim(),
  );
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!lessonsQuery.data) {
        throw new Error("Course lesson details are not loaded");
      }
      return updateCourseLessons(courseId, {
        version: lessonsQuery.data.version,
        lessons: lessons.map(toLessonInput),
      });
    },
    onSuccess: async (result) => {
      setDraft({ courseId, lessons: result.lessons });
      queryClient.setQueryData(["courses", "lessons", courseId], result);
      await queryClient.invalidateQueries({
        queryKey: ["courses", "detail", courseId],
      });
    },
  });
  const videoUploadMutation = useMutation({
    mutationFn: ({ file }: { lessonId: string; file: File }) =>
      uploadCourseLessonVideo(courseId, file),
    onSuccess: async (video, { lessonId }) => {
      setDraft((currentDraft) => {
        const currentLessons =
          currentDraft?.courseId === courseId
            ? currentDraft.lessons
            : (lessonsQuery.data?.lessons ?? []);
        return {
          courseId,
          lessons: currentLessons.map((lesson) =>
            lesson.id === lessonId
              ? {
                  ...lesson,
                  videoDocumentId: video.id,
                  videoFilename: video.filename,
                  videoSizeBytes: video.sizeBytes,
                  videoUrl: null,
                }
              : lesson,
          ),
        };
      });
      setVideoValidationErrors((current) => {
        const next = { ...current };
        delete next[lessonId];
        return next;
      });
      await queryClient.invalidateQueries({
        queryKey: ["documents", "course-lesson-editor", courseId],
      });
    },
  });
  const canUploadVideo =
    user?.role === "coach" && user.permissions.includes("document:upload");
  const courseVideos = useMemo(
    () =>
      (documentsQuery.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (document) =>
          document.scope === "course" &&
          document.mimeType === "video/mp4" &&
          document.status === "ready",
      ),
    [documentsQuery.data],
  );

  function updateLesson(index: number, patch: Partial<LessonDraft>) {
    setDraft((currentDraft) => {
      const current =
        currentDraft?.courseId === courseId
          ? currentDraft.lessons
          : (lessonsQuery.data?.lessons ?? []);
      return {
        courseId,
        lessons: current.map((lesson, currentIndex) =>
          currentIndex === index ? { ...lesson, ...patch } : lesson,
        ),
      };
    });
  }

  function moveLesson(index: number, direction: -1 | 1) {
    setDraft((currentDraft) => {
      const current =
        currentDraft?.courseId === courseId
          ? currentDraft.lessons
          : (lessonsQuery.data?.lessons ?? []);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return currentDraft;
      const reordered = [...current];
      const currentLesson = reordered[index];
      const targetLesson = reordered[targetIndex];
      if (!currentLesson || !targetLesson) return currentDraft;
      reordered[index] = targetLesson;
      reordered[targetIndex] = currentLesson;
      return { courseId, lessons: reordered };
    });
  }

  async function reloadLessons() {
    const refreshed = await lessonsQuery.refetch();
    if (refreshed.data) {
      setDraft({ courseId, lessons: refreshed.data.lessons });
      saveMutation.reset();
    }
  }

  function addLesson() {
    const id = crypto.randomUUID();
    setExpandedLessonId(id);
    setDraft((currentDraft) => ({
      courseId,
      lessons: [
        ...(currentDraft?.courseId === courseId
          ? currentDraft.lessons
          : (lessonsQuery.data?.lessons ?? [])),
        {
          id,
          title: "",
          introduction: "",
          pdfDocumentId: null,
          pdfFilename: null,
          videoDocumentId: null,
          videoFilename: null,
          videoSizeBytes: null,
          videoUrl: null,
        },
      ],
    }));
  }

  function removeLesson(index: number) {
    const lesson = lessons[index];
    setDraft((currentDraft) => ({
      courseId,
      lessons: (currentDraft?.courseId === courseId
        ? currentDraft.lessons
        : (lessonsQuery.data?.lessons ?? [])
      ).filter((_currentLesson, currentIndex) => currentIndex !== index),
    }));
    setExpandedLessonId((current) => (current === lesson?.id ? null : current));
    setLessonToRemove(null);
  }

  function uploadVideoForLesson(lessonId: string, file: File) {
    const invalidType =
      !file.name.toLowerCase().endsWith(".mp4") ||
      (file.type !== "" && file.type.toLowerCase() !== "video/mp4");
    const message = invalidType
      ? "Choose an MP4 video file."
      : file.size > MAX_LESSON_VIDEO_SIZE_BYTES
        ? "The lesson video must be 100 MB or smaller."
        : null;
    if (message) {
      setVideoValidationErrors((current) => ({ ...current, [lessonId]: message }));
      return;
    }
    setVideoValidationErrors((current) => {
      const next = { ...current };
      delete next[lessonId];
      return next;
    });
    videoUploadMutation.mutate({ lessonId, file });
  }

  return (
    <Stack
      id="course-lessons-editor"
      component="section"
      spacing={2}
      aria-labelledby="course-lessons-editor-title"
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1.5}
      >
        <Box>
          <Typography
            id="course-lessons-editor-title"
            component="h2"
            variant="h5"
            fontWeight={700}
          >
            Course lessons
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
            Organize topics in order. PDFs and uploaded MP4 lesson videos are optional.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignSelf={{ xs: "flex-start", sm: "auto" }}>
          <Button variant="outlined" onClick={addLesson} disabled={!lessonsQuery.data}>
            Add lesson
          </Button>
          <Button
            variant="contained"
            onClick={() => saveMutation.mutate()}
            disabled={
              !lessonsQuery.data ||
              !isDirty ||
              hasIncompleteLesson ||
              saveMutation.isPending
            }
          >
            {saveMutation.isPending ? "Saving..." : "Save lessons"}
          </Button>
        </Stack>
      </Stack>

      {lessonsQuery.isLoading && <LinearProgress aria-label="Loading course lessons" />}
      {lessonsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(lessonsQuery.error)} />
          <Button onClick={() => void lessonsQuery.refetch()}>Retry lessons</Button>
        </Stack>
      )}
      {documentsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(documentsQuery.error)} />
          <Button onClick={() => void documentsQuery.refetch()}>
            Retry course files
          </Button>
        </Stack>
      )}
      {saveMutation.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(saveMutation.error)} />
          {saveMutation.error instanceof Error &&
            "status" in saveMutation.error &&
            saveMutation.error.status === 409 && (
              <Button onClick={() => void reloadLessons()}>
                Reload latest lessons
              </Button>
            )}
        </Stack>
      )}
      {saveMutation.isSuccess && !isDirty && (
        <Alert severity="success" role="status">
          Course lessons saved.
        </Alert>
      )}

      {lessons.length === 0 && lessonsQuery.data && (
        <Alert severity="info">
          No lessons yet. Add the first topic to build the learner course outline.
        </Alert>
      )}
      <Stack spacing={2}>
        {lessons.map((lesson, index) => {
          const currentPdfIsListed = coursePdfs.some(
            (document) => document.id === lesson.pdfDocumentId,
          );
          const currentVideoIsListed = courseVideos.some(
            (document) => document.id === lesson.videoDocumentId,
          );
          const uploadError =
            videoUploadMutation.variables?.lessonId === lesson.id
              ? videoUploadMutation.error
              : null;
          const hasMedia = Boolean(
            lesson.pdfDocumentId || lesson.videoDocumentId || lesson.videoUrl,
          );
          const expanded = expandedLessonId === lesson.id;
          return (
            <Accordion
              key={lesson.id}
              expanded={expanded}
              onChange={(_, isExpanded) =>
                setExpandedLessonId(isExpanded ? lesson.id : null)
              }
              disableGutters
              elevation={0}
              className="learnova-lesson-editor"
              sx={{
                overflow: "hidden",
                border: 1,
                borderColor: expanded ? "primary.main" : "divider",
                borderRadius: "12px !important",
                "&::before": { display: "none" },
                boxShadow: expanded ? 2 : 0,
              }}
            >
              <AccordionSummary
                id={`editor-lesson-header-${lesson.id}`}
                aria-controls={`editor-lesson-panel-${lesson.id}`}
                expandIcon={
                  <Box
                    component="span"
                    aria-hidden="true"
                    sx={{
                      width: 9,
                      height: 9,
                      borderRight: 2,
                      borderBottom: 2,
                      borderColor: "text.secondary",
                      transform: "rotate(45deg)",
                      mt: -0.5,
                    }}
                  />
                }
                sx={{
                  minHeight: 68,
                  px: { xs: 1.5, sm: 2 },
                  "& .MuiAccordionSummary-content": { my: 1.5, minWidth: 0 },
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={{ xs: 1, sm: 1.5 }}
                  width="100%"
                  minWidth={0}
                >
                  <Chip
                    size="small"
                    label={String(index + 1).padStart(2, "0")}
                    color={expanded ? "primary" : "default"}
                    sx={{ minWidth: 38, fontWeight: 700 }}
                  />
                  <Typography
                    fontWeight={expanded ? 700 : 600}
                    noWrap
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {lesson.title.trim() || "Untitled lesson"}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ display: { xs: "none", sm: "flex" }, flexShrink: 0 }}
                  >
                    {lesson.pdfDocumentId && (
                      <Chip size="small" variant="outlined" label="PDF" />
                    )}
                    {lesson.videoDocumentId && (
                      <Chip size="small" variant="outlined" label="MP4" />
                    )}
                    {lesson.videoUrl && (
                      <Chip size="small" variant="outlined" label="Legacy link" />
                    )}
                    {!hasMedia && (
                      <Typography variant="caption" color="text.secondary">
                        No materials
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              </AccordionSummary>
              <AccordionDetails
                id={`editor-lesson-panel-${lesson.id}`}
                sx={{ p: { xs: 2, sm: 2.5 }, borderTop: 1, borderColor: "divider" }}
              >
                {expanded && (
                  <Stack spacing={2}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      gap={1}
                      flexWrap="wrap"
                    >
                      <Typography component="h3" variant="h6" fontWeight={650}>
                        Lesson information
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        <Button
                          size="small"
                          aria-label={`Move lesson ${index + 1} up`}
                          onClick={() => moveLesson(index, -1)}
                          disabled={index === 0}
                        >
                          Move up
                        </Button>
                        <Button
                          size="small"
                          aria-label={`Move lesson ${index + 1} down`}
                          onClick={() => moveLesson(index, 1)}
                          disabled={index === lessons.length - 1}
                        >
                          Move down
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          aria-label={`Remove lesson ${index + 1}`}
                          onClick={() =>
                            setLessonToRemove({
                              index,
                              title: lesson.title.trim() || "Untitled lesson",
                            })
                          }
                        >
                          Remove
                        </Button>
                      </Stack>
                    </Stack>
                    <TextField
                      label="Topic"
                      value={lesson.title}
                      onChange={(event) =>
                        updateLesson(index, { title: event.target.value })
                      }
                      inputProps={{ maxLength: 120 }}
                      required
                      fullWidth
                    />
                    <TextField
                      label="Introduction"
                      value={lesson.introduction}
                      onChange={(event) =>
                        updateLesson(index, { introduction: event.target.value })
                      }
                      inputProps={{ maxLength: 4000 }}
                      helperText="A short explanation of what learners will study."
                      multiline
                      minRows={3}
                      required
                      fullWidth
                    />
                    <Divider />
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      justifyContent="space-between"
                      alignItems={{ xs: "flex-start", sm: "center" }}
                      spacing={1}
                    >
                      <Box>
                        <Typography component="h3" variant="h6" fontWeight={650}>
                          Learning materials
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Add a PDF to the course library first, then attach it here. A
                          lesson video is optional.
                        </Typography>
                      </Box>
                      <Button
                        component={RouterLink}
                        to={`/courses/${courseId}/documents`}
                        size="small"
                      >
                        Manage course files
                      </Button>
                    </Stack>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Paper
                          variant="outlined"
                          className="learnova-lesson-material-card"
                          sx={{ height: "100%", p: { xs: 1.5, sm: 2 } }}
                        >
                          <Stack spacing={1.25}>
                            <Typography fontWeight={700}>PDF notes</Typography>
                            <Typography variant="body2" color="text.secondary">
                              Select a processed PDF from this course.
                            </Typography>
                            <FormControl fullWidth>
                              <InputLabel id={`lesson-pdf-label-${lesson.id}`}>
                                Optional PDF
                              </InputLabel>
                              <Select
                                labelId={`lesson-pdf-label-${lesson.id}`}
                                label="Optional PDF"
                                value={lesson.pdfDocumentId ?? ""}
                                onChange={(event) => {
                                  const documentId = event.target.value || null;
                                  const document = coursePdfs.find(
                                    (item) => item.id === documentId,
                                  );
                                  updateLesson(index, {
                                    pdfDocumentId: documentId,
                                    pdfFilename: document?.filename ?? null,
                                  });
                                }}
                              >
                                <MenuItem value="">No PDF</MenuItem>
                                {lesson.pdfDocumentId &&
                                  !currentPdfIsListed &&
                                  lesson.pdfFilename && (
                                    <MenuItem value={lesson.pdfDocumentId}>
                                      {lesson.pdfFilename}
                                      {documentsQuery.hasNextPage
                                        ? " (load more PDFs)"
                                        : documentsQuery.isSuccess
                                          ? " (unavailable)"
                                          : ""}
                                    </MenuItem>
                                  )}
                                {coursePdfs.map((document) => (
                                  <MenuItem key={document.id} value={document.id}>
                                    {document.filename}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Stack>
                        </Paper>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Paper
                          variant="outlined"
                          className="learnova-lesson-material-card"
                          sx={{ height: "100%", p: { xs: 1.5, sm: 2 } }}
                        >
                          <Stack spacing={1}>
                            <Typography fontWeight={700}>Lesson video</Typography>
                            <Typography variant="body2" color="text.secondary">
                              Optional. Choose an uploaded video or add an MP4.
                            </Typography>
                            <FormControl fullWidth>
                              <InputLabel id={`lesson-video-label-${lesson.id}`}>
                                Optional lesson video
                              </InputLabel>
                              <Select
                                labelId={`lesson-video-label-${lesson.id}`}
                                label="Optional lesson video"
                                value={lesson.videoDocumentId ?? ""}
                                onChange={(event) => {
                                  const documentId = event.target.value || null;
                                  const document = courseVideos.find(
                                    (item) => item.id === documentId,
                                  );
                                  updateLesson(index, {
                                    videoDocumentId: documentId,
                                    videoFilename:
                                      document?.filename ??
                                      (documentId ? lesson.videoFilename : null),
                                    videoSizeBytes:
                                      document?.sizeBytes ??
                                      (documentId ? lesson.videoSizeBytes : null),
                                    videoUrl: documentId ? null : lesson.videoUrl,
                                  });
                                }}
                              >
                                <MenuItem value="">No uploaded video</MenuItem>
                                {lesson.videoDocumentId &&
                                  !currentVideoIsListed &&
                                  lesson.videoFilename && (
                                    <MenuItem value={lesson.videoDocumentId}>
                                      {lesson.videoFilename}
                                      {documentsQuery.hasNextPage
                                        ? " (load more course files)"
                                        : " (unavailable)"}
                                    </MenuItem>
                                  )}
                                {courseVideos.map((video) => (
                                  <MenuItem key={video.id} value={video.id}>
                                    {video.filename} ·{" "}
                                    {(video.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={1}
                              alignItems={{ xs: "flex-start", sm: "center" }}
                            >
                              <Button
                                component="label"
                                variant="outlined"
                                disabled={
                                  !canUploadVideo || videoUploadMutation.isPending
                                }
                                aria-label={`Upload video for lesson ${index + 1}`}
                              >
                                {videoUploadMutation.isPending &&
                                videoUploadMutation.variables?.lessonId === lesson.id
                                  ? "Uploading..."
                                  : "Upload MP4"}
                                <input
                                  hidden
                                  type="file"
                                  accept="video/mp4,.mp4"
                                  onChange={(event) => {
                                    const input = event.currentTarget;
                                    const file = input.files?.[0];
                                    input.value = "";
                                    if (file) uploadVideoForLesson(lesson.id, file);
                                  }}
                                />
                              </Button>
                              <Typography variant="body2" color="text.secondary">
                                MP4 up to 100 MB. Save lessons to attach; unused uploads
                                remain in the course library.
                              </Typography>
                            </Stack>
                            {!canUploadVideo && (
                              <Typography variant="body2" color="text.secondary">
                                You need the document upload permission to add a video.
                              </Typography>
                            )}
                            {videoValidationErrors[lesson.id] && (
                              <Alert severity="error">
                                {videoValidationErrors[lesson.id]}
                              </Alert>
                            )}
                            {uploadError && (
                              <ErrorNotice message={friendlyMessage(uploadError)} />
                            )}
                            {videoUploadMutation.isPending &&
                              videoUploadMutation.variables?.lessonId === lesson.id && (
                                <LinearProgress aria-label="Uploading lesson video" />
                              )}
                            {lesson.videoUrl && (
                              <Alert
                                severity="info"
                                action={
                                  <Button
                                    color="inherit"
                                    size="small"
                                    onClick={() =>
                                      updateLesson(index, { videoUrl: null })
                                    }
                                  >
                                    Remove link
                                  </Button>
                                }
                              >
                                This lesson still uses a previously saved external video
                                link. Upload an MP4 to replace it.
                              </Alert>
                            )}
                          </Stack>
                        </Paper>
                      </Grid>
                    </Grid>
                    {!currentPdfIsListed &&
                      lesson.pdfDocumentId &&
                      documentsQuery.isSuccess &&
                      !documentsQuery.hasNextPage && (
                        <Alert severity="warning">
                          This lesson PDF is no longer available. Choose another PDF or
                          remove it before saving.
                        </Alert>
                      )}
                    {documentsQuery.hasNextPage && (
                      <Button
                        onClick={() => void documentsQuery.fetchNextPage()}
                        disabled={documentsQuery.isFetchingNextPage}
                        sx={{ alignSelf: "flex-start" }}
                      >
                        {documentsQuery.isFetchingNextPage
                          ? "Loading course files..."
                          : "Load more course files"}
                      </Button>
                    )}
                  </Stack>
                )}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Stack>
      <Dialog
        open={lessonToRemove !== null}
        onClose={() => setLessonToRemove(null)}
        aria-labelledby="remove-course-lesson-title"
      >
        <DialogTitle id="remove-course-lesson-title">
          Remove lesson from course?
        </DialogTitle>
        <DialogContent>
          <Typography>
            “{lessonToRemove?.title}” will be removed from your unsaved lesson changes.
            Save the lesson list to apply this change to the course.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLessonToRemove(null)}>Keep lesson</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (lessonToRemove) removeLesson(lessonToRemove.index);
            }}
          >
            Remove lesson
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
