-- Fix profile creation for auth.user signups.
-- The original trigger is prone to failing when the insert is evaluated under
-- the auth session policy context. This migration keeps the trigger but adds an
-- explicit system-role insert policy and updates the profile row instead of
-- failing when the user already exists.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1), ''),
    'user'
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
      role = COALESCE(profiles.role, EXCLUDED.role);

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "profiles_insert_system" ON public.profiles;
CREATE POLICY "profiles_insert_system" ON public.profiles
  FOR INSERT TO postgres, service_role WITH CHECK (true);

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
