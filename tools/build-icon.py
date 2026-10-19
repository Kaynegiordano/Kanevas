"""Décline build/icon-source.png en PNG et ICO pour l'interface et Windows.

Reconstruction : python tools/build-icon.py (Pillow requis).
Les petites tailles ICO utilisent des bitmaps BGRA pour les raccourcis Windows.
"""
import io
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)


def bitmap(image):
    width, height = image.size
    pixels = image.tobytes("raw", "BGRA")
    rows = [pixels[y * width * 4:(y + 1) * width * 4] for y in range(height)]
    mask_stride = ((width + 31) // 32) * 4
    mask = bytearray(mask_stride * height)
    alpha = image.getchannel("A")
    for y in range(height):
        for x in range(width):
            if alpha.getpixel((x, y)) == 0:
                mask[(height - y - 1) * mask_stride + x // 8] |= 0x80 >> (x % 8)
    header = struct.pack("<IiiHHIIiiII", 40, width, height * 2, 1, 32, 0,
                         len(pixels) + len(mask), 0, 0, 0, 0)
    return header + b"".join(reversed(rows)) + mask


def main():
    source = Image.open(ROOT / "build/icon-source.png").convert("RGBA")
    source.resize((512, 512), Image.Resampling.LANCZOS).save(ROOT / "app/icon.png")
    entries = []
    for size in SIZES:
        image = source.resize((size, size), Image.Resampling.LANCZOS)
        if size == 256:
            stream = io.BytesIO()
            image.save(stream, "PNG")
            data = stream.getvalue()
        else:
            data = bitmap(image)
        entries.append((size, data))
    output = io.BytesIO()
    output.write(struct.pack("<HHH", 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    for size, data in entries:
        output.write(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                                 1, 32, len(data), offset))
        offset += len(data)
    for _, data in entries:
        output.write(data)
    for target in ("build/icon.ico", "app/icon.ico", "app/kanevas.ico"):
        (ROOT / target).write_bytes(output.getvalue())
    print("Icônes reconstruites : PNG 512 px et ICO", ", ".join(map(str, SIZES)))


if __name__ == "__main__":
    main()
