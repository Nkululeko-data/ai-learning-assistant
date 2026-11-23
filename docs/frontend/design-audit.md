# Frontend design audit (F0)

**F0 status:** This is the pre-F1 baseline. No application UI or behavior was
changed during the audit; findings above describe the UI before F1.

## Scope and method

The audit covers the React/TypeScript frontend under `frontend/src`, the current
route tree, and the API documentation. The app was run locally and inspected in
Chromium on the document library and admin users screens using synthetic coach,
admin, and user records only. No real user data was used. No committed reference
screenshots or frontend image assets were found, so the live UI and source were
the evidence for this baseline.

Contrast figures below were calculated from browser-computed colors using the
WCAG relative-luminance formula. The sample was the document library at its
empty state, including the app bar, page text, and disabled Upload button.
These are representative measurements, not an axe-core scan of every route.

## Current navigation and routes

### Global shell

`frontend/src/app/App.tsx:69-92` defines the routes. Authenticated workspace
pages share `WorkspaceLayout` (`frontend/src/features/workspace/WorkspacePage.tsx:23-153`).

- **Learner and coach:** the top bar links to Dashboard (`/`), Courses
  (`/courses`), Chat (`/chat`), and History (`/conversations`).
- **Admin:** the top bar links to Admin dashboard (`/`), Course catalog
  (`/courses`), and Administration (`/admin`).
- **All roles:** an account menu contains Change password and Sign out.
- The primary links are MUI buttons, not a labeled `<nav>` landmark. They are
  hidden below the `sm` breakpoint; there is no mobile drawer or alternate
  navigation. The shell has a `<main>` landmark, but no skip link, breadcrumbs,
  or `aria-current="page"` on the active destination.

### Course and learning destinations

- `/courses` is the shared course catalog. Coaches can create and manage courses;
  learners can search, filter, and request access; administrators see a
  read-only catalog (`frontend/src/features/courses/CourseManagementPage.tsx:245-455`).
- `/courses/:courseId` is the course detail/curriculum surface. It links to the
  Document library and Study tools and includes course-owner controls and
  learner/enrolment panels (`frontend/src/features/courses/CourseDetailsPage.tsx:97-172`).
- `/courses/:courseId/documents` is the document library.
- `/courses/:courseId/study` contains the Summaries, Flashcards, and Quizzes tabs
  (`frontend/src/features/learning/LearningWorkspacePage.tsx:264-273`).
- `/chat` and `/conversations` are the Chat and History destinations.
- Course pages use “Back to courses” / “Back to course” links instead of
  breadcrumbs. There is no course-context navigation group.

### Admin destinations

- `/admin` contains tabs selected by the `section` query parameter:
  `users`, `coach-requests`, `course-approvals`, `operations`, and `settings`
  (`frontend/src/features/admin/AdminPage.tsx:10-86`).
- Operations adds a second tab strip for Jobs, Audit log, and AI executions
  (`frontend/src/features/admin/AdminOperationsPanel.tsx:20-74`).
- Admin dashboard Quick actions link to the same sections as the Administration
  tabs (`frontend/src/features/dashboard/DashboardPage.tsx:629-719`).
- The admin Course catalog is explicitly read-only in the frontend.
  The API specification documents admin endpoints for reassignment and archive
  (`docs/api/API-Specification.md:69-70,179-184`), but there is no corresponding
  admin course-management screen in the current frontend.

## Type, color, and contrast

### Current type and palette

- The theme defines `'"Inter", "Segoe UI", Arial, sans-serif` for all
  typography, with no separate heading family
  (`frontend/src/app/App.tsx:54-57`). No CSS files or bundled web-font files
  were found; `Inter` therefore depends on the viewer's installed fonts.
- Theme colors are primary navy `#153a5b`, secondary teal `#007c78`, and page
  background `#f5f7fa` (`frontend/src/app/App.tsx:49-52`). Cards render white;
  default MUI text uses `rgba(0, 0, 0, 0.87)` and secondary text
  `rgba(0, 0, 0, 0.6)`.
- Other authored colors are mostly translucent white text/chips on course
  headers (`frontend/src/features/courses/CourseManagementPage.tsx:273-339`,
  `frontend/src/features/courses/CourseCurriculum.tsx:95,237`) and the dark
  video background `#111` (`frontend/src/features/courses/CourseCurriculum.tsx:628`).
- Existing gradients are navy/teal or navy-only, not purple/indigo-to-blue:
  `frontend/src/features/courses/CourseCard.tsx:46`,
  `frontend/src/features/courses/CourseCurriculum.tsx:87,218`, and
  `frontend/src/features/courses/CourseManagementPage.tsx:260`.
