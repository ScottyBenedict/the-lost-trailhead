from PIL import Image, ImageFilter
import numpy as np

INPUT = "public/maps/rattlesnake-ledge-topo.jpg"
OUTPUT = "public/maps/rattlesnake-ledge-topo.jpg"

img = Image.open(INPUT).convert("L")
w, h = img.size  # 600x800

# Convert to numpy for masking
arr = np.array(img, dtype=np.float32)

# Gradient mask: full opacity on left, fading to black on right
# Fade starts at 55% across and is fully black by 85%
fade_start = int(w * 0.55)
fade_end = int(w * 0.85)

mask = np.ones(w, dtype=np.float32)
for x in range(fade_start, fade_end):
    mask[x] = 1.0 - (x - fade_start) / (fade_end - fade_start)
mask[fade_end:] = 0.0

arr = arr * mask[np.newaxis, :]
arr = np.clip(arr, 0, 255).astype(np.uint8)

result = Image.fromarray(arr, mode="L").convert("RGB")
result.save(OUTPUT, "JPEG", quality=90)
print(f"Saved {OUTPUT} ({w}x{h})")
