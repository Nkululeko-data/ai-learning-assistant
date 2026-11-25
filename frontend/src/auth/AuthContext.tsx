import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  changePassword as changePasswordRequest,
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  refresh,
  register as registerRequest,
  type AuthenticatedUser,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from "../api/auth";
import { AuthContext, type AuthContextValue } from "./auth-context";
import {
  ApiError,
  clearAccessToken,
  friendlyMessage,
  setAccessToken,
  setSessionExpiredHandler,
} from "../api/client";

let sessionBootstrap: Promise<AuthenticatedUser> | null = null;

function restoreSession(): Promise<AuthenticatedUser> {
  if (!sessionBootstrap) {
    sessionBootstrap = refresh()
      .then((result) => {
        setAccessToken(result.accessToken);
        return result.authenticatedUser ?? getCurrentUser();
      })
      .finally(() => {
        sessionBootstrap = null;
      });
  }
  return sessionBootstrap;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  const clearSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setStatus("ready");
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((currentUser) => {
        if (active) {
          setUser(currentUser);
        }
      })
      .catch((error: unknown) => {
        clearAccessToken();
        if (!active) {
          return;
        }
        setUser(null);
        if (!(error instanceof ApiError && error.status === 401)) {
          setBootstrapError(friendlyMessage(error));
        }
      })
      .finally(() => {
        if (active) {
          setStatus("ready");
        }
      });
    return () => {
      active = false;
    };
  }, [bootstrapAttempt]);

  const signIn = useCallback(async (input: LoginInput) => {
    const result = await loginRequest(input);
    setAccessToken(result.accessToken);
    try {
      const currentUser = result.authenticatedUser ?? (await getCurrentUser());
      setUser(currentUser);
      setBootstrapError(null);
    } catch (error) {
      clearAccessToken();
      throw error;
    }
  }, []);

  const signUp = useCallback((input: RegisterInput) => registerRequest(input), []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const updatePassword = useCallback(
    async (input: ChangePasswordInput) => {
      await changePasswordRequest(input);
      clearSession();
    },
    [clearSession],
  );

  const retrySessionBootstrap = useCallback(() => {
    setStatus("loading");
    setBootstrapError(null);
    setBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      bootstrapError,
      signIn,
      signUp,
      signOut,
      updatePassword,
      retrySessionBootstrap,
    }),
    [
      user,
      status,
      bootstrapError,
      signIn,
      signUp,
      signOut,
      updatePassword,
      retrySessionBootstrap,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
