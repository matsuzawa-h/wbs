<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import Gantt from 'frappe-gantt';
import type { WbsTask } from '@/types';

const props = defineProps<{
  tasks: WbsTask[];
  /** Holiday dates as YYYY-MM-DD strings; treated the same as Sundays in the chart. */
  holidayDates?: Set<string>;
  /** Optional name lookup for the holiday tooltip / label. */
  holidayNames?: Map<string, string>;
  /**
   * When set, the chart scrolls horizontally so this task's bar is centered
   * on the next render — keeps a just-edited bar in view after a date change
   * re-renders the gantt. Cleared by the parent via `focus-applied`.
   */
  focusTaskId?: number | null;
}>();

const emit = defineEmits<{
  (e: 'date-change', taskId: number, startDate: string, endDate: string): void;
  (e: 'progress-change', taskId: number, progress: number): void;
  (e: 'focus-applied'): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
let chart: Gantt | null = null;
// True only for the very first successful render so we can center on today
// once per mount without trampling user scroll on subsequent re-renders.
let pendingScrollToToday = true;
// Vertical scroll container + its handler, used to keep the date-axis header
// pinned at the top while the bars scroll underneath it.
let frozenScrollEl: HTMLElement | null = null;
let frozenScrollHandler: (() => void) | null = null;
// Detaches the proxy horizontal scrollbar's listeners + removes its element.
let hscrollCleanup: (() => void) | null = null;

interface FrappeTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  custom_class?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const GANTT_TASK_ID_PREFIX = 'wbs-gantt-row';
const DEFAULT_ROW_HEIGHT = 40;
const DEFAULT_TABLE_HEADER_HEIGHT = 58;
const DEFAULT_BAR_HEIGHT = 24;
const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES_JA = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

interface VerticalMetrics {
  rowHeight: number;
  tableHeaderHeight: number;
  barHeight: number;
  rowPadding: number;
  frappeHeaderHeight: number;
}

function readCssPx(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function verticalMetrics(): VerticalMetrics {
  const rowHeight = readCssPx('--wbs-gantt-row-height', DEFAULT_ROW_HEIGHT);
  const tableHeaderHeight = readCssPx(
    '--wbs-gantt-table-header-height',
    DEFAULT_TABLE_HEADER_HEIGHT,
  );
  const barHeight = readCssPx('--wbs-gantt-bar-height', DEFAULT_BAR_HEIGHT);
  const rowPadding = Math.max(0, rowHeight - barHeight);
  return {
    rowHeight,
    tableHeaderHeight,
    barHeight,
    rowPadding,
    // frappe positions bars at header_height + padding + bar_height / 2.
    // Table rows start after the visual header, so subtract padding / 2.
    frappeHeaderHeight: Math.max(0, tableHeaderHeight - rowPadding / 2),
  };
}

function visualHeaderHeight(options: { header_height: number; padding: number }): number {
  return options.header_height + options.padding / 2;
}

function frappeTaskDomId(task: WbsTask, rowIndex: number): string {
  return `${GANTT_TASK_ID_PREFIX}-${rowIndex}-task-${task.id}`;
}

function taskIdFromFrappeId(id: string): number | null {
  const encoded = new RegExp(`^${GANTT_TASK_ID_PREFIX}-\\d+-task-(-?\\d+)$`).exec(id);
  const raw = encoded?.[1] ?? id;
  const taskId = Number(raw);
  return Number.isFinite(taskId) ? taskId : null;
}

function barWrapperByTaskId(root: ParentNode): Map<string, SVGGElement> {
  const wrappers = new Map<string, SVGGElement>();
  root.querySelectorAll<SVGGElement>('.bar-wrapper').forEach((wrapper) => {
    const taskId = wrapper.dataset.id ?? wrapper.getAttribute('data-id');
    if (taskId) wrappers.set(taskId, wrapper);
  });
  return wrappers;
}

/**
 * Map EVERY visible task to a row slot so the gantt has exactly one row per
 * table row (same order). Tasks without planned dates still get a slot — a
 * hidden placeholder bar (.gantt-blank) anchored to an in-range date — so the
 * row count never shifts when a date-less heading/new item is present. The
 * encoded id lets overlay code resolve wrappers from frappe's data-id instead
 * of trusting DOM order.
 */
function toFrappeTasks(rows: WbsTask[]): FrappeTask[] {
  const anchor =
    rows.find((t) => t.startDate)?.startDate ?? toIso(new Date());
  return rows.map((t, index) => {
    const hasDates = Boolean(t.startDate && t.endDate);
    return {
      id: frappeTaskDomId(t, index),
      name: hasDates ? t.name : '',
      start: hasDates ? (t.startDate as string) : anchor,
      end: hasDates ? (t.endDate as string) : anchor,
      progress: hasDates ? t.progress : 0,
      custom_class: hasDates ? `lvl-${t.level}` : 'gantt-blank',
    };
  });
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function render(): void {
  if (!containerRef.value) return;
  const hasAnyDated = props.tasks.some((t) => t.startDate && t.endDate);
  const data = toFrappeTasks(props.tasks);
  if (!hasAnyDated || data.length === 0) {
    containerRef.value.innerHTML =
      '<p class="empty">タスクに開始日と日数を設定するとチャートが表示されます。</p>';
    chart = null;
    return;
  }

  // Re-render runs on every add/edit. Emptying the container collapses the
  // pane's scrollable height, so the browser clamps the vertical scroller's
  // scrollTop to 0 — and the scroll-sync then drags both panes to the top.
  // Freeze the container height across the rebuild (and restore scrollTop as
  // a safety net) so the user stays on the row they just edited.
  const vScroller = findVerticalScroller(containerRef.value);
  const savedTop = vScroller ? vScroller.scrollTop : 0;
  const frozenHeight = containerRef.value.offsetHeight;
  if (frozenHeight > 0) {
    containerRef.value.style.minHeight = `${frozenHeight}px`;
  }

  containerRef.value.innerHTML = '';
  const metrics = verticalMetrics();
  // To align bars vertically with the table rows:
  //   row height = bar_height + padding
  //   frappe header_height = visual table header - padding / 2
  // This puts each bar center on the corresponding table row center.
  chart = new Gantt(containerRef.value, data, {
    view_mode: 'Day',
    date_format: 'YYYY-MM-DD',
    bar_height: metrics.barHeight,
    padding: metrics.rowPadding,
    header_height: metrics.frappeHeaderHeight,
    on_date_change: (task: FrappeTask, start: Date, end: Date) => {
      const id = taskIdFromFrappeId(task.id);
      if (id === null) return;
      emit('date-change', id, toIso(start), toIso(end));
    },
    on_progress_change: (task: FrappeTask, progress: number) => {
      const id = taskIdFromFrappeId(task.id);
      if (id === null) return;
      emit('progress-change', id, progress);
    },
  });

  // Frappe Gantt does some async layout; defer customizations a tick.
  requestAnimationFrame(() => {
    trimSvgHeight();
    drawMonthBands();
    highlightWeekends();
    drawMonthBoundaries();
    drawTodayMarker();
    drawOverrunBars();
    attachBarTooltips();
    applyJapaneseLabels();
    setupFrozenHeader();
    setupHScrollbar();
    if (props.focusTaskId != null) {
      // Defer one more frame so frappe's own initial scroll has settled,
      // then center the edited bar using its real rendered position
      // (robust against cascade / internal layout). Tell the parent it's
      // done so a later unrelated re-render won't hijack the scroll.
      const fid = props.focusTaskId;
      requestAnimationFrame(() => {
        scrollTaskIntoView(fid);
        emit('focus-applied');
      });
    } else if (pendingScrollToToday) {
      centerOnToday();
    }
    pendingScrollToToday = false;

    // The rebuilt SVG now has its real height (trimSvgHeight ran above), so
    // release the freeze and re-assert the prior VERTICAL position. This is
    // always safe: the only intentional scrolls a render performs (focus on
    // an edited bar / first-render center-on-today) move scrollLeft only —
    // vertical is purely the table-synced position and must never shift,
    // including when the very last row's date is edited.
    if (frozenHeight > 0 && containerRef.value) {
      containerRef.value.style.minHeight = '';
    }
    if (vScroller && vScroller.scrollTop !== savedTop) {
      vScroller.scrollTop = savedTop;
    }
  });
}

/**
 * Draws a prominent vertical line + small '今日' chip on today's column so
 * it visually pops out from the weekend / month / overrun overlays.
 */
function drawTodayMarker(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;
  const today = todayUtc();
  if (today.getTime() < ganttStart.getTime() || today.getTime() > ganttEnd.getTime()) {
    // Today is outside the rendered range - nothing to draw.
    svg.querySelectorAll('.today-marker').forEach((el) => el.remove());
    return;
  }
  const cw = getColumnWidth();
  const ONE_DAY = 86_400_000;
  const dayOffset = Math.round((today.getTime() - ganttStart.getTime()) / ONE_DAY);
  const colLeftX = dayOffset * cw;
  const colCenterX = colLeftX + cw / 2;

  const heightAttr = svg.getAttribute('height');
  const totalHeight = heightAttr ? Number(heightAttr) : 400;

  svg.querySelectorAll('.today-marker').forEach((el) => el.remove());

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'today-marker');
  group.setAttribute('pointer-events', 'none');

  // Faint column tint that goes the full chart height (over the weekend band
  // but under bars), so the column itself reads as 'today' from any zoom level.
  const tint = document.createElementNS(SVG_NS, 'rect');
  tint.setAttribute('x', String(colLeftX));
  tint.setAttribute('y', '0');
  tint.setAttribute('width', String(cw));
  tint.setAttribute('height', String(totalHeight));
  tint.setAttribute('fill', '#fde68a'); // warm amber
  tint.setAttribute('opacity', '0.45');
  group.appendChild(tint);

  // Solid vertical line down the centre of today's column.
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(colCenterX));
  line.setAttribute('x2', String(colCenterX));
  line.setAttribute('y1', '0');
  line.setAttribute('y2', String(totalHeight));
  line.setAttribute('stroke', '#d97706'); // amber-600
  line.setAttribute('stroke-width', '1.8');
  group.appendChild(line);

  // Small '今日' badge anchored at the very top of the column.
  const padX = 4;
  const padY = 2;
  const labelText = '今日';
  const approxLabelWidth = labelText.length * 11 + padX * 2; // rough width budget
  const labelH = 16;
  const badgeRect = document.createElementNS(SVG_NS, 'rect');
  badgeRect.setAttribute('x', String(colCenterX - approxLabelWidth / 2));
  badgeRect.setAttribute('y', '1');
  badgeRect.setAttribute('width', String(approxLabelWidth));
  badgeRect.setAttribute('height', String(labelH));
  badgeRect.setAttribute('rx', '4');
  badgeRect.setAttribute('fill', '#d97706');
  group.appendChild(badgeRect);
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', String(colCenterX));
  label.setAttribute('y', String(1 + padY + 11));
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('font-size', '11');
  label.setAttribute('font-weight', '700');
  label.setAttribute('fill', '#ffffff');
  label.textContent = labelText;
  group.appendChild(label);

  svg.appendChild(group);
}

/**
 * On first render, scroll the gantt's horizontal scroll container so that
 * today's date sits in the middle of the visible area. Falls back to the
 * left edge when today's column is so close to the chart start that
 * centering would underflow.
 */
function centerOnToday(): void {
  if (!containerRef.value || !chart) return;
  const ganttStart = getGanttStart();
  if (!ganttStart) return;
  const cw = getColumnWidth();
  const today = todayUtc();
  const dayOffset = Math.round((today.getTime() - ganttStart.getTime()) / 86_400_000);
  const todayCenterX = dayOffset * cw + cw / 2;

  // Find the descendant element that owns the horizontal scroll. Frappe Gantt
  // creates a wrapper inside containerRef whose scrollWidth > clientWidth.
  const scrollEl = findHorizontalScroller(containerRef.value);
  if (!scrollEl) return;
  const target = todayCenterX - scrollEl.clientWidth / 2;
  scrollEl.scrollLeft = Math.max(0, Math.min(target, scrollEl.scrollWidth - scrollEl.clientWidth));
}

// Days of lead-in shown before the edited bar's start (so entering a plan
// on e.g. 6/30 scrolls the axis to begin around 6/28).
const FOCUS_LEAD_DAYS = 2;

/**
 * Scroll horizontally so the edited task's bar starts a couple of days in
 * from the left edge (its start date − FOCUS_LEAD_DAYS sits at the left).
 * Uses the REAL rendered bar position (not gantt_start math) so it
 * survives cascade shifts and frappe's own post-construction scroll. Only
 * scrollLeft is touched — vertical scroll (synced with the table) is left
 * untouched.
 */
function scrollTaskIntoView(taskId: number): void {
  const root = containerRef.value;
  if (!root) return;
  const wrap = [...root.querySelectorAll<SVGGElement>('.bar-wrapper')].find(
    (w) => (w.dataset.id ?? '').endsWith(`-task-${taskId}`),
  );
  const bar = wrap?.querySelector<SVGRectElement>('.bar');
  const scroller = findHorizontalScroller(root);
  if (!bar || !scroller) return;
  const barRect = bar.getBoundingClientRect();
  const scRect = scroller.getBoundingClientRect();
  const leadPx = FOCUS_LEAD_DAYS * getColumnWidth();
  // Put the bar's left edge `leadPx` in from the scroller's left edge.
  const next =
    scroller.scrollLeft + (barRect.left - scRect.left) - leadPx;
  scroller.scrollLeft = Math.max(
    0,
    Math.min(next, scroller.scrollWidth - scroller.clientWidth),
  );
}

function findHorizontalScroller(root: HTMLElement): HTMLElement | null {
  if (root.scrollWidth > root.clientWidth) return root;
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollWidth > el.clientWidth) return el;
  }
  return null;
}

