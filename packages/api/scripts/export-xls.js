#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register');

const { applyCellUpdates } = require('../src/excel/biff-writer');
const { buildWbsCellUpdates } = require('../src/excel/wbs-mapper');

const TEMPLATE_PATH = path.resolve(__dirname, '../../../../テンプレートファイル.xls');
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

async function getJson(urlPath) {
  const response = await fetch(`${API_BASE_URL}${urlPath}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

async function main() {
  const projectId = Number(process.argv[2]);
  const outputPath = process.argv[3];
  if (!Number.isInteger(projectId) || !outputPath) {
    console.error('Usage: node packages/api/scripts/export-xls.js <projectId> <output.xls>');
    process.exit(1);
  }

  const [tasks, employees] = await Promise.all([
    getJson(`/api/projects/${projectId}/tasks`),
    getJson('/api/employees'),
  ]);
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const exportTasks = tasks.map((task) => ({
    ...task,
    assigneeName: task.assigneeId === null ? null : employeeNames.get(task.assigneeId) ?? null,
  }));

  const template = fs.readFileSync(TEMPLATE_PATH);
  const updates = buildWbsCellUpdates(exportTasks);
  const output = applyCellUpdates(template, updates);
  const resolvedOutput = path.resolve(process.cwd(), outputPath);
  const outputDir = path.dirname(resolvedOutput);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(resolvedOutput, output);

  console.log(`Wrote ${resolvedOutput} (${output.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
