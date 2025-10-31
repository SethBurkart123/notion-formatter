const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Client } = require('@notionhq/client');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
}

// Utilities adapted from server.ts (JS version)
function extractPageIdFromUrl(input) {
  try {
    const url = new URL(input);
    const raw = url.pathname;
    const match = raw.match(/[0-9a-fA-F]{32,}/g);
    if (!match || match.length === 0) return null;
    const id = match[match.length - 1].slice(0, 32).replace(/-/g, '');
    if (id.length !== 32) return null;
    return id;
  } catch {
    return null;
  }
}

async function fetchAllBlocks(notion, blockId) {
  const results = [];
  let cursor = undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor });
    results.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function richTextToHtml(rich) {
  const S = {
    b: 'font-weight:600;',
    i: 'font-style:italic;',
    u: 'text-decoration:underline;',
    s: 'text-decoration:line-through;',
    code: 'font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \'Liberation Mono\', \'Courier New\', monospace; padding:1px 4px; border-radius:4px; background:#f1f1f1; border:1px solid #e3e3e3; font-size:0.9em;'
  };
  return (rich || [])
    .map((t) => {
      let text = escapeHtml(t.plain_text || '');
      const ann = t.annotations || {};
      let style = '';
      if (ann.bold) style += S.b;
      if (ann.italic) style += S.i;
      if (ann.underline) style += S.u;
      if (ann.strikethrough) style += S.s;
      if (ann.code) return `<code style="${S.code}">${text}</code>`;
      if (style) return `<span style="${style}">${text}</span>`;
      const href = t.href;
      if (href) return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      return text;
    })
    .join('');
}

function blocksToEmailHtml(blocks) {
  const S = {
    container: 'padding:4px;',
    prose: 'max-width:700px; margin:0 auto; background:#ffffff;',
    h1: 'font-size:28px; line-height:1.2; margin:0 0 16px; font-weight:700; color:#111827;',
    h2: 'font-size:22px; line-height:1.3; margin:24px 0 12px; font-weight:700; color:#111827; border-top:1px solid #f1f5f9; padding-top:16px;',
    h3: 'font-size:18px; line-height:1.4; margin:20px 0 8px; font-weight:700; color:#111827;',
    p: 'margin:0 0 14px; color:#374151; line-height:1.7; font-size:16px;',
    ul: 'margin:0 0 16px 1.25rem; padding:0; color:#374151; line-height:1.7; font-size:16px;',
    ol: 'margin:0 0 16px 1.25rem; padding:0; color:#374151; line-height:1.7; font-size:16px;',
    li: 'margin:0 0 8px;',
    figure: 'margin:16px 0; text-align:center;',
    img: 'max-width:100%; height:auto; border-radius:8px; border:1px solid #e5e7eb;',
    hr: 'border:none; border-top:1px solid #e5e7eb; margin:24px 0;',
    blockquote: 'border-left:4px solid #e5e7eb; margin:16px 0; padding:8px 16px; color:#6b7280; font-style:italic;',
    pre: 'background:#0b1021; color:#e5e7eb; padding:12px 14px; border-radius:8px; font-size:14px; overflow:auto; border:1px solid #1f2937;',
    codeBlock: 'font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \'Liberation Mono\', \'Courier New\', monospace;',
    callout: 'display:flex; gap:12px; background:#f0f9ff; border:1px solid #e0f2fe; padding:12px; border-radius:8px; color:#0c4a6e; margin:14px 0;',
    calloutIcon: 'font-size:18px; line-height:1;'
  };

  let html = '';
  let openList = null; // 'ul' | 'ol' | null

  const closeListIfOpen = () => {
    if (openList) {
      html += `</${openList}>`;
      openList = null;
    }
  };

  for (const block of blocks) {
    if (!block || !block.type) continue;

    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      const listType = block.type === 'bulleted_list_item' ? 'ul' : 'ol';
      const itemHtml = richTextToHtml((block[block.type] && block[block.type].rich_text) || []);
      if (openList !== listType) {
        closeListIfOpen();
        const listStyle = listType === 'ul' ? S.ul : S.ol;
        html += `<${listType} style="${listStyle}">`;
        openList = listType;
      }
      html += `<li style="${S.li}">${itemHtml}</li>`;
      continue;
    }

    closeListIfOpen();

    if (block.type === 'paragraph') {
      const text = richTextToHtml((block.paragraph && block.paragraph.rich_text) || []);
      if (text) html += `<p style="${S.p}">${text}</p>`;
      continue;
    }

    if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
      const level = block.type.split('_')[1];
      const text = richTextToHtml((block[block.type] && block[block.type].rich_text) || []);
      const style = level === '1' ? S.h1 : level === '2' ? S.h2 : S.h3;
      html += `<h${level} style="${style}">${text}</h${level}>`;
      continue;
    }

    if (block.type === 'image') {
      const image = block.image;
      const src = image.type === 'external' ? image.external.url : (image.file && image.file.url) || '';
      html += `<figure style="${S.figure}"><img src="${src}" alt="" style="${S.img}" /></figure>`;
      continue;
    }

    if (block.type === 'divider') {
      html += `<hr style="${S.hr}" />`;
      continue;
    }

    if (block.type === 'quote') {
      const text = richTextToHtml((block.quote && block.quote.rich_text) || []);
      html += `<blockquote style="${S.blockquote}">${text}</blockquote>`;
      continue;
    }

    if (block.type === 'code') {
      const text = ((block.code && block.code.rich_text) || []).map((t) => t.plain_text).join('');
      html += `<pre style="${S.pre}"><code style="${S.codeBlock}">${escapeHtml(text)}</code></pre>`;
      continue;
    }

    if (block.type === 'callout') {
      const text = richTextToHtml((block.callout && block.callout.rich_text) || []);
      const icon = (block.callout && block.callout.icon && block.callout.icon.emoji) || '💡';
      html += `<div style="${S.callout}"><span style="${S.calloutIcon}">${icon}</span><div>${text}</div></div>`;
      continue;
    }
  }

  closeListIfOpen();

  return `<div style="${S.container}"><div class=\"email-prose\" style=\"${S.prose}\">${html}</div></div>`;
}

async function renderFromNotionUrl(notionToken, url) {
  const pageId = extractPageIdFromUrl(url);
  if (!pageId) throw new Error('Could not parse Notion page ID from URL');
  const notion = new Client({ auth: notionToken });
  const blocks = await fetchAllBlocks(notion, pageId);
  const html = blocksToEmailHtml(blocks);
  return { html };
}

ipcMain.handle('render', async (_event, payload) => {
  try {
    const { url, token } = payload || {};
    if (!url) throw new Error('Missing url');
    if (!token) throw new Error('Missing Notion token in settings');
    const result = await renderFromNotionUrl(token, String(url));
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Render failed' };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
