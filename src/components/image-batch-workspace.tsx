"use client";

/* eslint-disable @next/next/no-img-element -- Runtime object URLs are local previews, not deploy-time image assets. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { AppMark, Icon, type IconName } from "@/components/icons";
import { calculateBatchConcurrency } from "@/lib/batch-concurrency";
import { createDemoFiles } from "@/lib/demo-images";
import type {
  CropWorkflowStep as CropStep,
  FormatWorkflowStep as FormatStep,
  ImageAsset,
  ImageCapabilities,
  ImageFormat,
  ImageMimeType,
  ProcessedAsset,
  RenameWorkflowStep as RenameStep,
  ResizeWorkflowStep as ResizeStep,
  Workflow,
  WorkflowStep,
  WorkflowTemplate,
} from "@/lib/types";
import { ImageWorkerClient } from "@/lib/worker-client";
import { probeImageCapabilities } from "@/lib/capabilities";
import { createStoredZip } from "@/lib/zip";
import { ensureUniqueFilename } from "@/lib/filename-template";
import { inspectEncodedImageDimensionsForFormat } from "@/lib/image-header";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
} from "@/lib/workflow";
import {
  deleteWorkflowTemplate,
  loadCustomWorkflowTemplates,
  saveWorkflowTemplate,
} from "@/lib/template-storage";

type ViewName = "gallery" | "compare" | "results" | "templates";
type Notice = { tone: "success" | "error" | "info"; message: string };

type AssetRecord = ImageAsset & {
  selected: boolean;
  originalUrl: string;
};

type ProcessedRecord = ProcessedAsset & {
  outputUrl: string;
};

const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_FILE_SIZE = 120 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;

const VIEW_ITEMS: Array<{ id: ViewName; label: string; icon: IconName }> = [
  { id: "gallery", label: "Gallery", icon: "gallery" },
  { id: "compare", label: "比較", icon: "compare" },
  { id: "results", label: "結果", icon: "compress" },
  { id: "templates", label: "Template", icon: "template" },
];

const PRESETS = [
  { label: "Square", detail: "1:1", width: 1080, height: 1080 },
  { label: "Portrait Story", detail: "9:16", width: 1080, height: 1920 },
  { label: "Landscape Post", detail: "16:9", width: 1600, height: 900 },
  { label: "OGP Landscape", detail: "1.91:1", width: 1200, height: 630 },
  { label: "Video Thumbnail", detail: "16:9", width: 1280, height: 720 },
  { label: "Web Hero", detail: "Wide", width: 1920, height: 1080 },
  { label: "EC Product", detail: "Square", width: 1600, height: 1600 },
];

const FALLBACK_CAPABILITIES: ImageCapabilities = {
  jpeg: { decode: true, encode: true },
  png: { decode: true, encode: true },
  webp: { decode: true, encode: true },
  avif: { decode: false, encode: false },
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
}

function formatLabel(mime: string) {
  const value = mime.split("/")[1]?.toUpperCase() ?? "—";
  return value === "JPEG" ? "JPEG" : value;
}

function savingsPercent(original: number, optimized: number) {
  if (original <= 0) return 0;
  return Math.max(-999, Math.min(100, ((original - optimized) / original) * 100));
}

function zipFilename(name: string | undefined) {
  return `${(name || "optimized-images").replace(/\.zip$/i, "")}.zip`;
}

function cloneWorkflow(workflow: Workflow, name = workflow.name): Workflow {
  const now = new Date().toISOString();
  return {
    ...workflow,
    id: makeId("workflow"),
    name,
    createdAt: now,
    updatedAt: now,
    steps: workflow.steps.map((step) => ({ ...step, id: makeId("step"), config: { ...step.config } } as WorkflowStep)),
  };
}

function defaultWorkflow(): Workflow {
  const source = BUILT_IN_WORKFLOW_TEMPLATES[0]?.workflow;
  if (!source) throw new Error("Built-in Workflowがありません。");
  return cloneWorkflow(source, "新しいBatch Workflow");
}

function stepTitle(step: WorkflowStep) {
  switch (step.type) {
    case "resize": return "Resize";
    case "crop": return "Crop / Fit";
    case "format": return "Format";
    case "compress": return "Compress";
    case "metadata": return "Metadata";
    case "rename": return "Rename";
    case "zip": return "ZIP";
  }
}

function stepIcon(step: WorkflowStep): IconName {
  switch (step.type) {
    case "resize": return "resize";
    case "crop": return "crop";
    case "format": return "format";
    case "compress": return "compress";
    case "metadata": return "metadata";
    case "rename": return "rename";
    case "zip": return "archive";
  }
}

function stepSummary(step: WorkflowStep) {
  switch (step.type) {
    case "resize": {
      const config = step.config;
      if (config.mode === "percentage") return `${config.percentage ?? 100}%`;
      if (config.mode === "long-side") return `長辺 ${config.longSide ?? 1600}px`;
      if (config.mode === "short-side") return `短辺 ${config.shortSide ?? 1200}px`;
      if (config.mode === "width") return `幅 ${config.width ?? 1600}px`;
      if (config.mode === "height") return `高さ ${config.height ?? 1200}px`;
      return `${config.width ?? "自動"} × ${config.height ?? "自動"}px`;
    }
    case "crop": return `${step.config.aspect === "original" ? "Original" : step.config.aspect}・${step.config.fitMode}`;
    case "format": return `${step.config.format.toUpperCase()}${step.config.format === "jpeg" ? `・背景 ${step.config.background}` : ""}`;
    case "compress": return `品質 ${step.config.quality}%`;
    case "metadata": return "EXIF等・色プロファイルを常に削除";
    case "rename": return step.config.template;
    case "zip": return zipFilename(step.config.archiveName);
  }
}

function processingError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "処理をキャンセルしました。";
  if (error instanceof Error) {
    if (/memory|allocation|canvas/i.test(error.message)) return "端末のメモリが不足した可能性があります。枚数や出力サイズを減らして再実行してください。";
    if (/decode|image|bitmap|invalid/i.test(error.message)) return "画像を読み取れませんでした。壊れているか、ブラウザが形式に対応していません。";
    return error.message;
  }
  return "画像の変換に失敗しました。";
}

async function inspectFile(file: File): Promise<{ width: number; height: number }> {
  if (file.size > MAX_FILE_SIZE) throw new Error("巨大画像です。1ファイル120MB以下にしてください。");
  const format = (file.type.split("/")[1] === "jpg" ? "jpeg" : file.type.split("/")[1]) as ImageFormat;
  const encodedDimensions = await inspectEncodedImageDimensionsForFormat(file, format);
  if (
    encodedDimensions &&
    (encodedDimensions.width > 32_767 ||
      encodedDimensions.height > 32_767 ||
      encodedDimensions.width * encodedDimensions.height > MAX_PIXELS)
  ) {
    throw new Error("巨大画像です。総画素数を8,000万画素以下にしてください。");
  }
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error("巨大画像です。総画素数を8,000万画素以下にしてください。");
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("画像をデコードできません。"));
      image.src = url;
    });
    if (dimensions.width * dimensions.height > MAX_PIXELS) throw new Error("巨大画像です。総画素数を8,000万画素以下にしてください。");
    return dimensions;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function outputForAsset(asset: AssetRecord, outputs: ProcessedRecord[]) {
  return outputs.find((output) => output.assetId === asset.id);
}

export function ImageBatchWorkspace() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [outputs, setOutputs] = useState<ProcessedRecord[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>(() => defaultWorkflow());
  const [view, setView] = useState<ViewName>("gallery");
  const [openStepId, setOpenStepId] = useState<string>();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [isDropActive, setIsDropActive] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, percent: 0, current: "待機中" });
  const [notice, setNotice] = useState<Notice>();
  const [capabilities, setCapabilities] = useState<ImageCapabilities>(FALLBACK_CAPABILITIES);
  const [comparePosition, setComparePosition] = useState(50);
  const [compareZoom, setCompareZoom] = useState(100);
  const [compareAssetId, setCompareAssetId] = useState<string>();
  const [zipUrl, setZipUrl] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const workerRef = useRef<ImageWorkerClient | undefined>(undefined);
  const originalUrlsRef = useRef(new Set<string>());
  const outputUrlsRef = useRef(new Set<string>());
  const zipUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setTemplates(loadCustomWorkflowTemplates());
    void probeImageCapabilities().then(setCapabilities).catch(() => setCapabilities(FALLBACK_CAPABILITIES));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const originalUrls = originalUrlsRef.current;
    const outputUrls = outputUrlsRef.current;
    return () => {
      abortRef.current?.abort();
      workerRef.current?.terminate();
      originalUrls.forEach((url) => URL.revokeObjectURL(url));
      outputUrls.forEach((url) => URL.revokeObjectURL(url));
      if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    };
  }, []);

  const selectedAssets = useMemo(() => assets.filter((asset) => asset.selected && !asset.error), [assets]);
  const originalTotal = useMemo(() => assets.reduce((sum, asset) => sum + asset.size, 0), [assets]);
  const optimizedTotal = useMemo(() => outputs.reduce((sum, output) => sum + output.size, 0), [outputs]);
  const processedOriginalTotal = useMemo(() => outputs.reduce((sum, output) => {
    const source = assets.find((asset) => asset.id === output.assetId);
    return sum + (source?.size ?? output.originalSize);
  }, 0), [assets, outputs]);
  const comparisonOriginalTotal = outputs.length && !isProcessing ? processedOriginalTotal : originalTotal;
  const compareAsset = useMemo(
    () => assets.find((asset) => asset.id === compareAssetId && outputForAsset(asset, outputs))
      ?? assets.find((asset) => outputForAsset(asset, outputs))
      ?? assets.find((asset) => !asset.error),
    [assets, compareAssetId, outputs],
  );
  const compareOutput = compareAsset ? outputForAsset(compareAsset, outputs) : undefined;
  const activeZipStep = workflow.steps.find((step) => step.type === "zip") as Extract<WorkflowStep, { type: "zip" }> | undefined;
  const zipDownloadName = zipFilename(activeZipStep?.config.archiveName);

  const clearOutputs = useCallback(() => {
    setOutputs((current) => {
      current.forEach((output) => {
        URL.revokeObjectURL(output.outputUrl);
        outputUrlsRef.current.delete(output.outputUrl);
      });
      return [];
    });
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = undefined;
      setZipUrl(undefined);
    }
    setAssets((current) => current.map((asset) => asset.originalUrl
      ? { ...asset, status: "ready", error: undefined }
      : asset));
    setProgress({ completed: 0, total: 0, percent: 0, current: "待機中" });
    setCompareAssetId(undefined);
  }, []);

  const addFiles = useCallback(async (fileList: File[] | FileList) => {
    if (isProcessing) {
      setNotice({ tone: "info", message: "Batch処理をキャンセルまたは完了してから画像を追加してください。" });
      return;
    }
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    setIsInspecting(true);
    clearOutputs();

    const additions: AssetRecord[] = [];
    for (const file of incoming) {
      const id = makeId("image");
      const supportedByType = ACCEPTED_MIME.has(file.type);
      let originalUrl = "";
      try {
        if (!supportedByType) throw new Error("非対応形式です。JPEG、PNG、WebP、AVIFを選択してください。");
        // Startup capabilities are advisory for decoding: a browser may decode
        // AVIF even when it cannot encode an AVIF probe. The real file decode
        // below is the source of truth and returns a per-file error when needed.
        const dimensions = await inspectFile(file);
        originalUrl = URL.createObjectURL(file);
        originalUrlsRef.current.add(originalUrl);
        additions.push({
          id,
          file,
          name: file.name,
          mime: file.type as ImageMimeType,
          width: dimensions.width,
          height: dimensions.height,
          size: file.size,
          sourceUrl: originalUrl,
          originalUrl,
          selected: true,
          status: "ready",
        });
      } catch (error) {
        if (originalUrl) {
          URL.revokeObjectURL(originalUrl);
          originalUrlsRef.current.delete(originalUrl);
        }
        additions.push({
          id,
          file,
          name: file.name,
          mime: (supportedByType ? file.type : "image/jpeg") as ImageMimeType,
          width: 0,
          height: 0,
          size: file.size,
          sourceUrl: originalUrl,
          originalUrl,
          selected: false,
          status: "error",
          error: processingError(error),
        });
      }
    }
    setAssets((current) => [...current, ...additions]);
    setIsInspecting(false);
    setView("gallery");
    const failed = additions.filter((asset) => asset.error).length;
    setNotice({
      tone: failed ? "info" : "success",
      message: failed ? `${additions.length - failed}枚を追加、${failed}枚に問題があります。` : `${additions.length}枚の画像を追加しました。`,
    });
  }, [clearOutputs, isProcessing]);

  const loadDemo = useCallback(async () => {
    try {
      setIsInspecting(true);
      const demoFiles = await createDemoFiles();
      setAssets((current) => {
        current.forEach((asset) => {
          if (asset.originalUrl) {
            URL.revokeObjectURL(asset.originalUrl);
            originalUrlsRef.current.delete(asset.originalUrl);
          }
        });
        return [];
      });
      const template = BUILT_IN_WORKFLOW_TEMPLATES.find((item) => item.category === "EC") ?? BUILT_IN_WORKFLOW_TEMPLATES[0];
      if (template) setWorkflow(cloneWorkflow(template.workflow, "EC商品画像デモ"));
      await addFiles(demoFiles);
      setNotice({ tone: "success", message: "架空の商品画像10枚とEC Workflowを読み込みました。" });
    } catch (error) {
      setIsInspecting(false);
      setNotice({ tone: "error", message: processingError(error) });
    }
  }, [addFiles]);

  const removeAsset = useCallback((id: string) => {
    if (isProcessing) return;
    clearOutputs();
    const target = assets.find((asset) => asset.id === id);
    if (target?.originalUrl) {
      URL.revokeObjectURL(target.originalUrl);
      originalUrlsRef.current.delete(target.originalUrl);
    }
    setAssets((current) => current.filter((asset) => asset.id !== id));
  }, [assets, clearOutputs, isProcessing]);

  const updateStep = useCallback(<T extends WorkflowStep>(stepId: string, patch: Partial<T["config"]>) => {
    if (isProcessing) return;
    clearOutputs();
    setWorkflow((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      steps: current.steps.map((step) => step.id === stepId
        ? { ...step, config: { ...step.config, ...patch } } as WorkflowStep
        : step),
    }));
  }, [clearOutputs, isProcessing]);

  const toggleStep = useCallback((stepId: string) => {
    if (isProcessing) return;
    clearOutputs();
    setWorkflow((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      steps: current.steps.map((step) => step.id === stepId ? { ...step, enabled: !step.enabled } : step),
    }));
  }, [clearOutputs, isProcessing]);

  const moveStep = useCallback((stepId: string, direction: -1 | 1) => {
    if (isProcessing) return;
    clearOutputs();
    setWorkflow((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.steps.length) return current;
      if (current.steps[index]?.type === "zip") return current;
      if (direction === 1 && current.steps[target]?.type === "zip") return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps, updatedAt: new Date().toISOString() };
    });
  }, [clearOutputs, isProcessing]);

  const applyPreset = useCallback((step: ResizeStep, preset: typeof PRESETS[number]) => {
    updateStep<ResizeStep>(step.id, {
      mode: "dimensions",
      width: preset.width,
      height: preset.height,
      maintainAspectRatio: true,
    });
  }, [updateStep]);

  const saveTemplate = useCallback(() => {
    if (isProcessing) return;
    const name = templateName.trim();
    if (!name) {
      setNotice({ tone: "error", message: "Template名を入力してください。" });
      return;
    }
    const now = new Date().toISOString();
    const template: WorkflowTemplate = {
      version: 1,
      id: makeId("template"),
      name,
      description: `${workflow.steps.filter((step) => step.enabled).length}工程の保存済みWorkflow`,
      category: "カスタム",
      builtIn: false,
      workflow: cloneWorkflow(workflow, name),
      createdAt: now,
      updatedAt: now,
    };
    try {
      const next = saveWorkflowTemplate(template);
      setTemplates(next);
      setTemplateName("");
      setNotice({ tone: "success", message: `「${name}」をこのブラウザに保存しました。` });
    } catch (error) {
      setNotice({ tone: "error", message: `Templateを保存できませんでした。${processingError(error)}` });
    }
  }, [isProcessing, templateName, workflow]);

  const useTemplate = useCallback((template: WorkflowTemplate) => {
    if (isProcessing) return;
    clearOutputs();
    setWorkflow(cloneWorkflow(template.workflow, template.name));
    setView("gallery");
    setNotice({ tone: "success", message: `「${template.name}」をWorkflowへ適用しました。` });
  }, [clearOutputs, isProcessing]);

  const deleteTemplate = useCallback((id: string) => {
    try {
      setTemplates(deleteWorkflowTemplate(id));
      setNotice({ tone: "info", message: "保存したTemplateを削除しました。" });
    } catch (error) {
      setNotice({ tone: "error", message: processingError(error) });
    }
  }, []);

  const buildZip = useCallback(async (processed: ProcessedRecord[], signal: AbortSignal) => {
    const zipStep = workflow.steps.find((step) => step.type === "zip") as Extract<WorkflowStep, { type: "zip" }> | undefined;
    const blob = await createStoredZip(
      processed.map((output) => ({ name: output.name, data: output.blob })),
      {
        signal,
        onProgress: (zipProgress) => {
          const checksumPercent = zipProgress.totalBytes > 0
            ? Math.round((zipProgress.processedBytes / zipProgress.totalBytes) * 100)
            : 100;
          setProgress((current) => ({
            ...current,
            current: zipProgress.phase === "complete"
              ? "ZIPを準備しました"
              : zipProgress.currentEntry
                ? `ZIPへ追加: ${zipProgress.currentEntry}`
                : "ZIPを生成中",
            percent: zipProgress.phase === "complete" ? 100 : Math.min(99, Math.max(90, 90 + Math.round(checksumPercent / 10))),
          }));
        },
      },
    );
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    const url = URL.createObjectURL(blob);
    zipUrlRef.current = url;
    setZipUrl(url);
    return { url, name: zipFilename(zipStep?.config.archiveName) };
  }, [workflow.steps]);

  const processBatch = useCallback(async () => {
    if (isProcessing) return;
    const targets = selectedAssets.length ? selectedAssets : assets.filter((asset) => !asset.error);
    if (!targets.length) {
      setNotice({ tone: "error", message: "処理できる画像を追加または選択してください。" });
      return;
    }
    const enabled = workflow.steps.filter((step) => step.enabled);
    const format = enabled.find((step) => step.type === "format") as FormatStep | undefined;
    if (format && !capabilities[format.config.format].encode) {
      setNotice({ tone: "error", message: `このブラウザは${format.config.format.toUpperCase()}への変換に対応していません。` });
      return;
    }

    clearOutputs();
    setIsProcessing(true);
    setView("gallery");
    setIsWorkflowOpen(false);
    setAssets((current) => current.map((asset) => targets.some((target) => target.id === asset.id) ? { ...asset, status: "queued", error: undefined } : asset));
    const abortController = new AbortController();
    abortRef.current = abortController;
    const worker = workerRef.current ?? new ImageWorkerClient();
    workerRef.current = worker;
    const completed: ProcessedRecord[] = [];
    let failed = 0;
    const cpuCount = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
    const concurrency = calculateBatchConcurrency(
      targets.map((asset) => ({ width: asset.width, height: asset.height })),
      workflow,
      cpuCount,
    );
    let nextIndex = 0;

    setProgress({ completed: 0, total: targets.length, percent: 0, current: "処理を準備中" });

    const runOne = async () => {
      while (nextIndex < targets.length && !abortController.signal.aborted) {
        const index = nextIndex;
        nextIndex += 1;
        const asset = targets[index];
        setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: "processing" } : item));
        setProgress((current) => ({ ...current, current: asset.name }));
        try {
          const result = await worker.process(asset.file, workflow, index, {
            capabilities,
            signal: abortController.signal,
            onProgress: () => undefined,
          });
          if (abortController.signal.aborted) break;
          const outputUrl = URL.createObjectURL(result.blob);
          outputUrlsRef.current.add(outputUrl);
          const record: ProcessedRecord = { ...result, assetId: asset.id, outputUrl };
          completed.push(record);
          setOutputs((current) => [...current, record]);
          setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: "completed" } : item));
        } catch (error) {
          if (abortController.signal.aborted) break;
          failed += 1;
          setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: "error", error: processingError(error) } : item));
        } finally {
          if (!abortController.signal.aborted) {
            const done = completed.length + failed;
            setProgress({ completed: done, total: targets.length, percent: Math.round((done / targets.length) * 90), current: asset.name });
          }
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: concurrency }, () => runOne()));
      if (abortController.signal.aborted) {
        setNotice({ tone: "info", message: "一括処理をキャンセルしました。完了済みの結果は破棄しました。" });
        completed.forEach((output) => {
          if (outputUrlsRef.current.has(output.outputUrl)) {
            URL.revokeObjectURL(output.outputUrl);
            outputUrlsRef.current.delete(output.outputUrl);
          }
        });
        setOutputs([]);
        if (zipUrlRef.current) {
          URL.revokeObjectURL(zipUrlRef.current);
          zipUrlRef.current = undefined;
          setZipUrl(undefined);
        }
        setProgress({ completed: 0, total: 0, percent: 0, current: "待機中" });
        setAssets((current) => current.map((asset) => asset.status === "processing" || asset.status === "queued" || asset.status === "completed" ? { ...asset, status: "ready" } : asset));
        return;
      }
      const orderedRaw = targets
        .map((target) => completed.find((output) => output.assetId === target.id))
        .filter((output): output is ProcessedRecord => Boolean(output));
      const usedNames = new Set<string>();
      const ordered = orderedRaw.map((output) => {
        const name = ensureUniqueFilename(output.name, usedNames);
        usedNames.add(name);
        return name === output.name ? output : { ...output, name };
      });
      setOutputs(ordered);
      if (ordered.length) await buildZip(ordered, abortController.signal);
      setProgress({ completed: targets.length, total: targets.length, percent: 100, current: failed ? `${completed.length}枚完了・${failed}枚失敗` : "すべて完了" });
      setView("results");
      setNotice({
        tone: failed ? "info" : "success",
        message: failed ? `${completed.length}枚を処理、${failed}枚は変換できませんでした。` : `${completed.length}枚を処理し、ZIPを用意しました。`,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        completed.forEach((output) => {
          if (outputUrlsRef.current.has(output.outputUrl)) {
            URL.revokeObjectURL(output.outputUrl);
            outputUrlsRef.current.delete(output.outputUrl);
          }
        });
        setOutputs([]);
        setAssets((current) => current.map((asset) => asset.status === "processing" || asset.status === "queued" || asset.status === "completed" ? { ...asset, status: "ready" } : asset));
        setProgress({ completed: 0, total: 0, percent: 0, current: "待機中" });
        setNotice({ tone: "info", message: "一括処理をキャンセルしました。完了済みの結果は破棄しました。" });
      } else {
        setNotice({ tone: "error", message: processingError(error) });
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = undefined;
    }
  }, [assets, buildZip, capabilities, clearOutputs, isProcessing, selectedAssets, workflow]);

  const cancelProcessing = useCallback(() => {
    abortRef.current?.abort();
    workerRef.current?.cancelAll();
  }, []);

  const onComparePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    setComparePosition(next);
  }, []);

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDropActive(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-icon"><AppMark /></div>
            <div className="brand-copy">
              <h1>画像一括リサイズ・圧縮ツール</h1>
              <p>Gallery × Batch Workflow</p>
            </div>
          </div>
          <div className="header-actions">
            <span className="privacy-pill" title="画像データをサーバーへ送信しません">
              <span className="privacy-dot" />
              <span className="privacy-label">端末内で処理</span>
            </span>
            <button className="btn btn-secondary desktop-only" type="button" onClick={() => void loadDemo()} disabled={isInspecting || isProcessing}>
              <Icon name="sparkles" /> Demo 10枚
            </button>
            <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()} disabled={isInspecting || isProcessing}>
              <Icon name="plus" /> <span className="desktop-only">画像を追加</span><span className="mobile-only">追加</span>
            </button>
            <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif" multiple onChange={onFileInput} />
          </div>
        </div>
      </header>

      {notice ? (
        <div className="notice-stack" role="status">
          <div className={`notice ${notice.tone}`}>
            <Icon name={notice.tone === "success" ? "check" : notice.tone === "error" ? "error" : "info"} />
            <span>{notice.message}</span>
          </div>
        </div>
      ) : null}

      <main id="main-content" className="workspace">
        <div className="workspace-nav">
          <div className="segmented" role="tablist" aria-label="表示を切り替え">
            {VIEW_ITEMS.map((item) => (
              <button key={item.id} className="nav-tab" type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} disabled={isProcessing && item.id !== "gallery"}>
                <Icon name={item.icon} /><span>{item.label}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-secondary mobile-workflow-trigger" type="button" onClick={() => setIsWorkflowOpen(true)}>
            <Icon name="workflow" /> Workflow {workflow.steps.filter((step) => step.enabled).length}工程
          </button>
          <SummaryStrip assets={assets} outputs={outputs} isProcessing={isProcessing} originalTotal={comparisonOriginalTotal} optimizedTotal={optimizedTotal} />
        </div>

        {view === "gallery" ? (
          <div className="main-grid">
            <section className="main-panel" aria-label="画像Gallery">
              {!assets.length ? (
                <EmptyDropZone
                  active={isDropActive}
                  inspecting={isInspecting}
                  capabilities={capabilities}
                  onDragEnter={() => setIsDropActive(true)}
                  onDragLeave={() => setIsDropActive(false)}
                  onDrop={onDrop}
                  onChoose={() => inputRef.current?.click()}
                  onDemo={() => void loadDemo()}
                />
              ) : (
                <>
                  <div
                    className={`compact-drop ${isDropActive ? "is-active" : ""}`}
                    onDragEnter={(event) => { event.preventDefault(); setIsDropActive(true); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setIsDropActive(false)}
                    onDrop={onDrop}
                  >
                    <div className="compact-drop-copy">
                      <strong>ここへ追加画像をドロップ</strong>
                      <span>JPEG・PNG・WebP・AVIF（端末の対応範囲）</span>
                    </div>
                    <button className="btn btn-secondary btn-small" type="button" onClick={() => inputRef.current?.click()} disabled={isProcessing}>
                      <Icon name="plus" /> 画像を追加
                    </button>
                  </div>
                  <GalleryToolbar
                    assets={assets}
                    disabled={isProcessing}
                    onToggleAll={() => setAssets((current) => {
                      const allSelected = current.filter((asset) => !asset.error).every((asset) => asset.selected);
                      return current.map((asset) => asset.error ? asset : { ...asset, selected: !allSelected });
                    })}
                    onRemoveSelected={() => assets.filter((asset) => asset.selected).forEach((asset) => removeAsset(asset.id))}
                  />
                  <div className="gallery-grid">
                    {assets.map((asset) => (
                      <ImageCard
                        key={asset.id}
                        asset={asset}
                        output={outputForAsset(asset, outputs)}
                        disabled={isProcessing}
                        onToggle={() => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, selected: !item.selected } : item))}
                        onRemove={() => removeAsset(asset.id)}
                        onCompare={() => { setCompareAssetId(asset.id); setView("compare"); setComparePosition(50); }}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
            <WorkflowPanel
              workflow={workflow}
              openStepId={openStepId}
              templateName={templateName}
              capabilities={capabilities}
              isOpen={isWorkflowOpen}
              disabled={isProcessing}
              onClose={() => setIsWorkflowOpen(false)}
              onOpenStep={(id) => setOpenStepId((current) => current === id ? undefined : id)}
              onToggleStep={toggleStep}
              onMoveStep={moveStep}
              onUpdateStep={updateStep}
              onPreset={applyPreset}
              onTemplateName={setTemplateName}
              onSaveTemplate={saveTemplate}
              onProcess={() => void processBatch()}
            />
            <button className={`sheet-scrim ${isWorkflowOpen ? "is-open" : ""}`} aria-label="Workflowを閉じる" type="button" onClick={() => setIsWorkflowOpen(false)} />
          </div>
        ) : null}

        {view === "compare" ? (
          <CompareView
            asset={compareAsset}
            output={compareOutput}
            position={comparePosition}
            zoom={compareZoom}
            onPointer={onComparePointer}
            onZoom={setCompareZoom}
            onBack={() => setView("gallery")}
            onProcess={() => void processBatch()}
          />
        ) : null}

        {view === "results" ? (
          <ResultsView
            assets={assets}
            outputs={outputs}
            originalTotal={comparisonOriginalTotal}
            optimizedTotal={optimizedTotal}
            zipUrl={zipUrl}
            zipName={zipDownloadName}
            onBack={() => setView("gallery")}
          />
        ) : null}

        {view === "templates" ? (
          <TemplatesView templates={[...BUILT_IN_WORKFLOW_TEMPLATES, ...templates]} disabled={isProcessing} onUse={useTemplate} onDelete={deleteTemplate} />
        ) : null}
      </main>

      <ProcessingDock
        hasAssets={assets.some((asset) => !asset.error)}
        isProcessing={isProcessing}
        progress={progress}
        originalTotal={comparisonOriginalTotal}
        optimizedTotal={optimizedTotal}
        zipReady={Boolean(zipUrl)}
        zipUrl={zipUrl}
        zipName={zipDownloadName}
        onProcess={() => void processBatch()}
        onCancel={cancelProcessing}
      />
    </div>
  );
}

function SummaryStrip({
  assets,
  outputs,
  isProcessing,
  originalTotal,
  optimizedTotal,
}: {
  assets: AssetRecord[];
  outputs: ProcessedRecord[];
  isProcessing: boolean;
  originalTotal: number;
  optimizedTotal: number;
}) {
  return (
    <div className="summary-strip" aria-label="ファイルサイズ比較">
      <div className="summary-item"><span className="summary-label">Images</span><span className="summary-value">{assets.length}枚</span></div>
      <div className="summary-item"><span className="summary-label">Original total</span><span className="summary-value">{formatBytes(originalTotal)}</span></div>
      <div className="summary-item"><span className="summary-label">Optimized</span><span className="summary-value">{outputs.length ? formatBytes(optimizedTotal) : "—"}</span></div>
      <div className="summary-item"><span className="summary-label">Saved</span><span className={`summary-value ${!isProcessing && outputs.length && optimizedTotal < originalTotal ? "positive" : ""}`}>{isProcessing ? "計測中" : outputs.length ? `${savingsPercent(originalTotal, optimizedTotal).toFixed(1)}%` : "—"}</span></div>
    </div>
  );
}

function EmptyDropZone({
  active,
  inspecting,
  capabilities,
  onDragEnter,
  onDragLeave,
  onDrop,
  onChoose,
  onDemo,
}: {
  active: boolean;
  inspecting: boolean;
  capabilities: ImageCapabilities;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onChoose: () => void;
  onDemo: () => void;
}) {
  const formats: ImageFormat[] = ["jpeg", "png", "webp", "avif"];
  return (
    <div
      className={`drop-zone ${active ? "is-active" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); onDragEnter(); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="drop-content">
        <div className="empty-icon"><Icon name={inspecting ? "spinner" : "upload"} /></div>
        <h2>{inspecting ? "画像を確認しています" : "大量画像を、ひとつのWorkflowへ。"}</h2>
        <p>画像をまとめてドロップ。Resize・Crop・圧縮・Format・Renameを順番どおりに自動処理します。</p>
        <div className="drop-actions">
          <button className="btn btn-primary" type="button" onClick={onChoose} disabled={inspecting}><Icon name="image" /> 画像を選択</button>
          <button className="btn btn-secondary" type="button" onClick={onDemo} disabled={inspecting}><Icon name="sparkles" /> Demoを体験</button>
        </div>
        <div className="supported-row" aria-label="対応形式">
          {formats.map((format) => (
            <span key={format} className="capability-pill">{format.toUpperCase()} {capabilities[format].decode ? "✓" : format === "avif" ? "要確認" : "—"}</span>
          ))}
        </div>
        <div className="local-note"><Icon name="lock" /> 画像はサーバーへ送信せず、可能な処理をこのブラウザ内で実行します。</div>
      </div>
    </div>
  );
}

function GalleryToolbar({ assets, disabled, onToggleAll, onRemoveSelected }: { assets: AssetRecord[]; disabled: boolean; onToggleAll: () => void; onRemoveSelected: () => void }) {
  const selectable = assets.filter((asset) => !asset.error);
  const selected = selectable.filter((asset) => asset.selected).length;
  const allSelected = selectable.length > 0 && selected === selectable.length;
  return (
    <div className="gallery-toolbar">
      <div className="gallery-toolbar-left">
        <label className="checkbox" title="すべて選択">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="処理できる画像をすべて選択" disabled={disabled} />
        </label>
        <span className="selection-pill">{selected} / {selectable.length} 選択</span>
        {assets.some((asset) => asset.error) ? <span className="status-pill">問題 {assets.filter((asset) => asset.error).length}</span> : null}
      </div>
      <div className="toolbar-actions">
        <button className="btn btn-quiet btn-small" type="button" onClick={onRemoveSelected} disabled={disabled || !assets.some((asset) => asset.selected)}><Icon name="trash" /> <span className="desktop-only">選択を削除</span></button>
      </div>
    </div>
  );
}

function ImageCard({
  asset,
  output,
  disabled,
  onToggle,
  onRemove,
  onCompare,
}: {
  asset: AssetRecord;
  output?: ProcessedRecord;
  disabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onCompare: () => void;
}) {
  const status = output ? "completed" : asset.status;
  return (
    <article className={`image-card ${asset.selected ? "is-selected" : ""} ${asset.error ? "has-error" : ""}`} onDoubleClick={output && !disabled ? onCompare : undefined}>
      <div className="thumbnail-wrap">
        {asset.originalUrl ? <img src={asset.originalUrl} alt={`${asset.name}のサムネイル`} /> : <Icon name="error" />}
        <label className="checkbox thumbnail-check" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={asset.selected} disabled={disabled || Boolean(asset.error)} onChange={onToggle} aria-label={`${asset.name}を選択`} />
        </label>
        <span className={`card-status ${status === "completed" ? "done" : status === "error" ? "error" : ""}`}>
          {status === "processing" ? "処理中" : status === "queued" ? "待機" : status === "completed" ? "完了" : status === "error" ? "エラー" : "Ready"}
        </span>
      </div>
      <div className="card-body">
        <strong className="file-name" title={asset.name}>{output?.name ?? asset.name}</strong>
        <div className="file-meta">
          <span>{output ? `${output.width} × ${output.height}` : asset.width ? `${asset.width} × ${asset.height}` : "読み取り不可"}</span>
          <span>{output ? formatBytes(output.size) : formatBytes(asset.size)}</span>
          <span>{output ? formatLabel(output.mime) : formatLabel(asset.mime)}</span>
          <span>{output ? `${savingsPercent(asset.size, output.size).toFixed(0)}%削減` : "Original"}</span>
        </div>
        {asset.error ? <p className="file-error">{asset.error}</p> : null}
        <div className="inline-actions" style={{ marginTop: 8 }}>
          {output ? <button className="btn btn-quiet btn-small" type="button" onClick={onCompare} disabled={disabled}><Icon name="compare" /> 比較</button> : null}
          <button className="icon-button" type="button" onClick={onRemove} title="削除" disabled={disabled}><Icon name="trash" /></button>
        </div>
      </div>
    </article>
  );
}

function WorkflowPanel({
  workflow,
  openStepId,
  templateName,
  capabilities,
  isOpen,
  disabled,
  onClose,
  onOpenStep,
  onToggleStep,
  onMoveStep,
  onUpdateStep,
  onPreset,
  onTemplateName,
  onSaveTemplate,
  onProcess,
}: {
  workflow: Workflow;
  openStepId?: string;
  templateName: string;
  capabilities: ImageCapabilities;
  isOpen: boolean;
  disabled: boolean;
  onClose: () => void;
  onOpenStep: (id: string) => void;
  onToggleStep: (id: string) => void;
  onMoveStep: (id: string, direction: -1 | 1) => void;
  onUpdateStep: <T extends WorkflowStep>(id: string, patch: Partial<T["config"]>) => void;
  onPreset: (step: ResizeStep, preset: typeof PRESETS[number]) => void;
  onTemplateName: (value: string) => void;
  onSaveTemplate: () => void;
  onProcess: () => void;
}) {
  return (
    <aside className={`workflow-panel ${isOpen ? "is-mobile-open" : ""}`} aria-label="Batch Workflow">
      <div className="workflow-header">
        <div>
          <h2>Batch Workflow</h2>
          <p>{workflow.steps.filter((step) => step.enabled).length}工程を上から順に実行</p>
        </div>
        <div className="inline-actions">
          <span className="privacy-pill"><span className="privacy-dot" /> Local</span>
          <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Workflowを閉じる"><Icon name="close" /></button>
        </div>
      </div>
      <div className="workflow-scroll">
        <div className="workflow-list">
          {workflow.steps.map((step, index) => (
            <div key={step.id} className={`workflow-step ${openStepId === step.id ? "is-open" : ""}`}>
              <button className="step-summary" type="button" onClick={() => onOpenStep(step.id)} aria-expanded={openStepId === step.id}>
                <span className={`step-icon ${step.type}`}><Icon name={stepIcon(step)} /></span>
                <span className="step-copy"><strong>{stepTitle(step)}</strong><span>{stepSummary(step)}</span></span>
                <span className="step-controls">
                  <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                  <Icon name="chevron" style={{ transform: openStepId === step.id ? "rotate(180deg)" : undefined }} />
                </span>
              </button>
              {openStepId === step.id ? (
                <fieldset className="step-editor" disabled={disabled}>
                  <div className="switch-row field-group">
                    <div className="switch-copy"><strong>この工程を実行</strong><span>オフにしても設定は保持されます。</span></div>
                    <label className="switch"><input type="checkbox" checked={step.enabled} onChange={() => onToggleStep(step.id)} /><span className="switch-track" /></label>
                  </div>
                  <StepEditor step={step} capabilities={capabilities} onUpdate={onUpdateStep} onPreset={onPreset} />
                  <div className="inline-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
                    <button className="icon-button" type="button" onClick={() => onMoveStep(step.id, -1)} disabled={index === 0 || step.type === "zip"} title="上へ移動"><Icon name="arrow-up" /></button>
                    <button className="icon-button" type="button" onClick={() => onMoveStep(step.id, 1)} disabled={index === workflow.steps.length - 1 || step.type === "zip" || workflow.steps[index + 1]?.type === "zip"} title="下へ移動"><Icon name="arrow-down" /></button>
                  </div>
                </fieldset>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="workflow-footer">
        <button className="btn btn-primary" type="button" onClick={onProcess} disabled={disabled}><Icon name="play" /> 一括処理を実行</button>
        <div className="template-save-row">
          <input className="text-input" value={templateName} onChange={(event) => onTemplateName(event.target.value)} placeholder="例：EC商品画像" aria-label="Template名" disabled={disabled} />
          <button className="btn btn-secondary btn-small" type="button" onClick={onSaveTemplate} disabled={disabled}><Icon name="save" /> 保存</button>
        </div>
      </div>
    </aside>
  );
}

function StepEditor({
  step,
  capabilities,
  onUpdate,
  onPreset,
}: {
  step: WorkflowStep;
  capabilities: ImageCapabilities;
  onUpdate: <T extends WorkflowStep>(id: string, patch: Partial<T["config"]>) => void;
  onPreset: (step: ResizeStep, preset: typeof PRESETS[number]) => void;
}) {
  if (step.type === "resize") return <ResizeEditor step={step} onUpdate={onUpdate} onPreset={onPreset} />;
  if (step.type === "crop") return <CropEditor step={step} onUpdate={onUpdate} />;
  if (step.type === "format") return <FormatEditor step={step} capabilities={capabilities} onUpdate={onUpdate} />;
  if (step.type === "compress") return (
    <div className="field-group">
      <label className="field-label" htmlFor={`quality-${step.id}`}><span>品質</span><span>{step.config.quality}%</span></label>
      <div className="range-row"><input id={`quality-${step.id}`} className="range-input" type="range" min="10" max="100" value={step.config.quality} onChange={(event) => onUpdate(step.id, { quality: Number(event.target.value) })} /><span className="range-value">{step.config.quality}</span></div>
      <p className="field-help">出力サイズは画像内容とブラウザのCodecにより変わります。実結果をBefore / Afterで確認できます。</p>
    </div>
  );
  if (step.type === "metadata") return <MetadataEditor />;
  if (step.type === "rename") return <RenameEditor step={step} onUpdate={onUpdate} />;
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={`zip-${step.id}`}>ZIPファイル名</label>
      <input id={`zip-${step.id}`} className="text-input" value={step.config.archiveName} onChange={(event) => onUpdate(step.id, { archiveName: event.target.value.replace(/\.zip$/i, "") })} />
      <p className="field-help">処理済み画像を1つのZIPへまとめてダウンロードします。</p>
    </div>
  );
}

function ResizeEditor({ step, onUpdate, onPreset }: { step: ResizeStep; onUpdate: <T extends WorkflowStep>(id: string, patch: Partial<T["config"]>) => void; onPreset: (step: ResizeStep, preset: typeof PRESETS[number]) => void }) {
  const modes: Array<{ value: ResizeStep["config"]["mode"]; label: string }> = [
    { value: "width", label: "Width" }, { value: "height", label: "Height" }, { value: "dimensions", label: "W × H" },
    { value: "percentage", label: "%" }, { value: "long-side", label: "Long side" }, { value: "short-side", label: "Short side" },
  ];
  return (
    <>
      <div className="field-group">
        <span className="field-heading">Resize基準</span>
        <div className="choice-grid">{modes.map((mode) => <button key={mode.value} className="choice-button" type="button" aria-pressed={step.config.mode === mode.value} onClick={() => onUpdate(step.id, { mode: mode.value })}>{mode.label}</button>)}</div>
      </div>
      <div className="field-group">
        <span className="field-heading">サイズ</span>
        <div className="field-grid">
          {(step.config.mode === "width" || step.config.mode === "dimensions") ? <NumberField label="Width" value={step.config.width ?? 1600} onChange={(value) => onUpdate(step.id, { width: value })} /> : null}
          {(step.config.mode === "height" || step.config.mode === "dimensions") ? <NumberField label="Height" value={step.config.height ?? 1200} onChange={(value) => onUpdate(step.id, { height: value })} /> : null}
          {step.config.mode === "percentage" ? <NumberField label="Percentage" value={step.config.percentage ?? 100} unit="%" onChange={(value) => onUpdate(step.id, { percentage: value })} /> : null}
          {step.config.mode === "long-side" ? <NumberField label="Long side" value={step.config.longSide ?? 1600} onChange={(value) => onUpdate(step.id, { longSide: value })} /> : null}
          {step.config.mode === "short-side" ? <NumberField label="Short side" value={step.config.shortSide ?? 1200} onChange={(value) => onUpdate(step.id, { shortSide: value })} /> : null}
        </div>
      </div>
      <div className="field-group switch-row">
        <div className="switch-copy"><strong>Aspect Ratioを維持</strong><span>縦横比を保ち、変形を防ぎます。</span></div>
        <label className="switch"><input type="checkbox" checked={step.config.maintainAspectRatio} onChange={(event) => onUpdate(step.id, { maintainAspectRatio: event.target.checked })} /><span className="switch-track" /></label>
      </div>
      {!step.config.maintainAspectRatio ? <div className="warning-box field-group"><Icon name="warning" /> Stretchは画像を歪ませるため、このWorkflowでは実行時に拒否されます。CropのCover / Containを利用してください。</div> : null}
      <div className="field-group">
        <span className="field-heading">汎用Preset <small>仕様変更に依存しない名称</small></span>
        <div className="preset-grid">{PRESETS.map((preset) => <button key={preset.label} className="preset-button" type="button" aria-pressed={false} onClick={() => onPreset(step, preset)}><strong>{preset.label}</strong><span>{preset.width} × {preset.height}・{preset.detail}</span></button>)}</div>
      </div>
    </>
  );
}

function NumberField({ label, value, unit = "px", onChange }: { label: string; value: number; unit?: string; onChange: (value: number) => void }) {
  return <label><span className="field-label">{label}</span><span className="input-with-unit"><input className="number-input" type="number" min="1" max="16000" value={value} onChange={(event) => onChange(Math.max(1, Number(event.target.value)))} /><span>{unit}</span></span></label>;
}

function CropEditor({ step, onUpdate }: { step: CropStep; onUpdate: <T extends WorkflowStep>(id: string, patch: Partial<T["config"]>) => void }) {
  const ratios: CropStep["config"]["aspect"][] = ["original", "1:1", "4:3", "16:9", "custom"];
  return (
    <>
      <div className="field-group"><span className="field-heading">Crop Ratio</span><div className="choice-grid">{ratios.map((ratio) => <button key={ratio} className="choice-button" type="button" aria-pressed={step.config.aspect === ratio} onClick={() => onUpdate(step.id, { aspect: ratio })}>{ratio === "original" ? "Original" : ratio === "custom" ? "Custom" : ratio}</button>)}</div></div>
      {step.config.aspect === "custom" ? <div className="field-group field-grid"><NumberField label="Ratio W" value={step.config.customWidth ?? 3} unit="" onChange={(value) => onUpdate(step.id, { customWidth: value })} /><NumberField label="Ratio H" value={step.config.customHeight ?? 2} unit="" onChange={(value) => onUpdate(step.id, { customHeight: value })} /></div> : null}
      <div className="field-group"><span className="field-heading">Fit Mode</span><div className="choice-grid"><button className="choice-button" type="button" aria-pressed={step.config.fitMode === "cover"} onClick={() => onUpdate(step.id, { fitMode: "cover" })}>Cover</button><button className="choice-button" type="button" aria-pressed={step.config.fitMode === "contain"} onClick={() => onUpdate(step.id, { fitMode: "contain" })}>Contain</button></div><p className="field-help">Coverは枠を満たして端をCrop。Containは全体を収め、余白にはFormat工程の背景色を使います。Stretchは提供しません。</p></div>
    </>
  );
}

function FormatEditor({ step, capabilities, onUpdate }: { step: FormatStep; capabilities: ImageCapabilities; onUpdate: <T extends WorkflowStep>(id: string, patch: Partial<T["config"]>) => void }) {
  const formats: ImageFormat[] = ["jpeg", "png", "webp", "avif"];
  return (
    <>
      <div className="field-group"><span className="field-heading">出力Format</span><div className="format-grid">{formats.map((format) => <button key={format} className="format-button" type="button" disabled={!capabilities[format].encode} aria-pressed={step.config.format === format} onClick={() => onUpdate(step.id, { format })}>{format.toUpperCase()} {!capabilities[format].encode ? "非対応" : ""}</button>)}</div></div>
      {step.config.format === "jpeg" ? <div className="field-group"><span className="field-heading">透明部分の背景</span><div className="color-row"><span className="color-swatch"><input type="color" value={step.config.background} onChange={(event) => onUpdate(step.id, { background: event.target.value })} aria-label="JPEG背景色" /></span><input className="text-input" value={step.config.background} onChange={(event) => onUpdate(step.id, { background: event.target.value })} /></div><p className="field-help">JPEGは透明を保持できないため、指定色で合成します。</p></div> : null}
      <div className="info-box"><Icon name="info" /> AVIFの読み書きはブラウザ実装に依存します。起動時に実際のEncoderを確認し、使えない場合は無効化しています。</div>
    </>
  );
}

function MetadataEditor() {
  return (
    <div className="privacy-box">
      <Icon name="lock" />
      <span><strong>Privacy-firstで常時削除</strong><br />EXIF・XMP・IPTC・位置情報（GPS）・色プロファイルを常に削除し、出力へ引き継ぎません。Canvas再エンコード後に元の色プロファイルを安全に保持できると保証できないため、保持は選択できません。</span>
    </div>
  );
}

function RenameEditor({ step, onUpdate }: { step: RenameStep; onUpdate: <T extends WorkflowStep>(id: string, patch: Partial<T["config"]>) => void }) {
  return (
    <>
      <div className="field-group"><label className="field-label" htmlFor={`rename-${step.id}`}>Template</label><input id={`rename-${step.id}`} className="text-input" value={step.config.template} onChange={(event) => onUpdate(step.id, { template: event.target.value })} /><p className="field-help">使える変数: {"{name} {number} {width} {height} {format}"}</p></div>
      <div className="field-grid"><NumberField label="Start" value={step.config.startNumber} unit="" onChange={(value) => onUpdate(step.id, { startNumber: value })} /><NumberField label="Padding" value={step.config.padding} unit="桁" onChange={(value) => onUpdate(step.id, { padding: Math.min(8, value) })} /></div>
      <div className="info-box" style={{ marginTop: 10 }}><Icon name="rename" /> Preview: product_{String(step.config.startNumber).padStart(step.config.padding, "0")}_1600x1600.webp</div>
    </>
  );
}

function CompareView({
  asset,
  output,
  position,
  zoom,
  onPointer,
  onZoom,
  onBack,
  onProcess,
}: {
  asset?: AssetRecord;
  output?: ProcessedRecord;
  position: number;
  zoom: number;
  onPointer: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onZoom: (value: number) => void;
  onBack: () => void;
  onProcess: () => void;
}) {
  return (
    <section className="compare-panel">
      <div className="view-header"><div className="view-title"><h2>Before / After</h2><p>Dividerをドラッグして、画質とCropを確認</p></div><div className="inline-actions"><button className="btn btn-secondary btn-small" type="button" onClick={onBack}>Galleryへ</button>{asset && !output ? <button className="btn btn-primary btn-small" type="button" onClick={onProcess}><Icon name="play" /> 処理する</button> : null}</div></div>
      {!asset || !output ? <div className="empty-view"><div><div className="empty-icon"><Icon name="compare" /></div><h3>比較用の処理結果がありません</h3><p>Galleryで画像を追加し、Batch Workflowを実行すると左右比較とZoomが使えます。</p><button className="btn btn-primary" type="button" onClick={asset ? onProcess : onBack}>{asset ? "Workflowを実行" : "Galleryへ戻る"}</button></div></div> : (
        <div className="compare-layout">
          <div className="comparison-stage">
            <div className="comparison-canvas" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onPointer(event); }}>
              <img src={asset.originalUrl} alt="処理前" style={{ transform: `scale(${zoom / 100})` }} />
              <div className="comparison-after" style={{ width: `${position}%` }}><img src={output.outputUrl} alt="処理後" style={{ width: `${10000 / Math.max(position, 1)}%`, transform: `scale(${zoom / 100})` }} /></div>
              <span className="compare-label before">Before</span><span className="compare-label after">After</span>
              <div className="comparison-divider" style={{ left: `${position}%` }}><span className="comparison-handle"><Icon name="arrow-left-right" /></span></div>
            </div>
          </div>
          <aside className="compare-sidebar">
            <div className="compare-stat"><span>Dimensions</span><strong>{asset.width} × {asset.height}</strong><span>→ {output.width} × {output.height}</span></div>
            <div className="compare-stat"><span>File size</span><strong>{formatBytes(asset.size)}</strong><span>→ {formatBytes(output.size)}</span></div>
            <div className="compare-stat"><span>Saved</span><strong style={{ color: savingsPercent(asset.size, output.size) >= 0 ? "#188157" : "#b53232" }}>{savingsPercent(asset.size, output.size).toFixed(1)}%</strong><span>{formatLabel(asset.mime)} → {formatLabel(output.mime)}</span></div>
            <div className="zoom-row"><button className="icon-button" type="button" onClick={() => onZoom(Math.max(50, zoom - 25))} aria-label="縮小"><Icon name="zoom-out" /></button><span className="selection-pill">{zoom}%</span><button className="icon-button" type="button" onClick={() => onZoom(Math.min(200, zoom + 25))} aria-label="拡大"><Icon name="zoom-in" /></button></div>
          </aside>
        </div>
      )}
    </section>
  );
}

function ResultsView({
  assets,
  outputs,
  originalTotal,
  optimizedTotal,
  zipUrl,
  zipName,
  onBack,
}: {
  assets: AssetRecord[];
  outputs: ProcessedRecord[];
  originalTotal: number;
  optimizedTotal: number;
  zipUrl?: string;
  zipName: string;
  onBack: () => void;
}) {
  return (
    <section className="results-panel">
      <div className="view-header"><div className="view-title"><h2>Compression Results</h2><p>画像ごとの削減量とBatch全体の成果</p></div><div className="inline-actions"><button className="btn btn-secondary btn-small" type="button" onClick={onBack}>Galleryへ</button>{zipUrl ? <a className="btn btn-primary btn-small" href={zipUrl} download={zipName}><Icon name="download" /> ZIPをダウンロード</a> : <button className="btn btn-primary btn-small" type="button" disabled><Icon name="download" /> ZIPをダウンロード</button>}</div></div>
      {!outputs.length ? <div className="empty-view"><div><div className="empty-icon"><Icon name="compress" /></div><h3>処理結果はまだありません</h3><p>Workflowを実行すると、Original total・Optimized・削減率を画像ごとに確認できます。</p><button className="btn btn-primary" type="button" onClick={onBack}>Galleryへ戻る</button></div></div> : (
        <div className="results-body">
          <div className="results-hero">
            <div className="result-kpi featured"><span>Saved</span><strong>{savingsPercent(originalTotal, optimizedTotal).toFixed(1)}%</strong></div>
            <div className="result-kpi"><span>Original total</span><strong>{formatBytes(originalTotal)}</strong></div>
            <div className="result-kpi"><span>Optimized</span><strong>{formatBytes(optimizedTotal)}</strong></div>
            <div className="result-kpi"><span>Processed</span><strong>{outputs.length} images</strong></div>
          </div>
          <div className="results-table">
            <div className="result-row header"><span>File</span><span>Dimensions</span><span>Original</span><span>Optimized</span><span>Saved</span></div>
            {outputs.map((output) => {
              const asset = assets.find((item) => item.id === output.assetId);
              if (!asset) return null;
              const percent = savingsPercent(asset.size, output.size);
              return <div key={output.assetId} className="result-row"><div className="result-file"><img className="result-thumb" src={output.outputUrl} alt="" /><span>{output.name}</span></div><span>{output.width} × {output.height}</span><span>{formatBytes(asset.size)}</span><span>{formatBytes(output.size)}</span><span className="savings-bar"><span className="savings-track"><span className="savings-fill" style={{ width: `${Math.max(0, percent)}%` }} /></span><strong>{percent.toFixed(0)}%</strong></span></div>;
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function TemplatesView({ templates, disabled, onUse, onDelete }: { templates: WorkflowTemplate[]; disabled: boolean; onUse: (template: WorkflowTemplate) => void; onDelete: (id: string) => void }) {
  return (
    <section className="templates-panel">
      <div className="view-header"><div className="view-title"><h2>Workflow Templates</h2><p>繰り返す画像加工を、次回はワンクリックで再現</p></div><span className="selection-pill">{templates.length} templates</span></div>
      <div className="templates-body"><div className="template-grid">{templates.map((template) => (
        <article key={template.id} className="template-card"><div className="template-icon"><Icon name={template.builtIn ? "sparkles" : "template"} /></div><h3>{template.name}</h3><p>{template.description}</p><div className="template-steps">{template.workflow.steps.filter((step) => step.enabled).map((step) => <span key={step.id} className="template-step-chip">{stepTitle(step)}</span>)}</div><button className="btn btn-secondary btn-small" type="button" onClick={() => onUse(template)} disabled={disabled}>Workflowへ適用</button>{!template.builtIn ? <button className="btn btn-quiet btn-small" type="button" onClick={() => onDelete(template.id)} disabled={disabled}>削除</button> : null}</article>
      ))}</div></div>
    </section>
  );
}

function ProcessingDock({
  hasAssets,
  isProcessing,
  progress,
  originalTotal,
  optimizedTotal,
  zipReady,
  zipUrl,
  zipName,
  onProcess,
  onCancel,
}: {
  hasAssets: boolean;
  isProcessing: boolean;
  progress: { completed: number; total: number; percent: number; current: string };
  originalTotal: number;
  optimizedTotal: number;
  zipReady: boolean;
  zipUrl?: string;
  zipName: string;
  onProcess: () => void;
  onCancel: () => void;
}) {
  const done = zipReady && !isProcessing;
  return (
    <div className="processing-dock" aria-live="polite">
      <div className="dock-status"><span className={`dock-status-icon ${done ? "done" : ""}`}><Icon name={isProcessing ? "spinner" : done ? "check" : "workflow"} /></span><span><strong>{isProcessing ? `${progress.completed} / ${progress.total} 処理中` : done ? "Batch完了" : hasAssets ? "Workflow準備完了" : "画像を追加してください"}</strong><span>{isProcessing ? progress.current : done ? "ZIPをダウンロードできます" : "Resize → Crop → Format → Compress → Metadata → Rename → ZIP"}</span></span></div>
      <div className="dock-progress-wrap"><div className="dock-progress-labels"><span>{isProcessing || done ? progress.current : "Local-first processing"}</span><span>{isProcessing || done ? `${progress.percent}%` : "0%"}</span></div><div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><div className="progress-fill" style={{ width: `${progress.percent}%` }} /></div></div>
      <div className="dock-metrics"><div className="dock-metric"><span>Original</span><strong>{formatBytes(originalTotal)}</strong></div><div className="dock-metric"><span>Optimized</span><strong>{optimizedTotal ? formatBytes(optimizedTotal) : "—"}</strong></div><div className="dock-metric"><span>Saved</span><strong>{isProcessing ? "計測中" : optimizedTotal ? `${savingsPercent(originalTotal, optimizedTotal).toFixed(1)}%` : "—"}</strong></div></div>
      {isProcessing ? <button className="dock-button cancel" type="button" onClick={onCancel}>キャンセル</button> : done && zipUrl ? <a className="dock-button" href={zipUrl} download={zipName}><Icon name="download" /> ZIP Download</a> : <button className="dock-button" type="button" onClick={onProcess} disabled={!hasAssets}><Icon name="play" /> 一括実行</button>}
    </div>
  );
}
