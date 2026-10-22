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
      'blocked_scan'
    )
  );
