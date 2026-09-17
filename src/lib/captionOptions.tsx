// Shared between the clipping page's configure panel and the per-short edit page — both need the
// exact same option lists/preview so a style or font looks and is labeled identically wherever a
// user picks it. Single source of truth instead of two copies drifting apart.
import { Montserrat, Poppins, Fredoka, PT_Serif, Roboto, Ubuntu, Zalando_Sans, Cormorant_Garamond } from "next/font/google";
import type { CaptionStyle, CaptionFont, CaptionPosition, CaptionLineCount } from "@/lib/pipeline";

// Loaded here (rather than a manual Google Fonts <link>) purely so the font picker below can show
// each name set in its own real typeface — self-hosted by Next.js at build time. Regular weight
// only, matching the actual bundled worker font files these map to (see worker/src/ffmpeg.ts's
// FONT_DISPLAY_NAMES) — this preview is never what actually gets burned in.
const montserrat = Montserrat({ subsets: ["latin"], weight: ["400"] });
const poppins = Poppins({ subsets: ["latin"], weight: ["400"] });
const fredoka = Fredoka({ subsets: ["latin"], weight: ["400"] });
const ptSerif = PT_Serif({ subsets: ["latin"], weight: ["400"] });
const roboto = Roboto({ subsets: ["latin"], weight: ["400"] });
const ubuntu = Ubuntu({ subsets: ["latin"], weight: ["400"] });
const zalandoSans = Zalando_Sans({ subsets: ["latin"], weight: ["400"] });
const cormorantGaramond = Cormorant_Garamond({ subsets: ["latin"], weight: ["400"] });

export const CAPTION_FONT_OPTIONS: { value: CaptionFont; label: string; className: string }[] = [
  { value: "geist", label: "Geist", className: "" }, // the app's own body font — no extra class needed
  { value: "montserrat", label: "Montserrat", className: montserrat.className },
  { value: "poppins", label: "Poppins", className: poppins.className },
  { value: "fredoka", label: "Fredoka", className: fredoka.className },
  { value: "pt_serif", label: "PT Serif", className: ptSerif.className },
  { value: "roboto", label: "Roboto", className: roboto.className },
  { value: "ubuntu", label: "Ubuntu", className: ubuntu.className },
  { value: "zalando_sans", label: "Zalando Sans", className: zalandoSans.className },
  { value: "cormorant_garamond", label: "Cormorant Garamond", className: cormorantGaramond.className },
];

// Mirrors worker/src/ffmpeg.ts's CAPTION_PRESETS closely enough for a preview swatch — the
// worker's own values are what actually render, this is just so a user can see roughly what
// they're picking before it's burned into a real video. `glow` approximates its real two-layer
// blurred-halo render (see ffmpeg.ts) with a CSS text-shadow — close enough for a small swatch,
// not meant to be pixel-identical.
export const CAPTION_STYLE_OPTIONS: {
  value: CaptionStyle;
  label: string;
  highlight: string | null;
  bold: boolean;
  italic?: boolean;
  uppercase?: boolean;
  textColor?: string;
  glow?: boolean;
  noCaptions?: boolean;
}[] = [
  { value: "none", label: "No captions", highlight: null, bold: false, noCaptions: true },
  { value: "classic", label: "Classic", highlight: null, bold: false },
  { value: "bold_yellow", label: "Bold Yellow", highlight: "#FFFF00", bold: true },
  { value: "rose", label: "Rose", highlight: "#ed8395", bold: true },
  { value: "glow", label: "Glow", highlight: null, bold: true, glow: true },
  { value: "punch", label: "Punch", highlight: "#39FF14", bold: true },
  { value: "minimalist", label: "Minimalist", highlight: null, bold: false, uppercase: false },
  { value: "vlog", label: "Vlog", highlight: null, bold: false, italic: true, uppercase: false, textColor: "#F0B84B" },
];

export const CAPTION_POSITION_OPTIONS: { value: CaptionPosition; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

export const CAPTION_LINE_COUNT_OPTIONS: { value: CaptionLineCount; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "one_line", label: "One line" },
  { value: "two_words", label: "Two words" },
  { value: "three_lines", label: "Three lines" },
];

export function CaptionPreview({
  highlight,
  bold,
  italic = false,
  uppercase = true,
  textColor = "#fff",
  glow = false,
  noCaptions = false,
}: {
  highlight: string | null;
  bold: boolean;
  italic?: boolean;
  uppercase?: boolean;
  textColor?: string;
  glow?: boolean;
  noCaptions?: boolean;
}) {
  if (noCaptions) {
    return (
      <div className="rounded-lg bg-[#1a1a1a] px-2 py-3 flex items-center justify-center leading-tight">
        <span className="material-symbols-outlined text-[#7B7579] text-[20px]">subtitles_off</span>
      </div>
    );
  }

  const strokeStyle = {
    WebkitTextStroke: glow ? "0" : "2px black",
    paintOrder: "stroke fill",
    textShadow: glow ? "0 0 4px #fff, 0 0 8px #fff" : undefined,
  } as const;
  return (
    <div className="rounded-lg bg-[#1a1a1a] px-2 py-3 flex items-center justify-center leading-tight">
      <span
        className={`text-[11px] ${uppercase ? "uppercase" : ""} ${bold ? "font-extrabold" : "font-medium"} ${italic ? "italic" : ""}`}
        style={{ ...strokeStyle, color: textColor }}
      >
        Sample{" "}
        <span style={{ ...strokeStyle, color: highlight ?? textColor }}>text</span>
      </span>
    </div>
  );
}
