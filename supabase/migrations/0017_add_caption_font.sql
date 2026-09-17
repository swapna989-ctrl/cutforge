-- Third of the Vugola-caption-editor-inspired features (new visual presets shipped alongside this
-- in worker/src/ffmpeg.ts's CAPTION_PRESETS). Font family is a separate, independent dimension
-- from caption style/preset -- picking a preset doesn't change the font except where a preset
-- hardcodes one via fontOverride (only 'vlog' does, for its serif look). 'geist' matches today's
-- only-ever font, kept as the default so every existing project keeps rendering identically.
alter table public.projects add column caption_font text not null default 'geist' check (
  caption_font in ('geist', 'montserrat', 'poppins', 'fredoka', 'pt_serif', 'roboto', 'ubuntu', 'zalando_sans', 'cormorant_garamond')
);

alter table public.projects drop constraint projects_caption_style_check;
alter table public.projects add constraint projects_caption_style_check check (
  caption_style in ('classic', 'bold_yellow', 'rose', 'glow', 'punch', 'minimalist', 'vlog')
);
