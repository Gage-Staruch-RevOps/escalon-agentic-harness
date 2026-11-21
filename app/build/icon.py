# Draws the Agentic Harness app icon (a small neural cluster in navy, orange and gold).
import sys, math
from PIL import Image, ImageDraw, ImageFilter
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([64, 64, S - 64, S - 64], radius=220, fill=(8, 13, 31, 255))
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
c = (512, 512)
pts = [(512, 512, 62, (255, 192, 0)), (300, 330, 34, (142, 169, 219)), (740, 300, 30, (142, 169, 219)), (770, 640, 36, (233, 113, 50)), (330, 720, 30, (125, 211, 199)), (540, 250, 22, (233, 113, 50)), (250, 520, 20, (142, 169, 219)), (560, 800, 24, (142, 169, 219))]
for x, y, r, col in pts[1:]:
    d.line([c, (x, y)], fill=(142, 169, 219, 120), width=7)
for (a, b) in [(1, 5), (5, 2), (2, 3), (3, 7), (7, 4), (4, 6), (6, 1)]:
    d.line([pts[a][:2], pts[b][:2]], fill=(142, 169, 219, 60), width=5)
for x, y, r, col in pts:
    g.ellipse([x - r * 2.6, y - r * 2.6, x + r * 2.6, y + r * 2.6], fill=col + (110,))
glow = glow.filter(ImageFilter.GaussianBlur(38))
mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle([64, 64, S - 64, S - 64], radius=220, fill=255)
img = Image.composite(Image.alpha_composite(img, glow), img, mask)
d = ImageDraw.Draw(img)
for x, y, r, col in pts:
    d.ellipse([x - r, y - r, x + r, y + r], fill=col + (255,))
d.ellipse([512 - 26, 512 - 26, 512 + 26, 512 + 26], fill=(255, 243, 196, 255))
img.save(sys.argv[1])
