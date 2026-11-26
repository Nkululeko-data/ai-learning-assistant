import type {
  ChatGraphState,
  ChatNodeUpdate,
  ValidatedCitation,
} from "../graphs/chat-state";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

const insufficientMessage = "The course material doesn't cover this question.";
const unverifiedMessage = "We couldn't verify an answer from the course material.";
const markerPattern = /\[(\d+)\]/g;

export function citationValidatorNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): ChatNodeUpdate {
  const draft = state.answerDraft;
  if (!draft) {
    return unverifiedResult();
  }
  if (draft.refusal) {
    return {
      groundingStatus: "insufficient",
      answerSource: null,
      answer: null,
      message: insufficientMessage,
      citations: [],
    };
  }

  const contextByMarker = new Map(
    state.contextChunks.map((chunk) => [chunk.marker, chunk]),
  );
  const citationKeys = new Set<string>();
  const validatedCitations: ValidatedCitation[] = [];
  for (const citation of draft.citations) {
    const contextChunk = contextByMarker.get(citation.marker);
    if (
      !contextChunk ||
      contextChunk.id !== citation.chunkId ||
      citationKeys.has(`${citation.marker}:${citation.chunkId}`)
    ) {
      return unverifiedResult();
    }
    citationKeys.add(`${citation.marker}:${citation.chunkId}`);
    validatedCitations.push({
      marker: contextChunk.marker,
      chunkId: contextChunk.id,
      documentId: contextChunk.documentId,
      documentName: contextChunk.filename,
      pageStart: contextChunk.pageStart,
      pageEnd: contextChunk.pageEnd,
      section: contextChunk.section,
    });
  }

  const answerMarkers = [...draft.answer.matchAll(markerPattern)].map(
    (match) => Number(match[1]),
  );
  const citedMarkers = new Set(validatedCitations.map(({ marker }) => marker));
  if (
    answerMarkers.length === 0 ||
    answerMarkers.some((marker) => !citedMarkers.has(marker)) ||
    [...citedMarkers].some((marker) => !answerMarkers.includes(marker)) ||
    citedMarkers.size < dependencies.config.chatMinCitations
  ) {
    return unverifiedResult();
  }

  return {
    groundingStatus: "grounded",
    answerSource: "course_material",
    answer: draft.answer,
    message: null,
    citations: validatedCitations,
  };
}

function unverifiedResult(): ChatNodeUpdate {
  return {
    groundingStatus: "unverified",
    answerSource: null,
    answer: null,
    message: unverifiedMessage,
    citations: [],
  };
}
