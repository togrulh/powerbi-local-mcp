import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { addDashboard, schemas, setVisualTitle, visualTitle } from './pbir.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(import.meta.resolve('@microsoft/powerbi-report-authoring-cli/cli'));
const label = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/u);
const field = z.strictObject({ table: label, name: label });
const device = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i;
const plain = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9_-])?$/).refine(n => !device.test(n));
export const projectName = plain;
export const dashboardSchema = z.strictObject({
  source: plain, name: plain, page: label, cards: z.array(field).length(3),
  category: field, value: field, slicer: field, chart: z.enum(['line', 'bar']),
});
const partId = /^[a-zA-Z0-9_-]{1,80}$/;
const idInput = z.string().regex(partId);
const position = z.strictObject({ x: z.number().min(0), y: z.number().min(0),
  width: z.number().positive(), height: z.number().positive() });
export const layoutSchema = z.strictObject({ source: plain, name: plain, pageId: idInput,
  changes: z.array(z.strictObject({ id: idInput, title: label.optional(), position: position.optional() })
    .refine(change => change.title !== undefined || change.position !== undefined)).min(1).max(30) });
const ignore = name => /^(?:\.|desktop\.ini$|thumbs\.db$|~\$)/i.test(name) ||
  /\.(?:pbix|abf|pfx|p12|pem|key|log)$/i.test(name);
const child = (root, ...parts) => join(root, ...parts);
const json = file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(checked(file, false))));
export const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');

export function writePlatform(folder, displayName, type) {
  writeJson(join(folder, '.platform'), {
    $schema: schemas + 'gitIntegration/platformProperties/2.0.0/schema.json',
    metadata: { type, displayName }, config: { version: '2.0', logicalId: randomUUID() },
  });
}

function checked(file, directory) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) throw Error('Linked project paths are not allowed.');
  if (!(directory ? stat.isDirectory() : stat.isFile())) throw Error('Unexpected project path type.');
  return file;
}

function component(input, suffix) {
  if (typeof input !== 'string' || !input.endsWith(suffix)) throw Error('Expected a standard local PBIP component.');
  plain.parse(input.slice(0, -suffix.length));
  return input;
}

function locate(folder, name) {
  const pbip = checked(join(folder, name + '.pbip'), false);
  const items = json(pbip).artifacts;
  if (!Array.isArray(items) || items.length !== 1) throw Error('Expected a PBIP with one local report.');
  const reportPart = component(items[0].report?.path, '.Report');
  const report = checked(join(folder, reportPart), true);
  const binding = json(join(report, 'definition.pbir')).datasetReference?.byPath?.path;
  if (typeof binding !== 'string' || !/^\.\.[/\\]/.test(binding)) throw Error('Expected a local, sibling semantic model.');
  const modelPart = component(binding.slice(3), '.SemanticModel');
  const model = checked(join(folder, modelPart), true);
  checked(join(model, 'definition.pbism'), false);
  const pages = checked(join(checked(join(report, 'definition'), true), 'pages'), true);
  return { pbip, report, model, pages, reportPart, modelPart };
}

function sourceProject(root, name) {
  return locate(checked(join(realpathSync(root), plain.parse(name)), true), name);
}

function metadata(p) {
  const file = join(p.pages, 'pages.json');
  const pageMeta = json(file);
  if (!Array.isArray(pageMeta.pageOrder) || !pageMeta.pageOrder.every(id => typeof id === 'string' && partId.test(id)) ||
      new Set(pageMeta.pageOrder).size !== pageMeta.pageOrder.length) throw Error('Invalid page IDs.');
  return pageMeta;
}

function fields(p) {
  const bim = join(p.model, 'model.bim');
  if (!existsSync(bim)) throw Error('This release requires a TMSL model.bim semantic model.');
  const list = json(bim).model?.tables;
  if (!Array.isArray(list)) throw Error('Invalid tabular model definition.');
  return list.filter(t => !t.isHidden).map(t => ({ name: t.name,
    columns: (t.columns ?? []).filter(c => !c.isHidden).map(c => c.name),
    measures: (t.measures ?? []).filter(m => !m.isHidden).map(m => m.name) }));
}

export function inspect(root, name) {
  const p = sourceProject(root, name);
  const pages = metadata(p).pageOrder.map(id => {
    const dir = checked(join(p.pages, id), true);
    const doc = json(join(dir, 'page.json'));
    const visualDir = join(dir, 'visuals');
    const visuals = existsSync(visualDir) ? readdirSync(checked(visualDir, true), { withFileTypes: true })
      .filter(e => partId.test(e.name) && (e.isDirectory() || e.isSymbolicLink())).map(e => {
        const v = json(join(checked(join(visualDir, e.name), true), 'visual.json'));
        return { id: v.name, type: v.visual?.visualType ?? 'group', title: visualTitle(v.visual), position: v.position,
          fields: Object.values(v.visual?.query?.queryState ?? {}).flatMap(r => (r.projections ?? []).map(f => f.queryRef)) };
      }).sort((a, b) => (a.position?.z ?? 0) - (b.position?.z ?? 0) || a.id.localeCompare(b.id)) : [];
    return { id, title: doc.displayName, visuals };
  });
  return { tables: fields(p), pages };
}

