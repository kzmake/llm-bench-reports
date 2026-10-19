# llm-bench-reports

llm-bench の実行レポートを GitHub Pages で公開するためのリポジトリです。

## 構成

| パス | 内容 |
| --- | --- |
| `<日付>/<run>/` | llm-bench の `reports/<日付>/<run>/` と同じ中身（レポート、`shots/`、`work/`） |
| `index.html` | レポート一覧。`build-index.ts` が生成する |
| `build-index.ts` | 各レポートに埋め込まれたデータから `index.html` を作る（依存なし） |
| `.nojekyll` | Jekyll による処理を無効にする |

`index.html` は、全実行で共通の時間軸のタイムラインと、スクリーンショット付きのカードで構成されています。実行したモデルは色とバッジで区別します（色は初出のモデルから順に青・オレンジ・青緑。4 つ目以降は灰色）。モデル名は各レポートの「モデル」欄から読むので、古いレポートにも付きます。

## 更新手順

llm-bench 側でレポートをコミットしたあと、このリポジトリで次を実行します。

```sh
git -C ../llm-bench archive HEAD:reports | tar -x -C .
bun build-index.ts
git add -A && git commit -m "docs: update reports" && git push
```

`git archive` はコミット済みのファイルだけを取り出すので、llm-bench の未コミットの変更や `.DS_Store` は入りません。

各レポートの先頭のモデル名のチップと `<title>` のモデル名は、llm-bench の `f2e0d28` 以降のテンプレートで描画したレポートにだけ入ります。それより前に描画したレポートが llm-bench にコミットされている場合は、取り込む前に llm-bench で `bun report` をやり直してコミットしてください。そのまま取り込むと、このリポジトリのチップ入りのレポートがチップなしの版に戻ります。
