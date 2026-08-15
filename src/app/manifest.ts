import type { MetadataRoute } from "next";

// Next.js 16 static exports require special Route Handlers to opt into static output.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "画像一括リサイズ・圧縮ツール",
    short_name: "画像一括変換",
    description:
      "大量画像の加工Workflowをブラウザ内でまとめて実行する業務効率化ツール",
    lang: "ja",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F5F5F7",
    theme_color: "#F5F5F7",
    categories: ["business", "productivity", "utilities"],
    icons: [
      {
        src: "/icons/image-batch-resizer-compressor.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
