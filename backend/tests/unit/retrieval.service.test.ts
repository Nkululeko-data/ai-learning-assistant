import { AppError } from "../../src/common/errors/app-error";
import type {
  CourseRecord,
  DocumentRecord,
  EnrolmentRecord,
} from "../../src/infra/jsonstore/system-collections";
import type { AuthenticatedUser } from "../../src/modules/auth/auth.types";
import {
  RetrievalService,
  type ChunkReader,
  type RetrievalRepository,
} from "../../src/modules/retrieval/retrieval.service";

const courseId = "00000000-0000-4000-8000-000000000001";
const coachId = "00000000-0000-4000-8000-000000000002";
const learnerId = "00000000-0000-4000-8000-000000000003";
const otherLearnerId = "00000000-0000-4000-8000-000000000004";
const courseDocumentId = "00000000-0000-4000-8000-000000000005";
const personalDocumentId = "00000000-0000-4000-8000-000000000006";
const otherPersonalDocumentId = "00000000-0000-4000-8000-000000000007";
const staleModelDocumentId = "00000000-0000-4000-8000-000000000008";
const failedDocumentId = "00000000-0000-4000-8000-000000000009";
const videoDocumentId = "00000000-0000-4000-8000-000000000011";
const createdAt = "2026-11-17T08:00:00.000Z";

const learner: AuthenticatedUser = {
  id: learnerId,
  email: "learner@example.test",
  displayName: "Learner",
  role: "learner",
  status: "active",
  mustChangePassword: false,
  permissions: [],
  permsVersion: 1,
};

const course: CourseRecord = {
  id: courseId,
  ownerId: coachId,
  name: "Databases",
  status: "active",
  version: 1,
  createdAt,
  updatedAt: createdAt,
};

function documentRecord(
  id: string,
  scope: DocumentRecord["scope"],
  ownerId: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    courseId,
    ownerId,
    scope,
    filename: `${id}.txt`,
    storageKey: id,
    mimeType: "text/plain",
    sizeBytes: 40,
    contentHash: "a".repeat(64),
    status: "ready",
    errorCode: null,
    errorDetail: null,
    extractionDiagnostics: null,
    chunkCount: 1,
    embeddingModel: "mistral-embed",
    ingestJobId: null,
    createdAt,
    updatedAt: createdAt,
    readyAt: createdAt,
    ...overrides,
  };
}

function chunkFile(
  document: DocumentRecord,
  vector: number[],
  embeddingOverride?: string,
  textOverride?: string,
): Record<string, unknown> {
  const bytes = Buffer.alloc(vector.length * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((value, index) =>
    bytes.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT),
  );
  return {
    header: {
      documentId: document.id,
      courseId: document.courseId,
      ownerId: document.ownerId,
      scope: document.scope,
      embeddingModel: "mistral-embed",
      dimension: 2,
      chunkCount: 1,
      createdAt,
    },
    chunks: [
      {
        id: `${document.id}:0`,
        chunkIndex: 0,
        tokenEstimate: 5,
        pageStart: 2,
        pageEnd: 2,
        section: "Introduction",
        text: textOverride ?? `Text from ${document.filename}`,
        embedding: embeddingOverride ?? bytes.toString("base64"),
      },
    ],
  };
}

function createService(
  documents: DocumentRecord[],
  chunkFiles: Map<string, unknown>,
  options: {
    course?: CourseRecord | null;
    enrolment?: EnrolmentRecord | null;
  } = {},
): { service: RetrievalService; storage: ChunkReader } {
  const repository: RetrievalRepository = {
    findCourse: () => options.course === undefined ? course : options.course,
    findEnrolment: () => options.enrolment ?? {
      id: "00000000-0000-4000-8000-000000000010",
      courseId,
      userId: learnerId,
      status: "approved",
      requestedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    },
    listDocumentsByCourse: () => documents,
  };
  const storage: ChunkReader = {
    readChunks: jest.fn(async (documentId: string) => chunkFiles.get(documentId)),
  };
  return {
    service: new RetrievalService(repository, storage, "mistral-embed", 2),
    storage,
  };
}

