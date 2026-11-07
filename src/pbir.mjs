import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const schemas = 'https://developer.microsoft.com/json-schemas/fabric/';
const reportSchema = schemas + 'item/report/definition/';
const id = () => randomBytes(10).toString('hex');
const literal = Value => ({ expr: { Literal: { Value } } });
const quote = value => "'" + value.replaceAll("'", "''") + "'";

export function visualTitle(visual) {
  const raw = visual?.visualContainerObjects?.title?.find(t => !t.selector)?.properties?.text?.expr?.Literal?.Value;
  return typeof raw === 'string' && raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : null;
}

export function setVisualTitle(visual, title) {
  const titles = (visual.visualContainerObjects ??= {}).title ??= [];
  let item = titles.find(t => !t.selector);
  if (!item) titles.push(item = {});
  Object.assign(item.properties ??= {}, { show: literal('true'), text: literal(quote(title)) });
}

function binding({ table, name }, kind) {
  return {
    field: { [kind]: { Expression: { SourceRef: { Entity: table } }, Property: name } },
    queryRef: table + '.' + name, nativeQueryRef: name, active: true,
  };
}

export function addDashboard(pages, metadata, design, write) {
  const pageId = id();
  const folder = join(pages, pageId);
  mkdirSync(join(folder, 'visuals'), { recursive: true });
  write(join(folder, 'page.json'), {
    $schema: reportSchema + 'page/2.1.0/schema.json', name: pageId,
    displayName: design.page, displayOption: 'FitToPage', width: 1280, height: 720,
  });
  const visuals = design.cards.map((card, i) => ({
    type: 'card', title: card.name, rect: [24 + i * 416, 24, 400, 128],
    roles: { Values: [binding(card, 'Measure')] },
  }));
  visuals.push({
    type: design.chart === 'bar' ? 'barChart' : 'lineChart',
    title: design.value.name + ' by ' + design.category.name, rect: [24, 172, 932, 524],
    roles: { Category: [binding(design.category, 'Column')], Y: [binding(design.value, 'Measure')] },
  }, {
    type: 'slicer', title: design.slicer.name, rect: [976, 172, 280, 524],
    roles: { Values: [binding(design.slicer, 'Column')] },
  });
  const ids = [];
  for (const [index, item] of visuals.entries()) {
    const name = id();
    const [x, y, width, height] = item.rect;
    const dir = join(folder, 'visuals', name);
    mkdirSync(dir);
    const queryState = Object.fromEntries(Object.entries(item.roles).map(([role, projections]) => [role, { projections }]));
    const visual = { visualType: item.type, query: { queryState } };
    setVisualTitle(visual, item.title);
    write(join(dir, 'visual.json'), {
      $schema: reportSchema + 'visualContainer/2.0.0/schema.json', name,
      position: { x, y, width, height, z: index + 1, tabOrder: index + 1 },
      visual,
    });
    ids.push(name);
  }
  write(join(pages, 'pages.json'), { ...metadata, pageOrder: [...metadata.pageOrder, pageId], activePageName: pageId });
  return { pageId, visuals: ids };
}
