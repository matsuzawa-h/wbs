<script setup lang="ts">
import { computed, ref } from 'vue';

// Minimal shape the calendar needs. The page maps its filtered rows to this
// so the calendar stays decoupled from AssignmentRow / personal-task types.
export interface CalendarEvent {
  id: number;
  kind: 'wbs' | 'personal';
  name: string;
  projectName: string;
  startDate: string; // YYYY-MM-DD (both required; null-dated rows excluded)
  endDate: string; // YYYY-MM-DD
  statusBucket: string; // status.* bucket for colour
}

const props = defineProps<{
  events: CalendarEvent[];
  /** YYYY-MM-DD of "today" (UTC) for the highlight. */
  todayStr: string;
  /** date(YYYY-MM-DD) → holiday name. */
  holidayNames: Map<string, string>;
}>();

const emit = defineEmits<{
  (e: 'open', ev: CalendarEvent): void;
  (e: 'create', date: string): void;
  (e: 'move', payload: { ev: CalendarEvent; date: string }): void;
}>();

// --- Drag & drop (personal tasks only) ---
const dragging = ref<CalendarEvent | null>(null);
const dragOverDate = ref<string | null>(null);

function onBarDragStart(ev: CalendarEvent, e: DragEvent): void {
  if (ev.kind !== 'personal') return;
  dragging.value = ev;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    // Firefox needs data set for the drag to start.
    e.dataTransfer.setData('text/plain', String(ev.id));
  }
}
function onBarDragEnd(): void {
  dragging.value = null;
  dragOverDate.value = null;
}
function onCellDragOver(date: string): void {
  if (dragging.value) dragOverDate.value = date;
}
function onCellDrop(date: string): void {
  const ev = dragging.value;
  dragging.value = null;
  dragOverDate.value = null;
  if (ev && ev.kind === 'personal') emit('move', { ev, date });
}

// Click on empty cell space → create a personal task starting that day.
// Bars live in a separate overlay layer, so a bar click never reaches here;
// only the informational "他 N件" label is excluded.
function onDayClick(date: string, ev: MouseEvent): void {
  const tgt = ev.target as HTMLElement | null;
  if (tgt && tgt.closest('.overflow')) return;
  emit('create', date);
}

