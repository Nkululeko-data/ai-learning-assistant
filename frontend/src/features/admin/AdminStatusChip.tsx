import { Chip } from "@mui/material";

type StatusTone = "success" | "warning" | "error" | "neutral";

export function AdminStatusChip({ status }: { status: string }) {
  const tone = getStatusTone(status);

  return (
    <Chip
      className={`admin-status-chip admin-status-chip--${tone}`}
      label={status.replace(/_/g, " ")}
      size="small"
    />
  );
}

function getStatusTone(status: string): StatusTone {
  switch (status.toLowerCase()) {
    case "active":
    case "approved":
    case "done":
    case "success":
    case "succeeded":
    case "completed":
      return "success";
    case "pending":
    case "queued":
    case "running":
    case "changes_requested":
    case "in_progress":
      return "warning";
    case "suspended":
    case "failed":
    case "dead":
    case "rejected":
      return "error";
    default:
      return "neutral";
  }
}
