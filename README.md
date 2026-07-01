# キョリカン

2つの地図を並べて表示し、片方を操作するともう片方が「実際の地上距離スケールが同じ」状態で自動追従するサイト。

旅行先と地元、海外の都市と自分の生活圏など、別々の場所の「距離感」を直感的に比較できます。緯度が違う場所同士では同じ zoom レベルでも実際の縮尺が揃わない（メルカトル図法の歪み）ため、緯度差を自動補正しているのがポイントです。

## 使い方

- どちらかの地図をドラッグ・ズームすると、その地図が「基準」になり、もう片方が同じ縮尺に追従します
- 検索ボックスに地名・住所を入れて Enter（または検索ボタン）で地図が移動します。`35.68, 139.76` のような緯度経度の直接入力にも対応しています
- 地図上を2点クリックすると2点間の実距離（km）を表示します。3回目のクリックで計測をやり直せます
- 両地図のスケールバーが同じ実距離を示していれば、縮尺同期が正しく機能しています
- ヘッダーの「初期位置として保存」で、現在の両地図の位置・ズームを次回の初期表示にできます（ブラウザの localStorage に保存。「リセット」でデフォルトに戻ります）

## 仕組み

Web メルカトルでは 1px あたりの実距離が `m/px = C × cos(緯度) / 2^zoom` で決まるため、両地図の m/px を揃えるには次の補正をかけます：

```
追従zoom = 基準zoom + log2( cos(追従地図の緯度) / cos(基準地図の緯度) )
```

## 技術スタック

- [Leaflet](https://leafletjs.com/) 1.9.4（CDN、API キー不要）
- [CARTO Voyager](https://carto.com/basemaps/) ベースマップタイル（データは © OpenStreetMap contributors、キー不要）
- [Nominatim](https://nominatim.org/) geocoding API（地名検索）
- Vanilla JS、ビルド不要の静的サイト

## ローカルでの動作確認

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## 公開（GitHub Pages）

リポジトリの Settings → Pages で `main` ブランチのルートを指定するだけで公開できます。

## 利用ポリシー上の注意

- OpenStreetMap タイルの attribution（帰属表示）は消さないこと（[Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)）
- Nominatim へのリクエストは1秒に1回まで（[Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)）。検索は入力確定時のみ実行し、インクリメンタル検索は実装しない
