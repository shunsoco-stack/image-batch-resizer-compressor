import type {
  CropConfig,
  Dimensions,
  FitGeometry,
  FitMode,
  Rectangle,
  ResizeConfig,
} from "./types";

export class ImageGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGeometryError";
  }
}

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function assertDimensions(value: Dimensions, label: string): void {
  if (!isPositiveFinite(value.width) || !isPositiveFinite(value.height)) {
    throw new ImageGeometryError(`${label} dimensions must be positive finite numbers.`);
  }
}

function requiredSize(value: unknown, label: string): number {
  if (!isPositiveFinite(value)) {
    throw new ImageGeometryError(`${label} must be a positive finite number.`);
  }
  return value;
}

function roundedDimensions(source: Dimensions, scaleX: number, scaleY = scaleX): Dimensions {
  return {
    width: Math.max(1, Math.round(source.width * scaleX)),
    height: Math.max(1, Math.round(source.height * scaleY)),
  };
}

/**
 * Calculates pixel dimensions without decoding an image. Upscaling is enabled by
 * default; set allowUpscale to false to cap the result at the source dimensions.
 * Distorting width/height pairs are rejected even when a stale caller sends
 * maintainAspectRatio=false: stretch is not a supported fit mode in this app.
 */
export function calculateResizeDimensions(
  source: Dimensions,
  config: ResizeConfig,
): Dimensions {
  assertDimensions(source, "Source");

  let scale: number;

  switch (config.mode) {
    case "width":
      scale = requiredSize(config.width, "Width") / source.width;
      break;
    case "height":
      scale = requiredSize(config.height, "Height") / source.height;
      break;
    case "percentage":
      scale = requiredSize(config.percentage, "Percentage") / 100;
      break;
    case "long-side":
      scale = requiredSize(config.longSide, "Long side") / Math.max(source.width, source.height);
      break;
    case "short-side":
      scale = requiredSize(config.shortSide, "Short side") / Math.min(source.width, source.height);
      break;
    case "dimensions": {
      const hasWidth = isPositiveFinite(config.width);
      const hasHeight = isPositiveFinite(config.height);
      if (!hasWidth && !hasHeight) {
        throw new ImageGeometryError("Width or height is required for dimensions resize.");
      }

      const widthScale = hasWidth
        ? requiredSize(config.width, "Width") / source.width
        : undefined;
      const heightScale = hasHeight
        ? requiredSize(config.height, "Height") / source.height
        : undefined;

      if (
        config.maintainAspectRatio === false &&
        widthScale !== undefined &&
        heightScale !== undefined &&
        Math.abs(widthScale - heightScale) > 1e-9
      ) {
        throw new ImageGeometryError(
          "Stretch resize is not supported. Use cover or contain to fit a target box.",
        );
      }

      scale =
        widthScale !== undefined && heightScale !== undefined
          ? Math.min(widthScale, heightScale)
          : (widthScale ?? heightScale)!;
      break;
    }
    default: {
      const exhaustive: never = config.mode;
      throw new ImageGeometryError(`Unsupported resize mode: ${String(exhaustive)}`);
    }
  }

  if (config.allowUpscale === false) {
    scale = Math.min(scale, 1);
  }

  return roundedDimensions(source, scale);
}

export function getCropAspectRatio(config: CropConfig, source: Dimensions): number {
  assertDimensions(source, "Source");

  switch (config.aspect) {
    case "original":
      return source.width / source.height;
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    case "custom":
      return (
        requiredSize(config.customWidth, "Custom aspect width") /
        requiredSize(config.customHeight, "Custom aspect height")
      );
    default: {
      const exhaustive: never = config.aspect;
      throw new ImageGeometryError(`Unsupported crop aspect: ${String(exhaustive)}`);
    }
  }
}

/** Returns the largest centered rectangle with the requested aspect ratio. */
export function calculateCropRect(source: Dimensions, config: CropConfig): Rectangle {
  assertDimensions(source, "Source");
  const targetRatio = getCropAspectRatio(config, source);
  const sourceRatio = source.width / source.height;

  if (Math.abs(sourceRatio - targetRatio) < 1e-12) {
    return { x: 0, y: 0, width: source.width, height: source.height };
  }

  if (sourceRatio > targetRatio) {
    const width = source.height * targetRatio;
    return {
      x: (source.width - width) / 2,
      y: 0,
      width,
      height: source.height,
    };
  }

  const height = source.width / targetRatio;
  return {
    x: 0,
    y: (source.height - height) / 2,
    width: source.width,
    height,
  };
}

/**
 * Predicts the canvas dimensions produced by a crop step without allocating
 * pixels. Cover removes pixels; contain expands one side to create letterbox
 * space, matching the image engine's rendering geometry.
 */
export function calculateCropOutputDimensions(
  source: Dimensions,
  config: CropConfig,
): Dimensions {
  assertDimensions(source, "Source");
  if (config.aspect === "original") return { ...source };

  const ratio = getCropAspectRatio(config, source);
  if (config.fitMode === "cover") {
    const crop = calculateCropRect(source, config);
    return {
      width: Math.max(1, Math.round(crop.width)),
      height: Math.max(1, Math.round(crop.height)),
    };
  }

  const sourceRatio = source.width / source.height;
  if (sourceRatio > ratio) {
    return {
      width: source.width,
      height: Math.max(1, Math.round(source.width / ratio)),
    };
  }
  return {
    width: Math.max(1, Math.round(source.height * ratio)),
    height: source.height,
  };
}

export function assertSupportedFitMode(value: unknown): asserts value is FitMode {
  if (value !== "cover" && value !== "contain") {
    throw new ImageGeometryError(
      `Unsupported fit mode: ${String(value)}. Stretch is intentionally disabled.`,
    );
  }
}

/**
 * Maps a source image into a target canvas. Cover crops the source; contain
 * letterboxes it. The caller supplies the configured background when painting
 * the unused contain area.
 */
export function calculateFitGeometry(
  source: Dimensions,
  target: Dimensions,
  mode: FitMode,
): FitGeometry {
  assertDimensions(source, "Source");
  assertDimensions(target, "Target");
  assertSupportedFitMode(mode);

  if (mode === "cover") {
    const cropConfig: CropConfig = {
      aspect: "custom",
      customWidth: target.width,
      customHeight: target.height,
      fitMode: "cover",
    };
    return {
      source: calculateCropRect(source, cropConfig),
      destination: { x: 0, y: 0, width: target.width, height: target.height },
    };
  }

  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;

  return {
    source: { x: 0, y: 0, width: source.width, height: source.height },
    destination: {
      x: (target.width - width) / 2,
      y: (target.height - height) / 2,
      width,
      height,
    },
  };
}
