import { useRef, useEffect, useCallback, useState } from "react";

interface Box {
  x: number;
  y: number;
}

interface SplitCanvasProps {
  image: HTMLImageElement;
  /** All boxes — same w/h applied globally. */
  boxes: Box[];
  /** Box width as fraction [0, 1] of image width. */
  boxW: number;
  /** Box height as fraction [0, 1] of image height. */
  boxH: number;
  selectedIndex: number | null;
  onBoxesChange: (boxes: Box[]) => void;
  onSelect: (i: number | null) => void;
  onRemoveBox: (i: number) => void;
}

const SELECTED_COLOR = "#ef4444";
const BOX_COLOR = "#3b82f6";
const BOX_ALPHA = 0.12;
const BORDER_WIDTH = 1.5;
const SELECTED_BORDER = 2.5;
const REMOVE_RADIUS = 7;
const REMOVE_HIT = 11;

export function SplitCanvas({
  image,
  boxes,
  boxW,
  boxH,
  selectedIndex,
  onBoxesChange,
  onSelect,
  onRemoveBox,
}: SplitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ index: number; ox: number; oy: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  function getLayout(cw: number, ch: number) {
    const ia = image.naturalWidth / image.naturalHeight;
    const ca = cw / ch;
    let w: number;
    let h: number;
    if (ia > ca) {
      w = cw;
      h = cw / ia;
    } else {
      h = ch;
      w = ch * ia;
    }
    return { ox: (cw - w) / 2, oy: (ch - h) / 2, w, h };
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

    ctx.font = "12px monospace";
    ctx.textBaseline = "top";

    for (let i = 0; i < boxes.length; i++) {
      const { x: fx, y: fy } = boxes[i]!;
      const bx = ox + fx * w;
      const by = oy + fy * h;
      const bw = boxW * w;
      const bh = boxH * h;
      const selected = i === selectedIndex;
      const color = selected ? SELECTED_COLOR : BOX_COLOR;

      // Fill
      ctx.fillStyle = color + Math.round(BOX_ALPHA * 255).toString(16).padStart(2, "0");
      ctx.fillRect(bx, by, bw, bh);

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? SELECTED_BORDER : BORDER_WIDTH;
      ctx.strokeRect(bx, by, bw, bh);

      // Label
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(`#${i + 1}`, bx + 4, by + 4);

      // Remove button (only on selected)
      if (selected) {
        const rx = bx + bw;
        const ry = by;
        ctx.fillStyle = SELECTED_COLOR;
        ctx.beginPath();
        ctx.arc(rx, ry, REMOVE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rx - 3, ry - 3);
        ctx.lineTo(rx + 3, ry + 3);
        ctx.moveTo(rx + 3, ry - 3);
        ctx.lineTo(rx - 3, ry + 3);
        ctx.stroke();
      }
    }
  }, [image, boxes, boxW, boxH, selectedIndex]);

  // ----- hit testing --------------------------------------------------------
  const hitTest = useCallback(
    (clientX: number, clientY: number): { index: number; onRemove: boolean } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);

      // Check remove button first (higher priority)
      if (selectedIndex != null) {
        const s = boxes[selectedIndex];
        if (s) {
          const rx = ox + s.x * w + boxW * w;
          const ry = oy + s.y * h;
          if (Math.hypot(mx - rx, my - ry) <= REMOVE_HIT) {
            return { index: selectedIndex, onRemove: true };
          }
        }
      }

      // Check boxes in reverse order (topmost drawn last)
      for (let i = boxes.length - 1; i >= 0; i--) {
        const { x: fx, y: fy } = boxes[i]!;
        const bx = ox + fx * w;
        const by = oy + fy * h;
        const bw = boxW * w;
        const bh = boxH * h;
        if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
          return { index: i, onRemove: false };
        }
      }

      return null;
    },
    [boxes, boxW, boxH, selectedIndex],
  );

  // ----- pointer events -----------------------------------------------------
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) {
        onSelect(null);
        return;
      }

      onSelect(hit.index);

      if (hit.onRemove) {
        onRemoveBox(hit.index);
        return;
      }

      // Start drag, record offset from box corner
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);
      const b = boxes[hit.index]!;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setDrag({
        index: hit.index,
        ox: mx - (ox + b.x * w),
        oy: my - (oy + b.y * h),
      });
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [hitTest, onSelect, onRemoveBox, boxes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let nx = (mx - d.ox - ox) / w;
      let ny = (my - d.oy - oy) / h;

      // Clamp so box stays within image
      nx = Math.max(0, Math.min(1 - boxW, nx));
      ny = Math.max(0, Math.min(1 - boxH, ny));

      const next = boxes.map((b, i) =>
        i === d.index ? { x: Math.round(nx * 1000) / 1000, y: Math.round(ny * 1000) / 1000 } : b,
      );
      onBoxesChange(next);
    },
    [boxes, boxW, boxH, onBoxesChange],
  );

  const handlePointerUp = useCallback(() => setDrag(null), []);

  // ----- resize + redraw ----------------------------------------------------
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
