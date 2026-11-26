import { Box, Skeleton, Stack } from "@mui/material";

type AdminLoadingSkeletonProps = {
  label: string;
  mode?: "rows" | "summary";
  rows?: number;
};

export function AdminLoadingSkeleton({
  label,
  mode = "rows",
  rows = 3,
}: AdminLoadingSkeletonProps) {
  const count = mode === "summary" ? 6 : rows;

  return (
    <Box
      role="status"
      aria-label={label}
      aria-busy="true"
      className="admin-loading-state"
    >
      {mode === "summary" ? (
        <Box className="admin-summary-grid admin-summary-loading-grid">
          {Array.from({ length: count }, (_, index) => (
            <Box
              key={index}
              className="admin-summary-metric"
              aria-hidden="true"
              sx={{ py: 1.5, px: 1, borderBottom: 1 }}
            >
              <Skeleton variant="text" width="72%" height={24} />
              <Skeleton variant="text" width="36%" height={36} />
            </Box>
          ))}
        </Box>
      ) : (
        <Stack spacing={0}>
          {Array.from({ length: count }, (_, index) => (
            <Box
              key={index}
              className="admin-loading-row"
              aria-hidden="true"
              sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Skeleton variant="text" width="28%" height={26} />
              <Skeleton variant="text" width="56%" height={22} />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
