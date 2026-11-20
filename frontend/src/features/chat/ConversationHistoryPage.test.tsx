import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { ConversationHistoryPage } from "./ConversationHistoryPage";

const userId = "307d4918-a7f5-4db4-b857-97d8176e305b";
const courseId = "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7911";
const conversationId = "3eb0d2cf-35d3-4775-94da-f0c18c4481a7";

describe("ConversationHistoryPage", () => {
  it("searches loaded items, renames, reopens, and deletes a conversation", async () => {
    let title = "Intro chat";
    let deleted = false;
    server.use(
      http.get("http://localhost:3000/api/v1/conversations", () =>
        HttpResponse.json({
          data: deleted
            ? []
            : [
                {
                  id: conversationId,
                  userId,
                  courseId,
                  title,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
        }),
      ),
      http.patch(
        `http://localhost:3000/api/v1/conversations/${conversationId}`,
        async ({ request }) => {
          const body = await request.json();
          expect(body).toEqual({ title: "Course overview" });
          title = "Course overview";
          return HttpResponse.json({
            data: {
              id: conversationId,
              userId,
              courseId,
              title,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          });
        },
      ),
      http.delete(
        `http://localhost:3000/api/v1/conversations/${conversationId}`,
        () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/conversations"]}>
          <Routes>
            <Route path="/conversations" element={<ConversationHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Intro chat" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Reopen" })).toHaveAttribute(
      "href",
      `/chat?conversationId=${conversationId}`,
    );

    fireEvent.change(screen.getByLabelText("Search loaded titles"), {
      target: { value: "not found" },
    });
    expect(
      await screen.findByText("No loaded conversations match your search."),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search loaded titles"), {
      target: { value: "" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const renameDialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(renameDialog).getByLabelText("Conversation title", { exact: false }),
      {
        target: { value: "Course overview" },
      },
    );
    fireEvent.click(within(renameDialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Course overview" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No saved conversations yet.")).toBeVisible();
  });
});
