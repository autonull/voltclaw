import type { Tool } from '../core/types.js';
import type { DocumentationManager } from '../core/documentation.js';
import fs from 'fs/promises';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { VOLTCLAW_DIR } from '../core/bootstrap.js';

export function createDocumentationTools(manager: DocumentationManager): Tool[] {
  return [
    {
      name: 'document_tool',
      description: 'Generates documentation for a tool from its source code.',
      parameters: {
        type: 'object',
        properties: {
          toolName: {
            type: 'string',
            description: 'Name of the tool to document'
          },
          sourcePath: {
            type: 'string',
            description: 'Path to source file (optional, defaults to src/tools/{toolName}.ts)'
          }
        },
        required: ['toolName']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args: Record<string, unknown>) => {
        const toolName = args.toolName as string;
        const sourcePathArg = args.sourcePath as string | undefined;
        try {
          const cwd = process.cwd();
          let sourcePath: string | undefined = sourcePathArg;

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (!sourcePath) {
            const candidate = path.join(cwd, 'src', 'tools', `${toolName}.ts`);
            try {
                await fs.access(candidate);
                sourcePath = candidate;
            } catch {
                return { error: `Source file not found for ${toolName} at ${candidate}. Please specify sourcePath.` };
            }
          }

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const content = await fs.readFile(sourcePath!, 'utf-8');
          const docs = await manager.generateToolDocumentation(toolName, content);

          const docDir = path.join(cwd, 'docs', 'tools');
          await fs.mkdir(docDir, { recursive: true });

          const docPath = path.join(docDir, `${toolName}.md`);
          await fs.writeFile(docPath, docs);

          return { result: `Documentation written to ${docPath}` };
        } catch (error) {
          return { error: String(error) };
        }
      }
    },
    {
      name: 'explain_code',
      description: 'Explains a code snippet from a file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file'
          },
          startLine: {
            type: 'number',
            description: 'Start line number (1-based, optional)'
          },
          endLine: {
            type: 'number',
            description: 'End line number (1-based, optional)'
          }
        },
        required: ['filePath']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.filePath as string;
        const startLine = args.startLine as number | undefined;
        const endLine = args.endLine as number | undefined;
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          let snippet = content;

          if (startLine !== undefined && endLine !== undefined) {
            const lines = content.split('\n');
            snippet = lines.slice(startLine - 1, endLine).join('\n');
          }

          const explanation = await manager.generateCodeExplanation(snippet);
          return { result: explanation };
        } catch (error) {
          return { error: String(error) };
        }
      }
    }
  ];
}