import type { ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { CourseListItem } from "../../api/courses";
import { isCourseView } from "./course-utils";

export function CourseCard({
  course,
  actions,
}: {
  course: CourseListItem;
  actions?: ReactNode;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 3,
        transition:
          "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
        "&:hover": {
          transform: "translateY(-2px)",
          borderColor: "primary.main",
          boxShadow: 2,
        },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          height: 5,
          background: (theme) =>
            `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
        }}
      />
      <CardContent sx={{ flexGrow: 1, p: 2.5 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={2}
        >
          <Typography component="h2" variant="h6" fontWeight={650}>
            {course.name}
          </Typography>
          {isCourseView(course) && (
            <Chip
              size="small"
              label={course.status === "active" ? "Active" : "Archived"}
              color={course.status === "active" ? "success" : "default"}
            />
          )}
        </Stack>
        <Typography
          color="text.secondary"
          sx={{
            mt: 1,
            whiteSpace: "pre-wrap",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
          }}
        >
          {course.description || "No description provided."}
        </Typography>
      </CardContent>
      <CardActions sx={{ px: 2.5, pb: 2, pt: 0, flexWrap: "wrap", gap: 0.5 }}>
        <Button
          component={RouterLink}
          to={`/courses/${course.id}`}
          size="small"
          variant="outlined"
        >
          View course
        </Button>
        {actions}
      </CardActions>
    </Card>
  );
}
