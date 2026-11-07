import { isAbsolute, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { authorDashboard, dashboardSchema, editLayout, inspect, layoutSchema, projectName, validateProject } from './projects.mjs';
import { createDemo } from './demo.mjs';

const configured = process.env.POWERBI_MCP_ROOT;
if (configured && !isAbsolute(configured)) throw Error('POWERBI_MCP_ROOT must be an absolute path.');
const root = configured ?? resolve('workspace');
const server = new McpServer({ name: 'powerbi-local-mcp', version: '0.1.0' });

function tool(name, description, inputSchema, readOnlyHint, action) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false } }, async args => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await action(args)) }] };
    } catch (error) {
      const detail = error.code ? 'Project files were missing or could not be accessed.' :
        error.name === 'ZodError' ? 'Invalid tool arguments.' :
        error.name === 'SyntaxError' || error.name === 'TypeError' ? 'Invalid Power BI project definition.' : error.message;
      return { isError: true, content: [{ type: 'text', text: detail }] };
    }
  });
}

tool('create_retail_demo', 'Create a fully synthetic retail sales PBIP. No source connection or credentials needed.',
  {}, false, () => createDemo(root));
tool('inspect_project', 'List visible model fields and existing pages and visual bindings in a local PBIP with model.bim.',
  { name: projectName }, true, ({ name }) => inspect(root, name));
tool('create_dashboard', 'Add three KPI cards, a chart and a slicer in a new validated copy. Use inspect_project first; the source is not changed.',
  dashboardSchema.shape, false, args => authorDashboard(root, args));
tool('edit_layout', 'Change the titles or positions of existing ungrouped visuals in a new validated copy. Keeps field bindings and filters.',
  layoutSchema.shape, false, args => editLayout(root, args));
tool('validate_report', 'Run Microsoft PBIR structural validation on a local report. Does not evaluate report data.',
  { name: projectName }, true, ({ name }) => validateProject(root, name));

await server.connect(new StdioServerTransport());