function walk(from, to, validateSchemas = false) {
  checked(from, true);
  if (to) mkdirSync(to);
  for (const entry of readdirSync(from)) {
    if (ignore(entry)) continue;
    const source = child(from, entry);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw Error('Linked project files are not allowed.');
    if (stat.isDirectory()) walk(source, to && child(to, entry), validateSchemas);
    else if (stat.isFile()) {
      if (validateSchemas && /\.(?:json|pbir)$/i.test(entry)) {
        const doc = json(source);
        if (doc?.$schema !== undefined && (typeof doc.$schema !== 'string' ||
            !doc.$schema.startsWith(schemas) || !/^[a-zA-Z0-9/._-]+$/.test(doc.$schema.slice(schemas.length)) ||
            doc.$schema.includes('..'))) throw Error('Unexpected schema reference.');
      }
      if (to) copyFileSync(source, child(to, entry));
    } else throw Error('Unexpected project file type.');
  }
}

export async function validateLocated(p) {
  walk(p.report, null, true);
  const options = { timeout: 90000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  let stdout;
  try {
    ({ stdout } = await exec(process.execPath, [cli, 'validate', p.report], options));
  } catch (error) {
    stdout = error.stdout;
  }
  try {
    const result = JSON.parse(stdout).data;
    if (!result || !Number.isInteger(result.errorCount) || !Number.isInteger(result.warningCount)) throw Error();
    return { errors: result.errorCount, warnings: result.warningCount, diagnostics: Object.keys(result.diagnostics ?? {}) };
  } catch {
    throw Error('Microsoft PBIR validation could not complete.');
  }
}

export async function validateProject(root, name) {
  return validateLocated(sourceProject(root, name));
}

export async function publish(root, name, build) {
  plain.parse(name);
  mkdirSync(root, { recursive: true });
  root = realpathSync(root);
  const target = join(root, name);
  const lock = join(root, '.mcp-lock-' + name.toLowerCase());
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw Error('An authoring job is already running for this destination.');
    throw error;
  }
  let stage;
  try {
    if (existsSync(target)) throw Error('Destination already exists; choose a new project name.');
    stage = mkdtempSync(join(root, '.mcp-stage-'));
    const result = await build(stage);
    const p = locate(stage, name);
    const validation = await validateLocated(p);
    if (validation.errors) throw Error('PBIR validation rejected the generated report: ' + validation.diagnostics.join(', '));
    if (existsSync(target)) throw Error('Destination already exists; no overwrite was attempted.');
    renameSync(stage, target);
    stage = undefined;
    return { project: join(basename(target), name + '.pbip'), ...result, validation };
  } finally {
    if (stage && relative(root, stage).startsWith('.mcp-stage-') && !lstatSync(stage).isSymbolicLink()) {
      rmSync(stage, { recursive: true, force: true });
    }
    rmdirSync(lock);
  }
}

export async function authorDashboard(root, raw) {
  const design = dashboardSchema.parse(raw);
  const original = sourceProject(root, design.source);
  const inventory = new Map(fields(original).map(t => [t.name, t]));
  for (const [kind, refs] of [['measures', [...design.cards, design.value]], ['columns', [design.category, design.slicer]]]) {
    for (const ref of refs) if (!inventory.get(ref.table)?.[kind].includes(ref.name)) throw Error('Unknown visible model field.');
  }
  return cloneProject(root, original, design.name, copy => addDashboard(copy.pages, metadata(copy), design, writeJson));
}

function cloneProject(root, original, name, update) {
  return publish(root, name, stage => {
    walk(original.report, join(stage, original.reportPart));
    walk(original.model, join(stage, original.modelPart));
    writePlatform(join(stage, original.reportPart), name, 'Report');
    writePlatform(join(stage, original.modelPart), name, 'SemanticModel');
    copyFileSync(original.pbip, join(stage, name + '.pbip'));
    return update(locate(stage, name));
  });
}

const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;

export async function editLayout(root, raw) {
  const { source, name, pageId, changes } = layoutSchema.parse(raw);
  const original = sourceProject(root, source);
  if (!metadata(original).pageOrder.includes(pageId)) throw Error('Unknown page ID.');
  return cloneProject(root, original, name, copy => {
    const page = join(copy.pages, pageId);
    const { width, height } = json(join(page, 'page.json'));
    const folder = checked(join(page, 'visuals'), true);
    const files = new Map(readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && partId.test(entry.name))
      .map(entry => {
        const file = join(folder, entry.name, 'visual.json');
        return [entry.name, { file, data: json(file) }];
      }));
    const edits = new Map();
    for (const change of changes) {
      const data = files.get(change.id)?.data;
      if (!data?.visual || !data.position || data.parentGroupName) throw Error('Unknown or unsupported visual.');
      if (edits.has(change.id)) throw Error('Duplicate visual edit.');
      const next = structuredClone(data);
      if (change.position) {
        const p = change.position;
        if (!Number.isFinite(width) || !Number.isFinite(height) || p.x + p.width > width || p.y + p.height > height)
          throw Error('Visual would exceed the page bounds.');
        Object.assign(next.position, p);
      }
      if (change.title !== undefined) setVisualTitle(next.visual, change.title);
      edits.set(change.id, next);
    }
    for (const [id, after] of edits) {
      const before = files.get(id).data.position;
      for (const [otherId, { data }] of files) {
        if (id !== otherId && !data.parentGroupName && !overlaps(before, data.position) &&
            overlaps(after.position, (edits.get(otherId) ?? data).position)) throw Error('Visual edit would create an overlap.');
      }
    }
    for (const [id, data] of edits) writeJson(files.get(id).file, data);
    return { pageId, visuals: [...edits.keys()] };
  });
}
