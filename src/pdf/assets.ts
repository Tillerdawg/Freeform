import latinFontDataUrl from './assets/noto-sans-latin-400.woff?inline';
import cyrillicFontDataUrl from './assets/noto-sans-cyrillic-400.woff?inline';
import emojiFontDataUrl from './assets/noto-emoji-400.ttf?inline';
import type { PdfAssets, PdfFontAsset } from './contracts';

export const NOTO_LATIN_SHA256 = '18e2e5b23a9bc5e8e636d6c7984b8ac6635aefc1c497ed1c5012f3c637761b91';
export const NOTO_CYRILLIC_SHA256 = 'e199c2ac3c8bd6c99ec9e44cc3363128d86c94eed54d2f22d5b6ef9ca16bc484';
// Raw TTF (unwrapped from the WOFF container), converted offline with fontTools 4.66.1
// (TTFont(...).flavor = None; .save(...)) from the SAME upstream @fontsource/noto-emoji
// 5.3.2 400-normal WOFF (sha256 61c7949ebb9d401f397826415e64525f60298bf2a9c469f9720aa17817877331).
// Required because @pdf-lib/fontkit's TTFSubset encoder drops the last byte of the last
// glyph in a subset (confirmed root cause, evidence/m8-pdf-foundation/qualification.json),
// and pdf-lib's full (subset:false) embed path does not unwrap a WOFF container, so
// Ghostscript rejects raw WOFF bytes embedded that way. A full, non-subset embed of the
// raw TTF avoids both bugs. See decisions/m8-pdf-export-design.md and this card's
// DECISION comment in evidence/m8-pdf-foundation/qualification.json.
export const NOTO_EMOJI_TTF_SHA256 = 'bfa22d39f50efa1f2b437d4e9ce4f42c6d56a1d69b5f6a03959657a3f764bdb9';
export const NOTO_LICENSE = 'SIL Open Font License 1.1; see src/pdf/assets/NOTO-SANS-LICENSE and NOTO-EMOJI-LICENSE';
const NOTO_SOURCE = 'https://fontsource.org/fonts/noto-sans and https://fontsource.org/fonts/noto-emoji';

/**
 * The font bytes are Vite inline assets in this lazy module, not URLs fetched at
 * export time. The caller should dynamically import this module from an explicit
 * export action so normal authoring does not load the font payload.
 */
export function loadBundledPdfAssets(): PdfAssets {
  return {
    fonts: [
      fontAsset('noto-sans-latin-400', latinFontDataUrl, NOTO_LATIN_SHA256, true),
      fontAsset('noto-sans-cyrillic-400', cyrillicFontDataUrl, NOTO_CYRILLIC_SHA256, true),
      fontAsset('noto-emoji-400', emojiFontDataUrl, NOTO_EMOJI_TTF_SHA256, false),
    ],
  };
}

function fontAsset(id: string, dataUrl: string, sha256: string, subset: boolean): PdfFontAsset {
  return { id, bytes: dataUrlBytes(dataUrl), sha256, sourceUrl: NOTO_SOURCE, license: NOTO_LICENSE, subset };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
