import type { ReactNode } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
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
    <Box
      component="article"
      sx={{
        py: 2,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "flex-start" }}
        spacing={2}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1}
          >
            <Typography
              component="h2"
              variant="h6"
              fontWeight={650}
              sx={{ overflowWrap: "anywhere" }}
            >
              {course.name}
            </Typography>
            {isCourseView(course) && (
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={course.status === "active" ? "Active" : "Archived"}
                  color={course.status === "active" ? "success" : "default"}
                />
                {course.approvalStatus && course.approvalStatus !== "approved" && (
                  <Chip
                    size="small"
                    label={
                      course.approvalStatus === "pending"
                        ? "Awaiting admin approval"
                        : "Changes requested"
                    }
                    color={course.approvalStatus === "pending" ? "warning" : "error"}
                  />
                )}
              </Stack>
            )}
          </Stack>
          <Typography
            color="text.secondary"
            sx={{
              mt: 1,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              overflow: "hidden",
            }}
          >
            {course.description || "No description provided."}
          </Typography>
          {isCourseView(course) &&
            course.approvalStatus === "changes_requested" &&
            course.approvalNote && (
              <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                Admin feedback: {course.approvalNote}
              </Typography>
            )}
        </Box>
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ flexShrink: 0 }}
        >
          <Button
            component={RouterLink}
            to={`/courses/${course.id}`}
            size="small"
            variant="outlined"
          >
            View course
          </Button>
          {actions}
        </Stack>
      </Stack>
    </Box>
  );
}