// --- date helpers (UTC, matching the rest of the codebase) ---
function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1));
}
function fmt(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(dt: Date, n: number): Date {
  const x = new Date(dt.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

const MAX_LANES = 3;
const HEADER_ZONE = 42; // px reserved for date number + holiday band
const LANE_H = 22; // px per bar lane

// Month anchor (1st of the shown month). Starts on today's month.
const anchor = ref<Date>(
  (() => {
    const t = parse(props.todayStr);
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  })(),
);

const monthLabel = computed(
  () => `${anchor.value.getUTCFullYear()}年 ${anchor.value.getUTCMonth() + 1}月`,
);

function prevMonth(): void {
  anchor.value = new Date(
    Date.UTC(anchor.value.getUTCFullYear(), anchor.value.getUTCMonth() - 1, 1),
  );
}
function nextMonth(): void {
  anchor.value = new Date(
    Date.UTC(anchor.value.getUTCFullYear(), anchor.value.getUTCMonth() + 1, 1),
  );
}
function goToday(): void {
  const t = parse(props.todayStr);
  anchor.value = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface DayCell {
  date: string;
  day: number;
  inMonth: boolean;
  weekend: boolean;
  holiday: string | null;
  isToday: boolean;
}

// 6 weeks max; start on the Sunday on/before the 1st, end on Saturday.
const weeks = computed<DayCell[][]>(() => {
  const first = anchor.value;
  const month = first.getUTCMonth();
  const gridStart = addDays(first, -first.getUTCDay()); // back to Sunday
  const out: DayCell[][] = [];
  let cur = gridStart;
  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const ds = fmt(cur);
      const dow = cur.getUTCDay();
      row.push({
        date: ds,
        day: cur.getUTCDate(),
        inMonth: cur.getUTCMonth() === month,
        weekend: dow === 0 || dow === 6,
        holiday: props.holidayNames.get(ds) ?? null,
        isToday: ds === props.todayStr,
      });
      cur = addDays(cur, 1);
    }
    out.push(row);
    // Stop after the week that contains the last day of the month.
    if (row[6].date >= fmt(addDays(new Date(Date.UTC(first.getUTCFullYear(), month + 1, 0)), 0)) &&
        cur.getUTCMonth() !== month) {
      if (out.length >= 4) break;
    }
  }
  // Trim trailing all-out-of-month weeks (keep 4–6).
  while (out.length > 4 && out[out.length - 1].every((d) => !d.inMonth)) {
    out.pop();
  }
  return out;
});

interface Segment {
  ev: CalendarEvent;
  colStart: number; // 0–6
  colEnd: number; // 0–6 inclusive
  lane: number;
}

// Per-week segment packing + per-day overflow counts.
const layout = computed(() => {
  const perWeek: Segment[][] = [];
  const overflow: Record<string, number> = {};

  for (const week of weeks.value) {
    const weekStart = parse(week[0].date);
    const weekEnd = parse(week[6].date);
    const segs: Segment[] = [];

    for (const ev of props.events) {
      const s = parse(ev.startDate);
      const e = parse(ev.endDate);
      const a = s.getTime() < e.getTime() ? s : e;
      const b = s.getTime() < e.getTime() ? e : s;
      if (b.getTime() < weekStart.getTime() || a.getTime() > weekEnd.getTime())
        continue;
      const cs = Math.max(
        0,
        Math.round((a.getTime() - weekStart.getTime()) / 86_400_000),
      );
      const ce = Math.min(
        6,
        Math.round((b.getTime() - weekStart.getTime()) / 86_400_000),
      );
      segs.push({ ev, colStart: cs, colEnd: ce, lane: -1 });
    }

    // Greedy lane packing: earliest start first, longer first on ties.
    segs.sort(
      (x, y) =>
        x.colStart - y.colStart ||
        y.colEnd - y.colStart - (x.colEnd - x.colStart),
    );
    const laneEnd: number[] = [];
    for (const sg of segs) {
      let placed = false;
      for (let i = 0; i < laneEnd.length; i++) {
        if (sg.colStart > laneEnd[i]) {
          sg.lane = i;
          laneEnd[i] = sg.colEnd;
          placed = true;
          break;
        }
      }
      if (!placed) {
        sg.lane = laneEnd.length;
        laneEnd.push(sg.colEnd);
      }
    }

    // Per-day overflow = events covering the day beyond MAX_LANES lanes.
    for (let col = 0; col < 7; col++) {
      const covering = segs.filter(
        (sg) => sg.colStart <= col && sg.colEnd >= col,
      );
      const hidden = covering.filter((sg) => sg.lane >= MAX_LANES).length;
      if (hidden > 0) overflow[week[col].date] = hidden;
    }

    perWeek.push(segs.filter((sg) => sg.lane < MAX_LANES));
  }
  return { perWeek, overflow };
});

const weekMinHeight = `${HEADER_ZONE + MAX_LANES * LANE_H + 18}px`;

function barStyle(s: Segment): Record<string, string> {
  return {
    left: `calc(${(s.colStart / 7) * 100}% + 3px)`,
    width: `calc(${((s.colEnd - s.colStart + 1) / 7) * 100}% - 6px)`,
    top: `${HEADER_ZONE + s.lane * LANE_H}px`,
    height: `${LANE_H - 3}px`,
  };
}

function barTitle(ev: CalendarEvent): string {
  const range =
    ev.startDate === ev.endDate
      ? ev.startDate
      : `${ev.startDate} 〜 ${ev.endDate}`;
  const tag = ev.kind === 'personal' ? '[個人] ' : `[${ev.projectName}] `;
  const hint =
    ev.kind === 'wbs'
      ? '（クリックでガントを開く）'
      : '（クリックで編集／ドラッグで日付変更）';
  return `${tag}${ev.name || '（名称未入力）'}　${range}\n${hint}`;
}
</script>

<template>
  <div class="cal">
    <div class="cal-toolbar">
      <button class="navbtn" type="button" title="前の月" @click="prevMonth">◀</button>
      <span class="month-label">{{ monthLabel }}</span>
      <button class="navbtn" type="button" title="次の月" @click="nextMonth">▶</button>
      <button class="todaybtn" type="button" @click="goToday">今日</button>
      <span class="legend">
        <span class="lg lg-wbs"></span>プロジェクト（状態色）
        <span class="lg lg-personal"><span class="lg-kt">個</span></span>個人タスク
      </span>
    </div>

    <div class="weekhead">
      <div
        v-for="(w, i) in WEEKDAYS"
        :key="w"
        class="wh"
        :class="{ sun: i === 0, sat: i === 6 }"
      >
        {{ w }}
      </div>
    </div>

    <div
      v-for="(week, wi) in weeks"
      :key="wi"
      class="week"
      :style="{ minHeight: weekMinHeight }"
    >
      <div class="daygrid">
        <div
          v-for="d in week"
          :key="d.date"
          class="daycell"
          :class="{
            outside: !d.inMonth,
            weekend: d.weekend || !!d.holiday,
            today: d.isToday,
            'drop-target': dragOverDate === d.date,
          }"
          title="クリックで個人タスクを新規作成"
          @click="onDayClick(d.date, $event)"
          @dragover.prevent="onCellDragOver(d.date)"
          @drop.prevent="onCellDrop(d.date)"
        >
          <div class="datenum">
            <span v-if="d.holiday" class="holname" :title="d.holiday">{{ d.holiday }}</span>
            <span class="num" :class="{ todaycircle: d.isToday }">{{ d.day }}</span>
          </div>
          <div
            v-if="layout.overflow[d.date]"
            class="overflow"
            :title="`表示しきれない予定が ${layout.overflow[d.date]} 件あります`"
          >
            他 {{ layout.overflow[d.date] }} 件
          </div>
        </div>
      </div>

      <div class="barlayer">
        <button
          v-for="s in layout.perWeek[wi]"
          :key="s.ev.kind + '-' + s.ev.id + '-' + s.colStart"
          class="bar"
          :class="[
            's-' + s.ev.statusBucket,
            s.ev.kind === 'personal' ? 'kind-personal' : 'kind-wbs',
          ]"
          :style="barStyle(s)"
          type="button"
          :draggable="s.ev.kind === 'personal'"
          :title="barTitle(s.ev)"
          @click="emit('open', s.ev)"
          @dragstart="onBarDragStart(s.ev, $event)"
          @dragend="onBarDragEnd"
        >
          <span v-if="s.ev.kind === 'personal'" class="kindtag">個</span>
          <span class="bar-label">{{ s.ev.name || '（名称未入力）' }}</span>
        </button>
      </div>
    </div>

    <p v-if="events.length === 0" class="cal-empty">
      表示できる予定（開始日・終了日のある項目）がありません。
    </p>
  </div>
