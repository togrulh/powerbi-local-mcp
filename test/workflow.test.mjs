import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemo, salesRows } from '../src/demo.mjs';
import { authorDashboard, editLayout, inspect, validateProject } from '../src/projects.mjs';

const design = {
  source: 'RetailDemo', name: 'ExecutiveView', page: 'Retail executive view',
  cards: ['Revenue', 'Orders', 'Average order value'].map(name => ({ table: 'Sales', name })),
  category: { table: 'Sales', name: 'Month' },
  value: { table: 'Sales', name: 'Revenue' },
  slicer: { table: 'Sales', name: 'Channel' },
  chart: 'line',
};

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pbi-mcp-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('synthetic sales reconcile at the month, channel and annual levels', () => {
  const rows = salesRows();
  assert.equal(rows.length, 36);
  assert.equal(new Set(rows.map(([m, c]) => m + '/' + c)).size, 36);
  assert.ok(rows.every(([, , orders, revenue]) => Number.isInteger(orders) && orders > 0 && revenue > orders));
  assert.deepEqual(rows.filter(r => r[0] === '2025-01'), [
    ['2025-01', 'Online', 118, 4956], ['2025-01', 'Store', 153, 5814], ['2025-01', 'Partner', 188, 8648],
  ]);
  assert.deepEqual(rows.reduce(([o, r], row) => [o + row[2], r + row[3]], [0, 0]), [9126, 399426]);
});

test('demo and authored copy contain validated visuals and an unchanged model', async t => {
  const root = workspace(t);
  await createDemo(root);
  const inputModel = join(root, design.source, 'RetailDemo.SemanticModel', 'model.bim');
  const before = readFileSync(inputModel);
  const original = inspect(root, design.source);
  assert.equal(original.pages.length, 1);
  assert.equal(original.pages[0].visuals.length, 5);
  assert.deepEqual(original.tables[0].measures, ['Revenue', 'Orders', 'Average order value']);
  await authorDashboard(root, design);
  assert.deepEqual(readFileSync(inputModel), before);
  assert.deepEqual(readFileSync(join(root, design.name, 'RetailDemo.SemanticModel', 'model.bim')), before);
  assert.deepEqual(inspect(root, design.source), original);
  const built = inspect(root, design.name).pages[1];
  assert.equal(built.title, design.page);
  assert.deepEqual(built.visuals.map(v => v.type), ['card', 'card', 'card', 'lineChart', 'slicer']);
  assert.deepEqual(built.visuals.at(-1).fields, ['Sales.Channel']);
  assert.equal((await validateProject(root, design.name)).errors, 0);
  await assert.rejects(authorDashboard(root, design), /already exists/);
});

test('rejects unknown fields and traversal and leaves no staged output', async t => {
  const root = workspace(t);
  await createDemo(root);
  await assert.rejects(authorDashboard(root, { ...design, value: { table: 'Sales', name: 'Unknown' } }), /Unknown/);
  await assert.rejects(authorDashboard(root, { ...design, name: '../Outside' }));
  assert.deepEqual(readdirSync(root), [design.source]);
});

test('does not follow a project or nested asset symlink', async t => {
  const root = workspace(t);
  const outside = workspace(t);
  const link = join(root, 'Linked');
  try {
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('Links are unavailable');
    throw error;
  }
  assert.throws(() => inspect(root, 'Linked'), /link/i);
  await createDemo(root);
  symlinkSync(outside, join(root, 'RetailDemo', 'RetailDemo.Report', 'outside'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(authorDashboard(root, design), /link/i);
  assert.equal(existsSync(join(root, design.name)), false);
});

test('authored copy excludes local caches and unrelated root files', async t => {
  const root = workspace(t);
  await createDemo(root);
  const base = join(root, design.source);
  writeFileSync(join(base, '.env'), 'EXAMPLE=NOT_FOR_EXPORT');
  const cache = join(base, 'RetailDemo.SemanticModel', '.pbi');
  mkdirSync(cache);
  writeFileSync(join(cache, 'cache.abf'), 'example cache');
  await authorDashboard(root, design);
  assert.equal(existsSync(join(root, design.name, '.env')), false);
  assert.equal(existsSync(join(root, design.name, 'RetailDemo.SemanticModel', '.pbi')), false);
});

test('layout editing preserves visual bindings and rejects overlapping positions', async t => {
  const root = workspace(t);
  await createDemo(root);
  const page = inspect(root, 'RetailDemo').pages[0];
  const [card, other] = page.visuals;
  const { x, y, width, height } = other.position;
  const command = { source: 'RetailDemo', name: 'LayoutReview', pageId: page.id };
  await assert.rejects(editLayout(root, { ...command, changes: [{ id: card.id, position: { x, y, width, height } }] }),
    /overlap/);
  await editLayout(root, { ...command, changes: [{ id: card.id, title: "Today's revenue",
    position: { x: 25, y: 24, width: 399, height: 128 } }] });
  const updated = inspect(root, command.name).pages[0].visuals[0];
  assert.equal(updated.title, "Today's revenue");
  assert.equal(updated.position.x, 25);
  assert.deepEqual(updated.fields, card.fields);
  assert.deepEqual(inspect(root, 'RetailDemo').pages[0], page);
});
