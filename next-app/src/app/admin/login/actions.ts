'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE, signSession, type SessionRole } from '@/lib/leader-session';

/** Accepts any non-empty username + any password. Sets the signed cookie. */
export async function loginAction(formData: FormData): Promise<void> {
  const username = String(formData.get('username') ?? '').trim();
  const role: SessionRole = formData.get('role') === 'scout' ? 'scout' : 'leader';
  const next = String(formData.get('next') ?? '/admin/advancement') || '/admin/advancement';
  if (!username) {
    redirect(`/admin/login?error=missing-username&next=${encodeURIComponent(next)}`);
  }

  const token = await signSession({ leader: username, iat: Date.now(), role });
  const jar = await cookies();
  jar.set(LEADER_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LEADER_COOKIE.maxAgeSeconds
  });

  // Defense-in-depth: only allow same-origin redirects.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin/advancement';
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  redirect('/admin/login');
}
