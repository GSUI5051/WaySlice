# 2変数分析 — 保守ガイド

[English](README.md) | 日本語 | [한국어](README.ko.md)

> **This document is machine-generated and may contain errors or differences in technical terminology.**
> **The English version is the canonical source.**
> **If you find an error, please submit a PR or refer to the English version.**

> このドキュメントは機械生成のため、誤りや専門用語の不整合が含まれる可能性があります。
> 英語版が正規のソースです。
> 誤りを見つけた場合は、PR を提出するか、英語版を参照してください。

このガイドは 2変数分析ダイアログの保守方法を説明します。各モジュールの担当範囲、新しいコードの置き場所、アーキテクチャを保つ規則、変更の検証方法です。

## このディレクトリについて

2変数分析は、プロファイル操作列から開く 2次元密度ヒートマップです（`#btn-dual-variable`。「疊加（オーバーレイ）」ボタンと同じく、ワイド画面ではラベル表示、720 px 以下では `chart-scatter` アイコンに縮小します）。X の物理量と Y の物理量を 1 つずつ選ぶと、フィルタ後のトラックのサンプルが 2次元グリッドにビンニングされ、セルの色が局所的な点密度（最も密度の高いセルを基準に正規化）を表します。標高プロファイルとビジュアル言語は共有しますが、独立したチャートシステムです。仕様（§22）は専用のモジュールディレクトリを求めており、共有の速度パイプライン以外で標高プロファイルへの import を増やすことはできません。

**公開 API は 1 つの関数だけ**です:

```js
import { initDualVariableAnalysis } from './charts/dual-variable-analysis/index.js';
initDualVariableAnalysis({
  button: document.getElementById('btn-dual-variable'),
  dialog: document.getElementById('dual-variable-dialog'),
}); // main.js、起動時に呼び出し
```

DOM 契約: `.profile-controls` 内の `#btn-dual-variable`。`#dual-variable-dialog`（class `sheet dualvar`）の中に `#dualvar-close`、`#dualvar-body`（tooltip の安全領域）、`#dualvar-select-view`（`#dualvar-x`、`#dualvar-y`、`#dualvar-select-note`、`#dualvar-analyze`）、`#dualvar-result-view`（`#dualvar-summary`、`#dualvar-reselect`、`#dualvar-chart` > `#dualvar-canvas`、`#dualvar-empty`、`#dualvar-loading`）。これらの id の名前は変更しないでください。

## モジュール一覧

| ファイル | 担当 | エクスポート |
|---|---|---|
| `index.js` | オーケストレーター: ボタンとダイアログの配線、選択 → 分析 → 結果/空状態のステートマシン、セレクトの動的制約、イベント面（言語 / 単位 / テーマ / トラックストア） | `initDualVariableAnalysis` |
| `metrics.js` | 純粋な指標レジストリ: id、ラベルキー、単位ゲッター、共有フォーマッター、表示↔生値の目盛り変換、有効な組み合わせテーブル | `METRICS`、`getMetric`、`isPairAllowed`、`partnersOf` |
| `samples.js` | 純粋なデータ層: トラックごとに 1 つのフィルタ済みサンプルテーブル（一時停止 → 無効パワー → 無効ケイデンスの 3 段フィルタ）、利用可否、有限値ペアの抽出 | `buildAnalysisSamples`、`metricAvailability`、`extractPair` |
| `densityCalculator.js` | 純粋な密度計算: ロバストな分位数ドメイン、固定グリッドの 2D ビンニング、相対密度の正規化 | `computeDensity`、`relativeDensity`（定数 `X_BINS`、`Y_BINS`、`MIN_PAIR_SAMPLES`、`DOMAIN_QUANTILE`、`DOMAIN_PAD`） |
| `densityRenderer.js` | キャンバス描画のすべて: プロット + 目盛りグリッド + 拡大表示する密度ビットマップ + ホバー強調 + 軸タイトル。テーマ色 LUT。ヒットテストのジオメトリ。軸ごとの可視ウィンドウ（ズーム/パンのビューポート） | `initRenderer`、`setData`、`clearData`、`refresh`、`resize`、`render`、`hitTest`、`setHover`、`viewportAxes`、`getViewport`、`isViewportZoomed`、`resetViewport` |
| `interaction.js` | 統合された Pointer Events 経路（ホバー、タップ/長押し、タッチ読み取りのピン留め）+ **共有**のタッチジェスチャを 'two-finger' パンモードで（1 本の指は読み取り、2 本の指はピンチとパン、ダブルタップで復帰 —— `../viewport-gestures.js` から）。描画はしない | `wireInteraction`、`clearInteraction` |
| `tooltip.js` | tooltip の DOM ノード、3 行の内容（X / Y / 相対密度）、タッチとマウスの 2 種類の配置ロジック（純粋関数 `computeTooltipPlacement`） | `initTooltip`、`computeTooltipPlacement`、`showTooltipAt`、`hideTooltip` |

