# Generates the sky's cloud layer: a horizontally tileable RGBA texture (white, alpha = cloud
# density, fading out towards the top and bottom rows). Original, procedural, CC0.
# usage: python3 -I clouds.py <out.png>   (needs numpy + Pillow)
import sys
import numpy as np
from PIL import Image

W, H = 1024, 256
rng = np.random.default_rng(7)

def tile_noise(cells_x, cells_y):
    """Value noise that wraps horizontally, smoothly interpolated to W x H."""
    g = rng.random((cells_y + 1, cells_x))
    g = np.concatenate([g, g[:, :1]], axis=1)
    xs = np.linspace(0, cells_x, W, endpoint=False)
    ys = np.linspace(0, cells_y, H, endpoint=False)
    x0 = xs.astype(int); y0 = ys.astype(int)
    fx = xs - x0; fy = ys - y0
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]

n = sum(tile_noise(6 * 2 ** o, 2 * 2 ** o) * 0.5 ** o for o in range(6)) / 1.97
# Puffy cumulus: threshold the noise, keep soft edges.
dens = np.clip((n - 0.5) / 0.22, 0, 1) ** 1.4
# Fade near the horizon band edges of the texture (it wraps around a dome band).
v = np.linspace(0, 1, H)[:, None]
dens *= np.clip(v / 0.25, 0, 1) * np.clip((1 - v) / 0.35, 0, 1)
shade = 0.82 + 0.18 * np.clip(n * 1.4 - 0.2, 0, 1)  # slightly darker cores read as volume
rgba = np.zeros((H, W, 4), np.uint8)
rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = (shade * 255).astype(np.uint8)
rgba[..., 3] = (dens * 255).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(sys.argv[1], optimize=True)
print('wrote', sys.argv[1])
