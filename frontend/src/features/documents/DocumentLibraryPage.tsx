import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  CircleCheck,
  CircleX,
  Clock3,
  Info,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { ApiError, friendlyMessage } from "../../api/client";
import {
  deleteDocument,
  getDocumentStatus,
  listCourseDocuments,
  retryDocument,
  uploadDocument,
  type DocumentStatus,
  type DocumentView,
} from "../../api/documents";
import { getCourse } from "../../api/courses";
import type { AuthenticatedUser } from "../../api/auth";
import { useAuth } from "../../auth/useAuth";
import { ErrorNotice } from "../../components/ErrorNotice";
import { isCourseView } from "../courses/course-utils";
import { maxUploadSizeMb, validateDocumentFile } from "./file-validation";

const activeStatuses: DocumentStatus[] = ["uploaded", "processing", "deleting"];
const documentStatuses: DocumentStatus[] = [
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
];
const statusLabels: Record<DocumentStatus, string> = {
  uploaded: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  deleting: "Deleting",
};

/** Returns whether a document is still being processed or removed. */
function isActiveStatus(status: DocumentStatus): boolean {
  return activeStatuses.includes(status);
}

/** Formats a document size with a readable binary unit. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Returns the document actions allowed for this user and course. */
function canManageDocument(
  document: DocumentView,
  user: AuthenticatedUser,
  courseOwnerId: string,
): boolean {
  if (document.scope === "course") {
    return user.role === "coach" && user.id === courseOwnerId;
  }
  return user.role === "learner";
}

/** Renders each document status with both a text label and a matching icon. */
function DocumentStatusIndicator({ status }: { status: DocumentStatus }) {
  const StatusIcon = {
    uploaded: Clock3,
    processing: LoaderCircle,
    ready: CircleCheck,
    failed: CircleX,
    deleting: Trash2,
  }[status];
  const color =
    status === "ready"
      ? "success.main"
      : status === "failed"
        ? "error.main"
        : status === "deleting"
          ? "text.secondary"
          : "info.main";

  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ color }}>
      <StatusIcon size={16} aria-hidden="true" />
      <Typography component="span" variant="body2" fontWeight={600}>
        {statusLabels[status]}
      </Typography>
    </Stack>
  );
}

