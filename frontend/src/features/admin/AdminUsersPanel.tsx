import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
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
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { friendlyMessage } from "../../api/client";
import {
  enqueueUserErasure,
  listAdminUsers,
  updateUserRole,
  updateUserStatus,
  type AdminUser,
} from "../../api/admin";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";

type UserAction = "role" | "status" | "erase" | null;

export function AdminUsersPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [action, setAction] = useState<UserAction>(null);
  const [nextRole, setNextRole] = useState<AdminUser["role"]>("learner");
  const [erasureJobId, setErasureJobId] = useState<string | null>(null);

  const usersQuery = useInfiniteQuery({
    queryKey: ["admin", "users"],
    queryFn: ({ pageParam }) =>
      listAdminUsers({ limit: 20, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AdminUser["role"] }) =>
      updateUserRole(userId, role),
    onSuccess: async () => {
      setAction(null);
      setSelectedUser(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: AdminUser["status"] }) =>
      updateUserStatus(userId, status),
    onSuccess: async () => {
      setAction(null);
      setSelectedUser(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
  const erasureMutation = useMutation({
    mutationFn: enqueueUserErasure,
    onSuccess: async (result) => {
      setAction(null);
      setSelectedUser(null);
      setErasureJobId(result.jobId);
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
  });

  const filteredUsers = useMemo(() => {
    const users = usersQuery.data?.pages.flatMap((page) => page.items) ?? [];
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return users;
    return users.filter((item) =>
      `${item.displayName} ${item.email} ${item.role} ${item.status}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [filter, usersQuery.data]);

  function openAction(target: AdminUser, nextAction: Exclude<UserAction, null>) {
    setSelectedUser(target);
    setAction(nextAction);
    if (nextAction === "role") setNextRole(target.role);
  }

  const errors = [
    usersQuery.error,
    roleMutation.error,
    statusMutation.error,
    erasureMutation.error,
  ].filter(Boolean);

  if (usersQuery.isLoading) {
    return <LinearProgress aria-label="Loading users" />;
  }
  if (usersQuery.isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(usersQuery.error)} />
        <Button onClick={() => void usersQuery.refetch()}>Retry</Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h2" variant="h5" fontWeight={650}>
          User accounts
        </Typography>
        <Typography color="text.secondary">
          Search the loaded pages, change roles, and manage account access.
        </Typography>
      </Box>
      {errors.map((error, index) => (
        <ErrorNotice key={index} message={friendlyMessage(error)} />
      ))}
      {erasureJobId && (
        <Alert severity="success" onClose={() => setErasureJobId(null)}>
          Privacy erasure was queued. Job ID: <code>{erasureJobId}</code>
        </Alert>
      )}
      <TextField
        label="Search loaded users"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        size="small"
        sx={{ maxWidth: 420 }}
      />
      {filteredUsers.length === 0 ? (
        <Alert severity="info">No users match this search on the loaded pages.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="User accounts">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredUsers.map((target) => {
                const isSelf = target.id === user?.id;
                return (
                  <TableRow key={target.id}>
                    <TableCell>
                      <Typography fontWeight={600}>{target.displayName}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {target.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={target.role} size="small" />
                    </TableCell>
                    <TableCell>{target.status}</TableCell>
                    <TableCell>
                      {target.mustChangePassword ? "Password change required" : "Active credentials"}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        {user?.permissions.includes("role:manage") && (
                          <Button
                            size="small"
                            disabled={isSelf || roleMutation.isPending}
                            onClick={() => openAction(target, "role")}
                          >
                            Change role
                          </Button>
                        )}
                        {user?.permissions.includes("user:manage") && (
                          <>
                            <Button
                              size="small"
                              disabled={isSelf || statusMutation.isPending}
                              onClick={() => openAction(target, "status")}
                            >
                              {target.status === "active" ? "Suspend" : "Activate"}
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              disabled={isSelf || erasureMutation.isPending}
                              onClick={() => openAction(target, "erase")}
                            >
                              Erase data
                            </Button>
                          </>
                        )}
                        {isSelf && (
                          <Typography variant="caption" color="text.secondary">
                            Your account cannot be changed here.
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {usersQuery.hasNextPage && (
        <Button
          variant="outlined"
          onClick={() => void usersQuery.fetchNextPage()}
          disabled={usersQuery.isFetchingNextPage}
          sx={{ alignSelf: "flex-start" }}
        >
          {usersQuery.isFetchingNextPage ? "Loading..." : "Load more users"}
        </Button>
      )}
      <Dialog
        open={action === "role" && selectedUser !== null}
        onClose={() => setAction(null)}
        aria-labelledby="change-role-title"
      >
        <DialogTitle id="change-role-title">Change user role</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Choose the role for {selectedUser?.displayName}. Admin roles grant broad access.
          </Typography>
          <FormControl fullWidth>
            <InputLabel id="user-role-label">Role</InputLabel>
            <Select
              labelId="user-role-label"
              label="Role"
              value={nextRole}
              onChange={(event) => setNextRole(event.target.value as AdminUser["role"])}
            >
              <MenuItem value="learner">Learner</MenuItem>
              <MenuItem value="coach">Coach</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAction(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              !selectedUser ||
              nextRole === selectedUser.role ||
              roleMutation.isPending
            }
            onClick={() => {
              if (selectedUser) {
                roleMutation.mutate({ userId: selectedUser.id, role: nextRole });
              }
            }}
          >
            Save role
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={action === "status" && selectedUser !== null}
        onClose={() => setAction(null)}
        aria-labelledby="change-status-title"
      >
        <DialogTitle id="change-status-title">
          {selectedUser?.status === "active" ? "Suspend account?" : "Activate account?"}
        </DialogTitle>
        <DialogContent>
          {selectedUser?.status === "active"
            ? `This will revoke active sessions for ${selectedUser.displayName}.`
            : `This will restore sign-in access for ${selectedUser?.displayName}.`}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAction(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!selectedUser || statusMutation.isPending}
            onClick={() => {
              if (!selectedUser) return;
              const status = selectedUser.status === "active" ? "suspended" : "active";
              statusMutation.mutate({ userId: selectedUser.id, status });
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={action === "erase" && selectedUser !== null}
        onClose={() => setAction(null)}
        aria-labelledby="erase-user-title"
      >
        <DialogTitle id="erase-user-title">Queue privacy erasure?</DialogTitle>
        <DialogContent>
          <Typography>
            This permanently removes {selectedUser?.displayName}&apos;s personal learning
            data and pseudonymizes retained analytics. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAction(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!selectedUser || erasureMutation.isPending}
            onClick={() => {
              if (selectedUser) erasureMutation.mutate(selectedUser.id);
            }}
          >
            Queue erasure
          </Button>
        </DialogActions>
      </Dialog>

    </Stack>
  );
}
