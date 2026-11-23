# Frontend: Sidebar Navigation and Design Cleanup

**Audience:** the coding LLM working on the React + TypeScript frontend of the AI Learning Assistant.
**Source documents:** `API-Specification.md` (routes, permissions, error codes), `design-decisions.md` (role boundaries), and the screenshots listed in section 2.
**Status labels:** **MUST** = do not deviate. **DERIVED** = proposed from the evidence; implement and flag in review. **OPEN** = ask the owner before building.

---

## 0. Working rules (MUST)

1. **Inspect before changing.** You have not seen this codebase's frontend through this document. Read the current routing, layout, styles and components first. Do not assume a UI library or CSS approach.
2. **Build one piece at a time**, each in its own file. Do not rewrite the whole frontend in one pass.
3. **Comment every function** (purpose, inputs, outputs).
4. **Explain the reasoning for each step before writing code** and wait for approval on anything structural (layout shell, routing, tokens).
5. **Do not touch the backend.** If a UI need has no API support, record it in section 10 as a backend request instead of inventing an endpoint.
6. **Hiding is cosmetic.** Navigation visibility is a convenience. The backend still enforces permission and ownership on every call. Never rely on the sidebar for security.
7. **Never use real user data in screenshots, fixtures or docs.** Use the seeded demo accounts.

---

## 1. The problem in one paragraph

Navigation is spread across three places: a **top bar** with a few links, **tabs** inside pages (Administration), and **"Quick actions" cards** on the admin dashboard that only repeat the nav. The user has to hunt for where things are, and the same destination appears two or three times. All the navigation should live in one **left sidebar** that changes by role and, inside a course, shows that course's sections. Alongside this, the screens show several "generic AI-generated UI" tells that should be cleaned up.

---

## 2. What the screenshots show

| Screenshot | Where | Findings |
|---|---|---|
| **A** Document library (coach) | Course > Documents | Top bar links: DASHBOARD, COURSES, CHAT, HISTORY, plain text "coach", avatar. "BACK TO COURSE" is an all-caps text link. Upload card with CHOOSE FILE / "No file selected" / a **disabled UPLOAD button**. Filter box and Status select with the note "Filters apply to loaded pages. Load more to include older documents." Documents appear as separate cards with a green "Ready" pill |
| **B** Admin dashboard | Admin home | Top bar links: ADMIN DASHBOARD, COURSE CATALOG, ADMINISTRATION. "Welcome, Administrator..." then **"Quick actions": four identical cards** (Coach applications, User accounts, Operations, Course catalog), each a title, one line and an outlined button. The fourth card sits alone on a second row. The dashboard shows **no actual data** |
| **C** Administration | Admin > Administration | A header, then **tabs**: USERS, COACH APPLICATIONS, COURSE APPROVALS, OPERATIONS. Users grouped under "Administrators (1)", "Coaches (1)". Each row has three action buttons (CHANGE ROLE, SUSPEND, ERASE DATA) that are all **disabled** for the admin's own row, plus the sentence "Your account cannot be changed here." |
| **D** Three video frames | Reference | A list of 15 "AI design tells" to remove or replace, plus extra checks (spacing, body text 16px or larger, contrast at least 4.5:1). Section 6 applies it to this project |

### Measured from the screenshots
| Element | Measured | Verdict |
|---|---|---|
| Secondary text (subtitles, helper text, card descriptions) | about 5.6:1 | Passes 4.5:1 |
| Top bar (white on navy `#153A5B`) | about 11.7:1 | Passes |
| "Ready" badge (white on green) | about 5.1:1 | Passes |
| **Disabled buttons** (UPLOAD, CHANGE ROLE, SUSPEND, ERASE DATA) | about 1.8 to 1.9:1 | Disabled controls are exempt from WCAG, but they look like blank placeholders and give no reason for being disabled |

Re-measure with a real tool (axe-core, or Playwright plus a contrast check) on the running app. These numbers come from sampled screenshot pixels and are only a guide.

---

## 3. Target layout (MUST)

```
+----------------------+-------------------------------------------------+
|  Brand               |  Breadcrumb                         [Account]   |
|                      +-------------------------------------------------+
|  Primary nav         |                                                 |
|  (by role)           |   Page title                                    |
|                      |   Page content                                  |
|  Course section      |                                                 |
|  (only inside a      |                                                 |
|  course)             |                                                 |
+----------------------+-------------------------------------------------+
```

