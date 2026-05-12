<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useHolidaysStore } from '@/stores/holidays';
import { japaneseHolidaysForYear } from '@/utils/japanese-holidays';

const holidays = useHolidaysStore();

// Single add
const newDate = ref('');
const newName = ref('');
const addError = ref<string | null>(null);

// Range bulk
const rangeStart = ref('');
const rangeEnd = ref('');
const rangeName = ref('');
const rangeError = ref<string | null>(null);

// CSV
const csvText = ref('');
const csvError = ref<string | null>(null);

// Preset
const presetYear = ref(new Date().getFullYear());

// Status messages
const statusMessage = ref<string | null>(null);

onMounted(() => {
  holidays.fetchAll(true);
});

function formatBadge(d: string): string {
  // d = YYYY-MM-DD -> M/D(曜)
  const [y, m, day] = d.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, day));
  const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getUTCDay()];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${dow})`;
}

async function onAddSingle(): Promise<void> {
  addError.value = null;
  if (!newDate.value) {
    addError.value = '日付を入力してください';
    return;
  }
  try {
    await holidays.add(newDate.value, newName.value.trim() || null);
    newDate.value = '';
    newName.value = '';
    statusMessage.value = '休日を追加しました';
    setTimeout(() => (statusMessage.value = null), 3000);
  } catch (e: unknown) {
    addError.value = extractMessage(e) ?? '追加に失敗しました';
  }
}

async function onAddRange(): Promise<void> {
  rangeError.value = null;
  if (!rangeStart.value || !rangeEnd.value) {
    rangeError.value = '開始日と終了日を入力してください';
    return;
  }
  if (rangeStart.value > rangeEnd.value) {
    rangeError.value = '開始日は終了日以前である必要があります';
    return;
  }
  const items = enumerateDates(rangeStart.value, rangeEnd.value).map((date) => ({
    date,
    name: rangeName.value.trim() || null,
  }));
  if (items.length > 366) {
    rangeError.value = '1度に登録できるのは 366 日までです';
    return;
  }
  try {
    const r = await holidays.bulkAdd(items);
    rangeStart.value = '';
    rangeEnd.value = '';
    rangeName.value = '';
    statusMessage.value = `${r.inserted} 件追加（${r.skipped} 件は既に登録済み）`;
    setTimeout(() => (statusMessage.value = null), 4000);
  } catch (e: unknown) {
    rangeError.value = extractMessage(e) ?? '範囲一括追加に失敗しました';
  }
}

async function onImportCsv(): Promise<void> {
  csvError.value = null;
  const lines = csvText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) {
    csvError.value = 'CSV データが空です';
    return;
  }
  const items: Array<{ date: string; name: string | null }> = [];
  const errors: string[] = [];
  for (const [i, line] of lines.entries()) {
    const cols = line.split(',').map((c) => c.trim());
    const date = cols[0];
    const name = cols[1] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`${i + 1} 行目: 日付 '${date}' が YYYY-MM-DD ではありません`);
      continue;
    }
    items.push({ date, name: name || null });
  }
  if (errors.length > 0) {
    csvError.value = errors.slice(0, 5).join(' / ');
    return;
  }
  if (items.length > 1000) {
    csvError.value = '1度に取り込める行数は 1000 まで';
    return;
  }
  try {
    const r = await holidays.bulkAdd(items);
    csvText.value = '';
    statusMessage.value = `${r.inserted} 件取り込み（${r.skipped} 件は重複でスキップ）`;
    setTimeout(() => (statusMessage.value = null), 4000);
  } catch (e: unknown) {
    csvError.value = extractMessage(e) ?? 'CSV 取り込みに失敗しました';
  }
}

async function onAddPreset(): Promise<void> {
  const year = Number(presetYear.value);
  if (!Number.isFinite(year) || year < 1980 || year > 2099) {
    statusMessage.value = '年は 1980〜2099 で指定してください';
    return;
  }
  const items = japaneseHolidaysForYear(year).map((h) => ({ date: h.date, name: h.name }));
  try {
    const r = await holidays.bulkAdd(items);
    statusMessage.value = `${year} 年の祝日を ${r.inserted} 件追加（${r.skipped} 件は既に登録済み）`;
    setTimeout(() => (statusMessage.value = null), 4000);
  } catch (e: unknown) {
    statusMessage.value = extractMessage(e) ?? 'プリセット適用に失敗しました';
  }
}

async function onRemove(id: number, label: string): Promise<void> {
  if (!window.confirm(`「${label}」を削除します。よろしいですか？`)) return;
  await holidays.remove(id);
}

async function onUpdateName(id: number, current: string | null): Promise<void> {
  const v = window.prompt('名前を変更', current ?? '');
  if (v === null) return;
  await holidays.update(id, { name: v.trim() || null });
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds));
  const stop = new Date(Date.UTC(ye, me - 1, de));
  while (cur.getTime() <= stop.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function extractMessage(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const anyE = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = anyE.response?.data?.message;
  if (Array.isArray(m)) return m.join(' / ');
  if (typeof m === 'string') return m;
  return anyE.message ?? null;
}

const groupedByYear = computed(() => {
  const map = new Map<string, typeof holidays.items.value>();
  for (const h of holidays.items.value) {
    const y = h.date.slice(0, 4);
    const arr = map.get(y) ?? [];
    arr.push(h);
    map.set(y, arr);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
});
</script>

<template>
  <div class="holiday-page">
    <header class="page-header">
      <h2 class="title">休日マスタ</h2>
      <p class="lead">
        登録した休日は全プロジェクトのガントに反映され、平日換算の計算からも除外されます。
      </p>
    </header>

    <div v-if="statusMessage" class="status-message">{{ statusMessage }}</div>

    <section class="card">
      <h3>1 件ずつ追加</h3>
      <form class="row-form" @submit.prevent="onAddSingle">
        <input v-model="newDate" type="date" required />
        <input v-model="newName" type="text" placeholder="名前（任意 例: 元日）" />
        <button class="btn primary" type="submit">追加</button>
      </form>
      <p v-if="addError" class="error">{{ addError }}</p>
    </section>

    <section class="card">
      <h3>範囲一括追加</h3>
      <form class="row-form" @submit.prevent="onAddRange">
        <input v-model="rangeStart" type="date" required />
        <span class="sep">〜</span>
        <input v-model="rangeEnd" type="date" required />
        <input v-model="rangeName" type="text" placeholder="名前（任意 例: 夏季休業）" />
        <button class="btn primary" type="submit">範囲追加</button>
      </form>
      <p class="hint">
        指定範囲内の全日付（土日含む）を休日として登録します。既に登録済みの日付はスキップされます。
      </p>
      <p v-if="rangeError" class="error">{{ rangeError }}</p>
    </section>

    <section class="card">
      <h3>日本の祝日プリセット</h3>
      <form class="row-form" @submit.prevent="onAddPreset">
        <input v-model.number="presetYear" type="number" min="1980" max="2099" />
        <span class="hint inline">年の祝日を一括登録</span>
        <button class="btn primary" type="submit">登録</button>
      </form>
      <p class="hint">
        元日 / 成人の日 / 春分の日 / 海の日 / 山の日 / 敬老の日 / 秋分の日 ほか 16
        件を生成します（振替休日は含まれません）。
      </p>
    </section>

    <section class="card">
      <h3>CSV 取り込み</h3>
      <p class="hint">1 行 1 件、<code>YYYY-MM-DD,名前</code> 形式。名前は省略可（カンマ区切り）。</p>
      <form @submit.prevent="onImportCsv">
        <textarea
          v-model="csvText"
          rows="6"
          placeholder="例:
2026-01-01,元日
2026-01-02
2026-05-03,憲法記念日"
        ></textarea>
        <button class="btn primary" type="submit">取り込み</button>
      </form>
      <p v-if="csvError" class="error">{{ csvError }}</p>
    </section>

    <section class="card list-card">
      <h3>登録一覧 ({{ holidays.items.length }} 件)</h3>
      <p v-if="holidays.loading" class="muted">読込中…</p>
      <p v-else-if="holidays.items.length === 0" class="muted">休日は登録されていません</p>
      <div v-else class="year-groups">
        <div v-for="[year, list] in groupedByYear" :key="year" class="year-group">
          <h4>{{ year }} 年（{{ list.length }} 件）</h4>
          <ul class="list">
            <li v-for="h in list" :key="h.id" class="list-item">
              <span class="date-badge">{{ formatBadge(h.date) }}</span>
              <span class="date-raw">{{ h.date }}</span>
              <span class="name">{{ h.name || '—' }}</span>
              <span class="actions">
                <button class="btn" type="button" @click="onUpdateName(h.id, h.name)">名称</button>
                <button
                  class="btn danger"
                  type="button"
                  @click="onRemove(h.id, h.name ?? h.date)"
                >削除</button>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.holiday-page {
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  gap: 0.9rem;
}
.page-header h2 {
  margin: 0;
  font-size: 1.2rem;
}
.page-header .lead {
  margin: 0.3rem 0 0;
  color: #4b5563;
  font-size: 0.88rem;
}
.status-message {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.88rem;
}
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem 1.1rem;
}
.card h3 {
  margin: 0 0 0.6rem;
  font-size: 0.98rem;
}
.row-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}
.row-form input[type='text'] {
  flex: 1 1 200px;
}
.row-form input[type='date'] {
  width: 150px;
}
.row-form input[type='number'] {
  width: 90px;
}
.sep {
  color: #6b7280;
}
.hint {
  color: #6b7280;
  font-size: 0.8rem;
  margin: 0.4rem 0 0;
}
.hint.inline {
  margin: 0;
}
textarea {
  width: 100%;
  font-family: 'Consolas', 'Yu Gothic UI Mono', monospace;
  font-size: 0.85rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  resize: vertical;
  margin-bottom: 0.4rem;
}
.error {
  color: #b91c1c;
  font-size: 0.85rem;
  margin: 0.4rem 0 0;
}
.muted {
  color: #6b7280;
}
.year-groups {
  display: grid;
  gap: 0.6rem;
}
.year-group h4 {
  margin: 0.5rem 0 0.3rem;
  font-size: 0.9rem;
  color: #475569;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
.list-item {
  display: grid;
  grid-template-columns: 100px 110px 1fr auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.35rem 0.5rem;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
  font-size: 0.88rem;
}
.date-badge {
  display: inline-block;
  background: #fee2e2;
  color: #991b1b;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
}
.date-raw {
  color: #6b7280;
  font-family: 'Consolas', monospace;
  font-size: 0.82rem;
}
.name {
  color: #1f2937;
}
.actions {
  display: flex;
  gap: 0.3rem;
}
.actions .btn {
  padding: 0.2rem 0.5rem;
  font-size: 0.78rem;
}
</style>
