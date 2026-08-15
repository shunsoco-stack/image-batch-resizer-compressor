# QA Report

> 最終更新: 2026-08-13
> 対象: production static export（`out/`）
> 判定基準: 「実ブラウザ」は完成版を操作、「自動」はVitest / jsdom /純粋ロジック、「実装確認」はコードとUIの契約確認、「未実施」は今後の実機・負荷検証です。

## 結論

- ポートフォリオ掲載用デモとして **合格**。Critical / Highの既知不具合はありません。
- Demo 10枚を実ブラウザで完走し、**36.2 MB → 172 KB、99.5%削減**を確認しました。この値は同梱Demoデータと検証ブラウザでの実測であり、任意画像の保証値ではありません。
- キャンセル直後の再実行、16:9 Cover Crop、Before / After、Zoom、Template保存、ZIP Blob生成、390 × 844px表示を実操作で確認しました。
- クロスブラウザ実機マトリクス、100枚Soak、OS保存先まで含むDownloadイベントは掲載後の追加検証項目です。

## 自動検証

| 項目 | コマンド | 状態 | 証跡 / 備考 |
| --- | --- | --- | --- |
| Lint | `npm run lint` | 合格 | エラー・警告なし |
| TypeScript | `npm run typecheck` | 合格 | strict typecheck完了 |
| Unit / Integration | `npm run test` | 合格 | 12 files / 85 tests |
| Static export | `npm run build` | 合格 | Next.js 16.3、`out/`生成、`/`・`/_not-found`・icon・manifestを出力 |
| 一括検証 | `npm run verify` | 合格 | lint → typecheck → test → buildを連続実行 |

## 実ブラウザ受入結果

| シナリオ | 結果 |
| --- | --- |
| Demo投入 | 架空の商品画像10枚、合計36.2 MBをGalleryへ表示 |
| 既定Workflow | Long side 1600px → Crop Original / Cover → WebP → Quality 80% → Metadata除去 → Rename → ZIP |
| Batch完走 | 10 / 10。Optimized 172 KB、Saved 99.5% |
| 出力 | `product_01_1600x1600.webp`〜`product_10_1600x1600.webp`相当を入力比率に応じた寸法で順序どおり生成 |
| Crop | 1枚を16:9 Coverで処理し、2200 × 2200 / 3.32 MB → 1600 × 900 / 12.4 KBを確認 |
| キャンセル | 3 / 10・27%で停止し、進捗・結果を初期化。その直後の再実行も10 / 10で完走 |
| Template | `EC納品・長辺1600`を保存し、組み込み3件と合わせて4件表示 |
| Before / After | 左右比較、寸法・形式・容量、Zoom 100% → 125% → 100%を確認 |
| ZIP | `ec-product-images.zip`のBlob URLとdownload属性を確認。ZIPバイナリ構造・CRC・Unicode名は自動テストで検証 |
| Mobile | 390 × 844pxで2列Gallery、Workflow sheet、下部CTAを確認。横スクロールなし |
| Console | production画面でwarning / errorなし |

## 機能テスト

| ID | 領域 | 状態 | 証跡 / 備考 |
| --- | --- | --- | --- |
| F-01 | JPEG / PNG / WebP複数入力・Drag & Drop | 合格（自動） | 複数`File`投入とGallery反映をUIテスト。Dropzone / file pickerは同じ登録経路 |
| F-02 | AVIF能力検出 | 合格（実ブラウザ＋自動） | 現検証環境はdecode / encodeとも利用可表示。実ファイルdecodeを最終判定とし、ブラウザ差を固定しない |
| F-03 | Gallery情報 | 合格（実ブラウザ） | Thumbnail / Filename / Dimensions / Size / Format / statusを10枚で確認 |
| F-04 | Resize各モード | 合格（自動＋UI） | Width / Height / Dimensions / Percentage / Long side / Short sideの幾何を検証 |
| F-05 | Aspect Ratio | 合格（自動） | 横長・縦長・正方形、丸め、upscale抑止を検証 |
| F-06 | Preset | 合格（実ブラウザ） | 汎用用途名と編集可能な値、外部仕様が変わり得る注意書きを確認 |
| F-07 | Compression | 合格（実ブラウザ） | 36.2 MB → 172 KB、99.5%。処理中は誤解を避けて「計測中」と表示 |
| F-08 | JPEG / PNG / WebP変換 | 部分確認 | PNG → WebPを実ブラウザで確認。各形式の選択・encode経路は実装確認済み。全方向の実画像マトリクスは未実施 |
| F-09 | AVIF書き出し | 合格（能力検出） | 現ブラウザで選択可。AVIF実ファイル出力の手動確認は未実施 |
| F-10 | Crop | 合格（実ブラウザ＋自動） | 16:9 Coverを実処理。Original / 1:1 / 4:3 / 16:9 / Custom幾何を自動検証 |
| F-11 | Fit Mode | 合格（自動＋UI） | Cover / Containを検証。Stretchは通常UIから除外し、engineでも拒否 |
| F-12 | 透明→JPEG背景 | 合格（engine境界自動＋実装確認） | 設定色でのfillとJPEG encodeを検証。実ブラウザの画素値比較は未実施 |
| F-13 | Rename | 合格（実ブラウザ＋自動） | 10件を連番出力。token、padding、Unicode、禁止文字、重複回避、path traversalを検証 |
| F-14 | Workflow順序 | 合格（実ブラウザ） | 7工程を同一処理経路で完走 |
| F-15 | Template | 合格（実ブラウザ＋自動） | 保存・読込・削除・不正localStorage復旧を検証 |
| F-16 | Before / After | 合格（実ブラウザ＋自動） | Divider、ラベル、Zoomを実確認。Galleryカードから選んだ画像を比較対象にする動作を自動検証 |
| F-17 | Total比較 | 合格（実ブラウザ＋実装確認） | Original / Optimized / Savedと個別結果の表示を確認 |
| F-18 | Metadata | 合格（バイナリ自動検証＋UI） | EXIF / XMP / IPTC / 位置情報（GPS）/ 色プロファイルを常時削除。Canvas再エンコード後の安全な保持を保証できないため削除のみを採用し、保持を選べるUIは表示しない |
| F-19 | Batch / parallel | 合格（実ブラウザ＋自動） | 3 / 10等の単調進捗を確認。Worker poolは1〜4、Batch投入は画素数に応じ最大3 |
| F-20 | キャンセル | 合格（実ブラウザ＋自動） | 中盤キャンセル、queue破棄、Worker終了、late event無視、即時再実行を確認 |
| F-21 | ZIP | 合格（自動＋実ブラウザ） | CRC32、UTF-8、重複名、Zip Slip防止、低コピー生成、abort / progressを検証。OS保存完了イベントは未取得 |
| F-22 | Demo | 合格（実ブラウザ） | 10 images → Resize → Crop → WebP → Compress → Metadata → Rename → ZIPダウンロード導線まで完走 |

