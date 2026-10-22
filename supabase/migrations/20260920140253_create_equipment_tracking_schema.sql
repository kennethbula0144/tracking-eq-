/*
# Equipment Tracking System Schema

## Overview
Creates the database tables for an IoT equipment tracking system.
An ESP32-S3 device with an MFRC522 RFID reader scans equipment tags and
sends scan events to Supabase. A web dashboard displays equipment status
and scan history in real time. This is a single-tenant app with no
sign-in screen — the device and dashboard both use the anon key.

## New Tables

### 1. devices
Registers each physical ESP32-S3 controller that can send scans.
- `id` (uuid, primary key)
- `device_name` (text, human-friendly name e.g. "Workshop Controller")
- `location` (text, where the device is installed)
- `firmware_version` (text, optional)
- `last_seen` (timestamptz, updated on each scan/heartbeat)
- `created_at` (timestamptz)

### 2. equipment
Each piece of tracked equipment, identified by its RFID tag UID.
- `id` (uuid, primary key)
- `rfid_uid` (text, unique — the UID string from the MFRC522)
- `name` (text, equipment name e.g. "Circular Saw")
- `description` (text, optional details)
- `status` (text, one of: available | in_use | fault | maintenance)
- `last_scanned_at` (timestamptz, updated on each scan)
- `last_scanned_by_device` (uuid, FK to devices, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz, auto-updated via trigger)

### 3. scan_logs
Every RFID scan event, creating an audit trail.
- `id` (uuid, primary key)
- `equipment_id` (uuid, FK to equipment, nullable — nullable so
  scans of unknown tags are still logged)
- `rfid_uid` (text, the raw UID scanned)
- `action` (text, one of: scanned | in_use | returned | fault | maintenance | unknown_tag)
- `device_id` (uuid, FK to devices)
- `device_timestamp` (timestamptz, timestamp from the DS3231 RTC on the device)
- `created_at` (timestamptz, server receive time)

## Security
- RLS enabled on all tables.
- All policies use `TO anon, authenticated` because this is a
  single-tenant app with no sign-in screen — the ESP32 device and
  the web dashboard both operate with the anon key and need full CRUD.
- `USING (true)` / `WITH CHECK (true)` is acceptable here because
  the data is intentionally shared across the device and dashboard.

## Indexes
- `equipment.rfid_uid` — unique index for fast tag lookups
- `equipment.status` — for dashboard filtering
- `scan_logs.equipment_id` — for history lookups
- `scan_logs.device_id` — for per-device queries
- `scan_logs.created_at` — for chronological ordering
*/

-- ── devices ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name text NOT NULL,
  location text,
  firmware_version text,
  last_seen timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_devices" ON devices;
CREATE POLICY "anon_select_devices" ON devices FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_devices" ON devices;
CREATE POLICY "anon_insert_devices" ON devices FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_devices" ON devices;
CREATE POLICY "anon_update_devices" ON devices FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_devices" ON devices;
CREATE POLICY "anon_delete_devices" ON devices FOR DELETE
  TO anon, authenticated USING (true);

-- ── equipment ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfid_uid text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'in_use', 'fault', 'maintenance')),
  last_scanned_at timestamptz,
  last_scanned_by_device uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_equipment" ON equipment;
CREATE POLICY "anon_select_equipment" ON equipment FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_equipment" ON equipment;
CREATE POLICY "anon_insert_equipment" ON equipment FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_equipment" ON equipment;
CREATE POLICY "anon_update_equipment" ON equipment FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_equipment" ON equipment;
CREATE POLICY "anon_delete_equipment" ON equipment FOR DELETE
  TO anon, authenticated USING (true);

-- ── scan_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid REFERENCES equipment(id) ON DELETE SET NULL,
  rfid_uid text NOT NULL,
  action text NOT NULL
    CHECK (action IN ('scanned', 'in_use', 'returned', 'fault', 'maintenance', 'unknown_tag')),
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  device_timestamp timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_scan_logs" ON scan_logs;
CREATE POLICY "anon_select_scan_logs" ON scan_logs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_scan_logs" ON scan_logs;
CREATE POLICY "anon_insert_scan_logs" ON scan_logs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_scan_logs" ON scan_logs;
CREATE POLICY "anon_update_scan_logs" ON scan_logs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_scan_logs" ON scan_logs;
CREATE POLICY "anon_delete_scan_logs" ON scan_logs FOR DELETE
  TO anon, authenticated USING (true);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_rfid_uid ON equipment(rfid_uid);
CREATE INDEX IF NOT EXISTS idx_scan_logs_equipment_id ON scan_logs(equipment_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_device_id ON scan_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs(created_at DESC);

-- ── updated_at trigger for equipment ──────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_updated_at ON equipment;
CREATE TRIGGER trg_equipment_updated_at
  BEFORE UPDATE ON equipment
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable the realtime subscriptions used by the dashboard.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE equipment, devices, scan_logs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;