import { createRequire } from "node:module";
import mammoth from "mammoth";
import { TextDecoder } from "node:util";
import type { DocumentRecord } from "../../infra/jsonstore/system-collections";

interface PdfTextItem {
  str?: string;
}

interface PdfPage {
  getTextContent(options: {
    includeMarkedContent: false;
  }): Promise<{ items: PdfTextItem[] }>;
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

const { getDocument }: {
  getDocument(options: {
    data: Uint8Array;
    stopAtErrors: boolean;
    verbosity: number;
  }): PdfLoadingTask;
} = createRequire(__filename)("pdfjs-dist/legacy/build/pdf.mjs");

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  parser: "pdfjs-dist" | "mammoth" | "utf8";
  pages: ExtractedPage[];
  diagnostics: NonNullable<DocumentRecord["extractionDiagnostics"]>;
}

/**
 * Extracts text from a validated PDF, DOCX or UTF-8 TXT file without logging content.
 */
export async function extractDocumentText(
  mimeType: DocumentRecord["mimeType"],
  bytes: Buffer,
  signal: AbortSignal,
  maxTextBytes: number,
): Promise<ExtractionResult> {
  signal.throwIfAborted();
  if (mimeType === "application/pdf") {
    return extractPdf(bytes, signal, maxTextBytes);
  }
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(bytes, signal, maxTextBytes);
  }
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  const pages = [{ pageNumber: 1, text }];
  return makeExtractionResult("utf8", pages, []);
}

/**
 * Extracts text page-by-page so chunk boundaries can preserve PDF pages.
 */
async function extractPdf(
  bytes: Buffer,
  signal: AbortSignal,
  maxTextBytes: number,
): Promise<ExtractionResult> {
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const pdf = await loadingTask.promise;
    const pages: ExtractedPage[] = [];
    let totalTextBytes = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const text = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ");
      totalTextBytes += Buffer.byteLength(text, "utf8");
      if (totalTextBytes > maxTextBytes) {
        throw new Error("Extracted text exceeds the configured limit");
      }
      pages.push({ pageNumber, text });
      page.cleanup();
    }
    return makeExtractionResult("pdfjs-dist", pages, []);
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Extracts plain text from a DOCX after its archive has passed size and structure checks.
 */
async function extractDocx(
  bytes: Buffer,
  signal: AbortSignal,
  maxTextBytes: number,
): Promise<ExtractionResult> {
  signal.throwIfAborted();
  const result = await mammoth.extractRawText({ buffer: bytes });
  signal.throwIfAborted();
  if (Buffer.byteLength(result.value, "utf8") > maxTextBytes) {
    throw new Error("Extracted text exceeds the configured limit");
  }
  const warnings = result.messages
    .filter((message) => message.type === "warning")
    .slice(0, 100)
    .map(() => "DOCX_EXTRACTION_WARNING");
  return makeExtractionResult("mammoth", [
    { pageNumber: 1, text: result.value },
  ], warnings);
}

/**
 * Creates safe, content-free extraction diagnostics for a set of pages.
 */
function makeExtractionResult(
  parser: ExtractionResult["parser"],
  pages: ExtractedPage[],
  warnings: string[],
): ExtractionResult {
  const charCount = pages.reduce((total, page) => total + page.text.length, 0);
  return {
    parser,
    pages,
    diagnostics: {
      parser,
      pageCount: pages.length,
      charCount,
      lowTextPages: pages
        .filter((page) => page.text.trim().length < 20)
        .map((page) => page.pageNumber)
        .slice(0, 1000),
      warnings,
    },
  };
}
