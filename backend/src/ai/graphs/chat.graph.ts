import { END, START, StateGraph } from "@langchain/langgraph";
import { AppError } from "../../common/errors/app-error";
import type { ChatNodeDependencies } from "../nodes/chat-node-dependencies";
import { answerGenerationNode } from "../nodes/answer-generation.node";
import { citationValidatorNode } from "../nodes/citation-validator.node";
import { contextBuilderNode } from "../nodes/context-builder.node";
import { evidenceGateNode } from "../nodes/evidence-gate.node";
import { generalKnowledgeNode } from "../nodes/general-knowledge.node";
import { queryUnderstandingNode } from "../nodes/query-understanding.node";
import { rerankNode } from "../nodes/rerank.node";
import { retrievalNode } from "../nodes/retrieval.node";
import { rewriteQueryNode } from "../nodes/rewrite-query.node";
import { ChatState, type ChatGraphState, type ChatNodeUpdate } from "./chat-state";

export interface ChatNodeExecutionRecord {
  executionId: string;
  requestId: string;
  conversationId: string;
  userId: string;
  courseId: string;
  usageDate: string;
  startedAt: string;
  node: string;
  status: "ok" | "error" | "timeout";
  durationMs: number;
  provider: "inception" | "groq" | null;
  model: string | null;
  fallbackUsed: boolean;
  retryCount: number;
  promptTokens: number;
  completionTokens: number;
  errorCode: string | null;
  promptVersion: string;
}

export type RecordChatNodeExecution = (
  record: ChatNodeExecutionRecord,
) => Promise<void>;

export interface ChatGraphRunner {
  run(
    initialState: ChatGraphState,
    dependencies: ChatNodeDependencies,
    recordExecution: RecordChatNodeExecution,
  ): Promise<ChatGraphState>;
}

export class LangGraphChatRunner implements ChatGraphRunner {
  public run(
    initialState: ChatGraphState,
    dependencies: ChatNodeDependencies,
    recordExecution: RecordChatNodeExecution,
  ): Promise<ChatGraphState> {
    return runChatGraph(initialState, dependencies, recordExecution);
  }
}

const lacksCourseEvidence = (state: ChatGraphState): boolean =>
  state.groundingStatus === "insufficient";
const needsAssistantAction = (state: ChatGraphState): boolean =>
  state.suggestedAction !== null;

export async function runChatGraph(
  initialState: ChatGraphState,
  dependencies: ChatNodeDependencies,
  recordExecution: RecordChatNodeExecution,
): Promise<ChatGraphState> {
  const graph = new StateGraph(ChatState)
    .addNode("queryUnderstanding", (state) =>
      trackedNode(
        "queryUnderstanding",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          queryUnderstandingNode(current, nodeDependencies),
      ),
    )
    .addNode("rewriteQuery", (state) =>
      trackedNode(
        "rewriteQuery",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          rewriteQueryNode(current, nodeDependencies),
      ),
    )
    .addNode("retrieval", (state) =>
      trackedNode(
        "retrieval",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) => retrievalNode(current, nodeDependencies),
      ),
    )
    .addNode("rerank", (state) =>
      trackedNode("rerank", state, dependencies, recordExecution, rerankNode),
    )
    .addNode("contextBuilder", (state) =>
      trackedNode(
        "contextBuilder",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          contextBuilderNode(current, nodeDependencies),
      ),
    )
    .addNode("evidenceGate", (state) =>
      trackedNode(
        "evidenceGate",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          evidenceGateNode(current, nodeDependencies),
      ),
    )
    .addNode("answerGeneration", (state) =>
      trackedNode(
        "answerGeneration",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          answerGenerationNode(current, nodeDependencies),
      ),
    )
    .addNode("generalKnowledge", (state) =>
      trackedNode(
        "generalKnowledge",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          generalKnowledgeNode(current, nodeDependencies),
      ),
    )
    .addNode("citationValidator", (state) =>
      trackedNode(
        "citationValidator",
        state,
        dependencies,
        recordExecution,
        (current, nodeDependencies) =>
          citationValidatorNode(current, nodeDependencies),
      ),
    )
    .addEdge(START, "queryUnderstanding")
    .addConditionalEdges("queryUnderstanding", (state) =>
      needsAssistantAction(state) ? END : "rewriteQuery",
    )
    .addEdge("rewriteQuery", "retrieval")
    .addEdge("retrieval", "rerank")
    .addEdge("rerank", "contextBuilder")
    .addEdge("contextBuilder", "evidenceGate")
    .addConditionalEdges("evidenceGate", (state) =>
      lacksCourseEvidence(state) ? "generalKnowledge" : "answerGeneration",
    )
    .addEdge("generalKnowledge", END)
    .addEdge("answerGeneration", "citationValidator")
    .addConditionalEdges("citationValidator", (state) =>
      state.groundingStatus === "grounded" ? END : "generalKnowledge",
    )
    .compile();
  return graph.invoke(initialState, { signal: dependencies.signal });
}

