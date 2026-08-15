# 既存ポートフォリオ追加用プロンプト（完成版）

> 2026-08-13、production static exportの完成版を実操作し、Demo 10枚の完走、Crop、キャンセル直後の再実行、Before / After、Template保存、ZIPダウンロード導線、Mobile表示を確認したうえで確定したプロンプトです。

以下を、既存ポートフォリオを編集するCodexへの依頼文としてそのまま使用できます。

---

既存ポートフォリオへ、新規作品「画像一括リサイズ・圧縮ツール」を追加してください。

## 最初に行うこと

既存ポートフォリオの情報設計、作品データの型、カード、詳細ページまたはモーダル、カテゴリーフィルター、画像比率、レスポンシブ仕様を調査してください。既存作品やユーザー変更を保持し、現在のデザインシステムへ自然に統合してください。

次に、完成版がある`image-batch-resizer-compressor/`を確認してください。根拠資料は次のとおりです。

- 実装と起動方法: `image-batch-resizer-compressor/README.md`
- 掲載原稿: `image-batch-resizer-compressor/docs/PORTFOLIO.md`
- 実測・未実施範囲: `image-batch-resizer-compressor/docs/QA_REPORT.md`
- 専用SVG: `image-batch-resizer-compressor/docs/portfolio-assets/image-batch-resizer-compressor.svg`
- Screenshot台帳とalt: `image-batch-resizer-compressor/docs/screenshots/README.md`

資料だけで機能を推測せず、可能なら`npm run verify`とproduction buildを実行し、主要導線も再確認してください。確認できない項目は新たに断定しないでください。

## 掲載情報

- 作品名: 画像一括リサイズ・圧縮ツール
- カテゴリ: 業務効率化ツール
- サブカテゴリ: 画像処理・一括変換
- 概要: 大量画像のResize、Crop、Format変換、Compress、Metadata処理、Rename、ZIPを再利用可能なBatch Workflowとして保存・一括実行できるローカルファーストWebツール
- 主な価値: 大量画像 → 加工Workflow → Template → Batch Processing → サイズ削減確認 → 一括Downloadまでを自動化
- 想定利用者: EC運営、Web制作、ブログ・編集、SNS運用
- プライバシー: 画像処理はブラウザ内で実行してサーバーへ送信しない。EXIF / XMP / IPTC / 位置情報（GPS）/ 色プロファイルは常に削除する。Canvas再エンコード後に元の色プロファイルを安全に保持できると保証できないため、保持／削除の選択式にはしない
- 技術: Next.js 16.3、React 19、TypeScript、Canvas / ImageBitmap / OffscreenCanvas、Web Worker、AbortSignal、ブラウザ内ZIP、localStorage、Vitest

## 確認済み成果

同梱Demoの架空商品画像10枚を、Long side 1600px → Crop Original / Cover → WebP → Quality 80% → Metadata除去 → Rename → ZIPの同一処理経路で実行しました。

- Original total: 36.2 MB
- Optimized: 172 KB
- Saved: 99.5%
- Progress: 10 / 10
- キャンセル: 3 / 10・27%で停止後、直ちに再実行して完走
- Crop: 2200 × 2200 / 3.32 MB → 1600 × 900 / 12.4 KB（16:9 Cover）
- Test: 12 files / 85 tests

この圧縮率はDemoデータと検証ブラウザでの実測であり、任意画像の保証値として書かないでください。

## 使用する画像

Heroは`01-gallery-workflow.png`を第一候補にしてください。詳細表示では既存ページの密度に合わせ、次の確定画像から選んでください。存在しない画像や未実装画面を生成・合成しないでください。

1. `docs/screenshots/01-gallery-workflow.png` — Gallery + 7工程Workflow
2. `docs/screenshots/02-before-after.png` — Before / After + Zoom
3. `docs/screenshots/03-resize.png` — Resize設定
4. `docs/screenshots/04-compression-results.png` — 36.2 MB → 172 KB、99.5%
5. `docs/screenshots/05-batch-processing.png` — 3 / 10、27%、キャンセル
6. `docs/screenshots/06-template.png` — 組み込み3件 + 保存Template
7. `docs/screenshots/07-mobile.png` — 390 × 844px

altは`docs/screenshots/README.md`の確定文を使用してください。SVGはカードのロゴまたは技術アイコンとして利用できますが、既存ポートフォリオのアイコン規則を優先してください。

## 掲載文案

「画像一括リサイズ・圧縮ツール」は、ECやWeb制作で繰り返す画像加工を、再利用可能なBatch Workflowへ変える業務効率化ツールです。大量画像をGalleryで確認し、Resize、Crop、Format変換、Compress、Metadata処理、Renameを順番に組み立てて一括実行。Before / Afterと合計削減量を確認し、結果をZIPでまとめて取得できます。処理はブラウザ内で完結し、画像をサーバーへ送信しません。

実績表現の例:

「同梱Demo 10枚を36.2 MBから172 KBへ削減。99.5%はDemoデータと検証環境での実測値です。」

## 表現上の必須条件

1. 「単なる画像圧縮サイト」ではなく、WorkflowとTemplateを持つ業務効率化ツールとして説明する。
2. AVIF対応を全ブラウザ共通と断定せず、「実行環境のdecode / encode能力を起動時に検出」と書く。
3. SNS等のPreset寸法を恒久仕様として断定せず、用途別の編集可能な目標値として扱う。
4. Metadataを「保持できる」と書かない。EXIF / XMP / IPTC / 位置情報（GPS）/ 色プロファイルを常時削除するprivacy-first仕様と説明する。保持も検討したが、Canvas再エンコード後の安全な保持を保証できないため削除のみを採用した理由も明記する。
5. 公開URL、GitHub URL、利用者数、処理速度は確認できる値がないため、推測やダミーURLを追加しない。
6. 圧縮率は「Demo実測」と併記し、一般的な効果保証に見せない。
7. Local-first、キャンセル、端末負荷に応じた並列数、Object URL等の解放を技術的な工夫として簡潔に見せる。

## 実装要件

1. 既存の作品一覧へカードを追加し、カテゴリーフィルターへ正しく紐付ける。
2. 既存デザインシステムに合わせた詳細ページまたは詳細モーダルを追加する。
3. Desktop / Mobileで画像の切れ、比率崩れ、横スクロールがないことを確認する。
4. 画像を適切に最適化しつつ、UI内の細かな文字が読める解像度を保つ。
5. キーボード操作、visible focus、意味のあるaltを既存品質基準へ合わせる。
6. 既存作品やユーザー変更を壊さず、変更範囲を最小化する。
7. lint、typecheck、test、buildを実行し、作品一覧 → 詳細 → 戻る導線と画像切れを実ブラウザで確認する。

作業完了後、変更ファイル、追加した導線、使用したスクリーンショット、検証コマンドの結果、実ブラウザで確認した内容、未解決事項を報告してください。

---

## このプロンプトの確定根拠

- [x] 完成版をproduction static exportで実操作
- [x] QA Reportを実測値と未実施範囲へ更新
- [x] スクリーンショット7種を撮影・PNG実体確認
- [x] 掲載文の機能・数値を完成版と照合
- [x] 専用SVG、作品分類、metadata方針を照合
- [x] 既存ポートフォリオの場所を推測せず、受け側で構造調査する指示にした
