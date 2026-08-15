import { describe, expect, it } from "vitest";

import type { StorageLike, Workflow } from "./types";
import { WORKFLOW_SCHEMA_VERSION } from "./types";
import {
  clearCustomWorkflowTemplates,
  createCustomWorkflowTemplate,
  deleteWorkflowTemplate,
  deserializeStoredWorkflowTemplates,
  loadCustomWorkflowTemplates,
  loadWorkflowTemplates,
  saveWorkflowTemplate,
  TEMPLATE_STORAGE_KEY,
  TemplateStorageError,
} from "./template-storage";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "./workflow";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const workflow: Workflow = {
  version: WORKFLOW_SCHEMA_VERSION,
  id: "workflow-custom",
  name: "Custom",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
  steps: [
    {
      id: "resize",
      type: "resize",
      enabled: true,
      config: { mode: "width", width: 1200, maintainAspectRatio: true },
    },
  ],
};

describe("template storage", () => {
  it("saves, updates and deletes custom templates", () => {
    const storage = new MemoryStorage();
    const first = createCustomWorkflowTemplate(workflow, {
      id: "my-template",
      name: "My template",
      now: new Date("2026-08-13T01:00:00.000Z"),
    });
    expect(saveWorkflowTemplate(first, storage)).toHaveLength(1);
    expect(loadCustomWorkflowTemplates(storage)).toEqual([first]);

    const updated = { ...first, description: "Updated" };
    expect(saveWorkflowTemplate(updated, storage)).toEqual([updated]);
    expect(deleteWorkflowTemplate(first.id, storage)).toEqual([]);
    expect(loadCustomWorkflowTemplates(storage)).toEqual([]);
  });

  it("combines immutable built-ins with custom templates", () => {
    const storage = new MemoryStorage();
    const custom = createCustomWorkflowTemplate(workflow, {
      id: "custom",
      name: "Campaign",
      now: new Date("2026-08-13T01:00:00.000Z"),
    });
    saveWorkflowTemplate(custom, storage);
    const all = loadWorkflowTemplates(storage);
    expect(all).toHaveLength(BUILT_IN_WORKFLOW_TEMPLATES.length + 1);
    expect(all.at(-1)?.id).toBe("custom");
    expect(all[0]).not.toBe(BUILT_IN_WORKFLOW_TEMPLATES[0]);
  });

  it("rejects future versions strictly and fails closed during normal load", () => {
    const storage = new MemoryStorage();
    const future = JSON.stringify({ version: 99, templates: [] });
    expect(() => deserializeStoredWorkflowTemplates(future)).toThrow(TemplateStorageError);
    storage.setItem(TEMPLATE_STORAGE_KEY, future);
    expect(loadCustomWorkflowTemplates(storage)).toEqual([]);
  });

  it("does not persist or delete built-in templates", () => {
    const storage = new MemoryStorage();
    expect(() => saveWorkflowTemplate(BUILT_IN_WORKFLOW_TEMPLATES[0]!, storage)).toThrow(
      /cannot be overwritten/,
    );
    expect(() => deleteWorkflowTemplate(BUILT_IN_WORKFLOW_TEMPLATES[0]!.id, storage)).toThrow(
      /cannot be deleted/,
    );
  });

  it("clears only the custom template document", () => {
    const storage = new MemoryStorage();
    storage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify({ version: 1, templates: [] }));
    clearCustomWorkflowTemplates(storage);
    expect(storage.getItem(TEMPLATE_STORAGE_KEY)).toBeNull();
    expect(loadWorkflowTemplates(storage)).toHaveLength(BUILT_IN_WORKFLOW_TEMPLATES.length);
  });
});
