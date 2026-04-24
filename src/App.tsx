import { useState, useRef, useCallback, useEffect, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { autoDetectSplits, autoDetectFreeSplits } from "@/image-splitter/split-engine";
import { SplitCanvas } from "@/image-splitter/SplitCanvas";
import "./index.css";
import sampleUrl from "./sample.png";

// ----- helpers ---------------------------------------------------------------

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function imageFromURL(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("加载图片失败"));
    img.src = url;
  });
}

function getImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
}

function evenLines(count: number): number[] {
  const lines: number[] = [];
  for (let i = 1; i <= count; i++) lines.push(i / (count + 1));
  return lines;
}

function midpointOfLargestGap(lines: number[]): number {
  if (lines.length === 0) return 0.5;
  const sorted = [...lines].sort((a, b) => a - b);
  let best = 0.5;
  let bestGap = 0;
  let prev = 0;
  for (const p of sorted) {
    const gap = p - prev;
    if (gap > bestGap) {
      bestGap = gap;
      best = prev + gap / 2;
    }
    prev = p;
  }
  const lastGap = 1 - prev;
  if (lastGap > bestGap) best = prev + lastGap / 2;
  return Math.round(best * 100) / 100;
}

// ----- tile extraction ------------------------------------------------------

interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeTiles(imgW: number, imgH: number, hLines: number[], vLines: number[]): TileRect[] {
  const ys = [0, ...hLines, imgH];
  const xs = [0, ...vLines, imgW];
  const tiles: TileRect[] = [];
  for (let row = 0; row < ys.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      tiles.push({
        x: xs[col]!,
        y: ys[row]!,
        w: xs[col + 1]! - xs[col]!,
        h: ys[row + 1]! - ys[row]!,
      });
    }
  }
  return tiles;
}