/**
 * Frappe Gantt leaves a generous bottom margin under the last bar (and
 * sometimes pads the SVG height further than the row count strictly
 * requires). Trim the SVG height to header + N rows + a small tail so the
 * gantt pane doesn't introduce visible dead space underneath the data.
 */
function trimSvgHeight(): void {
  const svg = containerRef.value?.querySelector<SVGSVGElement>('svg');
  if (!svg || !chart) return;
  const opts = (chart as unknown as {
    options: { header_height: number; padding: number; bar_height: number };
  }).options;
  // One slot per visible task (including the hidden date-less placeholders)
  // so the SVG height equals the table's height and the panes scroll in
  // lockstep without drifting.
  const taskCount = props.tasks.length;
  if (taskCount === 0) return;
  const header = opts.header_height ?? 48;
  const padding = opts.padding ?? 16;
  const barHeight = opts.bar_height ?? 24;
  const rowHeight = barHeight + padding;
  // Match the table's scrollable content height exactly:
  // visual header + one fixed-height row per visible task.
  const targetHeight = visualHeaderHeight({ header_height: header, padding }) + taskCount * rowHeight;
  svg.setAttribute('height', String(targetHeight));
  svg.querySelector<SVGRectElement>('.grid-background')?.setAttribute('height', String(targetHeight));
  svg.querySelector<SVGRectElement>('.today-highlight')?.setAttribute('height', String(targetHeight));
}

