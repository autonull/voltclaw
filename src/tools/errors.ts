export function formatToolError(tool: string, error: unknown, args?: Record<string, unknown>): string {
  // File system errors



// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'ENOENT') {











// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const path = args?.path || args?.file || 'unknown';
    return `File not found: ${path}`;

  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'EACCES') {













// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const path = args?.path || args?.file || 'unknown';
    return `Permission denied: ${path}`;
  }



// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'EISDIR') {

    return `Expected file but found directory: ${args?.path}`;
  }





// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'ENOTDIR') {
    return `Expected directory but found file: ${args?.path}`;


  }

  // Network errors




// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'ECONNREFUSED') {



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    return `Connection refused: ${args?.url || 'unknown host'}`;
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'ETIMEDOUT') {

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    return `Connection timed out: ${args?.url || 'unknown host'}`;
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any).code === 'ENOTFOUND') {
    return `Host not found: ${args?.url}`;
  }

  // HTTP errors













































// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any
  if ((error as any).status) {









// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (error as any).status;
    const statusMessages: Record<number, string> = {
      400: 'Bad request',
      401: 'Unauthorized - check API key',
      403: 'Forbidden - insufficient permissions',
      404: 'Not found',

      429: 'Rate limited - try again later',
      500: 'Server error',
      502: 'Bad gateway',
      503: 'Service unavailable'
    };

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    return `HTTP ${status}: ${statusMessages[status] || 'Unknown error'}`;
  }

  // Generic error
  const message = error instanceof Error ? error.message : String(error);
  return `${tool} failed: ${message}`;
}















































