import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  getCoursePreview,
  getCourseLessons,
  listAllMyEnrolments,
  requestCourseJoin,
  type CourseLesson,
  type CourseListItem,
} from "../../api/courses";
import { getCoursePdf, getCourseVideo } from "../../api/documents";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";
import { designTokens } from "../../theme/designTokens";
import { QuizPanel } from "../learning/StudyContentPanels";

export function CourseCurriculum({
  course,
  hasCourseAccess,
  canUseStudyTools,
}: {
  course: CourseListItem;
  hasCourseAccess: boolean;
  canUseStudyTools: boolean;
}) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const lessonsQuery = useQuery({
    queryKey: ["courses", "lessons", course.id],
    queryFn: () => getCourseLessons(course.id),
    enabled: hasCourseAccess,
  });
  const previewQuery = useQuery({
    queryKey: ["courses", "preview", course.id],
    queryFn: () => getCoursePreview(course.id),
    enabled: !hasCourseAccess,
  });
  const enrolmentsQuery = useQuery({
    queryKey: ["enrolments", "mine"],
    queryFn: listAllMyEnrolments,
    enabled: !hasCourseAccess,
  });
  const joinMutation = useMutation({
    mutationFn: () => requestCourseJoin(course.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["enrolments", "mine"] });
    },
  });
  const lessons = lessonsQuery.data?.lessons ?? [];
  const existingEnrolment = enrolmentsQuery.data?.find(
    (enrolment) => enrolment.courseId === course.id,
  );
  const enrolmentStatus = joinMutation.data?.status ?? existingEnrolment?.status;
  const expandedLessonId = selectedLessonId;
  const expandedLessonIndex = lessons.findIndex(
    (lesson) => lesson.id === expandedLessonId,
  );

  if (!hasCourseAccess) {
    return (
      <Stack id="course-curriculum" spacing={3}>
        <Card
          sx={{
            overflow: "hidden",
            borderRadius: 3,
            color: "common.white",
            backgroundColor: "primary.main",
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
            <Typography component="h1" variant="h4" fontWeight={750}>
              {course.name}
            </Typography>
            <Typography
              sx={{
                mt: 1,
                color: designTokens.color.onPrimaryMuted,
                whiteSpace: "pre-wrap",
              }}
            >
              {course.description || "No course description has been added yet."}
            </Typography>
          </CardContent>
        </Card>

        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography component="h2" variant="h5" fontWeight={700}>
                Lesson topics
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Preview the topics before requesting access. Lesson content and
                materials are available after enrolment is approved.
              </Typography>
            </Box>
            {previewQuery.isLoading && (
              <LinearProgress aria-label="Loading course preview" />
            )}
            {previewQuery.isError && (
              <Stack spacing={1} alignItems="flex-start">
                <ErrorNotice message={friendlyMessage(previewQuery.error)} />
                <Button onClick={() => void previewQuery.refetch()}>
                  Retry preview
                </Button>
              </Stack>
            )}
            {previewQuery.data?.lessons.length ? (
              <Stack component="ol" spacing={1} sx={{ m: 0, pl: 3 }}>
                {previewQuery.data.lessons.map((lesson) => (
                  <Box component="li" key={lesson.id} sx={{ pl: 0.5 }}>
                    <Typography fontWeight={600}>{lesson.title}</Typography>
                  </Box>
                ))}
              </Stack>
            ) : (
              previewQuery.data && (
                <Typography color="text.secondary">
                  The course owner has not added any lesson topics yet.
                </Typography>
              )
            )}
          </Stack>
        </Paper>

        {enrolmentsQuery.isError && (
          <ErrorNotice message={friendlyMessage(enrolmentsQuery.error)} />
        )}
        {joinMutation.isError && (
          <ErrorNotice message={friendlyMessage(joinMutation.error)} />
        )}
        {existingEnrolment?.status === "removed" && existingEnrolment.decisionNote && (
          <Alert severity="warning">
            You were removed from this course. Coach’s reason:{" "}
            {existingEnrolment.decisionNote}
          </Alert>
        )}
        {enrolmentStatus === "pending" ? (
          <Alert severity="info" role="status">
            Your request to join this course is pending approval.
          </Alert>
        ) : enrolmentStatus === "approved" ? (
          <Alert
            severity="success"
            role="status"
            action={
              <Button
                color="inherit"
                onClick={() =>
                  void queryClient.invalidateQueries({
                    queryKey: ["courses", "detail", course.id],
                  })
                }
              >
                Refresh access
              </Button>
            }
          >
            You are enrolled. Refresh your course access to open the full curriculum.
          </Alert>
        ) : (
          <Button
            variant="contained"
            onClick={() => joinMutation.mutate()}
            disabled={
              enrolmentsQuery.isLoading ||
              enrolmentsQuery.isError ||
              joinMutation.isPending
            }
            sx={{ alignSelf: "flex-start" }}
          >
            {joinMutation.isPending
              ? "Requesting access..."
              : enrolmentStatus === "rejected" || enrolmentStatus === "removed"
                ? "Request again"
                : "Request to join"}
          </Button>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Card
        sx={{
          overflow: "hidden",
          borderRadius: 3,
          color: "common.white",
          backgroundColor: "primary.main",
        }}
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 3.5 }, "&:last-child": { pb: 3.5 } }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={2}
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography component="h1" variant="h4" fontWeight={750}>
                  {course.name}
                </Typography>
                {"status" in course && course.status === "archived" && (
                  <Chip size="small" label="Archived" color="default" />
                )}
              </Stack>
              <Typography sx={{ mt: 1, color: designTokens.color.onPrimaryMuted }}>
                {course.description ||
                  "Follow the lessons in order, or choose a topic to begin."}
              </Typography>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                component={RouterLink}
                to={`/courses/${course.id}/documents`}
                variant="outlined"
                color="inherit"
              >
                My notes & files
              </Button>
              {canUseStudyTools && "status" in course && course.status === "active" && (
                <Button
                  component={RouterLink}
                  to={`/courses/${course.id}/study`}
                  variant="contained"
                  color="secondary"
                  sx={{ flexShrink: 0 }}
                >
                  AI study tools
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {lessonsQuery.isLoading && <LinearProgress aria-label="Loading course lessons" />}
      {lessonsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(lessonsQuery.error)} />
          <Button onClick={() => void lessonsQuery.refetch()}>Retry lessons</Button>
        </Stack>
      )}
      {lessonsQuery.data && lessons.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 3 }}>
          <Stack spacing={1.5} alignItems="flex-start">
            <Typography component="h2" variant="h5" fontWeight={700}>
              Lessons are coming soon
            </Typography>
            <Typography color="text.secondary">
              The course owner has not added any lessons yet. Check back later
              {canUseStudyTools && " or use the available AI study tools"}.
            </Typography>
            {canUseStudyTools && "status" in course && course.status === "active" && (
              <Button
                component={RouterLink}
                to={`/courses/${course.id}/study`}
                variant="contained"
              >
                Open AI study tools
              </Button>
            )}
          </Stack>
        </Paper>
      )}
      {lessons.length > 0 && (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
              >
                <Box>
                  <Typography component="h2" variant="h5" fontWeight={700}>
                    Lessons
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Open a lesson to read the introduction and view its materials.
                  </Typography>
                </Box>
                <Chip
                  color="primary"
                  variant="outlined"
                  label={`${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}`}
                />
              </Stack>
              {expandedLessonIndex >= 0 && (
                <Stack spacing={0.75}>
                  <Typography variant="caption" color="text.secondary">
                    Lesson position: {expandedLessonIndex + 1} of {lessons.length}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={((expandedLessonIndex + 1) / lessons.length) * 100}
                    aria-label="Lesson position"
                    sx={{ height: 6, borderRadius: 99 }}
                  />
                </Stack>
              )}
            </Stack>
          </Paper>

          <Stack spacing={1}>
            {lessons.map((lesson, index) => {
              const expanded = lesson.id === expandedLessonId;
              const hasVideo = Boolean(lesson.videoDocumentId || lesson.videoUrl);
              return (
                <Accordion
                  key={lesson.id}
                  expanded={expanded}
                  onChange={(_, isExpanded) =>
                    setSelectedLessonId(isExpanded ? lesson.id : null)
                  }
                  disableGutters
                  elevation={0}
                  sx={{
                    overflow: "hidden",
                    border: 1,
                    borderColor: expanded ? "primary.main" : "divider",
                    borderRadius: "12px !important",
                    "&::before": { display: "none" },
                    boxShadow: expanded ? 2 : 0,
                    transition: "border-color 160ms ease, box-shadow 160ms ease",
                  }}
                >
                  <AccordionSummary
                    aria-controls={`lesson-panel-${lesson.id}`}
                    id={`lesson-header-${lesson.id}`}
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
                        {lesson.title}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ display: { xs: "none", sm: "flex" }, flexShrink: 0 }}
                      >
                        {lesson.pdfDocumentId && (
                          <Chip size="small" variant="outlined" label="PDF" />
                        )}
                        {hasVideo && (
                          <Chip size="small" variant="outlined" label="Video" />
                        )}
                      </Stack>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails
                    id={`lesson-panel-${lesson.id}`}
                    sx={{
                      px: { xs: 2, sm: 3 },
                      pt: 0,
                      pb: { xs: 2, sm: 2.5 },
                      borderTop: 1,
                      borderColor: "divider",
                    }}
                  >
                    {expanded && (
                      <Stack spacing={2}>
                        <Box sx={{ pt: 2 }}>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            fontWeight={700}
                          >
                            Lesson {index + 1}
                          </Typography>
                          <Typography
                            color="text.secondary"
                            sx={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}
                          >
                            {lesson.introduction}
                          </Typography>
                        </Box>

                        {(lesson.pdfDocumentId || hasVideo) && (
                          <Grid container spacing={2}>
                            {lesson.pdfDocumentId && (
                              <Grid size={{ xs: 12, lg: hasVideo ? 6 : 12 }}>
                                <LessonPdfPanel lesson={lesson} />
                              </Grid>
                            )}
                            {hasVideo && (
                              <Grid
                                size={{ xs: 12, lg: lesson.pdfDocumentId ? 6 : 12 }}
                              >
                                <LessonVideoPanel lesson={lesson} />
                              </Grid>
                            )}
                          </Grid>
                        )}

                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}
                        >
                          <Button
                            onClick={() =>
                              setSelectedLessonId(lessons[index - 1]?.id ?? null)
                            }
                            disabled={index === 0}
                          >
                            Previous lesson
                          </Button>
                          <Button
                            variant="contained"
                            onClick={() =>
                              setSelectedLessonId(lessons[index + 1]?.id ?? null)
                            }
                            disabled={index === lessons.length - 1}
                          >
                            Next lesson
                          </Button>
                        </Stack>
                      </Stack>
                    )}
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Stack>
        </Stack>
      )}
      <QuizPanel
        courseId={course.id}
        selectedDocumentIds={[]}
        topic=""
        canGenerate={false}
        showGenerator={false}
        courseWideOnly
        title="Course quizzes"
      />
    </Stack>
  );
}

