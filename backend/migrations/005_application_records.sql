CREATE TABLE application_records (
  collection_name text NOT NULL
    CHECK (collection_name ~ '^[a-z][a-z0-9_]*$'),
  id text NOT NULL,
  payload jsonb NOT NULL
    CHECK (jsonb_typeof(payload) = 'object')
    CHECK (payload->>'id' = id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_name, id)
);

CREATE INDEX application_records_collection_id_idx
  ON application_records(collection_name, id);

CREATE UNIQUE INDEX application_users_email_uq
  ON application_records((payload->>'email'))
  WHERE collection_name = 'users';

CREATE UNIQUE INDEX application_roles_name_uq
  ON application_records((payload->>'name'))
  WHERE collection_name = 'roles';

CREATE UNIQUE INDEX application_permissions_key_uq
  ON application_records((payload->>'key'))
  WHERE collection_name = 'permissions';

CREATE UNIQUE INDEX application_refresh_token_hash_uq
  ON application_records((payload->>'tokenHash'))
  WHERE collection_name = 'refresh_tokens';

CREATE UNIQUE INDEX application_coach_request_pending_uq
  ON application_records((payload->>'userId'))
  WHERE collection_name = 'coach_requests'
    AND payload->>'status' = 'pending';

CREATE UNIQUE INDEX application_feedback_message_user_uq
  ON application_records((payload->>'messageId'), (payload->>'userId'))
  WHERE collection_name = 'feedback';

CREATE UNIQUE INDEX application_activity_dedupe_uq
  ON application_records((payload->>'dedupeKey'))
  WHERE collection_name = 'activity_events';
