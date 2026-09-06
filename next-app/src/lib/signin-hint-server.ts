/**
 * The request-context half of lib/signin-hint.ts — reads the hint cookie.
 * Same split as lib/capabilities vs lib/require-capability: the rules stay
 * framework-agnostic and testable, this file is the only one that touches
 * next/headers.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { HINT_COOKIE, verifySignInHint, type SignInHint } from '@/lib/signin-hint';

/** The verified hint this request carries, or null. Signature, shape and
 *  age are all checked in verifySignInHint(). */
export const getSignInHintIfValid = cache(async function getSignInHintIfValid(): Promise<SignInHint | null> {
  const jar = await cookies();
  return verifySignInHint(jar.get(HINT_COOKIE.name)?.value);
});
