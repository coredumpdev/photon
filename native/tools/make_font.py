#!/usr/bin/env python3
"""Produce the font Photon embeds, from an upstream Inter release.

Two steps, both reproducible:

1. **Instance** the variable font down to a single weight. stb_truetype reads
   `glyf` and ignores `gvar`, so a variable font would render at its default
   instance anyway — pinning it makes that explicit instead of accidental.
2. **Subset** to the characters a chart actually draws. The full face carries
   over 2500 glyphs for scripts no axis label will ever use; the set below is
   ~450 and covers ASCII, Western European and Central European text (so
   Turkish, Polish and Czech labels render), Greek (σ, μ, Δ, π appear in
   scientific labels constantly) and the maths and currency symbols a
   scientific or finance chart needs.

Usage:
    python3 tools/make_font.py [--source URL_OR_PATH] [--out PATH]

Requires fonttools. This is a maintenance script, not part of the build — the
committed .ttf is the build input.
"""

from __future__ import annotations

import argparse
import io
import pathlib
import sys
import urllib.request

# Inter, OFL-1.1. The variable release from the Google Fonts repository.
DEFAULT_SOURCE = (
    "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
)
DEFAULT_OUT = pathlib.Path(__file__).resolve().parent.parent / "third_party" / "fonts" / "Inter-Regular-subset.ttf"

# Axis labels are 12px UI text: Regular weight, optical size tuned for small text.
INSTANCE = {"wght": 400, "opsz": 14}


def codepoints() -> set[int]:
    points: set[int] = set()

    def add_range(first: int, last: int) -> None:
        points.update(range(first, last + 1))

    add_range(0x0020, 0x007E)  # ASCII printable
    add_range(0x00A0, 0x00FF)  # Latin-1 supplement: accents, °, ±, ×, ÷, µ, ²³
    add_range(0x0100, 0x017F)  # Latin Extended-A: Turkish ğışİĞŞ, Polish, Czech
    add_range(0x0391, 0x03C9)  # Greek: Δ, Σ, μ, σ, π in scientific labels

    # Punctuation and symbols a chart label reaches for.
    points.update(
        [
            0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,  # hyphens and dashes
            0x2018, 0x2019, 0x201C, 0x201D,                  # curly quotes
            0x2020, 0x2021, 0x2022, 0x2026,                  # dagger, bullet, ellipsis
            0x2030,                                          # per mille
            0x2032, 0x2033,                                  # prime, double prime
            0x20AC, 0x00A3, 0x00A5, 0x20BA, 0x20BD,          # €, £, ¥, ₺, ₽
            0x2122,                                          # ™
            0x2190, 0x2191, 0x2192, 0x2193,                  # arrows
            0x2202, 0x2206, 0x220F, 0x2211, 0x2212,          # ∂, ∆, ∏, ∑, − (true minus)
            0x221A, 0x221E, 0x222B, 0x2248,                  # √, ∞, ∫, ≈
            0x2260, 0x2261, 0x2264, 0x2265,                  # ≠, ≡, ≤, ≥
            0x2070, 0x00B9, 0x00B2, 0x00B3,                  # ⁰¹²³ for 10ⁿ tick labels
            0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079,
            0x207B,                                          # superscript minus
        ]
    )
    return points


def load(source: str) -> bytes:
    if source.startswith(("http://", "https://")):
        with urllib.request.urlopen(source) as response:  # noqa: S310 - pinned URL
            return response.read()
    return pathlib.Path(source).read_bytes()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
    except ImportError:
        print("fonttools is required: pip install fonttools", file=sys.stderr)
        return 1

    print(f"reading {args.source}")
    raw = load(args.source)
    font = TTFont(io.BytesIO(raw))
    before = len(raw)

    if "fvar" in font:
        print(f"instancing at {INSTANCE}")
        font = instancer.instantiateVariableFont(font, INSTANCE, inplace=False)

    wanted = codepoints()
    print(f"subsetting to {len(wanted)} codepoints")
    options = subset.Options()
    # Keep the horizontal metrics and kerning; drop everything a rasterizer that
    # only reads glyf/cmap/hmtx cannot use anyway.
    options.layout_features = ["kern", "liga"]
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "MATH", "BASE", "JSTF"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.glyph_names = False

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=wanted)
    subsetter.subset(font)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    font.save(args.out)
    after = args.out.stat().st_size
    print(f"wrote {args.out}  {before // 1024} KB -> {after // 1024} KB")

    covered = len(font.getBestCmap())
    print(f"{covered} codepoints in the result")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
