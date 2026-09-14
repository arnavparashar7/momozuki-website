import { NextResponse } from 'next/server';

/**
 * CORS/CSRF posture for this app (Checkpoint 8 review):
 *
 * - No CORS headers are set on any route, which means browsers refuse
 *   cross-origin `fetch`/XHR responses by default (same-origin policy) -
 *   there is no `Access-Control-Allow-Origin` anywhere in this codebase, so
 *   a third-party site's JS cannot read responses from this API even if it
 *   could trigger a request.
 * - Every session cookie (wallet and admin) is issued with `SameSite=Lax`
 *   (lib/session.ts). Lax blocks the cookie from being attached to
 *   cross-site POST/PUT/DELETE requests (it's only sent on top-level GET
 *   navigations), which is exactly the shape of a classic CSRF attack (a
 *   foreign page auto-submitting a form or firing a background POST) - the
 *   forged request would arrive with no session cookie at all and fail
 *   authentication before doing anything.
 * - This function adds a second, independent layer on top of that: an
 *   explicit Origin/Referer check on state-changing routes. It doesn't
 *   replace SameSite (browsers that mishandle SameSite, or a future route
 *   added without cookie-based auth in mind, would otherwise have no
 *   protection) - it's defense-in-depth, not the primary control.
 *
 * The expected host is derived from the request's OWN url
 * (`new URL(req.url).host`) rather than a separate `Host` header. Origin
 * and Referer are values the BROWSER sets truthfully for the actual
 * requesting page - a malicious cross-site page cannot forge them via
 * fetch/XHR/form-submit - so comparing them against where the request
 * actually landed is the meaningful check, and doesn't depend on a `Host`
 * header being present the way a hand-constructed `Request` (as in this
 * repo's own tests) might not set one.
 */
export function isSameOriginRequest(req: Request): boolean {
  const requestHost = new URL(req.url).host;
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  if (origin) {
    try {
      return new URL(origin).host === requestHost;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      return new URL(referer).host === requestHost;
    } catch {
      return false;
    }
  }

  // Neither header present: unusual for a browser-originated request, but
  // common for direct API/tooling calls (curl, this repo's own integration
  // tests, legitimate server-to-server calls). Not rejected outright -
  // SameSite cookies already mean such a request has no session to act
  // with unless the caller legitimately possesses the cookie.
  return true;
}

/** Standard rejection for a state-changing request whose Origin/Referer
 *  doesn't match this app's own host - see isSameOriginRequest above. */
export function crossOriginRejectedResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: 'VALIDATION', message: 'That request could not be processed.' } },
    { status: 403 },
  );
}
