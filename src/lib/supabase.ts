import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL as string;
const supabasePublishableKey =
  ((import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  ((import.meta as any).env.VITE_SUPABASE_ANON_KEY as string | undefined);

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  realtime: { params: { eventsPerSecond: 10 } },
});

export type EquipmentStatus = 'available' | 'in_use' | 'fault' | 'maintenance';
export type ScanAction =
  | 'scanned'
  | 'in_use'
  | 'returned'
  | 'fault'
  | 'maintenance'
  | 'unknown_tag'
  | 'no_pending_request'
  | 'approval_failed'
  | 'borrow_approved'
  | 'return_failed'
  | 'blocked_scan'
  | 'return_pending_admin';
export type UserRole = 'user' | 'admin';
export type BorrowStatus = 'pending' | 'approved' | 'returned';

export interface Equipment {
  id: string;
  rfid_uid: string;
  name: string;
  description: string | null;
  status: EquipmentStatus;
  last_scanned_at: string | null;
  last_scanned_by_device: string | null;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  device_name: string;
  location: string | null;
  firmware_version: string | null;
  last_seen: string | null;
  created_at: string;
}

export interface ScanLog {
  id: string;
  equipment_id: string | null;
  rfid_uid: string;
  action: ScanAction;
  device_id: string | null;
  device_timestamp: string | null;
  created_at: string;
}

export interface ScanLogWithRelations extends ScanLog {
  equipment: { name: string; rfid_uid: string } | null;
  devices: { device_name: string; location: string | null } | null;
}

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export interface Borrow {
  id: string;
  user_id: string | null;
  rfid_uid: string;
  item_name: string;
  full_name: string | null;
  student_number: string | null;
  return_date: string;
  status: BorrowStatus;
  created_at: string;
  profiles?: { display_name: string; email: string } | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  borrow_id: string | null;
  recipient_email: string | null;
  is_read: boolean;
  created_at: string;
}
