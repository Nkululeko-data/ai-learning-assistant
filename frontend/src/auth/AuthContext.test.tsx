import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./useAuth";
import { server } from "../test/server";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const apiOrigin = "http://localhost:3000/api/v1";

function SessionUser() {
  const { status, user } = useAuth();
  return <div>{status === "ready" ? (user?.email ?? "signed out") : "loading"}</div>;
}

describe("AuthProvider", () => {
  it("uses the authenticated user returned by refresh without a second request", async () => {
    let currentUserRequests = 0;
    server.use(
      http.post(`${apiOrigin}/auth/refresh`, () =>
        HttpResponse.json({
          data: {
            user: {
              id: userId,
              email: "admin@example.test",
              displayName: "Test admin",
              roleId: userId,
              status: "active",
              mustChangePassword: false,
            },
            authenticatedUser: {
              id: userId,
              email: "admin@example.test",
              displayName: "Test admin",
              role: "admin",
              status: "active",
              mustChangePassword: false,
              permissions: ["user:manage"],
              permsVersion: 1,
            },
            accessToken: "access-token",
            accessTokenExpiresIn: 900,
          },
        }),
      ),
      http.get(`${apiOrigin}/me`, () => {
        currentUserRequests += 1;
        return HttpResponse.json({
          data: {
            id: userId,
            email: "admin@example.test",
            displayName: "Test admin",
            role: "admin",
            status: "active",
            mustChangePassword: false,
            permissions: ["user:manage"],
            permsVersion: 1,
          },
        });
      }),
    );

    render(
      <AuthProvider>
        <SessionUser />
      </AuthProvider>,
    );

    expect(await screen.findByText("admin@example.test")).toBeVisible();
    expect(currentUserRequests).toBe(0);
  });
});
