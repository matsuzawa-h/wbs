import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import ProjectListPage from './pages/ProjectListPage.vue';
import GanttPage from './pages/GanttPage.vue';
import HolidayPage from './pages/HolidayPage.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'projects', component: ProjectListPage },
  {
    path: '/projects/:projectId/gantt',
    name: 'gantt',
    component: GanttPage,
    props: (route) => ({ projectId: Number(route.params.projectId) }),
  },
  { path: '/holidays', name: 'holidays', component: HolidayPage },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
