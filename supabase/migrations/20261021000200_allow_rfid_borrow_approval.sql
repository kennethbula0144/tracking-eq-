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

CREATE OR REPLACE FUNCTION public.approve_borrow_request(
  p_request_id uuid,
  p_rfid_uid text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_equipment_id uuid;
BEGIN
  PERFORM 1
  FROM public.borrows
  WHERE id = p_request_id
    AND rfid_uid = p_rfid_uid
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'approved', false,
      'error', 'Pending borrow request not found'
    );
  END IF;

  SELECT id
  INTO v_equipment_id
  FROM public.equipment
  WHERE rfid_uid = p_rfid_uid
    AND status = 'available'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'approved', false,
      'error', 'Equipment is not available'
    );
  END IF;

  UPDATE public.equipment
  SET status = 'in_use'
  WHERE id = v_equipment_id;

  PERFORM set_config(
    'app.rfid_borrow_approval',
    p_request_id::text,
    true
  );

  UPDATE public.borrows
  SET status = 'approved'
  WHERE id = p_request_id;

  PERFORM set_config('app.rfid_borrow_approval', '', true);

  RETURN jsonb_build_object(
    'approved', true,
    'request_id', p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_borrow_request(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_borrow_request(uuid, text)
  TO anon;

NOTIFY pgrst, 'reload schema';
