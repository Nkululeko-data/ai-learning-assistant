import type { CourseListItem, CourseView } from "../../api/courses";

export function isCourseView(course: CourseListItem): course is CourseView {
  return "ownerId" in course;
}
