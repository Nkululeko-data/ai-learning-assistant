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
  IconButton,
  InputLabel,
  LinearProgress,
  Menu,
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
import { MoreHorizontal } from "lucide-react";
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
  const [roleFilter, setRoleFilter] = useState<AdminUser["role"] | "all">("all");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [action, setAction] = useState<UserAction>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuUser, setMenuUser] = useState<AdminUser | null>(null);
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
    return users.filter(
      (item) =>
        (roleFilter === "all" || item.role === roleFilter) &&
        (!needle ||
          `${item.displayName} ${item.email} ${item.role} ${item.status}`
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [filter, roleFilter, usersQuery.data]);

  function openAction(target: AdminUser, nextAction: Exclude<UserAction, null>) {
    setSelectedUser(target);
    setAction(nextAction);
    if (nextAction === "role") setNextRole(target.role);
  }

  const errors = [
    roleMutation.error,
    statusMutation.error,
    erasureMutation.error,
  ].filter(Boolean);

  if (usersQuery.isLoading) {
    return (
      <Stack spacing={2}>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Users
        </Typography>
        <LinearProgress aria-label="Loading users" />
      </Stack>
    );
  }
  if (usersQuery.isError) {
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Typography component="h1" variant="h4" fontWeight={700}>
          Users
        </Typography>
        <ErrorNotice message={friendlyMessage(usersQuery.error)} />
        <Button onClick={() => void usersQuery.refetch()}>Retry</Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Users
        </Typography>
        <Typography color="text.secondary">
          Search and filter loaded rows. Load more to include additional accounts.
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
      <FormControl size="small" sx={{ maxWidth: 240 }}>
        <InputLabel id="user-role-filter-label">Filter by role</InputLabel>
        <Select
          labelId="user-role-filter-label"
          label="Filter by role"
          value={roleFilter}
          onChange={(event) =>
            setRoleFilter(event.target.value as AdminUser["role"] | "all")
          }
        >
          <MenuItem value="all">All roles</MenuItem>
          <MenuItem value="admin">Administrators</MenuItem>
          <MenuItem value="coach">Coaches</MenuItem>
          <MenuItem value="learner">Learners</MenuItem>
        </Select>
      </FormControl>
      {filteredUsers.length === 0 ? (
        <Alert severity="info">
          No users match the search and role filter on the loaded pages.
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Users">
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
                const canManageRole =
                  user?.permissions.includes("role:manage") ?? false;
                const canManageAccount =
                  user?.permissions.includes("user:manage") ?? false;
                const hasActions = canManageRole || canManageAccount;
                return (
                  <TableRow key={target.id}>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography fontWeight={600}>{target.displayName}</Typography>
                        {isSelf && <Chip label="You" size="small" />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {target.email}
                      </Typography>
                    </TableCell>
                    <TableCell>{roleLabel(target.role)}</TableCell>
                    <TableCell>{target.status}</TableCell>
                    <TableCell>
                      {target.mustChangePassword
                        ? "Password change required"
                        : "Active credentials"}
                    </TableCell>
                    <TableCell>
                      {!isSelf && hasActions && (
                        <IconButton
                          aria-label={`Actions for ${target.displayName}`}
                          aria-haspopup="menu"
                          onClick={(event) => {
                            setMenuAnchor(event.currentTarget);
                            setMenuUser(target);
                          }}
                        >
                          <MoreHorizontal aria-hidden="true" size={20} />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => {
          setMenuAnchor(null);
          setMenuUser(null);
        }}
        aria-label={menuUser ? `Actions for ${menuUser.displayName}` : "User actions"}
      >
        {user?.permissions.includes("role:manage") && (
          <MenuItem
            onClick={() => {
              if (menuUser) openAction(menuUser, "role");
              setMenuAnchor(null);
              setMenuUser(null);
            }}
          >
            Change role
          </MenuItem>
        )}
        {user?.permissions.includes("user:manage") && (
          <MenuItem
            onClick={() => {
              if (menuUser) openAction(menuUser, "status");
              setMenuAnchor(null);
              setMenuUser(null);
            }}
          >
            {menuUser?.status === "active" ? "Suspend" : "Activate"}
          </MenuItem>
        )}
        {user?.permissions.includes("user:manage") && (
          <MenuItem
            onClick={() => {
              if (menuUser) openAction(menuUser, "erase");
              setMenuAnchor(null);
              setMenuUser(null);
            }}
            sx={{ color: "error.main" }}
          >
            Erase data
          </MenuItem>
        )}
      </Menu>
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
            Choose the role for {selectedUser?.displayName}. Admin roles grant broad
            access.
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
              !selectedUser || nextRole === selectedUser.role || roleMutation.isPending
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
            Privacy erasure permanently anonymises {selectedUser?.displayName}&apos;s
            account, removes personal learning data, and pseudonymizes retained
            analytics. This cannot be undone.
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

function roleLabel(role: AdminUser["role"]): string {
  return {
    admin: "Administrator",
    coach: "Coach",
    learner: "Learner",
  }[role];
}
