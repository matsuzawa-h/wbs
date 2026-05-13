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
  font-size: 1.3rem;
}
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.2rem 1.4rem;
}
.card h2 {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
}
.card h3 {
  margin: 1.4rem 0 0.4rem;
  font-size: 0.95rem;
  color: #374151;
}
.muted {
  color: #6b7280;
  font-size: 0.92rem;
  margin: 0 0 1rem;
  line-height: 1.6;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.6rem 1.2rem;
  cursor: pointer;
  font: inherit;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn.primary:hover {
  background: #1d4ed8;
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
