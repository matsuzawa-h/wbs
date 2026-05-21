<script setup lang="ts">
function downloadXla(): void {
  // No fetch wrapper — let the browser drive the download via the server's
  // Content-Disposition header.
  const a = document.createElement('a');
  a.href = '/api/downloads/km_module.xla';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
</script>

<template>
  <div class="page">
    <h1>ダウンロード</h1>
    <section class="card">
      <h2>km_module.xla（Excel アドイン）</h2>
      <p class="muted">
        WBS Web から出力した Excel ファイルでガント描画・各種ボタンを動かすために
        必要な Excel アドインです。初回 1 回だけ Excel に登録してください。
      </p>
      <button class="btn primary" type="button" @click="downloadXla">
        📥 km_module.xla をダウンロード
      </button>

      <h3>Excel への登録手順</h3>
      <ol class="steps">
        <li>上のボタンから <code>km_module.xla</code> をダウンロードして任意のフォルダに保存</li>
        <li>Excel を開き、<strong>ファイル → オプション → アドイン</strong></li>
        <li>下部の「管理: Excel アドイン」横の「<strong>設定</strong>」ボタンをクリック</li>
        <li>「<strong>参照</strong>」ボタンから保存した <code>km_module.xla</code> を選択</li>
        <li>「<strong>km_module</strong>」にチェックが入っていることを確認 → OK</li>
        <li>Excel を一度終了し、再度起動</li>
      </ol>

      <h3>動作確認</h3>
      <ol class="steps">
        <li>WBS Web のプロジェクトを開き、「Excel 出力」をクリック</li>
        <li>ダウンロードされた <code>.xls</code> を Excel で開く</li>
        <li>マクロを「有効化」</li>
        <li>右側のガント領域にバーが自動描画されれば登録完了です</li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
}
.page h1 {
  margin: 0 0 1rem;
  font-size: 1.45rem;
  font-weight: 700;
  color: var(--c-text);
  letter-spacing: 0.005em;
}
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 1.3rem 1.5rem;
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--t-base) var(--easing);
}
.card:hover {
  box-shadow: var(--shadow);
}
.card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--c-text);
  padding-bottom: 0.55rem;
  border-bottom: 1px solid var(--c-border);
}
.card h3 {
  margin: 1.4rem 0 0.4rem;
  font-size: 0.98rem;
  color: var(--c-text);
  font-weight: 700;
}
.muted {
  color: var(--c-text-muted);
  font-size: 0.92rem;
  margin: 0 0 1rem;
  line-height: 1.6;
}
.btn {
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  border-radius: var(--r);
  padding: 0.6rem 1.2rem;
  cursor: pointer;
  font: inherit;
  box-shadow: var(--shadow-sm);
  transition: background var(--t-base) var(--easing),
    border-color var(--t-base) var(--easing),
    box-shadow var(--t-base) var(--easing);
}
.btn:hover {
  background: var(--c-surface-2);
  box-shadow: var(--shadow);
}
.btn.primary {
  background: var(--c-accent);
  color: #fff;
  border-color: var(--c-accent);
}
.btn.primary:hover {
  background: var(--c-accent-strong);
  border-color: var(--c-accent-strong);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28);
}
.steps {
  padding-left: 1.4rem;
  margin: 0.4rem 0 0;
  line-height: 1.8;
  font-size: 0.92rem;
}
.steps li {
  margin-bottom: 0.2rem;
}
code {
  background: #f1f5f9;
  border: 1px solid #e5e7eb;
  border-radius: 3px;
  padding: 0.05rem 0.35rem;
  font-family: "Menlo", "Consolas", monospace;
  font-size: 0.85em;
}
</style>
