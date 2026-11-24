CREATE TABLE roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name IN ('learner', 'coach', 'admin')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  area text NOT NULL,
  description text
);

CREATE TABLE role_permissions (
  id uuid PRIMARY KEY,
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  UNIQUE (role_id, permission_id)
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  perms_version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'archived')),
  must_change_password boolean NOT NULL,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  erased_at timestamptz,
  pseudonym_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_permission_overrides (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  effect text NOT NULL CHECK (effect IN ('grant', 'revoke')),
  changed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_id)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  replaced_by_token_id uuid REFERENCES refresh_tokens(id)
);

CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens(family_id);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);

CREATE TABLE coach_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text
);

CREATE UNIQUE INDEX coach_requests_one_pending_per_user_idx
  ON coach_requests(user_id)
  WHERE status = 'pending';

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  before jsonb,
  after jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_id_idx ON audit_logs(actor_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);
