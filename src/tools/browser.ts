import { chromium, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import type { Tool, ToolCallResult } from './types.js';
import { formatToolError } from './errors.js';

// Declare browser globals for evaluation context
declare const window: any;
declare const document: any;

let browserInstance: BrowserContext | null = null;
let pageInstance: Page | null = null;

// Ensure browser is closed on process exit
process.on('exit', async () => {
  if (browserInstance) {
    await browserInstance.close();
  }
});

const NavigateSchema = z.object({
  url: z.string().url().describe('The URL to navigate to')
});

const ClickSchema = z.object({
  selector: z.string().describe('The CSS selector to click')
});

const TypeSchema = z.object({
  selector: z.string().describe('The CSS selector to type into'),
  text: z.string().describe('The text to type')
});

const ExtractSchema = z.object({
  selector: z.string().optional().describe('The CSS selector to extract text from (optional, defaults to body)'),
  attribute: z.string().optional().describe('The attribute to extract (optional, defaults to text content)')
});

const ScreenshotSchema = z.object({
  path: z.string().optional().describe('Path to save the screenshot (optional, returns base64 if not provided)'),
  fullPage: z.boolean().optional().default(false).describe('Capture full page')
});

const ScrollSchema = z.object({
  direction: z.enum(['up', 'down', 'top', 'bottom']).describe('Scroll direction'),
  amount: z.number().optional().describe('Amount in pixels (for up/down)')
});

const WaitSchema = z.object({
  selector: z.string().optional().describe('Wait for element to appear'),
  timeout: z.number().optional().default(5000).describe('Timeout in ms')
});

const EvalSchema = z.object({
  script: z.string().describe('JavaScript code to evaluate in the page context')
});

import path from 'path';
import os from 'os';

const USER_DATA_DIR = path.join(os.homedir(), '.voltclaw', 'browser_data');

async function getPage(): Promise<Page> {
  if (!browserInstance) {
    browserInstance = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
  }
  // Persistent context has pages already, or we create one
  const pages = browserInstance.pages();
  if (pages.length > 0) {
    pageInstance = pages[0] as Page;
  } else {
    pageInstance = await browserInstance.newPage();
  }
  return pageInstance!;
}

export const browserNavigateTool: Tool = {
  name: 'browse_page',
  description: 'Navigate the browser to a URL and wait for it to load. Can be used as browser_navigate.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to navigate to' }
    },
    required: ['url']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { url } = NavigateSchema.parse(args);
      const page = await getPage();
      await page.goto(url);
      const title = await page.title();
      return { status: 'success', title, url };
    } catch (error) {
      return { error: formatToolError('browser_navigate', error, args) };
    }
  }
};

export const browserClickTool: Tool = {
  name: 'click_element',
  description: 'Click an element on the current page. Can be used as browser_click.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'The CSS selector to click' }
    },
    required: ['selector']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { selector } = ClickSchema.parse(args);
      const page = await getPage();
      await page.click(selector);
      return { status: 'success', selector };
    } catch (error) {
      return { error: formatToolError('browser_click', error, args) };
    }
  }
};

export const browserTypeTool: Tool = {
  name: 'browser_type',
  description: 'Type text into an element on the current page',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'The CSS selector to type into' },
      text: { type: 'string', description: 'The text to type' }
    },
    required: ['selector', 'text']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { selector, text } = TypeSchema.parse(args);
      const page = await getPage();
      await page.fill(selector, text);
      return { status: 'success', selector, textLength: text.length };
    } catch (error) {
      return { error: formatToolError('browser_type', error, args) };
    }
  }
};

export const browserExtractTool: Tool = {
  name: 'scrape_content',
  description: 'Extract text or attribute from an element. Can be used as browser_extract.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'The CSS selector (optional, defaults to body)' },
      attribute: { type: 'string', description: 'The attribute to extract (optional)' }
    }
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { selector, attribute } = ExtractSchema.parse(args);
      const page = await getPage();
      const targetSelector = selector || 'body';

      let content;
      if (attribute) {
        content = await page.getAttribute(targetSelector, attribute);
      } else {
        content = await page.innerText(targetSelector);
      }

      return { content: content || '' };
    } catch (error) {
      return { error: formatToolError('browser_extract', error, args) };
    }
  }
};

