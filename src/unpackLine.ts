/**
 * unpackLine — Themida 保護の LINE.exe を unlicense で dump し、
 * data/unpacked_LINE.exe に配置する。
 *
 *   bun run unpack
 *   bun run unpack -- --timeout 180
 *   bun run unpack -- --exe "C:\...\LINE.exe"
 *   bun run unpack -- --skip-download   # 既に data/re-tools/unlicense があるとき
 *
 * 注意:
 * - unlicense は対象 PE を **起動して** OEP 到達後に dump する（実行される）
 * - 出力は静的解析用。多くの場合「そのまま起動できる exe」にはならない
 * - 既に LINE が起動中なら、競合を避けるため一度終了してから実行するのが安全
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  DATA_DIR,
  RE_TOOLS_DIR,
  defaultUnpackedExe,
  ensureDataLayout,
} from "./paths.js";

ensureDataLayout();

const UNLICENSE_DIR = join(RE_TOOLS_DIR, "unlicense");
const UNLICENSE_RELEASE = "0.4.0";
const UNLICENSE_ASSET = "unlicense-py3.11-x64.zip";
const UNLICENSE_URL =
  `https://github.com/ergrelet/unlicense/releases/download/${UNLICENSE_RELEASE}/${UNLICENSE_ASSET}`;

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

const rawArgs = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = rawArgs[i + 1];
  if (next && !next.startsWith("--")) {
    flags[key] = next;
    i++;
  } else {
    flags[key] = true;
  }
}

if (flags["help"] || flags["h"]) {
  console.log(`usage: bun run unpack -- [options]

  --exe <path>         対象 LINE.exe（未指定なら %LOCALAPPDATA%\\LINE\\bin\\<ver>\\LINE.exe）
  --out <path>         出力パス（既定: data/unpacked_LINE.exe）
  --timeout <sec>      unlicense OEP 待ち（既定: 120）
  --skip-download      unlicense の自動取得をスキップ
  --keep-work          作業ディレクトリを残す
  --verbose            unlicense --verbose
`);
  process.exit(0);
}

const timeoutSec = Number(flags["timeout"] ?? 120);
const skipDownload = Boolean(flags["skip-download"]);
const keepWork = Boolean(flags["keep-work"]);
const verbose = Boolean(flags["verbose"]);
const outPath =
  typeof flags["out"] === "string" ? (flags["out"] as string) : defaultUnpackedExe();
const exeOverride = typeof flags["exe"] === "string" ? (flags["exe"] as string) : null;

function log(msg: string): void {
  console.info(`[unpack] ${msg}`);
}

function localAppData(): string {
  return process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
}

function readIniVersion(iniPath: string): string | null {
  if (!existsSync(iniPath)) return null;
  const buf = readFileSync(iniPath);
  let text: string;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString("utf16le");
  } else if (buf.includes(0) && buf.length > 4) {
    text = buf.toString("utf16le");
  } else {
    text = buf.toString("utf8");
  }
  const m = text.match(/last_updated_version\s*=\s*(\d+\.\d+\.\d+\.\d+)/i);
  return m?.[1] ?? null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** %LOCALAPPDATA%\LINE\bin\<ver>\LINE.exe を解決 */
function detectInstalledLineExe(): string | null {
  const lineRoot = process.env["NEZU_LINE_ROOT"]?.trim() || join(localAppData(), "LINE");
  const binDir = join(lineRoot, "bin");
  if (!existsSync(binDir)) return null;

  const versions = readdirSync(binDir)
    .filter((name) => VERSION_RE.test(name))
    .filter((name) => existsSync(join(binDir, name, "LINE.exe")));
  if (versions.length === 0) return null;

  const iniVer = readIniVersion(join(lineRoot, "Data", "LINE.ini"));
  const version =
    iniVer && versions.includes(iniVer)
      ? iniVer
      : versions.sort(compareVersions).at(-1)!;

  return join(binDir, version, "LINE.exe");
}

function findUnlicenseExe(root: string): string | null {
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const name of readdirSync(cur)) {
      const p = join(cur, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (/^unlicense(\.exe)?$/i.test(name)) return p;
    }
  }
  return null;
}