async function trackedNode(
  node: string,
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
  recordExecution: RecordChatNodeExecution,
  operation: (
    state: ChatGraphState,
    dependencies: ChatNodeDependencies,
  ) => ChatNodeUpdate | Promise<ChatNodeUpdate>,
): Promise<Partial<ChatGraphState>> {
  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const timeoutSignal = AbortSignal.timeout(
    dependencies.config.chatNodeTimeoutMs,
  );
  const nodeSignal = AbortSignal.any([dependencies.signal, timeoutSignal]);
  const nodeDependencies = { ...dependencies, signal: nodeSignal };
  let update: ChatNodeUpdate;
  try {
    update = await raceWithAbort(
      Promise.resolve(operation(state, nodeDependencies)),
      nodeSignal,
    );
  } catch (error) {
    const didTimeout = timeoutSignal.aborted && !dependencies.signal.aborted;
    const failure = didTimeout
      ? new AppError("NODE_TIMEOUT", 504, "An AI workflow node timed out")
      : error;
    await recordExecution({
      executionId: state.executionId,
      requestId: state.requestId,
      conversationId: state.conversationId,
      userId: state.userId,
      courseId: state.courseId,
      usageDate: state.usageDate,
      startedAt,
      node,
      status: didTimeout ? "timeout" : "error",
      durationMs: Date.now() - startTime,
      provider: null,
      model: null,
      fallbackUsed: false,
      retryCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      errorCode: getErrorCode(failure),
      promptVersion: dependencies.config.chatPromptVersion,
    });
    throw failure;
  }

  const { execution, ...stateUpdate } = update;
  await recordExecution({
    executionId: state.executionId,
    requestId: state.requestId,
    conversationId: state.conversationId,
    userId: state.userId,
    courseId: state.courseId,
    usageDate: state.usageDate,
    startedAt,
    node,
    status: "ok",
    durationMs: Date.now() - startTime,
    provider: execution?.provider ?? null,
    model: execution?.model ?? null,
    fallbackUsed: execution?.fallbackUsed ?? false,
    retryCount: execution?.retryCount ?? 0,
    promptTokens: execution?.promptTokens ?? 0,
    completionTokens: execution?.completionTokens ?? 0,
    errorCode: null,
    promptVersion: dependencies.config.chatPromptVersion,
  });
  return {
    ...stateUpdate,
    promptTokens: state.promptTokens + (execution?.promptTokens ?? 0),
    completionTokens:
      state.completionTokens + (execution?.completionTokens ?? 0),
    ...(execution?.provider ? { provider: execution.provider } : {}),
    ...(execution?.model ? { model: execution.model } : {}),
  };
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function getErrorCode(error: unknown): string {
  if (
    error instanceof AppError ||
    (error instanceof Error && "code" in error)
  ) {
    const code = error.code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)) {
      return code;
    }
  }
  return "INTERNAL_ERROR";
}
