import { assertValidFilenameTemplate } from "./filename-template";
import type {
  CropStepConfig,
  ResizeStepConfig,
  Workflow,
  WorkflowStep,
  WorkflowTemplate,
} from "./types";
import { IMAGE_FORMATS, WORKFLOW_SCHEMA_VERSION } from "./types";

export interface WorkflowValidationIssue {
  path: string;
  message: string;
}

export class WorkflowValidationError extends Error {
  readonly issues: readonly WorkflowValidationIssue[];

  constructor(label: string, issues: readonly WorkflowValidationIssue[]) {
    super(`${label} is invalid: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "WorkflowValidationError";
    this.issues = issues;
  }
}

const RESIZE_MODES = [
  "width",
  "height",
  "dimensions",
  "percentage",
  "long-side",
  "short-side",
] as const;
const CROP_ASPECTS = ["original", "1:1", "4:3", "16:9", "custom"] as const;
const STEP_TYPES = ["resize", "crop", "format", "compress", "metadata", "rename", "zip"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasString = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

function issue(
  issues: WorkflowValidationIssue[],
  path: string,
  condition: boolean,
  message: string,
): void {
  if (!condition) issues.push({ path, message });
}

function validateResizeConfig(
  config: Record<string, unknown>,
  path: string,
  issues: WorkflowValidationIssue[],
): void {
  issue(issues, `${path}.mode`, RESIZE_MODES.includes(config.mode as ResizeStepConfig["mode"]), "is unsupported");
  issue(
    issues,
    `${path}.maintainAspectRatio`,
    typeof config.maintainAspectRatio === "boolean",
    "must be a boolean",
  );
  issue(
    issues,
    `${path}.allowUpscale`,
    config.allowUpscale === undefined || typeof config.allowUpscale === "boolean",
    "must be a boolean when provided",
  );

  switch (config.mode) {
    case "width":
      issue(issues, `${path}.width`, isPositive(config.width), "must be positive");
      break;
    case "height":
      issue(issues, `${path}.height`, isPositive(config.height), "must be positive");
      break;
    case "dimensions":
      issue(
        issues,
        path,
        isPositive(config.width) || isPositive(config.height),
        "must include a positive width or height",
      );
      break;
    case "percentage":
      issue(issues, `${path}.percentage`, isPositive(config.percentage), "must be positive");
      break;
    case "long-side":
      issue(issues, `${path}.longSide`, isPositive(config.longSide), "must be positive");
      break;
    case "short-side":
      issue(issues, `${path}.shortSide`, isPositive(config.shortSide), "must be positive");
      break;
  }
}

function validateCropConfig(
  config: Record<string, unknown>,
  path: string,
  issues: WorkflowValidationIssue[],
): void {
  issue(issues, `${path}.aspect`, CROP_ASPECTS.includes(config.aspect as CropStepConfig["aspect"]), "is unsupported");
  issue(
    issues,
    `${path}.fitMode`,
    config.fitMode === "cover" || config.fitMode === "contain",
    "must be cover or contain; stretch is disabled",
  );
  if (config.aspect === "custom") {
    issue(issues, `${path}.customWidth`, isPositive(config.customWidth), "must be positive");
    issue(issues, `${path}.customHeight`, isPositive(config.customHeight), "must be positive");
  }
}

function validateStep(
  value: unknown,
  path: string,
  issues: WorkflowValidationIssue[],
): void {
  if (!isObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  issue(issues, `${path}.id`, hasString(value.id, 100), "must be a non-empty string");
  issue(issues, `${path}.type`, STEP_TYPES.includes(value.type as WorkflowStep["type"]), "is unsupported");
  issue(issues, `${path}.enabled`, typeof value.enabled === "boolean", "must be a boolean");
  if (!isObject(value.config)) {
    issues.push({ path: `${path}.config`, message: "must be an object" });
    return;
  }

  const config = value.config;
  switch (value.type) {
    case "resize":
      validateResizeConfig(config, `${path}.config`, issues);
      break;
    case "crop":
      validateCropConfig(config, `${path}.config`, issues);
      break;
    case "format":
      issue(
        issues,
        `${path}.config.format`,
        IMAGE_FORMATS.includes(config.format as (typeof IMAGE_FORMATS)[number]),
        "is unsupported",
      );
      issue(
        issues,
        `${path}.config.background`,
        hasString(config.background, 64),
        "must be a non-empty CSS color",
      );
      break;
    case "compress":
      issue(
        issues,
        `${path}.config.quality`,
        Number.isInteger(config.quality) && Number(config.quality) >= 1 && Number(config.quality) <= 100,
        "must be an integer from 1 to 100",
      );
      break;
    case "metadata":
      issue(
        issues,
        `${path}.config.mode`,
        config.mode === "keep" || config.mode === "remove",
        "must be keep or remove",
      );
      break;
    case "rename":
      issue(
        issues,
        `${path}.config.startNumber`,
        isNonNegativeInteger(config.startNumber),
        "must be a non-negative integer",
      );
      issue(
        issues,
        `${path}.config.padding`,
        Number.isInteger(config.padding) && Number(config.padding) >= 1 && Number(config.padding) <= 12,
        "must be an integer from 1 to 12",
      );
      if (!hasString(config.template, 300)) {
        issues.push({ path: `${path}.config.template`, message: "must be a non-empty string" });
      } else {
        try {
          assertValidFilenameTemplate(config.template);
        } catch (error) {
          issues.push({
            path: `${path}.config.template`,
            message: error instanceof Error ? error.message : "is invalid",
          });
        }
      }
      break;
    case "zip":
      issue(
        issues,
        `${path}.config.archiveName`,
        hasString(config.archiveName, 180),
        "must be a non-empty filename",
      );
      break;
  }
}

export function getWorkflowValidationIssues(value: unknown): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (!isObject(value)) return [{ path: "$", message: "must be an object" }];

  issue(
    issues,
    "$.version",
    value.version === WORKFLOW_SCHEMA_VERSION,
    `must equal ${WORKFLOW_SCHEMA_VERSION}`,
  );
  issue(issues, "$.id", hasString(value.id, 100), "must be a non-empty string");
  issue(issues, "$.name", hasString(value.name, 120), "must be a non-empty string");
  issue(
    issues,
    "$.description",
    value.description === undefined || (typeof value.description === "string" && value.description.length <= 500),
    "must be a string of at most 500 characters",
  );
  issue(issues, "$.createdAt", isIsoDate(value.createdAt), "must be an ISO date string");
  issue(issues, "$.updatedAt", isIsoDate(value.updatedAt), "must be an ISO date string");

  if (!Array.isArray(value.steps)) {
    issues.push({ path: "$.steps", message: "must be an array" });
    return issues;
  }

  const ids = new Set<string>();
  value.steps.forEach((step, index) => {
    validateStep(step, `$.steps[${index}]`, issues);
    if (isObject(step) && typeof step.id === "string") {
      if (ids.has(step.id)) {
        issues.push({ path: `$.steps[${index}].id`, message: "must be unique" });
      }
      ids.add(step.id);
    }
  });

  const enabled = value.steps.filter(
    (step): step is Record<string, unknown> => isObject(step) && step.enabled === true,
  );
  const enabledZipIndexes = enabled
    .map((step, index) => (step.type === "zip" ? index : -1))
    .filter((index) => index >= 0);
  if (enabledZipIndexes.length > 1) {
    issues.push({ path: "$.steps", message: "can contain only one enabled ZIP step" });
  }
  if (enabledZipIndexes.length === 1 && enabledZipIndexes[0] !== enabled.length - 1) {
    issues.push({ path: "$.steps", message: "must place the enabled ZIP step last" });
  }
  return issues;
}

export function validateWorkflow(value: unknown): value is Workflow {
  return getWorkflowValidationIssues(value).length === 0;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function parseWorkflow(value: unknown): Workflow {
  const issues = getWorkflowValidationIssues(value);
  if (issues.length > 0) throw new WorkflowValidationError("Workflow", issues);
  return jsonClone(value as Workflow);
}

export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(parseWorkflow(workflow));
}

export function deserializeWorkflow(serialized: string): Workflow {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new WorkflowValidationError("Workflow", [{ path: "$", message: "must be valid JSON" }]);
  }
  return parseWorkflow(value);
}

export function getWorkflowTemplateValidationIssues(value: unknown): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (!isObject(value)) return [{ path: "$", message: "must be an object" }];
  issue(
    issues,
    "$.version",
    value.version === WORKFLOW_SCHEMA_VERSION,
    `must equal ${WORKFLOW_SCHEMA_VERSION}`,
  );
  issue(issues, "$.id", hasString(value.id, 100), "must be a non-empty string");
  issue(issues, "$.name", hasString(value.name, 120), "must be a non-empty string");
  issue(issues, "$.description", typeof value.description === "string" && value.description.length <= 500, "must be a string");
  issue(issues, "$.category", hasString(value.category, 80), "must be a non-empty string");
  issue(issues, "$.builtIn", typeof value.builtIn === "boolean", "must be a boolean");
  issue(issues, "$.createdAt", isIsoDate(value.createdAt), "must be an ISO date string");
  issue(issues, "$.updatedAt", isIsoDate(value.updatedAt), "must be an ISO date string");
  for (const workflowIssue of getWorkflowValidationIssues(value.workflow)) {
    issues.push({
      path: `$.workflow${workflowIssue.path === "$" ? "" : workflowIssue.path.slice(1)}`,
      message: workflowIssue.message,
    });
  }
  return issues;
}

export function validateWorkflowTemplate(value: unknown): value is WorkflowTemplate {
  return getWorkflowTemplateValidationIssues(value).length === 0;
}

export function parseWorkflowTemplate(value: unknown): WorkflowTemplate {
  const issues = getWorkflowTemplateValidationIssues(value);
  if (issues.length > 0) throw new WorkflowValidationError("Workflow template", issues);
  return jsonClone(value as WorkflowTemplate);
}

export function serializeWorkflowTemplate(template: WorkflowTemplate): string {
  return JSON.stringify(parseWorkflowTemplate(template));
}

export function deserializeWorkflowTemplate(serialized: string): WorkflowTemplate {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new WorkflowValidationError("Workflow template", [
      { path: "$", message: "must be valid JSON" },
    ]);
  }
  return parseWorkflowTemplate(value);
}

const BUILT_IN_DATE = "2026-08-13T00:00:00.000Z";

function template(
  id: string,
  name: string,
  description: string,
  category: string,
  steps: WorkflowStep[],
): WorkflowTemplate {
  return {
    version: WORKFLOW_SCHEMA_VERSION,
    id,
    name,
    description,
    category,
    builtIn: true,
    workflow: {
      version: WORKFLOW_SCHEMA_VERSION,
      id: `${id}-workflow`,
      name,
      description,
      createdAt: BUILT_IN_DATE,
      updatedAt: BUILT_IN_DATE,
      steps,
    },
    createdAt: BUILT_IN_DATE,
    updatedAt: BUILT_IN_DATE,
  };
}

export const BUILT_IN_WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = Object.freeze([
  template("builtin-ec-products", "EC商品画像", "商品画像を長辺1600pxのWebPへ揃え、ZIPにまとめます。", "EC", [
    { id: "resize", type: "resize", enabled: true, config: { mode: "long-side", longSide: 1600, maintainAspectRatio: true, allowUpscale: false } },
    { id: "crop", type: "crop", enabled: true, config: { aspect: "original", fitMode: "cover" } },
    { id: "format", type: "format", enabled: true, config: { format: "webp", background: "#ffffff" } },
    { id: "compress", type: "compress", enabled: true, config: { quality: 80 } },
    { id: "metadata", type: "metadata", enabled: true, config: { mode: "remove" } },
    { id: "rename", type: "rename", enabled: true, config: { template: "product_{number}_{width}x{height}.{format}", startNumber: 1, padding: 2 } },
    { id: "zip", type: "zip", enabled: true, config: { archiveName: "ec-product-images.zip" } },
  ]),
  template("builtin-blog-images", "ブログ画像", "記事画像を横幅1600pxのWebPへ軽量化します。", "Blog", [
    { id: "resize", type: "resize", enabled: true, config: { mode: "width", width: 1600, maintainAspectRatio: true, allowUpscale: false } },
    { id: "crop", type: "crop", enabled: true, config: { aspect: "original", fitMode: "cover" } },
    { id: "format", type: "format", enabled: true, config: { format: "webp", background: "#ffffff" } },
    { id: "compress", type: "compress", enabled: true, config: { quality: 78 } },
    { id: "metadata", type: "metadata", enabled: true, config: { mode: "remove" } },
    { id: "rename", type: "rename", enabled: true, config: { template: "blog_{name}_{width}.{format}", startNumber: 1, padding: 2 } },
    { id: "zip", type: "zip", enabled: true, config: { archiveName: "blog-images.zip" } },
  ]),
  template("builtin-portfolio-images", "ポートフォリオ画像", "作品画像を高精細WebPへ変換し、公開用の名前へ揃えます。", "Portfolio", [
    { id: "resize", type: "resize", enabled: true, config: { mode: "long-side", longSide: 2400, maintainAspectRatio: true, allowUpscale: false } },
    { id: "crop", type: "crop", enabled: true, config: { aspect: "original", fitMode: "cover" } },
    { id: "format", type: "format", enabled: true, config: { format: "webp", background: "#f5f5f7" } },
    { id: "compress", type: "compress", enabled: true, config: { quality: 84 } },
    { id: "metadata", type: "metadata", enabled: true, config: { mode: "remove" } },
    { id: "rename", type: "rename", enabled: true, config: { template: "portfolio_{number}_{name}.{format}", startNumber: 1, padding: 2 } },
    { id: "zip", type: "zip", enabled: true, config: { archiveName: "portfolio-images.zip" } },
  ]),
]);

// Fail during development if a future edit makes a shipped template invalid.
for (const builtInTemplate of BUILT_IN_WORKFLOW_TEMPLATES) {
  parseWorkflowTemplate(builtInTemplate);
}