describe("RetrievalService", () => {
  test("ranks only ready, model-matched course material and the learner's own notes", async () => {
    const courseDocument = documentRecord(courseDocumentId, "course", coachId);
    const personalDocument = documentRecord(
      personalDocumentId,
      "personal",
      learnerId,
    );
    const otherPersonalDocument = documentRecord(
      otherPersonalDocumentId,
      "personal",
      otherLearnerId,
    );
    const staleModelDocument = documentRecord(
      staleModelDocumentId,
      "course",
      coachId,
      { embeddingModel: "old-model" },
    );
    const failedDocument = documentRecord(failedDocumentId, "course", coachId, {
      status: "failed",
    });
    const videoDocument = documentRecord(videoDocumentId, "course", coachId, {
      filename: "lesson.mp4",
      mimeType: "video/mp4",
    });
    const documents = [
      courseDocument,
      personalDocument,
      otherPersonalDocument,
      staleModelDocument,
      failedDocument,
      videoDocument,
    ];
    const files = new Map<string, unknown>([
      [courseDocumentId, chunkFile(courseDocument, [1, 0])],
      [personalDocumentId, chunkFile(personalDocument, [0.8, 0.6])],
      [otherPersonalDocumentId, chunkFile(otherPersonalDocument, [0, 1])],
      [staleModelDocumentId, chunkFile(staleModelDocument, [1, 0])],
      [failedDocumentId, chunkFile(failedDocument, [1, 0])],
      [videoDocumentId, chunkFile(videoDocument, [1, 0])],
    ]);
    const { service, storage } = createService(documents, files);

    const results = await service.search(learner, courseId, [1, 0]);

    expect(results.map((result) => result.documentId)).toEqual([
      courseDocumentId,
      personalDocumentId,
    ]);
    expect(results[0]).toMatchObject({
      filename: courseDocument.filename,
      scope: "course",
      text: `Text from ${courseDocument.filename}`,
      pageStart: 2,
      pageEnd: 2,
      section: "Introduction",
      score: 1,
    });
    expect(results[1]?.score).toBeCloseTo(0.8);
    expect(storage.readChunks).toHaveBeenCalledTimes(2);
    expect(storage.readChunks).toHaveBeenNthCalledWith(1, courseDocumentId);
    expect(storage.readChunks).toHaveBeenNthCalledWith(2, personalDocumentId);
  });

  test("combines BM25 keyword relevance with cosine ranking", async () => {
    const semanticDocument = documentRecord(courseDocumentId, "course", coachId);
    const keywordDocument = documentRecord(
      personalDocumentId,
      "personal",
      learnerId,
    );
    const { service } = createService(
      [semanticDocument, keywordDocument],
      new Map([
        [
          courseDocumentId,
          chunkFile(
            semanticDocument,
            [1, 0],
            undefined,
            "Transactions use isolation levels.",
          ),
        ],
        [
          personalDocumentId,
          chunkFile(
            keywordDocument,
            [0, 1],
            undefined,
            "B-tree indexes support fast database lookup.",
          ),
        ],
      ]),
    );

    const results = await service.search(learner, courseId, [1, 0], {
      limit: 2,
      queryText: "B-tree index lookup",
    });

    expect(results.map((result) => result.documentId)).toEqual([
      personalDocumentId,
      courseDocumentId,
    ]);
    expect(results[0]?.score).toBe(0);
    expect(results[0]?.keywordScore).toBeGreaterThan(0.5);
  });

  test("denies a learner without approved enrolment before reading any chunks", async () => {
    const document = documentRecord(courseDocumentId, "course", coachId);
    const { service, storage } = createService(
      [document],
      new Map([[courseDocumentId, chunkFile(document, [1, 0])]]),
      {
        enrolment: {
          id: "00000000-0000-4000-8000-000000000010",
          courseId,
          userId: learnerId,
          status: "pending",
          requestedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      },
    );

    await expect(service.search(learner, courseId, [1, 0])).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    expect(storage.readChunks).not.toHaveBeenCalled();
  });

  test("allows the course owner and returns a bounded result set", async () => {
    const document = documentRecord(courseDocumentId, "course", coachId);
    const owner: AuthenticatedUser = {
      ...learner,
      id: coachId,
      role: "coach",
    };
    const { service } = createService(
      [document],
      new Map([[courseDocumentId, chunkFile(document, [1, 0])]]),
    );

    await expect(
      service.search(owner, courseId, [1, 0], { limit: 1 }),
    ).resolves.toHaveLength(1);
    await expect(
      service.search(owner, courseId, [1, 0], { limit: 0 }),
    ).rejects.toMatchObject({
      code: "INVALID_RETRIEVAL_LIMIT",
      statusCode: 400,
    });
  });

  test("restricts selected-source searches and rejects another learner's selected note", async () => {
    const courseDocument = documentRecord(courseDocumentId, "course", coachId);
    const personalDocument = documentRecord(
      personalDocumentId,
      "personal",
      learnerId,
    );
    const otherPersonalDocument = documentRecord(
      otherPersonalDocumentId,
      "personal",
      otherLearnerId,
    );
    const { service, storage } = createService(
      [courseDocument, personalDocument, otherPersonalDocument],
      new Map([
        [courseDocumentId, chunkFile(courseDocument, [1, 0])],
        [personalDocumentId, chunkFile(personalDocument, [1, 0])],
        [otherPersonalDocumentId, chunkFile(otherPersonalDocument, [1, 0])],
      ]),
    );

    await expect(
      service.search(learner, courseId, [1, 0], {
        documentIds: [personalDocumentId],
      }),
    ).resolves.toMatchObject([{ documentId: personalDocumentId }]);
    await expect(
      service.search(learner, courseId, [1, 0], {
        documentIds: [otherPersonalDocumentId],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(storage.readChunks).toHaveBeenCalledTimes(1);
  });

  test("excludes archived courses and rejects invalid query vectors", async () => {
    const document = documentRecord(courseDocumentId, "course", coachId);
    const archived = { ...course, status: "archived" as const };
    const { service, storage } = createService(
      [document],
      new Map([[courseDocumentId, chunkFile(document, [1, 0])]]),
      { course: archived },
    );

    await expect(service.search(learner, courseId, [1, 0])).resolves.toEqual([]);
    expect(storage.readChunks).not.toHaveBeenCalled();

    const activeService = createService(
      [document],
      new Map([[courseDocumentId, chunkFile(document, [1, 0])]]),
    ).service;
    await expect(activeService.search(learner, courseId, [1])).rejects.toMatchObject({
      code: "INVALID_QUERY_EMBEDDING",
      statusCode: 400,
    });
    await expect(activeService.search(learner, courseId, [0, 0])).rejects.toBeInstanceOf(
      AppError,
    );
  });

  test("reports malformed stored vectors without returning document text", async () => {
    const document = documentRecord(courseDocumentId, "course", coachId);
    const { service } = createService(
      [document],
      new Map([[courseDocumentId, chunkFile(document, [1, 0], "invalid")]]),
    );

    await expect(service.search(learner, courseId, [1, 0])).rejects.toMatchObject({
      code: "DOCUMENT_CHUNK_DATA_INVALID",
      statusCode: 500,
    });
  });
});
