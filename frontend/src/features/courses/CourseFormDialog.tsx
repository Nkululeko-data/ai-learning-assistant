import { useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { z } from "zod";
import type { CourseView } from "../../api/courses";
import { friendlyMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ErrorNotice";

const courseFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a course name.").max(120),
  description: z.string().trim().max(2000),
});

export interface CourseFormValues {
  name: string;
  description: string;
}

export function CourseFormDialog({
  open,
  course,
  onClose,
  onSave,
}: {
  open: boolean;
  course?: CourseView;
  onClose: () => void;
  onSave: (values: CourseFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const values = courseFormSchema.parse({ name, description });
      if (
        course &&
        values.name === course.name &&
        values.description === (course.description ?? "")
      ) {
        onClose();
        return;
      }
      await onSave(values);
    } catch (saveError) {
      setError(
        saveError instanceof z.ZodError
          ? (saveError.issues[0]?.message ?? "Check the entered information.")
          : friendlyMessage(saveError),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="course-form-title"
    >
      <DialogTitle id="course-form-title">
        {course ? "Edit course" : "Create course"}
      </DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="course-form"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={handleSubmit}
        >
          <div>
            <Typography component="h2" variant="subtitle1" fontWeight={700}>
              Course information
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Set the title and description learners will see in the course catalog.
            </Typography>
          </div>
          {error && <ErrorNotice message={error} />}
          <TextField
            label="Course name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            inputProps={{ maxLength: 120 }}
            helperText="Use a clear, recognizable title."
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={3}
            inputProps={{ maxLength: 2000 }}
            helperText={`${description.length}/2000 characters`}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" form="course-form" variant="contained" disabled={saving}>
          {saving ? "Saving..." : course ? "Save changes" : "Create course"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
