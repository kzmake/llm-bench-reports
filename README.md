# llm-bench-reports

llm-bench の実行レポートを GitHub Pages で公開するためのリポジトリです。

## 構成

| パス | 内容 |
| --- | --- |
| `<日付>/<run>/` | llm-bench の `reports/<日付>/<run>/` と同じ中身（レポート、`shots/`、`work/`） |
| `index.html` | レポート一覧。`build-index.ts` が生成する |
| `build-index.ts` | 各レポートに埋め込まれたデータから `index.html` を作る（依存なし） |
| `.nojekyll` | Jekyll による処理を無効にする |

`index.html` は、全実行で共通の時間軸のタイムラインと、スクリーンショット付きのカードで構成されています。

## 更新手順

llm-bench 側でレポートをコミットしたあと、このリポジトリで次を実行します。

```sh
git -C ../llm-bench archive HEAD:reports | tar -x -C .
bun build-index.ts
git add -A && git commit -m "docs: update reports" && git push
```

`git archive` はコミット済みのファイルだけを取り出すので、llm-bench の未コミットの変更や `.DS_Store` は入りません。
