import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './compose.js';

// stdout carries protocol frames only; all logs go to stderr.
const baseUrl = process.env['DEVDIGEST_API_URL'] || 'http://localhost:3001';
const server = createServer({ baseUrl });
await server.connect(new StdioServerTransport());
console.error(`[devdigest-mcp] ready, API ${baseUrl}`);
