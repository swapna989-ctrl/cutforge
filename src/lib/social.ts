/** Flovura's public profiles -- rendered in the site footer and declared to Google as `sameAs` on the
 *  homepage's Organization data, which is how it ties these accounts to the brand. Plain profile
 *  URLs on purpose: the share links these came from carried tracking parameters (stkn, utm_source,
 *  s=) that don't belong in a public link. */
export const SOCIAL_LINKS = [
  { name: "Instagram", href: "https://www.instagram.com/use_flovura/" },
  { name: "X", href: "https://x.com/flovuraai" },
] as const;
