import type { EquipmentStatus, ScanAction } from './supabase';

export const STATUS_META: Record<
  EquipmentStatus,
  { label: string; color: string; bg: string; dot: string; icon: string }
> = {
  available: {
    label: 'Available',
    color: '#16a34a',
    bg: 'rgba(22,163,74,0.10)',
    dot: '#22c55e',
    icon: 'M9 12l2 2 4-4',
  },
  in_use: {
    label: 'In Use',
    color: '#ca8a04',
    bg: 'rgba(202,138,4,0.10)',
    dot: '#eab308',
    icon: 'M12 8v4l3 3',
  },
  fault: {
    label: 'Fault',
    color: '#dc2626',
    bg: 'rgba(220,38,38,0.10)',
    dot: '#ef4444',
    icon: 'M12 9v4m0 4h.01',
  },
  maintenance: {
    label: 'Maintenance',
    color: '#2563eb',
    bg: 'rgba(37,99,235,0.10)',
    dot: '#3b82f6',
    icon: 'M11 5h2m-2 4h2m-2 4h2',
  },
};

export const ACTION_META: Record<ScanAction, { label: string; color: string }> = {
  scanned: { label: 'Scanned', color: '#64748b' },
  in_use: { label: 'In Use', color: '#ca8a04' },
  returned: { label: 'Returned', color: '#16a34a' },
  fault: { label: 'Fault', color: '#dc2626' },
  maintenance: { label: 'Maintenance', color: '#2563eb' },
  unknown_tag: { label: 'Unknown Tag', color: '#7c3aed' },
  no_pending_request: { label: 'No Pending Request', color: '#64748b' },
  approval_failed: { label: 'Approval Failed', color: '#dc2626' },
  borrow_approved: { label: 'Borrow Approved', color: '#16a34a' },
  return_failed: { label: 'Return Failed', color: '#dc2626' },
  blocked_scan: { label: 'Blocked', color: '#ca8a04' },
  return_pending_admin: { label: 'Return Awaiting Admin', color: '#ca8a04' },
};

export function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
