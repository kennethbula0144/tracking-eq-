DROP POLICY IF EXISTS "notifications_public_delete" ON public.notifications;
CREATE POLICY "notifications_public_delete" ON public.notifications
  FOR DELETE TO anon USING (true);

GRANT DELETE ON public.notifications TO anon;
