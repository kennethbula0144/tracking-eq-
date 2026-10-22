DELETE FROM public.notifications older
USING public.notifications newer
WHERE older.borrow_id IS NOT NULL
  AND older.borrow_id = newer.borrow_id
  AND (
    older.created_at < newer.created_at
    OR (older.created_at = newer.created_at AND older.id < newer.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_borrow_id_unique
  ON public.notifications(borrow_id);

CREATE OR REPLACE FUNCTION public.create_borrow_request_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (
    type,
    title,
    message,
    borrow_id
  )
  VALUES (
    'borrow_request',
    'New borrow request: ' || NEW.item_name,
    COALESCE(NEW.full_name, 'A user') || ' requested to borrow ' ||
      NEW.item_name || ' (UID: ' || NEW.rfid_uid || '), return by ' ||
      NEW.return_date::text,
    NEW.id
  )
  ON CONFLICT (borrow_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_borrow_request_notification ON public.borrows;
CREATE TRIGGER trg_borrow_request_notification
  AFTER INSERT ON public.borrows
  FOR EACH ROW
  EXECUTE FUNCTION public.create_borrow_request_notification();

INSERT INTO public.notifications (type, title, message, borrow_id)
SELECT
  'borrow_request',
  'New borrow request: ' || b.item_name,
  COALESCE(b.full_name, 'A user') || ' requested to borrow ' ||
    b.item_name || ' (UID: ' || b.rfid_uid || '), return by ' ||
    b.return_date::text,
  b.id
FROM public.borrows b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.notifications n
  WHERE n.borrow_id = b.id
)
ON CONFLICT (borrow_id) DO NOTHING;

DROP POLICY IF EXISTS "notifications_public_select" ON public.notifications;
CREATE POLICY "notifications_public_select" ON public.notifications
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "notifications_public_update" ON public.notifications;
CREATE POLICY "notifications_public_update" ON public.notifications
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_public_delete" ON public.notifications;
CREATE POLICY "notifications_public_delete" ON public.notifications
  FOR DELETE TO anon USING (true);

GRANT SELECT, UPDATE, DELETE ON public.notifications TO anon;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