function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function businessDaysBetween(a: Date, b: Date): number {
  if (a.getTime() > b.getTime()) return 0;
  let count = 0;
  const cursor = new Date(a.getTime());
  while (cursor.getTime() <= b.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Draws red rectangles to the right of the planned bar for tasks that are
 * delayed. Covers two cases:
 *   (1) Finished late — actualEndDate > plannedEndDate.
 *       Solid red from (plannedEnd + 1) to actualEnd.
 *   (2) Currently overdue — task is still in progress past plannedEnd.
 *       Conditions: actualEndDate is null AND today > plannedEndDate AND
 *       (actualStartDate set OR plannedStartDate <= today).
 *       Semi-transparent red from (plannedEnd + 1) to today.
 */
function drawOverrunBars(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  if (!ganttStart) return;
  const cw = getColumnWidth();
  const ONE_DAY = 86_400_000;
  const today = todayUtc();

  let group = svg.querySelector<SVGGElement>('.overrun-bars-group');
  if (!group) {
    group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    group.setAttribute('class', 'overrun-bars-group');
    svg.appendChild(group);
  }
  while (group.firstChild) group.removeChild(group.firstChild);

  const wrappers = barWrapperByTaskId(svg);
  props.tasks.forEach((task, idx) => {
    if (!task || !task.startDate || !task.endDate) return;
    const wrapper = wrappers.get(frappeTaskDomId(task, idx));
    if (!wrapper) return;

    const plannedEnd = parseDate(task.endDate);
    const bar = wrapper.querySelector<SVGRectElement>('.bar');
    if (!bar) return;
    const barY = Number(bar.getAttribute('y') ?? '0');
    const barH = Number(bar.getAttribute('height') ?? '0');

    // Case 1: finished late (historical) — lighter red to recede visually
    if (task.actualEndDate) {
      const actualEnd = parseDate(task.actualEndDate);
      if (actualEnd.getTime() <= plannedEnd.getTime()) return;

      appendOverrunRect(group!, {
        ganttStart,
        cw,
        ONE_DAY,
        plannedEnd,
        endDate: actualEnd,
        barY,
        barH,
        fill: '#ef4444',
        opacity: '0.55',
        title:
          `${task.name}\n遅延: ${Math.max(0, businessDaysBetween(plannedEnd, actualEnd) - 1)} 営業日\n` +
          `予定終了: ${task.endDate}\n実績終了: ${task.actualEndDate}`,
      });
      return;
    }

    // Case 2: currently overdue (in progress past planned end) — solid deep red
    const isOverdue = today.getTime() > plannedEnd.getTime();
    if (!isOverdue) return;
    // Require either explicit actualStart or that planned start has arrived
    const plannedStart = task.startDate ? parseDate(task.startDate) : null;
    const started =
      Boolean(task.actualStartDate) ||
      (plannedStart !== null && plannedStart.getTime() <= today.getTime());
    if (!started) return;

    appendOverrunRect(group!, {
      ganttStart,
      cw,
      ONE_DAY,
      plannedEnd,
      endDate: today,
      barY,
      barH,
      fill: '#dc2626',
      opacity: '0.92',
      title:
        `${task.name}\n進行中（遅延中）\n予定終了: ${task.endDate}（本日: ${formatDateUtc(today)}）\n` +
        `遅延: ${Math.max(0, businessDaysBetween(plannedEnd, today) - 1)} 営業日`,
    });
  });
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface OverrunRectArgs {
  ganttStart: Date;
  cw: number;
  ONE_DAY: number;
  plannedEnd: Date;
  endDate: Date;
  barY: number;
  barH: number;
  fill: string;
  opacity: string;
  title: string;
}

function appendOverrunRect(group: SVGGElement, args: OverrunRectArgs): void {
  const plannedEndOffset = Math.round(
    (args.plannedEnd.getTime() - args.ganttStart.getTime()) / args.ONE_DAY,
  );
  const endOffset = Math.round(
    (args.endDate.getTime() - args.ganttStart.getTime()) / args.ONE_DAY,
  );
  const startX = (plannedEndOffset + 1) * args.cw;
  const width = (endOffset - plannedEndOffset) * args.cw;
  if (width <= 0) return;

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('class', 'overrun-bar');
  rect.setAttribute('x', String(startX));
  rect.setAttribute('y', String(args.barY));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(args.barH));
  rect.setAttribute('fill', args.fill);
  rect.setAttribute('opacity', args.opacity);
  rect.setAttribute('rx', '3');
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = args.title;
  rect.appendChild(title);
  group.appendChild(rect);
}

/**
 * Adds an SVG <title> child to each bar-wrapper so the browser shows a native
 * tooltip on hover summarising planned vs actual dates, hours, progress, etc.
 */
function attachBarTooltips(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg) return;
  const wrappers = barWrapperByTaskId(svg);
  props.tasks.forEach((task, idx) => {
    if (!task || !task.startDate || !task.endDate) return;
    const wrapper = wrappers.get(frappeTaskDomId(task, idx));
    if (!wrapper) return;
    wrapper.querySelectorAll(':scope > title').forEach((t) => t.remove());
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = buildBarTooltip(task);
    wrapper.appendChild(title);
  });
}

function buildBarTooltip(task: WbsTask): string {
  const lines: string[] = [task.name];
  if (task.startDate && task.endDate) {
    const dur = task.duration ?? businessDaysBetween(parseDate(task.startDate), parseDate(task.endDate));
    lines.push(`予定: ${task.startDate} 〜 ${task.endDate} (${dur} 営業日)`);
  }
  if (task.actualStartDate && task.actualEndDate) {
    const actDur = businessDaysBetween(parseDate(task.actualStartDate), parseDate(task.actualEndDate));
    lines.push(`実績: ${task.actualStartDate} 〜 ${task.actualEndDate} (${actDur} 営業日)`);
    if (task.endDate) {
      const plannedEnd = parseDate(task.endDate);
      const actualEnd = parseDate(task.actualEndDate);
      if (actualEnd.getTime() > plannedEnd.getTime()) {
        const delay = Math.max(0, businessDaysBetween(plannedEnd, actualEnd) - 1);
        lines.push(`遅延: ${delay} 営業日`);
      } else if (actualEnd.getTime() < plannedEnd.getTime()) {
        const early = Math.max(0, businessDaysBetween(actualEnd, plannedEnd) - 1);
        if (early > 0) lines.push(`前倒し: ${early} 営業日`);
      }
    }
  } else if (task.actualStartDate) {
    // Started but not finished
    lines.push(`実績: ${task.actualStartDate} 〜 (進行中)`);
    if (task.endDate) {
      const plannedEnd = parseDate(task.endDate);
      const today = todayUtc();
      if (today.getTime() > plannedEnd.getTime()) {
        const delay = Math.max(0, businessDaysBetween(plannedEnd, today) - 1);
        lines.push(`遅延中: ${delay} 営業日`);
      }
    }
  }
  if (task.plannedHours !== null || task.actualHours !== null) {
    const ph = task.plannedHours ?? '—';
    const ah = task.actualHours ?? '—';
    lines.push(`工数 予/実: ${ph} / ${ah} h`);
  }
  lines.push(`進捗: ${task.progress}%`);
  const note = task.note?.trim();
  if (note) {
    lines.push('―――――');
    lines.push(`備考: ${note}`);
  }
  return lines.join('\n');
}

function drawMonthBands(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;

  const cw = getColumnWidth();
  const gridBg = svg.querySelector<SVGRectElement>('.grid-background');
  const totalHeight = gridBg ? Number(gridBg.getAttribute('height')) : 400;
  const ONE_DAY = 86_400_000;
  const totalDays = Math.round((ganttEnd.getTime() - ganttStart.getTime()) / ONE_DAY) + 1;

  svg.querySelectorAll('.month-band').forEach((el) => el.remove());

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'month-band');
  group.setAttribute('pointer-events', 'none');

  let segStart = 0;
  let currentMonth = ganttStart.getMonth();
  let bandIndex = 0;

  const flushBand = (endIdx: number): void => {
    // Tint every other month so adjacent months read as distinct stripes.
    const fill = bandIndex % 2 === 0 ? '#ffffff' : '#eef2f7';
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(segStart * cw));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String((endIdx - segStart) * cw));
    rect.setAttribute('height', String(totalHeight));
    rect.setAttribute('fill', fill);
    rect.setAttribute('opacity', '0.7');
    group.appendChild(rect);
  };

  for (let i = 1; i < totalDays; i++) {
    const date = new Date(ganttStart.getTime() + i * ONE_DAY);
    if (date.getMonth() !== currentMonth) {
      flushBand(i);
      segStart = i;
      currentMonth = date.getMonth();
      bandIndex++;
    }
  }
  flushBand(totalDays);

  const gridGroup = svg.querySelector('g.grid');
  if (gridGroup) {
    // Insert at the start of grid so weekend / today / bars sit on top.
    gridGroup.insertBefore(group, gridGroup.firstChild?.nextSibling ?? null);
  } else {
    svg.insertBefore(group, svg.firstChild);
  }
}