## 異常系

| ID | ケース | 状態 | 証跡 / 備考 |
| --- | --- | --- | --- |
| E-01 | 壊れた画像 | 合格（実装確認） | decode失敗をファイル単位の`corrupt-image`として隔離。実ファイルの手動投入は未実施 |
| E-02 | 非対応形式 | 合格（UI・実装確認） | MIME / signatureと能力を検査し、対応形式を案内 |
| E-03 | 巨大画像 | 合格（自動） | JPEG / PNG / WebP / AVIFのheader寸法をdecode前に検査。source / output 80MP、辺32767pxの上限 |
| E-04 | Memory不足 | 合格（自動） | OOM分類と回復メッセージを検証。実端末を故意にOOMにはしていない |
| E-05 | Conversion失敗 | 合格（実装確認） | 他Jobを継続し、対象カードへエラー表示。混在実ファイルBatchの手動確認は未実施 |
| E-06 | ZIP失敗 / cancel | 合格（自動） | AbortSignal、chunk進捗、失敗時に個別結果を保持する経路を確認 |

## Performance / Memory

| 項目 | 状態 | 結果 |
| --- | --- | --- |
| 10枚実処理のUI応答性 | 合格（実ブラウザ） | 進捗中にキャンセルへ到達でき、UIは応答 |
| 100枚Soak | 未実施 | ポートフォリオ公開後の追加負荷試験 |
| 並列上限 | 合格（自動＋実装確認） | Worker poolはdevice memoryとhardware concurrencyから1〜4。Batchは最大3、40MP超は1、20MP超は最大2 |
| Object URL | 合格（自動＋実装確認） | unmount時の`revokeObjectURL`をspy検証。削除・clear・再処理時の解放経路はコード確認 |
| Bitmap / Canvas | 合格（実装確認） | `ImageBitmap.close()`、surface解放、Worker OffscreenCanvasを1 × 1へ縮小 |
| ZIPメモリ | 合格（自動） | 1 MiB単位CRC、元Blobを直接partsへ利用、8 MiB / 16 entryごとにyield |
| Heapの連続計測 | 未実施 | 3回連続BatchのブラウザHeapプロファイルは未取得 |

## Accessibility / Responsive

| 項目 | 状態 | 証跡 / 備考 |
| --- | --- | --- |
| Landmark / label / progressbar / error | 合格（自動＋実装確認） | Gallery region、入力label、progressbar、status文言を検証 |
| Visible focus / Tab順 | 合格（実装確認） | `:focus-visible`とDOM順を確認。全導線の手動キーボード走査は未実施 |
| 色だけに依存しない状態 | 合格（実ブラウザ） | 処理中・待機・完了・errorを文言とアイコンでも表示 |
| Reduced motion / transparency / contrast | 合格（実装確認） | media queryとmotion抑制を実装 |
| 200% Zoom | 未実施 | ブラウザ拡大の手動確認は今後実施 |
| 390 × 844px | 合格（実ブラウザ） | `clientWidth = scrollWidth = 390`、横スクロールなし |

## 実機マトリクス

| 環境 | 状態 | JPEG / PNG / WebP | AVIF decode | AVIF encode | 備考 |
| --- | --- | --- | --- | --- | --- |
| Codex in-app Browser / Windows | 合格 | 利用可 | 利用可表示 | 利用可表示 | production static export。正確なengine版は取得不可 |
| Edge / Windows | 未実施 | — | — | — | ブラウザ固有差を追加確認する |
| Safari / iOS | 未実施 | — | — | — | AVIF / Worker / Download挙動を追加確認する |
| Safari / macOS | 未実施 | — | — | — | AVIF / Worker / Download挙動を追加確認する |

## 公開判定

- 判定: **ポートフォリオ掲載用デモとして合格**
- 既知のCritical / High: なし
- 掲載時の注意: 実測圧縮率はDemo環境の結果として明記し、任意画像や全ブラウザの保証値にしない。AVIFは必ず「実行環境により異なる」と説明する。
- 追加推奨: Edge / Safari実機、100枚Soak、alpha PNG → JPEGの画素比較、全形式変換マトリクス、200% Zoom、OS download完了の確認
