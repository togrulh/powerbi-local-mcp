import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const schemas = 'https://developer.microsoft.com/json-schemas/fabric/';
const reportSchema = schemas + 'item/report/definition/';
const id = () => randomBytes(10).toString('hex');
const literal = Value => ({ expr: { Literal: { Value } } });
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const atom = value => literal(typeof value === 'string' ? quote(value) :
  typeof value === 'number' ? value + 'D' : String(value));
const fill = hex => ({ solid: { color: atom(hex) } });
const props = values => [{ properties: Object.fromEntries(Object.entries(values)
  .map(([key, value]) => [key, typeof value === 'object' ? value : atom(value)])) }];
const palette = { ink: '#18282D', muted: '#4C626A', page: '#EFF4F3', border: '#D3E0DD',
  white: '#FFFFFF', accent: '#087F73', blue: '#4F6595', light: '#C3DAD7' };
const font = 'Segoe UI';

function style(visual, item) {
  const container = visual.visualContainerObjects ??= {};
  const objects = visual.objects ??= {};
  if (item.type === 'textbox') {
    container.background = props({ show: true, color: fill(palette.ink), transparency: 0 });
    container.padding = props({ top: 12, bottom: 10, left: 17, right: 17 });
    objects.general = [{ properties: { paragraphs: item.lines.map(([value, size, color, weight]) => ({
      horizontalTextAlignment: 'left',
      textRuns: [{ value, textStyle: { fontFamily: font, fontSize: size + 'px', color, fontWeight: weight } }],
    })) } }];
    return;
  }
  container.background = props({ show: true, color: fill(palette.white), transparency: 0 });
  container.border = props({ show: true, color: fill(palette.border), radius: 6, width: 1 });
  container.padding = props({ top: 9, bottom: 8, left: 13, right: 13 });
  container.title = props({ show: true, text: item.title, fontFamily: font, fontSize: 14,
    bold: true, fontColor: fill(palette.ink), heading: 'Heading2', titleWrap: true });
  if (item.type === 'card') {
    objects.labels = props({ fontFamily: 'Segoe UI Semibold', fontSize: 32,
      color: fill(item.valueColor ?? palette.accent), labelDisplayUnits: 1 });
    objects.categoryLabels = props({ show: false });
  } else if (item.type === 'slicer') {
    if (item.dropdown) objects.data = props({ mode: 'Dropdown' });
    objects.header = props({ show: false });
    objects.items = props({ fontFamily: font, textSize: 11, fontColor: fill(palette.ink) });
  } else {
    const axis = { showAxisTitle: false, fontSize: 10, labelColor: fill(palette.muted) };
    objects.categoryAxis = props(axis);
    objects.valueAxis = props({ ...axis, gridlineColor: fill(palette.border) });
    objects.dataPoint = props({ defaultColor: fill(item.type === 'lineChart' ? palette.accent : palette.blue) });
    if (item.type === 'lineChart') {
      objects.lineStyles = props({ strokeWidth: 3, showMarker: true, markerSize: 5 });
    } else {
      objects.labels = props({ show: true, fontSize: 10, labelPosition: 'OutsideEnd', color: fill(palette.ink),
        ...(item.exactLabels && { labelDisplayUnits: 1 }) });
    }
  }
}

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
  const retail = Boolean(design.retailOverview);
  mkdirSync(join(folder, 'visuals'), { recursive: true });
  write(join(folder, 'page.json'), {
    $schema: reportSchema + 'page/2.1.0/schema.json', name: pageId,
    displayName: design.page, displayOption: 'FitToPage', width: 1280, height: retail ? 600 : 720,
    objects: { background: props({ color: fill(palette.page), transparency: 0 }),
      outspace: props({ color: fill(palette.page), transparency: 0 }) },
  });
  const slicer = {
    type: 'slicer', title: retail ? 'Sales channel' : design.slicer.name, dropdown: retail,
    rect: retail ? [974, 20, 286, 84] : [976, 172, 280, 524],
    roles: { Values: [binding(design.slicer, 'Column')] },
  };
  const visuals = design.cards.map((card, i) => ({
    type: 'card', title: card.name, rect: retail ? [20 + i * 314, 120, 298, 102] : [24 + i * 416, 24, 400, 128],
    valueColor: retail && i === 3 ? palette.blue : undefined,
    roles: { Values: [binding(card, 'Measure')] },
  }));
  if (retail) visuals.unshift({ type: 'textbox', rect: [20, 20, 938, 84], lines: [
    ['Retail performance', 30, palette.white, 'bold'],
    ['FY 2025  |  JAN-DEC  |  SYNTHETIC DATA', 12, palette.light, 'normal'],
  ] }, slicer);
  visuals.push({
    type: design.chart === 'bar' ? 'barChart' : 'lineChart',
    title: retail ? 'Monthly revenue' : design.value.name + ' by ' + design.category.name,
    rect: retail ? [20, 238, 778, 342] : [24, 172, 932, 524],
    roles: { Category: [binding(design.category, 'Column')], Y: [binding(design.value, 'Measure')] },
    sort: design.chart === 'line' ? { field: binding(design.category, 'Column').field, direction: 'Ascending' } : undefined,
  });
  if (!retail) visuals.push(slicer);
  if (retail) visuals.push({
    type: 'barChart', title: 'Revenue by channel', rect: [814, 238, 446, 342], exactLabels: true,
    roles: { Category: [binding(design.slicer, 'Column')], Y: [binding(design.value, 'Measure')] },
    sort: { field: binding(design.value, 'Measure').field, direction: 'Descending' },
  });
  const ids = [];
  for (const [index, item] of visuals.entries()) {
    const name = id();
    const [x, y, width, height] = item.rect;
    const dir = join(folder, 'visuals', name);
    mkdirSync(dir);
    const visual = { visualType: item.type };
    if (item.roles) visual.query = {
      queryState: Object.fromEntries(Object.entries(item.roles).map(([role, projections]) => [role, { projections }])),
      ...(item.sort && { sortDefinition: { sort: [item.sort], isDefaultSort: false } }),
    };
    style(visual, item);
    write(join(dir, 'visual.json'), {
      $schema: reportSchema + 'visualContainer/' + (item.type === 'textbox' ? '2.9.0' : '2.0.0') + '/schema.json', name,
      position: { x, y, width, height, z: index + 1, tabOrder: index + 1 },
      visual,
    });
    ids.push(name);
  }
  write(join(pages, 'pages.json'), { ...metadata, pageOrder: [...metadata.pageOrder, pageId], activePageName: pageId });
  return { pageId, visuals: ids };
}
