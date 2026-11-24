CREATE TABLE courses (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  lessons jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(lessons) = 'array'),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'changes_requested')),
  approval_note text CHECK (
    approval_note IS NULL OR char_length(approval_note) <= 1000
  ),
  approval_requested_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX courses_owner_id_idx ON courses(owner_id);
CREATE INDEX courses_status_idx ON courses(status);
CREATE INDEX courses_pending_approval_idx
  ON courses(approval_requested_at)
  WHERE approval_status = 'pending';

CREATE TABLE enrolments (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text CHECK (
    decision_note IS NULL OR char_length(decision_note) <= 1000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

CREATE INDEX enrolments_course_status_idx ON enrolments(course_id, status);
CREATE INDEX enrolments_user_status_idx ON enrolments(user_id, status);
