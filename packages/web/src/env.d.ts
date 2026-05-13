/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// Minimal type declaration for frappe-gantt — the upstream package ships
// no .d.ts, so we expose just enough surface to let `import Gantt from
// 'frappe-gantt'` be used both as a value (constructor) and a type
// (`Gantt | null` in our GanttChart.vue). vue-tsc 2.x treats a bare
// `declare module '...'` as a namespace, which broke `let chart: Gantt = ...`.
declare module 'frappe-gantt' {
  class Gantt {
    constructor(
      wrapper: string | HTMLElement | SVGElement,
      tasks: unknown[],
      options?: Record<string, unknown>,
    );
    refresh(tasks: unknown[]): void;
    change_view_mode(mode: string): void;
  }
  export default Gantt;
}

declare module 'vuedraggable';
