import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/server';
import { applyResendEvent, type ResendEmailEvent } from '@/lib/resend-webhook';

/**
 * Resend webhook: delivery, bounce, open and click events for the meeting email log (lib/resend-webhook has the rules).
 *
 * Every request must carry a valid signature over the RAW body (Standard Webhooks, as Resend signs them: svix-* or
 * webhook-* headers); with no RESEND_WEBHOOK_SECRET the route refuses everything (503) rather than trusting unsigned
 * events. A database error answers 500 so Resend retries; each write only moves forward, so a retry is safe.
 *
 * Resend → Webhooks → endpoint https://www.troop-79.com/api/resend/webhook, events:
 *   email.delivered, email.opened, email.clicked, email.bounced
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'Email events are not configured.' }, { status: 503 });
  // A secret that isn't Resend's whsec_<base64> would fail every signature as "invalid" and go unnoticed until Resend
  // disables the endpoint: call it a configuration error instead.
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) {
    console.error('[resend] RESEND_WEBHOOK_SECRET is not a whsec_ signing secret.');
    return NextResponse.json({ error: 'Email events are not configured.' }, { status: 503 });
  }
  const h = (name: string) => request.headers.get(`svix-${name}`) ?? request.headers.get(`webhook-${name}`);
  const headers = { id: h('id'), timestamp: h('timestamp'), signature: h('signature') };
  if (!headers.id || !headers.timestamp || !headers.signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });

  const body = await request.text();
  let event: ResendEmailEvent;
  try {
    // verify() needs no API key: it checks the signature locally.
    event = new Resend('re_verify_only').webhooks.verify({
      payload: body,
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
      webhookSecret: secret
    }) as unknown as ResendEmailEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    const outcome = await applyResendEvent(createAdminClient(), event);
    if (outcome !== 'ignored' && outcome !== 'no-match') console.info(`[resend] ${event.type} ${event.data?.email_id}: ${outcome}`);
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error(`[resend] ${event.type} ${event.data?.email_id} failed:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }
}
