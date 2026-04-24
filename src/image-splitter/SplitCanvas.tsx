import { useRef, useEffect, useCallback, useState } from "react";

interface Box {
  x: number;
  y: number;
}

type Corner = "tl" | "tr" | "bl" | "br";

interface SplitCanvasProps {
  image: HTMLImageElement;
  boxes: Box[];
  /** Box width as fraction [0, 1] of image width (global — all boxes share). */
  boxW: number;
  /** Box height as fraction [0, 1] of image height (global — all boxes share). */
  boxH: number;
  selectedIndex: number | null;
  onBoxesChange: (boxes: Box[]) => void;
  onSelect: (i: number | null) => void;
  onRemoveBox: (i: number) => void;
  /** Called when a resize handle is dragged to change the global box size. */
  onBoxResize: (wFrac: number, hFrac: number) => void;
  /** Called on double-click in blank area: add a box at the given fraction coords. */
  onAddBox: (xFrac: number, yFrac: number) => void;
}

const SELECTED_COLOR = "#ef4444";
const BOX_COLOR = "#3b82f6";
const BOX_ALPHA = 0.12;
const BORDER_WIDTH = 1.5;
const SELECTED_BORDER = 2.5;
const REMOVE_RADIUS = 7;
const REMOVE_HIT = 11;
const HANDLE_SIZE = 7;
const HANDLE_HIT = 10;
const MIN_BOX_FRAC = 0.005;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const CORNER_CURSOR: Record<Corner, string> = {
  tl: "nw",
  tr: "ne",
  bl: "sw",
  br: "se",
};

type DragState =
  | { index: number; mode: "move"; ox: number; oy: number }
  | {
      index: number;
      mode: "resize";
      corner: Corner;
      anchor: { x: number; y: number };
      startBox: { x: number; y: number };
    }
  | null;

type HitResult =
  | { index: number; action: "remove" }
  | { index: number; action: "resize"; corner: Corner }
  | { index: number; action: "select" }
  | null;

