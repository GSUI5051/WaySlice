# 標高プロファイル — 保守ガイド

[English](README.md) | 日本語 | [한국어](README.ko.md)

> **This file is machine-generated and may contain errors. If you find issues, please submit a PR.**
> このファイルは機械生成のため、誤りが含まれる可能性があります。問題を見つけたら PR を送ってください。

標高 / テレメトリプロファイルの保守方法：各モジュールの担当範囲、新規コードの置き場所、
アーキテクチャを保つルール、変更の検証方法。

## このディレクトリについて

標高プロファイルは地図の下にある Canvas チャートです：標高バンド、メトリックオーバーレイ
曲線（心拍、速度 / ペース / GAP、ケイデンス、温度、パワー）、心拍ゾーンバンド、セクター選択、
ホバー十字線、そして地図と連動する一連の操作。かつては約 1500 行の単一ファイルでしたが、
現在は責務別のモジュール群です。

**公開 API は 2 つの関数のみ**：

```js
import { initProfile, setProfileTrack } from './charts/elevation-profile/index.js';
initProfile(document.getElementById('profile-body'));  // main.js、起動時
setProfileTrack(track);                                // main.js、トラック読み込み時
```

DOM 契約：`#profile-body` の中に `#profile-canvas`、`#profile-tooltip`、`#handle-start`、
`#handle-end`。外に `#profile-readout`（タッチプローブの固定テレメトリバンド。`.profile-head` と
`#profile-body` の間）、`#btn-x-distance`、`#btn-x-time`、
`#btn-waypoint-snap`、`#btn-overlays`。これらの id は絶対に変更しないこと。
`#profile-tooltip` ノードは `#profile-body` 内 (absolute) にあり、ワークスペースのスクロールに
ネイティブに追従します。タッチプローブの読み取りは、ヘッダーとチャートの間にある固定バンド
（`#profile-readout`）に描かれます。バンドはプロファイルモジュール自身の一部なので、チャートを
覆うことも、読み取りの出し入れでレイアウトが動くこともありません
(showTooltipAt / initProfile 参照)。

## モジュールマップ

| ファイル | 責務 | エクスポート |
|---|---|---|
| `index.js` | オーケストレーション：DOM 組み立て、外部イベント、トラックのライフサイクル、リサイズ処理 | `initProfile`、`setProfileTrack` |
| `profile-state.js` | チャートインスタンス 1 個分の共有ミュータブル状態（`state`）+ `isWideLayout` | `state`、`isWideLayout` |
| `profile-data.js` | 純粋計算：ポイント別キャッシュ、ダウンサンプリング、座標変換、オーバーレイ定義とトグル規則。DOM なし・兄弟モジュールに非依存 | `OVERLAY_METRICS`、`SPEED_FAMILY`、`buildCaches`、`overlayAvailability`、`overlayValueAt`、`sampleOverlay`、`sampleElevation`、`seriesExtremes`、`distToX`、`xToDist`、`clientXtoX`、`speedToPace`、`formatOverlayValue`、`applyOverlayToggle` |
| `profile-render.js` | Canvas 描画のすべて：`sync()` の描画パスと各レイヤー、`scheduleSync`、ハンドル / マスク配置 | `initRender`、`scheduleSync`、`sync`、`resizeCanvas`、`positionHandles`、`refreshHandleLabels` |
| `profile-interaction.js` | 3 つの入力経路（ヘッダーコントロール、キャンバスポインター——ホバー / ドラッグ選択 / ズームとタッチプローブのジェスチャ、セクターハンドル）+ toast + ウェイポイントスナップ。タッチのピンチ/パン/ダブルタップの状態機械はここにはありません（双変数チャートも動かす共有モジュール `js/charts/viewport-gestures.js` です）。描画はしない | `wireControls`、`wirePointer`、`wireHandles`、`setXMode`、`toggleOverlay`、`refreshControls`、`refreshSnapToggle`、`unpinWaypoint` |
| `profile-tooltip.js` | ホバー tooltip とタッチプローブ読み取りの DOM と内容 | `showTooltipAt`、`hideTooltip`、`resetProbeReadout` |

依存グラフ（矢印 = import。現在の import 文に対照済み。循環なしを維持）：

```text
index       → state、data、render、interaction、tooltip
interaction → state、data、render（scheduleSync のみ）、tooltip、../viewport-gestures（タッチのピンチ / パン / ダブルタップ復帰）
render      → state、data、tooltip（drawHover が showTooltipAt を呼ぶ）
tooltip     → state、data
data        → このディレクトリ内には依存なし（外の geo / metrics / utils のみ）
state       → 依存なし
```

