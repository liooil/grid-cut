import { useRef, useEffect, useCallback, useState } from "react";

interface SplitCanvasProps {
  image: HTMLImageElement;
  horizontalLines: number[];
  /** Unified vertical splits (ignored when vLinesByRow is set). */
  verticalLines: number[];
  /** Per-row vertical splits — 1 array per horizontal band. */
  vLinesByRow?: number[][];
  onLinesChange: (h: number[], v: number[]) => void;
  onVLinesByRowChange?: (v: number[][]) => void;
  onRemoveLine: (type: "h" | "v", index: number) => void;
  onRemoveLineByRow?: (row: number, index: number) => void;
}

const LINE_COLOR = "#ef4444";
const LINE_WIDTH = 2;
const HANDLE_RADIUS = 6;
const HANDLE_HIT = 12;
const REMOVE_RADIUS = 7;
const REMOVE_HIT = 11;
const REMOVE_OFFSET = 18;
const LABEL_BG = "rgba(239, 68, 68, 0.85)";
const LABEL_COLOR = "#fff";

// ---- drag/hit target types --------------------------------------------------

type DragTarget =
  | { type: "h"; index: number }
  | { type: "v"; index: number }
  | { type: "vr"; row: number; index: number }
  | null;

type HitTarget =
  | { action: "remove"; type: "h"; index: number }
  | { action: "remove"; type: "v"; index: number }
  | { action: "remove"; type: "vr"; row: number; index: number }
  | { action: "drag"; type: "h"; index: number }
  | { action: "drag"; type: "v"; index: number }
  | { action: "drag"; type: "vr"; row: number; index: number }
  | null;

// ---- helpers ----------------------------------------------------------------

/** Build row-boundary y coords (CSS px) from image layout + hLines. */
function rowBounds(
  oy: number,
  h: number,
  hLines: number[],
  count: number,
): { y0: number; y1: number }[] {
  const bounds: { y0: number; y1: number }[] = [];
  for (let i = 0; i < count; i++) {
    bounds.push({
      y0: oy + (i === 0 ? 0 : hLines[i - 1]! * h),
      y1: oy + (i >= hLines.length ? h : hLines[i]! * h),
    });
  }
  return bounds;
}

// ---- component --------------------------------------------------------------

