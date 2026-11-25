# Data Flow

**Status:** Approved implementation baseline for B2; open decisions remain gated.

## 1. Document ingestion

```mermaid
flowchart LR
  UP[Authenticated upload] --> AUTH[Permission and ownership checks]
  AUTH --> VAL[Extension, MIME, content and size validation]
  VAL --> HASH[Hash and duplicate check]
  HASH --> FILE[Store under random key in MongoDB GridFS]
  FILE --> META[Create uploaded document record]
  META --> JOB[Enqueue ingest job; return 202]
  JOB --> EXT[Extract PDF pages / DOCX text / UTF-8 TXT]
  EXT --> CHK[Chunk at configured size with overlap and page metadata]
  CHK --> EMB[Gemini embedding adapter]
  EMB --> WRITE[Atomically write per-document chunk file]
  WRITE --> READY[Set document ready]
  EXT -->|low text or parse error| FAILED[Set actionable failure diagnostics]
```

Invalid uploads are rejected before enqueueing. The default compressed upload
limit is 10 MB; expanded DOCX and extracted text are limited to 50 MB. Ingestion
jobs are idempotent and report status through the document status endpoint.
Original file bytes are read from the same GridFS bucket during ingestion and
when authorized users retrieve the source file. Chunks are approximately 512
tokens with 100-token overlap by default and do not cross PDF page boundaries.
OCR is out of scope. Document text is sent to Google Gemini for embeddings and
must be disclosed to users before upload.

## 2. Grounded chat

```mermaid
sequenceDiagram
  participant U as Learner
  participant API as Express API
  participant S as ChatService
  participant G as Chat graph
  participant R as RetrievalService
  participant L as LLM adapter
  participant DB as SQLite / JSON repositories
  U->>API: POST /chat/ask
  API->>S: Validated request + authenticated user
  S->>S: Permission, course and enrolment checks
  S->>DB: Load owned conversation history
  S->>G: Run graph with typed state
  G->>L: Understand intent and rewrite follow-up
  G->>R: Search access-filtered candidates
  R->>R: Authorize, filter first, then score
  R-->>G: Top chunks and scores
  G->>G: Build bounded context and apply evidence gate
  G->>L: Generate structured answer only if evidence passes
  G->>G: Deterministic citation validation
  G-->>S: Grounding status, answer and verified citations
  S->>DB: Save messages, then deduplicated activity event
  S-->>API: Validated JSON or post-validation SSE replay
  API-->>U: Answer and system-resolved citation metadata
```

If evidence fails, no answer-generation call is made. If citation validation fails, the draft answer is suppressed. A validated answer is returned only after graph completion.

## 3. Job execution and recovery

```mermaid
flowchart TD
  REQ[API or scheduler request] --> ENQ[Write queued JSON job]
  ENQ --> CLAIM[Runner claims oldest eligible job in write queue]
  CLAIM --> HANDLER[Run idempotent job handler]
  HANDLER -->|success| DONE[Persist done/result]
  HANDLER -->|retryable error| RETRY[Increment attempts and set backoff runAfter]
  RETRY --> CLAIM
  HANDLER -->|attempts exhausted| DEAD[Persist dead-letter error code]
  RESTART[Process restart] --> EXPIRED[Find running jobs with expired lease]
  EXPIRED --> CLAIM
  SCHED[Persisted scheduler state] --> ENQ
  RECON[Reconciliation job] --> REPAIR[Repair cross-store events and report orphaned files/chunks]
```

Jobs store identifiers and parameters, not document or question text. Shutdown stops new claims and gives in-flight jobs the configured grace period to finish.