function drawMonthBoundaries(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;

  const cw = getColumnWidth();
  const gridBg = svg.querySelector<SVGRectElement>('.grid-background');
  const totalHeight = gridBg ? Number(gridBg.getAttribute('height')) : 400;
  const ONE_DAY = 86_400_000;
  const totalDays = Math.round((ganttEnd.getTime() - ganttStart.getTime()) / ONE_DAY) + 1;

  svg.querySelectorAll('.month-boundary').forEach((el) => el.remove());

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'month-boundary');
  group.setAttribute('pointer-events', 'none');

  for (let i = 1; i < totalDays; i++) {
    const date = new Date(ganttStart.getTime() + i * ONE_DAY);
    if (date.getDate() === 1) {
      const x = i * cw;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(totalHeight));
      line.setAttribute('stroke', '#94a3b8');
      line.setAttribute('stroke-width', '1.5');
      group.appendChild(line);
      // The month label lived here as a scroll aid for when the header
      // scrolled away; with the now-pinned header it's redundant.
    }
  }

  const gridGroup = svg.querySelector('g.grid');
  if (gridGroup) {
    gridGroup.appendChild(group);
  } else {
    svg.appendChild(group);
  }
}

function applyJapaneseLabels(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;

  // Replace English month names in upper-text with Japanese (e.g. "1 May" -> "5月")
  svg.querySelectorAll<SVGTextElement>('.upper-text').forEach((t) => {
    const txt = (t.textContent ?? '').trim();
    for (let i = 0; i < MONTH_NAMES_EN.length; i++) {
      if (txt.includes(MONTH_NAMES_EN[i])) {
        t.textContent = MONTH_NAMES_JA[i];
        return;
      }
    }
  });

  // Append weekday char in parens to each day number in lower-text:
  //   "12" -> "12(火)"   ←  parens disambiguate from month labels like "12月"
  const ganttStart = getGanttStart();
  if (!ganttStart) return;
  const cw = getColumnWidth();
  const ONE_DAY = 86_400_000;
  const holidaySet = props.holidayDates ?? new Set<string>();
  svg.querySelectorAll<SVGTextElement>('.lower-text').forEach((t) => {
    const orig = (t.textContent ?? '').trim();
    const dow = inferDow(t, ganttStart, cw);
    if (dow === null) return;
    const xAttr = t.getAttribute('x');
    const x = xAttr ? Number(xAttr) : 0;
    const idx = Math.max(0, Math.round((x - cw / 2) / cw));
    const date = new Date(ganttStart.getTime() + idx * ONE_DAY);
    const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const isHoliday = holidaySet.has(iso);
    // Strip any previously-applied label so re-renders don't double up.
    const dayNumber = orig.replace(/[\s()日月火水木金土祝]+$/g, '');
    t.textContent = `${dayNumber}(${DOW_JA[dow]})`;
    // Color: holidays and Sundays red; Saturdays blue; otherwise default.
    if (isHoliday || dow === 0) t.setAttribute('fill', '#b91c1c');
    else if (dow === 6) t.setAttribute('fill', '#1d4ed8');
    else t.removeAttribute('fill');
  });
}