`profile-data.js` は依存グラフの最下層：このディレクトリ内のどのファイルも import しない——
だからこそ単体テスト可能です。**`profile-utils.js` は存在しません**：現時点で各「小ツール」には
ちょうど 1 つの利用モジュールしかないため、そのモジュール内に置いてあります。

## 共有状態

モジュール間で共有するものはすべて `state` オブジェクト（`profile-state.js`）にあります。
単一モジュールしか使わないものは、そのモジュール内のプライベートな `let` のままにします——
フィールドを移動する前に確認してください。

`state.dom`（初期化中に一度だけ組み立てる：`index.js` が取得したノードを代入し、`initRender` が
マスクを作成して canvas/ctx をバインド、`wireControls` が `snapBtn` を代入）：`root`、`canvas`、
`ctx`、`tooltip`、`readout`（プローブのバンド。root の外）、`handles.{start,end}`、`masks.{left,right}`、
`xButtons.{distance,time}`、`snapBtn`。

チャートデータ：`track`、`xs`（現在の軸モードでのポイント別 x）、`speeds`、`gapSpeeds`、
`profileWaypoints`。`speeds`/`gapSpeeds` キャッシュは速度の取得元に応じて整えられます — 記録速度は各読みをその時の dd/dt とクロスチェックし（50% を超える読みは除去）、
5 点スライディングウィンドウで平滑化します（`cleanSpeedSeries`：各ポイントは自身と前後 2 点の有効値の平均）。
計算速度は 3σ 清洗のみを適用します（`cleanComputedSpeeds`：超えた値を近傍の正常値の補間で埋める）。
休息中に記録された 0 も数値の一部として平均に参加します。
チャートビュー：`xMode`（`'distance' | 'time'`）、`view`（`{start,end}`、`null` = 全トラック）、
`plot`（CSS ピクセル `{x0,y0,w,h}`）。
オーバーレイ：`selectedOverlays`（選択順）、`hiddenOverlays`（一時的に隠した id の Set）。
ホバー：`hoverDist`、`hoverX`、`hoverOrigin`（`'profile' | 'map' | 'waypoint'`）、
`waypointHover`、`pinnedWaypoint`。
タッチプローブ：`probe`（アクティブなら `{dist}`、それ以外 `null`）——モバイル版のタッチ
インスペクタです。トラック距離にアンカーされ（x は描画 / ヒットテストのたびに `distToX` で
再導出）、パン・ズーム・軸モード切替でもデータ点上から外れません。アクティブな間はホバー
十字線を退避させ、読み取りはプローブが所有します（`showTooltipAt` はプローブ以外の呼び出しを
無視、`hideTooltip` は `force` 指定でのみ隠れます）。
その他：`waypointsShown`（地図のウェイポイント表示トグルのミラー）。

モジュールプライベート（`state` に**移さない**こと）：render は `syncPending`、`hrHoverCurve`、
`MARGIN`、バインド済み DOM エイリアスを所有。interaction は `lastSpeedVariant`、
`overlaysMenu`、`waypointSnap`、`lastSnapDist`、toast タイマー、パン提示フラグと
タッチグラブのフラグ（仮想ハンドル、プローブドラッグ、チャート外 tap の記録）を所有。tap 判定・ピンチの基準・パンのウィンドウは共有ジェスチャマシン（`js/charts/viewport-gestures.js`）にあり、interaction はイベントを渡すだけです。

規約：

- ミュータブルなスカラーは必ず `state.X` として読み書きする——この接頭辞こそが、レビュー時に
  共有状態を見える化する仕組みです。
- 初期化後に変わらないオブジェクト参照（ctx、canvas、handles…）は、所有モジュールの init
  （`initRender`）で一度だけモジュールレベルの `let` にデストラクチャします。
- レンダラーは `state.plot`（`resizeCanvas` 経由）と `hrHoverCurve` の唯一の書き込み者です。

## 描画パス（`sync()`）

実際の呼び出し順序——新しいレイヤーは正しいスロットに挿入し、安易に順序を変えないこと：

1. x 軸目盛り（`xMode` に応じて距離または経過時間）
2. クリップされたブロック：**心拍ゾーンバンド**、次にオーバーレイ曲線（2 パス：第 1 パスで
   表示中の全オーバーレイをサンプリングしてスケールを決定、第 2 パスで線を描く——そのため
   バンドは曲線の**下**に来る）
