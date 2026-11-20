import { useMemo, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  deleteConversation,
  listConversations,
  renameConversation,
  type Conversation,
} from "../../api/chat";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

export function ConversationHistoryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [title, setTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const conversationsQuery = useInfiniteQuery({
    queryKey: ["conversations", "list", "all"],
    queryFn: ({ pageParam }) =>
      listConversations({
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const conversations = useMemo(
    () => conversationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [conversationsQuery.data],
  );
  const visibleConversations = useMemo(() => {
    const filter = search.trim().toLocaleLowerCase();
    return [...conversations]
      .filter(
        (conversation) =>
          !filter || (conversation.title ?? "").toLocaleLowerCase().includes(filter),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [conversations, search]);

  const renameMutation = useMutation({
    mutationFn: (input: { conversationId: string; title: string }) =>
      renameConversation(input.conversationId, input.title),
    onSuccess: async (updatedConversation) => {
      await queryClient.invalidateQueries({
        queryKey: ["conversations", "list"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["conversations", "detail", updatedConversation.id],
      });
      setRenameTarget(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: async (_result, conversationId) => {
      queryClient.removeQueries({
        queryKey: ["conversations", "detail", conversationId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["conversations", "list"],
      });
      setDeleteTarget(null);
    },
  });

  function openRename(conversation: Conversation) {
    renameMutation.reset();
    setRenameTarget(conversation);
    setTitle(conversation.title ?? "");
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget) return;
    renameMutation.mutate({
      conversationId: renameTarget.id,
      title: title.trim(),
    });
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
      >
        <Box>
          <Typography component="h1" variant="h4" fontWeight={700}>
            Conversation History
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Search, reopen, rename, or delete your saved conversations.
          </Typography>
        </Box>
        <Button component={RouterLink} to="/chat" variant="contained">
          New chat
        </Button>
      </Stack>

      <TextField
        label="Search loaded titles"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        fullWidth
      />
      <Typography variant="body2" color="text.secondary">
        Search covers titles on loaded pages, not message content. Newest-first sorting
        applies only to loaded results; load more to search further.
      </Typography>

      {conversationsQuery.isLoading && (
        <LinearProgress aria-label="Loading conversation history" />
      )}
      {conversationsQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(conversationsQuery.error)} />
          <Button onClick={() => void conversationsQuery.refetch()}>
            Retry conversation history
          </Button>
        </Stack>
      )}
      {conversationsQuery.isSuccess && visibleConversations.length === 0 && (
        <Alert severity="info" role="status">
          {conversations.length === 0
            ? "No saved conversations yet."
            : "No loaded conversations match your search."}
        </Alert>
      )}
      <Stack spacing={1.5}>
        {visibleConversations.map((conversation) => (
          <Card key={conversation.id} variant="outlined">
            <CardContent>
              <Typography component="h2" variant="h6" sx={{ overflowWrap: "anywhere" }}>
                {conversation.title || "Untitled conversation"}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Updated {new Date(conversation.updatedAt).toLocaleString()}
              </Typography>
            </CardContent>
            <CardActions>
              <Button
                component={RouterLink}
                to={`/chat?conversationId=${encodeURIComponent(conversation.id)}`}
              >
                Reopen
              </Button>
              <Button onClick={() => openRename(conversation)}>Rename</Button>
              <Button
                color="error"
                onClick={() => {
                  deleteMutation.reset();
                  setDeleteTarget(conversation);
                }}
              >
                Delete
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>
      {renameMutation.isError && (
        <ErrorNotice message={friendlyMessage(renameMutation.error)} />
      )}
      {deleteMutation.isError && (
        <ErrorNotice message={friendlyMessage(deleteMutation.error)} />
      )}
      {conversationsQuery.hasNextPage && (
        <Button
          onClick={() => void conversationsQuery.fetchNextPage()}
          disabled={conversationsQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {conversationsQuery.isFetchingNextPage
            ? "Loading..."
            : "Load more conversations"}
        </Button>
      )}
      {conversationsQuery.isFetchNextPageError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(conversationsQuery.error)} />
          <Button
            onClick={() => void conversationsQuery.fetchNextPage()}
            disabled={conversationsQuery.isFetchingNextPage}
          >
            Retry loading more
          </Button>
        </Stack>
      )}

      <Dialog
        open={renameTarget !== null}
        onClose={() => {
          if (!renameMutation.isPending) setRenameTarget(null);
        }}
        aria-labelledby="rename-conversation-title"
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleRename}>
          <DialogTitle id="rename-conversation-title">Rename conversation</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Conversation title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              fullWidth
              required
              inputProps={{ maxLength: 120 }}
              sx={{ mt: 1 }}
            />
            {renameMutation.isError && (
              <Box sx={{ mt: 2 }}>
                <ErrorNotice message={friendlyMessage(renameMutation.error)} />
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setRenameTarget(null)}
              disabled={renameMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                !title.trim() || title.trim().length > 120 || renameMutation.isPending
              }
            >
              {renameMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteMutation.isPending) setDeleteTarget(null);
        }}
        aria-labelledby="delete-conversation-title"
      >
        <DialogTitle id="delete-conversation-title">Delete conversation?</DialogTitle>
        <DialogContent>
          <Typography>
            {deleteTarget?.title || "Untitled conversation"} and its messages will be
            permanently deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!deleteTarget || deleteMutation.isPending}
            onClick={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
            }}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
