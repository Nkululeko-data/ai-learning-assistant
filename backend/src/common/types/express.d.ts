import "express-serve-static-core";
import type { AuthenticatedUser } from "../../modules/auth/auth.types";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    auth: AuthenticatedUser | undefined;
  }
}
