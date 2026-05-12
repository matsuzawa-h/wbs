# WBS Web

Web 版 WBS / ガントチャートアプリケーション。Excel 製の「工程マイルストーン」ツールを社内 LAN で利用可能な Web アプリへ移行するプロジェクト。

- **バックエンド**: NestJS 10 (Node.js 20 + TypeScript)
- **フロントエンド**: Vue 3 + TypeScript + Vite + Pinia
- **データベース**: SQLite (better-sqlite3 + Drizzle ORM)
- **ガント描画**: Frappe Gantt + vuedraggable
- **デプロイ**: Windows 11 上に NSSM で Windows サービスとして常駐
- **対象**: 社内 LAN 専用 (インターネット非公開)

## 📚 ドキュメント

- **[正式仕様書（HTML）](docs/specification.html)** ― ブラウザでダブルクリックして開いてください
- [プロジェクトプラン（開発時の議事録）](https://github.com/matsuzawa-h/wbs) ― ローカル `.claude/plans/` 配下に保管

## 🚀 クイックスタート（開発）

### 前提
- Node.js 20 LTS 以上
- pnpm 9 以上 (`corepack enable` で有効化可能)

### 手順

```powershell
# 1) クローン
git clone https://github.com/matsuzawa-h/wbs.git c:\Git\WBS\WbsWeb
cd c:\Git\WBS\WbsWeb

# 2) 依存インストール
pnpm install

# 3) 開発用 SQLite テーブル作成
pnpm --filter @wbs/api drizzle:migrate

# 4) 開発サーバ起動（2 ターミナル）
pnpm dev:api         # ターミナル 1 -> http://localhost:5000
pnpm dev:web         # ターミナル 2 -> http://localhost:5173
```

ブラウザで `http://localhost:5173` を開く。`/api/*` は自動的に API へプロキシされる。

## 🏗️ プロジェクト構成

```
.
├── docs/
│   └── specification.html        ← 正式仕様書（単体 HTML）
├── packages/
│   ├── api/                       ← NestJS バックエンド
│   │   ├── src/
│   │   │   ├── db/                ← Drizzle スキーマ + マイグレーション
│   │   │   ├── projects/          ← /api/projects CRUD
│   │   │   ├── tasks/             ← /api/tasks + 日付カスケード
│   │   │   └── assignees/         ← /api/assignees CRUD
│   │   └── scripts/backup.js      ← VACUUM INTO 安全バックアップ
│   └── web/                       ← Vue 3 フロントエンド
│       └── src/
│           ├── pages/             ← ProjectListPage, GanttPage
│           ├── components/        ← GanttChart, TaskTable
│           └── stores/            ← Pinia (projects/tasks/assignees)
└── scripts/                       ← Windows サービス管理 PowerShell
    ├── deploy.ps1
    ├── install-service.ps1
    ├── restart-service.ps1
    └── backup.ps1
```

## 📦 本番デプロイ（Windows 11）

### 事前準備（1 度だけ）
1. [Node.js 20 LTS](https://nodejs.org/) インストール
2. `corepack enable` で pnpm 有効化
3. [NSSM](https://nssm.cc/) を `C:\Tools\nssm.exe` に配置
4. 管理者 PowerShell を開く

### 初回デプロイ
```powershell
cd c:\Git\WBS\WbsWeb
git pull
.\scripts\deploy.ps1                 # AppDir=C:\Apps\WbsWeb, DataDir=C:\AppsData\WbsWeb
.\scripts\install-service.ps1        # 管理者 PowerShell が必須
```

### 2 回目以降の更新
```powershell
git pull
.\scripts\restart-service.ps1
```

### バックアップ
```powershell
.\scripts\backup.ps1
# → C:\AppsData\WbsWeb\backups\wbs_YYYYMMDD_HHmmss.db
```

詳細な手順とディレクトリ構成は **[仕様書](docs/specification.html)** の §7 を参照してください。

## 🧪 動作確認シナリオ

1. プロジェクトを 2 件作成 → 切替できる
2. 大項目 ⊃ 中項目 ⊃ 項目 の 3 階層タスクを登録
3. 金曜開始 + 期間 3 平日 → 終了日が翌週火曜（土日スキップ）
4. 中間タスクのバーを 3 平日後ろにドラッグ → 後続項目が +3 平日シフト、大項目/中項目の集約日付も再計算
5. 行を DnD で並べ替え → DB に sortOrder が保存される
6. ブラウザ再読み込み → 状態が永続化されている

## 🔑 環境変数

| 変数 | デフォルト | 用途 |
|---|---|---|
| `PORT` | `5000` | API のリッスンポート |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `DB_PATH` | `./data/wbs.db` | SQLite ファイルパス（本番では `C:\AppsData\WbsWeb\wbs.db`） |
| `NODE_ENV` | `development` | `production` でログレベル下げ |

## 🛣️ ロードマップ

- v0.1 (現在 / MVP): 基本ガント + 3 階層 + 日付カスケード + DnD
- v0.2: 祝日カレンダー、実績日入力
- v0.3: 共同編集 (Socket.IO)、標準工程テンプレ
- v0.4: 工数グラフ
- v0.5: MSProject XML インポート

詳細は [仕様書 §9](docs/specification.html#sec-future) を参照。

## ライセンス

社内利用のみ (UNLICENSED)。
