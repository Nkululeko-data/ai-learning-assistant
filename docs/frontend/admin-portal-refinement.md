# Admin portal refinement

## Existing responsibilities

| Area               | Existing capability                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Dashboard          | API-backed summary counts and review links for coach applications, course approvals, and failed or dead jobs  |
| Users              | Cursor-paginated list, loaded-page search and role filtering, role/status changes, and queued privacy erasure |
| Coach applications | Approve or reject applications with optional notes                                                            |
| Course approvals   | Approve courses or request changes with feedback                                                              |
| Courses            | View course metadata, reassign owners, and archive courses; no course-content access                          |
| Operations         | Review jobs, audit entries, and AI execution metadata; retry eligible jobs                                    |
| Settings           | View and edit existing configuration according to current permissions                                         |

These are existing workflows; the refinement does not add routes, data, or
administrative actions. Existing route and permission checks remain in place.

## UI changes

- Added a personalized Admin dashboard greeting while keeping the existing
  API-backed summary values and Needs attention queues.
- Presented summary values with definition-list semantics and retained the
  existing contextual review links rather than adding duplicate quick actions.
- Applied consistent heading and table styling across Admin pages. Tables keep
  their own horizontal scrolling on narrow screens.
- Added accessible skeleton placeholders for dashboard summaries and page
  records. Operations screens now provide retry actions for failed initial and
  next-page requests.
- Added readable, state-colored status chips for existing user, course,
  approval, job, and AI-execution statuses.
- Updated the sidebar descriptor to identify the Admin workspace; its
  permission-filtered destinations are unchanged.

## Validation

- Admin unit tests: 8 passed.
- Admin workspace browser tests: 4 passed, including mobile layout checks.
- Frontend lint, type-check/build, and formatting checks for changed files
  passed.
- The full unit suite passed 86/87. Its remaining failure is the existing quiz
  generation payload assertion in `CourseDetailsPage.test.tsx`.
