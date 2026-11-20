import { afterEach, describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileHandler } from './file-handler';

const created: string[] = [];

afterEach(() => {
  for (const file of created.splice(0)) fs.rmSync(file, { force: true });
});

function handler(): FileHandler {
  return new FileHandler();
}

describe('FileHandler trust boundary', () => {
  test('rejects file names that escape or nest inside the temp directory', async () => {
    const instance = handler();
    for (const fileName of ['../../escaped.txt', 'nested/escaped.txt', '/tmp/escaped.txt']) {
      const result = await instance.handleFileRequest({
        action: 'prepareFile',
        base64Data: Buffer.from('payload').toString('base64'),
        fileName,
      });
      expect(result.success).toBe(false);
    }
    expect(fs.existsSync(path.join(os.tmpdir(), 'escaped.txt'))).toBe(false);
  });

  test('writes an accepted base64 upload inside the temp directory', async () => {
    const instance = handler();
    const fileName = `file-handler-test-${process.pid}.txt`;
    const result = await instance.handleFileRequest({
      action: 'prepareFile',
      base64Data: Buffer.from('payload').toString('base64'),
      fileName,
    });
    expect(result).toMatchObject({ success: true, fileName });
    created.push(result.filePath);
    expect(fs.readFileSync(result.filePath, 'utf8')).toBe('payload');
  });

  test('does not read arbitrary host files or clean outside the temp directory', async () => {
    const instance = handler();
    const read = await instance.handleFileRequest({
      action: 'readBase64File',
      filePath: path.join(os.homedir(), '.zshrc'),
    });
    expect(read.success).toBe(false);
    expect(read.base64Data).toBeUndefined();

    const cleanup = await instance.handleFileRequest({
      action: 'cleanupFile',
      filePath: path.join(os.tmpdir(), `chrome-mcp-uploads-evil-${process.pid}`, 'x'),
    });
    expect(cleanup.success).toBe(false);
  });
});
