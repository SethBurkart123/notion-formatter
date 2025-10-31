import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

// Load env
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Utilities
function extractPageIdFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const raw = url.pathname;
    // Look for a 32-hex id, possibly with dashes
    const match = raw.match(/[0-9a-fA-F]{32,}/g);
    if (!match) return null;
    const id = match[match.length - 1].slice(0, 32).replace(/-/g, '');
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  } catch {
    return null;
  }
}

async function fetchAllBlocks(blockId: string) {
  const results: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return results;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function richTextToHtml(rich: any[]): string {
  const S = {
    a: 'color:#2563eb;text-decoration:none;',
    codeInline:
      'background:#f1f5f9;border:1px solid #e2e8f0;padding:.15em .35em;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:.95em;color:#0f172a;',
  };
  return rich
    .map((t: any) => {
      let html = escapeHtml(t.plain_text ?? '');
      const ann = t.annotations ?? {};
      if (ann.bold) html = `<strong>${html}</strong>`;
      if (ann.italic) html = `<em>${html}</em>`;
      if (ann.strikethrough) html = `<s>${html}</s>`;
      if (ann.underline) html = `<u>${html}</u>`;
      if (ann.code) html = `<code style="${S.codeInline}">${html}</code>`;
      if (t.href) html = `<a target="_blank" href="${t.href}" style="${S.a}">${html}</a>`;
      return html;
    })
    .join('');
}

function blocksToEmailHtml(blocks: any[]): string {
  const S = {
    container: 'margin:0 auto;max-width:720px;padding:0;',
    prose: 'line-height:1.65;font-size:16px;color:inherit;',
    p: 'margin:.9em 0;',
    h1: 'font-size:28px;line-height:1.25;margin:1.6em 0 .6em;color:inherit;',
    h2: 'font-size:22px;line-height:1.3;margin:1.4em 0 .5em;color:inherit;',
    h3: 'font-size:18px;line-height:1.3;margin:1.2em 0 .4em;color:inherit;',
    ul: 'margin:.8em 0;padding-left:1.4em;',
    ol: 'margin:.8em 0;padding-left:1.4em;',
    li: 'margin:.3em 0;',
    hr: 'border:none;border-top:1px solid #e5e7eb;margin:1.6em 0;',
    img: 'width:100%;height:auto;border-radius:10px;',
    figure: 'margin:1.2em 0;',
    blockquote:
      'margin:1em 0;padding:.6em .9em;border-left:4px solid #94a3b8;color:#0f172a;font-style:italic;',
    pre: 'background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px;overflow:auto;',
    codeBlock:
      'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:.95em;color:#0f172a;',
    callout:
      'display:flex;gap:10px;align-items:flex-start;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin:1em 0;color:#0f172a;',
    calloutIcon: 'flex:0 0 auto;',
  };
  let html = '';
  let openList: null | 'ul' | 'ol' = null;

  const closeListIfOpen = () => {
    if (openList) {
      html += `</${openList}>`;
      openList = null;
    }
  };

  for (const block of blocks) {
    if (!block?.type) continue;

    // Lists
    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      const listType: 'ul' | 'ol' = block.type === 'bulleted_list_item' ? 'ul' : 'ol';
      const itemHtml = richTextToHtml(block[block.type].rich_text || []);
      if (openList !== listType) {
        closeListIfOpen();
        const listStyle = listType === 'ul' ? S.ul : S.ol;
        html += `<${listType} style="${listStyle}">`;
        openList = listType;
      }
      html += `<li style="${S.li}">${itemHtml}</li>`;
      continue;
    }

    // Close list when switching context
    closeListIfOpen();

    if (block.type === 'paragraph') {
      const text = richTextToHtml(block.paragraph?.rich_text || []);
      if (text) html += `<p style="${S.p}">${text}</p>`;
      continue;
    }

    if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
      const level = block.type.split('_')[1];
      const text = richTextToHtml(block[block.type]?.rich_text || []);
      const style = level === '1' ? S.h1 : level === '2' ? S.h2 : S.h3;
      html += `<h${level} style="${style}">${text}</h${level}>`;
      continue;
    }

    if (block.type === 'image') {
      const image = block.image;
      const src = image.type === 'external' ? image.external.url : image.file?.url || '';
      html += `<figure style="${S.figure}"><img src="${src}" alt="" style="${S.img}" /></figure>`;
      continue;
    }

    if (block.type === 'divider') {
      html += `<hr style="${S.hr}" />`;
      continue;
    }

    if (block.type === 'quote') {
      const text = richTextToHtml(block.quote?.rich_text || []);
      html += `<blockquote style="${S.blockquote}">${text}</blockquote>`;
      continue;
    }

    if (block.type === 'code') {
      const text = (block.code?.rich_text || []).map((t: any) => t.plain_text).join('');
      html += `<pre style="${S.pre}"><code style="${S.codeBlock}">${escapeHtml(text)}</code></pre>`;
      continue;
    }

    if (block.type === 'callout') {
      const text = richTextToHtml(block.callout?.rich_text || []);
      const icon = block.callout?.icon?.emoji || '💡';
      html += `<div style="${S.callout}"><span style="${S.calloutIcon}">${icon}</span><div>${text}</div></div>`;
      continue;
    }
  }

  closeListIfOpen();

  return `<div style="${S.container}"><div class="email-prose" style="${S.prose}">${html}</div></div>`;
}

async function renderFromNotionUrl(url: string) {
  const pageId = extractPageIdFromUrl(url);
  if (!pageId) throw new Error('Could not parse Notion page ID from URL');
  const blocks = await fetchAllBlocks(pageId);
  const html = blocksToEmailHtml(blocks);
  return { html };
}

// Static file helper
async function serveStatic(pathname: string): Promise<Response> {
  const filePath = pathname === '/' ? '/public/index.html' : pathname;
  try {
    const file = await Bun.file(`.${filePath}`).arrayBuffer();
    const ext = filePath.split('.').pop() || '';
    const types: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
    };
    return new Response(file, { headers: { 'Content-Type': types[ext] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname.startsWith('/api/render')) {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      try {
        const body = await req.json();
        const url = String(body?.url || '').trim();
        if (!url) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const result = await renderFromNotionUrl(url);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e?.message || 'Render failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Serve static
    return await serveStatic(pathname === '/' ? '/' : `/public${pathname}`);
  },
});

console.log(`🚀 Email formatter running on http://localhost:${server.port}`);
