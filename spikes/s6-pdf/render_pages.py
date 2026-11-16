"""Render pages of a PDF as PNG images, each page cut into an upper and a lower half that overlap.

Spike S6's fallback ("smaller pages per pass", docs/PLAN.md): a whole page shrunk to fit one image
leaves a diagram square about 24 pixels wide, too small to tell a piece's colour on a dark square.
Half a page at a higher resolution gives each square three to four times the pixels.

    python -I render_pages.py <pdf> <out-dir> <first-page>-<last-page> [...more ranges] [--dpi 170]

Page numbers are the PDF's own, starting at 1. Writes p<page>-top.png and p<page>-bottom.png.
"""

import sys
from pathlib import Path

import pymupdf


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dpi = 170
    if "--dpi" in sys.argv:
        dpi = int(sys.argv[sys.argv.index("--dpi") + 1])
        args = [a for a in args if a != str(dpi)]
    pdf, out_dir, ranges = Path(args[0]), Path(args[1]), args[2:]
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)
    for spec in ranges:
        first, _, last = spec.partition("-")
        for number in range(int(first), int(last or first) + 1):
            page = doc[number - 1]
            box = page.rect
            middle = box.y0 + box.height / 2
            overlap = box.height * 0.08
            halves = {
                "top": pymupdf.Rect(box.x0, box.y0, box.x1, middle + overlap),
                "bottom": pymupdf.Rect(box.x0, middle - overlap, box.x1, box.y1),
            }
            for name, clip in halves.items():
                pix = page.get_pixmap(dpi=dpi, clip=clip, colorspace=pymupdf.csGRAY)
                target = out_dir / f"p{number:03d}-{name}.png"
                pix.save(target)
                print(f"{target.name}: {pix.width}x{pix.height}")


if __name__ == "__main__":
    main()