export function SplitCanvas({
  image,
  boxes,
  boxW,
  boxH,
  selectedIndex,
  onBoxesChange,
  onSelect,
  onRemoveBox,
  onBoxResize,
  onAddBox,
}: SplitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [hoveredCorner, setHoveredCorner] = useState<Corner | null>(null);

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

      // Resize handles (only on selected)
      if (selected) {
        const corners: [number, number, Corner][] = [
          [bx, by, "tl"],
          [bx + bw, by, "tr"],
          [bx, by + bh, "bl"],
          [bx + bw, by + bh, "br"],
        ];
        for (const [hx, hy] of corners) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(hx - HANDLE_SIZE, hy - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
          ctx.strokeStyle = SELECTED_COLOR;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hx - HANDLE_SIZE, hy - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
        }
      }
    }
  }, [image, boxes, boxW, boxH, selectedIndex]);

  // ----- hit testing --------------------------------------------------------
  const hitTest = useCallback(
    (clientX: number, clientY: number): HitResult => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);

      // Check resize handles on selected box first (highest priority)
      if (selectedIndex != null) {
        const s = boxes[selectedIndex];
        if (s) {
          const sx = ox + s.x * w;
          const sy = oy + s.y * h;
          const sw = boxW * w;
          const sh = boxH * h;
          const corners: [number, number, Corner][] = [
            [sx, sy, "tl"],
            [sx + sw, sy, "tr"],
            [sx, sy + sh, "bl"],
            [sx + sw, sy + sh, "br"],
          ];
          for (const [cx, cy, corner] of corners) {
            if (Math.abs(mx - cx) <= HANDLE_HIT && Math.abs(my - cy) <= HANDLE_HIT) {
              return { index: selectedIndex, action: "resize", corner };
            }
          }
        }
      }

      // Check remove button (second priority)
      if (selectedIndex != null) {
        const s = boxes[selectedIndex];
        if (s) {
          const rx = ox + s.x * w + boxW * w;
          const ry = oy + s.y * h;
          if (Math.hypot(mx - rx, my - ry) <= REMOVE_HIT) {
            return { index: selectedIndex, action: "remove" };
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
          return { index: i, action: "select" };
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

      if (hit.action === "remove") {
        onRemoveBox(hit.index);
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);

      if (hit.action === "resize") {
        const b = boxes[hit.index];
        if (!b) return;
        // Compute anchor (opposite corner) in fraction space
        let anchorX: number, anchorY: number;
        switch (hit.corner) {
          case "tl": anchorX = b.x + boxW; anchorY = b.y + boxH; break;
          case "tr": anchorX = b.x; anchorY = b.y + boxH; break;
          case "bl": anchorX = b.x + boxW; anchorY = b.y; break;
          case "br": anchorX = b.x; anchorY = b.y; break;
        }
        setDrag({
          index: hit.index,
          mode: "resize",
          corner: hit.corner,
          anchor: { x: anchorX, y: anchorY },
          startBox: { x: b.x, y: b.y },
        });
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        return;
      }

      // Start move drag
      const b = boxes[hit.index]!;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setDrag({
        index: hit.index,
        mode: "move",
        ox: mx - (ox + b.x * w),
        oy: my - (oy + b.y * h),
      });
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [hitTest, onSelect, onRemoveBox, boxes, boxW, boxH],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);

      const d = dragRef.current;
      if (d) {
        if (d.mode === "move") {
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          let nx = (mx - d.ox - ox) / w;
          let ny = (my - d.oy - oy) / h;
          nx = clamp(nx, 0, 1 - boxW);
          ny = clamp(ny, 0, 1 - boxH);
          const next = boxes.map((b, i) =>
            i === d.index
              ? { x: Math.round(nx * 1000) / 1000, y: Math.round(ny * 1000) / 1000 }
              : b,
          );
          onBoxesChange(next);
        } else {
          // Resize
          const mf = (e.clientX - rect.left - ox) / w;
          const mfy = (e.clientY - rect.top - oy) / h;
          const MIN_F = MIN_BOX_FRAC;

          let newW = 0, newH = 0;
          let dx = 0, dy = 0;

          switch (d.corner) {
            case "br":
              newW = clamp(mf - d.anchor.x, MIN_F, 1 - d.anchor.x);
              newH = clamp(mfy - d.anchor.y, MIN_F, 1 - d.anchor.y);
              break;
            case "tl":
              newW = clamp(d.anchor.x - mf, MIN_F, d.anchor.x);
              newH = clamp(d.anchor.y - mfy, MIN_F, d.anchor.y);
              dx = d.anchor.x - newW - d.startBox.x;
              dy = d.anchor.y - newH - d.startBox.y;
              break;
            case "tr":
              newW = clamp(mf - d.anchor.x, MIN_F, 1 - d.anchor.x);
              newH = clamp(d.anchor.y - mfy, MIN_F, d.anchor.y);
              dy = d.anchor.y - newH - d.startBox.y;
              break;
            case "bl":
              newW = clamp(d.anchor.x - mf, MIN_F, d.anchor.x);
              newH = clamp(mfy - d.anchor.y, MIN_F, 1 - d.anchor.y);
              dx = d.anchor.x - newW - d.startBox.x;
              break;
          }

          onBoxResize(newW, newH);

          if (dx !== 0 || dy !== 0) {
            const next = boxes.map((b, i) =>
              i === d.index
                ? {
                    x: Math.round((b.x + dx) * 1000) / 1000,
                    y: Math.round((b.y + dy) * 1000) / 1000,
                  }
                : b,
            );
            onBoxesChange(next);
          }
        }
        return;
      }

      // Hover detection for resize cursor
      const hit = hitTest(e.clientX, e.clientY);
      if (hit && hit.action === "resize") {
        setHoveredCorner(hit.corner);
      } else {
        setHoveredCorner(null);
      }
    },
    [boxes, boxW, boxH, onBoxesChange, onBoxResize, hitTest],
  );

  const handlePointerUp = useCallback(() => setDrag(null), []);

  // ----- double-click -------------------------------------------------------
  const handleDoubleClick = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { ox, oy, w, h } = getLayout(rect.width, rect.height);
      const mxf = (e.clientX - rect.left - ox) / w;
      const myf = (e.clientY - rect.top - oy) / h;

      // Check if double-click hits a box → remove it
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i]!;
        if (mxf >= b.x && mxf <= b.x + boxW && myf >= b.y && myf <= b.y + boxH) {
          onRemoveBox(i);
          return;
        }
      }

      // Blank area → add a new box centred on the click point
      const x = clamp(mxf - boxW / 2, 0, 1 - boxW);
      const y = clamp(myf - boxH / 2, 0, 1 - boxH);
      onAddBox(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
    },
    [boxes, boxW, boxH, onRemoveBox, onAddBox],
  );

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

  // Cursor
  let cursorClass = "cursor-default";
  if (drag) {
    if (drag.mode === "move") cursorClass = "cursor-grabbing";
    else cursorClass = `cursor-${CORNER_CURSOR[drag.corner]}-resize`;
  } else if (hoveredCorner) {
    cursorClass = `cursor-${CORNER_CURSOR[hoveredCorner]}-resize`;
  }

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
        className={`block h-full w-full ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
