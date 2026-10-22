ALTER TABLE public.borrows
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS student_number text;

-- Keep legacy rows backward compatible while requiring the fields in the app form.
-- Existing records may be null until the borrower submits updated information.
