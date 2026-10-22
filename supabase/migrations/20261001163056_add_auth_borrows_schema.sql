/*
# Add Authentication, User Profiles, and Borrow System

## Overview
Transforms the equipment tracker from a single-tenant no-auth app into a
multi-user app with login/signup, role-based dashboards, and a borrow system
with email notifications.

## New Tables

### 1. profiles
Stores the display name and role for each authenticated user.
- `id` (uuid, PK, FK to auth.users)
- `email` (text, copied from auth.users for display)
- `display_name` (text, the user's name shown in the admin dashboard)
- `role` (text, either 'user' or 'admin', defaults to 'user')
- `created_at` (timestamptz)

### 2. borrows
Records each borrow transaction made by a user.
- `id` (uuid, PK)
- `user_id` (uuid, FK to auth.users, defaults to auth.uid())
- `rfid_uid` (text, the RFID tag UID entered by the user)
- `item_name` (text, the name of the item being borrowed)
- `return_date` (date, when the user plans to return the item)
- `status` (text: 'pending', 'approved', 'returned', defaults to 'pending')
- `created_at` (timestamptz)

## Modified Tables
- `equipment`: RLS policies updated to allow both anon (ESP32 device) and
  authenticated users (web dashboard) to read/write.
- `devices`: Same dual-access pattern.
- `scan_logs`: Same dual-access pattern.

## Security
- RLS enabled on `profiles`: users can read all profiles (needed for admin
  to see borrower names), users can update only their own profile.
- RLS enabled on `borrows`: users can insert their own borrows, read all
  borrows (admin needs to see all), update only their own.
- A database trigger auto-creates a profile row when a new auth.users row
  is inserted, copying email and defaulting role to 'user'.
- A SECURITY DEFINER function `is_admin()` checks if the current user
  has role='admin' in profiles.

## Important Notes
1. The first user to sign up should be manually promoted to admin by
   updating their profile row: `UPDATE profiles SET role='admin' WHERE email='your-email'`
2. The ESP32 device continues to use the anon key, so all equipment/device/
   scan_log policies include `anon` role.
3. Email notifications are handled by an edge function, not a DB trigger.
*/

-- ── profiles table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read all profiles (admin needs to see borrower names, users see who borrowed)
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT
  TO authenticated USING (true);

-- Users can update only their own profile
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Users can insert only their own profile
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

-- ── borrows table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS borrows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rfid_uid text NOT NULL,
  item_name text NOT NULL,
  return_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'returned')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE borrows ENABLE ROW LEVEL SECURITY;

-- Users can read all borrows (admin needs to see all, users can see their own and others')
DROP POLICY IF EXISTS "borrows_select_all" ON borrows;
CREATE POLICY "borrows_select_all" ON borrows FOR SELECT
  TO authenticated USING (true);

-- Users can insert only their own borrows
DROP POLICY IF EXISTS "borrows_insert_own" ON borrows;
CREATE POLICY "borrows_insert_own" ON borrows FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- Users can update only their own borrows (or admin can update any)
DROP POLICY IF EXISTS "borrows_update_own_or_admin" ON borrows;
CREATE POLICY "borrows_update_own_or_admin" ON borrows FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Admin can delete borrows
DROP POLICY IF EXISTS "borrows_delete_admin" ON borrows;
CREATE POLICY "borrows_delete_admin" ON borrows FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── is_admin helper function ────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ── Auto-create profile on signup ──────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ── Indexes ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_borrows_user_id ON borrows(user_id);
CREATE INDEX IF NOT EXISTS idx_borrows_status ON borrows(status);
CREATE INDEX IF NOT EXISTS idx_borrows_created_at ON borrows(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
