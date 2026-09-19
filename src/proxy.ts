import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/siteUrl";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the auth token if it's expired — required for server-side session reads to stay valid.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in visitors skip the marketing page. Handled here, where the user is already being
  // resolved on every request, rather than in page.tsx -- that used to be a client component
  // returning null until its auth check finished, so `/` had no server-rendered content at all and
  // Google only saw the landing page after running JavaScript. Now `/` is plain static HTML.
  if (user && request.nextUrl.pathname === "/") {
    const redirect = NextResponse.redirect(`${publicOrigin(request.url)}/dashboard`);
    // Carry over any auth cookies the refresh above just set.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
