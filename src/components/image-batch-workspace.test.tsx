import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageBatchWorkspace } from "./image-batch-workspace";

const mocks = vi.hoisted(() => ({
  cancelAll: vi.fn(),
  closeBitmap: vi.fn(),
  createDemoFiles: vi.fn(),
  createObjectURL: vi.fn(),
  createStoredZip: vi.fn(),
  probeImageCapabilities: vi.fn(),
  process: vi.fn(),
  revokeObjectURL: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("@/lib/demo-images", () => ({
  createDemoFiles: mocks.createDemoFiles,
}));

vi.mock("@/lib/capabilities", () => ({
  probeImageCapabilities: mocks.probeImageCapabilities,
}));

vi.mock("@/lib/worker-client", () => ({
  ImageWorkerClient: class MockImageWorkerClient {
    process = mocks.process;
    cancelAll = mocks.cancelAll;
    terminate = mocks.terminate;
  },
}));

vi.mock("@/lib/zip", () => ({
  createStoredZip: mocks.createStoredZip,
}));

function makeDemoFiles() {
  return Array.from({ length: 10 }, (_, index) => new File(
    [new Uint8Array(4_096 + index)],
    `demo-product-${String(index + 1).padStart(2, "0")}.png`,
    { type: "image/png", lastModified: index },
  ));
}

describe("ImageBatchWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    let objectUrlSequence = 0;

    mocks.cancelAll.mockReset();
    mocks.closeBitmap.mockReset();
    mocks.createDemoFiles.mockReset();
    mocks.createObjectURL.mockReset();
    mocks.createStoredZip.mockReset();
    mocks.probeImageCapabilities.mockReset();
    mocks.process.mockReset();
    mocks.revokeObjectURL.mockReset();
    mocks.terminate.mockReset();

    mocks.createDemoFiles.mockResolvedValue(makeDemoFiles());
    mocks.createObjectURL.mockImplementation(() => `blob:test-${objectUrlSequence += 1}`);
    mocks.createStoredZip.mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
    mocks.probeImageCapabilities.mockResolvedValue({
      jpeg: { decode: true, encode: true },
      png: { decode: true, encode: true },
      webp: { decode: true, encode: true },
      avif: { decode: true, encode: true },
    });

    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => ({
        width: 1_600,
        height: 1_200,
        close: mocks.closeBitmap,
      } as unknown as ImageBitmap)),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: mocks.revokeObjectURL,
    });
  });

  it("初期GalleryとBatch Workflowを主要なアクセシブルroleで公開する", async () => {
    render(<ImageBatchWorkspace />);

    expect(screen.getByRole("heading", { level: 1, name: "画像一括リサイズ・圧縮ツール" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("region", { name: "画像Gallery" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Batch Workflow" })).toBeInTheDocument();

    const viewTabs = screen.getByRole("tablist", { name: "表示を切り替え" });
    expect(within(viewTabs).getAllByRole("tab")).toHaveLength(4);
    expect(within(viewTabs).getByRole("tab", { name: "Gallery" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "大量画像を、ひとつのWorkflowへ。" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /^Resize/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^Compress/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rename/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("button", { name: "一括実行" })).toBeDisabled();

    await waitFor(() => expect(mocks.probeImageCapabilities).toHaveBeenCalledOnce());
  });

  it("Demo 10枚を検査してGalleryへ投入する", async () => {
    const user = userEvent.setup();
    render(<ImageBatchWorkspace />);

    await user.click(screen.getByRole("button", { name: "Demo 10枚" }));

    expect(await screen.findByText("10 / 10 選択")).toBeInTheDocument();
    const gallery = screen.getByRole("region", { name: "画像Gallery" });
    expect(within(gallery).getAllByRole("article")).toHaveLength(10);
    expect(within(gallery).getByRole("checkbox", { name: "demo-product-01.pngを選択" })).toBeChecked();
    expect(within(gallery).getByRole("img", { name: "demo-product-10.pngのサムネイル" })).toHaveAttribute("src", "blob:test-10");
    expect(screen.getByText("架空の商品画像10枚とEC Workflowを読み込みました。")).toBeInTheDocument();
    expect(mocks.createDemoFiles).toHaveBeenCalledOnce();
    expect(mocks.closeBitmap).toHaveBeenCalledTimes(10);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(10);
  });

  it("JPEG・PNG・WebPの複数ファイルをDropして同じGalleryへ登録する", async () => {
    render(<ImageBatchWorkspace />);
    const dropZone = screen
      .getByRole("heading", { level: 2, name: "大量画像を、ひとつのWorkflowへ。" })
      .closest(".drop-zone");
    expect(dropZone).not.toBeNull();

    const files = [
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "photo.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "alpha.png", { type: "image/png" }),
      new File([new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])], "card.webp", { type: "image/webp" }),
    ];
    fireEvent.drop(dropZone as HTMLElement, { dataTransfer: { files } });

    expect(await screen.findByText("3 / 3 選択")).toBeInTheDocument();
    const gallery = screen.getByRole("region", { name: "画像Gallery" });
    expect(within(gallery).getByText("photo.jpg")).toBeInTheDocument();
    expect(within(gallery).getByText("alpha.png")).toBeInTheDocument();
    expect(within(gallery).getByText("card.webp")).toBeInTheDocument();
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(3);
  });

  it("unmount時にGalleryのObject URLを解放する", async () => {
    const user = userEvent.setup();
    const view = render(<ImageBatchWorkspace />);
    await user.click(screen.getByRole("button", { name: "Demo 10枚" }));
    await screen.findByText("10 / 10 選択");

    view.unmount();

    expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(10);
  });

  it("組み込みWorkflow Templateを一覧表示して適用できる", async () => {
    const user = userEvent.setup();
    render(<ImageBatchWorkspace />);

    await user.click(screen.getByRole("tab", { name: "Template" }));

    expect(screen.getByRole("heading", { level: 2, name: "Workflow Templates" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 3, name: "ブログ画像" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "ポートフォリオ画像" })).toBeInTheDocument();

    const ecCard = screen.getByRole("heading", { level: 3, name: "EC商品画像" }).closest("article");
    expect(ecCard).not.toBeNull();
    await user.click(within(ecCard as HTMLElement).getByRole("button", { name: "Workflowへ適用" }));
    expect(screen.getByRole("tab", { name: "Gallery" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("「EC商品画像」をWorkflowへ適用しました。")).toBeInTheDocument();
  });

  it("Metadataをprivacy-firstで常に削除し、保持を選択できないことを明示する", async () => {
    const user = userEvent.setup();
    render(<ImageBatchWorkspace />);

    await user.click(screen.getByRole("button", { name: /^Metadata/ }));

    expect(screen.getByText("Privacy-firstで常時削除")).toBeInTheDocument();
    expect(screen.getByText(/EXIF・XMP・IPTC・位置情報（GPS）・色プロファイルを常に削除し、出力へ引き継ぎません。/)).toBeInTheDocument();
    expect(screen.getByText(/Canvas再エンコード後に元の色プロファイルを安全に保持できると保証できないため、保持は選択できません。/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安全な色プロファイルのみ試行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "色プロファイルも削除" })).not.toBeInTheDocument();
  });

  it("Galleryカードから選んだ2枚目をBefore / Afterの比較対象にする", async () => {
    const user = userEvent.setup();
    const files = makeDemoFiles().slice(0, 2);
    mocks.createDemoFiles.mockResolvedValue(files);
    mocks.process.mockImplementation(async (...args: unknown[]) => {
      const file = args[0] as File;
      const index = args[2] as number;
      const blob = new Blob([new Uint8Array(1_000 + index)], { type: "image/webp" });
      return {
        assetId: `worker-${index}`,
        blob,
        name: `product-${index + 1}.webp`,
        mime: "image/webp",
        width: index === 0 ? 801 : 902,
        height: index === 0 ? 601 : 602,
        size: blob.size,
        originalSize: file.size,
        metadataPreserved: false,
      };
    });

    render(<ImageBatchWorkspace />);
    await user.click(screen.getByRole("button", { name: "Demo 10枚" }));
    await screen.findByText("2 / 2 選択");
    await user.click(screen.getByRole("button", { name: "一括処理を実行" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Compression Results" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Gallery" }));
    const cards = within(screen.getByRole("region", { name: "画像Gallery" })).getAllByRole("article");
    await user.click(within(cards[1] as HTMLElement).getByRole("button", { name: "比較" }));

    expect(screen.getByRole("heading", { level: 2, name: "Before / After" })).toBeInTheDocument();
    expect(screen.getByText("→ 902 × 602")).toBeInTheDocument();
  });

  it("一括処理を開始し、進行中のWorkerをキャンセルできる", async () => {
    const user = userEvent.setup();
    render(<ImageBatchWorkspace />);
    await user.click(screen.getByRole("button", { name: "Demo 10枚" }));
    await screen.findByText("10 / 10 選択");

    mocks.process.mockImplementation((...args: unknown[]) => {
      const options = args[3] as { signal: AbortSignal };
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener("abort", abort, { once: true });
      });
    });

    await user.click(screen.getByRole("button", { name: "一括処理を実行" }));

    const cancelButton = await screen.findByRole("button", { name: "キャンセル" });
    expect(mocks.process).toHaveBeenCalled();
    expect(mocks.process.mock.calls[0]?.[0]).toBeInstanceOf(File);
    expect(mocks.process.mock.calls[0]?.[2]).toBe(0);
    expect(cancelButton).toBeEnabled();

    await user.click(cancelButton);

    expect(mocks.cancelAll).toHaveBeenCalledOnce();
    expect(await screen.findByText("一括処理をキャンセルしました。完了済みの結果は破棄しました。")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "キャンセル" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "一括実行" })).toBeEnabled();
  });
});
