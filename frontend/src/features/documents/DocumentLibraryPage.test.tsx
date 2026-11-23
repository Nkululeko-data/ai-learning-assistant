import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { DocumentLibraryPage } from "./DocumentLibraryPage";

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const coachId = "37c1dbbd-f72a-4508-a662-3992e2506ca4";
const learnerId = "47c1dbbd-f72a-4508-a662-3992e2506ca4";
const documentId = "9a7a7701-a1b1-42a4-890d-1b1e54055d0e";
const cleanupJobId = "a18a1c24-5061-4c1a-909e-c7bc96ca9518";

const course = {
  id: courseId,
  name: "Course one",
  ownerId: coachId,
  status: "active",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const uploadedDocument = {
  id: documentId,
  courseId,
  scope: "course",
  filename: "course.pdf",
  mimeType: "application/pdf",
  sizeBytes: 3,
  status: "uploaded",
  errorCode: null,
  errorDetail: null,
  extractionDiagnostics: null,
  chunkCount: null,
  embeddingModel: null,
  ingestJobId: "e18a1c24-5061-4c1a-909e-c7bc96ca9518",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  readyAt: null,
};

const readyDocument = {
  ...uploadedDocument,
  status: "ready" as const,
  sizeBytes: 1024,
  readyAt: "2026-01-01T00:01:00.000Z",
};

function createAuthContext(user: AuthenticatedUser): AuthContextValue {
  return {
    user,
    status: "ready",
    bootstrapError: null,
    signIn: async () => {},
    signUp: async () => ({
      user: {
        id: coachId,
        email: "coach@example.test",
        displayName: "Test coach",
        roleId: "81bf68e2-2767-4ee5-84c3-99359da40ce1",
        status: "active",
        mustChangePassword: false,
      },
      coachRequestCreated: false,
    }),
    signOut: async () => {},
    updatePassword: async () => {},
    retrySessionBootstrap: () => {},
  };
}

/** Renders the document page with isolated client-side query state. */
function renderDocumentLibrary(user: AuthenticatedUser) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <AuthContext.Provider value={createAuthContext(user)}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/courses/${courseId}/documents`]}>
          <Routes>
            <Route
              path="/courses/:courseId/documents"
              element={<DocumentLibraryPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe("DocumentLibraryPage", () => {
  it("uploads a valid file and polls its status until processing is ready", async () => {
    let uploaded = false;
    let statusRequests = 0;
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({ data: course }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({
          data: uploaded ? [uploadedDocument] : [],
        }),
      ),
      http.post(
        "http://localhost:3000/api/v1/documents/upload",
        async ({ request }) => {
          const formData = await request.formData();
          expect(formData.get("courseId")).toBe(courseId);
          expect(formData.get("scope")).toBe("course");
          expect(formData.get("file")).not.toBeNull();
          uploaded = true;
          return HttpResponse.json({ data: uploadedDocument }, { status: 202 });
        },
      ),
      http.get(`http://localhost:3000/api/v1/documents/${documentId}/status`, () => {
        statusRequests += 1;
        return HttpResponse.json({
          data: {
            ...uploadedDocument,
            status: "ready",
            readyAt: "2026-01-01T00:01:00.000Z",
          },
        });
      }),
    );

    const user: AuthenticatedUser = {
      id: coachId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: ["document:upload", "document:delete"],
      permsVersion: 1,
    };
    renderDocumentLibrary(user);

    const file = new File(["pdf"], "course.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Choose a PDF, DOCX, or TXT file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Ready")).toBeVisible();
    await waitFor(() => expect(statusRequests).toBeGreaterThan(0));
    expect(screen.getByText("course.pdf")).toBeVisible();
    const table = screen.getByRole("table", { name: "Course documents" });
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: "Uploaded" })).toBeVisible();
  });

  it("requires confirmation before permanently deleting a document", async () => {
    let deleteRequests = 0;
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({ data: course }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [readyDocument] }),
      ),
      http.delete(`http://localhost:3000/api/v1/documents/${documentId}`, () => {
        deleteRequests += 1;
        return HttpResponse.json({
          data: {
            id: documentId,
            status: "deleting",
            cleanupJobId,
          },
        });
      }),
    );

    renderDocumentLibrary({
      id: coachId,
      email: "coach@example.test",
      displayName: "Test coach",
      role: "coach",
      status: "active",
      mustChangePassword: false,
      permissions: ["document:upload", "document:delete"],
      permsVersion: 1,
    });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete course.pdf",
    });
    fireEvent.click(deleteButton);

    const dialog = screen.getByRole("dialog", { name: "Delete document?" });
    expect(dialog).toHaveTextContent("This cannot be undone.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deleteRequests).toBe(0);

    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(deleteRequests).toBe(1));
  });

  it("makes the learner upload scope explicit and personal-only", async () => {
    let uploadedScope = "";
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({ data: course }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post(
        "http://localhost:3000/api/v1/documents/upload",
        async ({ request }) => {
          uploadedScope = String((await request.formData()).get("scope"));
          return HttpResponse.json(
            { data: { ...uploadedDocument, scope: "personal" } },
            { status: 202 },
          );
        },
      ),
    );

    renderDocumentLibrary({
      id: learnerId,
      email: "learner@example.test",
      displayName: "Test learner",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      permissions: ["document:upload"],
      permsVersion: 1,
    });

    expect(await screen.findByRole("radio", { name: "Personal note" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Course material" })).toBeDisabled();
    expect(
      screen.getByText("Your personal note is visible only to you."),
    ).toBeVisible();

    const file = new File(["note"], "notes.txt", { type: "text/plain" });
    fireEvent.change(await screen.findByLabelText("Choose a PDF, DOCX, or TXT file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(uploadedScope).toBe("personal"));
  });
});
