import { useState, type FormEvent } from "react";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyMessage } from "../../api/client";
import { getAdminConfig, updateAdminConfig } from "../../api/admin";
import { ErrorNotice } from "../../components/ErrorNotice";
import { AdminLoadingSkeleton } from "./AdminLoadingSkeleton";

export function AdminSettingsPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["admin", "config"],
    queryFn: getAdminConfig,
  });
  const [draftValues, setDraftValues] = useState<{
    insightMinCohortSize: string;
    insightPeriodDays: string;
    gapReportsMaxPerCourse: string;
  } | null>(null);
  const updateMutation = useMutation({
    mutationFn: updateAdminConfig,
    onSuccess: async () => {
      setDraftValues(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "config"] });
    },
  });

  if (configQuery.isLoading) {
    return (
      <Stack spacing={2}>
        <Typography component="h1" variant="h4" fontWeight={700}>
          Settings
        </Typography>
        <AdminLoadingSkeleton label="Loading admin settings" rows={3} />
      </Stack>
    );
  }
  if (configQuery.isError) {
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Typography component="h1" variant="h4" fontWeight={700}>
          Settings
        </Typography>
        <ErrorNotice message={friendlyMessage(configQuery.error)} />
        <Button onClick={() => void configQuery.refetch()}>Retry</Button>
      </Stack>
    );
  }

  if (!configQuery.data) {
    return <Alert severity="info">Admin settings are unavailable.</Alert>;
  }

  const values = draftValues ?? {
    insightMinCohortSize: String(configQuery.data.insightMinCohortSize),
    insightPeriodDays: String(configQuery.data.insightPeriodDays),
    gapReportsMaxPerCourse: String(configQuery.data.gapReportsMaxPerCourse),
  };
  const parsed = {
    insightMinCohortSize: Number(values.insightMinCohortSize),
    insightPeriodDays: Number(values.insightPeriodDays),
    gapReportsMaxPerCourse: Number(values.gapReportsMaxPerCourse),
  };
  const valid =
    Number.isInteger(parsed.insightMinCohortSize) &&
    parsed.insightMinCohortSize >= 1 &&
    parsed.insightMinCohortSize <= 1000 &&
    Number.isInteger(parsed.insightPeriodDays) &&
    parsed.insightPeriodDays >= 1 &&
    parsed.insightPeriodDays <= 365 &&
    Number.isInteger(parsed.gapReportsMaxPerCourse) &&
    parsed.gapReportsMaxPerCourse >= 1 &&
    parsed.gapReportsMaxPerCourse <= 100;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid) updateMutation.mutate(parsed);
  }

  return (
    <Stack
      component="form"
      spacing={2}
      onSubmit={submit}
      sx={{ maxWidth: 560 }}
      aria-labelledby="admin-settings-title"
    >
      <div>
        <Typography
          id="admin-settings-title"
          component="h1"
          variant="h4"
          fontWeight={700}
        >
          Settings
        </Typography>
        <Typography color="text.secondary">
          Privacy and insight values affect cohort reporting and generated gap reports.
        </Typography>
      </div>
      {updateMutation.error && (
        <ErrorNotice message={friendlyMessage(updateMutation.error)} />
      )}
      {updateMutation.isSuccess && <Alert severity="success">Settings updated.</Alert>}
      {!canManage && (
        <Alert severity="info">You have view-only access to these settings.</Alert>
      )}
      <TextField
        label="Minimum cohort size"
        type="number"
        value={values.insightMinCohortSize}
        disabled={!canManage}
        onChange={(event) =>
          setDraftValues((current) => ({
            ...(current ?? values),
            insightMinCohortSize: event.target.value,
          }))
        }
        inputProps={{ min: 1, max: 1000, step: 1 }}
        helperText="1–1000 learners"
        required
      />
      <TextField
        label="Insight period (days)"
        type="number"
        value={values.insightPeriodDays}
        disabled={!canManage}
        onChange={(event) =>
          setDraftValues((current) => ({
            ...(current ?? values),
            insightPeriodDays: event.target.value,
          }))
        }
        inputProps={{ min: 1, max: 365, step: 1 }}
        helperText="1–365 days"
        required
      />
      <TextField
        label="Maximum gap reports per course"
        type="number"
        value={values.gapReportsMaxPerCourse}
        disabled={!canManage}
        onChange={(event) =>
          setDraftValues((current) => ({
            ...(current ?? values),
            gapReportsMaxPerCourse: event.target.value,
          }))
        }
        inputProps={{ min: 1, max: 100, step: 1 }}
        helperText="1–100 reports"
        required
      />
      {canManage && (
        <Button
          type="submit"
          variant="contained"
          disabled={!valid || updateMutation.isPending}
          sx={{ alignSelf: "flex-start" }}
        >
          {updateMutation.isPending ? "Saving..." : "Save settings"}
        </Button>
      )}
    </Stack>
  );
}
