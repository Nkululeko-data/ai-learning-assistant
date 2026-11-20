import { useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { z } from "zod";
import { useAuth } from "../../auth/useAuth";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";
import { useSearchParams } from "react-router-dom";

const loginFormSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

const registerFormSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
  displayName: z.string().trim().min(1).max(80),
  requestCoach: z.boolean(),
  coachMessage: z.string().trim().max(500).optional(),
});

type AuthMode = "login" | "register";

export function AuthPage() {
  const { signIn, signUp, bootstrapError, retrySessionBootstrap } = useAuth();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requestCoach, setRequestCoach] = useState(false);
  const [coachMessage, setCoachMessage] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        const parsed = loginFormSchema.parse({ email, password });
        await signIn(parsed);
      } else {
        const parsed = registerFormSchema.parse({
          email,
          password,
          displayName,
          requestCoach,
          ...(coachMessage.trim() ? { coachMessage } : {}),
        });
        const result = await signUp(parsed);
        setNotice(
          result.coachRequestCreated
            ? "Account created. Your coach request is awaiting review; you can now sign in as a learner."
            : "Account created. You can now sign in.",
        );
        setMode("login");
        setPassword("");
      }
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

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 5, sm: 9 } }}>
      <Paper elevation={2} sx={{ p: { xs: 3, sm: 5 } }}>
        <Stack spacing={3}>
          <Box>
            <Typography component="h1" variant="h4" fontWeight={700}>
              AI Learning Assistant
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Sign in to your learning workspace or create a learner account.
            </Typography>
          </Box>

          {bootstrapError && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" onClick={retrySessionBootstrap}>
                  Retry
                </Button>
              }
            >
              Could not check for an existing session: {bootstrapError}
            </Alert>
          )}
          {searchParams.get("passwordUpdated") === "1" && (
            <Alert severity="success" role="status">
              Password updated. Sign in again with your new password.
            </Alert>
          )}
          {searchParams.get("logout") === "unconfirmed" && (
            <Alert severity="warning" role="status">
              You were signed out on this device, but the server could not confirm token
              revocation. Check your connection before signing in again.
            </Alert>
          )}
          {notice && <Alert severity="success">{notice}</Alert>}
          {formError && <ErrorNotice message={formError} />}

          <Tabs
            value={mode}
            onChange={(_event, value: AuthMode) => {
              setMode(value);
              setFormError(null);
              setNotice(null);
            }}
            aria-label="Account access"
            variant="fullWidth"
          >
            <Tab value="login" label="Sign in" />
            <Tab value="register" label="Create account" />
          </Tabs>

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.25}>
              {mode === "register" && (
                <TextField
                  label="Display name"
                  name="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  required
                  inputProps={{ maxLength: 80 }}
                />
              )}
              <TextField
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                inputProps={{ maxLength: 254 }}
              />
              <TextField
                label="Password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                inputProps={{ maxLength: 256 }}
                helperText={
                  mode === "register"
                    ? "The server enforces its configured length and weak-password rules."
                    : undefined
                }
              />
              {mode === "register" && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={requestCoach}
                        onChange={(event) => setRequestCoach(event.target.checked)}
                      />
                    }
                    label="Request coach access"
                  />
                  {requestCoach && (
                    <TextField
                      label="Why would you like coach access? (optional)"
                      name="coachMessage"
                      value={coachMessage}
                      onChange={(event) => setCoachMessage(event.target.value)}
                      multiline
                      minRows={2}
                      inputProps={{ maxLength: 500 }}
                    />
                  )}
                </>
              )}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={submitting}
              >
                {submitting
                  ? "Please wait..."
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
}
