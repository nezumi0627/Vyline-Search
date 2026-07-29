# Vyline-Search

Desktop LINE（Themida 保護）向けの **ネイティブシンボル検索 / 逆コンパイル** ツールキット。

元は [Vyline](https://github.com/nezumi0627/Vyline) の `findNativeSymbol` / `focusRecoveredSource` を切り出したスタンドアロンリポジトリです。

`sendMessage` などの単語を渡すだけで:

1. unpacked `LINE.exe` から関連文字列を列挙・分類
2. その文字列をロードする `LEA` 命令を静的 xref スキャン
3. 該当関数を Ghidra headless で decompile

までを自動実行します。

## 必要環境

- [Bun](https://bun.sh) 1.1+
- Windows（PE / PowerShell / Ghidra bat 前提）
- JDK 21+（decompile 時）
- Themida unpack 済み `unpacked_LINE.exe`（`--list-only` 以外）

## セットアップ

```powershell
cd E:\projects\Vyline-Search
bun install

# unpack 済み exe を配置
copy path\to\unpacked_LINE.exe data\unpacked_LINE.exe
```

環境変数:

| 変数 | 意味 |
|---|---|
| `VYLINE_SEARCH_DATA` | データルート（既定: `./data`） |
| `VYLINE_SEARCH_EXE` | 既定の unpacked exe パス |

## 使い方

```powershell
# 基本: sendMessage 関連を全自動特定
bun run find -- sendMessage

# 文字列 + xref だけ（Ghidra 不要・高速）
bun run find -- sendMessage --list-only --skip-setup

# 複数語
bun run find -- sendMessage unsendMessage markAsRead

# CLI 経由
bun run search -- find sendMessage --max-functions 10

# 全件 decompile 結果の分類（任意）
bun run focus -- --source-dir path\to\recovered\src\native\LINE.exe
```

### 主なオプション（find）

| オプション | 既定 | 説明 |
|---|---|---|
| `--exe <path>` | `data/unpacked_LINE.exe` | 解析対象 |
| `--list-only` | off | decompile スキップ |
| `--max-functions <n>` | 20 | decompile 上限 |
| `--timeout <sec>` | 20 | 関数あたり timeout |
| `--include-all` | off | 全 xref を decompile |
| `--skip-setup` | off | Ghidra/JDK 自動取得スキップ |

詳細は [docs/find-native-symbol.md](docs/find-native-symbol.md)。

## 出力

```text
data/out/native-search/<terms>/
  README.md
  strings.json
  xrefs.json
  rva-targets.txt
  functions/*.c
```

`data/` 以下（exe・Ghidra キャッシュ・出力）は gitignore 済みです。

## ディレクトリ構成

```text
Vyline-Search/
  src/
    cli.ts                 # vyline-search エントリ
    findNativeSymbol.ts    # メイン検索オーケストレータ
    focusRecoveredSource.ts
    paths.ts               # data/ レイアウト
  ghidra-scripts/          # headless 用 Java
  docs/
  data/                    # ローカル作業領域（gitignore）
```

## Themida について

このツールは **Themida unpack 自体は行いません**。`unlicense` 等で稼働中プロセスから dump した `unpacked_LINE.exe` を入力にしてください。

文字列・xref は Ghidra なしで生 PE スキャン、decompile だけ Ghidra に任せます（フル auto-analysis は避け `-noanalysis`）。

## License

MIT — see [LICENSE](LICENSE).
