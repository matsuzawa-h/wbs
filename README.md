# WBS Web

Excel 製 WBS／ガント工程表（`テンプレートファイル.xls`）の社内 Web 化システム。
社内 LAN 内 1 台に常駐し、複数プロジェクトの工程・進捗・実績・担当・稼働見通しを
一元管理する。

- **バックエンド**: NestJS 10 (Node.js 22 LTS + TypeScript) / Express 4
- **フロントエンド**: Vue 3 (script setup) + TypeScript + Vite + Pinia + vue-router
- **データベース**: SQLite (better-sqlite3 + drizzle-orm + drizzle-kit)
- **ガント描画**: frappe-gantt（独自オーバーレイ：固定ヘッダ／今日線／週末・休日／レーン配置）
- **MCP**: `@rekog/mcp-nest`（Streamable HTTP, statelessMode）
- **常駐方式**: Windows 11 + タスクスケジューラ（システム起動時／失敗時リトライ）
- **対象**: 社内 LAN クローズド・無認証前提（インターネット非公開）

## 📚 ドキュメント

| 文書 | 内容 |
|---|---|
| [`docs/architecture.html`](docs/architecture.html) | アーキテクチャ設計書（構成・モジュール・配信経路・横断方針） |
| [`docs/database.html`](docs/database.html) | テーブル定義・ER 図・マイグレーション一覧・CRUD 図・主要処理 |
| [`docs/manual.html`](docs/manual.html) | 操作マニュアル（アプリ内 `/manual` でも配信） |
| [`docs/release.html`](docs/release.html) | リリース手順書（DEV `build-deploy-zip.bat` ／ PROD `release-prod.bat` 詳細含む） |

