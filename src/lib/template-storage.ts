import type { StorageLike, Workflow, WorkflowTemplate } from "./types";
import { WORKFLOW_SCHEMA_VERSION } from "./types";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  parseWorkflow,
  parseWorkflowTemplate,
  WorkflowValidationError,
} from "./workflow";

export const TEMPLATE_STORAGE_KEY = "image-batch-resizer:workflow-templates";

interface TemplateStoreDocument {
  version: typeof WORKFLOW_SCHEMA_VERSION;
  templates: WorkflowTemplate[];
}

export class TemplateStorageError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TemplateStorageError";
    this.cause = cause;
  }
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function requireStorage(storage?: StorageLike): StorageLike {
  const resolved = storage ?? defaultStorage();
  if (!resolved) {
    throw new TemplateStorageError("Browser storage is unavailable.");
  }
  return resolved;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deserializeStoredWorkflowTemplates(serialized: string): WorkflowTemplate[] {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new TemplateStorageError("Saved workflow templates are not valid JSON.", error);
  }
  if (!isObject(value) || value.version !== WORKFLOW_SCHEMA_VERSION || !Array.isArray(value.templates)) {
    throw new TemplateStorageError(
      `Saved workflow templates must use schema version ${WORKFLOW_SCHEMA_VERSION}.`,
    );
  }

  try {
    return value.templates.map((template) => {
      const parsed = parseWorkflowTemplate(template);
      if (parsed.builtIn) {
        throw new TemplateStorageError("Built-in templates cannot be loaded from custom storage.");
      }
      return parsed;
    });
  } catch (error) {
    if (error instanceof TemplateStorageError) throw error;
    if (error instanceof WorkflowValidationError) {
      throw new TemplateStorageError("A saved workflow template is invalid.", error);
    }
    throw error;
  }
}

export function serializeStoredWorkflowTemplates(
  templates: readonly WorkflowTemplate[],
): string {
  const parsed = templates.map((template) => {
    const value = parseWorkflowTemplate(template);
    if (value.builtIn) {
      throw new TemplateStorageError("Built-in templates must not be written to custom storage.");
    }
    return value;
  });
  const document: TemplateStoreDocument = {
    version: WORKFLOW_SCHEMA_VERSION,
    templates: parsed,
  };
  return JSON.stringify(document);
}

/** Corrupt or future-version data is ignored so it cannot prevent the app loading. */
export function loadCustomWorkflowTemplates(storage?: StorageLike): WorkflowTemplate[] {
  const resolved = storage ?? defaultStorage();
  if (!resolved) return [];
  try {
    const serialized = resolved.getItem(TEMPLATE_STORAGE_KEY);
    return serialized === null ? [] : deserializeStoredWorkflowTemplates(serialized);
  } catch {
    return [];
  }
}

/** Returns fresh clones: consumers may edit them without mutating shipped presets. */
export function loadWorkflowTemplates(storage?: StorageLike): WorkflowTemplate[] {
  const builtIns = BUILT_IN_WORKFLOW_TEMPLATES.map((template) => parseWorkflowTemplate(template));
  const reservedIds = new Set(builtIns.map((template) => template.id));
  const custom = loadCustomWorkflowTemplates(storage).filter(
    (template) => !reservedIds.has(template.id),
  );
  return [...builtIns, ...custom];
}

export interface CreateWorkflowTemplateInput {
  id: string;
  name: string;
  description?: string;
  category?: string;
  now?: Date;
}

export function createCustomWorkflowTemplate(
  workflow: Workflow,
  input: CreateWorkflowTemplateInput,
): WorkflowTemplate {
  const parsedWorkflow = parseWorkflow(workflow);
  const timestamp = (input.now ?? new Date()).toISOString();
  return parseWorkflowTemplate({
    version: WORKFLOW_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    description: input.description ?? parsedWorkflow.description ?? "",
    category: input.category ?? "Custom",
    builtIn: false,
    workflow: {
      ...parsedWorkflow,
      name: input.name,
      updatedAt: timestamp,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function saveWorkflowTemplate(
  template: WorkflowTemplate,
  storage?: StorageLike,
): WorkflowTemplate[] {
  const resolved = requireStorage(storage);
  const parsed = parseWorkflowTemplate(template);
  if (parsed.builtIn || BUILT_IN_WORKFLOW_TEMPLATES.some((item) => item.id === parsed.id)) {
    throw new TemplateStorageError("Built-in workflow templates cannot be overwritten.");
  }

  const templates = loadCustomWorkflowTemplates(resolved);
  const existingIndex = templates.findIndex((item) => item.id === parsed.id);
  if (existingIndex >= 0) templates[existingIndex] = parsed;
  else templates.push(parsed);

  try {
    resolved.setItem(TEMPLATE_STORAGE_KEY, serializeStoredWorkflowTemplates(templates));
  } catch (error) {
    throw new TemplateStorageError("Workflow template could not be saved.", error);
  }
  return templates;
}

export function deleteWorkflowTemplate(id: string, storage?: StorageLike): WorkflowTemplate[] {
  if (BUILT_IN_WORKFLOW_TEMPLATES.some((item) => item.id === id)) {
    throw new TemplateStorageError("Built-in workflow templates cannot be deleted.");
  }
  const resolved = requireStorage(storage);
  const templates = loadCustomWorkflowTemplates(resolved).filter((item) => item.id !== id);
  try {
    resolved.setItem(TEMPLATE_STORAGE_KEY, serializeStoredWorkflowTemplates(templates));
  } catch (error) {
    throw new TemplateStorageError("Workflow template could not be deleted.", error);
  }
  return templates;
}

export function clearCustomWorkflowTemplates(storage?: StorageLike): void {
  const resolved = requireStorage(storage);
  try {
    resolved.removeItem(TEMPLATE_STORAGE_KEY);
  } catch (error) {
    throw new TemplateStorageError("Saved workflow templates could not be cleared.", error);
  }
}
