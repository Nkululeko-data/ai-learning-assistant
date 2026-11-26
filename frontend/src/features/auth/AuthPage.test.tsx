import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { AuthPage } from "./AuthPage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";

function createAuthContext(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: null,
    status: "ready",
    bootstrapError: null,
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => ({
      user: {
        id: userId,
        email: "new-user@example.test",
        displayName: "New user",
        roleId: userId,
        status: "active" as const,
        mustChangePassword: false,
      },
      coachRequestCreated: false,
    })),
    signOut: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
    retrySessionBootstrap: vi.fn(),
    ...overrides,
  };
}

function CurrentSearch() {
  const location = useLocation();
  return <output data-testid="current-search">{location.search}</output>;
}

function renderAuth(
  initialEntry = "/login",
  overrides: Partial<AuthContextValue> = {},
) {
  const auth = createAuthContext(overrides);
  const rendered = render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthPage />
        <CurrentSearch />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { ...rendered, auth };
}

describe("AuthPage", () => {
  it("renders the supplied accessible hero image with intrinsic dimensions", () => {
    renderAuth();

    expect(
      screen.getByRole("img", {
        name: "A learner studying at a desk while a friendly AI assistant helps her.",
      }),
    ).toHaveAttribute("src", "/images/auth-hero.webp");
    expect(
      screen.getByRole("img", {
        name: "A learner studying at a desk while a friendly AI assistant helps her.",
      }),
    ).toHaveAttribute("width", "1376");
    expect(
      screen.getByRole("img", {
        name: "A learner studying at a desk while a friendly AI assistant helps her.",
      }),
    ).toHaveAttribute("height", "768");
  });

  it("switches tabs with keyboard support and remembers the mode in the URL", async () => {
    const user = userEvent.setup();
    renderAuth();

    await user.click(screen.getByRole("tab", { name: "Create account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeVisible();
    expect(screen.getByTestId("current-search")).toHaveTextContent("mode=signup");
    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(screen.getByTestId("current-search")).toHaveTextContent("mode=signin"),
    );
  });

  it("validates required fields inline on blur and in the submit summary", async () => {
    const user = userEvent.setup();
    const { auth } = renderAuth();
    const email = screen.getByRole("textbox", { name: "Email" });

    await user.click(email);
    await user.tab();
    expect(screen.getByText("Enter your email address.")).toBeVisible();
    expect(email).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email");
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("toggles password visibility without changing the value", async () => {
    const user = userEvent.setup();
    renderAuth();
    const password = screen.getByLabelText("Password");

    await user.type(password, "safe-example");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("safe-example");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeVisible();
  });

  it("shows a disabled loading state while sign-in is pending", async () => {
    const user = userEvent.setup();
    let finishSignIn: (() => void) | undefined;
    const signIn = vi.fn<AuthContextValue["signIn"]>(
      () =>
        new Promise<void>((resolve) => {
          finishSignIn = resolve;
        }),
    );
    renderAuth("/login", { signIn });

    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "learner@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "password-value");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const submitButton = screen.getByRole("button", { name: "Signing in..." });
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "true");

    finishSignIn?.();
    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  it("uses a generic message for invalid credentials", async () => {
    const user = userEvent.setup();
    const signIn = vi
      .fn<AuthContextValue["signIn"]>()
      .mockRejectedValue(
        new ApiError(
          401,
          "AUTH_INVALID_CREDENTIALS",
          "This email address was not found.",
        ),
      );
    renderAuth("/login", { signIn });

    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "unknown@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "incorrect-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect email or password",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "This email address was not found",
    );
  });

  it("passes coach-access requests through the existing registration flow", async () => {
    const user = userEvent.setup();
    const signUp = vi.fn<AuthContextValue["signUp"]>().mockResolvedValue({
      user: {
        id: userId,
        email: "coach@example.test",
        displayName: "Coach",
        roleId: userId,
        status: "active",
        mustChangePassword: false,
      },
      coachRequestCreated: true,
    });
    renderAuth("/login?mode=signup", { signUp });

    await user.type(screen.getByLabelText("Display name"), "Coach");
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "coach@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "server-validated-password");
    await user.click(screen.getByRole("checkbox", { name: "Request coach access" }));
    expect(
      screen.getByText("Coach accounts are reviewed before access is granted."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "coach@example.test",
          displayName: "Coach",
          requestCoach: true,
        }),
      ),
    );
    expect(
      await screen.findByText(/Your coach request is awaiting review/),
    ).toHaveTextContent("Your coach request is awaiting review");
    await waitFor(() =>
      expect(screen.getByTestId("current-search")).toHaveTextContent("mode=signin"),
    );
  });

  it("shows server password-rule messages without adding client-side strength rules", async () => {
    const user = userEvent.setup();
    const signUp = vi
      .fn<AuthContextValue["signUp"]>()
      .mockRejectedValue(
        new ApiError(422, "VALIDATION_ERROR", "Password does not meet policy.", [
          { path: "password", message: "Use a less common password." },
        ]),
      );
    renderAuth("/login?mode=signup", { signUp });

    await user.type(screen.getByLabelText("Display name"), "Learner");
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "learner@example.test",
    );
    await user.type(screen.getByLabelText("Password"), "weak-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "password: Use a less common password.",
    );
    expect(screen.getAllByText("password: Use a less common password.")).toHaveLength(
      2,
    );
  });
});