各 HTML はブラウザでダブルクリックして開けます。アプリ稼働中は
[`http://<サーバ>:5000/manual`](http://localhost:5000/manual) からも参照可能。

## 🚀 開発環境の立ち上げ

### 前提
- Node.js 22 LTS（本番と<strong>メジャー一致必須</strong> ※better-sqlite3 ネイティブ整合）
- pnpm 9 以上（`corepack enable` で有効化可能）

### 手順
```powershell
git clone https://github.com/matsuzawa-h/wbs.git c:\Git\WBS\WbsWeb
cd c:\Git\WBS\WbsWeb

# 1) 依存インストール
pnpm install

# 2) 開発用 SQLite のマイグレーション
pnpm --filter @wbs/api drizzle:migrate

# 3) 開発サーバ起動（2 ターミナル）
pnpm dev:api          # ターミナル 1 → http://localhost:5000
pnpm dev:web          # ターミナル 2 → http://localhost:5173  (/api → 5000 へプロキシ)
```

## 🏗️ プロジェクト構成

```
WbsWeb/
├── docs/                                  # 設計書・操作マニュアル（HTML 単体）
│   ├── architecture.html
│   ├── database.html
│   ├── manual.html
│   ├── release.html
│   └── screenshots/                       # マニュアル用スクリーンショット
├── packages/
│   ├── api/                               # NestJS バックエンド + 静的 SPA 配信
│   │   ├── src/
│   │   │   ├── db/                        # Drizzle スキーマ + migrations
│   │   │   ├── projects/   tasks/         # WBS コア（CRUD + 連動カスケード）
│   │   │   ├── personal-tasks/            # 個人タスク（WBS と非干渉）
│   │   │   ├── employees/  customers/     # 各マスタ
│   │   │   ├── organizations/             # 組織マスタ（自己参照階層）
│   │   │   ├── holidays/                  # 休日マスタ（営業日計算）
│   │   │   ├── excel/                     # Excel 入出力（BIFF 直書き、1000 行対応）
│   │   │   ├── manhours/                  # 稼働見通し（CSV 取込・バッチ履歴・前回比差分）
│   │   │   ├── help/  downloads/          # 操作手順／Excel アドイン配信
│   │   │   └── mcp/                       # MCP ツール群（REST と同一サービス層）
│   │   └── scripts/backup.js              # VACUUM INTO 無停止バックアップ
│   └── web/                               # Vue 3 SPA
│       └── src/
│           ├── pages/                     # LoginPage / ProjectListPage / ProjectOverviewPage /
│           │                              # GanttPage / ProjectManhoursPage / AssignmentsPage /
│           │                              # ManhoursSummaryPage / BatchListPage /
│           │                              # OrganizationPage / CustomerPage / EmployeePage /
│           │                              # HolidayPage / DownloadsPage / HelpPage
│           ├── components/                # GanttChart, TaskTable, ManhoursGrid, etc.
│           └── stores/                    # Pinia: currentUser / projects / tasks /
│                                          # employees / customers / organizations /
│                                          # holidays / projectMembers / manhours
├── build-deploy-zip.bat                   # DEV: ビルド → ZIP → 本番へ配置 → docs 同期
├── release-prod.bat                       # PROD: サービス停止 → 展開 → migrate → 起動
└── .gitattributes                         # *.bat / *.cmd を CRLF 固定
```

## 📦 本番デプロイ（Windows 11 / TG120286）

詳細は [`docs/release.html`](docs/release.html) 8.0 章を参照。要点のみ抜粋:

| 機 | スクリプト | 役割 |
|---|---|---|
| 開発機 | `build-deploy-zip.bat` | `pnpm install` → web/api ビルド → `pnpm --prod deploy` → tar zip → 本番の `\\TG120286\tmp\` へ転送 ＋ docs 同期 |
| 本番機（管理者 PowerShell） | `release-prod.bat` | サービス停止 → 標準 `tar` で長パス展開 → robocopy `/MIR` → `drizzle-kit migrate` → タスク起動 ＋ ログ `C:\AppsData\WbsWeb\logs\release_*.log` |

### 重要ディレクトリ

| 用途 | パス | 備考 |
|---|---|---|
| アプリ本体 | `C:\Apps\WbsWeb` | 毎回 `/MIR` で総入替（差分残さない） |
| 永続データ | `C:\AppsData\WbsWeb\` | DB・テンプレ・アドイン・docs。<strong>不可侵</strong> |
| 永続データ詳細 | `\wbs.db` / `\templates\テンプレートファイル.xls` / `\addins\km_module.xla` / `\docs\` | `release-prod.bat` の `/MIR` 対象外 |

### バックアップ
```powershell
# 無停止スナップショット（VACUUM INTO）。日次推奨。
cd C:\Apps\WbsWeb
$env:DB_PATH = "C:\AppsData\WbsWeb\wbs.db"
node packages/api/scripts/backup.js
# → C:\AppsData\WbsWeb\backups\wbs_YYYYMMDD_HHmmss.db
```

## 🔑 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `PORT` | `5000` | API のリッスンポート |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `DB_PATH` | `./data/wbs.db` | SQLite ファイル（本番 `C:\AppsData\WbsWeb\wbs.db`） |
| `XLS_TEMPLATE_PATH` | （プロジェクト直上を探索） | Excel 出力テンプレ。明示指定したい場合に設定 |
| `MANUAL_DOCS_DIR` | （`docs/` を探索） | 操作手順 HTML／スクショの読み込み元。本番は `C:\AppsData\WbsWeb\docs` |
| `MCP_TOKEN` | （未設定） | MCP 認証用。<strong>現状ガードはコメントアウト</strong>（社内 LAN 前提）。将来公開時に必須化予定 |
| `NODE_ENV` | `development` | `production` でログレベル下げ |

## 🧪 検証ガイド

機能追加・バグ修正は静的検証 ＋ Playwright E2E で確認する（[`CLAUDE.md`](../CLAUDE.md) 検証ルール参照）:

```powershell
# 型チェック
npx --no-install nest build                   # packages/api
npx --no-install vue-tsc --noEmit             # packages/web

# 単体テスト（API）
npx --no-install jest                         # packages/api

# 実画面確認は Playwright skill を使用（インストール禁止のため --no-install 必須）
```

## 🛡️ セキュリティ方針

> ⚠ **現状は無認証**（社内 LAN クローズド・HTTP 平文）。<br>
> Web API・MCP とも無認証で動作。MCP 認証ガード（`McpAuthGuard`）はコメントアウト済み。
> 将来インターネット接続や認証導入時は Web API と MCP を同じ仕組みで保護し、
> `MCP_TOKEN` を必須化する方針（[`docs/release.html`](docs/release.html) §11 セキュリティ方針）。

入力検証は class-validator（whitelist）、SQL は drizzle のパラメタライズ、
操作手順配信はファイル名検証で<strong>パストラバーサル遮断</strong>済み。

## ライセンス

社内利用のみ（UNLICENSED）。
