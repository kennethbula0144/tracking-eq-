CREATE OR REPLACE FUNCTION public.enforce_admin_borrow_status_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND current_setting('app.rfid_borrow_approval', true)
      IS DISTINCT FROM NEW.id::text
    AND current_setting('app.admin_borrow_return', true)
      IS DISTINCT FROM NEW.id::text
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    )
  THEN
    RAISE EXCEPTION 'Only admins can change borrow status';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_borrow_returned(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rfid_uid text;
  v_equipment_id uuid;
BEGIN
  SELECT rfid_uid
  INTO v_rfid_uid
  FROM public.borrows
  WHERE id = p_request_id
    AND status = 'approved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'returned', false,
      'error', 'Approved borrow request not found'
    );
  END IF;

  SELECT id
  INTO v_equipment_id
  FROM public.equipment
  WHERE rfid_uid = v_rfid_uid
    AND status = 'in_use'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'returned', false,
      'error', 'Equipment is not currently marked in use'
    );
  END IF;

  UPDATE public.equipment
  SET status = 'available'
  WHERE id = v_equipment_id;

  PERFORM set_config(
    'app.admin_borrow_return',
    p_request_id::text,
    true
  );

  UPDATE public.borrows
  SET status = 'returned'
  WHERE id = p_request_id;

  PERFORM set_config('app.admin_borrow_return', '', true);

  RETURN jsonb_build_object(
    'returned', true,
    'request_id', p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_borrow_returned(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_borrow_returned(uuid)
  TO anon;

NOTIFY pgrst, 'reload schema';
