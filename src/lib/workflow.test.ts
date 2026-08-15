import { describe, expect, it } from "vitest";

import type { Workflow } from "./types";
import { WORKFLOW_SCHEMA_VERSION } from "./types";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  deserializeWorkflow,
  getWorkflowValidationIssues,
  parseWorkflow,
  parseWorkflowTemplate,
  serializeWorkflow,
  validateWorkflow,
  WorkflowValidationError,
} from "./workflow";

const validWorkflow: Workflow = {
  version: WORKFLOW_SCHEMA_VERSION,
  id: "workflow-1",
  name: "Test workflow",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
  steps: [
    {
      id: "resize",
      type: "resize",
      enabled: true,
      config: {
        mode: "dimensions",
        width: 1600,
        height: 1600,
        maintainAspectRatio: true,
        allowUpscale: false,
      },
    },
    { id: "format", type: "format", enabled: true, config: { format: "webp", background: "#fff" } },
    { id: "compress", type: "compress", enabled: true, config: { quality: 80 } },
    { id: "metadata", type: "metadata", enabled: true, config: { mode: "remove" } },
    {
      id: "rename",
      type: "rename",
      enabled: true,
      config: { template: "product_{number}_{width}x{height}.{format}", startNumber: 1, padding: 2 },
    },
    { id: "zip", type: "zip", enabled: true, config: { archiveName: "products.zip" } },
  ],
};

describe("workflow validation", () => {
  it("accepts and clones a valid versioned workflow", () => {
    expect(validateWorkflow(validWorkflow)).toBe(true);
    const parsed = parseWorkflow(validWorkflow);
    expect(parsed).toEqual(validWorkflow);
    expect(parsed).not.toBe(validWorkflow);
    expect(parsed.steps).not.toBe(validWorkflow.steps);
  });

  it("round-trips serialized workflows", () => {
    expect(deserializeWorkflow(serializeWorkflow(validWorkflow))).toEqual(validWorkflow);
  });

  it("rejects unsupported versions", () => {
    const invalid = { ...validWorkflow, version: 2 };
    expect(validateWorkflow(invalid)).toBe(false);
    expect(() => parseWorkflow(invalid)).toThrow(WorkflowValidationError);
  });

  it("reports invalid step config and duplicate ids", () => {
    const invalid = {
      ...validWorkflow,
      steps: [
        { id: "same", type: "compress", enabled: true, config: { quality: 0 } },
        { id: "same", type: "crop", enabled: true, config: { aspect: "custom", fitMode: "stretch" } },
      ],
    };
    const issues = getWorkflowValidationIssues(invalid);
    expect(issues.some((item) => item.path.endsWith("quality"))).toBe(true);
    expect(issues.some((item) => item.message.includes("unique"))).toBe(true);
    expect(issues.some((item) => item.message.includes("stretch"))).toBe(true);
    expect(issues.some((item) => item.path.endsWith("customWidth"))).toBe(true);
  });

  it("requires an enabled ZIP step to be last", () => {
    const invalid = {
      ...validWorkflow,
      steps: [
        validWorkflow.steps.at(-1),
        validWorkflow.steps[0],
      ],
    };
    expect(getWorkflowValidationIssues(invalid).some((item) => item.message.includes("last"))).toBe(
      true,
    );
  });
});

describe("built-in workflow templates", () => {
  it("ships valid EC, blog and portfolio workflows", () => {
    expect(BUILT_IN_WORKFLOW_TEMPLATES.map((item) => item.name)).toEqual([
      "EC商品画像",
      "ブログ画像",
      "ポートフォリオ画像",
    ]);
    for (const item of BUILT_IN_WORKFLOW_TEMPLATES) {
      expect(() => parseWorkflowTemplate(item)).not.toThrow();
      expect(item.builtIn).toBe(true);
      expect(item.workflow.steps.slice(0, 2).map((step) => step.type)).toEqual([
        "resize",
        "crop",
      ]);
      expect(item.workflow.steps[1]).toMatchObject({
        type: "crop",
        enabled: true,
        config: { aspect: "original", fitMode: "cover" },
      });
      expect(item.workflow.steps.at(-1)?.type).toBe("zip");
    }
  });
});
