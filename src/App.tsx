import { useState, useRef, useCallback, useEffect, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { computeTiledLayout } from "@/image-splitter/split-engine";
import { SplitCanvas } from "@/image-splitter/SplitCanvas";
import "./index.css";
import sampleUrl from "./sample.png";

// ----- helpers ---------------------------------------------------------------

function imageFromURL(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("加载图片失败"));
    img.src = url;
  });
}

// ----- tile extraction ------------------------------------------------------

interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function extractTile(img: HTMLImageElement, tile: TileRect): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = tile.w;
    canvas.height = tile.h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
    canvas.toBlob(resolve, "image/png");
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ----- component ------------------------------------------------------------

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<{ x: number; y: number }[]>([]);
  const [boxPxW, setBoxPxW] = useState(512);
  const [boxPxH, setBoxPxH] = useState(512);
  const [overlapX, setOverlapX] = useState(0);
  const [overlapY, setOverlapY] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [tiles, setTiles] = useState<{ blob: Blob; idx: number; w: number; h: number }[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- image loading -------------------------------------------------------

  const loadImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = await imageFromURL(url);
    setImage(img);
    setBoxes([]);
    setTiles(null);
    setSelectedIndex(null);
    // Suggest initial box size (fit ~8 boxes in the smaller dimension)
    const tile = Math.round(Math.min(img.naturalWidth, img.naturalHeight) / 3);
    setBoxPxW(tile);
    setBoxPxH(tile);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadImage(file);
      e.target.value = "";
    },
    [loadImage],
  );

  // Auto-load sample image on mount
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      const tile = Math.round(Math.min(img.naturalWidth, img.naturalHeight) / 3);
      setBoxPxW(tile);
      setBoxPxH(tile);
    };
    img.src = sampleUrl;
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- drag & drop ---------------------------------------------------------

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) loadImage(file);
    },
    [loadImage],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  // ----- box management -----------------------------------------------------

  const addBox = useCallback(() => {
    if (!image) return;
    const offset = boxes.length * 0.15;
    const x = clamp(0.05 + offset, 0, 0.75);
    const y = clamp(0.05 + offset, 0, 0.75);
    setBoxes((prev) => [...prev, { x, y }]);
    setSelectedIndex(boxes.length);
    setTiles(null);
  }, [boxes.length, image]);

  const addBoxAt = useCallback((xFrac: number, yFrac: number) => {
    if (!image) return;
    setBoxes((prev) => [...prev, { x: xFrac, y: yFrac }]);
    setSelectedIndex(boxes.length);
    setTiles(null);
  }, [boxes.length, image]);

  const removeBox = useCallback((index: number) => {
    setBoxes((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex((prev) => (prev === index ? null : prev ?? null));
    setTiles(null);
  }, []);

  const handleBoxesChange = useCallback((next: { x: number; y: number }[]) => {
    setBoxes(next);
    setTiles(null);
  }, []);

  const handleBoxResize = useCallback((wFrac: number, hFrac: number) => {
    if (!image) return;
    setBoxPxW(clamp(Math.round(wFrac * image.naturalWidth), 8, image.naturalWidth));
    setBoxPxH(clamp(Math.round(hFrac * image.naturalHeight), 8, image.naturalHeight));
  }, [image]);

  const handleSelect = useCallback((i: number | null) => {
    setSelectedIndex(i);
  }, []);

  // ----- auto-arrange --------------------------------------------------------

  const autoArrange = useCallback(() => {
    if (!image) return;
    const result = computeTiledLayout(
      image.naturalWidth,
      image.naturalHeight,
      boxPxW,
      boxPxH,
      overlapX,
      overlapY,
    );
    setBoxes(
      result.map((b) => ({
        x: b.x / image.naturalWidth,
        y: b.y / image.naturalHeight,
      })),
    );
    setSelectedIndex(null);
    setTiles(null);
  }, [image, boxPxW, boxPxH, overlapX, overlapY]);

  // ----- extract tiles -------------------------------------------------------

  const handleExtract = useCallback(async () => {
    if (!image || boxes.length === 0) return;
    const imgW = image.naturalWidth;
    const imgH = image.naturalHeight;

    const results: { blob: Blob; idx: number; w: number; h: number }[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      const px = Math.round(b.x * imgW);
      const py = Math.round(b.y * imgH);
      const tile: TileRect = { x: px, y: py, w: boxPxW, h: boxPxH };
      const blob = await extractTile(image, tile);
      if (blob) results.push({ blob, idx: i, w: boxPxW, h: boxPxH });
    }
    setTiles(results);
  }, [image, boxes, boxPxW, boxPxH]);

  // ----- download ------------------------------------------------------------

  const downloadTile = useCallback((blob: Blob, idx: number) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tile-${idx + 1}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadAll = useCallback(async () => {
    if (!tiles) return;
    for (const { blob, idx } of tiles) {
      await new Promise((r) => setTimeout(r, 200));
      downloadTile(blob, idx);
    }
  }, [tiles, downloadTile]);

  // ----- render --------------------------------------------------------------

  const boxWFrac = image ? boxPxW / image.naturalWidth : 0.25;
  const boxHFrac = image ? boxPxH / image.naturalHeight : 0.25;

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <header className="text-center">
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-2xl font-bold">Grid Cut — 图片切片工具</h1>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex size-6 items-center justify-center rounded-full border text-xs text-muted-foreground transition-colors hover:bg-muted"
            title="使用帮助"
          >
            ?
          </button>
        </div>
        <p className="text-muted-foreground text-sm">
          用统一大小的矩形框标出切片区域，支持自动排列和手动拖拽。
        </p>

        {showHelp && (
          <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-left text-sm text-muted-foreground">
            <ul className="space-y-1.5">
              <li><strong className="text-foreground">框大小</strong> — 设置切片像素宽高（所有框统一尺寸）。</li>
              <li><strong className="text-foreground">重叠</strong> — 自动排列时相邻切片的重叠像素数。</li>
              <li><strong className="text-foreground">自动排列</strong> — 用当前框大小和重叠自动铺满图片。</li>
              <li><strong className="text-foreground">拖拽框</strong> — 移动位置；拖拽角上的白色方块可统一缩放所有框。</li>
              <li><strong className="text-foreground">点击框</strong> — 选中后右上角显示 × 删除按钮。</li>
              <li><strong className="text-foreground">双击框</strong> — 快速删除该框。</li>
              <li><strong className="text-foreground">双击空白处</strong> — 在该位置添加一个新框。</li>
              <li><strong className="text-foreground">+ 添加框</strong> — 手动在图片上添加一个框。</li>
              <li><strong className="text-foreground">提取切片</strong> — 按所有框的位置裁切图片并导出。</li>
            </ul>
          </div>
        )}
      </header>

      {!image ? (
        // ----- 拖拽上传区 -----------------------------------------------------
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-16 transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-muted-foreground text-5xl leading-none">+</div>
          <p className="text-muted-foreground text-sm">拖拽图片到此处，或点击选择文件</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        // ----- 主工作区 -------------------------------------------------------
        <>
          {/* 控制栏 */}
          <div className="flex flex-wrap items-end gap-4">
            {/* 框大小 */}
            <div className="flex items-end gap-1">
              <div>
                <Label className="text-xs text-muted-foreground">框宽</Label>
                <Input
                  type="number"
                  min={8}
                  max={image.naturalWidth}
                  value={boxPxW}
                  onChange={(e) => setBoxPxW(clamp(Number(e.target.value) || 8, 8, image.naturalWidth))}
                  className="h-8 w-20 text-xs"
                />
              </div>
              <span className="pb-1 text-xs text-muted-foreground">×</span>
              <div>
                <Label className="text-xs text-muted-foreground">框高</Label>
                <Input
                  type="number"
                  min={8}
                  max={image.naturalHeight}
                  value={boxPxH}
                  onChange={(e) => setBoxPxH(clamp(Number(e.target.value) || 8, 8, image.naturalHeight))}
                  className="h-8 w-20 text-xs"
                />
              </div>
              <span className="pb-1 text-xs text-muted-foreground">px</span>
            </div>

            {/* 重叠 */}
            <div className="flex items-end gap-1">
              <div>
                <Label className="text-xs text-muted-foreground">重叠 X</Label>
                <Input
                  type="number"
                  min={0}
                  max={boxPxW - 1}
                  value={overlapX}
                  onChange={(e) => setOverlapX(clamp(Number(e.target.value) || 0, 0, boxPxW - 1))}
                  className="h-8 w-16 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">重叠 Y</Label>
                <Input
                  type="number"
                  min={0}
                  max={boxPxH - 1}
                  value={overlapY}
                  onChange={(e) => setOverlapY(clamp(Number(e.target.value) || 0, 0, boxPxH - 1))}
                  className="h-8 w-16 text-xs"
                />
              </div>
              <span className="pb-1 text-xs text-muted-foreground">px</span>
            </div>

            <Button size="sm" variant="secondary" onClick={autoArrange}>
              自动排列
            </Button>
            <Button size="sm" variant="outline" onClick={addBox}>
              + 添加框
            </Button>

            <div className="ml-auto flex gap-2">
              <Button onClick={handleExtract} disabled={boxes.length === 0}>
                提取切片
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImage(null);
                  setBoxes([]);
                  setTiles(null);
                  setSelectedIndex(null);
                }}
              >
                重新选择
              </Button>
            </div>
          </div>

          {/* 统计 */}
          {boxes.length > 0 && (
            <div className="-mt-2 flex gap-4 text-xs text-muted-foreground">
              <span>{boxes.length} 个框</span>
              <span>
                {boxPxW}×{boxPxH} px / 块
              </span>
              {overlapX + overlapY > 0 && (
                <span>
                  重叠 {overlapX}×{overlapY} px
                </span>
              )}
            </div>
          )}

          {/* 画布 */}
          <SplitCanvas
            image={image}
            boxes={boxes}
            boxW={boxWFrac}
            boxH={boxHFrac}
            selectedIndex={selectedIndex}
            onBoxesChange={handleBoxesChange}
            onSelect={handleSelect}
            onRemoveBox={removeBox}
            onBoxResize={handleBoxResize}
            onAddBox={addBoxAt}
          />

          {/* 框列表 */}
          {boxes.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {boxes.map((b, i) => (
                <div
                  key={i}
                  className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 ${
                    i === selectedIndex ? "bg-red-100 text-red-600 dark:bg-red-900/30" : "hover:bg-muted"
                  }`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <span>
                    #{i + 1} ({Math.round(b.x * image!.naturalWidth)}, {Math.round(b.y * image!.naturalHeight)})
                  </span>
                  <button
                    className="ml-0.5 font-bold leading-none hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBox(i);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 操作 */}
          {boxes.length > 0 && (
            <div className="-mt-2 flex flex-wrap items-center gap-4">
              <Button onClick={handleExtract} disabled={boxes.length === 0}>
                提取切片
              </Button>
              <span className="text-xs text-muted-foreground">共 {boxes.length} 块</span>
              {tiles && tiles.length > 1 && (
                <Button variant="secondary" size="sm" onClick={downloadAll}>
                  全部下载
                </Button>
              )}
            </div>
          )}

          {/* 切片预览 */}
          {tiles && tiles.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <h2 className="mb-4 text-sm font-semibold">切片预览（{tiles.length} 块）</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {tiles.map(({ blob, idx, w, h }) => (
                    <div key={idx} className="group relative overflow-hidden rounded-lg border">
                      <img
                        src={URL.createObjectURL(blob)}
                        alt={`切片 ${idx + 1}`}
                        className="block h-auto w-full"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="rounded bg-background px-2 py-1 text-xs font-medium text-foreground shadow">
                          {w} × {h}
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button size="sm" variant="secondary" onClick={() => downloadTile(blob, idx)}>
                          保存
                        </Button>
                      </div>
                      <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default App;
