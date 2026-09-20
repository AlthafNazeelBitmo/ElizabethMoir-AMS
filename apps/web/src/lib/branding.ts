/**
 * The school's mark, as shipped with the code.
 *
 * The sign-in page has no session, so it cannot ask the server what the
 * school is called or fetch a crest an administrator uploaded. What it
 * shows has to be here. The monogram is lifted from the school's own logo
 * and kept in two colourings: the crest's cyan for light surfaces and
 * white for the sign-in field. An uploaded crest (Admin → Rules) still
 * takes precedence everywhere a session exists.
 */
export const BRAND = {
  name: "Elizabeth Moir School",
  /** The whole logo — monogram, rules and banner — on transparent. */
  logo: "/branding/logo.png",
  /** The logo's proportions, so space is held before it loads. */
  logoAspect: "622 / 246",
  /** The monogram alone in the crest's cyan, for small tiles. */
  monogram: "/branding/monogram.png",
  /** The monogram in white, for the sign-in field. */
  monogramOnDark: "/branding/monogram-white.png",
  /** Behind the sign-in card: the crest's colours out of focus, the mark faint. */
  signInBackdrop: "/branding/sign-in.jpg",
} as const;
