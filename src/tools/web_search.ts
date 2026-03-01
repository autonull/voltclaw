import { chromium, type Browser } from 'playwright';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { Tool, ToolCallResult } from './types.js';
import { formatToolError } from './errors.js';

const SearchSchema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().optional().default(5).describe('Number of results to return')
});

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function fallbackSearch(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    $('.result').each((i, el) => {
      if (results.length >= limit) return false;

      const titleEl = $(el).find('.result__title .result__a');
      const snippetEl = $(el).find('.result__snippet');
      const url = titleEl.attr('href');

      if (titleEl.length > 0 && url !== undefined && url !== '') {
        results.push({
          title: titleEl.text().trim(),
          url,
          snippet: snippetEl.text().trim()
        });
      }
      return true;
    });

    return results;
  } catch {
    // console.warn('Fallback search failed:', error);
    return [];
  }
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web using DuckDuckGo',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Number of results (default: 5)' }
    },
    required: ['query']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    let browser: Browser | null = null;
    let limit = 5;
    let query = '';

    try {
      const parsed = SearchSchema.parse(args);
      query = parsed.query;
      limit = parsed.limit;

      // Try Playwright first
      try {
          browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();

          const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

          await page.goto(url, { timeout: 15000 }); // 15s timeout
          await page.waitForSelector('.result', { timeout: 5000 });

          const results = await page.$$eval('.result', (elements, limit) => {
            return elements.slice(0, limit).map(el => {
              const titleEl = el.querySelector('.result__title .result__a');
              const snippetEl = el.querySelector('.result__snippet');
              const url = titleEl?.getAttribute('href');

              return {
                title: titleEl?.textContent?.trim() ?? '',
                url: url ?? '',
                snippet: snippetEl?.textContent?.trim() ?? ''
              };
            });
          }, limit);

          return { status: 'success', results, method: 'playwright' };
      } catch (pwError) {
          // Fallback to Axios
          // console.warn('Playwright search failed, falling back to Axios/Cheerio', pwError);
          const results = await fallbackSearch(query, limit);
          if (results.length > 0) {
              return { status: 'success', results, method: 'fallback' };
          }
          throw pwError; // Rethrow if fallback also failed
      }
    } catch (error) {
       // If everything fails, try one last fallback if we haven't already
       if (query !== '') {
           try {
               const results = await fallbackSearch(query, limit);
               if (results.length > 0) {
                   return { status: 'success', results, method: 'fallback_last_resort' };
               }
           } catch {
               // ignore
           }
       }

      return { error: formatToolError('web_search', error, args) };
    } finally {
      if (browser !== null) {
        await browser.close().catch(() => {});
      }
    }
  }
};
