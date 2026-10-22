CREATE OR REPLACE FUNCTION public.admin_change_equipment_status(
  p_equipment_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_status text;
  v_rfid_uid text;
  v_borrow_id uuid;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('available', 'fault', 'maintenance') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'error', 'Choose Available, Fault, or Maintenance'
    );
  END IF;

  SELECT status::text, rfid_uid
  INTO v_current_status, v_rfid_uid
  FROM public.equipment
  WHERE id = p_equipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'error', 'Equipment not found'
    );
  END IF;

  IF v_current_status = p_status THEN
    RETURN jsonb_build_object('updated', true);
  END IF;

  IF v_current_status = 'in_use' AND p_status = 'available' THEN
    SELECT id
    INTO v_borrow_id
    FROM public.borrows
    WHERE rfid_uid = v_rfid_uid
      AND status = 'approved'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  PERFORM set_config('app.admin_equipment_return', p_equipment_id::text, true);

  UPDATE public.equipment
  SET status = p_status
  WHERE id = p_equipment_id;

  PERFORM set_config('app.admin_equipment_return', '', true);

  IF v_borrow_id IS NOT NULL THEN
    PERFORM set_config('app.admin_borrow_return', v_borrow_id::text, true);

    UPDATE public.borrows
    SET status = 'returned'
    WHERE id = v_borrow_id;

    PERFORM set_config('app.admin_borrow_return', '', true);
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'status', p_status,
    'borrow_returned', v_borrow_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_change_equipment_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_equipment_status(uuid, text)
  TO anon;

NOTIFY pgrst, 'reload schema';