- Browser-computed body size was 16px. MUI `body2`, button/navigation labels,
  and captions are smaller (typically 14px, with captions/overlines around
  12px); examples include document guidance at
  `frontend/src/features/documents/DocumentLibraryPage.tsx:231,337` and
  admin user email/self-account text at
  `frontend/src/features/admin/AdminUsersPanel.tsx:188,237`.

### Representative contrast measurements

| Sample (document library, synthetic data)  | Computed foreground/background                    |   Ratio | Result                                                                                             |
| ------------------------------------------ | ------------------------------------------------- | ------: | -------------------------------------------------------------------------------------------------- |
| Default body text on page                  | `rgba(0,0,0,.87)` on `#f5f7fa`                    | 15.17:1 | Passes 4.5:1                                                                                       |
| Secondary page text                        | `rgba(0,0,0,.60)` on `#f5f7fa`                    |  5.62:1 | Passes 4.5:1                                                                                       |
| App-bar text                               | white on `#153a5b`                                | 11.74:1 | Passes 4.5:1                                                                                       |
| Disabled Upload label on its disabled fill | `rgba(0,0,0,.26)` over `rgba(0,0,0,.12)` on white |  1.85:1 | Low contrast; disabled controls are exempt from WCAG text contrast, but the state is visually weak |
| Disabled Upload fill against white card    | composited disabled fill on white                 |  1.32:1 | Low contrast; disabled component boundary is exempt from WCAG 1.4.11                               |

The disabled Upload button is adjacent to “No file selected,” but the page does
not explicitly say that selecting a file enables it. Active text samples passed;
this table does not establish contrast compliance for every state or screen.

## Design-tell inventory

Each numbered row maps to section 6 of
`frontend/frontend-sidebar-and-design-cleanup.md`.

| #   | Finding                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Not seen:** purple/indigo-to-blue gradients. Brand gradients do exist; they use navy/teal or navy shades.                                                                                                                                                         | `CourseCard.tsx:46`; `CourseCurriculum.tsx:87,218`; `CourseManagementPage.tsx:260`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | **Present:** Inter is the first-choice font for both headings and body, with no bundled font or distinct heading face.                                                                                                                                              | `App.tsx:54-57`; no frontend `.css` or `.woff*` files found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | **Not seen:** gradient text or `background-clip: text`.                                                                                                                                                                                                             | No matching implementation in `frontend/src`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | **Not seen as decoration:** no “Introducing”/“New” pill above a headline. Chips found label actual statuses, file types, or course counts, for example `CourseManagementPage.tsx:312-339`, `CourseDetailsPage.tsx:109`, and `DocumentLibraryPage.tsx:522`.          | These are status/count metadata, not decorative headline badges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | **Not seen:** glowing halos or radial spotlights. Ordinary card/expand shadows are present.                                                                                                                                                                         | No radial-gradient/glow styling found; see motion/shadow evidence in item 13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | **Not seen:** glassmorphism, backdrop blur, or glow borders.                                                                                                                                                                                                        | No `backdrop-filter` implementation found in `frontend/src`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | **Not seen:** icons in rounded squares above headings, or a shared icon set.                                                                                                                                                                                        | No icon package/SvgIcon usage found. The account avatar uses an `IconButton` (`WorkspacePage.tsx:114-125`); MUI alerts provide their own status icons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8   | **Present:** repeated, same-weight card treatment is used for actions and data collections. The most prominent examples are the admin Quick actions and document-per-card grid.                                                                                     | Admin Quick actions: `DashboardPage.tsx:696-719`; documents: `DocumentLibraryPage.tsx:366-379,511-606`. Other repeated card collections: course catalog `CourseManagementPage.tsx:424-475` / `CourseCard.tsx:24-104`; dashboard metrics and pending/enrolled course records `DashboardPage.tsx:194-247,301-320,401-454,583-609`; course insight metrics `CourseDetailsPage.tsx:279-305,440-446`; admin review queues `CoachRequestsPanel.tsx:93-108`, `CourseApprovalsPanel.tsx:99-115`; operations records `AdminOperationsPanel.tsx:130,204,258`; study content `StudyContentPanels.tsx:161,371,657`; coach quiz questions `CoachQuizzesPanel.tsx:478-524`; conversation history `ConversationHistoryPage.tsx:152-161`; enrolment requests `EnrolmentRequestsPanel.tsx:106-127`. Many record cards are functional lists, but the repeated treatment is pervasive. |
| 9   | **Not seen:** literal Card-inside-Card nesting. The upload card and document cards are sibling sections; bordered tables and filters are also not card-nested.                                                                                                      | `DocumentLibraryPage.tsx:226-228,366-379,511-512`; `AdminUsersPanel.tsx:169-170`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 10  | **Not seen:** thick colored left stripes on cards or navigation items.                                                                                                                                                                                              | No `border-left`/`borderLeft` styling found in `frontend/src`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 11  | **Not seen:** giant, context-free hero statistics. Coach/course metrics have labels and context.                                                                                                                                                                    | `DashboardPage.tsx:194-247,581-609`; course insight metrics `CourseDetailsPage.tsx:279-305,440-446`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 12  | **Not seen:** decorative “01/02” labels without sequence meaning. Lesson, flashcard, and question numbers identify ordered content.                                                                                                                                 | `CourseCurriculum.tsx:443`; `StudyContentPanels.tsx:373,659`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 13  | **Not seen:** pulses, bounce easing, hover zoom, or auto-scrolling strips. Small state/hover effects do exist: course cards lift by 2px with a 160ms transition, while curriculum/editor rows transition shadow/border state. No reduced-motion override was found. | `CourseCard.tsx:32-37`; `CourseCurriculum.tsx:363-364`; `CourseLessonsEditor.tsx:365`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 14  | **Mild finding:** the admin dashboard uses a greeting plus generic management filler. No “supercharge,” “world-class,” “seamless,” “empower,” or “elevate” copy was found. Em dashes occur as placeholders/metadata separators, not marketing prose.                | Admin filler: `DashboardPage.tsx:688-697`; placeholders: `DashboardPage.tsx:157,163,202,214,229,240,247`, `CourseDetailsPage.tsx:446`; metadata separator: `AdminOperationsPanel.tsx:211`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 15  | **Not seen:** beige/cream palette or oversized italic serif headline. The page uses a blue-gray neutral background and the same sans-serif family for all text.                                                                                                     | `App.tsx:49-57`; no italic/serif heading styling found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Additional findings

