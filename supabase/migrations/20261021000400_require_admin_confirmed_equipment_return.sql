ALTER TABLE public.scan_logs
  DROP CONSTRAINT IF EXISTS scan_logs_action_check;

ALTER TABLE public.scan_logs
  ADD CONSTRAINT scan_logs_action_check
  CHECK (
    action IN (
      'scanned',
      'in_use',
      'returned',
      'fault',
      'maintenance',
      'unknown_tag',
      'no_pending_request',
      'approval_failed',
      'borrow_approved',
      'return_failed',
      'blocked_scan',
      'return_pending_admin'
    )
  );

CREATE OR REPLACE FUNCTION public.require_admin_confirmed_equipment_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'in_use'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND current_setting('app.admin_equipment_return', true)
      IS DISTINCT FROM OLD.id::text
  THEN
    RAISE EXCEPTION 'Mark the approved borrow as returned in the admin dashboard first';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_admin_confirmed_equipment_return
  ON public.equipment;
CREATE TRIGGER trg_require_admin_confirmed_equipment_return
  BEFORE UPDATE OF status ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.require_admin_confirmed_equipment_return();

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
