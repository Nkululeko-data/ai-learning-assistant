import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/auth";
import { AuthContext, type AuthContextValue } from "../../auth/auth-context";
import { server } from "../../test/server";
import { DocumentLibraryPage } from "./DocumentLibraryPage";

const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const coachId = "37c1dbbd-f72a-4508-a662-3992e2506ca4";
const documentId = "9a7a7701-a1b1-42a4-890d-1b1e54055d0e";

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

describe("DocumentLibraryPage", () => {
  it("uploads a valid file and polls its status until processing is ready", async () => {
    let uploaded = false;
    let statusRequests = 0;
    server.use(
      http.get(`http://localhost:3000/api/v1/courses/${courseId}`, () =>
        HttpResponse.json({
          data: {
            id: courseId,
            name: "Course one",
            ownerId: coachId,
            status: "active",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
      http.get(`http://localhost:3000/api/v1/courses/${courseId}/documents`, () =>
        HttpResponse.json({
          data: uploaded ? [{ ...uploadedDocument, status: "uploaded" }] : [],
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
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
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

    const file = new File(["pdf"], "course.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Choose a PDF, DOCX, or TXT file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Ready")).toBeVisible();
    await waitFor(() => expect(statusRequests).toBeGreaterThan(0));
    expect(screen.getByText("course.pdf")).toBeVisible();
  });
});
