import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAdminCourses,
  listAdminUsers,
  reassignAdminCourseOwner,
  updateAdminCourseStatus,
} from "../../api/admin";
import type { CourseView } from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

export function AdminCoursesPage() {
  const queryClient = useQueryClient();
  const [selectedCourse, setSelectedCourse] = useState<CourseView | null>(null);
  const [nextOwnerId, setNextOwnerId] = useState("");
  const [courseToArchive, setCourseToArchive] = useState<CourseView | null>(null);
  const coursesQuery = useInfiniteQuery({
    queryKey: ["admin", "courses"],
    queryFn: ({ pageParam }) =>
      listAdminCourses({
        limit: 20,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const usersQuery = useInfiniteQuery({
    queryKey: ["admin", "course-owners"],
    queryFn: ({ pageParam }) =>
      listAdminUsers({
        limit: 100,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const courses = coursesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const users = useMemo(
    () => usersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [usersQuery.data],
  );
  const coursesError: unknown = coursesQuery.error;
  const coaches = useMemo(
    () => users.filter((item) => item.role === "coach" && item.status === "active"),
    [users],
  );
  const usersById = useMemo(
    () => new Map(users.map((item) => [item.id, item])),
    [users],
  );
  const ownerMutation = useMutation({
    mutationFn: ({
      courseId,
      ownerId,
      version,
    }: {
      courseId: string;
      ownerId: string;
      version: number;
    }) => reassignAdminCourseOwner(courseId, { ownerId, version }),
    onSuccess: async () => {
      setSelectedCourse(null);
      setNextOwnerId("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "courses"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "course-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
      ]);
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (course: CourseView) =>
      updateAdminCourseStatus(course.id, {
        status: "archived",
        version: course.version,
      }),
    onSuccess: async () => {
      setCourseToArchive(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "courses"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "course-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
      ]);
    },
  });

  if (coursesQuery.isLoading) {
    return (
      <Stack spacing={2}>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Courses
        </Typography>
        <LinearProgress aria-label="Loading courses" />
      </Stack>
    );
  }
  if (coursesQuery.isError && !coursesQuery.data) {
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Typography component="h1" variant="h4" fontWeight={700}>
          Courses
        </Typography>
        <ErrorNotice message={friendlyMessage(coursesError)} />
        <Button onClick={() => void coursesQuery.refetch()}>Retry</Button>
      </Stack>
    );
  }

  function openReassignDialog(course: CourseView) {
    setSelectedCourse(course);
    setNextOwnerId(course.ownerId);
  }

  function ownerName(course: CourseView): string {
    const owner = usersById.get(course.ownerId);
    return owner
      ? `${owner.displayName} (${owner.email})`
      : `Owner ID ${course.ownerId}`;
  }

  return (
    <Stack spacing={2}>
      <Typography component="h1" variant="h4" fontWeight={700}>
        Courses
      </Typography>
      {usersQuery.isError && (
        <Stack spacing={1} alignItems="flex-start">
          <ErrorNotice message={friendlyMessage(usersQuery.error)} />
          <Button onClick={() => void usersQuery.refetch()}>Retry coach list</Button>
        </Stack>
      )}
      {coursesQuery.isError && coursesQuery.data && (
        <ErrorNotice message={friendlyMessage(coursesError)} />
      )}
      {courses.length === 0 ? (
        <Alert severity="info">There are no courses to manage.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Admin course catalog">
            <TableHead>
              <TableRow>
                <TableCell>Course</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Approval</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {courses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell>
                    <Typography fontWeight={600}>{course.name}</Typography>
                  </TableCell>
                  <TableCell>{ownerName(course)}</TableCell>
                  <TableCell>{course.status}</TableCell>
                  <TableCell>{course.approvalStatus ?? "—"}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      <Button
                        size="small"
                        onClick={() => openReassignDialog(course)}
                        aria-label={`Reassign owner for ${course.name}`}
                      >
                        Reassign owner
                      </Button>
                      {course.status === "active" && (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setCourseToArchive(course)}
                          aria-label={`Archive ${course.name}`}
                        >
                          Archive
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {coursesQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void coursesQuery.fetchNextPage()}
          disabled={coursesQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {coursesQuery.isFetchingNextPage ? "Loading..." : "Load more courses"}
        </Button>
      )}
      {coursesQuery.isFetchNextPageError && (
        <ErrorNotice message={friendlyMessage(coursesError)} />
      )}

      <Dialog
        open={selectedCourse !== null}
        onClose={() => {
          setSelectedCourse(null);
          setNextOwnerId("");
        }}
        aria-labelledby="reassign-course-owner-title"
      >
        <DialogTitle id="reassign-course-owner-title">
          Reassign course owner
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ minWidth: { sm: 420 }, pt: 1 }}>
            <Typography>
              Current owner: {selectedCourse ? ownerName(selectedCourse) : ""}
            </Typography>
            {usersQuery.isLoading && (
              <LinearProgress aria-label="Loading active coaches" />
            )}
            {usersQuery.isError && (
              <ErrorNotice message={friendlyMessage(usersQuery.error)} />
            )}
            {!usersQuery.isLoading && !usersQuery.isError && coaches.length === 0 && (
              <Alert severity="info">
                No active coaches are available in the loaded users. Load more to check
                additional accounts.
              </Alert>
            )}
            <FormControl
              fullWidth
              disabled={usersQuery.isError || coaches.length === 0}
            >
              <InputLabel id="course-owner-label">New owner</InputLabel>
              <Select
                labelId="course-owner-label"
                label="New owner"
                value={nextOwnerId}
                onChange={(event) => setNextOwnerId(event.target.value)}
              >
                {coaches.map((coach) => (
                  <MenuItem key={coach.id} value={coach.id}>
                    {coach.displayName} ({coach.email})
                  </MenuItem>
                ))}
                {selectedCourse &&
                  !coaches.some((coach) => coach.id === selectedCourse.ownerId) && (
                    <MenuItem value={selectedCourse.ownerId} disabled>
                      {ownerName(selectedCourse)} (current owner)
                    </MenuItem>
                  )}
              </Select>
            </FormControl>
            {usersQuery.hasNextPage && (
              <Button
                onClick={() => void usersQuery.fetchNextPage()}
                disabled={usersQuery.isFetchingNextPage}
                sx={{ alignSelf: "flex-start" }}
              >
                {usersQuery.isFetchingNextPage ? "Loading..." : "Load more coaches"}
              </Button>
            )}
            {usersQuery.isFetchNextPageError && (
              <ErrorNotice message={friendlyMessage(usersQuery.error)} />
            )}
            {ownerMutation.error && (
              <ErrorNotice message={friendlyMessage(ownerMutation.error)} />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSelectedCourse(null);
              setNextOwnerId("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              !selectedCourse ||
              !nextOwnerId ||
              nextOwnerId === selectedCourse.ownerId ||
              ownerMutation.isPending
            }
            onClick={() => {
              if (!selectedCourse || !nextOwnerId) return;
              ownerMutation.mutate({
                courseId: selectedCourse.id,
                ownerId: nextOwnerId,
                version: selectedCourse.version,
              });
            }}
          >
            Save owner
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={courseToArchive !== null}
        onClose={() => setCourseToArchive(null)}
        aria-labelledby="archive-course-title"
      >
        <DialogTitle id="archive-course-title">Archive course?</DialogTitle>
        <DialogContent>
          {archiveMutation.error && (
            <ErrorNotice message={friendlyMessage(archiveMutation.error)} />
          )}
          <Typography>
            {courseToArchive?.name} will no longer be active or accept new enrolment
            requests.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCourseToArchive(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!courseToArchive || archiveMutation.isPending}
            onClick={() => {
              if (courseToArchive) archiveMutation.mutate(courseToArchive);
            }}
          >
            Archive course
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
