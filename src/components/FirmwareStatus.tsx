import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type FirmwareState = 'checking' | 'online' | 'offline' | 'unavailable';

const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;
const FUTURE_CLOCK_TOLERANCE_MS = 30 * 1000;
const REFRESH_INTERVAL_MS = 15 * 1000;
const DEVICE_NAME = 'Workshop Controller';

export default function FirmwareStatus() {
  const [status, setStatus] = useState<FirmwareState>('checking');

  useEffect(() => {
    let active = true;

    const refreshStatus = async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('last_seen')
        .eq('device_name', DEVICE_NAME)
        .not('last_seen', 'is', null)
        .order('last_seen', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.error('Failed to check firmware heartbeat:', error.message);
        setStatus('unavailable');
        return;
      }

      const lastSeen = data?.last_seen ? new Date(data.last_seen).getTime() : 0;
      const age = Date.now() - lastSeen;
      setStatus(
        lastSeen > 0 &&
          age >= -FUTURE_CLOCK_TOLERANCE_MS &&
          age <= HEARTBEAT_TIMEOUT_MS
          ? 'online'
          : 'offline',
      );
    };

    void refreshStatus();

    const channel = supabase
      .channel('firmware-heartbeat-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => {
        void refreshStatus();
      })
      .subscribe();

    const refreshInterval = window.setInterval(() => {
      void refreshStatus();
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, []);

  const label = {
    checking: 'Checking Firmware…',
    online: 'Firmware Online',
    offline: 'Firmware Offline',
    unavailable: 'Firmware Status Unavailable',
  }[status];

  return (
    <div className={`connection-badge firmware-status ${status}`} role="status" aria-live="polite">
      <span className="pulse" />
      {label}
    </div>
  );
}
