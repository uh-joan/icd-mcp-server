#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createError, JsonValue } from "./util.js";
import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import 'dotenv/config';
import http from 'http';

/**
 * Logging utility for consistent log format across the application
 */
const logger = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  } as const,
  level: (process.env.LOG_LEVEL || 'info') as LogLevel,
  
  formatMessage: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    return JSON.stringify({ timestamp, level, message, ...meta });
  },

  error: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.error) {
      process.stderr.write(logger.formatMessage('error', message, meta) + '\n');
    }
  },

  warn: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.warn) {
      process.stderr.write(logger.formatMessage('warn', message, meta) + '\n');
    }
  },

  info: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.info) {
      if (!USE_HTTP) {
        process.stderr.write(logger.formatMessage('info', message, meta) + '\n');
      } else {
        process.stdout.write(logger.formatMessage('info', message, meta) + '\n');
      }
    }
  },

  debug: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.debug) {
      if (!USE_HTTP) {
        process.stderr.write(logger.formatMessage('debug', message, meta) + '\n');
      } else {
        process.stdout.write(logger.formatMessage('debug', message, meta) + '\n');
      }
    }
  }
};

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// API configuration and environment variables
const USE_HTTP = process.env.USE_HTTP === 'true';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const TRANSPORT = process.env.TRANSPORT || 'stdio';
const SSE_PATH = process.env.SSE_PATH || '/mcp';
const NLM_API_BASE_URL = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3";

// Tool definition for ICD-10-CM search
const SEARCH_ICD10CM_TOOL = {
  name: "search_icd10cm_codes",
  description: "Search for ICD-10-CM codes using the NLM API",
  input_schema: {
    type: "object",
  properties: {
      terms: { type: "string", description: "The search string for which to find matches in the list." },
      maxList: { type: "number", default: 500, description: "Specifies the number of results requested, up to the upper limit of 500." },
      count: { type: "number", default: 500, description: "The number of results to retrieve (page size)." },
      offset: { type: "number", default: 0, description: "The starting result number (0-based) to retrieve." },
      q: { type: "string", description: "An optional, additional query string used to further constrain the results." },
      df: { type: "string", default: "code,name", description: "A comma-separated list of display fields." },
      sf: { type: "string", default: "code,name", description: "A comma-separated list of fields to be searched." },
      cf: { type: "string", default: "code", description: "A field to regard as the 'code' for the returned item data." },
      ef: { type: "string", description: "A comma-separated list of additional fields to be returned for each retrieved list item." }
    },
    required: ["terms"]
  },
  responseSchema: {
    type: 'object',
    properties: {
      total: { type: 'number', description: 'Total number of results available' },
      codes: { 
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'ICD-10-CM code' },
            name: { type: 'string', description: 'Description of the diagnosis' }
            // extra fields will be added dynamically
          }
        }
      }
    }
  },
  examples: [
    {
      description: 'Returns a complete count of the 78 diagnoses that match the string "tuberc", displaying both the ICD-10-CM code and its associated term',
      usage: '{ "terms": "tuberc"}',
      response: '{ "total": 78, "codes": [{ "code": "A15.0", "name": "Tuberculosis of lung" }, { "code": "A15.4", "name": "Tuberculosis of intrathoracic lymph nodes" }, { "code": "A15.5", "name": "Tuberculosis of larynx, trachea and bronchus" }] }'
    },
    {
      description: 'Returns 7 specific respiratory tuberculosis diagnoses (A15 series) by using the q parameter to filter codes starting with "A15"',
      usage: '{ "terms": "tuberc", "q": "code:A15*" }',
      response: '{ "total": 7, "codes": [{ "code": "A15.0", "name": "Tuberculosis of lung" }, { "code": "A15.4", "name": "Tuberculosis of intrathoracic lymph nodes" }, { "code": "A15.5", "name": "Tuberculosis of larynx, trachea and bronchus" }, { "code": "A15.6", "name": "Tuberculous pleurisy" }, { "code": "A15.7", "name": "Primary respiratory tuberculosis" }, { "code": "A15.8", "name": "Other respiratory tuberculosis" }, { "code": "A15.9", "name": "Respiratory tuberculosis unspecified" }] }'
    }
  ]
};