function highlightWeekends(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;

  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;

  const cw = getColumnWidth();
  const opts = (chart as unknown as { options: { header_height: number; padding: number } }).options;
  const bodyTop = visualHeaderHeight(opts);

  // Total height of the chart body (excluding header) - use grid-background as reference
  const gridBg = svg.querySelector<SVGRectElement>('.grid-background');
  const totalHeight = gridBg ? Number(gridBg.getAttribute('height')) : 400;
  const bodyHeight = Math.max(0, totalHeight - bodyTop);

  // Inclusive number of day cells from ganttStart to ganttEnd.
  const ONE_DAY = 86_400_000;
  const totalDays = Math.round((ganttEnd.getTime() - ganttStart.getTime()) / ONE_DAY) + 1;

  // Remove old overlay before re-creating
  svg.querySelectorAll('.weekend-overlay').forEach((el) => el.remove());

  const overlayGroup = document.createElementNS(SVG_NS, 'g');
  overlayGroup.setAttribute('class', 'weekend-overlay');
  overlayGroup.setAttribute('pointer-events', 'none');

  const holidaySet = props.holidayDates ?? new Set<string>();
  for (let i = 0; i < totalDays; i++) {
    const date = new Date(ganttStart.getTime() + i * ONE_DAY);
    const dow = date.getDay();
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const isHoliday = holidaySet.has(iso);
    if (dow === 0 || dow === 6 || isHoliday) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(i * cw));
      rect.setAttribute('y', String(bodyTop));
      rect.setAttribute('width', String(cw));
      rect.setAttribute('height', String(bodyHeight));
      // Holidays and Sundays use the same red-pink; Saturdays stay blue.
      // (Holiday + Saturday combo prefers the holiday red so it stands out.)
      const fill = dow === 6 && !isHoliday ? '#c7d6ec' : '#f3c9c9';
      rect.setAttribute('fill', fill);
      rect.setAttribute('opacity', '0.3');
      overlayGroup.appendChild(rect);
      if (isHoliday) {
        const name = props.holidayNames?.get(iso);
        const titleEl = document.createElementNS(SVG_NS, 'title');
        titleEl.textContent = name ? `${iso} ${name}` : `${iso} 休日`;
        rect.appendChild(titleEl);
      }
    }
  }

  // Insert just after the grid-background so bars / today-highlight render on top.
  const gridGroup = svg.querySelector('g.grid');
  if (gridGroup) {
    gridGroup.appendChild(overlayGroup);
  } else {
    svg.insertBefore(overlayGroup, svg.firstChild);
  }
}

