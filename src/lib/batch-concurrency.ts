import {
  calculateCropOutputDimensions,
  calculateResizeDimensions,
} from "./image-geometry";
import type { Dimensions, Workflow } from "./types";

const MEDIUM_IMAGE_PIXELS = 20_000_000;
const HEAVY_IMAGE_PIXELS = 40_000_000;
const MAX_BATCH_CONCURRENCY = 3;

function pixelCount(dimensions: Dimensions): number {
  const pixels = dimensions.width * dimensions.height;
  return Number.isSafeInteger(pixels) && pixels > 0 ? pixels : Number.POSITIVE_INFINITY;
}

/**
 * Estimates the largest individual pixel surface reached while applying the
 * enabled geometry steps in their saved order. Invalid geometry fails closed so
 * a malformed workflow cannot accidentally select an aggressive pool size.
 */
export function estimateWorkflowPeakPixels(
  source: Dimensions,
  workflow: Workflow,
): number {
  let current = { ...source };
  let peak = pixelCount(current);

  try {
    for (const step of workflow.steps) {
      if (!step.enabled) continue;
      if (step.type === "resize") {
        current = calculateResizeDimensions(current, step.config);
      } else if (step.type === "crop") {
        current = calculateCropOutputDimensions(current, step.config);
      } else {
        continue;
      }
      peak = Math.max(peak, pixelCount(current));
    }
  } catch {
    return Number.POSITIVE_INFINITY;
  }

  return peak;
}

/** Selects a UI scheduler width while the worker pool applies its own cap too. */
export function calculateBatchConcurrency(
  sources: readonly Dimensions[],
  workflow: Workflow,
  logicalCores: number,
): number {
  if (sources.length === 0) return 1;

  const peakPixels = sources.reduce(
    (largest, source) => Math.max(largest, estimateWorkflowPeakPixels(source, workflow)),
    0,
  );
  const pixelBound = peakPixels > HEAVY_IMAGE_PIXELS
    ? 1
    : peakPixels > MEDIUM_IMAGE_PIXELS
      ? 2
      : MAX_BATCH_CONCURRENCY;
  const normalizedCores = Number.isFinite(logicalCores)
    ? Math.max(1, Math.floor(logicalCores))
    : 1;
  const cpuBound = Math.max(1, Math.floor(normalizedCores / 2));
  return Math.max(1, Math.min(pixelBound, cpuBound, sources.length));
}