export function SplitCanvas({
  image,
  horizontalLines,
  verticalLines,
  vLinesByRow,
  onLinesChange,
  onVLinesByRowChange,
  onRemoveLine,
  onRemoveLineByRow,
}: SplitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragTarget>(null);
  const dragRef = useRef<DragTarget>(null);
  dragRef.current = drag;

  const rowCount = horizontalLines.length + 1;

  function getLayout(containerW: number, containerH: number) {
    const imgAspect = image.naturalWidth / image.naturalHeight;
    const conAspect = containerW / containerH;
    let w: number;
    let h: number;
    if (imgAspect > conAspect) {
      w = containerW;
      h = containerW / imgAspect;
    } else {
      h = containerH;
      w = containerH * imgAspect;
    }
    return { ox: (containerW - w) / 2, oy: (containerH - h) / 2, w, h };
  }

  // ----- draw ---------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = cw * devicePixelRatio;
    canvas.height = ch * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const { ox, oy, w, h } = getLayout(cw, ch);

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(image, ox, oy, w, h);

    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // --- horizontal lines ---
    for (const fy of horizontalLines) {
      const y = oy + fy * h;
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = LINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + w, y);
      ctx.stroke();

      const hx = ox + w / 2;
      drawHandle(ctx, hx, y);
      drawRemoveButton(ctx, hx + REMOVE_OFFSET, y);

      ctx.fillStyle = LABEL_BG;
      const label = `${(fy * 100).toFixed(1)}%`;
      const tw = ctx.measureText(label).width + 10;
      const tx = ox + w - tw - 6;
      const ty = y - LINE_WIDTH - 1;
      roundRect(ctx, tx, ty - 8, tw, 17, 3);
      ctx.fill();
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(label, tx + tw / 2, ty + 1);
    }

    // --- vertical lines ---
    if (vLinesByRow) {
      const bounds = rowBounds(oy, h, horizontalLines, rowCount);
      for (let ri = 0; ri < bounds.length; ri++) {
        const { y0, y1 } = bounds[ri]!;
        const cy = (y0 + y1) / 2;
        const rowVLines = vLinesByRow[ri] ?? [];
        for (const fx of rowVLines) {
          const x = ox + fx * w;
          ctx.strokeStyle = LINE_COLOR;
          ctx.lineWidth = LINE_WIDTH;
          ctx.beginPath();
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y1);
          ctx.stroke();

          drawHandle(ctx, x, cy);
          drawRemoveButton(ctx, x + REMOVE_OFFSET, cy);
        }
      }
    } else {
      for (const fx of verticalLines) {
        const x = ox + fx * w;
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + h);
        ctx.stroke();

        drawHandle(ctx, x, oy + h / 2);
        drawRemoveButton(ctx, x, oy + h / 2 + REMOVE_OFFSET);

        ctx.fillStyle = LABEL_BG;
        const label = `${(fx * 100).toFixed(1)}%`;
        const tw = ctx.measureText(label).width + 10;
        const tx = x - tw / 2;
        const ty = oy + h + 6;
        roundRect(ctx, tx, ty, tw, 17, 3);
        ctx.fill();
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(label, tx + tw / 2, ty + 9);
      }
    }
  }, [image, horizontalLines, verticalLines, vLinesByRow]);

  function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS - 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRemoveButton(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, REMOVE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 3);
    ctx.lineTo(x + 3, y + 3);
    ctx.moveTo(x + 3, y - 3);
    ctx.lineTo(x - 3, y + 3);
    ctx.stroke();
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ----- hit testing --------------------------------------------------------
  const hitTest = useCallback(
    (clientX: number, clientY: number): HitTarget => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { ox, oy, w: iw, h: ih } = getLayout(rect.width, rect.height);

      // ---- remove buttons ----

      // Horizontal line remove buttons
      for (let i = 0; i < horizontalLines.length; i++) {
        const y = oy + horizontalLines[i]! * ih;
        const bx = ox + iw / 2 + REMOVE_OFFSET;
        if (Math.hypot(mx - bx, my - y) <= REMOVE_HIT) {
          return { action: "remove", type: "h", index: i };
        }
      }

      if (vLinesByRow) {
        // Per-row vertical line remove buttons
        const bounds = rowBounds(oy, ih, horizontalLines, rowCount);
        for (let ri = 0; ri < bounds.length; ri++) {
          const cy = (bounds[ri]!.y0 + bounds[ri]!.y1) / 2;
          const rowVLines = vLinesByRow[ri] ?? [];
          for (let vi = 0; vi < rowVLines.length; vi++) {
            const x = ox + rowVLines[vi]! * iw;
            if (Math.hypot(mx - (x + REMOVE_OFFSET), my - cy) <= REMOVE_HIT) {
              return { action: "remove", type: "vr", row: ri, index: vi };
            }
          }
        }
      } else {
        // Unified vertical line remove buttons
        for (let i = 0; i < verticalLines.length; i++) {
          const x = ox + verticalLines[i]! * iw;
          if (Math.hypot(mx - x, my - (oy + ih / 2 + REMOVE_OFFSET)) <= REMOVE_HIT) {
            return { action: "remove", type: "v", index: i };
          }
        }
      }

      // ---- drag handles ----

      // Horizontal line handles
      for (let i = 0; i < horizontalLines.length; i++) {
        const y = oy + horizontalLines[i]! * ih;
        if (Math.abs(my - y) <= HANDLE_HIT && mx >= ox && mx <= ox + iw) {
          return { action: "drag", type: "h", index: i };
        }
      }

      if (vLinesByRow) {
        // Per-row vertical line handles
        const bounds = rowBounds(oy, ih, horizontalLines, rowCount);
        for (let ri = 0; ri < bounds.length; ri++) {
          const rowVLines = vLinesByRow[ri] ?? [];
          for (let vi = 0; vi < rowVLines.length; vi++) {
            const x = ox + rowVLines[vi]! * iw;
            if (Math.abs(mx - x) <= HANDLE_HIT && my >= bounds[ri]!.y0 && my <= bounds[ri]!.y1) {
              return { action: "drag", type: "vr", row: ri, index: vi };
            }
          }
        }
      } else {
        // Unified vertical line handles
        for (let i = 0; i < verticalLines.length; i++) {
          const x = ox + verticalLines[i]! * iw;
          if (Math.abs(mx - x) <= HANDLE_HIT && my >= oy && my <= oy + ih) {
            return { action: "drag", type: "v", index: i };
          }
        }
      }

      return null;
    },
    [horizontalLines, verticalLines, vLinesByRow],
  );

  // ----- pointer events -----------------------------------------------------
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const target = hitTest(e.clientX, e.clientY);
      if (!target) return;

      if (target.action === "remove") {
        if (target.type === "vr") {
          onRemoveLineByRow?.(target.row, target.index);
        } else {
          onRemoveLine(target.type, target.index);
        }
        return;
      }

      // Start drag
      if (target.type === "vr") {
        setDrag({ type: "vr", row: target.row, index: target.index });
      } else {
        setDrag({ type: target.type, index: target.index });
      }
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [hitTest, onRemoveLine, onRemoveLineByRow],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const t = dragRef.current;
      if (!t) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { ox, oy, w: iw, h: ih } = getLayout(rect.width, rect.height);

      if (t.type === "h") {
        const lines = [...horizontalLines];
        lines[t.index] = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top - oy) / ih));
        onLinesChange(lines, verticalLines);
      } else if (t.type === "vr") {
        if (!vLinesByRow || !onVLinesByRowChange) return;
        const next = vLinesByRow.map((row) => [...row]);
        next[t.row]![t.index] = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left - ox) / iw));
        onVLinesByRowChange(next);
      } else {
        const vlines = [...verticalLines];
        vlines[t.index] = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left - ox) / iw));
        onLinesChange(horizontalLines, vlines);
      }
    },
    [horizontalLines, verticalLines, vLinesByRow, onLinesChange, onVLinesByRowChange],
  );

  const handlePointerUp = useCallback(() => setDrag(null), []);

  // ----- resize + re-draw ---------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    draw();
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg border bg-muted"
      style={{
        aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}`,
        maxHeight: "70vh",
      }}
    >
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${drag ? "cursor-grabbing" : "cursor-default"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
