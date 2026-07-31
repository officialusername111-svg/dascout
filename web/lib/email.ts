/**
 * The one door out to email.
 *
 * SERVER ONLY. There is no `import 'server-only'` because the package is not installed
 * (same note as `lib/admin/auth.ts`); nothing in a client bundle may import this file,
 * because it reads `RESEND_API_KEY`.
 *
 * Three properties matter more than anything this module actually does:
 *
 * 1. It NEVER throws. Email is a courtesy on top of a write that already succeeded — a
 *    request the visitor filed, a listing staff published. A mail provider having a bad
 *    afternoon must not turn either of those into an error page.
 * 2. It never logs a recipient address. These are people who asked to be told about
 *    property listings; their addresses do not belong in a log file that a dozen people
 *    can read. Failures log a status code and nothing else — not the response body
 *    either, which Resend fills with the address it just refused.
 * 3. With no API key configured it warns once per call and returns false. That is the
 *    expected state at ship: nothing is sent, nothing breaks, and the server log says
 *    plainly why.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** The verified sender for the project's domain. */
const FROM = 'DaScout <no-reply@dascoutprime.com>'

export type OutgoingEmail = {
  to: string
  subject: string
  text: string
}

/** True only when the provider accepted the message. Never throws. */
export async function sendEmail({ to, subject, text }: OutgoingEmail): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY

  if (!resendKey) {
    console.warn('[email] RESEND_API_KEY is not set — nothing was sent.')
    return false
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      // Text only, on purpose. An HTML body would be one more place for somebody
      // else's typing to end up being rendered.
      body: JSON.stringify({ from: FROM, to, subject, text }),
    })

    if (!response.ok) {
      console.warn('[email] provider refused the message, status', response.status)
      return false
    }

    return true
  } catch (error) {
    // The name of the error class only. A message can carry the URL and, in some
    // runtimes, the payload with it.
    console.warn('[email] send failed:', error instanceof Error ? error.name : 'unknown error')
    return false
  }
}
