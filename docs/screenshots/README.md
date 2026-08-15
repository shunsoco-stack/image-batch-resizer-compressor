# ポートフォリオ用スクリーンショット

> 状態: 2026-08-13にproduction static exportを実操作して撮影・採用しました。すべて架空の商品画像を使った実画面で、数値や処理状態の合成はしていません。

## 採用画像

| No. | ファイル名 | 実寸 | 状態 | 掲載用alt |
| --- | --- | --- | --- | --- |
| 01 | `01-gallery-workflow.png` | 1425 × 990 | 採用 | 架空の商品画像10枚のGalleryと、ResizeからZIPまで7工程のBatch Workflow |
| 02 | `02-before-after.png` | 1440 × 1000 | 採用 | 商品画像のBefore / After比較。2200 × 2200から1600 × 1600、3.32 MBから17.7 KBへの変換とZoom操作 |
| 03 | `03-resize.png` | 1425 × 990 | 採用 | Long side 1600px、アスペクト比維持、用途別Presetを設定したResize工程 |
| 04 | `04-compression-results.png` | 1425 × 990 | 採用 | 10 imagesの処理結果。Original 36.2 MB、Optimized 172 KB、Saved 99.5%と結果一覧 |
| 05 | `05-batch-processing.png` | 1425 × 990 | 採用 | 3 / 10、27%のBatch進捗、処理中・待機中の画像、計測中の容量とキャンセル操作 |
| 06 | `06-template.png` | 1440 × 1000 | 採用 | 3つの組み込みWorkflowと、保存したEC納品・長辺1600 Template |
| 07 | `07-mobile.png` | 390 × 844 | 採用 | Mobileの2列Gallery、Workflow導線、サイズ比較、下部ZIP CTA |

## 撮影データ

- Dataset: アプリがブラウザ内で生成したDemo商品画像10枚
- Workflow: Long side 1600px → Crop Original / Cover → WebP → Quality 80% → Metadata除去 → Rename → ZIP
- Main result: 36.2 MB → 172 KB、99.5%削減
- Crop確認: 2200 × 2200 / 3.32 MB → 1600 × 900 / 12.4 KB（16:9 Cover）
- Desktop: 1440 × 1000px前後
- Mobile: 390 × 844px、横スクロールなし
- Format: 7ファイルすべて実体がPNGであることを画像metadataで確認

## 撮影基準への適合

- [x] 文字が100%表示で読める
- [x] GalleryとWorkflowの主従関係が伝わる
- [x] BeforeとAfterのラベルを取り違えていない
- [x] 圧縮率が同じDemo runの実測値と一致する
- [x] 完了画面にエラーや待機中の残骸がない
- [x] 進捗画面だけは意図的に処理中・待機中を掲載している
- [x] Desktop / Mobileとも横スクロールがない
- [x] 各画像に掲載用alt文を用意した
- [x] OS情報、ローカルパス、通知、拡張機能を含まない
- [x] Demoの架空画像のみで、第三者素材・実顧客データを含まない
- [x] 画面内の件数・容量・寸法・進捗は実処理値
