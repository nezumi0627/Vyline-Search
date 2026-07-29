# findNativeSymbol — Desktop LINE ネイティブシンボル自動特定

`word` もしくは関数名（例: `sendMessage`）を入力するだけで、Themida unpack 済み
`LINE.exe` から

1. 関連文字列の一覧化・分類
2. その文字列をロードする命令の特定（静的 LEA xref）
3. 該当関数の Ghidra headless decompile

までを 1 コマンドで実行します。

## 実行

```powershell
bun run find -- sendMessage
bun run find -- sendMessage --list-only --skip-setup
bun run search -- find sendMessage --max-functions 10
```

既定の exe: `data/unpacked_LINE.exe`（`VYLINE_SEARCH_EXE` / `--exe` で上書き可）

## 出力

`data/out/native-search/<slug>/` に `README.md` / `strings.json` / `xrefs.json` / `functions/` を書き出します。

## 設計メモ（Themida）

- 文字列・xref は生 PE スキャン（Ghidra 参照 DB に依存しない）
- decompile だけ Ghidra、かつ対象関数に絞って `-noanalysis`

元ドキュメント（Vyline monorepo）の詳細版をベースに、パスを本リポジトリ向けに更新したものです。