3. `placeMasks()`——セクターベールの DOM 要素をここで配置（標高ブランチの前）
4. 標高ブランチ：標高のないトラックは平らな破線の参照線を描く。それ以外はグリッド + y ラベル、
   オーバーレイ軸ストリップ、標高バンド（全トラック）、セクターハイライト、ウェイポイントピン
5. `positionHandles()`——ハンドル DOM 要素をここで配置（両ブランチ）
6. ホバー十字線（+ 標高曲線上のサーフェス色塗り・アクセント縁の点、+ 十字線と描画済み心拍
   曲線の交点の塗りつぶし点）。タッチプローブがアクティブな間はプローブがこれに取って代わり
   ——同じ線と点を、プローブのデータ位置にアンカーして描きます。読み取りはヘッダーとチャートの間にある
   固定テレメトリバンド `#profile-readout`——2 行 × 4 列の固定スロットグリッド（位置 / 標高 /
   速度族 / 心拍 + ケイデンス / 温度 / パワー / 空）：位置と標高は常に表示される。センサーの
   スロットは、オーバーレイが有効なら値を、トラックにデータがあるがオーバーレイが無効なら薄色の
   「未選択」を表示し、トラックがそのセンサーを持たなければ空白のまま。有効だが読み取りのない
   スロットはダッシュ。心拍スロットは二段構え（値の下にゾーン）で、全スロットが内容を中央揃え
   するため、単一行のスロットは高くなった行の中で垂直中央に保たれる（粗いポインターの端末。正確な
   ポインターの端末は従来の浮遊ボックスのままで、幅は画面の半分まで、オーバーレイが多いときは
   読み取りの間で折り返し、1 つの読み取りが分割されることはない）

このパスに組み込まれたルール：

- オーバーレイは**全トラック**でスケーリング（グローバル y 軸）。ズームは x 軸のみを伸縮する。
- 速度ファミリーの軸ストリップの上端は、速度系列の**ポイントごとの最大値**（`seriesExtremes`）。上端ラベルは常に、メトリクスリストの最大速度と同じ値を示します。曲線自体は `sampleOverlay` の列平均で描かれます。それ以外のオーバーレイはパディング付きのサンプル上端を保ちます。
- ゾーンバンドとホバー点は、bpm → y の変換を**心拍オーバーレイ自身の lo/hi スケール**に完全に
  合わせ、そのスケールでクリップする。描画されるのはそのスケールが存在するとき（心拍曲線が
  表示され、データがあるとき）だけ。ゾーンのために軸を広げない。第 2 のマッピングを作らない。
  バンドはさらに設定ドロワーの表示トグル（`showZones`、`js/metrics/heartRateDisplay.js`）
  にも従う。十字線の心拍交差点はトグルの対象外——交差点はバンドではなく十字線に属する。
- ホバー中、またはタッチプローブがアクティブなときは、現在の心拍の読み取り値が属するバンドを
  少し深く着色します——通常のアルファの
  約 2 倍で、それでも淡く（`BAND_ALPHA` / `ACTIVE_BAND_ALPHA`）。アクティブなゾーンの判定は
  ツールチップのゾーンラベルと同じ読み取り経路を使うため、両者は常に一致します。検査対象が
  ないときは強調しません。設定ドロワーのハイライトトグルがオフのときも強調しません
  （`js/metrics/heartRateDisplay.js`）：ハイライトは表示トグルがオンであることを前提とし、
  バンド非表示中もそのチェック状態は保持されます。
- 描画順序は壊せない：ゾーンバンド → オーバーレイ曲線 → 標高バンド → セクターハイライト → ホバー。
- パス1のサンプリングはキャッシュ済み：オーバーレイごとの列平均とスピード系の 1 点ごとの最大値は、トラック・x 軸モード・プロット幅・オーバーレイ選択が変わったときだけ再計算します。ホバー・タッププローブ・ハンドル操作のフレームは、保存済みサンプルからそのまま再描画します（`profile-render.js` の `sampleVisibleOverlays`/`overlaySamples`）。
- `sync()` はチャート状態を読むだけで変更しない。render が所有する書き込みは `hrHoverCurve`
  のみ。出力は `state`、`sectorStore`、現在のテーマトークン（`getComputedStyle`）で決まり、
  書き込み先は canvas と render 所有の DOM（マスク、ハンドル）、および `showTooltipAt` 経由の
  tooltip に限られる。フレームごとに決定論的だが、**純粋関数ではない**——描画する。

## 座標変換