function getGanttStart(): Date | null {
  const internals = chart as unknown as { gantt_start?: Date };
  return internals?.gantt_start ?? null;
}

function getGanttEnd(): Date | null {
  const internals = chart as unknown as { gantt_end?: Date };
  return internals?.gantt_end ?? null;
}

function getColumnWidth(): number {
  const internals = chart as unknown as { options: { column_width: number } };
  return internals?.options?.column_width ?? 38;
}

/**
 * Infer the day-of-week for a .lower-text element based on its X position
 * relative to ganttStart and the column width. More robust than relying on
 * SVG text order alone.
 */
function inferDow(text: SVGTextElement, ganttStart: Date, cw: number): number | null {
  const xAttr = text.getAttribute('x');
  if (!xAttr) return null;
  const x = Number(xAttr);
  if (!Number.isFinite(x)) return null;
  // Lower-text x is the center of the column. Round to nearest column index.
  const idx = Math.max(0, Math.round((x - cw / 2) / cw));
  const date = new Date(ganttStart.getTime() + idx * 86_400_000);
  return date.getDay();
}

/** Nearest scrollable ancestor that owns the chart's vertical scroll. */
function findVerticalScroller(start: HTMLElement | null): HTMLElement | null {
  let el = start?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Pin the date-axis header (the gray band + month/day labels) so it stays at
 * the top while the bars scroll under it — mirroring the table's sticky
 * header. Without this the left header is frozen but the gantt header
 * scrolls away, leaving rows and bars visually offset by the header height.
 */
function setupFrozenHeader(): void {
  const svg = containerRef.value?.querySelector<SVGSVGElement>('svg');
  if (!svg) return;
  const gridHeader = svg.querySelector<SVGRectElement>('rect.grid-header');
  const dateGroup = svg.querySelector<SVGGElement>('g.date');
  if (!gridHeader || !dateGroup) return;
  const opts = (chart as unknown as { options: { header_height: number; padding: number } }).options;
  const headerHeight = visualHeaderHeight(opts);
  gridHeader.setAttribute('height', String(headerHeight));

  svg.querySelectorAll('.frozen-header').forEach((el) => el.remove());
  const fg = document.createElementNS(SVG_NS, 'g');
  fg.setAttribute('class', 'frozen-header');
  // Header rect must be opaque (see .grid-header fill) so the body is masked.
  fg.appendChild(gridHeader);
  fg.appendChild(dateGroup);

  // Hairline so the pinned strip reads as separate from the scrolling body.
  const ww = gridHeader.getAttribute('width') ?? String(svg.getAttribute('width') ?? 0);
  const sep = document.createElementNS(SVG_NS, 'line');
  sep.setAttribute('x1', '0');
  sep.setAttribute('x2', String(ww));
  sep.setAttribute('y1', String(headerHeight));
  sep.setAttribute('y2', String(headerHeight));
  sep.setAttribute('stroke', '#cbd5e1');
  sep.setAttribute('stroke-width', '1');
  fg.appendChild(sep);

  // Must be the very last child so it paints on top of everything — the
  // bars, the red overrun rects and the today marker all scroll *under*
  // the pinned date header instead of overwriting the dates.
  svg.appendChild(fg);

  if (frozenScrollEl && frozenScrollHandler) {
    frozenScrollEl.removeEventListener('scroll', frozenScrollHandler);
  }
  const scroller = findVerticalScroller(containerRef.value);
  const apply = (): void => {
    fg.setAttribute('transform', `translate(0, ${scroller ? scroller.scrollTop : 0})`);
  };
  if (scroller) {
    scroller.addEventListener('scroll', apply, { passive: true });
    frozenScrollEl = scroller;
    frozenScrollHandler = apply;
  }
  apply();
}

/**
 * Always-visible horizontal scrollbar. frappe's inner .gantt-container owns
 * the real horizontal scroll, but its scrollbar sits at the bottom of the
 * tall content (only reachable after scrolling all the way down). This adds
 * a thin proxy scrollbar pinned (sticky) to the bottom edge of the visible
 * pane and two-way-synced with the real scroller, so it is always there.
 */
function setupHScrollbar(): void {
  if (hscrollCleanup) {
    hscrollCleanup();
    hscrollCleanup = null;
  }
  const root = containerRef.value;
  const wrapper = root?.parentElement ?? null;
  if (!root || !wrapper) return;
  wrapper.querySelectorAll('.gantt-hscroll').forEach((el) => el.remove());

  const real = findHorizontalScroller(root);
  if (!real || real.scrollWidth <= real.clientWidth + 1) return;
  // Hide frappe's own horizontal scrollbar — the proxy is the visible one.
  // Otherwise frappe's bar reappears at the very bottom of the tall inner
  // container and the content visibly shifts when scrolled all the way down.
  real.classList.add('wbs-no-native-scrollbar');

  // Scoped <style> does NOT apply to JS-created nodes (no data-v attr), so
  // the layout-critical styles are set inline. The scrollbar's *appearance*
  // still comes from the global ::-webkit-scrollbar rule.
  const proxy = document.createElement('div');
  proxy.className = 'gantt-hscroll';
  proxy.style.cssText = [
    'position:sticky',
    'bottom:0',
    'left:0',
    'z-index:50',
    'overflow-x:scroll',
    'overflow-y:hidden',
    'height:14px',
    'background:var(--c-surface)',
    'box-shadow:0 -1px 0 var(--c-border)',
  ].join(';');
  const spacer = document.createElement('div');
  spacer.className = 'gantt-hscroll-spacer';
  spacer.style.width = `${real.scrollWidth}px`;
  spacer.style.height = '1px';
  proxy.appendChild(spacer);
  wrapper.appendChild(proxy);

  let lock = false;
  const fromProxy = (): void => {
    if (lock) return;
    lock = true;
    real.scrollLeft = proxy.scrollLeft;
    lock = false;
  };
  const fromReal = (): void => {
    if (lock) return;
    lock = true;
    proxy.scrollLeft = real.scrollLeft;
    lock = false;
  };
  proxy.addEventListener('scroll', fromProxy, { passive: true });
  real.addEventListener('scroll', fromReal, { passive: true });
  proxy.scrollLeft = real.scrollLeft;

  hscrollCleanup = (): void => {
    proxy.removeEventListener('scroll', fromProxy);
    real.removeEventListener('scroll', fromReal);
    real.classList.remove('wbs-no-native-scrollbar');
    proxy.remove();
  };
}

onMounted(async () => {
  await nextTick();
  render();
});

watch(() => props.tasks, () => render(), { deep: true });

onBeforeUnmount(() => {
  if (frozenScrollEl && frozenScrollHandler) {
    frozenScrollEl.removeEventListener('scroll', frozenScrollHandler);
  }
  frozenScrollEl = null;
  frozenScrollHandler = null;
  if (hscrollCleanup) {
    hscrollCleanup();
    hscrollCleanup = null;
  }
  if (containerRef.value) containerRef.value.innerHTML = '';
  chart = null;
});
</script>

<template>
  <div class="gantt-wrapper">
    <div ref="containerRef" class="gantt-container"></div>
  </div>
</template>

<style scoped>
.gantt-wrapper {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  /* No vertical padding: the SVG height is matched to the task table so both
     panes share the same vertical scroll range. */
  padding: 0 0.5rem;
  /* Must NOT be a scroll container: the proxy horizontal scrollbar is a
     sticky child here and has to resolve its sticky context to .pane.right
     (the actual vertical scroller). frappe's inner .gantt-container keeps
     its own overflow-x:auto and still drives the real horizontal scroll;
     setupHScrollbar mirrors it into the always-visible sticky proxy. */
  overflow: visible;
}
.gantt-container {
  min-height: 200px;
}
/* Frappe Gantt creates a nested .gantt-container with overflow:auto on
   both axes. Force its vertical to visible so .pane.right owns the
   vertical scroll (the horizontal stays on this inner container). */
.gantt-container :deep(.gantt-container) {
  overflow-y: visible !important;
}
/* .gantt-hscroll / .gantt-hscroll-spacer are created in JS (setupHScrollbar)
   and styled inline there — scoped styles can't reach JS-created nodes. */
/* The SVG is inline by default, so its line box adds ~5px of descender
   space below it. That made the right pane ~5px taller than the table and
   the two desynced only at the very bottom. display:block removes it so
   right-pane scrollHeight == SVG height == table height exactly. */
.gantt-container :deep(svg) {
  display: block;
}
.gantt-container :deep(.empty) {
  color: var(--c-text-muted);
  font-size: 0.9rem;
  margin: 0.5rem 0;
}
/* Bars use one calm accent family by depth (deep → light) instead of the
   old blue / purple / green mix, so the chart reads as one system. */
/* Date-less rows still occupy a slot (keeps row↔bar index aligned) but
   draw nothing. */
.gantt-container :deep(.bar-wrapper.gantt-blank) {
  display: none;
}
.gantt-container :deep(.bar-wrapper.lvl-1 .bar) {
  fill: #1e3a8a;
}
.gantt-container :deep(.bar-wrapper.lvl-2 .bar) {
  fill: #3b6fd4;
}
.gantt-container :deep(.bar-wrapper.lvl-3 .bar) {
  fill: #93b4e6;
}
.gantt-container :deep(.bar) {
  rx: 4;
  ry: 4;
}
/* Higher-contrast progress fill so completion is readable at a glance. */
.gantt-container :deep(.bar-progress) {
  fill: #16a34a;
  opacity: 0.92;
}
.gantt-container :deep(.bar-wrapper.lvl-3 .bar-progress) {
  fill: #15803d;
}
/* Bar name: white glyphs with a dark halo so it stays readable on light
   (lvl-3) AND dark (lvl-1/2) bars, over the green progress fill, and over
   the weekend / today / overrun overlays. */
.gantt-container :deep(.bar-label) {
  fill: #fff;
  font-weight: 700;
  font-size: 0.8rem;
  paint-order: stroke;
  stroke: rgba(15, 23, 42, 0.66);
  stroke-width: 2.6px;
  stroke-linejoin: round;
  pointer-events: none;
}
/* When the bar is too short, frappe draws the label OUTSIDE on the chart
   background — dark text with a white halo instead. */
.gantt-container :deep(.bar-label.big) {
  fill: var(--c-text);
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 3px;
}
.gantt-container :deep(.upper-text) {
  font-size: 0.8rem;
  font-weight: 700;
  fill: var(--c-text);
}
.gantt-container :deep(.lower-text) {
  font-size: 0.7rem;
  fill: var(--c-text-muted);
}
.gantt-container :deep(.grid-header) {
  fill: var(--c-surface-2);
}
.gantt-container :deep(.tick) {
  stroke: var(--c-border);
}
.gantt-container :deep(.today-highlight) {
  fill: transparent;
}
</style>