依存関係（矢印 = import。循環を保たないこと）:

```text
index        → metrics, samples, densityCalculator, densityRenderer, interaction, tooltip
interaction  → densityRenderer (hitTest, setHover, viewport), tooltip, ../viewport-gestures
densityRenderer → language (axis titles)
tooltip      → language, format
metrics      → units, format
samples      → elevation-profile/profile-data (buildCaches, speedToPace), sectorMetrics (createPauseTracker)
densityCalculator → nothing in this directory
```

`metrics.js`、`samples.js`、`densityCalculator.js` はテスト可能な最下層です。DOM もダイアログも扱いません。`samples.js` だけが標高プロファイル（共有の速度パイプライン）からの import を許されます。レンダラー層とインタラクション層は許されません。

## データルール（安易に緩めないこと）

仕様が固定しているモジュールの契約です。すべてトラック全体に適用され（現在のセクターではなく）、この順で実行されます:

1. **一時停止フィルタ** — タイムスタンプが確定済みの一時停止区間に入る点は捨てられます（最後の移動時刻は含まず、停止の終了時刻は含む。`pauseFreeSamples` と同じ判定）。区間は共有の `createPauseTracker` から取得し、モジュール固有の検出器は使いません。
2. **無効パワー** — パワーメーター付きのトラックでは、移動中の点（クリーニング後の速度 > 0）に正の有限パワー読み取り値がないと捨てられます。メーターのないトラックではこのルールをスキップします。
3. **無効ケイデンス** — ケイデンスセンサーに対して同じルールを適用します。
4. **欠損値** — X または Y が非有限値のペアはビンニングに入りません（0 埋め、前値のコピー、補間は一切しません）。

速度 / ペース / GAP は `buildCaches`（標高プロファイルの共有パイプライン。記録値 → dd/dt クロスチェック → 5 点ウィンドウ。計算値 → 3σ）から来ます。勾配は生のセグメントごとの昇降比です。仕様の初版は、ルール 1〜3 以外の外れ値除去を意図的に追加していません。

描画ドメインは 0.2%〜99.8% の分位数範囲に約 4% のパディングを加えたものです。まれなセンサーのスパイクがデータ本体を圧縮することはありません（§21）。ドメインの外の点はサンプルテーブルに残り、描画グリッドの外に出るだけです。有効なペアが `MIN_PAIR_SAMPLES` 未満 → 空状態を表示し、空白のキャンバスは描きません（§19）。

密度は `binCount / maxBinCount` です（§14）。tooltip はこの線形値を報告します。ビットマップは中程度の密度を見えるようにするため、見た目だけの平方根ガンマをかけます。両者を「一致させて」はいけません。

## 描画の規約

- 密度グリッドは小さなオフスクリーンビットマップ（bin ごとに 1 ピクセル）に置かれ、画像スムージングで引き伸ばされます。点ごとの描画も、セルごとの DOM も行いません。
- 色は 256 項の LUT から来ます。テーマトークン `--density-zero` / `--density-max`（tokens.css、テーマごとに 1 ペア）の 2 度止めグラデーションをサンプリングしたものです。テーマ切替は LUT の再構築 + 再描画であり、カウントは再計算しません。
- 目盛りは指標の表示空間における 1/2/5 × 10ᵏ のきれいな数です（toDisplay/fromDisplay は `metrics.js` の担当）。ラベルは共有フォーマッターを通すため、軸の読み取りが UI の他の部分と食い違うことはありません。軸タイトルは `t(labelKey) + 単位` です。単位が tooltip 専用の知識になることはありません。
- **ペース族の軸は両方向で逆向きに読みます**（`pace`/`gap` に `reversed: true`）。ペースの値が小さいほど速いので、縦軸では速い側が上（5:00 /km が 15:00 /km の上）、横軸では速い側が右になります。マッピングのすべて —— グリッド線、目盛りラベル、ビットマップの行と列（`rebuildBitmap`）、ホバー枠（`render`）、ヒットテスト（`hitTest`）—— が同じ反転判定を通る必要があります。軸を直接マップする新しい描画経路は、tooltip と静かに食い違います。
- **デスクトップのダイアログ高さは `.sheet` の共通上限に固定**（`min(76vh, 720px)`、components.css、≥721px のみ）: 区切りリストと 2変数分析ダイアログは、どのトラックでも同じ高さになります。そうしないと両者とも内容に合わせて伸縮し、セグメント数で揺れます。チャートはサマリー行の下の空間を flex で埋めます（clamp 高さを上書き）。チャートの ResizeObserver がサイズ変化後に再描画します。「すべての指標」パネル（同じ `#sheet` 要素、`.seg-list` なし）とすべての狭い画面のボトムシートは内容に合わせたサイズのままです。
- 左マージンは最も幅の広い y 目盛りラベルに合わせて伸びます。キャンバスの端で切れる x 目盛りラベルは、グリッド線からずらすのではなく捨てられます。