`distToX` / `xToDist`（データ ↔ x ドメイン、軸モード対応）と `clientXtoX`（カーソル px →
ズームウィンドウ経由の x）は `profile-data.js` にあり、**唯一の情報源**です。すべてのカーソル
経路（ホバー、ドラッグ選択、ハンドルドラッグ、タッチプローブのタップとドラッグ、ホイールズーム）と描画される全要素はこれを経由
しなければなりません。さもないとズーム時にハンドルがカーソルからずれます。新しい変換が必要な
場合は、明示的パラメータの純粋関数としてここに追加してください。

## よくある保守タスク

### オーバーレイ指標の追加（例：新しいセンサー）

1. `OVERLAY_METRICS` に定義を追加（`id`、`colorToken`、`labelKey`、`axis`）。
2. パーサーでトラックに `hasX` フラグを付け、`overlayAvailability` に接続。
3. `overlayValueAt` にポイント別リーダーを追加。
4. **5 つすべて**の言語パックに `labelKey` を追加（`js/language/`——key の一致はテストで強制）。
5. スロット上限：必要なら `profile-interaction.js` の `maxOverlays()` を拡張。

### 描画レイヤーの追加

- サンプリングは `profile-data.js` 経由（`sampleOverlay` / `sampleElevation`）。既存のホバー
  経路を除き、レンダラーが `track.points[]` を直接読むことはしない。
- 色は CSS デザイントークン（`--series-*`、`--hr-zone-*`）から。テーマ切替に対応して毎フレーム
  再取得。
- `sync()` の正しい z 順序スロットに挿入し、この README のレイヤー一覧も更新する。

### インタラクティブなコントロールの追加

- `profile-interaction.js` で配線（ヘッダーコントロール → `wireControls`、キャンジェスチャー →
  `wirePointer`、セクターハンドル → `wireHandles`）。
- `state` を変更してから `scheduleSync()` を呼ぶ。interaction コードは**描画しない**、`ctx` にも
  触れない。

### 心拍ゾーンデータを扱う

- 読み取り専用：`js/metrics/` の `loadHeartRateSettings()` + `computeZoneBounds()` を使用。
  この機能がユーザーのゾーンを再計算・変更することはない。
- ゾーンはモード別の bpm 下限。ゾーン 5 は上限なし（スケールでクリップ）。
- `hrzones:changed` を購読しないと、設定ダイアログで編集した後に描画が古くなる。
- バンドの表示とホバーハイライトはユーザーの表示設定です（`js/metrics/heartRateDisplay.js`：
  `getHeartRateDisplay` / `setHeartRateDisplay`、localStorage `wayslice-hr-display`）。
  `showZones` はバンド全体を隠し、`highlight` はホバー時の濃色化を制御する。
  読み取りのゾーンラベルも同じ 2 つのトグルに従う——`showZones` が有効なときだけ現れ、
  `highlight` が有効なら `--hr-zone-N` の色で強調される。
  `hrzones:display`（変更のたびに発行）を購読しないと、設定ドロワーでトグルした後に
  描画が古くなる。

### 状態の変更

- 複数モジュールから見える必要があるもの → `state` オブジェクト、そしてこの README を更新。
- 単一モジュール内のもの → モジュールプライベートの `let`。デフォルトでは `state` を拡張しない。

## アーキテクチャを保つルール

1. `profile-data.js` は純粋関数を保つ：明示的パラメータ、DOM なし、`state` を import しない。
   状態が必要な関数は別の場所に属する（または状態を引数で渡す）。
2. `profile-render.js` は `profile-interaction.js` を import しない。interaction は描画しない。
   レンダラーが触るのは自分の DOM 資産（canvas、マスク、ハンドル）のみ。別モジュールの DOM に
   対する唯一の呼び出しは `drawHover → showTooltipAt`（tooltip）。
3. オーバーレイファミリー規則：速度 / ペース / GAP は 1 つの系列・1 つのスロット。
   `applyOverlayToggle` では、兄弟バリアントがスロット満杯でも**置き換え**を行う（sibling チェックを
   スロット上限チェックより先に行うこと）。`toggleOverlay` が返り値 `{selected, unhide}` を
   `state` に適用し、`lastSpeedVariant` を管理する。
4. import の深さ：モジュールは旧フラットファイルより 1 階層深い——`menus.js` は
   `../../ui/menus.js`、stores は `../../core/…`。`../…` では**ない**。
5. 新しいライブラリ・グローバル変数を導入しない：プロジェクトの他部分と同様 ES module のみ。
6. Canvas キャッシュ：開発中はブラウザーが古いモジュールを返すことがある——プロジェクトに
   ビルド工程がなく、開発サーバーは明示的なキャッシュディレクティブを送らないため、ブラウザーが
   ヒューリスティックキャッシュを適用しうる。変更が反映されないと疑う前に CDP の
   `Page.reload {ignoreCache: true}` で強制リロード。

