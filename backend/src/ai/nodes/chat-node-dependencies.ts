import type { AppConfig } from "../../config/config";
import type { StructuredOutputService } from "../providers/structured-output.service";
import type { DocumentEmbeddingProvider } from "../../modules/documents/embedding-provider";
import type { RetrievalService } from "../../modules/retrieval/retrieval.service";
import type { AuthenticatedUser } from "../../modules/auth/auth.types";

export interface ChatPrompts {
  queryUnderstanding: string;
  rewriteQuery: string;
  answer: string;
}

export interface ChatNodeDependencies {
  config: AppConfig;
  structuredOutput: StructuredOutputService;
  embeddingProvider: DocumentEmbeddingProvider;
  retrievalService: RetrievalService;
  actor: AuthenticatedUser;
  prompts: ChatPrompts;
  signal: AbortSignal;
}
