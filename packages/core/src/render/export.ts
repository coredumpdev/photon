/**
 * Shared image-export helpers used by Plot / Plot3D / PolarPlot. Each plot
 * composites its layers into a single 2D canvas, then these turn that canvas into
 * a data URL / Blob / download / clipboard image.
 */

/** Options accepted by the export methods. */
export interface ExportOptions {
  /** Fill color behind the plot (default the theme page color; `"transparent"` keeps alpha). */
  background?: string;
  /** Encoder quality 0..1 for lossy types (`image/jpeg`, `image/webp`). */
  quality?: number;
}

/** Turn a canvas into a `Blob` (default PNG). */
export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Download a canvas as an image file (PNG by default). */
export async function downloadCanvas(
  canvas: HTMLCanvasElement, filename = "chart.png", type = "image/png", quality?: number,
): Promise<void> {
  const blob = await canvasToBlob(canvas, type, quality);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copy a canvas to the clipboard as a PNG. Throws where the browser can't. */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(canvas, "image/png");
  if (!blob) throw new Error("Failed to render image");
  const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!navigator.clipboard?.write || !CI) throw new Error("Clipboard image write is not supported here");
  await navigator.clipboard.write([new CI({ "image/png": blob })]);
}