7. ビューポートのジェスチャは共有し、分岐させないこと。ピンチ / パン / タップ /
   ダブルタップの状態機械は `js/charts/viewport-gestures.js` にあり、双変数チャートも同じものを
   動かします。プロファイルが渡すのは 1 つの x 軸アダプター（ドメイン、ズーム下限、プロットの
   ジオメトリ、`state.view` のアクセサ）だけです。ホイールズームが `zoomStep` を通るのもそのためで、
   ウィンドウの計算（`zoomWindow` / `panWindow`）やクランプをローカルで再実装しないでください
   —— 2 つの実装は端で必ず食い違います。

## テスト

**自動** — `tests/index.html`（リポジトリルートを serve、例：`python -m http.server`）。
スイートはこのモジュールを直接 import しない（Canvas/DOM の仕事のため）。共有数学
（`metrics/`、`geo/`）と `tests/suite-viewport.js`（共有のズーム/パンのウィンドウ計算とダブルタップの規則）の回帰ネットとして機能する。期待値：全緑。

**手動** — 標高・タイムスタンプ・心拍・ケイデンスを備えた実トラックの GPX を読み込み、少なくとも
次を再生する：

- オーバーレイメニュー：心拍 ON/OFF → ゾーンバンドの出現/消滅；速度 → ペース → GAP が
  相互に置き換わること。スロット満杯でケイデンスが拒否されること
- ホバー：十字線、標高の点、心拍の交点、ツールチップ読み取り（心拍のゾーンラベルは drawer の
  「ゾーン表示」トグルが有効なときのみ現れ、「ハイライト」トグルが有効ならゾーン色で強調される）
- タッチプローブ（モバイル / タッチ）：チャートをタップ → 十字線 + ヘッダーとチャートの間にある固定
  バンド——2 行 × 4 列の固定スロットグリッド：[位置] [標高] [速度/ペース] [心拍] /
  [ケイデンス] [温度] [パワー] [空]。各スロットは独立して中央揃え、決して動かない。位置と標高は
  常に表示される。センサーのスロットは、オーバーレイが有効なら値を、トラックにデータがあるが
  オーバーレイが無効なら薄色の「未選択」を表示し、トラックがそのセンサーを持たなければ空白のまま。
  有効だが読み取りのないスロットはダッシュ。心拍セルは値の下にゾーンを重ねる——ゾーンラベルは
  「ゾーン表示」トグルが有効なときのみ現れ、「ハイライト」が有効ならゾーン色で強調される——全セルが内容を
  中央揃えするため、単一行セルは高くなった行の中で垂直中央に保たれる。点未選択のときは薄い色の「チャートをタップしてテレメトリを表示」が
  出る。
  プローブを x に沿ってドラッグすると値がその場で更新される（スロットの幾何は不変）。別の場所をタップ →
  再配置（破棄はしない）。チャート外を
  タップ → プローブ消滅、バンドはヒントに戻る。1 本指ドラッグのパン（ズーム時）と 2 本指ピンチズームが、プローブを
  作成・移動・消滅させてはならない。セクターハンドルが最優先
- セクター：ドラッグ選択、ハンドルドラッグ + ウェイポイントスナップ、キーボードの
  矢印 / Home / End
- ズーム：ホイール（正確なポインターのみ）、Shift + ドラッグでパン、ダブルクリック /
  ダブルタップでリセット
- x 軸モード：距離 ↔ 時間
- ライブ切替：言語、テーマ、単位、チャートを開いたままの心拍ゾーン編集、設定ドロワーの
  2 つの心拍表示トグル（バンド ON/OFF、ホバーハイライト）
- モバイルビューポート（約 390 px）：横方向のオーバーフローなし、レイヤー維持

**Canvas アサーション** — ピクセルプローブ（`ctx.getImageData`）が Canvas 機能を検証する
実用的な手段です：固定列で着色行数を数える（ゾーンバンド ON/OFF）、十字線の列でシリーズ色の
垂直連続ランを測る（点のサイズ / 位置）。ゾーンバンドの着色による RGB のずれは数単位——
閾値を厳しくし、曲線ピクセルを除外すること。

## この README を更新すべきタイミング

- モジュールの責務またはエクスポートが変わったとき
- 状態フィールドが `state` とモジュールプライベートの間で移動したとき、または追加されたとき
- 描画順序が変わったとき、または新しいレイヤーが追加されたとき
- 外部イベントの購読 / 発行が増減したとき
- 「アーキテクチャを保つルール」のいずれかが変わったとき
