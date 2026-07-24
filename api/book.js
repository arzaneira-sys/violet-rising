// Vercel serverless function — receives a booking and emails the details.
// Env vars (set in Vercel project settings):
//   RESEND_API_KEY  – Resend API key (send-capable)
//   BOOKING_TO      – inbox that receives booking notifications
//   BOOKING_FROM    – verified sender, e.g. "Violet Rising <bookings@violetrising.co.uk>"
//                     (falls back to Resend sandbox sender until the domain is verified)

const RESEND_URL = 'https://api.resend.com/emails';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ownerEmailHtml(b) {
  const row = (label, val) =>
    `<tr><td style="padding:8px 14px;color:#7b6b8f;font-size:13px;white-space:nowrap">${label}</td>
     <td style="padding:8px 14px;color:#1a0a2e;font-size:14px;font-weight:600">${esc(val) || '—'}</td></tr>`;
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;border:1px solid #e9d5ff;border-radius:8px;overflow:hidden">
    <div style="background:#1a0a2e;padding:22px 26px">
      <p style="margin:0;color:#c9a84c;font-size:11px;letter-spacing:3px;text-transform:uppercase">Violet Rising</p>
      <h1 style="margin:6px 0 0;color:#f5f0ff;font-size:22px;font-weight:400">✦ New booking request</h1>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#faf7ff">
      ${row('Service', b.service)}
      ${row('Date', b.dateLabel)}
      ${row('Time', b.time ? b.time + ' (UK time)' : '')}
      ${row('Price', b.price)}
      ${row('Name', b.name)}
      ${row('Email', b.email)}
      ${row('Found via', b.source)}
      ${row('Intention', b.intention)}
    </table>
    <div style="padding:16px 26px;background:#f3ecff">
      <p style="margin:0;color:#3d1f6b;font-size:13px">Reply to this email to reach ${esc(b.name)} directly with payment details.</p>
    </div>
  </div>`;
}

function clientEmailHtml(b) {
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;border:1px solid #e9d5ff;border-radius:8px;overflow:hidden">
    <div style="background:#1a0a2e;padding:26px;text-align:center">
      <p style="margin:0;color:#c9a84c;font-size:11px;letter-spacing:3px;text-transform:uppercase">Violet Rising</p>
      <h1 style="margin:8px 0 0;color:#f5f0ff;font-size:24px;font-weight:400">✦ Your booking request is received</h1>
    </div>
    <div style="padding:26px;background:#faf7ff;color:#3d1f6b;font-size:14px;line-height:1.8">
      <p>Dear ${esc(b.name.split(' ')[0])},</p>
      <p>Thank you for booking with Violet Rising. Here is what you requested:</p>
      <p style="background:#f3ecff;padding:14px 18px;border-left:3px solid #c9a84c">
        <strong>${esc(b.service)}</strong><br>
        ${esc(b.dateLabel)} at ${esc(b.time)} (UK time)<br>
        ${esc(b.price)}
      </p>
      <p>Violet will confirm your session and send payment details to this email address shortly. Your slot is secured once payment is complete.</p>
      <p>Until then — prepare a quiet, private space, and come with an open heart.</p>
      <p style="color:#7b4fa0">✦ Violet Rising · Tarot · Manifestation · Transformation</p>
    </div>
  </div>`;
}

async function sendEmail(apiKey, payload) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const toOwner = process.env.BOOKING_TO;
  const from = process.env.BOOKING_FROM || 'Violet Rising <onboarding@resend.dev>';
  if (!apiKey || !toOwner) {
    return res.status(500).json({ error: 'Booking system is not configured yet.' });
  }

  const b = req.body || {};
  // honeypot — bots fill every field; humans never see this one
  if (b.website) return res.status(200).json({ ok: true });

  const required = { service: b.service, dateLabel: b.dateLabel, time: b.time, name: b.name, email: b.email };
  for (const [k, v] of Object.entries(required)) {
    if (!v || typeof v !== 'string' || v.length > 300) {
      return res.status(400).json({ error: `Missing or invalid field: ${k}` });
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  const booking = {
    service: b.service,
    dateLabel: b.dateLabel,
    time: b.time,
    price: String(b.price || '').slice(0, 40),
    name: b.name.slice(0, 120),
    email: b.email,
    intention: String(b.intention || '').slice(0, 2000),
    source: String(b.source || '').slice(0, 100),
  };

  // 1) Notify Violet — this one must succeed for the booking to count
  const owner = await sendEmail(apiKey, {
    from,
    to: [toOwner],
    reply_to: booking.email,
    subject: `✦ New booking: ${booking.service} — ${booking.dateLabel} ${booking.time} (${booking.name})`,
    html: ownerEmailHtml(booking),
    text: `New booking request\n\nService: ${booking.service}\nDate: ${booking.dateLabel}\nTime: ${booking.time} (UK time)\nPrice: ${booking.price}\nName: ${booking.name}\nEmail: ${booking.email}\nFound via: ${booking.source || '—'}\nIntention: ${booking.intention || '—'}\n\nReply to this email to send payment details.`,
  });

  if (!owner.ok) {
    console.error('Owner notification failed:', owner.status, JSON.stringify(owner.body));
    return res.status(502).json({ error: 'Could not submit booking. Please try again or email us directly.' });
  }

  // 2) Confirmation to the client — best-effort (fails in sandbox mode until domain is verified)
  const client = await sendEmail(apiKey, {
    from,
    to: [booking.email],
    subject: `✦ Violet Rising — booking request received: ${booking.service}`,
    html: clientEmailHtml(booking),
    text: `Dear ${booking.name},\n\nThank you for booking with Violet Rising.\n\n${booking.service}\n${booking.dateLabel} at ${booking.time} (UK time)\n${booking.price}\n\nViolet will confirm your session and send payment details to this email shortly.\n\n✦ Violet Rising`,
  });
  if (!client.ok) {
    console.warn('Client confirmation not sent:', client.status, JSON.stringify(client.body));
  }

  return res.status(200).json({ ok: true, clientEmailSent: client.ok });
};
