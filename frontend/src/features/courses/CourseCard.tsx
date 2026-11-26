import type { ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { ArrowRight, BookOpen } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import type { CourseListItem } from "../../api/courses";
import { isCourseView } from "./course-utils";

export function CourseCard({
  course,
  actions,
  showViewAction = true,
  lessonCount,
}: {
  course: CourseListItem;
  actions?: ReactNode;
  showViewAction?: boolean;
  lessonCount?: number;
}) {
  return (
    <Card
      component="article"
      variant="outlined"
      className="learnova-course-card"
      aria-label={`${course.name} course`}
    >
      <Box className="learnova-course-art" aria-hidden="true">
        <Box className="learnova-course-art-icon">
          <BookOpen size={27} strokeWidth={1.7} />
        </Box>
        <Typography component="span" className="learnova-course-art-label">
          Learning path
        </Typography>
      </Box>
      <CardContent className="learnova-course-card-content">
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          spacing={1}
        >
          <Typography
            component="h2"
            className="learnova-course-card-title"
            sx={{
              display: "-webkit-box",
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
            }}
          >
            {course.name}
          </Typography>
          {isCourseView(course) && (
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              sx={{ flexShrink: 0 }}
            >
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
        <Typography className="learnova-course-card-description">
          {course.description || "No description provided."}
        </Typography>
        {lessonCount !== undefined && (
          <Typography variant="body2" color="text.secondary">
            {lessonCount} {lessonCount === 1 ? "lesson" : "lessons"}
          </Typography>
        )}
        {isCourseView(course) && (
          <Typography
            className="learnova-course-updated"
            variant="caption"
            color="text.secondary"
          >
            Updated{" "}
            {new Date(course.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Typography>
        )}
        {isCourseView(course) &&
          course.approvalStatus === "changes_requested" &&
          course.approvalNote && (
            <Typography variant="body2" color="error.main">
              Admin feedback: {course.approvalNote}
            </Typography>
          )}
        <Box className="learnova-course-card-actions">
          {showViewAction && (
            <Button
              component={RouterLink}
              to={`/courses/${course.id}`}
              variant="contained"
              endIcon={<ArrowRight size={17} aria-hidden="true" />}
              sx={{ mr: "auto" }}
            >
              View course
            </Button>
          )}
          {actions}
        </Box>
      </CardContent>
    </Card>
  );
}

export function CourseCardSkeleton() {
  return (
    <Card
      variant="outlined"
      aria-hidden="true"
      className="learnova-course-card learnova-course-card-skeleton"
    >
      <Box className="learnova-course-art">
        <Skeleton variant="rounded" width={54} height={54} />
        <Skeleton variant="text" width={96} />
      </Box>
      <CardContent className="learnova-course-card-content">
        <Skeleton variant="text" width="72%" height={34} />
        <Skeleton variant="text" width="94%" />
        <Skeleton variant="text" width="82%" />
        <Skeleton variant="rounded" width={136} height={42} sx={{ mt: "auto" }} />
      </CardContent>
    </Card>
  );
}
