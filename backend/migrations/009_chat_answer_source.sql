ALTER TABLE messages
  ADD COLUMN answer_source text
  CHECK (answer_source IN ('course_material', 'general_knowledge'));
