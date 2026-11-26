import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../../api/chat";
import { ChatMessage } from "./ChatMessage";

const message: ConversationMessage = {
  id: "4e3c2c26-3c70-4b6d-bcdf-1a677fcbba4e",
  conversationId: "3eb0d2cf-35d3-4775-94da-f0c18c4481a7",
  role: "assistant",
  content: "<img src=x onerror=alert(1)> [1]",
  createdAt: "2026-01-01T00:00:00.000Z",
  executionId: "5a554a4c-9a9c-467c-9742-1118b71897b9",
  intent: "question",
  groundingStatus: "grounded",
  answerSource: "course_material",
  citations: [
    {
      marker: 1,
      chunkId: "chunk-1",
      documentId: "9a7a7701-a1b1-42a4-890d-1b1e54055d0e",
      documentName: "Course notes.pdf",
      pageStart: 2,
      pageEnd: 3,
      section: "Section A",
    },
  ],
  retrievalScoreTop: 0.9,
};

describe("ChatMessage", () => {
  it("renders citation metadata and treats answer text as plain untrusted text", () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ChatMessage message={message} courseId={message.conversationId} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Course notes.pdf · pp. 2–3 · Section A")).toBeVisible();
    expect(screen.getByText(message.content)).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
  });

  it("labels a general-knowledge fallback separately from course evidence", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatMessage
          message={{
            ...message,
            content: "A useful general answer.",
            groundingStatus: "insufficient",
            answerSource: "general_knowledge",
            citations: [],
          }}
          courseId={message.conversationId}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /not covered by course material/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /not been verified against your course materials or the web/i,
    );
    expect(screen.getByText("A useful general answer.")).toBeVisible();
  });
});
