import { describe, expect, it } from "vitest";

import {
  calculateBatchConcurrency,
  estimateWorkflowPeakPixels,
} from "./batch-concurrency";
import type { Workflow, WorkflowStep } from "./types";

const now = "2026-08-13T00:00:00.000Z";

function workflow(...steps: WorkflowStep[]): Workflow {
  return {
    version: 1,
    id: "test",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    steps,
  };
}

describe("estimateWorkflowPeakPixels", () => {
  it("tracks resize and contain-crop output in workflow order", () => {
    const value = estimateWorkflowPeakPixels(
      { width: 2_000, height: 1_500 },
      workflow(
        {
          id: "resize",
          type: "resize",
          enabled: true,
          config: { mode: "width", width: 5_000, maintainAspectRatio: true },
        },
        {
          id: "crop",
          type: "crop",
          enabled: true,
          config: { aspect: "1:1", fitMode: "contain" },
        },
      ),
    );

    expect(value).toBe(25_000_000);
  });

  it("ignores disabled geometry and fails closed for invalid geometry", () => {
    expect(estimateWorkflowPeakPixels(
      { width: 2_000, height: 1_500 },
      workflow({
        id: "disabled",
        type: "resize",
        enabled: false,
        config: { mode: "width", width: 12_000, maintainAspectRatio: true },
      }),
    )).toBe(3_000_000);

    expect(estimateWorkflowPeakPixels(
      { width: 2_000, height: 1_500 },
      workflow({
        id: "invalid",
        type: "resize",
        enabled: true,
        config: { mode: "percentage", percentage: 0, maintainAspectRatio: true },
      }),
    )).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("calculateBatchConcurrency", () => {
  it("forces one lane when a small source is enlarged toward the 80MP ceiling", () => {
    const resizeWorkflow = workflow({
      id: "resize",
      type: "resize",
      enabled: true,
      config: {
        mode: "dimensions",
        width: 10_000,
        height: 8_000,
        maintainAspectRatio: true,
      },
    });

    expect(calculateBatchConcurrency(
      Array.from({ length: 10 }, () => ({ width: 2_000, height: 1_500 })),
      resizeWorkflow,
      12,
    )).toBe(1);
  });

  it("caps workflows above 20MP at two lanes and small workflows at three", () => {
    const containWorkflow = workflow(
      {
        id: "resize",
        type: "resize",
        enabled: true,
        config: { mode: "width", width: 5_000, maintainAspectRatio: true },
      },
      {
        id: "crop",
        type: "crop",
        enabled: true,
        config: { aspect: "1:1", fitMode: "contain" },
      },
    );
    const sources = Array.from({ length: 10 }, () => ({ width: 2_000, height: 1_500 }));

    expect(calculateBatchConcurrency(sources, containWorkflow, 12)).toBe(2);
    expect(calculateBatchConcurrency(sources, workflow(), 12)).toBe(3);
  });

  it("also respects CPU and item-count limits", () => {
    const smallSources = [
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    ];

    expect(calculateBatchConcurrency(smallSources, workflow(), 2)).toBe(1);
    expect(calculateBatchConcurrency(smallSources.slice(0, 2), workflow(), 12)).toBe(2);
  });
});
