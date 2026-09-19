/** The one canonical address of the deployed app -- used for sitemap/robots/structured data and
 *  anywhere a server-side redirect needs an absolute URL. */
export const SITE_URL = "https://www.flovuraai.com";

// Behind Railway's proxy the app listens on an internal port, and `new URL(request.url).origin`
// reports that internal address (confirmed against production: /auth/callback was answering with
// `location: https://localhost:8080/...`, sending real users to a dead localhost page right after a
// successful sign-in). So production redirects use the real domain; everywhere else keeps the
// request's own origin so http://localhost:3000 testing still works.
export function publicOrigin(requestUrl: string): string {
  return process.env.NODE_ENV === "production" ? SITE_URL : new URL(requestUrl).origin;
}
