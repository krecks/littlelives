"""Strand textures for the hairstyles (the source textures are sculpted clumps that read as clay)."""

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def strands(albedo_path, normal_path, size, seed):
    """
    Greyscale strand albedo (mean ~0.5 linear, tinted at runtime) and a matching normal map.
    Strands run along v in these UV layouts: the clumps are streaked along v, fine per-strand
    stripes vary across u, and the normal gets the stripes' slope across the strands.
    """
    rng = np.random.default_rng(seed)
    a = np.asarray(Image.open(albedo_path).convert('L').resize((size, size), Image.LANCZOS), np.float64) / 255
    lin = srgb_to_lin(a)
    lin = lin / np.median(lin) * 0.5
    streak = gaussian_filter1d(lin, 9, axis=0)
    base = 0.45 * lin + 0.55 * streak
    # Per-strand stripes: noise that is fine across u and long along v (two scales).
    n1 = gaussian_filter(rng.standard_normal((size, size)), (28, 0.7))
    n2 = gaussian_filter(rng.standard_normal((size, size)), (60, 2.2))
    n1 /= n1.std()
    n2 /= n2.std()
    stripe = 0.65 * n1 + 0.35 * n2
    alb = base * np.clip(1 + 0.2 * stripe, 0.5, 1.6)
    # Darker roots between clumps (AO from the sculpt) are kept via `base`; lift the overall contrast a bit.
    alb = np.clip(alb, 0, 1) ** (1 / 2.2)
    albedo = Image.fromarray(np.uint8(np.clip(alb, 0, 1) * 255))

    nm = np.asarray(Image.open(normal_path).convert('RGB').resize((size, size), Image.LANCZOS), np.float64) / 255 * 2 - 1
    nm[..., 0] = gaussian_filter1d(nm[..., 0], 4, axis=0)
    nm[..., 1] = gaussian_filter1d(nm[..., 1], 4, axis=0)
    slope = np.gradient(stripe, axis=1)
    nm[..., 0] = nm[..., 0] * 0.8 + slope * 0.35
    nm[..., 2] = np.sqrt(np.clip(1 - nm[..., 0] ** 2 - nm[..., 1] ** 2, 0.05, 1))
    normal = Image.fromarray(np.uint8(np.clip(nm * 0.5 + 0.5, 0, 1) * 255))
    return albedo, normal