- **ALL-CAPS controls and navigation:** MUI's default button/tab styling transforms
  labels to uppercase. On the synthetic document page the rendered labels
  included `DASHBOARD`, `COURSES`, `CHAT`, `HISTORY`, `BACK TO COURSE`,
  `CHOOSE FILE`, and `UPLOAD`. On the admin users page they included
  `ADMIN DASHBOARD`, `COURSE CATALOG`, `ADMINISTRATION`, the admin tabs, and
  repeated row actions such as `CHANGE ROLE`, `SUSPEND`, and `ERASE DATA`.
  The source has explicit `textTransform: "none"` only for course filter tabs
  and the chat composer (`CourseManagementPage.tsx:413-417`,
  `ChatWorkspacePage.tsx:329`); other MUI buttons/tabs inherit uppercase.
  Overline labels also render uppercase for `COURSE WORKSPACE`,
  `COURSE PREVIEW`, `COURSE CURRICULUM`, lesson numbers, and chat-message
  metadata (`CourseManagementPage.tsx:272-275`,
  `CourseCurriculum.tsx:106,308,439-443`, `ChatMessage.tsx:70`).
- **Disabled controls:** each user row repeats Change role, Suspend/Activate,
  and Erase data buttons. The signed-in admin's own row renders all three
  disabled, followed by “Your account cannot be changed here”
  (`AdminUsersPanel.tsx:198-240`). The document Upload button is disabled until
  a file is selected (`DocumentLibraryPage.tsx:260-265`).
- **Repeated destinations and names:** top navigation, the admin dashboard
  Quick actions, the Administration tabs, and Operations sub-tabs overlap as
  entry points. “Admin dashboard,” “Administration,” and “Operations” are
  distinct but potentially confusing names for those surfaces.
- **Admin users shape:** users are split into role headings and separate tables;
  each table has User, Status, Account, and Actions columns, but no Role column.
  Three row-action buttons repeat for each eligible user
  (`AdminUsersPanel.tsx:166-240`).
- **Document library shape:** documents use a two-column card grid. The upload
  area is a separate card; filters apply to loaded pages. The delete dialog
  says the document “will be removed asynchronously” but does not state that
  deletion cannot be undone (`DocumentLibraryPage.tsx:226-236,299-400,415-435`).
