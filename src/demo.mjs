import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDashboard, schemas } from './pbir.mjs';
import { publish, writeJson, writePlatform } from './projects.mjs';

export function salesRows() {
  const channels = ['Online', 'Store', 'Partner'];
  const prices = [42, 38, 46];
  return Array.from({ length: 12 }, (_, m) => channels.map((channel, c) => {
    const orders = 118 + 17 * m + 35 * c + (m % 3) * 7;
    return ['2025-' + String(m + 1).padStart(2, '0'), channel, orders, orders * (prices[c] + m % 4)];
  })).flat();
}

function retailModel() {
  const columns = [['Month', 'string'], ['Channel', 'string'], ['OrderCount', 'int64'], ['RevenueAmount', 'int64']]
    .map(([name, dataType]) => ({ name, dataType, sourceColumn: name, summarizeBy: 'none' }));
  columns.push({ name: 'Month label', type: 'calculated', dataType: 'string', summarizeBy: 'none',
    sortByColumn: 'Month', expression: 'FORMAT(DATE(2000, VALUE(RIGHT(Sales[Month], 2)), 1), "mmm", "en-US")' }, {
    name: 'Quarter', type: 'calculated', dataType: 'string', summarizeBy: 'none',
    expression: '"Q" & ROUNDUP(VALUE(RIGHT(Sales[Month], 2)) / 3, 0)',
  });
  const measures = [
    { name: 'Revenue', expression: 'SUM(Sales[RevenueAmount])', formatString: '#,0' },
    { name: 'Orders', expression: 'SUM(Sales[OrderCount])', formatString: '#,0' },
    { name: 'Average order value', expression: 'DIVIDE([Revenue], [Orders])', formatString: '#,0.00' },
    { name: 'Q4 vs Q3 revenue', formatString: '+0.0%;-0.0%;0.0%', expression: [
      'VAR Q3Revenue = CALCULATE([Revenue], Sales[Month] IN {"2025-07", "2025-08", "2025-09"})',
      'VAR Q4Revenue = CALCULATE([Revenue], Sales[Month] IN {"2025-10", "2025-11", "2025-12"})',
      'RETURN DIVIDE(Q4Revenue - Q3Revenue, Q3Revenue)',
    ] },
  ];
  const m = ['#table(type table [Month = text, Channel = text, OrderCount = Int64.Type, RevenueAmount = Int64.Type], {',
    ...salesRows().map((row, i, all) => '    {' + row.map(v => typeof v === 'string' ? JSON.stringify(v) : v).join(', ') +
      '}' + (i === all.length - 1 ? '' : ',')), '})'];
  return { name: 'RetailDemo', compatibilityLevel: 1604, model: {
    culture: 'en-US', defaultPowerBIDataSourceVersion: 'powerBI_V3',
    tables: [{ name: 'Sales', columns, measures, partitions: [{ name: 'Sales', mode: 'import', source: { type: 'm', expression: m } }] }],
  } };
}

export async function createDemo(root) {
  return publish(root, 'RetailDemo', folder => {
    const reportPart = 'RetailDemo.Report';
    const modelPart = 'RetailDemo.SemanticModel';
    const report = join(folder, reportPart);
    const model = join(folder, modelPart);
    const definition = join(report, 'definition');
    const pages = join(definition, 'pages');
    const schema = schemas + 'item/report/';
    mkdirSync(pages, { recursive: true });
    mkdirSync(model);
    writePlatform(report, 'RetailDemo', 'Report');
    writePlatform(model, 'RetailDemo', 'SemanticModel');
    writeJson(join(folder, 'RetailDemo.pbip'), {
      $schema: schemas + 'pbip/pbipProperties/1.0.0/schema.json', version: '1.0',
      artifacts: [{ report: { path: reportPart } }], settings: { enableAutoRecovery: true },
    });
    writeJson(join(report, 'definition.pbir'), {
      $schema: schema + 'definitionProperties/2.0.0/schema.json', version: '4.0',
      datasetReference: { byPath: { path: '../' + modelPart } },
    });
    writeJson(join(definition, 'version.json'), {
      $schema: schema + 'definition/versionMetadata/1.0.0/schema.json', version: '2.0.0',
    });
    writeJson(join(definition, 'report.json'), {
      $schema: schema + 'definition/report/3.3.0/schema.json', themeCollection: {},
    });
    writeJson(join(model, 'definition.pbism'), {
      $schema: schemas + 'item/semanticModel/definitionProperties/1.0.0/schema.json', version: '4.0', settings: { qnaEnabled: false },
    });
    writeJson(join(model, 'model.bim'), retailModel());
    const ref = name => ({ table: 'Sales', name });
    return addDashboard(pages, { $schema: schema + 'definition/pagesMetadata/1.0.0/schema.json', pageOrder: [] }, {
      page: 'Retail performance', cards: ['Revenue', 'Orders', 'Average order value', 'Q4 vs Q3 revenue'].map(ref),
      category: ref('Month label'), value: ref('Revenue'), slicer: ref('Channel'), chart: 'line',
      retailOverview: { quarter: ref('Quarter') },
    }, writeJson);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? process.env.POWERBI_MCP_ROOT ?? 'workspace');
  try {
    console.log(JSON.stringify(await createDemo(root), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
