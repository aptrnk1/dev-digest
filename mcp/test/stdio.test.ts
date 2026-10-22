import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('stdio entry', () => {
  it('serves tools over stdio and reports an unreachable API', async () => {
    const transport = new StdioClientTransport({
      command: path.join(root, 'node_modules/.bin/tsx'),
      args: ['--tsconfig', 'tsconfig.json', 'src/index.ts'],
      cwd: root,
      env: { ...process.env, DEVDIGEST_API_URL: 'http://127.0.0.1:1' } as Record<string, string>,
      stderr: 'pipe',
    });
    const client = new Client({ name: 't', version: '0' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(5);
      const r = await client.callTool({ name: 'list_agents', arguments: {} });
      expect(r.isError).toBe(true);
      expect((r.content as Array<{ text: string }>)[0]!.text).toContain(
        'DevDigest API is not responding at http://127.0.0.1:1',
      );
    } finally {
      await client.close();
    }
  }, 30000);
});
