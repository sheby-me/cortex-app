import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { UserError } from "@/lib/friendly-errors";

interface Props {
  /** The picked image; the dialog is open while this is set. */
  file: File | null;
  /** width ÷ height of the final image (banner ≈ 3.2, avatar = 1). */
  aspect: number;
  /** Width in pixels of the exported image (height follows from the aspect ratio). */
  outputWidth: number;
  /** Stop lowering JPEG quality once the result is under this many bytes. */
  maxBytes: number;
  title: string;
  round?: boolean;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}

const VIEW_W = 480;

/**
 * Drag to position, slide to zoom, preview exactly what will be saved, then export a compressed JPEG at a fixed size.
 * No external library: a CSS-transformed <img> inside a clipped viewport, rendered to a canvas on "Apply".
 */
export function ImageCropDialog({ file, aspect, outputWidth, maxBytes, title, round, onCancel, onDone }: Props) {
  const viewH = Math.round(VIEW_W / aspect);
  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // top-left of the image relative to the viewport
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  // The frame shrinks on narrow screens; all maths stays in VIEW_W units and is scaled visually by `k`.
  const frameRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / VIEW_W) || 1));
    ro.observe(el);
    setK(Math.min(1, el.clientWidth / VIEW_W) || 1);
    return () => ro.disconnect();
  }, [file]);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      setNat(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    setZoom(1);
    setError(null);
    const img = new Image();
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setError("That image couldn't be read. Please choose a different file.");
    img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const baseScale = nat ? Math.max(VIEW_W / nat.w, viewH / nat.h) : 1; // "cover"
  const scale = baseScale * zoom;

  const clamp = useCallback(
    (p: { x: number; y: number }, s: number) => {
      if (!nat) return p;
      const w = nat.w * s;
      const h = nat.h * s;
      return { x: Math.min(0, Math.max(VIEW_W - w, p.x)), y: Math.min(0, Math.max(viewH - h, p.y)) };
    },
    [nat, viewH],
  );

  // Centre the image whenever a new one loads; keep it inside the frame while zooming.
  useEffect(() => {
    if (!nat) return;
    const s = baseScale;
    setPos(clamp({ x: (VIEW_W - nat.w * s) / 2, y: (viewH - nat.h * s) / 2 }, s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat]);

  function changeZoom(z: number) {
    if (!nat) return;
    // zoom around the centre of the frame
    const cx = VIEW_W / 2;
    const cy = viewH / 2;
    const imgX = (cx - pos.x) / scale;
    const imgY = (cy - pos.y) / scale;
    const ns = baseScale * z;
    setZoom(z);
    setPos(clamp({ x: cx - imgX * ns, y: cy - imgY * ns }, ns));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPos(clamp({ x: drag.current.px + (e.clientX - drag.current.sx) / k, y: drag.current.py + (e.clientY - drag.current.sy) / k }, scale));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onKeyDown(e: React.KeyboardEvent) {
    const step = 12;
    const d: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = d[e.key];
    if (m) {
      e.preventDefault();
      setPos((p) => clamp({ x: p.x + m[0], y: p.y + m[1] }, scale));
    }
  }

  async function apply() {
    if (!url || !nat) return;
    setBusy(true);
    setError(null);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // Export at the requested width, but never larger than the pixels actually visible in the frame (no blurry upscaling).
      const visibleSourceWidth = Math.floor(VIEW_W / scale);
      const outWidth = Math.max(64, Math.min(outputWidth, visibleSourceWidth));
      const outHeight = Math.round(outWidth / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new UserError("Your browser can't process images. Please try another browser.");
      ctx.imageSmoothingQuality = "high";
      // Visible region of the SOURCE image
      const sx = -pos.x / scale;
      const sy = -pos.y / scale;
      const sw = VIEW_W / scale;
      const sh = viewH / scale;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outWidth, outHeight);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

      // Compress: step the JPEG quality down until the file is small enough.
      let blob: Blob | null = null;
      for (const q of [0.88, 0.8, 0.72, 0.64, 0.56, 0.48]) {
        blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
        if (blob && blob.size <= maxBytes) break;
      }
      if (!blob) throw new UserError("Couldn't process that image. Please try another one.");
      onDone(new File([blob], "image.jpg", { type: "image/jpeg" }));
    } catch (err) {
      console.error("[Cortex] crop failed", err);
      setError(err instanceof UserError ? err.message : "Couldn't process that image. Please try another one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-[540px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Drag the image to position it, use the slider to zoom. This is exactly how it will look.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <div
            ref={frameRef}
            tabIndex={0}
            role="application"
            aria-label="Image position. Use the arrow keys to move the picture."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className={`relative touch-none overflow-hidden border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring ${round ? "rounded-full" : "rounded-xl"} cursor-grab active:cursor-grabbing`}
            style={{ width: "100%", maxWidth: VIEW_W, aspectRatio: String(aspect) }}
          >
            <div style={{ width: VIEW_W, height: viewH, transform: `scale(${k})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0 }}>
            {url && nat && (
              <img
                src={url}
                alt="Preview"
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                // The frame scales down on narrow screens, so positions are expressed relative to VIEW_W
                style={{
                  width: nat.w * scale,
                  height: nat.h * scale,
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  transformOrigin: "0 0",
                }}
              />
            )}
            </div>
            {!nat && !error && (
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Slider aria-label="Zoom" min={1} max={4} step={0.01} value={[zoom]} onValueChange={(v) => changeZoom(v[0])} />
          <ZoomIn className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="rounded-xl">
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={busy || !nat} className="rounded-xl bg-gradient-primary text-primary-foreground">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