/** Loads course documents and provides upload, retry, and delete workflows. */
export function DocumentLibraryPage() {
  const { courseId = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filenameFilter, setFilenameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "all">("all");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<DocumentView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const courseQuery = useQuery({
    queryKey: ["courses", "detail", courseId],
    queryFn: () => getCourse(courseId),
    enabled: Boolean(courseId),
  });
  const course = courseQuery.data;
  const fullCourse = course && isCourseView(course) ? course : null;
  const documentsQuery = useInfiniteQuery({
    queryKey: ["documents", courseId],
    queryFn: ({ pageParam }) =>
      listCourseDocuments(courseId, { limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(courseId && fullCourse),
  });
  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data],
  );

  const canUpload = Boolean(
    user &&
    fullCourse &&
    fullCourse.status === "active" &&
    user.permissions.includes("document:upload") &&
    ((user.role === "coach" && user.id === fullCourse.ownerId) ||
      user.role === "learner"),
  );
  const uploadScope = user?.role === "coach" ? "course" : "personal";

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(courseId, uploadScope, file),
    onSuccess: async () => {
      setSelectedFile(null);
      setFileInputKey((key) => key + 1);
      setUploadError(null);
      await queryClient.invalidateQueries({ queryKey: ["documents", courseId] });
    },
  });
  const retryMutation = useMutation({
    mutationFn: retryDocument,
    onSuccess: async (document) => {
      queryClient.setQueryData(["documents", "status", document.id], document);
      await queryClient.invalidateQueries({ queryKey: ["documents", courseId] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: async (result) => {
      queryClient.removeQueries({ queryKey: ["documents", "status", result.id] });
      await queryClient.invalidateQueries({ queryKey: ["documents", courseId] });
      setDocumentToDelete(null);
    },
  });

  const visibleDocuments = useMemo(() => {
    const filter = filenameFilter.trim().toLocaleLowerCase();
    return documents.filter(
      (document) =>
        (statusFilter === "all" || document.status === statusFilter) &&
        (!filter || document.filename.toLocaleLowerCase().includes(filter)),
    );
  }, [documents, filenameFilter, statusFilter]);

  const invalidateDocuments = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["documents", courseId] }),
    [courseId, queryClient],
  );

  /** Validates and starts an upload for the current course scope. */
  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    if (!selectedFile) {
      setUploadError("Choose a file to upload.");
      return;
    }
    const validationError = await validateDocumentFile(selectedFile);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    uploadMutation.mutate(selectedFile);
  }

  if (!courseId) {
    return <ErrorNotice message="A course ID is required." />;
  }
  if (courseQuery.isLoading) {
    return <LinearProgress aria-label="Loading course" />;
  }
  if (courseQuery.isError) {
    return (
      <Stack spacing={1} alignItems="flex-start">
        <ErrorNotice message={friendlyMessage(courseQuery.error)} />
        <Button onClick={() => void courseQuery.refetch()}>Try again</Button>
      </Stack>
    );
  }
  if (!fullCourse) {
    return (
      <Alert severity="info">
        Document access is available only to the course owner and approved learners.
      </Alert>
    );
  }

  return (
    <Stack className="learnova-document-library" spacing={3}>
      <Box>
        <Typography
          component="h1"
          variant="h4"
          fontWeight={700}
          className="learnova-page-heading"
        >
          Document library
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {fullCourse.name}
        </Typography>
      </Box>

      {canUpload ? (
        <Card component="section" variant="outlined">
          <CardContent>
            <Typography component="h2" variant="h6">
              Upload a document
            </Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
              {uploadScope === "course"
                ? "This file will be shared as course material."
                : "Your personal note is visible only to you."}
            </Typography>
            {uploadScope === "personal" && (
              <FormControl component="fieldset" sx={{ mt: 1 }}>
                <FormLabel id="document-upload-scope-label">Upload as</FormLabel>
                <RadioGroup
                  aria-labelledby="document-upload-scope-label"
                  defaultValue="personal"
                  name="document-upload-scope"
                >
                  <FormControlLabel
                    value="personal"
                    control={<Radio />}
                    label="Personal note"
                  />
                  <FormControlLabel
                    value="course"
                    control={<Radio />}
                    label="Course material"
                    disabled
                  />
                </RadioGroup>
                <FormHelperText>
                  Only the course coach can publish shared course material.
                </FormHelperText>
              </FormControl>
            )}
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
              Accepted: PDF, DOCX, TXT. Maximum size: {maxUploadSizeMb} MB.
            </Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
              Document text is sent to Mistral to create searchable content.
            </Typography>
            <Box component="form" onSubmit={(event) => void handleUpload(event)}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                alignItems={{ xs: "stretch", sm: "center" }}
                spacing={1.5}
                sx={{ mt: 2 }}
              >
                <Button
                  variant="outlined"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </Button>
                <input
                  ref={fileInputRef}
                  key={fileInputKey}
                  hidden
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  aria-label="Choose a PDF, DOCX, or TXT file"
                  onChange={(event) => {
                    setSelectedFile(event.currentTarget.files?.[0] ?? null);
                    setUploadError(null);
                  }}
                />
                <Typography aria-live="polite" color="text.secondary">
                  {selectedFile ? selectedFile.name : "No file selected"}
                </Typography>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!selectedFile || uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? "Uploading..." : "Upload"}
                </Button>
                {!selectedFile && !uploadMutation.isPending && (
                  <Typography color="text.secondary" variant="body2">
                    Choose a file to enable Upload.
                  </Typography>
                )}
              </Stack>
            </Box>
            {uploadError && (
              <Alert severity="warning" role="alert" sx={{ mt: 2 }}>
                {uploadError}
              </Alert>
            )}
            {uploadMutation.isError && (
              <Box sx={{ mt: 2 }}>
                <ErrorNotice message={friendlyMessage(uploadMutation.error)} />
              </Box>
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info">
          Upload is unavailable for this account or course. Coaches can upload course
          material; approved learners can upload personal notes when granted the
          required permission.
        </Alert>
      )}

      <Box component="section" aria-labelledby="documents-list-title">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Typography id="documents-list-title" component="h2" variant="h5">
            Documents
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              label="Filter loaded filenames"
              value={filenameFilter}
              onChange={(event) => setFilenameFilter(event.target.value)}
              size="small"
            />
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="document-status-filter-label">Status</InputLabel>
              <Select
                labelId="document-status-filter-label"
                label="Status"
                value={statusFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "all") {
                    setStatusFilter("all");
                    return;
                  }
                  const selectedStatus = documentStatuses.find(
                    (status) => status === value,
                  );
                  if (selectedStatus) setStatusFilter(selectedStatus);
                }}
              >
                <MenuItem value="all">All statuses</MenuItem>
                {documentStatuses.map((status) => (
                  <MenuItem key={status} value={status}>
                    {statusLabels[status]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filtering loaded documents.
        </Typography>
        {documentsQuery.isLoading && <LinearProgress aria-label="Loading documents" />}
        {documentsQuery.isError && (
          <Stack spacing={1} alignItems="flex-start">
            <ErrorNotice message={friendlyMessage(documentsQuery.error)} />
            <Button onClick={() => void documentsQuery.refetch()}>
              Retry loading documents
            </Button>
          </Stack>
        )}
        {retryMutation.isError && (
          <Box sx={{ mb: 2 }}>
            <ErrorNotice message={friendlyMessage(retryMutation.error)} />
          </Box>
        )}
        {deleteMutation.isError && (
          <Box sx={{ mb: 2 }}>
            <ErrorNotice message={friendlyMessage(deleteMutation.error)} />
          </Box>
        )}
        {documentsQuery.isSuccess && visibleDocuments.length === 0 && (
          <Alert severity="info">
            {documents.length === 0
              ? "No documents have been added to this course yet."
              : "No loaded documents match these filters."}
          </Alert>
        )}
        <TableContainer
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          <Table size="small" aria-label="Course documents">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>
                  Size
                </TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>
                  Uploaded
                </TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleDocuments.map((document) => {
                const canManage = user
                  ? canManageDocument(document, user, fullCourse.ownerId)
                  : false;
                return (
                  <DocumentTableRow
                    key={document.id}
                    document={document}
                    canRetry={
                      canManage &&
                      document.status === "failed" &&
                      fullCourse.status === "active" &&
                      Boolean(user?.permissions.includes("document:upload"))
                    }
                    canDelete={
                      canManage &&
                      document.status !== "deleting" &&
                      Boolean(user?.permissions.includes("document:delete"))
                    }
                    retryPending={
                      retryMutation.isPending && retryMutation.variables === document.id
                    }
                    onRetry={() => retryMutation.mutate(document.id)}
                    onDelete={() => setDocumentToDelete(document)}
                    onDocumentsChanged={invalidateDocuments}
                  />
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {documentsQuery.hasNextPage && (
          <Button
            onClick={() => void documentsQuery.fetchNextPage()}
            disabled={documentsQuery.isFetchingNextPage}
            sx={{ mt: 2 }}
          >
            {documentsQuery.isFetchingNextPage ? "Loading..." : "Load more"}
          </Button>
        )}
      </Box>

      <Dialog
        open={documentToDelete !== null}
        onClose={() => {
          if (!deleteMutation.isPending) setDocumentToDelete(null);
        }}
        aria-labelledby="delete-document-title"
      >
        <DialogTitle id="delete-document-title">Delete document?</DialogTitle>
        <DialogContent>
          <Typography>
            {documentToDelete
              ? `${documentToDelete.filename} and its extracted content will be permanently deleted. This cannot be undone.`
              : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDocumentToDelete(null)}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!documentToDelete || deleteMutation.isPending}
            onClick={() => {
              if (documentToDelete) deleteMutation.mutate(documentToDelete.id);
            }}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** Displays one document row, refreshing active and failed status details. */
function DocumentTableRow({
  document,
  canRetry,
  canDelete,
  retryPending,
  onRetry,
  onDelete,
  onDocumentsChanged,
}: {
  document: DocumentView;
  canRetry: boolean;
  canDelete: boolean;
  retryPending: boolean;
  onRetry: () => void;
  onDelete: () => void;
  onDocumentsChanged: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const statusQuery = useQuery({
    queryKey: ["documents", "status", document.id],
    queryFn: () => getDocumentStatus(document.id),
    enabled: isActiveStatus(document.status) || document.status === "failed",
    retry: 1,
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status ?? document.status;
      return isActiveStatus(currentStatus) && !pollingTimedOut ? 2_000 : false;
    },
  });
  const currentDocument = statusQuery.data ?? document;
  const active = isActiveStatus(currentDocument.status);

  useEffect(() => {
    if (!active || pollingTimedOut) return;
    const timeout = window.setTimeout(() => setPollingTimedOut(true), 120_000);
    return () => window.clearTimeout(timeout);
  }, [active, pollingTimedOut]);

  useEffect(() => {
    const statusFromQuery = statusQuery.data?.status;
    if (statusFromQuery && statusFromQuery !== document.status) {
      onDocumentsChanged();
    }
  }, [document.status, onDocumentsChanged, statusQuery.data?.status]);

  useEffect(() => {
    if (
      currentDocument.status === "deleting" &&
      statusQuery.error instanceof ApiError &&
      statusQuery.error.status === 404
    ) {
      onDocumentsChanged();
    }
  }, [currentDocument.status, onDocumentsChanged, statusQuery.error]);

  const isMissingDeletedDocument =
    currentDocument.status === "deleting" &&
    statusQuery.error instanceof ApiError &&
    statusQuery.error.status === 404;

  return (
    <>
      <TableRow>
        <TableCell component="th" scope="row" sx={{ verticalAlign: "top" }}>
          <Typography fontWeight={600} sx={{ overflowWrap: "anywhere" }}>
            {currentDocument.filename}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {currentDocument.scope === "course" ? "Course material" : "Personal note"}
          </Typography>
          {active && (
            <LinearProgress
              aria-label={`${statusLabels[currentDocument.status]} status`}
              sx={{ mt: 1 }}
            />
          )}
          {statusQuery.isError && !isMissingDeletedDocument && (
            <Stack spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
              <ErrorNotice message={friendlyMessage(statusQuery.error)} />
              <Button
                onClick={() => void statusQuery.refetch()}
                disabled={statusQuery.isFetching}
              >
                Check status
              </Button>
            </Stack>
          )}
          {pollingTimedOut && active && (
            <Alert severity="info" role="status" aria-live="polite" sx={{ mt: 1 }}>
              Automatic status checks paused after two minutes.
              <Button
                size="small"
                onClick={() => void statusQuery.refetch()}
                disabled={statusQuery.isFetching}
                sx={{ ml: 1 }}
              >
                Check status
              </Button>
            </Alert>
          )}
        </TableCell>
        <TableCell sx={{ verticalAlign: "top" }}>
          <DocumentStatusIndicator status={currentDocument.status} />
        </TableCell>
        <TableCell
          sx={{ display: { xs: "none", sm: "table-cell" }, verticalAlign: "top" }}
        >
          {formatBytes(currentDocument.sizeBytes)}
        </TableCell>
        <TableCell
          sx={{ display: { xs: "none", sm: "table-cell" }, verticalAlign: "top" }}
        >
          {new Date(currentDocument.createdAt).toLocaleDateString()}
        </TableCell>
        <TableCell sx={{ verticalAlign: "top" }}>
          <Stack direction="row" spacing={0.25}>
            <Tooltip title={`View details for ${currentDocument.filename}`}>
              <IconButton
                aria-label={`View details for ${currentDocument.filename}`}
                onClick={() => setDetailsOpen(true)}
              >
                <Info size={18} aria-hidden="true" />
              </IconButton>
            </Tooltip>
            {canRetry && (
              <Tooltip title={`Retry ${currentDocument.filename}`}>
                <span>
                  <IconButton
                    aria-label={`Retry ${currentDocument.filename}`}
                    onClick={onRetry}
                    disabled={retryPending}
                  >
                    {retryPending ? (
                      <LoaderCircle size={18} aria-hidden="true" />
                    ) : (
                      <RotateCcw size={18} aria-hidden="true" />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip title={`Delete ${currentDocument.filename}`}>
                <IconButton
                  aria-label={`Delete ${currentDocument.filename}`}
                  color="error"
                  onClick={onDelete}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </TableCell>
      </TableRow>
      {currentDocument.status === "failed" && (
        <TableRow>
          <TableCell colSpan={5} sx={{ pt: 0 }}>
            <Stack spacing={1}>
              <Alert severity="error">
                {currentDocument.errorDetail?.trim() ||
                  "Document processing failed. Retry the upload or choose another file."}
              </Alert>
              {currentDocument.extractionDiagnostics?.warnings.map((warning, index) => (
                <Typography
                  key={`${index}-${warning}`}
                  color="text.secondary"
                  variant="body2"
                >
                  {warning}
                </Typography>
              ))}
            </Stack>
          </TableCell>
        </TableRow>
      )}
      <DocumentDetailsDialog
        document={currentDocument}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />
    </>
  );
}

/** Shows the metadata and safe processing diagnostics for one document. */
function DocumentDetailsDialog({
  document,
  open,
  onClose,
}: {
  document: DocumentView;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Document details</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Typography>
            <strong>File:</strong> {document.filename}
          </Typography>
          <Typography>
            <strong>Type:</strong> {document.mimeType}
          </Typography>
          <Typography>
            <strong>Size:</strong> {formatBytes(document.sizeBytes)}
          </Typography>
          <Typography>
            <strong>Status:</strong> {statusLabels[document.status]}
          </Typography>
          {document.errorDetail && (
            <Alert severity="error">{document.errorDetail}</Alert>
          )}
          {document.extractionDiagnostics && (
            <Box>
              <Typography fontWeight={600}>Extraction diagnostics</Typography>
              <Typography color="text.secondary" variant="body2">
                {document.extractionDiagnostics.pageCount} pages ·{" "}
                {document.extractionDiagnostics.charCount} characters ·{" "}
                {document.chunkCount ?? 0} chunks
              </Typography>
              {document.extractionDiagnostics.warnings.map((warning, index) => (
                <Typography
                  key={`${index}-${warning}`}
                  variant="body2"
                  sx={{ mt: 0.5 }}
                >
                  {warning}
                </Typography>
              ))}
            </Box>
          )}
          <Alert severity="info">
            The API does not provide document content for preview.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