async function ensureUnlicense(): Promise<string> {
  const existing = findUnlicenseExe(UNLICENSE_DIR);
  if (existing) {
    log(`unlicense 検出: ${existing}`);
    return existing;
  }
  if (skipDownload) {
    throw new Error(
      `unlicense がありません: ${UNLICENSE_DIR}\n` +
        `https://github.com/ergrelet/unlicense/releases から x64 zip を展開するか、--skip-download を外してください。`,
    );
  }

  mkdirSync(UNLICENSE_DIR, { recursive: true });
  const zipPath = join(UNLICENSE_DIR, UNLICENSE_ASSET);
  log(`unlicense をダウンロード中: ${UNLICENSE_URL}`);
  const res = await fetch(UNLICENSE_URL, {
    headers: { "User-Agent": "vyline-search-unpack" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  await Bun.write(zipPath, res);
  log(`展開中: ${zipPath}`);
  const expand = Bun.spawnSync({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${UNLICENSE_DIR}' -Force`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (expand.exitCode !== 0) {
    throw new Error(
      `zip 展開失敗:\n${expand.stderr?.toString() ?? ""}\n${expand.stdout?.toString() ?? ""}`,
    );
  }

  const found = findUnlicenseExe(UNLICENSE_DIR);
  if (!found) {
    throw new Error(`展開後も unlicense.exe が見つかりません: ${UNLICENSE_DIR}`);
  }
  log(`unlicense 準備完了: ${found}`);
  return found;
}

function listRunningLinePids(): number[] {
  const r = Bun.spawnSync({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `(Get-Process -Name LINE -ErrorAction SilentlyContinue).Id -join ','`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = (r.stdout?.toString() ?? "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function pickNewestUnpacked(dir: string, afterMs: number): string | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((n) => /^unpacked_.*\.exe$/i.test(n) || /^unpacked_/i.test(n))
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return statSync(p).mtimeMs >= afterMs - 2000;
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

async function main(): Promise<void> {
  const srcExe = exeOverride ?? detectInstalledLineExe();
  if (!srcExe || !existsSync(srcExe)) {
    throw new Error(
      [
        "LINE.exe が見つかりません。",
        "  --exe <path> で指定するか、Desktop LINE をインストールしてください。",
        `  既定探索: %LOCALAPPDATA%\\LINE\\bin\\<version>\\LINE.exe`,
      ].join("\n"),
    );
  }
  log(`対象: ${srcExe} (${(statSync(srcExe).size / 1024 / 1024).toFixed(1)} MB)`);

  const running = listRunningLinePids();
  if (running.length > 0) {
    log(
      `警告: LINE プロセスが稼働中です (pid: ${running.join(", ")})。` +
        `競合・誤 dump を避けるため、可能なら終了してから再実行してください。`,
    );
  }

  const unlicense = await ensureUnlicense();

  const workDir = join(DATA_DIR, "unpack-work");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // インストール先を汚さないようコピーしてから unpack
  const stagedExe = join(workDir, "LINE.exe");
  log(`作業コピー: ${stagedExe}`);
  copyFileSync(srcExe, stagedExe);

  const startedAt = Date.now();
  const cmd = [
    unlicense,
    stagedExe,
    `--timeout=${timeoutSec}`,
    ...(verbose ? ["--verbose"] : []),
  ];
  log(`実行: ${cmd.map((c) => (c.includes(" ") ? `"${c}"` : c)).join(" ")}`);
  log(`OEP 待ち timeout=${timeoutSec}s（LINE は重いので長め）`);

  const proc = Bun.spawnSync({
    cmd,
    cwd: workDir,
    env: {
      ...process.env,
      __COMPAT_LAYER: "RUNASINVOKER",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout?.toString() ?? "";
  const stderr = proc.stderr?.toString() ?? "";
  if (stdout.trim()) console.log(stdout.trimEnd());
  if (stderr.trim()) console.error(stderr.trimEnd());

  if (proc.exitCode !== 0) {
    throw new Error(
      [
        `unlicense が失敗しました (exit ${proc.exitCode})。`,
        "よくある原因:",
        "  - timeout 不足 → --timeout 180 など",
        "  - 既に LINE が起動中 → 終了して再実行",
        "  - Themida バージョン非対応 / OEP 未到達",
        `作業ディレクトリ: ${workDir}`,
      ].join("\n"),
    );
  }

  const dumped =
    pickNewestUnpacked(workDir, startedAt) ??
    (existsSync(join(workDir, "unpacked_LINE.exe"))
      ? join(workDir, "unpacked_LINE.exe")
      : null);

  if (!dumped || !existsSync(dumped)) {
    throw new Error(
      `dump 出力が見つかりません。${workDir} を確認してください。\n` +
        `期待: unpacked_LINE.exe`,
    );
  }

  mkdirSync(dirname(outPath), { recursive: true });
  if (existsSync(outPath)) rmSync(outPath);
  // 同一ボリュームなら rename、だめなら copy
  try {
    renameSync(dumped, outPath);
  } catch {
    copyFileSync(dumped, outPath);
  }

  const meta = {
    sourceExe: srcExe,
    unpackedExe: outPath,
    size: statSync(outPath).size,
    unpackedAt: new Date().toISOString(),
    unlicense: UNLICENSE_RELEASE,
    timeoutSec,
  };
  writeFileSync(
    join(DATA_DIR, "unpack-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );

  if (!keepWork) {
    rmSync(workDir, { recursive: true, force: true });
  } else {
    log(`作業ディレクトリを残しました: ${workDir}`);
  }

  log(`done -> ${outPath} (${(meta.size / 1024 / 1024).toFixed(1)} MB)`);
  log(`次: bun run find -- sendMessage --list-only`);
}

await main().catch((err) => {
  console.error(`[unpack] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