function LessonPdfPanel({ lesson }: { lesson: CourseLesson }) {
  const pdfQuery = useQuery({
    queryKey: ["course-lesson-pdf", lesson.pdfDocumentId],
    queryFn: () => getCoursePdf(lesson.pdfDocumentId ?? ""),
    enabled: Boolean(lesson.pdfDocumentId),
  });
  const pdfUrl = useMemo(
    () => (pdfQuery.data ? URL.createObjectURL(pdfQuery.data) : null),
    [pdfQuery.data],
  );

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: "100%" }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          gap={1}
        >
          <Typography component="h3" variant="subtitle1" fontWeight={700}>
            Lesson PDF
          </Typography>
          {pdfUrl && (
            <Button
              component="a"
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
            >
              Open PDF
            </Button>
          )}
        </Stack>
        {pdfQuery.isLoading && <LinearProgress aria-label="Loading lesson PDF" />}
        {pdfQuery.isError && (
          <Stack spacing={1} alignItems="flex-start">
            <ErrorNotice message={friendlyMessage(pdfQuery.error)} />
            <Button onClick={() => void pdfQuery.refetch()}>Retry PDF</Button>
          </Stack>
        )}
        {pdfUrl && (
          <Box
            component="iframe"
            src={pdfUrl}
            title={lesson.pdfFilename ?? `${lesson.title} PDF`}
            sx={{
              display: "block",
              width: "100%",
              height: { xs: 360, sm: 480 },
              border: 0,
              borderRadius: 1,
              bgcolor: "grey.100",
            }}
          />
        )}
      </Stack>
    </Paper>
  );
}

