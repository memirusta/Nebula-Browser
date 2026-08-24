from __future__ import annotations

import argparse
import base64
import io
import struct
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


RESAMPLE = Image.Resampling.LANCZOS


def load_rgba(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


def fit(source: Image.Image, size: tuple[int, int], sharpen: bool = True) -> Image.Image:
    result = ImageOps.fit(source, size, method=RESAMPLE, centering=(0.5, 0.5))
    if sharpen and min(size) <= 512:
        result = result.filter(ImageFilter.UnsharpMask(radius=0.65, percent=115, threshold=3))
    return result


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True, compress_level=9)


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True, compress_level=9)
    return buffer.getvalue()


def save_mixed_ico(simple: Image.Image, detailed: Image.Image, path: Path) -> None:
    sizes = (16, 20, 24, 32, 40, 48, 64, 128, 256)
    frames = [
        png_bytes(fit(simple if size <= 64 else detailed, (size, size)))
        for size in sizes
    ]
    directory_size = 6 + 16 * len(frames)
    offset = directory_size
    entries: list[bytes] = []
    for size, frame in zip(sizes, frames, strict=True):
        dimension = 0 if size == 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(frame),
                offset,
            )
        )
        offset += len(frame)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(frames)) + b"".join(entries) + b"".join(frames))


def save_icns(simple: Image.Image, detailed: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = [
        fit(simple, (32, 32)),
        fit(simple, (64, 64)),
        fit(detailed, (128, 128)),
        fit(detailed, (256, 256)),
        fit(detailed, (512, 512)),
        fit(detailed, (1024, 1024), sharpen=False),
    ]
    frames[-1].save(path, format="ICNS", append_images=frames[:-1])


def generate_tauri_icons(root: Path, simple: Image.Image, detailed: Image.Image) -> None:
    icons = root / "src-tauri" / "icons"
    square_assets = {
        "32x32.png": (32, simple),
        "64x64.png": (64, simple),
        "128x128.png": (128, detailed),
        "128x128@2x.png": (256, detailed),
        "icon.png": (512, detailed),
        "Square30x30Logo.png": (30, simple),
        "Square44x44Logo.png": (44, simple),
        "Square71x71Logo.png": (71, detailed),
        "Square89x89Logo.png": (89, detailed),
        "Square107x107Logo.png": (107, detailed),
        "Square142x142Logo.png": (142, detailed),
        "Square150x150Logo.png": (150, detailed),
        "Square284x284Logo.png": (284, detailed),
        "Square310x310Logo.png": (310, detailed),
        "StoreLogo.png": (50, simple),
    }
    for name, (size, source) in square_assets.items():
        save_png(fit(source, (size, size)), icons / name)
    save_mixed_ico(simple, detailed, icons / "icon.ico")
    save_icns(simple, detailed, icons / "icon.icns")


def generate_web_assets(
    root: Path,
    simple: Image.Image,
    detailed: Image.Image,
    thumbnail: Image.Image,
) -> None:
    public = root / "public"
    save_png(fit(detailed, (1024, 1024), sharpen=False), public / "nebula-app-logo.png")
    save_png(fit(simple, (512, 512)), public / "nebula-simple-logo.png")
    save_png(fit(thumbnail, (1920, 1080), sharpen=False), public / "nebula-thumbnail.png")
    save_png(fit(simple, (64, 64)), public / "favicon.png")
    save_mixed_ico(simple, detailed, public / "favicon.ico")

    embedded_mark = png_bytes(fit(detailed, (128, 128)))
    embedded_path = root / "src-tauri" / "resources" / "branding" / "nebula-app-logo-128.base64"
    embedded_path.parent.mkdir(parents=True, exist_ok=True)
    embedded_path.write_text(base64.b64encode(embedded_mark).decode("ascii") + "\n", encoding="ascii")


def generate_store_assets(
    store_root: Path,
    simple: Image.Image,
    detailed: Image.Image,
    thumbnail: Image.Image,
) -> None:
    assets = store_root / "Assets"
    app_list_sizes = {
        "AppList.png": 44,
        "AppList.scale-125.png": 55,
        "AppList.scale-150.png": 66,
        "AppList.scale-200.png": 88,
        "AppList.scale-400.png": 176,
    }
    for name, size in app_list_sizes.items():
        save_png(fit(simple, (size, size)), assets / name)

    for size in (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256):
        icon = fit(simple, (size, size))
        save_png(icon, assets / f"AppList.targetsize-{size}.png")
        save_png(icon, assets / f"AppList.targetsize-{size}_altform-unplated.png")

    medium_sizes = {
        "MedTile.png": 150,
        "MedTile.scale-125.png": 188,
        "MedTile.scale-150.png": 225,
        "MedTile.scale-200.png": 300,
        "MedTile.scale-400.png": 600,
    }
    for name, size in medium_sizes.items():
        save_png(fit(detailed, (size, size)), assets / name)

    store_logo_sizes = {
        "StoreLogo.png": 50,
        "StoreLogo.scale-125.png": 63,
        "StoreLogo.scale-150.png": 75,
        "StoreLogo.scale-200.png": 100,
        "StoreLogo.scale-400.png": 200,
    }
    for name, size in store_logo_sizes.items():
        save_png(fit(simple, (size, size)), assets / name)

    wide_sizes = {
        "WideTile.png": (310, 150),
        "WideTile.scale-125.png": (388, 188),
        "WideTile.scale-150.png": (465, 225),
        "WideTile.scale-200.png": (620, 300),
        "WideTile.scale-400.png": (1240, 600),
    }
    for name, size in wide_sizes.items():
        save_png(fit(thumbnail, size, sharpen=False), assets / name)

    save_mixed_ico(simple, detailed, assets / "app.ico")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Nebula branding assets from clean masters.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Normal Nebula repository root.",
    )
    parser.add_argument("--store-root", type=Path, help="Optional Microsoft Store project root.")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    source = repo_root / "branding" / "source"
    detailed = load_rgba(source / "nebula-app-logo-clean.png")
    simple = load_rgba(source / "nebula-simple-logo-clean.png")
    thumbnail = load_rgba(source / "nebula-thumbnail-clean.png")

    branding = repo_root / "branding"
    save_png(fit(detailed, (2048, 2048), sharpen=False), branding / "nebula-app-logo-2048.png")
    save_png(fit(simple, (2048, 2048), sharpen=False), branding / "nebula-simple-logo-2048.png")
    save_png(fit(thumbnail, (3840, 2160), sharpen=False), branding / "nebula-thumbnail-3840x2160.png")

    generate_tauri_icons(repo_root, simple, detailed)
    generate_web_assets(repo_root, simple, detailed, thumbnail)

    if args.store_root:
        store_root = args.store_root.resolve()
        generate_tauri_icons(store_root, simple, detailed)
        generate_web_assets(store_root, simple, detailed, thumbnail)
        generate_store_assets(store_root, simple, detailed, thumbnail)


if __name__ == "__main__":
    main()