- **No unique primary-navigation state:** there are no active-item indicators
  or `aria-current` attributes in the shell. The global navigation also has no
  labeled navigation landmark or skip link (`WorkspacePage.tsx:23-153`).

## API and implementation notes for the next phase

- `GET /admin/users` and course-document listing are cursor-paginated; current
  filtering is limited to loaded rows/pages. Existing copy already discloses
  this for users and documents (`AdminUsersPanel.tsx:138-148`,
  `DocumentLibraryPage.tsx:337-338`). The owner requested server-side
  search/filter support. Current loaded-row/page filtering remains until the
  optional search API is extended. F4 also updated `GET /courses` for admins
  with `user:manage` so the Admin Courses route can list pending and archived
  course metadata without exposing lesson content.
- User records already include role, so a single table with a role column/filter
  does not require a new API field. The course catalog and approval APIs are
  documented; admin reassign/archive endpoints exist, while the frontend catalog
  remains read-only (`docs/api/API-Specification.md:69-72,179-184`).
- No summary-count endpoint was found in the cited frontend/API surface. The
  section 10 recommendation to use capped client-side first-page counts is
  compatible with the current pagination model.
- The current coach navigation includes Chat and History. Course-specific
  summaries, flashcards, and quizzes are available within the Study tools
  surface.
- Admin course scope must remain free of course-content access in keeping with
  the existing role boundary recorded in `design-decisions (1).md` (R-6).

## Owner-confirmed direction and next gate

The owner confirmed the following after F0:

- **Feel:** calm, clear, trustworthy, and plain-spoken.
- **Color:** navy `#153a5b` primary; terracotta `#B4512D` accent; darker
  terracotta `#9C4221` for hover/pressed states. Keep action accents off standard
  navigation icons.
- **Type:** Source Sans 3 for body and Source Serif 4 for headings.
- **Icons:** Lucide React only, outline style, 20px; white on the navy sidebar,
  navy on light backgrounds, with a subtle lighter-navy active background.
  Avoid decorative icons, gradients, colored icon backgrounds, rounded-square
  containers, and mixing icon libraries.
- **UI-2:** use client-side first-page counts capped at `99+`.
- **UI-3:** request server-side search/filter support from the backend. Do not
  change backend code in this frontend-only scope; keep loaded-row/page filtering
  until the API support exists.
- **UI-4:** remove Chat and History from coach navigation.
- **UI-5:** use an icon rail at tablet widths.
- **UI-6:** Admin Courses is limited to listing, owner reassignment, and archive;
  no course content.

The owner approved F1 (design tokens and base typography), which has since been
implemented in `frontend/src/theme/designTokens.ts`, `frontend/src/app/App.tsx`,
and `frontend/src/main.tsx`. Source Sans 3 and Source Serif 4 are self-hosted;
global buttons and tabs now use sentence case; course catalog/curriculum hero
gradients and the decorative course-card stripe were removed. F1 did not change
the app shell or routes. F2 was implemented only after its specific structural
changes were explained and separately approved. The remaining implementation
sequence is gated by the specification's approval-after-each-step rule.

The owner separately approved F2. The workspace now has a responsive sidebar,
slim account/breadcrumb bar, skip link, and a role/permission-aware navigation
configuration.

The owner approved F3, including adding frontend route and page support for
missing destinations. Learner and admin navigation now follows section 4;
generic Chat and History links are omitted from the coach menu per UI-4. The
course-context group uses the course name, permission-filtered destinations,
working section anchors, and pending-count badges. Learner My courses, History,
and Quiz results destinations are available.

The owner approved F4. Admin navigation now uses dedicated, permission-guarded
routes, `/admin` is the dashboard, and direct admin access to learner/course
content routes redirects back to the admin workspace. The dashboard replaces
Quick actions with live Needs attention counts. Users are shown in one
role-filterable table with a single Actions menu per row and a non-actionable
You tag for the signed-in administrator. The Admin Courses page is limited to
course metadata, owner reassignment, and archive controls; jobs, audit,
executions, and settings each have separate destinations.

The owner approved F5. The Documents page now uses a responsive metadata table,
status labels with icons, an explicit learner personal-note scope, upload
guidance, failed-document recovery, and irreversible-delete confirmation.

F6 is complete. Course, dashboard, approval, enrolment, operations, quiz, and
conversation records use flat layouts instead of generic card grids. Redundant
course "Back" links and decorative overlines were removed; body text uses the
16px floor, and reduced-motion preferences are respected globally. Semantic
flashcards, chat messages, and lesson accordions remain content-specific
patterns.

