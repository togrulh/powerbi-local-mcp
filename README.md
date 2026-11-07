# Power BI Local MCP

Describe a dashboard in plain language. An MCP client uses this local server to bind existing measures and columns to Power BI visuals. The server creates a validated **new project copy** without opening Power BI Desktop or changing the source.

## Try the retail demo

Open [RetailDemo.pbip](examples/RetailDemo/RetailDemo.pbip) in a recent Power BI Desktop. On the first open, choose **Home > Refresh** to load the embedded sample. No database, account, or credentials are needed. The 36 fictional rows cover 12 months and three sales channels. The expected totals are **399,426 revenue**, **9,126 orders**, and **43.77 average order value**.

For the full MCP workflow, install Node.js 22 or newer, then run these commands from the repository:

```sh
npm ci
npm test
npm run demo
```

The last command creates `workspace/RetailDemo/RetailDemo.pbip`. Alternatively, call `create_retail_demo` after connecting an MCP client. Both refuse to overwrite an existing demo.

## Connect an MCP client

Configure a local **stdio** server in your MCP-capable client. For clients that use an `mcpServers` JSON file:

```json
{
  "mcpServers": {
    "powerbi-local": {
      "command": "node",
      "args": ["C:/path/to/powerbi-local-mcp/src/server.mjs"],
      "env": { "POWERBI_MCP_ROOT": "C:/path/to/powerbi-local-mcp/workspace" }
    }
  }
}
```

Use absolute paths for both values. The server does not listen on a port. The client interprets plain language; the server runs the structured actions.

> Inspect RetailDemo. Make a new project named SalesReview with Revenue, Orders and Average order value cards, a monthly Revenue line chart and a Channel filter.

The client calls `inspect_project`, then `create_dashboard`, and can call `validate_report` on the result. To adjust an existing layout, use `edit_layout` to change visual titles, sizes or positions in a separate copy. Open `SalesReview/SalesReview.pbip` in Desktop to view it.

## Bring your own report

Put one project in a folder under the configured workspace, with its folder and `.pbip` sharing a name. This release requires the **enhanced PBIR** report format and a **TMSL `model.bim`** local semantic model. It does not inspect TMDL models or remotely bound semantic models. The first release creates new pages using three cards, a line or bar chart, and a slicer.

The server does not create measures, refresh a database, convert to PBIX, or deploy to Fabric. Power BI Desktop is needed for rendering and PBIX export. Report validation may fetch public Microsoft JSON schemas; it does not need your database or a Fabric account. External source paths are not rewritten in authored copies.

## Data and safety

The repository demo is generated from scratch, contains no real business data, and has no external data source. The server rejects path traversal and project symlinks, does not overwrite projects, and omits local Power BI cache files when making copies. Keep only trusted projects in the configured folder. Power Query and DAX definitions in a source project are carried over unchanged; **review a project's definitions before sharing it**. Tool output includes field names and visual bindings that an MCP client may send to its model.

This is an independent project, not a Microsoft product. It uses Microsoft's [Power BI report authoring toolkit](https://github.com/microsoft/skills-for-fabric) for structural validation.
