import { readdir } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { TOOLS_DIR } from '../core/bootstrap.js';
import type { Tool } from './types.js';
import type { CodeExecConfig } from './code_exec.js';

import { timeTool, dateTool, sleepTool } from './time.js';
import { estimateTokensTool } from './call.js';
import { httpGetTool, httpPostTool } from './http.js';
import { readFileTool, writeFileTool, listFilesTool } from './files.js';
import { restartTool } from './restart.js';
import { createCodeExecTool } from './code_exec.js';

async function loadUserTools(): Promise<Tool[]> {
  const tools: Tool[] = [];
  try {
    const files = await readdir(TOOLS_DIR);
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.mjs')) {
        try {
          const modulePath = pathToFileURL(join(TOOLS_DIR, file)).href;
          const module = await import(modulePath);

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (module.default && typeof module.default === 'object' && 'execute' in module.default) {
            tools.push(module.default as Tool);
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          } else if (module.tool && typeof module.tool === 'object' && 'execute' in module.tool) {
            tools.push(module.tool as Tool);
          }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return tools;
}

export function createBuiltinTools(config?: { rlm?: CodeExecConfig }): Tool[] {
  return [
    timeTool,
    dateTool,
    sleepTool,
    estimateTokensTool,
    httpGetTool,
    httpPostTool,
    readFileTool,
    writeFileTool,
    listFilesTool,
    restartTool,
    createCodeExecTool(config?.rlm)
  ];
}

export async function createAllTools(config?: { rlm?: CodeExecConfig }): Promise<Tool[]> {
    const builtins = createBuiltinTools(config);
    const userTools = await loadUserTools();
    return [...builtins, ...userTools];
}
