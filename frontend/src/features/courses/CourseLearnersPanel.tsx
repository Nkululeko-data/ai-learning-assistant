import { Fragment, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { friendlyMessage } from "../../api/client";
import {
  listCourseLearners,
  removeCourseLearner,
  type CourseLearner,
} from "../../api/courses";
import { ErrorNotice } from "../../components/ErrorNotice";

export function CourseLearnersPanel({
  courseId,
  canRemoveLearners,
}: {
  courseId: string;
  canRemoveLearners: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedLearner, setSelectedLearner] = useState<CourseLearner | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [removedLearnerName, setRemovedLearnerName] = useState<string | null>(null);
  const learnersQuery = useInfiniteQuery({
    queryKey: ["enrolments", "course", courseId, "learners"],
    queryFn: ({ pageParam }) =>
      listCourseLearners(courseId, {
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const removeMutation = useMutation({
    mutationFn: ({ learner, reason }: { learner: CourseLearner; reason: string }) =>
      removeCourseLearner(learner.id, reason),
    onSuccess: async (_, { learner }) => {
      setSelectedLearner(null);
      setRemovalReason("");
      setRemovedLearnerName(learner.displayName);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["enrolments", "course", courseId, "learners"],
        }),
        queryClient.invalidateQueries({ queryKey: ["enrolments", "mine"] }),
      ]);
    },
  });
  const learners = learnersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  function closeRemovalDialog() {
    if (removeMutation.isPending) return;
    setSelectedLearner(null);
    setRemovalReason("");
  }

  return (
    <Stack
      id="course-people"
      component="section"
      spacing={1.5}
      aria-labelledby="course-learners-title"
    >
      <Box>
        <Typography id="course-learners-title" component="h2" variant="h5">
          Class learners
        </Typography>
        <Typography color="text.secondary">
          Approved learners in this course. Class members can see one another here.
        </Typography>
      </Box>
      {removedLearnerName && (
        <Alert severity="success" role="status">
          {removedLearnerName} was removed from this course.
        </Alert>
      )}
      {learnersQuery.isLoading && (
        <LinearProgress aria-label="Loading class learners" />
      )}
      {learnersQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(learnersQuery.error)} />
          <Button onClick={() => void learnersQuery.refetch()}>Retry roster</Button>
        </Stack>
      )}
      {removeMutation.error && (
        <ErrorNotice message={friendlyMessage(removeMutation.error)} />
      )}
      {!learnersQuery.isLoading && !learnersQuery.isError && learners.length === 0 && (
        <Alert severity="info">No learners have joined this course yet.</Alert>
      )}
      {learners.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <List disablePadding>
            {learners.map((learner, index) => (
              <Fragment key={learner.id}>
                <ListItem disableGutters sx={{ px: { xs: 1.5, sm: 2 }, py: 1 }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    alignItems={{ xs: "stretch", sm: "center" }}
                    justifyContent="space-between"
                    sx={{ width: "100%" }}
                  >
                    <ListItemText
                      primary={learner.displayName}
                      secondary={`Joined ${new Date(learner.enrolledAt).toLocaleDateString()}`}
                      primaryTypographyProps={{ fontWeight: 600 }}
                    />
                    {canRemoveLearners && (
                      <Button
                        color="error"
                        disabled={removeMutation.isPending}
                        aria-label={`Remove ${learner.displayName} from course`}
                        onClick={() => {
                          setRemovedLearnerName(null);
                          setSelectedLearner(learner);
                        }}
                        sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
                      >
                        Remove learner
                      </Button>
                    )}
                  </Stack>
                </ListItem>
                {index < learners.length - 1 && <Divider component="li" />}
              </Fragment>
            ))}
          </List>
        </Paper>
      )}
      {learnersQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void learnersQuery.fetchNextPage()}
          disabled={learnersQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {learnersQuery.isFetchingNextPage ? "Loading..." : "Load more learners"}
        </Button>
      )}
      {learnersQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(learnersQuery.error)} />
      )}

      <Dialog
        open={selectedLearner !== null}
        onClose={closeRemovalDialog}
        aria-labelledby="remove-course-learner-title"
      >
        <DialogTitle id="remove-course-learner-title">
          Remove {selectedLearner?.displayName}?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            They will lose access to this course. The reason will be saved with their
            enrolment and shown to them.
          </Typography>
          <TextField
            autoFocus
            required
            label="Reason for removal"
            value={removalReason}
            onChange={(event) => setRemovalReason(event.target.value)}
            inputProps={{ maxLength: 1000 }}
            helperText={`${removalReason.length}/1000`}
            multiline
            minRows={3}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRemovalDialog} disabled={removeMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              !selectedLearner || !removalReason.trim() || removeMutation.isPending
            }
            onClick={() => {
              if (!selectedLearner || !removalReason.trim()) return;
              removeMutation.mutate({
                learner: selectedLearner,
                reason: removalReason.trim(),
              });
            }}
          >
            {removeMutation.isPending ? "Removing..." : "Confirm removal"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