export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current page',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to save (optional)' },
      fullPage: { type: 'boolean', description: 'Capture full page' }
    }
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { path, fullPage } = ScreenshotSchema.parse(args);
      const page = await getPage();
      const buffer = await page.screenshot({ path, fullPage });

      if (path) {
        return { status: 'success', path };
      }

      return { status: 'success', base64: buffer.toString('base64').slice(0, 100) + '...' }; // Truncate for log
    } catch (error) {
      return { error: formatToolError('browser_screenshot', error, args) };
    }
  }
};

export const browserScrollTool: Tool = {
  name: 'browser_scroll',
  description: 'Scroll the page',
  parameters: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction' },
      amount: { type: 'number', description: 'Amount in pixels (optional)' }
    },
    required: ['direction']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { direction, amount } = ScrollSchema.parse(args);
      const page = await getPage();

      switch (direction) {
        case 'top':
          await page.evaluate(() => (window as any).scrollTo(0, 0));
          break;
        case 'bottom':
          await page.evaluate(() => (window as any).scrollTo(0, (document as any).body.scrollHeight));
          break;
        case 'up':
          await page.evaluate((y) => (window as any).scrollBy(0, -(y || 500)), amount);
          break;
        case 'down':
          await page.evaluate((y) => (window as any).scrollBy(0, y || 500), amount);
          break;
      }
      return { status: 'success', direction };
    } catch (error) {
      return { error: formatToolError('browser_scroll', error, args) };
    }
  }
};

export const browserWaitTool: Tool = {
  name: 'browser_wait',
  description: 'Wait for an element or timeout',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'Wait for element (optional)' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 5000)' }
    }
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { selector, timeout } = WaitSchema.parse(args);
      const page = await getPage();

      if (selector) {
        await page.waitForSelector(selector, { timeout });
      } else {
        await page.waitForTimeout(timeout);
      }

      return { status: 'success' };
    } catch (error) {
      return { error: formatToolError('browser_wait', error, args) };
    }
  }
};

export const browserEvalTool: Tool = {
  name: 'browser_eval',
  description: 'Evaluate JavaScript in the page context',
  parameters: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'JavaScript code to execute' }
    },
    required: ['script']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { script } = EvalSchema.parse(args);
      const page = await getPage();
      const result = await page.evaluate((code) => {

        return eval(code);
      }, script);
      return { result: String(result) };
    } catch (error) {
      return { error: formatToolError('browser_eval', error, args) };
    }
  }
};

export const browserCloseTool: Tool = {
  name: 'browser_close',
  description: 'Close the browser instance',
  parameters: { type: 'object', properties: {} },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
        pageInstance = null;
      }
      return { status: 'success' };
    } catch (error) {
      return { error: formatToolError('browser_close', error, args) };
    }
  }
};

export const browserLoginTool: Tool = {
  name: 'browser_login',
  description: 'Open browser in non-headless mode for manual login. Waits for you to close the window.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to open for login' }
    },
    required: ['url']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { url } = NavigateSchema.parse(args);

      // Close existing headless instance
      if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
      }

      // Launch headful
      const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: null
      });

      const page = (context.pages().length ? context.pages()[0] : await context.newPage()) as Page;
      await page.goto(url);

      // Wait for browser close
      await new Promise<void>(resolve => {
        context.on('close', () => resolve());
        // Also resolve if user closes all pages?
        page.on('close', () => {
            // Check if context has other pages, if not, maybe we are done?
            // Actually, context.on('close') handles the browser window closing.
        });
      });

      return { status: 'success', message: 'Manual login session completed. Cookies saved.' };
    } catch (error) {
      return { error: formatToolError('browser_login', error, args) };
    }
  }
};

export const createBrowserTools = (): Tool[] => [
  browserLoginTool,
  browserNavigateTool,
  { ...browserNavigateTool, name: 'browser_navigate' },
  browserClickTool,
  { ...browserClickTool, name: 'browser_click' },
  browserTypeTool,
  browserExtractTool,
  { ...browserExtractTool, name: 'browser_extract' },
  browserScreenshotTool,
  browserScrollTool,
  browserWaitTool,
  browserEvalTool,
  browserCloseTool
];