interface ICD10CMResponse {
  total: number;
  codes: Array<[string, string]>;
  displayData: Array<[string, string]>;
}

async function searchICD10CM(
  terms: string,
  maxList: number = 500,
  count: number = 500,
  offset: number = 0,
  q?: string,
  df: string = "code,name",
  sf: string = "code,name",
  cf: string = "code",
  ef?: string
) {
  const query = new URLSearchParams({
    terms,
    maxList: maxList.toString(),
    count: count.toString(),
    offset: offset.toString(),
    df,
    sf,
    cf
  });
  if (q) {
    query.append("q", q);
  }
  if (ef) query.append("ef", ef);

  const fullUrl = `${NLM_API_BASE_URL}/search?${query.toString()}`;

  let response, raw, data;
  try {
    response = await fetch(fullUrl);
    raw = await response.text();
    data = JSON.parse(raw);
  } catch (err) {
    throw err;
  }

  // Prepare extra fields if present
  let extraFields: Record<string, any[]> = {};
  if (ef && data[2]) {
    extraFields = data[2];
  }

  let codes = [];
  try {
    codes = data[1].map((code: string, index: number) => {
      const result: any = {
        code,
        name: Array.isArray(data[3]?.[index]) ? data[3][index][1] : undefined
      };
      // Attach extra fields if present
      if (extraFields && Object.keys(extraFields).length > 0) {
        for (const [field, values] of Object.entries(extraFields)) {
          result[field] = values[index];
        }
      }
      return result;
    });
  } catch (err) {
    throw err;
  }
  return {
    total: data[0],
    codes
  };
}

function sendError(res: http.ServerResponse, message: string, code: number = 400) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, code }));
}

async function runServer() {
  if (USE_HTTP) {
    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const method = req.method || '';
      const url = req.url || '';

      // Health check endpoint
      if (method === 'GET' && url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // List tools endpoint
      if (method === 'POST' && url === '/list_tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          tools: [
            {
              name: 'search_icd10cm_codes',
              description: SEARCH_ICD10CM_TOOL.description,
              schema: [
                { name: 'terms', type: 'string', description: 'Search terms (code or name) to find matches in the list' },
                { name: 'maxList', type: 'number', description: 'Maximum number of results to return (default: 7, max: 500)', default: 7 }
              ]
            }
          ]
        }));
        return;
      }

      // Helper to parse JSON body
      const parseBody = (req: http.IncomingMessage) => new Promise<any>((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: any) => { body += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });

      // Routing for all tools
      if (method === 'POST') {
        let data: any;
        let result: any;
        try {
          data = await parseBody(req);
          const url = req.url || '';
          if (url === '/search_icd10cm_codes') {
            result = await searchICD10CM(data.terms, data.maxList, data.count, data.offset, data.q, data.df, data.sf, data.cf, data.ef);
          } else {
            sendError(res, 'Not found', 404);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          sendError(res, err instanceof Error ? err.message : String(err));
        }
      } else {
        sendError(res, 'Not found', 404);
      }
    });
    server.listen(PORT, () => {
      // Server is running
    });
    return;
  }
  
  // MCP mode (stdio only)
  const server = new Server(
    {
      name: 'icd10cm',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Set up request handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [SEARCH_ICD10CM_TOOL]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params?.name;
    const args = request.params?.arguments ?? {};
    try {
      switch (toolName) {
        case 'search_icd10cm_codes': {
          const a = args as any;
          const result = await searchICD10CM(a.terms, a.maxList, a.count, a.offset, a.q, a.df, a.sf, a.cf, a.ef);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        default:
          throw new McpError(-32603, 'Unknown tool');
      }
      } catch (error) {
      throw new McpError(-32603, error instanceof Error ? error.message : String(error));
    }
  });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((error) => {
  logger.error('Server error:', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
