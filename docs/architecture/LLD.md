# Low-Level Design

**Status:** Approved implementation baseline for B2; open decisions remain gated. Detailed collection fields and constraints are specified in [Database-Design.md](./Database-Design.md).

## Backend project layout

```text
backend/
  src/
    server.ts
    app.ts
    config/
    common/
      errors/
      middleware/
      logging/
      http/
    modules/
      auth/ users/ roles/ courses/ enrolments/
      documents/ ingestion/ retrieval/
      chat/ conversations/ learning/ quizzes/
      feedback/ insights/ admin/ audit/ jobs/
    ai/
      graphs/ nodes/ schemas/ prompts/
      providers/ validation/ evaluation/
    infra/
      jsonstore/ sqlite/ storage/
  scripts/
    bootstrap.ts backup.ts restore.ts migrations/
  data/                         runtime only; gitignored
  config/
  tests/
    unit/ integration/ contract/ ai-eval/ fixtures/
  docs/
  Dockerfile docker-compose.yml .env.example README.md
```

Each domain module exposes its public service surface from `index.ts`. Module implementation files follow the supplied naming pattern: routes, controller, service, repository port, schemas, policy and types. Repository implementations live under infrastructure.

## Core interfaces

```ts
interface Repository<T, Id = string> {
  getById(id: Id): Promise<T | null>;
  list(query: ListQuery): Promise<Page<T>>;
  create(input: CreateInput<T>): Promise<T>;
  update(id: Id, input: UpdateInput<T>): Promise<T>;
  delete(id: Id): Promise<void>;
}

interface GraphRunner {
  run<I, O>(graph: GraphName, input: I): Promise<O>;
}

interface LlmProvider {
  generate(input: LlmInput): Promise<LlmResult>;
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimension: number;
  readonly modelId: string;
}
```

The generic repository shape is illustrative; domain repositories should expose use-case-oriented methods and typed domain records, not leak generic persistence operations into services. All implementations must honor the field-level design and validate records with Zod.

## JSON store write semantics

1. Load and validate records at startup; fail with a clear error for invalid persisted data.
2. Acquire the collection's in-process write queue.
3. Apply uniqueness, ownership-related repository constraints and optimistic version checks.
4. Write the new serialized state to a temporary file, flush it, and atomically rename it over the collection file.
5. Update in-memory records and indexes before releasing the queue.

Document chunks use one file per document and are loaded lazily under an LRU limit. Only the retrieval service can query them. Stashed records are excluded by a shared helper.

## API request lifecycle

1. Assign/propagate `requestId`; apply security headers, body limits and rate limits.
2. Authenticate the bearer token and resolve current effective permissions.
3. Validate request parameters/body with Zod.
4. Check action permission and resource ownership/membership in the service policy.
5. Execute the use case through domain services, repositories and, where needed, a graph or job.
6. Validate the response shape, map failures to the error catalogue, and log metadata without sensitive content.

Success uses `{ "data": ..., "meta": ... }`; errors use `{ "error": { "code", "message", "details", "requestId" } }`.

## AI call lifecycle

Provider SDKs are confined to adapters. Structured output is schema-generated and parsed with Zod. A malformed response receives one repair attempt, then one fallback-provider attempt where applicable; otherwise the operation fails explicitly. Provider, model, retry count, duration and prompt version may be recorded as metadata, but prompts, outputs, question text and document text are not persisted in execution records.

Chat graphs execute to completion and validate citations before returning JSON or replaying the validated answer over POST-based SSE. Conversation persistence and activity event writes follow the cross-store reconciliation rules in the data design.

## Persistence and concurrency

There are no cross-store transactions. Work spanning multiple records/stores must be idempotent and use jobs when partial completion needs recovery. SQLite queries are parameterised; foreign keys and WAL are enabled. The single process/instance constraint is mandatory until the storage decision changes.