function computeTilesPerRow(
  imgW: number,
  imgH: number,
  hLines: number[],
  vLinesByRow: number[][],
): TileRect[] {
  const ys = [0, ...hLines, imgH];
  const tiles: TileRect[] = [];
  for (let row = 0; row < ys.length - 1; row++) {
    const xs = [0, ...(vLinesByRow[row] ?? []), imgW];
    for (let col = 0; col < xs.length - 1; col++) {
      tiles.push({
        x: xs[col]!,
        y: ys[row]!,
        w: xs[col + 1]! - xs[col]!,
        h: ys[row + 1]! - ys[row]!,
      });
    }
  }
  return tiles;
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

// ----- component ------------------------------------------------------------

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [hLines, setHLines] = useState<number[]>([]);
  const [vLines, setVLines] = useState<number[]>([]);
  const [vLinesByRow, setVLinesByRow] = useState<number[][]>([]);
  const [perRowMode, setPerRowMode] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [tiles, setTiles] = useState<{ blob: Blob; idx: number; w: number; h: number }[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-load sample image on mount
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      setHLines(evenLines(2));
      setVLines(evenLines(2));
    };
    img.src = sampleUrl;
    return () => {
      cancelled = true;
    };
  }, []);

  const hCount = hLines.length;
  const vCount = vLines.length;
  const rowCount = hCount + 1;

  // ----- mode toggle ---------------------------------------------------------

  const switchToPerRow = useCallback(() => {
    // Copy current vLines to each row
    setVLinesByRow(hLines.map(() => [...vLines]));
    setPerRowMode(true);
  }, [hLines, vLines]);

  const switchToUnified = useCallback(() => {
    setPerRowMode(false);
    setVLinesByRow([]);
  }, []);

  // ----- auto-detect ---------------------------------------------------------

  const runDetect = useCallback(
    async (fn: typeof autoDetectSplits, img: HTMLImageElement) => {
      if (hCount <= 0) {
        setHLines([]);
        setVLines([]);
        return;
      }
      setAnalysing(true);
      try {
        await new Promise((r) => setTimeout(r, 50));
        const data = getImageData(img);
        if (perRowMode) {
          // Detect horizontal splits globally
          const hResult = fn(data, hCount, 0, { maxAnalysisDim: 500, tolerance: 0.25 });
          const newHLines = hResult.horizontalLines.map((p) => p / img.naturalHeight);
          setHLines(newHLines);
          // Detect vertical splits per row
          const next: number[][] = [];
          const ys = [0, ...newHLines.map((f) => Math.round(f * img.naturalHeight)), img.naturalHeight];
          for (let ri = 0; ri < newHLines.length + 1; ri++) {
            const y0 = ys[ri]!;
            const y1 = ys[ri + 1]!;
            // Crop row region for detection
            const rowCanvas = document.createElement("canvas");
            rowCanvas.width = img.naturalWidth;
            rowCanvas.height = y1 - y0;
            const rctx = rowCanvas.getContext("2d")!;
            rctx.drawImage(img, 0, y0, img.naturalWidth, y1 - y0, 0, 0, img.naturalWidth, y1 - y0);
            const rowData = rctx.getImageData(0, 0, img.naturalWidth, y1 - y0);
            const nRows = vLinesByRow[ri]?.length ?? vLines.length;
            const vResult = fn(rowData, 0, nRows || 1, { maxAnalysisDim: 500, tolerance: 0.25 });
            next.push(vResult.verticalLines.map((p) => p / img.naturalWidth));
          }
          setVLinesByRow(next);
        } else {
          const v = vLines.length;
          const result = fn(data, hCount, v, { maxAnalysisDim: 500, tolerance: 0.25 });
          setHLines(result.horizontalLines.map((p) => p / img.naturalHeight));
          setVLines(result.verticalLines.map((p) => p / img.naturalWidth));
        }
        setTiles(null);
      } finally {
        setAnalysing(false);
      }
    },
    [hCount, vLines.length, perRowMode, vLinesByRow],
  );

  const detect = useCallback((img: HTMLImageElement) => runDetect(autoDetectSplits, img), [runDetect]);
  const detectFree = useCallback((img: HTMLImageElement) => runDetect(autoDetectFreeSplits, img), [runDetect]);

  // ----- image loading -------------------------------------------------------

  const loadImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const url = await readFileAsDataURL(file);
    const img = await imageFromURL(url);
    setImage(img);
    setTiles(null);
    setPerRowMode(false);
    setVLinesByRow([]);
    setHLines(evenLines(2));
    setVLines(evenLines(2));
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadImage(file);
      e.target.value = "";
    },
    [loadImage],
  );

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

  // ----- line management (unified mode) --------------------------------------

  const handleLinesChange = useCallback(
    (h: number[], v: number[]) => {
      setHLines(h);
      setVLines(v);
      setTiles(null);
    },
    [],
  );

  const setEvenHLines = useCallback((count: number) => {
    setHLines(evenLines(count));
    if (perRowMode) {
      // Adjust vLinesByRow: add/remove rows
      setVLinesByRow((prev) => evenLines(count).map((_, i) => prev[i] ?? prev[prev.length - 1] ?? []));
    }
    setTiles(null);
  }, [perRowMode]);

  const setEvenVLines = useCallback((count: number) => {
    setVLines(evenLines(count));
    setTiles(null);
  }, []);

  const addHLine = useCallback(() => {
    setHLines((prev) => {
      const pos = midpointOfLargestGap(prev);
      const next = [...prev, pos].sort((a, b) => a - b);
      if (perRowMode) {
        setVLinesByRow((rv) => {
          const idx = next.indexOf(pos);
          return [...rv.slice(0, idx), [], ...rv.slice(idx)];
        });
      }
      return next;
    });
    setTiles(null);
  }, [perRowMode]);

  const addVLine = useCallback(() => {
    setVLines((prev) => {
      const pos = midpointOfLargestGap(prev);
      return [...prev, pos].sort((a, b) => a - b);
    });
    setTiles(null);
  }, []);

  const handleRemoveLine = useCallback((type: "h" | "v", index: number) => {
    if (type === "h") {
      setHLines((prev) => prev.filter((_, i) => i !== index));
      if (perRowMode) {
        setVLinesByRow((rv) => rv.filter((_, i) => i !== index));
      }
    } else {
      setVLines((prev) => prev.filter((_, i) => i !== index));
    }
    setTiles(null);
  }, [perRowMode]);

  // ----- line management (per-row mode) -------------------------------------

  const setRowCols = useCallback((row: number, count: number) => {
    setVLinesByRow((prev) => {
      const next = prev.map((r) => [...r]);
      next[row] = evenLines(count);
      return next;
    });
    setTiles(null);
  }, []);

  const addRowVLine = useCallback((row: number) => {
    setVLinesByRow((prev) => {
      const next = prev.map((r) => [...r]);
      const pos = midpointOfLargestGap(next[row]!);
      next[row] = [...next[row]!, pos].sort((a, b) => a - b);
      return next;
    });
    setTiles(null);
  }, []);

  const handleRemoveLineByRow = useCallback((row: number, idx: number) => {
    setVLinesByRow((prev) => {
      const next = prev.map((r) => [...r]);
      next[row] = next[row]!.filter((_, i) => i !== idx);
      return next;
    });
    setTiles(null);
  }, []);

  const handleVLinesByRowChange = useCallback((next: number[][]) => {
    setVLinesByRow(next);
    setTiles(null);
  }, []);

  // ----- tile extraction -----------------------------------------------------

  const handleExtract = useCallback(async () => {
    if (!image) return;
    const imgW = image.naturalWidth;
    const imgH = image.naturalHeight;
    const hPx = hLines.map((f) => Math.round(f * imgH));

    let tileDefs: TileRect[];
    if (perRowMode) {
      const vPxByRow = vLinesByRow.map((row) => row.map((f) => Math.round(f * imgW)));
      tileDefs = computeTilesPerRow(imgW, imgH, hPx, vPxByRow);
    } else {
      const vPx = vLines.map((f) => Math.round(f * imgW));
      tileDefs = computeTiles(imgW, imgH, hPx, vPx);
    }

    const results: { blob: Blob; idx: number; w: number; h: number }[] = [];
    for (let i = 0; i < tileDefs.length; i++) {
      const blob = await extractTile(image, tileDefs[i]!);
      if (blob) results.push({ blob, idx: i, w: tileDefs[i]!.w, h: tileDefs[i]!.h });
    }
    setTiles(results);
  }, [image, hLines, vLines, perRowMode, vLinesByRow]);

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

  // ----- derived display ----------------------------------------------------

  const totalTiles = image
    ? perRowMode
      ? vLinesByRow.reduce((sum, row) => sum + (row.length + 1), 0)
      : (hCount + 1) * (vCount + 1)
    : 0;

  // ----- render --------------------------------------------------------------

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <header className="text-center">
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-2xl font-bold">Grid Cut — 图片切分工具</h1>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex size-6 items-center justify-center rounded-full border text-xs text-muted-foreground transition-colors hover:bg-muted"
            title="使用帮助"
          >
            ?
          </button>
        </div>
        <p className="text-muted-foreground text-sm">
          上传图片后自动检测内容感知分割线，支持拖拽微调和自由增删分割线。
        </p>

        {showHelp && (
          <div className="mt-4 rounded-lg border bg-muted/50 p-4 text-left text-sm text-muted-foreground">
            <ul className="space-y-1.5">
              <li><strong className="text-foreground">行/列步进器（− / +）</strong> — 快速设置为均匀等分网格。</li>
              <li><strong className="text-foreground">拖拽手柄（●）</strong> — 在画布上拖拽红点，移动分割线位置。</li>
              <li><strong className="text-foreground">+ 横线 / + 竖线</strong> — 在最大间隙处新增一条分割线，不影响已有线条。</li>
              <li><strong className="text-foreground">× 按钮</strong> — 点击线条手柄旁的 ×，删除该分割线。</li>
              <li><strong className="text-foreground">等分检测</strong> — 在均分位置附近搜索最平滑的区域（适合常规网格）。</li>
              <li><strong className="text-foreground">自由检测</strong> — 不预设均匀位置，直接找出梯度最低的区域（适合不规则切分）。</li>
              <li><strong className="text-foreground">逐行模式</strong> — 每行可独立设置列数，适合行列数不统一的布局（如首行 3 列、次行 2 列）。</li>
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
          <div className="flex flex-wrap items-center gap-4">
            {/* 行数步进器 */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">行：</label>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={hCount <= 1}
                  onClick={() => setEvenHLines(hCount - 1)}
                >
                  −
                </Button>
                <span className="w-8 text-center text-sm tabular-nums">{hCount + 1}</span>
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={hCount >= 9}
                  onClick={() => setEvenHLines(hCount + 1)}
                >
                  +
                </Button>
              </div>
            </div>

            {/* 列数步进器（仅非逐行模式） */}
            {!perRowMode && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">列：</label>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    disabled={vCount <= 1}
                    onClick={() => setEvenVLines(vCount - 1)}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center text-sm tabular-nums">{vCount + 1}</span>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    disabled={vCount >= 9}
                    onClick={() => setEvenVLines(vCount + 1)}
                  >
                    +
                  </Button>
                </div>
              </div>
            )}

            {!perRowMode && (
              <>
                <Button size="sm" variant="outline" onClick={addHLine}>+ 横线</Button>
                <Button size="sm" variant="outline" onClick={addVLine}>+ 竖线</Button>
              </>
            )}

            <div className="ml-auto flex gap-2">
              <Button
                variant={perRowMode ? "secondary" : "outline"}
                size="sm"
                onClick={() => (perRowMode ? switchToUnified() : switchToPerRow())}
                disabled={hCount < 1}
              >
                {perRowMode ? "← 统一切分" : "逐行模式"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => { if (image) detect(image); }}
                disabled={analysing}
              >
                {analysing ? "分析中…" : "等分检测"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => { if (image) detectFree(image); }}
                disabled={analysing}
              >
                自由检测
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImage(null);
                  setHLines([]);
                  setVLines([]);
                  setVLinesByRow([]);
                  setPerRowMode(false);
                  setTiles(null);
                }}
              >
                重新选择
              </Button>
            </div>
          </div>

          {/* 逐行模式：每行的列控制 */}
          {perRowMode && (
            <div className="-mt-2 flex flex-wrap gap-x-6 gap-y-1">
              {hLines.map((_, i) => {
                const prev = i === 0 ? 0 : hLines[i - 1]!;
                const curr = hLines[i]!;
                const rowLabel = `第${i + 1}行`;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{rowLabel} 列：</span>
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="size-6"
                        disabled={(vLinesByRow[i]?.length ?? 0) <= 1}
                        onClick={() => setRowCols(i, Math.max(1, (vLinesByRow[i]?.length ?? 0) - 1))}
                      >
                        −
                      </Button>
                      <span className="w-6 text-center tabular-nums">
                        {(vLinesByRow[i]?.length ?? 0) + 1}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="size-6"
                        disabled={(vLinesByRow[i]?.length ?? 0) >= 9}
                        onClick={() => setRowCols(i, Math.min(9, (vLinesByRow[i]?.length ?? 0) + 1))}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                );
              })}
              {/* 最后一行 */}
              <div key="last" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>第{rowCount}行列：</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-6"
                    disabled={(vLinesByRow[rowCount - 1]?.length ?? 0) <= 1}
                    onClick={() => setRowCols(rowCount - 1, Math.max(1, (vLinesByRow[rowCount - 1]?.length ?? 0) - 1))}
                  >
                    −
                  </Button>
                  <span className="w-6 text-center tabular-nums">
                    {(vLinesByRow[rowCount - 1]?.length ?? 0) + 1}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-6"
                    disabled={(vLinesByRow[rowCount - 1]?.length ?? 0) >= 9}
                    onClick={() => setRowCols(rowCount - 1, Math.min(9, (vLinesByRow[rowCount - 1]?.length ?? 0) + 1))}
                  >
                    +
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 统计 */}
          {hCount + (perRowMode ? 0 : vCount) > 0 && (
            <div className="-mt-2 flex gap-4 text-xs text-muted-foreground">
              <span>横向 {hCount} 条</span>
              {perRowMode ? (
                <span>
                  {vLinesByRow.map((r, i) => `${r.length}列`).join(" / ")}
                </span>
              ) : (
                <span>纵向 {vCount} 条</span>
              )}
              <span>共 {totalTiles} 块</span>
            </div>
          )}

          {/* 画布 */}
          {analysing ? (
            <div className="flex items-center justify-center rounded-lg border bg-muted p-12">
              <p className="text-muted-foreground text-sm">正在分析图片内容…</p>
            </div>
          ) : (
            <SplitCanvas
              image={image}
              horizontalLines={hLines}
              verticalLines={vLines}
              vLinesByRow={perRowMode ? vLinesByRow : undefined}
              onLinesChange={handleLinesChange}
              onVLinesByRowChange={perRowMode ? handleVLinesByRowChange : undefined}
              onRemoveLine={handleRemoveLine}
              onRemoveLineByRow={perRowMode ? handleRemoveLineByRow : undefined}
            />
          )}

          {/* 操作 */}
          {totalTiles > 1 && (
            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={handleExtract} disabled={analysing}>提取切片</Button>
              <span className="text-xs text-muted-foreground">共 {totalTiles} 块</span>
              {tiles && tiles.length > 1 && (
                <Button variant="secondary" size="sm" onClick={downloadAll}>全部下载</Button>
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
