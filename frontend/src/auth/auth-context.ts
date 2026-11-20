import { createContext } from "react";
import type {
  AuthenticatedUser,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  RegistrationResult,
} from "../api/auth";

type AuthStatus = "loading" | "ready";

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  status: AuthStatus;
  bootstrapError: string | null;
  signIn(input: LoginInput): Promise<void>;
  signUp(input: RegisterInput): Promise<RegistrationResult>;
  signOut(): Promise<void>;
  updatePassword(input: ChangePasswordInput): Promise<void>;
  retrySessionBootstrap(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
