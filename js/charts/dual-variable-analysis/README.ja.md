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

2変数分析は、プロファイル操作列から開く 2次元密度ヒートマップです（`#btn-dual-variable`。「疊加（オーバーレイ）」ボタンと同じく、ワイド画面ではラベル表示、720 px 以下では `chart-scatter` アイコンに縮小します）。X の物理量と Y の物理量を 1 つずつ選ぶと、選択中のセクターのサンプルが 2次元グリッドにビンニングされ、セルの色が局所的な点密度（最も密度の高いセルを基準に正規化）を表します。各物理量の値は指標パネルがその物理量に使う系列そのものです（データルールを参照）。チャートがパネルより正直だったり、より不正確だったりすることはあり得ません。標高プロファイルとビジュアル言語は共有しますが、独立したチャートシステムです。仕様（§22）は専用のモジュールディレクトリを求めており、共有の速度パイプライン以外で標高プロファイルへの import を増やすことはできません。

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
| `index.js` | オーケストレーター: ボタンとダイアログの配線、選択 → 分析 → 結果/空状態のステートマシン、セレクトの動的制約、イベント面（言語 / 単位 / テーマ / トラックストア / セクターストア） | `initDualVariableAnalysis` |
| `metrics.js` | 純粋な指標レジストリ: id、ラベルキー、単位ゲッター、共有フォーマッター、表示↔生値の目盛り変換、有効な組み合わせテーブル | `METRICS`、`getMetric`、`isPairAllowed`、`partnersOf` |
| `samples.js` | 純粋なデータ層: トラックごとに 1 つのサンプルテーブル。各物理量は指標パネルの機構で生成（データルールを参照）、利用可否、有限値ペアの抽出 | `buildAnalysisSamples`、`metricAvailability`、`extractPair` |
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
samples      → elevation-profile/profile-data (speedToPace), geo/interpolate (pointAtDistance), sectorMetrics (createPauseTracker, cleanSpeedSeries, cleanComputedSpeeds, recordedSpeedImplausible, trackHasRecordedSpeed, minettiFactor, GRADIENT_WINDOW_M, GRADIENT_MIN_WINDOW_M)
densityCalculator → nothing in this directory
```

`metrics.js`、`samples.js`、`densityCalculator.js` はテスト可能な最下層です。DOM もダイアログも扱いません。`samples.js` だけが標高プロファイル（共有の速度パイプライン）からの import を許されます。レンダラー層とインタラクション層は許されません。

## データルール（安易に緩めないこと）

各物理量の点の値は、指標パネルがその物理量に使う系列そのものから来ます（選択中セクターに対する `computeSectorMetrics` —— パネル自身のスコープです。境界が 2 つのトラック点の間に落ちる場合は、指標とまったく同じように補間されます）。チャートがパネルより正直だったり、より不正確だったりすることはあり得ません。描画された値がパネルの統計と食い違ったり、それを超えたりすることはありません。その値は統計が走る系列そのものだからです。物理量ごとには:

1. **心拍 / ケイデンス / パワー** — パネルのフィットネス系列: 有限な読み取り値から、確定済みの一時停止区間に入るタイムスタンプのものを除去し（`pauseFreeSamples` と同じ判定。最後の移動時刻は含まず、停止の終了時刻は含む。区間は共有の `createPauseTracker` から取得し、モジュール固有の検出器は使わない）、コンパクトな残存リストに共有の 5 点スライディングウィンドウ平滑をかけます（`avgHr/maxHr`、`avgCad/maxCad`、`avgPower/maxPower` の背後にある配列そのもの）。除去された読み取り値や欠損値は NaN のままです。
2. **温度** — 生の読み取り値。フィルタせず、一時停止中の読み取りも含みます。パネルの `rawStats` と同じです（環境の読み取りは努力の信号ではありません）。
3. **速度 / ペース / GAP** — セクターに対するパネルの「最高速度」系列。セクター自身の点の上で範囲ローカルに構築します（`maxCleanedPointSpeed` の行ごとのミラー: 記録値 → dd/dt クロスチェック → 5 点ウィンドウ。計算値 → 3σ。ルール選択はプロファイルの `buildCaches` と同じく、グローバルの trackHasRecordedSpeed 判定のまま）。平滑化ウィンドウが範囲ローカルなので、サブセクターで描かれた最速速度はその範囲に対するパネルの最高速度と等しくなります。セクター端の近くでは、プロファイルのトラック全体の速度曲線と（わずかに）異なり得ます。一時停止の点は残ります（休止中のゼロも含む）。GAP はその速度を、その点を離れる生のセグメント勾配の Minetti 因子で割ったものです（プロファイルの GAP オーバーレイと同じ）。
4. **勾配** — セクターに対するパネルの勾配ウィンドウ（補間された境界も含む）: 水平距離が `GRADIENT_WINDOW_M`（50 m）に達すると、そのウィンドウの昇降比がウィンドウの閉じ点に置かれ、次のウィンドウがそこから始まります。末尾の 50 m に満たない残余ウィンドウは長さ ≥ 20 m なら計上されます。有限な値は `maxGrade/minGrade` が走る集合そのもので、チャートで最も急な勾配がパネルの最大勾配です。勾配の点はそのため疎です（およそ 50 m に 1 つ）。勾配とのペアはウィンドウ閉じ点の行だけを残します。
5. **標高** — 生の点の標高。`eleMin/eleMax` と同じです。
6. **欠損値** — X または Y が非有限値のペアはビンニングに入りません（0 埋め、前値のコピー、補間は一切しません）。

初版仕様の行レベルのパイプライン（行全体への一時停止適用と、初版 §10 の無効パワー / 無効ケイデンスの除外）は 2026-09-17 に明示的な要望で削除されました: パネルはそのようなルールを適用しません —— 0 W のコースティング読み取りは平均に数えられ、温度は一時停止中の読み取りを保持します —— ので、チャートもそれらを捨ててはなりません。仕様の §10（と §20 の外れ値の立場）は同じ日にこのルールへ書き換えられました。除外は物理量ごとに、パネルの機構が除外するまさにその場所で起き、点が分析から外れる経路はルール 6 だけです。パネル自身の集計のみの統計（セグメントごとの dd/dt による平均速度 / 平均ペース、セグメントの努力ペースによる平均 GAP）にはここで対応する点ごとの値がなく、チャート独自の平均もありません。

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

`index.js` が購読するもの: `language:changed`（開いているビューの再描画）、`units:changed`（目盛りの再描画）、`theme:changed`（LUT 再構築 + 再描画）、`trackStore`（サンプルキャッシュの無効化、ダイアログを閉じる、ボタンの切替）、`sectorStore`（サンプルキャッシュの無効化。分析は指標パネルと同じく選択中セクターを読み、次のオープン/分析が新しい範囲で再構築します）。ダイアログはモーダルなので、開いている間にセクターは動かせず、セクター変化は実際にはセッション間で届きます。これらの購読を削除しないでください。

## 検証

`tests/suite-dualVariable.js` は組み合わせテーブル、物理量ごとのパネル整合（一時停止の除去、5 点平滑、コースティングのゼロの保持、一時停止を含む温度、50 m 勾配ウィンドウ）、セクターのスコープ（選択セクターの外の行はすべて NaN。補間された境界を持つトラック中程の範囲に対する `computeSectorMetrics` との整合。トラック全体の一時停止の中に生まれたセクターを含む）、パネル整合の不変条件（各物理量の有限な点に対するチャートの最大/平均/最小がパネルの数値と正確に一致する）、NaN の扱い、利用可否、ペア抽出、密度グリッド（ロバストなドメイン、退化した範囲、bin の整合性）、tooltip 配置の階段をカバーします。7 スイート合計 42 ケース。ローカル HTTP サーバー上の `tests/index.html` でスイート全体を実行してください。全緑を維持し、新しいデータルールを追加するときはテストも拡張します。共有ジェスチャは別途カバーします。`tests/suite-viewport.js` がウィンドウの計算（クランプ、軸ごとの向きの規約、アンカーの保持、ダブルタップの規則）を固定します。ポインター経路そのものは**手動**確認です — 粗いポインターの端末かデバイスエミュレーションで（タッチジェスチャはそこでしか存在しません）: ピンチと 2 本指ドラッグでズームとパン、1 本指のスワイプで読み取り、ダブルタップで全範囲に復帰、そしてウィンドウを動かすジェスチャがピン留めした読み取りを破棄すること（別のデータを指す画面位置に残さないこと）を確認します。
