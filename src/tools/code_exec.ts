import vm from 'vm';
import { Tool } from '../core/types.js';
import { createRLMGlobals } from './rlm-helpers.js';

export interface CodeExecConfig {
  rlmTimeoutMs?: number;
  contextSizeThreshold?: number;
}

const replContexts = new Map<string, vm.Context>();

export function createCodeExecTool(config: CodeExecConfig = {}): Tool {
  const RLM_CALL_TIMEOUT_MS = config.rlmTimeoutMs ?? 60000;
  const CONTEXT_SIZE_THRESHOLD = config.contextSizeThreshold ?? 2000;

  return {
    name: 'code_exec',
    description: 'Execute JavaScript in a persistent RLM sandbox. Globals: rlm_call(task), rlm_call_parallel(tasks), load_context(id). Context survives across calls.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JS code to run' },
        sessionId: { type: 'string', description: 'REPL session (default: task ID)' },
        contextKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Variables/files to pass to child (optional)'
        }
      },
      required: ['code']
    },

























































// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any
    async execute(args: Record<string, unknown>, agent: any, session: any, from?: string) {




      const code = args.code as string;
      const userSessionId = (args.sessionId as string) || 'default';
      // Scope the REPL session to the current agent session (e.g. subtask) to prevent collisions in RLM
















// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      const internalSessionId = session && session.id ? `${session.id}:${userSessionId}` : userSessionId;

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      const contextKeys = (args.contextKeys as string[]) || [];


      if (!replContexts.has(internalSessionId)) {




















































































// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type, @typescript-eslint/strict-boolean-expressions
        const execTool = (name: string, args: any) => agent.executeTool(name, args, session, from || 'unknown');








        // Helpers
        const fs = {


// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            read: (path: string) => execTool('read_file', { filepath: path }),


// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            write: (path: string, content: string) => execTool('write_file', { filepath: path, content }),



// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            list: (path: string = '.') => execTool('list_files', { path }),

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            stream: async function* (path: string, options: { bufferSize?: number } = {}) {
                // Primitive streaming simulation using read_file (since agent doesn't expose native streams yet)
                const result = await execTool('read_file', { filepath: path });




// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                if (result.error) throw new Error(result.error);


                const content = result.content as string;
                const bufferSize = options.bufferSize ?? 1024;


                let offset = 0;

                while (offset < content.length) {
                    yield content.slice(offset, offset + bufferSize);
                    offset += bufferSize;

                }

            }
        };

        const http = {


// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            get: (url: string) => execTool('http_get', { url }),



// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            post: (url: string, body: string) => execTool('http_post', { url, body }),
        };


        const memory = {



// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            store: (content: string, type: string) => execTool('memory_store', { content, type }),

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            recall: (query: string) => execTool('memory_recall', { query }),
        };

        const llm = {





// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            chat: async (prompt: string, system?: string) => {
                // Direct access to LLM via agent methods if available, otherwise via tool or fallback
                // VoltClawAgent doesn't expose a 'chat' tool directly, but we can access `agent.query` if we cast `agent`.
                // However, `agent` passed here IS the VoltClawAgent instance usually.
                // But `execute` signature says `agent: any`.



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                if (agent && typeof agent.query === 'function') {
                    // This creates a new top-level query or sub-context?


                    // Ideally we want a lightweight chat without full agent loop overhead if possible,
                    // but agent.query is the standard way.

                    // Or we can use `agent.llm.chat` directly?
                    // Accessing `agent.llm` requires `agent` to be `VoltClawAgent`.


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                    if (agent.llm && typeof agent.llm.chat === 'function') {


                        const messages = [];

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                        if (system) messages.push({ role: 'system', content: system });
                        messages.push({ role: 'user', content: prompt });
                        const res = await agent.llm.chat(messages);
                        return res.content;
                    }
                }
                throw new Error('LLM access not available');

            },



// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            embed: async (text: string) => {










// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                if (agent && agent.llm && typeof agent.llm.embed === 'function') {
                    return await agent.llm.embed(text);
                }
                throw new Error('Embedding not available');
            }
        };


        // Create a context object with all the functionality

// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctxObj: any = {
          // Global aliases (legacy but useful)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
          read_file: (args: any) => execTool('read_file', args),


