import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('an MCP client can create, inspect, author and validate the demo', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pbi-mcp-client-'));
  const client = new Client({ name: 'retail-backtest', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
      env: { ...process.env, POWERBI_MCP_ROOT: root },
    }));
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'create_dashboard'));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 95000 });
      assert.ok(!result.isError, result.content[0]?.text);
      return JSON.parse(result.content[0].text);
    };
    assert.equal((await call('create_retail_demo', {})).validation.errors, 0);
    const source = await call('inspect_project', { name: 'RetailDemo' });
    const ref = name => ({ table: source.tables[0].name, name });
    const result = await call('create_dashboard', {
      source: 'RetailDemo', name: 'RetailReview', page: 'Channel review', chart: 'bar',
      cards: source.tables[0].measures.map(ref), value: ref('Revenue'),
      category: ref('Channel'), slicer: ref('Month'),
    });
    assert.equal(result.visuals.length, 5);
    assert.equal((await call('validate_report', { name: 'RetailReview' })).errors, 0);
    const copy = await call('inspect_project', { name: 'RetailReview' });
    assert.equal(copy.pages[1].visuals[3].type, 'barChart');
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
