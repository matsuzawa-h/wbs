<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';
import { useOrganizationsStore } from '@/stores/organizations';
import MarkdownView from '@/components/MarkdownView.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import type { Project, ProjectDashboard, ProjectStatus } from '@/types';

const props = defineProps<{ projectId: number }>();
const router = useRouter();
const projectsStore = useProjectsStore();
const orgs = useOrganizationsStore();

const project = ref<Project | null>(null);
const dashboard = ref<ProjectDashboard | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

// description 編集モード
const editing = ref(false);
const descDraft = ref('');
const saving = ref(false);
const flash = ref<string | null>(null);

const STATUS_OPTIONS: { value: ProjectStatus; label: string; cls: string }[] = [
  { value: 'planning', label: '計画中', cls: 'st-plan' },
  { value: 'active', label: '進行中', cls: 'st-active' },
  { value: 'on_hold', label: '保留', cls: 'st-hold' },
  { value: 'completed', label: '完了', cls: 'st-done' },
  { value: 'cancelled', label: '中止', cls: 'st-cancel' },
];
function statusMeta(s: ProjectStatus): { label: string; cls: string } {
  return STATUS_OPTIONS.find((o) => o.value === s) ?? { label: s, cls: '' };
}

async function reload(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [p, d] = await Promise.all([
      projectsStore.fetchById(props.projectId),
      projectsStore.fetchDashboard(props.projectId),
    ]);
    project.value = p;
    dashboard.value = d;
    descDraft.value = p.description ?? '';
  } catch (e: any) {
    error.value = e?.message ?? '読込に失敗しました';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await orgs.fetchAll();
  await reload();
});

// projectId 変更（ルーター遷移）で再読込
watch(() => props.projectId, reload);

function startEdit(): void {
  descDraft.value = project.value?.description ?? '';
  editing.value = true;
}
function cancelEdit(): void {
  descDraft.value = project.value?.description ?? '';
  editing.value = false;
}
async function saveDescription(): Promise<void> {
  if (!project.value) return;
  saving.value = true;
  try {
    project.value = await projectsStore.updateOverview(project.value.id, {
      description: descDraft.value.trim() || null,
    });
    editing.value = false;
    showFlash('概要を保存しました');
  } catch (e: any) {
    error.value = e?.message ?? '保存に失敗しました';
  } finally {
    saving.value = false;
  }
}

async function onStatusChange(e: Event): Promise<void> {
  if (!project.value) return;
  const next = (e.target as HTMLSelectElement).value as ProjectStatus;
  saving.value = true;
  try {
    project.value = await projectsStore.updateOverview(project.value.id, {
      status: next,
    });
    showFlash('状態を更新しました');
  } catch (err: any) {
    error.value = err?.message ?? '更新に失敗しました';
  } finally {
    saving.value = false;
  }
}

function showFlash(msg: string): void {
  flash.value = msg;
  setTimeout(() => (flash.value = null), 2000);
}

function openGantt(): void {
  router.push({ name: 'gantt', params: { projectId: props.projectId } });
}
function openManhours(): void {
  router.push({ name: 'project-manhours', params: { projectId: props.projectId } });
}
function openTask(taskId: number): void {
  // ガント画面に遷移してそのタスクを選択。現状はガント画面で
  // クエリパラメタによる自動スクロールは無いので、シンプルに遷移のみ。
  router.push({ name: 'gantt', params: { projectId: props.projectId }, query: { task: taskId } });
}

// progress バーの色: 75%↑ 緑 / 40%↑ 黄 / それ未満 グレー
function progressClass(p: number): string {
  if (p >= 75) return 'p-good';
  if (p >= 40) return 'p-mid';
  return 'p-low';
}

