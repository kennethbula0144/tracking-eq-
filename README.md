# Equipment Tracker

RFID equipment monitoring dashboard backed by Supabase realtime data.

## Supabase setup

The browser and ESP32 use the publishable key only. Never put the Supabase secret key in this frontend or firmware.

1. Apply the SQL files in `supabase/migrations` in timestamp order.
2. Keep the project values in `.env.local`:

```env
VITE_SUPABASE_URL=https://sweycjqoubrjykgvhisf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
```

3. Start the app with `npm run dev`. The user page is at `/user`; the admin page is at `/admin`.
4. Configure production hosting to serve `index.html` for both `/user` and `/admin`.
5. Set the same project URL and publishable key in `firmware/equipment_tracker.ino`, then configure Wi-Fi before flashing the ESP32.

The ESP32 LCD periodically shows pending borrower requests (borrower, item, and RFID UID). Scan the UID shown for a request to approve that pending request; scanning an unrelated tag continues through the equipment-tracking flow. The LCD rotates through up to eight pending requests, while UID scans can approve any matching pending request. RFID approval requires the `20261021000000_add_atomic_borrow_approval.sql`, `20261021000100_add_firmware_scan_actions.sql`, and `20261021000200_allow_rfid_borrow_approval.sql` migrations and the latest firmware. An RFID scan of equipment in use only records that the return was presented; the item remains in use until an admin marks its approved borrow returned. The dashboard return action and database enforcement require the `20261021000300_add_admin_mark_returned_rpc.sql` and `20261021000400_require_admin_confirmed_equipment_return.sql` migrations. Apply migrations to the same Supabase project used by the app and firmware.

The latest migration allows anonymous borrow requests and dashboard actions. **Both pages are public. Anyone who visits `/admin` can view and modify equipment, borrow requests, and notifications.** Do not use this configuration for sensitive or production data without adding server-side admin authentication and authorization.