## F7 Re-check (2026-11-23)

The F0 inventory above is the historical baseline. The current frontend was
re-checked against it without changing application code. The bundled detector
returned no findings for `frontend/src`. Validation passed: 61/61 unit tests,
7/7 Playwright tests, lint, typecheck, and production build. Axe checks cover
the admin dashboard, users, course approvals, and document library; responsive
checks cover 1280, 900, and 390px on documents and 390px on admin course
surfaces. The shared browser-page reader timed out, so no additional live-tab
inspection was possible; route-mocked Chromium checks were used instead. No
custom drag or slider gestures were found, and no physical-device testing was
performed.

### Health score

| Dimension | Score | Current evidence |
|---|---:|---|
| Accessibility | 3/4 | Sampled axe checks pass; landmarks, skip link, focus styles, labels, and 16px body text are present. The global reduced-motion override is too broad (P2). |
| Performance | 3/4 | No layout-read/write loops, broad `will-change`, or non-lazy images found. The app chunk is 90.87KB gzip; no runtime profile was collected. |
| Theming | 3/4 | Shared navy/terracotta/neutral tokens and bundled Source Sans 3 / Source Serif 4 are in use. The theme is light-only, and one overline token is stale (P3). |
| Responsive design | 3/4 | Sampled pages fit the tested widths; touch gestures and physical devices were not tested. |
| Implementation integrity | 4/4 | The detector is clean; remaining cards and navigation patterns have explicit product purposes below. |
| **Total** | **16/20** | **Good** |

### Design-tell re-check

| # | F7 result |
|---:|---|
| 1 | No purple/indigo-to-blue gradients remain. Course hero gradients were removed. |
| 2 | Resolved: Source Sans 3 body text and Source Serif 4 headings are self-hosted. |
| 3 | No gradient text or `background-clip: text` found. |
| 4 | Status and count chips remain only where they communicate real state or metadata. |
| 5–6 | No glow/spotlight or glassmorphism implementation found. |
| 7 | No repeated icon-in-rounded-square heading treatment found. |
| 8 | Generic record-card collections are now tables or flat, divided rows. Intentional content cards are listed below. |
| 9 | Chat messages remain cards inside the transcript pane to distinguish individual messages, authors, grounding state, citations, and feedback. This is intentional nesting, not a generic card grid. |
| 10 | No colored side-stripe treatment found. |
| 11 | Dashboard metrics are contextual definition-list values; admin counts remain small, labeled queue totals. No giant hero stats found. |
| 12 | Lesson, flashcard, and quiz numbers identify meaningful sequence positions. |
| 13 | Course-card hover lift is gone and reduced motion is covered. The global 0.01ms override still suppresses all transitions, including useful state feedback (P2). |
| 14 | Copy is factual and plain-spoken. Em dashes remain separators or unavailable-value placeholders, not marketing copy. |
| 15 | The navy/terracotta and neutral palette remains; no beige default or oversized italic serif treatment found. |

### Fixed since F0 and purposeful keeps

- **Fixed:** the shell now has labeled navigation landmarks, a skip link,
  breadcrumbs, `aria-current`, and role/permission-aware destinations.
- **Fixed:** all-caps control styling and course-context "Back" links are gone;
  decorative overlines were removed.
- **Fixed:** admin users are in one role-filterable table; documents use a
  responsive metadata table; course, approval, enrolment, operations, and
  history records use flat rows.
- **Kept on purpose:** flashcards remain card-shaped because each front/back
  pair has its own reveal action. Chat messages remain individual message
  surfaces inside the transcript pane. Lesson accordions preserve progressive
  disclosure. Status chips and sequence numbers remain informative.
- **Kept on purpose:** dashboard "Review" links are contextual actions for
  pending work; the sidebar remains the single global navigation system.
- **Not in scope:** the current theme is light-only; no dark-mode requirement
  was specified.

### Remaining findings at F7

- **[Resolved after F7 on 2026-11-23] Reduced-motion override suppressed all
  transitions.** The global rule now preserves ordinary control feedback while
  making MUI spatial transitions for collapses, drawers, dialogs, menus,
  popovers, and backdrops effectively immediate. The document-library browser
  test verifies that button feedback remains animated while dialog movement is
  reduced; normal and reduced-motion captures confirm the button's 250ms color
  transition remains available in both modes.
- **[P3] Unused overline color token.** `theme/designTokens.ts:11`
  `onPrimaryOverline` has no remaining consumer after decorative overlines
  were removed. It has no runtime impact; remove it during the next polish pass.
