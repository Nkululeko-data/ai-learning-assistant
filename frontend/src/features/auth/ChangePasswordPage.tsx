import { useState, type FormEvent } from "react";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { z } from "zod";
import { useAuth } from "../../auth/useAuth";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";
import { useNavigate } from "react-router-dom";

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
    confirmPassword: z.string().min(1).max(256),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "New passwords do not match.",
  });

export function ChangePasswordPage() {
  const { updatePassword, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const parsed = passwordFormSchema.parse({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      await updatePassword({
        currentPassword: parsed.currentPassword,
        newPassword: parsed.newPassword,
      });
      navigate("/login?passwordUpdated=1", { replace: true });
    } catch (error) {
      setFormError(
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? "Check the entered information.")
          : friendlyMessage(error),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      navigate("/login?logout=unconfirmed", { replace: true });
    }
  }

  return (
    <Box sx={{ maxWidth: 560, mx: "auto", p: 3 }}>
      <Paper sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography component="h1" variant="h5" fontWeight={700}>
              {user?.mustChangePassword ? "Change your password" : "Update password"}
            </Typography>
            {user?.mustChangePassword && (
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                You must choose a new password before continuing.
              </Typography>
            )}
          </Box>
          {formError && <ErrorNotice message={formError} />}
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              <TextField
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                inputProps={{ maxLength: 256 }}
              />
              <TextField
                label="New password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                inputProps={{ maxLength: 256 }}
              />
              <TextField
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                inputProps={{ maxLength: 256 }}
              />
              <Button type="submit" variant="contained" disabled={submitting}>
                {submitting ? "Updating..." : "Update password"}
              </Button>
              {!user?.mustChangePassword && (
                <Button color="inherit" onClick={() => void handleSignOut()}>
                  Sign out instead
                </Button>
              )}
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
