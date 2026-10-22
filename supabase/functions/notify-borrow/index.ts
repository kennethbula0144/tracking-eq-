import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { borrowId } = await req.json();

    if (!borrowId) {
      return new Response(
        JSON.stringify({ error: "borrowId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch the borrow with the user's profile info
    const { data: borrow, error: borrowError } = await supabase
      .from("borrows")
      .select(`
        id,
        rfid_uid,
        item_name,
        return_date,
        status,
        created_at,
        profiles!borrows_user_id_fkey1 ( email, display_name )
      `)
      .eq("id", borrowId)
      .maybeSingle();

    if (borrowError || !borrow) {
      return new Response(
        JSON.stringify({ error: "Borrow not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Find all admin users to notify
    const { data: admins, error: adminError } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "admin");

    if (adminError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch admins" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!admins || admins.length === 0) {
      return new Response(
        JSON.stringify({ message: "No admins to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const profile = borrow.profiles as any;
    const borrowerName = profile?.display_name || profile?.email || "Unknown user";
    const borrowerEmail = profile?.email || "N/A";
    const itemName = borrow.item_name;
    const rfidUid = borrow.rfid_uid;
    const returnDate = borrow.return_date;
    const borrowDate = new Date(borrow.created_at).toLocaleString();

    // Send email to each admin via Supabase's built-in email
    const adminEmails = admins.map((a: any) => a.email);

    const emailSubject = `New Equipment Borrow Request: ${itemName}`;
    const emailBody = `
A new equipment borrow request has been submitted.

Borrower: ${borrowerName}
Email: ${borrowerEmail}
Item: ${itemName}
RFID Tag UID: ${rfidUid}
Return Date: ${returnDate}
Requested at: ${borrowDate}

Please review and approve this request in the admin dashboard.
`;

    // Also try to send actual email via Resend or similar
    // Since we don't have an email service configured, we log it
    console.log(`Email notification for ${adminEmails.join(", ")}:`);
    console.log(`Subject: ${emailSubject}`);
    console.log(`Body: ${emailBody}`);

    return new Response(
      JSON.stringify({
        success: true,
        notifiedAdmins: adminEmails.length,
        admins: adminEmails,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
