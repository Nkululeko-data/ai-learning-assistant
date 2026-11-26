import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Eye, EyeOff, GraduationCap } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ApiError, friendlyMessage } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { designTokens } from "../../theme/designTokens";
import "./AuthPage.css";

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

const emailFieldSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "Email must be 254 characters or fewer.")
  .email("Enter a valid email address.");
const passwordFieldSchema = z
  .string()
  .min(1, "Enter your password.")
  .max(256, "Password must be 256 characters or fewer.");
const displayNameFieldSchema = z
  .string()
  .trim()
  .min(1, "Enter your display name.")
  .max(80, "Display name must be 80 characters or fewer.");

type AuthMode = "login" | "register";
type AuthField = "email" | "password" | "displayName";
type LegalDocument = "privacy" | "terms";

const authStyle = {
  "--learnova-navy": designTokens.auth.navy,
  "--learnova-navy-deep": designTokens.auth.navyDeep,
  "--learnova-navy-light": designTokens.auth.navyLight,
  "--learnova-orange": designTokens.auth.orange,
  "--learnova-cream": designTokens.auth.cream,
  "--learnova-gold": designTokens.auth.gold,
  "--learnova-sand": designTokens.auth.sand,
  "--learnova-line": designTokens.auth.line,
  "--learnova-white": designTokens.auth.white,
  "--learnova-heading-font": designTokens.typography.headingFamily,
  "--learnova-body-font": designTokens.typography.bodyFamily,
} as CSSProperties;

