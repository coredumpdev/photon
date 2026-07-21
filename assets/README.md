# Media assets

| File | What |
| --- | --- |
| `banner.svg` | README hero (self-contained, editable) |
| `gallery-full.png` | Full chart gallery — live capture of `pnpm example` |
| `streaming-still.png` | Top streaming rows, single frame |
| `streaming.gif` | ~5s of the live streaming panels |
| `gallery.svg` | Illustrative fallback preview (SVG) |

## Regenerating the captures

The PNGs/GIF are captured from the running example with Playwright + ffmpeg:

```bash
pnpm example                       # in one terminal (serves http://localhost:5173)
npm i -D playwright                 # uses your installed Chrome
node scripts/capture-media.mjs      # writes gallery-full.png + streaming-still.png + a webm

# webm → optimized gif
ffmpeg -y -ss 1.5 -t 5 -i /tmp/photon-video/*.webm \
  -vf "fps=18,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff" /tmp/pal.png
ffmpeg -y -ss 1.5 -t 5 -i /tmp/photon-video/*.webm -i /tmp/pal.png \
  -lavfi "fps=18,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse" assets/streaming.gif
```

Keep GIFs under ~5 MB (24fps, ≤900px wide) so the README stays light.
