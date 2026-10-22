CREATE OR REPLACE FUNCTION public.set_device_last_seen_to_server_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_seen := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_devices_server_last_seen ON public.devices;
CREATE TRIGGER trg_devices_server_last_seen
  BEFORE INSERT OR UPDATE OF last_seen ON public.devices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_device_last_seen_to_server_time();