export function AuthPage() {
  const { signIn, signUp, bootstrapError, retrySessionBootstrap } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: AuthMode = searchParams.get("mode") === "signup" ? "register" : "login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requestCoach, setRequestCoach] = useState(false);
  const [coachMessage, setCoachMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotHelpOpen, setForgotHelpOpen] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AuthField, string>>>(
    {},
  );
  const [passwordServerHint, setPasswordServerHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function changeMode(nextMode: AuthMode, preserveNotice = false) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("mode", nextMode === "register" ? "signup" : "signin");
        return next;
      },
      { replace: true },
    );
    setFieldErrors({});
    setPasswordServerHint(null);
    setFormError(null);
    setForgotHelpOpen(false);
    if (!preserveNotice) setNotice(null);
  }

  function validateField(field: AuthField, value: string) {
    const schema =
      field === "email"
        ? emailFieldSchema
        : field === "password"
          ? passwordFieldSchema
          : displayNameFieldSchema;
    const result = schema.safeParse(value);
    setFieldErrors((current) => ({
      ...current,
      [field]: result.success ? undefined : result.error.issues[0]?.message,
    }));
  }

  function clearFieldError(field: AuthField) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
    if (field === "password") setPasswordServerHint(null);
  }

  function reportValidationIssue(error: z.ZodError) {
    const issue = error.issues[0];
    if (!issue) {
      setFormError("Check the entered information.");
      return;
    }
    const field = issue.path[0];
    if (field === "email" || field === "password" || field === "displayName") {
      setFieldErrors((current) => ({ ...current, [field]: issue.message }));
    }
    setFormError(issue.message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    setPasswordServerHint(null);

    if (mode === "login") {
      const parsed = loginFormSchema.safeParse({ email, password });
      if (!parsed.success) {
        reportValidationIssue(parsed.error);
        return;
      }

      setSubmitting(true);
      try {
        await signIn(parsed.data);
      } catch (error) {
        const isCredentialError =
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429;
        setFormError(
          isCredentialError ? "Incorrect email or password" : friendlyMessage(error),
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const parsed = registerFormSchema.safeParse({
      email,
      password,
      displayName,
      requestCoach,
      ...(coachMessage.trim() ? { coachMessage } : {}),
    });
    if (!parsed.success) {
      reportValidationIssue(parsed.error);
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUp(parsed.data);
      setNotice(
        result.coachRequestCreated
          ? "Account created. Your coach request is awaiting review; you can now sign in as a learner."
          : "Account created. You can now sign in.",
      );
      setPassword("");
      setShowPassword(false);
      changeMode("login", true);
    } catch (error) {
      const message = friendlyMessage(error);
      setFormError(message);
      if (/password/i.test(message)) setPasswordServerHint(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box className="learnova-auth" style={authStyle}>
      <Box component="aside" className="learnova-story-panel">
        <Box className="learnova-story-image-frame">
          <img
            className="learnova-story-image"
            src="/images/auth-hero.webp"
            alt="A learner studying at a desk while a friendly AI assistant helps her."
            width={1376}
            height={768}
            decoding="async"
          />
          <LearnovaBrand className="learnova-brand" />
        </Box>
        <Box className="learnova-story-content">
          <Typography className="learnova-story-eyebrow">
            A helpful AI, right beside you
          </Typography>
          <Typography component="h2" className="learnova-story-headline">
            A little help goes a long way.
          </Typography>
          <Typography className="learnova-story-subtext">
            Take your time with your course materials. When you get stuck, ask your AI
            tutor for another explanation.
          </Typography>
        </Box>
      </Box>

      <Box component="main" className="learnova-auth-main">
        <Box className="learnova-auth-content">
          <Stack spacing={2.5}>
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
                You were signed out on this device, but the server could not confirm
                token revocation. Check your connection before signing in again.
              </Alert>
            )}
            {notice && (
              <Alert severity="success" role="status">
                {notice}
              </Alert>
            )}
            {formError && (
              <Alert severity="error" role="alert" aria-live="assertive">
                {formError}
              </Alert>
            )}

            <Box>
              <Typography
                component="h1"
                variant="h4"
                fontWeight={700}
                className="learnova-auth-title"
                sx={{ color: designTokens.auth.navyDeep }}
              >
                {mode === "login" ? "Welcome back" : "Create your account"}
              </Typography>
              <Typography
                className="learnova-auth-subtitle"
                color="text.secondary"
                sx={{ mt: 0.75 }}
              >
                {mode === "login"
                  ? "Sign in to pick up where you left off."
                  : "Build your learning workspace and get started."}
              </Typography>
            </Box>

            <Tabs
              value={mode}
              onChange={(_event, value: AuthMode) => changeMode(value)}
              aria-label="Account access"
              className="learnova-auth-tabs"
              variant="fullWidth"
            >
              <Tab
                value="login"
                label="Sign in"
                id="auth-tab-login"
                aria-controls={mode === "login" ? "auth-panel-login" : undefined}
              />
              <Tab
                value="register"
                label="Create account"
                id="auth-tab-register"
                aria-controls={mode === "register" ? "auth-panel-register" : undefined}
              />
            </Tabs>

            <Box
              key={mode}
              className="learnova-form-transition"
              role="tabpanel"
              id={`auth-panel-${mode}`}
              aria-labelledby={`auth-tab-${mode}`}
            >
              <Box
                component="form"
                aria-label={mode === "login" ? "Sign in" : "Create account"}
                onSubmit={handleSubmit}
                noValidate
                aria-busy={submitting}
              >
                <Stack spacing={2}>
                  {mode === "register" && (
                    <AuthFieldLabel htmlFor="auth-display-name">
                      Display name
                    </AuthFieldLabel>
                  )}
                  {mode === "register" && (
                    <TextField
                      id="auth-display-name"
                      name="displayName"
                      value={displayName}
                      onChange={(event) => {
                        setDisplayName(event.target.value);
                        clearFieldError("displayName");
                      }}
                      onBlur={() => validateField("displayName", displayName)}
                      autoComplete="name"
                      required
                      fullWidth
                      error={Boolean(fieldErrors.displayName)}
                      helperText={fieldErrors.displayName}
                      inputProps={{ maxLength: 80 }}
                    />
                  )}

                  <AuthFieldLabel htmlFor="auth-email">Email</AuthFieldLabel>
                  <TextField
                    id="auth-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      clearFieldError("email");
                    }}
                    onBlur={() => validateField("email", email)}
                    autoComplete="email"
                    required
                    fullWidth
                    error={Boolean(fieldErrors.email)}
                    helperText={fieldErrors.email}
                    inputProps={{ maxLength: 254 }}
                  />

                  <Stack spacing={0.75}>
                    <AuthFieldLabel htmlFor="auth-password">Password</AuthFieldLabel>
                    <TextField
                      id="auth-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        clearFieldError("password");
                      }}
                      onBlur={() => validateField("password", password)}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      required
                      fullWidth
                      error={Boolean(fieldErrors.password)}
                      helperText={
                        fieldErrors.password ??
                        (mode === "register"
                          ? (passwordServerHint ??
                            "The server enforces its configured length and weak-password rules.")
                          : undefined)
                      }
                      inputProps={{ maxLength: 256 }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              type="button"
                              edge="end"
                              aria-label={
                                showPassword ? "Hide password" : "Show password"
                              }
                              onClick={() => setShowPassword((shown) => !shown)}
                              onMouseDown={(event) => event.preventDefault()}
                            >
                              {showPassword ? (
                                <EyeOff size={20} aria-hidden="true" />
                              ) : (
                                <Eye size={20} aria-hidden="true" />
                              )}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Stack>

                  {mode === "login" && (
                    <Stack spacing={0.5} alignItems="flex-end">
                      <Link
                        href="#forgot-password-help"
                        className="learnova-auth-link"
                        onClick={(event) => {
                          event.preventDefault();
                          setForgotHelpOpen((open) => !open);
                        }}
                        aria-expanded={forgotHelpOpen}
                      >
                        Forgot password?
                      </Link>
                      {forgotHelpOpen && (
                        <Alert
                          id="forgot-password-help"
                          severity="info"
                          sx={{ width: "100%" }}
                        >
                          Self-service reset is not available. Contact your
                          administrator for help resetting your password.
                        </Alert>
                      )}
                    </Stack>
                  )}

                  {mode === "register" && (
                    <>
                      <Box>
                        <FormControlLabel
                          sx={{ minHeight: 44, alignItems: "center", ml: -1 }}
                          control={
                            <Checkbox
                              checked={requestCoach}
                              onChange={(event) =>
                                setRequestCoach(event.target.checked)
                              }
                              inputProps={{
                                "aria-describedby": "coach-access-helper",
                              }}
                            />
                          }
                          label="Request coach access"
                        />
                        <Typography
                          id="coach-access-helper"
                          variant="body2"
                          color="text.secondary"
                          sx={{ ml: 4.5, mt: -0.5 }}
                        >
                          Coach accounts are reviewed before access is granted.
                        </Typography>
                      </Box>
                      {requestCoach && (
                        <Box>
                          <AuthFieldLabel htmlFor="auth-coach-message">
                            Why would you like coach access? (optional)
                          </AuthFieldLabel>
                          <TextField
                            id="auth-coach-message"
                            name="coachMessage"
                            value={coachMessage}
                            onChange={(event) => setCoachMessage(event.target.value)}
                            multiline
                            minRows={2}
                            fullWidth
                            inputProps={{ maxLength: 500 }}
                          />
                        </Box>
                      )}
                    </>
                  )}

                  <Button
                    type="submit"
                    variant="contained"
                    disabled={submitting}
                    aria-busy={submitting}
                    startIcon={
                      submitting ? (
                        <CircularProgress
                          size={18}
                          color="inherit"
                          aria-hidden="true"
                        />
                      ) : undefined
                    }
                    sx={{
                      minHeight: 50,
                      mt: 0.5,
                      borderRadius: "12px",
                      backgroundColor: designTokens.auth.orange,
                      color: designTokens.auth.white,
                      fontWeight: 700,
                      "&:hover": {
                        backgroundColor: designTokens.color.accentActive,
                      },
                      "&.Mui-disabled": {
                        backgroundColor: `color-mix(in srgb, ${designTokens.auth.orange} 52%, transparent)`,
                        color: `color-mix(in srgb, ${designTokens.auth.white} 92%, transparent)`,
                      },
                    }}
                  >
                    {submitting
                      ? mode === "login"
                        ? "Signing in..."
                        : "Creating account..."
                      : mode === "login"
                        ? "Sign in"
                        : "Create account"}
                  </Button>
                </Stack>
              </Box>
            </Box>

            <Box component="footer" className="learnova-auth-footer">
              <Typography variant="body2" color="text.secondary">
                Teaching a course? Choose Create account, then tick Request coach
                access.
              </Typography>
              <Stack direction="row" spacing={2} sx={{ mt: 1.25 }}>
                <Link
                  href="#privacy"
                  className="learnova-auth-link"
                  onClick={(event) => {
                    event.preventDefault();
                    setLegalDocument("privacy");
                  }}
                >
                  Privacy
                </Link>
                <Link
                  href="#terms"
                  className="learnova-auth-link"
                  onClick={(event) => {
                    event.preventDefault();
                    setLegalDocument("terms");
                  }}
                >
                  Terms
                </Link>
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>

      <Dialog
        open={legalDocument !== null}
        onClose={() => setLegalDocument(null)}
        aria-labelledby="learnova-legal-title"
      >
        <DialogTitle id="learnova-legal-title">
          {legalDocument === "privacy" ? "Privacy" : "Terms"}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {legalDocument === "privacy"
              ? "Please contact your organization administrator for its current privacy notice."
              : "Please contact your organization administrator for the terms that apply to your account."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLegalDocument(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function AuthFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      variant="body2"
      fontWeight={650}
      sx={{ display: "block", mb: -1.25, color: designTokens.auth.navyDeep }}
    >
      {children}
    </Typography>
  );
}

function LearnovaBrand({ className }: { className: string }) {
  return (
    <Box className={className} role="img" aria-label="Learnova">
      <Box className="learnova-brand-mark" aria-hidden="true">
        <GraduationCap size={25} strokeWidth={1.8} />
      </Box>
      <span>Learnova</span>
    </Box>
  );
}