</template>

<style scoped>
.cal {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
}
.cal-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
}
.navbtn,
.todaybtn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.22rem 0.6rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.navbtn:hover,
.todaybtn:hover {
  background: #eef2ff;
}
.month-label {
  font-weight: 700;
  font-size: 1rem;
  min-width: 8.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.legend {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: #64748b;
}
.lg {
  width: 0.85rem;
  height: 0.6rem;
  border-radius: 2px;
  display: inline-block;
}
.lg-wbs {
  background: #bfdbfe;
  border: 1px solid #60a5fa;
}
.lg-personal {
  background: #ede9fe;
  border: 1px dashed #7c3aed;
  margin-left: 0.5rem;
  width: auto;
  height: auto;
  padding: 0 2px;
  display: inline-flex;
  align-items: center;
}
.lg-kt {
  font-size: 0.62rem;
  font-weight: 700;
  color: #5b21b6;
  line-height: 1.3;
}
.weekhead {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid #e5e7eb;
}
.wh {
  text-align: center;
  padding: 0.35rem 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
}
.wh.sun {
  color: #dc2626;
}
.wh.sat {
  color: #2563eb;
}
.week {
  position: relative;
  border-bottom: 1px solid #e5e7eb;
}
.week:last-child {
  border-bottom: none;
}
.daygrid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.daycell {
  border-right: 1px solid #f1f5f9;
  padding: 2px 4px;
  overflow: hidden;
  cursor: pointer;
}
.daycell.drop-target {
  background: #ddd6fe;
  box-shadow: inset 0 0 0 2px #7c3aed;
}
.daycell:hover {
  background: #eef2ff;
  box-shadow: inset 0 0 0 1px #c7d2fe;
}
.daycell:last-child {
  border-right: none;
}
.daycell.weekend {
  background: #f8fafc;
}
.daycell.outside {
  background: #fbfbfd;
}
.daycell.outside .num {
  color: #cbd5e1;
}
.datenum {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 20px;
}
/* Holiday name: subtle muted text (no special colour/band) so the day still
   reads the same as 土日, just annotated with what the day is. */
.holname {
  flex: 1;
  min-width: 0;
  font-size: 0.64rem;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.num {
  font-size: 0.82rem;
  color: #334155;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: auto;
  flex: none;
}
.num.todaycircle {
  background: #16a34a;
  color: #fff;
  border-radius: 50%;
  font-weight: 700;
}
.overflow {
  position: absolute;
  bottom: 2px;
  font-size: 0.7rem;
  color: #64748b;
  cursor: default;
}
.barlayer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.bar {
  position: absolute;
  pointer-events: auto;
  border: 1px solid transparent;
  border-left-width: 3px;
  border-radius: 3px;
  padding: 0 0.35rem;
  font-size: 0.74rem;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  background: #e0f2fe;
  color: #0c4a6e;
  border-left-color: #0ea5e9;
  overflow: hidden;
}
.bar:hover {
  filter: brightness(0.96);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.bar-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Status palette mirrors the list's status badges. */
.bar.s-completed { background:#ecfdf5; color:#065f46; border-left-color:#10b981; }
.bar.s-in-progress { background:#dbeafe; color:#1e3a8a; border-left-color:#3b82f6; }
.bar.s-overdue { background:#fee2e2; color:#991b1b; border-left-color:#ef4444; }
.bar.s-late-start { background:#fef3c7; color:#92400e; border-left-color:#f59e0b; }
.bar.s-not-started { background:#eef2ff; color:#3730a3; border-left-color:#818cf8; }
/* Personal tasks: a violet that is NOT used by any status colour, plus a
   dashed border and a 個 tag — so they never get confused with a project
   task's status colour (the late-start amber is the closest collision). */
.bar.kind-personal {
  border-style: dashed;
  border-color: #7c3aed;
  background: #ede9fe;
  color: #5b21b6;
  cursor: grab;
}
.bar.kind-personal:active {
  cursor: grabbing;
}
.kindtag {
  flex: none;
  font-size: 0.62rem;
  font-weight: 700;
  background: #7c3aed;
  color: #fff;
  border-radius: 2px;
  padding: 0 3px;
  margin-right: 0.25rem;
  line-height: 1.35;
}
.cal-empty {
  color: #94a3b8;
  font-size: 0.9rem;
  padding: 1rem;
  margin: 0;
}
</style>
