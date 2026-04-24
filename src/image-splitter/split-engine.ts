/**
 * Split lines are stored as fractions [0, 1] of image dimensions.
 * 0 = top/left edge, 1 = bottom/right edge.
 */
export interface SplitResult {
  horizontalLines: number[];
  verticalLines: number[];
}

/**
 * Downsample image data to maxDim for faster Sobel analysis.
 * Returns the resized data plus scale factors to map back to original coords.
 */
function downsample(
  imageData: ImageData,
  maxDim: number,
): { data: ImageData; scaleX: number; scaleY: number } {
  const { width, height, data } = imageData;

  if (width <= maxDim && height <= maxDim) {
    return { data: imageData, scaleX: 1, scaleY: 1 };
  }

  const scale = Math.min(maxDim / width, maxDim / height);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);
  const newData = new Uint8ClampedArray(newWidth * newHeight * 4);

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.min(Math.round(x / scale), width - 1);
      const srcY = Math.min(Math.round(y / scale), height - 1);
      const si = (srcY * width + srcX) * 4;
      const di = (y * newWidth + x) * 4;
      newData[di] = data[si]!;
      newData[di + 1] = data[si + 1]!;
      newData[di + 2] = data[si + 2]!;
      newData[di + 3] = data[si + 3]!;
    }
  }

  return {
    data: new ImageData(newData, newWidth, newHeight),
    scaleX: width / newWidth,
    scaleY: height / newHeight,
  };
}

/**
 * Compute row and column gradient profiles using Sobel operator.
 * Each cell is the sum of gradient magnitudes for that row/column.
 * Higher values = more edges / detail in that row/column.
 */
export function computeGradientProfiles(imageData: ImageData): {
  rowProfile: Float64Array;
  colProfile: Float64Array;
} {
  const { width, height, data } = imageData;
  const rowProfile = new Float64Array(height);
  const colProfile = new Float64Array(width);

  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const r = data[idx]!;
          const g = data[idx + 1]!;
          const b = data[idx + 2]!;
          // Rec. 601 luma
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const ki = (ky + 1) * 3 + (kx + 1);
          gx += gray * sobelX[ki]!;
          gy += gray * sobelY[ki]!;
        }
      }

      const mag = Math.sqrt(gx * gx + gy * gy);
      rowProfile[y]! += mag;
      colProfile[x]! += mag;
    }
  }

  return { rowProfile, colProfile };
}

/**
 * Smooth a profile with a moving-average window.
 */
function smooth(profile: Float64Array, window: number): Float64Array {
  const out = new Float64Array(profile.length);
  const half = Math.floor(window / 2);

  for (let i = 0; i < profile.length; i++) {
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(profile.length - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      sum += profile[j]!;
      count++;
    }
    out[i] = sum / count;
  }

  return out;
}

/**
 * Normalize a profile to [0, 1].
 */
function normalize(profile: Float64Array): Float64Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i]! < min) min = profile[i]!;
    if (profile[i]! > max) max = profile[i]!;
  }
  const range = max - min || 1;
  const out = new Float64Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    out[i] = (profile[i]! - min) / range;
  }
  return out;
}

/**
 * Find numSplits optimal split positions in a 1-D profile.
 *
 * For each split we define a search window around an "ideal" evenly-spaced
 * position.  Within that window we pick the index with the *lowest* gradient
 * (smoothest region), preferring to split through uniform areas.
 *
 * Tolerance controls how far from ideal- evenly-spaced we allow the search to
 * wander (fraction of the section size).
 */
function findSplits(
  profile: Float64Array,
  length: number,
  numSplits: number,
  tolerance: number,
): number[] {
  if (numSplits <= 0) return [];
  const positions: number[] = [];
  const sectionSize = length / (numSplits + 1);

  for (let i = 1; i <= numSplits; i++) {
    const ideal = i * sectionSize;
    const range = Math.floor(sectionSize * tolerance);
    const lo = Math.max(0, Math.floor(ideal - range));
    const hi = Math.min(length - 1, Math.ceil(ideal + range));

    let best = Math.round(ideal);
    let bestVal = Infinity;
    for (let p = lo; p <= hi; p++) {
      if (profile[p]! < bestVal) {
        bestVal = profile[p]!;
        best = p;
      }
    }

    positions.push(best);
  }

  return positions;
}

export interface AutoDetectOptions {
  /** Maximum dimension to downscale to for analysis (default 500). */
  maxAnalysisDim?: number;
  /** Search window tolerance as fraction of section size (default 0.25). */
  tolerance?: number;
  /** Smoothing window size in pixels (default 5). */
  smoothingWindow?: number;
}

/**
 * Run content-aware split-line detection on an ImageData.
 *
 * Strategy:
 * 1. Downsample for performance.
 * 2. Compute gradient profiles (Sobel) for rows and columns.
 * 3. Smooth and normalise profiles.
 * 4. For each requested split, find the smoothest position within a
 *    tolerance window around the evenly-spaced ideal.
 *
 * Returns split-line positions in **original image pixel coordinates**.
 */
/**
 * Find split positions without even-spacing constraint.
 * Picks the numSplits *lowest*-gradient positions (valleys in the profile)
 * with a minimum-distance constraint to prevent clustering.
 */
