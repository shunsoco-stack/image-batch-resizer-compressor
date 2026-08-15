# ポートフォリオ掲載情報

## 基本情報

- 作品名: 画像一括リサイズ・圧縮ツール
- カテゴリ: 業務効率化ツール
- サブカテゴリ: 画像処理・一括変換
- 一言説明: 大量画像の加工工程をWorkflow化し、ブラウザ内で一括実行・比較・ZIP出力できるローカルファーストツール
- 公開URL: <https://image-batch-resizer-kj.web.app/>
- GitHub URL: <https://github.com/shunsoco-stack/image-batch-resizer-compressor>

## 課題

EC、Web制作、ブログ、SNS運営では、同じ画像にリサイズ、圧縮、形式変換、命名を繰り返し適用します。画像ごとの手作業は、処理漏れ、命名揺れ、過剰なファイルサイズ、公開前の位置情報残存を招きやすく、枚数が増えるほど確認コストも膨らみます。

## 解決策

Galleryで原本を把握しながら、Resize、Crop、Format、Compress、Metadata、Rename、ZIPをBatch Workflowとして組み立てます。WorkflowはTemplateとして保存でき、同じ納品仕様を次回以降も再現可能です。処理後はBefore / Afterと合計ファイルサイズを確認し、問題がなければZIPでまとめて取得します。

## 中核となる価値

1. 大量画像を個別に加工する操作を、再利用可能なWorkflowへ変換
2. 原本・変換後・削減率を同じ画面で比較し、品質と容量の判断を支援
3. 画像を外部へ送らないローカルファースト設計で、機密性と待ち時間に配慮
4. Web Worker、端末負荷に応じた並列制御、キャンセルで、大量処理中も操作権を維持
5. EXIF / XMP / IPTC / 位置情報（GPS）/ 色プロファイルを常に削除し、意図しない情報公開と不正確な色管理情報の再付与を予防

## 想定利用者

- 商品画像を定型仕様へ揃えるEC運営担当者
- 複数ページ向けアセットを納品するWeb制作者
- 記事画像の容量と命名を統一する編集・ブログ運営者
- 投稿比率や容量をまとめて調整するSNS運用担当者

## 代表シナリオ

```text
10枚の商品画像を追加
  → 長辺1600pxへResize
  → Original比率 / CoverでCrop
  → WebPへFormat変換
  → 品質80%でCompress
  → EXIF等を削除
  → product_{number}_{width}x{height}へRename
  → Before / Afterと削減率を確認
  → ZIP Download
```

## 完成版の実測

- Dataset: ブラウザ内で生成した架空の商品画像10枚
- Original total: **36.2 MB**
- Optimized: **172 KB**
- Saved: **99.5%**
- Progress: 10 / 10
- キャンセル: 3 / 10・27%で停止し、その直後の再実行も完走
- Crop検証: 2200 × 2200 → 1600 × 900（16:9 Cover）
- Test: 12 files / 85 tests

圧縮値は同梱Demoと検証ブラウザでの実測です。画像内容、形式、品質設定、ブラウザのencoderにより変化するため、一般的な削減保証値としては扱いません。

## 設計上の工夫

- Photos / Finderを想起させる広いGalleryと右側Inspectorで、対象と手順を同時に把握
- 各工程を番号・要約・editorで表し、処理の順番を視覚化
- 外部サービス用Presetは恒久仕様として断定せず、用途・比率・寸法を確認・変更可能
- Stretchは通常の選択肢から外し、Cover / Containを中心にした歪みにくい設計
- 透明画像からJPEGへの変換では背景色を明示的な設定として表示
- AVIFはブラウザ名で決め打ちせず、実行時のdecode / encode能力を検出
- Metadataはprivacy-firstの単一方針とし、EXIF / XMP / IPTC / 位置情報（GPS）/ 色プロファイルを常時削除。Canvas再エンコード後に元の色プロファイルを安全に保持できると保証できないため、保持／削除の選択UIは提供しない
- Object URL、ImageBitmap、Canvas、Worker、ZIP中間データの寿命を明示的に管理
- source / output画素上限とdecode前header検査で、巨大画像によるtab停止を抑制
- DesktopはGallery + sticky Workflow、Mobileは2列Gallery + full-height Workflow sheet + 下部CTA
- system font、抑えたdepth、material、pressed feedback、reduced motion / transparency / contrast対応でApple Designの原則をWebへ適用

## 技術要素

- Next.js 16.3 / React 19 / TypeScript
- App Router + Static Export
- Canvas / ImageBitmap / OffscreenCanvas
- Web Worker pool / AbortSignal / cancelable job queue
- browser capability probe
- chunked CRC32 / low-copy in-browser ZIP
- localStorageによるversioned Workflow Template保存
- Vitest / jsdom / Testing Library

## 検証と制約

- Firebase Hosting公開URLを実ブラウザで操作し、Demo 10枚、Crop、キャンセル直後の再実行、Before / After、Template、ZIPダウンロード導線、Mobileを確認済み
- 公開URLでHTTP 200、参照asset 10件、CSPと各種security header、console errorなしを確認済み
- 7枚の掲載用スクリーンショットは実画面から取得済み
- AVIFは検証ブラウザでは利用可表示。全ブラウザ共通の対応とは表現しない
- EXIF等の除去はfixtureの出力バイナリで検証
- Edge / Safari実機、100枚Soak、200% Zoom、全形式変換の手動マトリクスは追加検証項目

詳細は[`QA_REPORT.md`](QA_REPORT.md)、画像一覧は[`screenshots/README.md`](screenshots/README.md)を参照してください。