## インタラクションの契約

Pointer Events の経路は 1 本です（§16）。細いポインターはホバー。タッチはタップまたは長押しで、読み取りは指が離れた位置にピン留めされます（読み取りにダブルタップは不要です）。プロット領域はデータ座標の解決だけを担当します（`hitTest` が client→データ変換の唯一の窓口で、強調表示と tooltip が食い違うことはありません）。tooltip の配置は別の関心事です（`tooltip.js` の `computeTooltipPlacement`。純粋関数でユニットテスト付き）。タッチは「タッチ点の真上」戦略を取ります —— 真上 8–12 px の間隔、水平方向はタッチ点に揃え、境界は**画面全体**だけです（ボックスはチャートカードやダイアログ本体の外に出られます。タッチ点が高い場合は画面上端にクランプ）—— 下への反転も横の探索も行わず、プロット領域の端は一切関与しません。マウスは 上 → 下 → 横 → クランプ の階段（間隔 14 px）をダイアログ本体の中で保ちます（モーダル層とビューポートを避け、ポインターの上・下・左・右のどこにでも出られます）。コンテナのスクロールやウィンドウのリサイズでは、古い位置に漂わせる代わりにボックスを隠します。

チャートの**ビューポート**は共有のジェスチャマシン（`js/charts/viewport-gestures.js`）が駆動します。どのジェスチャがパンを担うかは**ホスト**が選び（`panGesture`）、このチャートは `two-finger` モードです: 1 本の指は読み取り専用（tooltip が指を追い、ウィンドウは動きません）、2 本の指はスケールと平行移動を同時に行うため、指の間隔を保った 2 本指のドラッグは純粋なパンになります。標高プロファイルは `one-finger` のままです（そこでは 1 本の指がビューポート操作で、範囲選択には専用のハンドルがあります）。素早く 2 回タップするとデータ全体の範囲に戻ります。軸ごとに生の単位のウィンドウを持ち、`null` は「全ドメイン」を意味するので、復帰は常に現在のデータへの自動フィットです。ペース軸は自身の向きを保ちます。ジェスチャが動かすのはウィンドウだけで、X/Y の選択・サンプルテーブル・密度グリッドには触れず、どのズームレベルでも再ビンニングは起きません（ウィンドウは同じビットマップの部分矩形です）。パンやピンチはピン留めした読み取りを破棄します（別のデータを指す画面位置に残さないため）。指が動かなければタップのままです。ズームの下限は各軸ドメインの 5 % です。

## イベント

`index.js` が購読するもの: `language:changed`（開いているビューの再描画）、`units:changed`（目盛りの再描画）、`theme:changed`（LUT 再構築 + 再描画）、`trackStore`（サンプルキャッシュの無効化、ダイアログを閉じる、ボタンの切替）。ダイアログはモーダルなので、これらは主に開いている間の OS レベルの変化（システムテーマなど）から発火します。削除しないでください。

## 検証

`tests/suite-dualVariable.js` は組み合わせテーブル、3 つのデータフィルタ、NaN の扱い、利用可否、ペア抽出、密度グリッド（ロバストなドメイン、退化した範囲、bin の整合性）、tooltip 配置の階段をカバーします。5 スイート合計 32 ケース。ローカル HTTP サーバー上の `tests/index.html` でスイート全体を実行してください。全緑を維持し、新しいデータルールを追加するときはテストも拡張します。共有ジェスチャは別途カバーします。`tests/suite-viewport.js` がウィンドウの計算（クランプ、軸ごとの向きの規約、アンカーの保持、ダブルタップの規則）を固定します。ポインター経路そのものは**手動**確認です — 粗いポインターの端末かデバイスエミュレーションで（タッチジェスチャはそこでしか存在しません）: ピンチと 2 本指ドラッグでズームとパン、1 本指のスワイプで読み取り、ダブルタップで全範囲に復帰、そしてウィンドウを動かすジェスチャがピン留めした読み取りを破棄すること（別のデータを指す画面位置に残さないこと）を確認します。