// eslint-disable-next-line @typescript-eslint/no-explicit-any
          write_file: (args: any) => execTool('write_file', args),

// eslint-disable-next-line @typescript-eslint/no-explicit-any
          http_get: (args: any) => execTool('http_get', args),

          // Industrial Namespaces (Globals)
          fs,
          http,
          memory,
          llm,



          // VoltClaw Namespace (Legacy/Scoped)
          voltclaw: {

              agent, // Power user access
              fs,
              http,
              memory,
              llm
          },

          // Basic console
          console: {




// eslint-disable-next-line @typescript-eslint/no-explicit-any
              log: (...args: any[]) => {
                  const ctx = replContexts.get(internalSessionId);
                  const msg = args.map(String).join(' ');











































// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any
                  if (ctx && (ctx as any).__log_collector) {


// eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (ctx as any).__log_collector.push(msg);
                  }

                  // Stream log if agent channel is available











// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                  if (agent && agent.channel) {
                      const payload = JSON.stringify({
                          type: 'subtask_log',
                          subId: session.id,

                          taskId: session.id,
                          message: msg,
                          level: 'info'
                      });
                      agent.channel.send(agent.channel.identity.publicKey, payload).catch(() => {});
                  }
              },

// eslint-disable-next-line @typescript-eslint/no-explicit-any
              error: (...args: any[]) => {
                  const ctx = replContexts.get(internalSessionId);
                  const msg = '[ERROR] ' + args.map(String).join(' ');
















































// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any
                  if (ctx && (ctx as any).__log_collector) {


// eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (ctx as any).__log_collector.push(msg);

                  }











// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                  if (agent && agent.channel) {
                      const payload = JSON.stringify({

                          type: 'subtask_log',
                          subId: session.id,
                          taskId: session.id,
                          message: msg,

                          level: 'error'
                      });
                      agent.channel.send(agent.channel.identity.publicKey, payload).catch(() => {});

                  }
              }

          }
        };



        // Helper to resolve RLM references














































// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type
        const resolveRLMRef = async (result: any) => {



              let output = result;
              // Transparently resolve RLM Reference

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
              if (typeof output === 'string' && output.startsWith('[RLM_REF:') && agent.memory) {
                   const refId = output.slice(9, -1);
                   try {
                       const entries = await agent.memory.recall({ id: refId });

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                       if (entries && entries.length > 0) {







// eslint-disable-next-line @typescript-eslint/no-explicit-any
                           entries.sort((a: any, b: any) => {

// eslint-disable-next-line @typescript-eslint/no-explicit-any
                               const idxA = (a.metadata as any)?.chunkIndex ?? 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
                               const idxB = (b.metadata as any)?.chunkIndex ?? 0;

                               return idxA - idxB;
                           });


// eslint-disable-next-line @typescript-eslint/no-explicit-any
                           output = entries.map((e: any) => e.content).join('');
                       }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
                   } catch (e) {
                       // ignore
                   }

              }

              if (typeof output === 'string') {
                  try {
                     return JSON.parse(output);
                  } catch {
                     return output;
                  }
              }
              return output;
        };

        // Inject RLM globals
        const rlmGlobals = createRLMGlobals(
            agent,
            session,
            internalSessionId,
            contextKeys,
            resolveRLMRef,
            RLM_CALL_TIMEOUT_MS,


            CONTEXT_SIZE_THRESHOLD,
            replContexts
        );
        Object.assign(ctxObj, rlmGlobals);

        const ctx = vm.createContext(ctxObj);
        replContexts.set(internalSessionId, ctx);
      }


      const logs: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const ctx = replContexts.get(internalSessionId)!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx as any).__log_collector = logs;

      try {
        const result = vm.runInContext(code, ctx, {
          timeout: 30000 // 30s timeout for sync code execution
        });

        let output = result;

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (result && typeof result.then === 'function') {
            output = await result;
        }

        return {
          output: output,
          logs: logs.length > 0 ? logs : undefined,
          sessionId: userSessionId,
          contextSize: Object.keys(ctx).length
        };
      } catch (e) {
        return {
          error: (e as Error).message,
          logs: logs.length > 0 ? logs : undefined
        };
      }
    }
  };
}

// Export a default instance for backward compatibility if imported directly as object
export const codeExecTool = createCodeExecTool();













