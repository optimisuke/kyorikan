# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「キョリカン」— 2つの地図を並べ、片方を操作するともう片方が同じ地上距離スケール（m/px）で追従する静的サイト。メルカトル図法では緯度によって同じ zoom でも実縮尺が変わるため、緯度差の自動補正が中核機能。

構成は `index.html` + `style.css` + `main.js` のみ。ビルドツール・フレームワーク・パッケージ管理なし（Leaflet 1.9.4 を CDN で読み込む Vanilla JS）。

## 開発コマンド

```sh
python3 -m http.server 8000   # ローカルサーブ（file:// では Nominatim への fetch が失敗するためサーブ推奨）
```

テスト・lint・ビルドは存在しない。公開は GitHub Pages（main ブランチのルート）。

## 中核ロジック（main.js）

- **縮尺同期の補正式**: `追従zoom = 基準zoom + log2( cos(追従緯度) / cos(基準緯度) )`。
  元の要件定義書では分子分母が逆だったが、Web メルカトルの `m/px = C·cos(緯度)/2^zoom` から導出したこちらが正しい。変更時は両地図のスケールバーが同じ実距離を示すことで検証できる。
- **`zoomSnap: 0` は必須**。Leaflet はデフォルトで zoom を整数にスナップするため、これがないと小数の補正 zoom が丸められて同期が壊れる。
- **無限ループ防止**: プログラムによる `setZoom` は `{ animate: false }` で同期的にイベントを発火させ、`isSyncing` フラグで再入を防ぐ。`animate: true` に変えるとイベントが非同期になりフラグが機能しなくなるので注意。
- **基準/追従の切り替え**: ユーザーが操作した側の地図が基準（primary）になる。`zoomend` と `moveend` の両方で同期する（パンだけでも中心緯度が変わり補正値が変わるため）。
- **ホイールズームは自前実装**（`enableSmoothWheelZoom`）: Leaflet 標準の `scrollWheelZoom` は1ジェスチャのズーム量に上限があり、タッチパッドで引っかかる感触になるため無効化し、wheel イベントごとに `setZoomAround(..., {animate:false})` している。`ctrlKey=true` はタッチパッドのピンチ（ブラウザ合成イベント）で、感度を変えている。
- **初期位置の保存**: localStorage キー `kyorikan.defaultView` に両地図の center/zoom を保存。読み込み時に `isValidView` で検証し、壊れていればデフォルト（東京・那覇）に戻す。

## 外部サービスの制約

- **Nominatim**: 1リクエスト/秒のレート制限をクライアント側で実装済み（`lastNominatimRequest`）。インクリメンタル検索は実装しないこと。ブラウザの fetch では `User-Agent` ヘッダーは設定できない（forbidden header）ので設定コードを書かないこと。
- **地図タイル**: CARTO Voyager（`basemaps.cartocdn.com`、キー不要・非商用無料）。attribution（OSM + CARTO）は必須、消さないこと。