function findFreeSplits(
  profile: Float64Array,
  length: number,
  numSplits: number,
  minGap: number,
): number[] {
  if (numSplits <= 0) return [];

  // Find all local minima
  const candidates: { index: number; value: number }[] = [];
  for (let i = 1; i < length - 1; i++) {
    if (profile[i]! <= profile[i - 1]! && profile[i]! <= profile[i + 1]!) {
      candidates.push({ index: i, value: profile[i]! });
    }
  }

  // Sort by gradient value — lowest gradient = smoothest = best
  candidates.sort((a, b) => a.value - b.value);

  // Greedy pick with minimum-distance enforcement
  const picked: number[] = [];
  const taken = new Set<number>();

  for (const { index } of candidates) {
    if (picked.length >= numSplits) break;
    let blocked = false;
    for (const p of picked) {
      if (Math.abs(index - p) < minGap) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      picked.push(index);
      taken.add(index);
    }
  }

  // If still short, fill the largest remaining gaps with evenly-spaced lines
  while (picked.length < numSplits) {
    const sorted = [...picked].sort((a, b) => a - b);
    let bestGap = 0;
    let bestPos = 0;
    let prev = 0;
    for (const p of sorted) {
      const gap = p - prev;
      if (gap > bestGap) {
        bestGap = gap;
        bestPos = prev + Math.floor(gap / 2);
      }
      prev = p;
    }
    const lastGap = length - 1 - prev;
    if (lastGap > bestGap) {
      bestPos = prev + Math.floor(lastGap / 2);
    }
    picked.push(bestPos);
  }

  return picked.sort((a, b) => a - b);
}

/**
 * Run content-aware split detection **without** even-spacing bias.
 *
 * Strategy:
 * 1. Downsample, Sobel gradient, smooth & normalise (same as autoDetectSplits).
 * 2. Find all local minima in the profile and pick the strongest N
 *    with a minimum-distance constraint (~5 % of the dimension).
 *
 * Best for truly irregular layouts where different rows/columns
 * have very different sizes.
 */
export function autoDetectFreeSplits(
  imageData: ImageData,
  horizontalSplits: number,
  verticalSplits: number,
  options: AutoDetectOptions = {},
): SplitResult {
  const {
    maxAnalysisDim = 500,
    smoothingWindow = 5,
  } = options;

  const { data, scaleX, scaleY } = downsample(imageData, maxAnalysisDim);

  const { rowProfile, colProfile } = computeGradientProfiles(data);
  const smoothRow = smooth(rowProfile, smoothingWindow);
  const smoothCol = smooth(colProfile, smoothingWindow);
  const normRow = normalize(smoothRow);
  const normCol = normalize(smoothCol);

  const hMinGap = Math.max(1, Math.floor(data.height * 0.05));
  const vMinGap = Math.max(1, Math.floor(data.width * 0.05));

  const hRaw = findFreeSplits(normRow, data.height, horizontalSplits, hMinGap);
  const vRaw = findFreeSplits(normCol, data.width, verticalSplits, vMinGap);

  return {
    horizontalLines: hRaw.map((p) => Math.round(p * scaleY)),
    verticalLines: vRaw.map((p) => Math.round(p * scaleX)),
  };
}

/**
 * Compute the tile positions for a fixed-size grid layout covering the image.
 *
 * Evenly distributes tiles so the whole image is covered, with the
 * specified overlap between adjacent tiles.
 *
 * Returns top-left positions in **pixel coordinates**.
 */
export function computeTiledLayout(
  imgW: number,
  imgH: number,
  tileW: number,
  tileH: number,
  overlapX: number,
  overlapY: number,
): { x: number; y: number }[] {
  const strideX = Math.max(1, tileW - overlapX);
  const strideY = Math.max(1, tileH - overlapY);
  const cols = Math.max(1, Math.ceil((imgW - tileW) / strideX) + 1);
  const rows = Math.max(1, Math.ceil((imgH - tileH) / strideY) + 1);

  const boxes: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const y = row === 0 ? 0 : Math.round(((imgH - tileH) * row) / (rows - 1));
    for (let col = 0; col < cols; col++) {
      const x = col === 0 ? 0 : Math.round(((imgW - tileW) * col) / (cols - 1));
      boxes.push({ x, y });
    }
  }
  return boxes;
}

export function autoDetectSplits(
  imageData: ImageData,
  horizontalSplits: number,
  verticalSplits: number,
  options: AutoDetectOptions = {},
): SplitResult {
  const {
    maxAnalysisDim = 500,
    tolerance = 0.25,
    smoothingWindow = 5,
  } = options;

  const { data, scaleX, scaleY } = downsample(imageData, maxAnalysisDim);

  const { rowProfile, colProfile } = computeGradientProfiles(data);
  const smoothRow = smooth(rowProfile, smoothingWindow);
  const smoothCol = smooth(colProfile, smoothingWindow);
  const normRow = normalize(smoothRow);
  const normCol = normalize(smoothCol);

  // Invert: we want LOW gradient, but findSplits looks for min values,
  // so the normalised profile (0 = least edge, 1 = most edge) works directly.
  const hRaw = findSplits(normRow, data.height, horizontalSplits, tolerance);
  const vRaw = findSplits(normCol, data.width, verticalSplits, tolerance);

  return {
    horizontalLines: hRaw.map((p) => Math.round(p * scaleY)),
    verticalLines: vRaw.map((p) => Math.round(p * scaleX)),
  };
}
