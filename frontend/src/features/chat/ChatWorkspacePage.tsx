import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
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
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { askChat, getConversation, listConversations } from "../../api/chat";
import { friendlyMessage } from "../../api/client";
import { listCourses } from "../../api/courses";
import type { CourseView } from "../../api/courses";
import { ErrorNotice } from "../../components/ErrorNotice";
import { isCourseView } from "../courses/course-utils";
import { ChatMessage } from "./ChatMessage";

interface AskVariables {
  courseId: string;
  question: string;
  conversationId?: string;
  controller: AbortController;
}

const idSchema = z.string().uuid();

export function ChatWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [question, setQuestion] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const rawConversationId = searchParams.get("conversationId");
  const rawCourseId = searchParams.get("courseId");
  const parsedConversationId = rawConversationId
    ? idSchema.safeParse(rawConversationId)
    : null;
  const parsedCourseId = rawCourseId ? idSchema.safeParse(rawCourseId) : null;
  const conversationId = parsedConversationId?.success ? parsedConversationId.data : "";
  const courseIdFromUrl = parsedCourseId?.success ? parsedCourseId.data : "";
  const invalidConversationId = Boolean(
    rawConversationId && !parsedConversationId?.success,
  );
  const invalidCourseId = Boolean(rawCourseId && !parsedCourseId?.success);
  const coursesQuery = useInfiniteQuery({
    queryKey: ["courses", "chat-selector"],
    queryFn: ({ pageParam }) =>
      listCourses({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const availableCourses = useMemo(
    () =>
      (coursesQuery.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (course): course is CourseView =>
          isCourseView(course) && course.status === "active",
      ),
    [coursesQuery.data],
  );
  const selectedConversationQuery = useQuery({
    queryKey: ["conversations", "detail", conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: Boolean(conversationId),
  });
  const selectedConversation = selectedConversationQuery.data?.conversation;
  const selectedCourseId = selectedConversation?.courseId ?? courseIdFromUrl;
  const courseAvailable = availableCourses.some(
    (course) => course.id === selectedCourseId,
  );
  const conversationsQuery = useInfiniteQuery({
    queryKey: ["conversations", "list", selectedCourseId],
    queryFn: ({ pageParam }) =>
      listConversations({
        courseId: selectedCourseId,
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(selectedCourseId),
  });
  const conversations = useMemo(
    () => conversationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [conversationsQuery.data],
  );
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [conversations],
  );
  const askMutation = useMutation({
    mutationFn: (variables: AskVariables) =>
      askChat(
        {
          courseId: variables.courseId,
          question: variables.question,
          ...(variables.conversationId
            ? { conversationId: variables.conversationId }
            : {}),
        },
        variables.controller.signal,
      ),
    onSuccess: async (result, variables) => {
      setQuestion("");
      setSearchParams({
        courseId: variables.courseId,
        conversationId: result.conversationId,
      });
      await queryClient.invalidateQueries({
        queryKey: ["conversations", "list"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["conversations", "detail", result.conversationId],
      });
    },
    onSettled: (_result, _error, variables) => {
      if (controllerRef.current === variables.controller) {
        controllerRef.current = null;
      }
    },
  });

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  function selectCourse(courseId: string) {
    controllerRef.current?.abort();
    setQuestion("");
    setSearchParams(courseId ? { courseId } : {});
    askMutation.reset();
  }

  function openConversation(id: string) {
    controllerRef.current?.abort();
    setSearchParams({
      courseId: selectedCourseId,
      conversationId: id,
    });
    askMutation.reset();
  }

  function startNewChat() {
    controllerRef.current?.abort();
    setSearchParams(selectedCourseId ? { courseId: selectedCourseId } : {});
    setQuestion("");
    askMutation.reset();
  }

  function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!selectedCourseId || !trimmedQuestion || !courseAvailable) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    askMutation.mutate({
      courseId: selectedCourseId,
      question: trimmedQuestion,
      ...(conversationId ? { conversationId } : {}),
      controller,
    });
  }

  const canAsk =
    courseAvailable &&
    !invalidConversationId &&
    (!conversationId || Boolean(selectedConversation)) &&
    !selectedConversationQuery.isError;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          AI Chat Workspace
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Ask questions grounded in course material.
        </Typography>
      </Box>

      <Alert severity="info">
        The backend returns a complete answer after generation; partial-token streaming
        is not available. The in-progress state below reflects the actual request.
      </Alert>
      {invalidCourseId && (
        <Alert severity="error" role="alert">
          The course ID in this link is invalid. Choose an active course to continue.
        </Alert>
      )}
      {invalidConversationId && (
        <Alert severity="error" role="alert">
          The conversation ID in this link is invalid.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography component="h2" variant="h6">
                  Course and conversations
                </Typography>
                {coursesQuery.isLoading && (
                  <LinearProgress aria-label="Loading courses" />
                )}
                {coursesQuery.isError && (
                  <Stack spacing={1} alignItems="flex-start">
                    <ErrorNotice message={friendlyMessage(coursesQuery.error)} />
                    <Button onClick={() => void coursesQuery.refetch()}>
                      Retry courses
                    </Button>
                  </Stack>
                )}
                <FormControl fullWidth>
                  <InputLabel id="chat-course-label">Course</InputLabel>
                  <Select
                    labelId="chat-course-label"
                    label="Course"
                    value={courseAvailable ? selectedCourseId : ""}
                    onChange={(event) => selectCourse(event.target.value)}
                  >
                    {availableCourses.map((course) => (
                      <MenuItem key={course.id} value={course.id}>
                        {course.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {coursesQuery.hasNextPage && (
                  <Button
                    onClick={() => void coursesQuery.fetchNextPage()}
                    disabled={coursesQuery.isFetchingNextPage}
                  >
                    {coursesQuery.isFetchingNextPage
                      ? "Loading courses..."
                      : "Load more courses"}
                  </Button>
                )}
                {!coursesQuery.isLoading &&
                  !coursesQuery.isError &&
                  availableCourses.length === 0 && (
                    <Alert severity="info">
                      No active courses are available to this account.{" "}
                      <Button component={RouterLink} to="/courses" size="small">
                        View courses
                      </Button>
                    </Alert>
                  )}
                {selectedCourseId && !courseAvailable && (
                  <Alert severity="warning" role="status">
                    This conversation’s course is no longer available for new questions.
                    You can still read its saved messages.
                  </Alert>
                )}
                <Divider />
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={1}
                >
                  <Typography component="h3" variant="subtitle1" fontWeight={650}>
                    Conversations
                  </Typography>
                  <Button
                    size="small"
                    onClick={startNewChat}
                    disabled={!courseAvailable}
                  >
                    New chat
                  </Button>
                </Stack>
                {conversationsQuery.isLoading && (
                  <LinearProgress aria-label="Loading conversations" />
                )}
                {conversationsQuery.isError && (
                  <Stack spacing={1} alignItems="flex-start">
                    <ErrorNotice message={friendlyMessage(conversationsQuery.error)} />
                    <Button onClick={() => void conversationsQuery.refetch()}>
                      Retry conversations
                    </Button>
                  </Stack>
                )}
                {sortedConversations.length === 0 &&
                  selectedCourseId &&
                  conversationsQuery.isSuccess && (
                    <Typography color="text.secondary">
                      No conversations for this course yet.
                    </Typography>
                  )}
                {sortedConversations.length > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Sorted by updated time within loaded results.
                  </Typography>
                )}
                {sortedConversations.map((conversation) => (
                  <Button
                    key={conversation.id}
                    onClick={() => openConversation(conversation.id)}
                    variant={conversation.id === conversationId ? "contained" : "text"}
                    sx={{
                      justifyContent: "flex-start",
                      textAlign: "left",
                      textTransform: "none",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {conversation.title || "Untitled conversation"}
                  </Button>
                ))}
                {conversationsQuery.hasNextPage && (
                  <Button
                    onClick={() => void conversationsQuery.fetchNextPage()}
                    disabled={conversationsQuery.isFetchingNextPage}
                  >
                    {conversationsQuery.isFetchingNextPage
                      ? "Loading..."
                      : "Load more conversations"}
                  </Button>
                )}
                <Button component={RouterLink} to="/conversations" size="small">
                  Conversation history
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                {conversationId && selectedConversationQuery.isLoading && (
                  <LinearProgress aria-label="Loading conversation" />
                )}
                {selectedConversationQuery.isError && (
                  <Stack spacing={1} alignItems="flex-start">
                    <ErrorNotice
                      message={friendlyMessage(selectedConversationQuery.error)}
                    />
                    <Button onClick={() => void selectedConversationQuery.refetch()}>
                      Retry conversation
                    </Button>
                  </Stack>
                )}
                {!conversationId && !invalidConversationId && (
                  <Alert severity="info" role="status">
                    {selectedCourseId
                      ? "Ask a question to start a conversation."
                      : "Select a course and ask a question to start a conversation."}
                  </Alert>
                )}
                {selectedConversationQuery.data && (
                  <Stack
                    spacing={2}
                    role="log"
                    aria-label="Conversation messages"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    {selectedConversationQuery.data.messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        courseId={selectedConversationQuery.data.conversation.courseId}
                      />
                    ))}
                  </Stack>
                )}
                {askMutation.isPending && (
                  <Alert
                    severity="info"
                    role="status"
                    aria-live="polite"
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() => controllerRef.current?.abort()}
                      >
                        Cancel
                      </Button>
                    }
                  >
                    Searching course material and preparing a grounded answer...
                    <LinearProgress sx={{ mt: 1 }} />
                  </Alert>
                )}
                {askMutation.isError &&
                  (askMutation.error instanceof Error &&
                  askMutation.error.name === "AbortError" ? (
                    <Alert severity="warning" role="status">
                      The chat request was cancelled.
                    </Alert>
                  ) : (
                    <ErrorNotice message={friendlyMessage(askMutation.error)} />
                  ))}
                {canAsk && (
                  <Box component="form" onSubmit={handleAsk}>
                    <TextField
                      label="Ask about this course"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      multiline
                      minRows={3}
                      maxRows={8}
                      fullWidth
                      inputProps={{ maxLength: 4000 }}
                      disabled={askMutation.isPending}
                      helperText={`${question.length}/4000 characters`}
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!question.trim() || askMutation.isPending}
                      sx={{ mt: 1.5 }}
                    >
                      {askMutation.isPending ? "Working..." : "Ask"}
                    </Button>
                  </Box>
                )}
                {!courseAvailable && conversationId && (
                  <Typography color="text.secondary">
                    Select an active accessible course to start a new chat.
                  </Typography>
                )}
                {courseAvailable && conversationId && !selectedConversation && (
                  <Typography color="text.secondary">
                    The saved conversation could not be loaded.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