// 期日強調: 今日より前 = 赤, 7日以内 = 黄
function endDateClass(d: string | null): string {
  if (!d) return '';
  const today = new Date().toISOString().slice(0, 10);
  if (d < today) return 'd-over';
  const dt = new Date(d + 'T00:00:00Z').getTime();
  const now = new Date(today + 'T00:00:00Z').getTime();
  if ((dt - now) / 86_400_000 <= 7) return 'd-soon';
  return '';
}

const orgPath = computed(() => {
  if (!project.value || project.value.organizationId === null) return '';
  return orgs.pathOf(project.value.organizationId);
});
</script>

<template>
  <div class="ov-page">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading && !project" class="muted">読込中…</p>

    <template v-if="project">
      <!-- Header card -->
      <section class="hero">
        <div class="hero-top">
          <h1 class="title">
            <span v-if="project.isProvisional === 1" class="tag prov">仮</span>
            {{ project.name }}
            <span v-if="project.projectCode" class="muted code">({{ project.projectCode }})</span>
          </h1>
          <div class="status-box">
            <label class="status-label">状態</label>
            <select
              :value="project.status"
              :disabled="saving"
              class="status-select"
              :class="statusMeta(project.status).cls"
              @change="onStatusChange"
            >
              <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </div>
        </div>
        <dl class="meta-grid">
          <div><dt>顧客</dt><dd>{{ project.customerName ?? '—' }}</dd></div>
          <div><dt>組織</dt><dd>{{ orgPath || '—' }}</dd></div>
          <div v-if="dashboard">
            <dt>期間（WBS から集計）</dt>
            <dd>
              {{ dashboard.plannedStartDate ?? '—' }} 〜 {{ dashboard.plannedEndDate ?? '—' }}
            </dd>
          </div>
          <div v-if="dashboard">
            <dt>メンバー</dt>
            <dd>{{ dashboard.memberCount }} 名</dd>
          </div>
        </dl>
        <div class="hero-actions">
          <button class="btn primary" type="button" @click="openGantt">📊 ガント／WBS</button>
          <button class="btn" type="button" @click="openManhours">⏱ 案件別工数</button>
        </div>
      </section>

      <p v-if="flash" class="flash">{{ flash }}</p>

      <div class="grid">
        <!-- 概要 -->
        <section class="card">
          <header class="card-header">
            <h2>概要</h2>
            <button v-if="!editing" class="btn small" type="button" @click="startEdit">編集</button>
          </header>
          <div v-if="!editing" class="desc">
            <MarkdownView v-if="project.description" :source="project.description" />
            <p v-else class="muted">概要はまだ登録されていません。「編集」で記入できます。</p>
          </div>
          <div v-else class="desc-edit">
            <MarkdownEditor
              v-model="descDraft"
              :maxlength="4000"
              :rows="12"
              placeholder="このプロジェクトの目的・スコープ・前提条件・関係者などを Markdown で記述できます。&#10;# 見出し / - 箇条書き / **太字** / `code` / [リンク](url)"
            />
            <div class="desc-actions">
              <span class="muted small">{{ descDraft.length }} / 4000</span>
              <button class="btn" type="button" :disabled="saving" @click="cancelEdit">キャンセル</button>
              <button class="btn primary" type="button" :disabled="saving" @click="saveDescription">保存</button>
            </div>
          </div>
        </section>

        <!-- KPI ダッシュボード -->
        <section v-if="dashboard" class="card">
          <header class="card-header">
            <h2>ダッシュボード</h2>
          </header>
          <div class="kpi-row">
            <div class="kpi-box">
              <span class="kpi-label">タスク総数</span>
              <span class="kpi-val">{{ dashboard.taskCounts.total }}</span>
            </div>
            <div class="kpi-box ok">
              <span class="kpi-label">完了</span>
              <span class="kpi-val">{{ dashboard.taskCounts.completed }}</span>
            </div>
            <div class="kpi-box act">
              <span class="kpi-label">進行中</span>
              <span class="kpi-val">{{ dashboard.taskCounts.inProgress }}</span>
            </div>
            <div class="kpi-box late">
              <span class="kpi-label">遅延</span>
              <span class="kpi-val">{{ dashboard.taskCounts.late }}</span>
            </div>
            <div class="kpi-box">
              <span class="kpi-label">未着手</span>
              <span class="kpi-val">{{ dashboard.taskCounts.notStarted }}</span>
            </div>
          </div>

          <div class="bar-wrap">
            <span class="muted small">進捗率（葉タスク平均）: {{ dashboard.averageProgress }}%</span>
            <div class="bar">
              <div
                class="bar-fill"
                :class="progressClass(dashboard.averageProgress)"
                :style="{ width: dashboard.averageProgress + '%' }"
              ></div>
            </div>
          </div>

          <div class="kpi-row">
            <div class="kpi-box">
              <span class="kpi-label">予定工数</span>
              <span class="kpi-val">{{ dashboard.hours.planned.toFixed(1) }} h</span>
            </div>
            <div class="kpi-box">
              <span class="kpi-label">実績工数</span>
              <span class="kpi-val">{{ dashboard.hours.actual.toFixed(1) }} h</span>
            </div>
            <div class="kpi-box" :class="{ over: dashboard.hours.remaining < 0 }">
              <span class="kpi-label">残（予定−実績）</span>
              <span class="kpi-val">{{ dashboard.hours.remaining.toFixed(1) }} h</span>
            </div>
          </div>
        </section>

        <!-- 期限近いタスク -->
        <section v-if="dashboard" class="card full">
          <header class="card-header">
            <h2>期日が近い未完了タスク</h2>
            <span class="muted small">完了していない & 終了日あり、終了日昇順 Top 5</span>
          </header>
          <table v-if="dashboard.upcomingTasks.length > 0" class="up-table">
            <thead>
              <tr>
                <th>終了日</th>
                <th>タスク</th>
                <th>担当</th>
                <th class="num">進捗</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in dashboard.upcomingTasks"
                :key="t.id"
                class="row-link"
                @click="openTask(t.id)"
              >
                <td class="date" :class="endDateClass(t.endDate)">{{ t.endDate ?? '—' }}</td>
                <td class="tname">{{ t.name }}</td>
                <td>{{ t.assigneeName ?? '—' }}</td>
                <td class="num">{{ t.progress }}%</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">期日が登録された未完了タスクはありません。</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ov-page { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
