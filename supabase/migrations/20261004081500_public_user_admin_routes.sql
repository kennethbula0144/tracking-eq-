-- Public /user and /admin pages use the Supabase anon role.
-- The admin page is intentionally not access-controlled by this migration.

ALTER TABLE public.borrows
  ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "borrows_public_select" ON public.borrows;
CREATE POLICY "borrows_public_select" ON public.borrows
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "borrows_public_insert" ON public.borrows;
CREATE POLICY "borrows_public_insert" ON public.borrows
  FOR INSERT TO anon WITH CHECK (user_id IS NULL);

DROP POLICY IF EXISTS "borrows_public_update" ON public.borrows;
CREATE POLICY "borrows_public_update" ON public.borrows
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.borrows TO anon;

DROP POLICY IF EXISTS "notifications_public_select" ON public.notifications;
CREATE POLICY "notifications_public_select" ON public.notifications
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "notifications_public_update" ON public.notifications;
CREATE POLICY "notifications_public_update" ON public.notifications
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON public.notifications TO anon;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.borrows, public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
