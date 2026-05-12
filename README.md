# WBS Web

Web 版 WBS / ガントチャートアプリケーション。Excel 製の「工程マイルストーン」ツールを社内 LAN で利用可能な Web アプリへ移行するプロジェクト。

- **バックエンド**: NestJS (Node.js + TypeScript)
- **フロントエンド**: Vue 3 + TypeScript + Vite
- **データベース**: SQLite (better-sqlite3 + Drizzle ORM)
- **デプロイ**: Windows 11 上に Windows サービスとして常駐 (NSSM)
- **対象**: 社内 LAN 専用 (インターネット非公開)

## 要件

- Node.js 20 LTS 以上
- pnpm 9 以上 (`corepack enable` で有効化可能)

## クイックスタート（開発）

```powershell
cd c:\Git\WBS\WbsWeb
pnpm install
pnpm --filter @wbs/api drizzle-kit migrate   # 開発用 SQLite テーブル作成

# ターミナル1: API
pnpm dev:api                                  # http://localhost:5000

# ターミナル2: フロント
pnpm dev:web                                  # http://localhost:5173
```

## ディレクトリ構成

```
.
├── packages/
│   ├── api/   ← NestJS バックエンド
│   └── web/   ← Vue 3 フロントエンド
└── docs/
    └── specification.html   ← 正式仕様書 (実装後に追加)
```

## ドキュメント

- 仕様書: [docs/specification.html](docs/specification.html)（実装完了後に追加）

## ライセンス

社内利用のみ (UNLICENSED)。
