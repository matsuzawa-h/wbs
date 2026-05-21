// シンプルな手書き Markdown レンダラ。
// 安全な HTML を返す。サポート範囲:
//   # 見出し1〜###### 見出し6
//   - / * / 1. リスト（単層、ネスト非対応）
//   > 引用
//   --- / *** / ___ で水平線
//   ```code block``` （言語タグは無視）
//   インライン: **bold** / *italic* / _italic_ / `code` / [text](url) / 自動リンク
//
// XSS 防御:
//   1. 入力は最初に HTML エスケープしてから組み立てる。
//   2. リンクの URL は http / https / mailto / # のみ許可（javascript: は弾く）。
//   3. 出力に <script>, <iframe> など危険要素は一切生成しない（全タグは固定）。
// テーブル/画像/タスクリストは未サポート（簡易仕様）。要望があれば拡張。

type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'codeblock'; code: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'hr' };

const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const ULIST_RE = /^\s*[-*]\s+(.*)$/;
const OLIST_RE = /^\s*\d+\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```/;

// プレースホルダ用の Unicode 私用領域文字。ユーザ入力に紛れない区切り。
const HOLDER_OPEN = "\uE000";
const HOLDER_CLOSE = "\uE001";

export function renderMarkdown(source: string): string {
  if (!source) return '';
  const blocks = parseBlocks(source.replace(/\r\n?/g, '\n'));
  return blocks.map(renderBlock).join('\n');
}

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 空行: 区切りとして読み飛ばし
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    // コードブロック ``` ... ```
    if (FENCE_RE.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      // 閉じフェンスを消費（無くても EOF で終わる）
      if (i < lines.length) i += 1;
      blocks.push({ type: 'codeblock', code: code.join('\n') });
      continue;
    }
    // 水平線
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }
    // 見出し
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = h[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, text: h[2].trim() });
      i += 1;
      continue;
    }
    // リスト (ul/ol)
    const ulm = ULIST_RE.exec(line);
    const olm = OLIST_RE.exec(line);
    if (ulm || olm) {
      const ordered = !!olm;
      const items: string[] = [];
      const re = ordered ? OLIST_RE : ULIST_RE;
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // 引用
    if (BLOCKQUOTE_RE.test(line)) {
      const qlines: string[] = [];
      while (i < lines.length) {
        const m = BLOCKQUOTE_RE.exec(lines[i]);
        if (!m) break;
        qlines.push(m[1]);
        i += 1;
      }
      blocks.push({ type: 'blockquote', lines: qlines });
      continue;
    }
    // 段落: 空行/他ブロックまで連結
    const plines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const nxt = lines[i];
      if (
        nxt.trim() === '' ||
        FENCE_RE.test(nxt) ||
        HR_RE.test(nxt) ||
        HEADING_RE.test(nxt) ||
        ULIST_RE.test(nxt) ||
        OLIST_RE.test(nxt) ||
        BLOCKQUOTE_RE.test(nxt)
      ) {
        break;
      }
      plines.push(nxt);
      i += 1;
    }
    blocks.push({ type: 'paragraph', lines: plines });
  }
  return blocks;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${block.lines.map(renderInline).join('<br>')}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((t) => `<li>${renderInline(t)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'codeblock':
      // コードブロック内はインライン処理を一切しない。エスケープのみ。
      return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
    case 'blockquote':
      return `<blockquote>${block.lines.map((l) => renderInline(l)).join('<br>')}</blockquote>`;
    case 'hr':
      return '<hr>';
  }
}

// インライン変換: エスケープ → コード → リンク → 自動リンク → 強調。
// `code` を最初に処理することで、コード内の **bold** などを無効化する。
function renderInline(text: string): string {
  // プレースホルダはユーザ入力に紛れない Unicode 私用領域文字で挟む。
  type Holder = { token: string; html: string };
  const holders: Holder[] = [];
  const push = (html: string): string => {
    const token = `${HOLDER_OPEN}${holders.length}${HOLDER_CLOSE}`;
    holders.push({ token, html });
    return token;
  };

  // 1) inline code `…`
  let working = text.replace(/`([^`\n]+)`/g, (_m, c) => push(`<code>${escapeHtml(c)}</code>`));

  // 2) [text](url) リンク
  working = working.replace(
    /\[([^\]\n]+)\]\(([^\s)\n]+)\)/g,
    (_m, label, url) => {
      const safe = safeUrl(url);
      if (!safe) return push(`[${escapeHtml(label)}](${escapeHtml(url)})`);
      return push(
        `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
      );
    },
  );

  // 3) 自動リンク (http/https/...)
  working = working.replace(
    /(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/g,
    (m) => {
      const safe = safeUrl(m);
      if (!safe) return escapeHtml(m);
      return push(
        `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m)}</a>`,
      );
    },
  );

  // 4) 残りはエスケープ（プレースホルダは私用領域文字なので影響なし）
  working = escapeHtml(working);

  // 5) **bold** と *italic* / _italic_
  working = working.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  working = working.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  working = working.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');

  // 6) プレースホルダを実体に戻す
  for (const h of holders) {
    working = working.replace(h.token, h.html);
  }
  return working;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// URL を許可リスト方式で検証。javascript: / data: 等は弾く。
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}
