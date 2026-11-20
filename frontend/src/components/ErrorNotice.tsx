import { Alert } from "@mui/material";

export function ErrorNotice({ message }: { message: string }) {
  return (
    <Alert severity="error" role="alert" aria-live="assertive">
      {message}
    </Alert>
  );
}