- **Sidebar (left):** brand at the top, then primary navigation for the role. When the user is inside a course, a second group shows that course's sections (section 4.3).
- **Top bar (slim):** breadcrumbs on the left (replaces "BACK TO COURSE"), account menu on the right. **No primary navigation links in the top bar.**
- **Account menu** (avatar button): display name, role label, Change password, Sign out. Remove the loose "coach" / "admin" text next to the avatar.
- **Widths:** sidebar 240px expanded; collapsible to a 64px icon rail; content max width about 1100px so tables do not stretch across wide monitors.
- **Responsive:**
  - 1024px and above: expanded sidebar.
  - 768 to 1023px: icon rail by default, expandable.
  - Below 768px: sidebar becomes an off-canvas drawer opened by a menu button in the top bar; it closes on route change and on Escape.
- **State:** the collapsed/expanded choice is a per-user convenience stored in `localStorage` inside try/catch; the layout must work if storage is unavailable.

### Sidebar behaviour and accessibility (MUST)
- Use a `<nav aria-label="Main">` landmark; the course group is a second `<nav aria-label="Course">`.
- The current page has `aria-current="page"`. **Active state uses a background tint plus heavier weight, not a thick colored stripe on the side** (that is tell number 10 in section 6).
- Add a "Skip to main content" link as the first focusable element.
- Fully keyboard operable, visible `:focus-visible` outlines, targets at least 40px tall.
- Groups that expand (for example Operations) use a button with `aria-expanded`, and the children are real links.
- Icons sit **beside** the label at one size (20px) from a single icon set, with no rounded-square containers. When the rail is collapsed, every icon has an accessible name and a tooltip.
- Labels use sentence case ("Coach applications"), not ALL CAPS (section 6, extra finding).

---

## 4. Navigation by role

Each item lists its destination, the API it reads, and its visibility rule. **Visibility comes from the role and the effective permissions returned by `GET /me`**, never from a hard-coded role string alone.

### 4.1 Learner
| Item | Frontend route (suggested) | API | Notes |
|---|---|---|---|
| Dashboard | `/` | `GET /me/enrolments`, recent `GET /conversations` | Continue where you left off |
| My courses | `/my-courses` | `GET /me/enrolments` | Approved courses, plus pending and rejected states |
| Browse courses | `/courses` | `GET /courses` | Course cards; request to join |
| Chat | `/chat` | `POST /chat/ask` | Course picker inside the page |
| History | `/history` | `GET /conversations` | |
| Quiz results | `/quiz-results` | `GET /me/quiz-attempts` | |

### 4.2 Coach
| Item | Route | API | Notes |
|---|---|---|---|
| Dashboard | `/` | `GET /me/courses`, join requests | Needs-attention list (section 5.2) |
| My courses | `/my-courses` | `GET /me/courses` | Includes approval status (pending, changes requested) |
| Chat | `/chat` | `POST /chat/ask` | Coach can ask in own courses |
| History | `/history` | `GET /conversations` | |

### 4.3 Course section (appears in the sidebar while inside `/courses/:id/*`)
| Item | Learner | Coach | API |
|---|---|---|---|
| Overview | yes | yes | `GET /courses/{id}` |
| Lessons | yes | yes (edit) | `GET/PUT /courses/{id}/lessons` |
| Documents | yes (course docs + own notes) | yes (course docs) | `GET /courses/{id}/documents` |
| People | yes (names only) | yes | `GET /courses/{id}/learners` |
| Join requests (count badge) | no | needs `enrolment:approve` | `GET /courses/{id}/join-requests` |
| Quizzes | yes | yes | `GET /courses/{id}/quizzes` |
| Summaries | yes | yes | `GET /courses/{id}/summaries` |
| Flashcards | yes | yes | `GET /courses/{id}/flashcards` |
| Insights | no | needs `insights:view` | `GET /courses/{id}/insights`, `/gap-report` |
| Ask about this course | yes | yes | opens Chat with the course preselected |

- Show the **course name** at the top of this group so the user knows the context. Collapse the group (or remove it) when they leave the course.
- Course approval state (pending, changes requested, archived) is shown as text in the course header, not in the sidebar.
- Items the user's permissions do not allow are **not rendered**; do not show disabled items.

