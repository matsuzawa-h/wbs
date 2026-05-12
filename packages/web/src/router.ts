import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import ProjectListPage from './pages/ProjectListPage.vue';
import GanttPage from './pages/GanttPage.vue';
import HolidayPage from './pages/HolidayPage.vue';
import EmployeePage from './pages/EmployeePage.vue';
import AssignmentsPage from './pages/AssignmentsPage.vue';
import CustomerPage from './pages/CustomerPage.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'projects', component: ProjectListPage },
  {
    path: '/projects/:projectId/gantt',
    name: 'gantt',
    component: GanttPage,
    props: (route) => ({ projectId: Number(route.params.projectId) }),
  },
  { path: '/holidays', name: 'holidays', component: HolidayPage },
  { path: '/employees', name: 'employees', component: EmployeePage },
  { path: '/assignments', name: 'assignments', component: AssignmentsPage },
  { path: '/customers', name: 'customers', component: CustomerPage },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
