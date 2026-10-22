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
  v_borrow_created_at timestamptz;
BEGIN
  SELECT rfid_uid, created_at
  INTO v_rfid_uid, v_borrow_created_at
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.scan_logs
    WHERE rfid_uid = v_rfid_uid
      AND action = 'return_pending_admin'
      AND created_at >= v_borrow_created_at
  ) THEN
    RETURN jsonb_build_object(
      'returned', false,
      'error', 'Scan the equipment RFID tag before confirming its return'
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

  PERFORM set_config(
    'app.admin_equipment_return',
    v_equipment_id::text,
    true
  );

  UPDATE public.equipment
  SET status = 'available'
  WHERE id = v_equipment_id;

  PERFORM set_config('app.admin_equipment_return', '', true);
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