### 4.4 Admin
| Item | Route | API | Notes |
|---|---|---|---|
| Dashboard | `/admin` | see section 5.2 | Needs-attention summary |
| Users | `/admin/users` | `GET /admin/users` | Role, status, actions |
| Coach applications (count badge) | `/admin/coach-applications` | `GET /admin/coach-requests` | |
| Course approvals (count badge) | `/admin/course-approvals` | `GET /admin/courses/approval-queue` | |
| Courses | `/admin/courses` | `GET /courses`, `PATCH /admin/courses/{id}[/owner]` | Listing, reassign owner, archive. **Card-level only, no content** |
| Operations (expandable) | | | |
| ... Jobs | `/admin/operations/jobs` | `GET /admin/jobs`, `POST /admin/jobs/{id}/retry` | |
| ... Audit log | `/admin/operations/audit` | `GET /admin/audit-logs` | |
| ... AI executions | `/admin/operations/executions` | `GET /admin/executions` | Metadata only |
| ... Settings | `/admin/operations/settings` | `GET/PATCH /admin/config` | |

**Admin boundary (MUST):** the admin sidebar must **not** include Chat, History, Documents, or any other content view (decision R-6). Add a test for this.

### 4.5 Count badges (DERIVED, partly OPEN)
Badges are useful only when they are real status, so use them for **pending work**: coach applications, course approvals, and join requests.
- **Problem:** the API lists are cursor-paginated and return no total count.
- **Option 1 (no backend change):** fetch the first page with `limit=100` and show the count, capped as "99+". Refresh when the user acts on an item and on a slow interval.
- **Option 2 (backend request):** a small summary endpoint returning pending counts for the caller's role.
- Start with Option 1. Hide a badge when the count is zero. Log Option 2 in section 10.

---

## 5. Page-level fixes

### 5.1 Document library (screenshot A)
- **Breadcrumb** replaces "BACK TO COURSE": `Courses / Database Systems / Documents`.
- **Documents as a table, not a column of cards:** columns Name, Status, Size, Uploaded, Actions. Status shows an icon and text ("Ready", "Processing", "Failed"), never color alone. Keep the green only as a small accent on the status text/icon.
- **Upload area:** one primary action. Selecting a file should show its name and enable Upload; a disabled button next to "No file selected" teaches nothing. If a control is disabled, show why next to it (for example "Choose a file to upload").
- Keep the existing, useful notice "shared as course material", and show the size limit and accepted types (PDF, DOCX, TXT) in one short line. For learners, the scope choice (course vs personal note) is explicit.
- **Failed documents** show the safe error detail from `GET /documents/{id}/status` and a Retry button; **delete** needs a confirmation dialog that says it cannot be undone (decisions D-3 and D-4).
- Filters: keep the search and status filter, but state the limit once, briefly ("Filtering loaded documents"), and provide a "Load more" control. (Server-side filtering is not in the API; section 10.)

### 5.2 Admin dashboard (screenshot B)
- **Delete the four "Quick actions" cards.** Their destinations are now in the sidebar.
- Replace them with a **"Needs attention"** area using real data from existing endpoints:
  - Coach applications waiting (`GET /admin/coach-requests`, pending).
  - Courses awaiting approval (`GET /admin/courses/approval-queue`).
  - Jobs that need action (`GET /admin/jobs?status=dead` and `failed`).
- Present each as a compact row: count, one-line meaning, "Review" link. When all counts are zero, show one plain sentence ("Nothing needs attention right now."), not empty cards.
- Replace "Welcome, Administrator. Manage platform access and review system operations." with a plain title and no filler subtitle.
- Do **not** add content metrics (no document or conversation text; decision R-6).

### 5.3 Administration (screenshot C)
- **Remove the tab strip.** Each tab becomes its own sidebar route (section 4.4). Delete the generic "Administration" wrapper page.
- **Users page:** one table with a **Role** column and a role filter, instead of separate "Administrators (1)" / "Coaches (1)" groups.
  - Row actions in a single "Actions" menu per row, not three buttons repeated on every row.
  - For the signed-in admin's own row, **do not render** disabled actions; show a "You" tag. Drop the sentence "Your account cannot be changed here."
  - Role change, suspend and **erase** each need a confirmation dialog. Erase must state clearly that it is permanent and anonymises the account (privacy erasure).
  - Keep the "Search loaded users" box but say it filters only the loaded rows, with "Load more". (There is no search parameter in the API; section 10.)