function LessonVideoPanel({ lesson }: { lesson: CourseLesson }) {
  const videoUrl = lesson.videoUrl ?? "";
  const embedUrl = getVideoEmbedUrl(videoUrl);
  const videoQuery = useQuery({
    queryKey: ["course-lesson-video", lesson.videoDocumentId],
    queryFn: () => getCourseVideo(lesson.videoDocumentId ?? ""),
    enabled: Boolean(lesson.videoDocumentId),
  });
  const videoObjectUrl = useMemo(
    () => (videoQuery.data ? URL.createObjectURL(videoQuery.data) : null),
    [videoQuery.data],
  );

  useEffect(() => {
    return () => {
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    };
  }, [videoObjectUrl]);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: "100%" }}>
      <Stack spacing={1.5}>
        <Typography component="h3" variant="subtitle1" fontWeight={700}>
          Lesson video
        </Typography>
        {lesson.videoDocumentId && videoQuery.isLoading && (
          <LinearProgress aria-label="Loading lesson video" />
        )}
        {lesson.videoDocumentId && videoQuery.isError && (
          <Stack spacing={1} alignItems="flex-start">
            <ErrorNotice message={friendlyMessage(videoQuery.error)} />
            <Button onClick={() => void videoQuery.refetch()}>Retry video</Button>
          </Stack>
        )}
        {lesson.videoDocumentId && videoObjectUrl && (
          <video
            controls
            preload="metadata"
            aria-label={`${lesson.title} video`}
            src={videoObjectUrl}
            style={{
              display: "block",
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 4,
              backgroundColor: designTokens.color.videoSurface,
            }}
          />
        )}
        {!lesson.videoDocumentId && embedUrl ? (
          <Box
            component="iframe"
            src={embedUrl}
            title={`${lesson.title} video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            sx={{
              display: "block",
              width: "100%",
              aspectRatio: "16 / 9",
              border: 0,
              borderRadius: 1,
              bgcolor: "grey.100",
            }}
          />
        ) : (
          !lesson.videoDocumentId && (
            <Button
              component="a"
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
            >
              Open lesson video
            </Button>
          )
        )}
      </Stack>
    </Paper>
  );
}

function getVideoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "www.youtube-nocookie.com"
    ) {
      const videoId =
        host === "youtu.be"
          ? url.pathname.split("/").filter(Boolean)[0]
          : url.pathname === "/watch"
            ? url.searchParams.get("v")
            : url.pathname.split("/").filter(Boolean).at(-1);
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
    }
    if (
      host === "vimeo.com" ||
      host === "www.vimeo.com" ||
      host === "player.vimeo.com"
    ) {
      const videoId = url.pathname.split("/").filter(Boolean).at(-1);
      if (!videoId || !/^\d+$/.test(videoId)) return null;
      return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
    }
    return null;
  } catch {
    return null;
  }
}