.muted { color: #6b7280; font-size: 0.88rem; }
.muted.small { font-size: 0.78rem; }
.error { color: #b91c1c; background: #fef2f2; padding: 0.5rem 0.8rem; border-radius: 4px; margin: 0; }
.flash { color: #047857; background: #ecfdf5; padding: 0.4rem 0.7rem; border-radius: 4px; margin: 0; font-size: 0.88rem; }

/* Hero */
.hero {
  background:
    radial-gradient(120% 200% at 0% 0%, rgba(96, 165, 250, 0.08), transparent 50%),
    linear-gradient(180deg, #fbfbff 0%, #eef2fb 100%);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 1.1rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  box-shadow: var(--shadow);
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, #3b82f6, #2563eb 50%, #1d4ed8);
}
.hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.title { margin: 0; font-size: 1.55rem; font-weight: 700; color: #1e3a8a; display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; letter-spacing: 0.005em; }
.title .code { font-family: 'Cascadia Mono', 'Consolas', 'Menlo', monospace; font-size: 0.9rem; color: var(--c-text-muted); }
.tag.prov { background: #fef3c7; color: #92400e; padding: 0.1rem 0.5rem; border-radius: var(--r-sm); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; }

.status-box { display: inline-flex; align-items: center; gap: 0.5rem; }
.status-label { font-size: 0.85rem; color: #6b7280; }
.status-select { padding: 0.35rem 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; font-size: 0.88rem; font-weight: 600; }
.status-select.st-plan { background: #f3f4f6; color: #374151; }
.status-select.st-active { background: #dbeafe; color: #1e3a8a; }
.status-select.st-hold { background: #fef3c7; color: #92400e; }
.status-select.st-done { background: #dcfce7; color: #065f46; }
.status-select.st-cancel { background: #fee2e2; color: #b91c1c; }

.meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.6rem 1.2rem; margin: 0; }
.meta-grid div { display: flex; flex-direction: column; gap: 0.1rem; }
.meta-grid dt { font-size: 0.74rem; color: #6b7280; margin: 0; }
.meta-grid dd { margin: 0; font-size: 0.92rem; color: #1f2937; }

.hero-actions { display: flex; gap: 0.5rem; }

/* Cards */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 1rem 1.2rem;
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--t-base) var(--easing);
}
.card:hover { box-shadow: var(--shadow); }
.card.full { grid-column: 1 / -1; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; padding-bottom: 0.55rem; border-bottom: 1px solid var(--c-border); }
.card-header h2 { margin: 0; font-size: 1.02rem; color: var(--c-text); font-weight: 700; letter-spacing: 0.005em; }

.btn { border: 1px solid #d1d5db; background: #fff; border-radius: 5px; padding: 0.4rem 0.85rem; cursor: pointer; font-size: 0.88rem; }
.btn:hover { background: #f9fafb; }
.btn.small { padding: 0.25rem 0.55rem; font-size: 0.82rem; }
.btn.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn.primary:hover { background: #1d4ed8; }

/* Description */
.desc-text { white-space: pre-wrap; line-height: 1.6; margin: 0; font-size: 0.92rem; color: #1f2937; }
.desc-edit textarea { width: 100%; padding: 0.55rem 0.7rem; border: 1px solid #d1d5db; border-radius: 5px; font: inherit; font-size: 0.92rem; resize: vertical; }
.desc-actions { display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center; margin-top: 0.5rem; }

/* KPI */
.kpi-row { display: flex; gap: 0.7rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
.kpi-box {
  display: inline-flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem 0.95rem;
  background: var(--c-surface-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  min-width: 100px;
  box-shadow: var(--shadow-sm);
  transition: transform var(--t-base) var(--easing),
    box-shadow var(--t-base) var(--easing);
}
.kpi-box:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.kpi-label { font-size: 0.72rem; color: var(--c-text-muted); letter-spacing: 0.03em; font-weight: 500; }
.kpi-val { font-weight: 700; font-size: 1.25rem; font-variant-numeric: tabular-nums; color: var(--c-text); line-height: 1.1; }
.kpi-box.ok { background: #ecfdf5; border-color: #a7f3d0; }
.kpi-box.ok .kpi-val { color: #065f46; }
.kpi-box.act { background: #eff6ff; border-color: #bfdbfe; }
.kpi-box.act .kpi-val { color: #1e40af; }
.kpi-box.late { background: #fef2f2; border-color: #fecaca; }
.kpi-box.late .kpi-val { color: #991b1b; }
.kpi-box.over .kpi-val { color: #b91c1c; }

.bar-wrap { margin-bottom: 0.6rem; }
.bar { height: 10px; background: #f3f4f6; border-radius: 999px; overflow: hidden; margin-top: 0.25rem; }
.bar-fill { height: 100%; border-radius: 999px; transition: width 0.3s; }
.bar-fill.p-good { background: #10b981; }
.bar-fill.p-mid { background: #f59e0b; }
.bar-fill.p-low { background: #9ca3af; }

/* Upcoming */
.up-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.up-table th, .up-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #f1f5f9; text-align: left; }
.up-table th { background: #f8fafc; color: #475569; font-weight: 600; font-size: 0.82rem; }
.up-table tr.row-link { cursor: pointer; }
.up-table tr.row-link:hover td { background: #eef2ff; }
.up-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.up-table .date.d-over { color: #b91c1c; font-weight: 600; }
.up-table .date.d-soon { color: #b45309; font-weight: 600; }
.up-table .tname { color: #1f2937; }

@media (max-width: 800px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