### 5.4 Course and learner screens (apply the same rules)
When you reach other screens (course overview, quizzes, chat, history), apply sections 3 and 6 as well: breadcrumbs instead of "Back" links, sidebar for navigation, plain copy, flat layout.

---

## 6. AI design-tell audit (apply to the whole frontend)

The 15 items below come from the reference video's checklist, written here in short form, with what to look for in this project.

| # | Tell | Remedy | Seen in the screenshots? |
|---|---|---|---|
| 1 | Purple or indigo to blue gradients | Palette from the brand: one primary, one accent, real neutrals | Not seen. Navy is flat. Confirm in CSS |
| 2 | Inter / Geist / Roboto on everything | A heading typeface with character; simple readable body | **Likely.** The font looks like Inter or a similar system sans. Check the CSS |
| 3 | Gradient text | One solid color; emphasis through size and weight | Not seen |
| 4 | Pill badges above headlines ("Introducing", "New") | Delete, or put the info in the headline | Not seen. The status pills (Ready) are real status and are fine |
| 5 | Glowing halos and soft spotlights | Use spacing and contrast | Not seen |
| 6 | Glassmorphism (blur, glass cards, glow borders) | Remove unless it solves a real layering problem | Not seen |
| 7 | Icons in rounded squares above every heading | Icons beside the heading, or no container | Not seen yet. Do not introduce this in the sidebar |
| 8 | Grids of identical cards | Group related items; give important ones more space | **Yes:** admin "Quick actions" (section 5.2) and card-per-document (section 5.1) |
| 9 | Cards inside cards | Flatten with spacing, type and dividers | **Check:** the upload card and document cards; tables inside bordered cards |
| 10 | Thick colored side stripes on cards | Save for real alerts or status | Not seen. **Do not use one as the sidebar's active indicator** |
| 11 | Giant hero stats with no context | Show a number only if it explains something | Not seen. Keep the admin "Needs attention" counts small and meaningful |
| 12 | Tiny numbered labels (01, 02) when there is no sequence | Remove | Not seen |
| 13 | Pulsing dots, bouncy easing, hover zooms, auto-scrolling strips | Animate only when something actually changes | Check the CSS and transitions |
| 14 | Generic copy ("supercharge", "world-class") and em dashes | Say what the product does in plain words | **Mild:** "Welcome, Administrator. Manage platform access and review system operations." Review all UI strings |
| 15 | Beige/cream default with an oversized italic serif headline | Choose color and type for this product | Not seen. If you pick a serif heading font (section 7), do not set it in oversized italic |

**Extra findings that are not on that list (project-specific):**
- **ALL-CAPS navigation, tabs, buttons and links** ("BACK TO COURSE", "CHOOSE FILE", "CHANGE ROLE") are harder to read and add visual noise. Use sentence case.
- **Disabled controls with no explanation** (screenshots A and C). Hide what cannot apply; explain what is temporarily unavailable.
- **Repeated destinations:** the same place reachable from a top link, a tab and a card. One home per destination (the sidebar).
- **Overlapping names:** "Admin dashboard" vs "Administration" vs "Operations". Use the names in section 4.4.

**Other checks (from the same checklist):** related items sit close together; sections have clear space between them; **body text is 16px or larger**; **text contrast is at least 4.5:1** (3:1 for large text and UI component boundaries).

---

## 7. Visual direction (OPEN: confirm with the owner before restyling)

Per the checklist, if the audience and the feel are not already known, ask first. Proposed answers to confirm:

- **Who it is for:** learners studying course material, coaches managing courses, and an administrator operating the platform. People come here to get work done, not to be impressed.
- **How it should feel (DERIVED):** calm, clear, trustworthy, plain-spoken. Dense enough for tables and admin work, roomy enough for reading answers and citations.
- **Color:** keep the existing navy as the single primary (sidebar background or accent), add **one** accent for actions and focus, and keep real neutrals. No gradients. Do not rely on color alone for status.
- **Type:** a heading typeface with some character, plus a simple, readable body face at 16px or larger. OPEN: owner picks. Candidates to preview: Source Sans 3 (body) with Source Serif 4 or Bricolage Grotesque (headings). Self-host fonts, and do not default to Inter, Geist or Roboto.
- **Tokens:** define colors, spacing, type scale, radius and focus ring once as CSS variables (or the project's equivalent) and use them everywhere. Remove per-component hard-coded colors.
- **Motion:** only for state changes (drawer open/close, expand/collapse), short, with `prefers-reduced-motion` respected.

---

## 8. Implementation steps (one at a time, approval after each)

| Step | Deliverable |
|---|---|
| F0 | **Audit, no changes.** Inspect the frontend. Produce `docs/frontend/design-audit.md` listing **every instance** of each tell in section 6, with **file and line**, plus current nav entry points, fonts and colors in use, and measured contrast. Ask the owner the OPEN questions in section 7 and section 10 |
| F1 | Design tokens and base typography (after the owner approves direction) |
| F2 | App shell: sidebar, slim top bar, account menu, breadcrumbs, skip link, responsive drawer. Navigation driven by a **single config** (role, permission, route, label, icon) in its own file |
| F3 | Role navigation per section 4 (learner, coach, admin), including the course section group. Remove old top-bar links |
| F4 | Admin: split the tabbed Administration page into routes; Users table; replace the dashboard cards with "Needs attention" |
| F5 | Documents page (table, upload area, confirmations) |
| F6 | Sweep the remaining screens for section 6 findings and copy |
| F7 | **Re-check:** re-run the audit, list anything fixed, and report anything **kept on purpose** with the reason |

Optional helper: the video describes a free, open-source detector run with `npx impeccable detect .` after `npx impeccable install` and `/impeccable init`. **I could not verify this tool.** Use it only if you can run it and review what it reports; the manual audit in F0 is the required baseline.

---

## 9. Acceptance criteria and tests

Write Playwright tests (and axe-core checks) for the following.

**Navigation**
- For each role (learner, coach, admin) the sidebar shows exactly the items in section 4 and nothing else; items the user lacks permission for are absent.
- Admin sidebar contains no Chat, History or Documents entries.
- Inside a course, the course group appears with that course's name; leaving the course removes it.
- No top-bar primary navigation links remain; no admin "Quick actions" cards remain; the Administration tab strip is gone.
- Every destination has one nav entry only.

**Accessibility**
- Landmarks present (`nav` with labels, `main`); skip link works; `aria-current="page"` on the active item.
- Full keyboard operation of the sidebar, drawer (Escape closes it), account menu and confirmation dialogs; focus returns to the trigger on close.
- axe-core reports no contrast violations (4.5:1 for text) on the main screens at desktop and mobile widths.
- Computed body font size is at least 16px on content pages.
- No `text-transform: uppercase` on navigation, buttons or tabs.

**Responsive**
- At 1280, 900 and 390px widths: no horizontal scrolling, no overlapping elements, drawer works on the narrowest width.

**Design tells**
- Automated check: no `background-clip: text` gradient text, no `backdrop-filter` blur on cards, no gradient backgrounds using purple/indigo to blue, no `border-left` accent stripes on cards or nav items.
- Confirmation dialogs exist for erase, role change, suspend, and document delete, with the irreversible wording where it applies.

**Docs**
- `docs/frontend/design-audit.md` exists with file and line references, and the F7 re-check lists items kept on purpose.

---

## 10. Open questions and backend requests

| ID | Item | Recommendation |
|---|---|---|
| UI-1 | Visual direction (feel, accent color, heading typeface, icon set) | Confirm section 7 before F1 |
| UI-2 | Count badges: client-side first-page count (capped "99+") or a new summary endpoint | Start client-side; request the endpoint only if it proves slow |
| UI-3 | Server-side search/filter for `GET /admin/users` and `GET /courses/{id}/documents` (the API has only `limit` and `cursor`) | Optional backend request; until then, filter loaded rows and say so |
| UI-4 | Should coaches see the Chat and History items? (They can ask in their own courses) | Keep both, as in the current UI |
| UI-5 | Sidebar default state on tablets (icon rail vs hidden) | Icon rail |
| UI-6 | Admin "Courses" page scope | Listing, reassign owner, archive only; no content |
