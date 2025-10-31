import { Client } from '@notionhq/client';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load tokens from .env
dotenv.config();

// Configuration
const CONFIG = {
    notionToken: process.env.NOTION_TOKEN,
    pageId: process.env.NOTION_PAGE_ID,
    outputDir: './newsletters',
    
    // Styling options
    fonts: {
        heading: 'Arial, sans-serif',
        body: 'Calibri, sans-serif'
    },
    colors: {
        primary: '#333333',
        accent: '#0066cc'
    }
};

// Initialize Notion client
const notion = new Client({ auth: CONFIG.notionToken });

// HTML template with Paged.js and dynamic scaling
const PAGED_HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>
    <style>
        /* Page setup for exactly 3 pages */
        @page {
            size: A4;
            margin: 15mm 20mm;
            
            @bottom-center {
                content: counter(page) " of 3";
                font-family: ${CONFIG.fonts.body};
                font-size: 9pt;
                color: #666;
            }
        }
        
        /* Base styles with dynamic scaling */
        body {
            font-family: ${CONFIG.fonts.body};
            font-size: var(--base-font-size, 11pt);
            line-height: var(--line-height, 1.4);
            color: ${CONFIG.colors.primary};
            margin: 0;
            padding: 0;
            transform: scale(var(--content-scale, 1));
            transform-origin: top left;
        }
        
        /* Typography that scales with base font */
        h1, h2, h3 {
            font-family: ${CONFIG.fonts.heading};
            color: ${CONFIG.colors.accent};
            margin-top: calc(0.8em * var(--spacing-scale, 1));
            margin-bottom: calc(0.4em * var(--spacing-scale, 1));
            break-after: avoid;
        }
        
        h1 { 
            font-size: calc(var(--base-font-size, 11pt) * 2.2);
            margin-bottom: calc(0.5em * var(--spacing-scale, 1));
        }
        
        h2 { 
            font-size: calc(var(--base-font-size, 11pt) * 1.6);
        }
        
        h3 { 
            font-size: calc(var(--base-font-size, 11pt) * 1.3);
        }
        
        p {
            margin: calc(0.6em * var(--spacing-scale, 1)) 0;
        }
        
        /* Layout sections */
        .content-section {
            margin-bottom: calc(1em * var(--spacing-scale, 1));
            break-inside: avoid;
        }
        
        /* Mixed content (text + image side by side) */
        .content-section.with-image {
            display: flex;
            gap: calc(15px * var(--spacing-scale, 1));
            align-items: flex-start;
        }
        
        .content-section.with-image .text-content {
            flex: 1.2;
        }
        
        .content-section.with-image .image-container {
            flex: 0.8;
            max-width: 40%;
        }
        
        .content-section.with-image img {
            width: 100%;
            height: auto;
            max-height: calc(200px * var(--image-scale, 1));
            object-fit: contain;
        }
        
        /* Standalone images */
        .content-section.image-only {
            text-align: center;
            margin: calc(1em * var(--spacing-scale, 1)) 0;
        }
        
        .content-section.image-only img {
            max-width: calc(70% * var(--image-scale, 1));
            max-height: calc(250px * var(--image-scale, 1));
            height: auto;
        }
        
        /* Lists */
        ul, ol {
            margin: calc(0.5em * var(--spacing-scale, 1)) 0;
            padding-left: 1.5em;
        }
        
        li {
            margin: calc(0.3em * var(--spacing-scale, 1)) 0;
        }
        
        /* Links */
        a {
            color: ${CONFIG.colors.accent};
            text-decoration: none;
        }
        
        a:hover {
            text-decoration: underline;
        }
        
        /* Dividers */
        hr {
            margin: calc(1.5em * var(--spacing-scale, 1)) 0;
            border: none;
            border-top: 1px solid #e0e0e0;
        }
    </style>
</head>
<body>
    <div class="content-wrapper">
        {{CONTENT}}
    </div>
    
    <script>
        // Custom handler to ensure exactly 3 pages
        class ThreePageHandler extends Paged.Handler {
            constructor(chunker, polisher, caller) {
                super(chunker, polisher, caller);
            }
            
            afterRendered(pages) {
                console.log(\`Rendered \${pages.length} pages with current scaling\`);
                
                // Store page count for our scaling logic
                window.renderedPageCount = pages.length;
            }
        }
        
        Paged.registerHandlers(ThreePageHandler);
    </script>
</body>
</html>
`;

// Fetch content from Notion
async function fetchNotionContent() {
    try {
        console.log('📥 Fetching content from Notion...');
        
        const response = await notion.blocks.children.list({
            block_id: CONFIG.pageId || '',
        });
        
        return response.results;
    } catch (error) {
        console.error('❌ Error fetching Notion content:', error);
        throw error;
    }
}

// Get plain text from rich text
function getPlainText(richText: any[]): string {
    return richText.map((text: any) => text.plain_text).join('');
}

// Get rich text as HTML
function getRichTextHTML(richText: any[]): string {
    return richText.map((text: any) => {
        let html = text.plain_text;
        
        if (text.annotations.bold) html = `<strong>${html}</strong>`;
        if (text.annotations.italic) html = `<em>${html}</em>`;
        if (text.annotations.code) html = `<code>${html}</code>`;
        if (text.href) html = `<a href="${text.href}">${html}</a>`;
        
        return html;
    }).join('');
}

// Convert Notion blocks to HTML
function convertBlocksToHTML(blocks: any[]): string {
    let html = '';
    let currentList = null;
    let sectionCount = 0;
    
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!block.type) continue;
        
        // Handle lists
        if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
            const listType = block.type === 'bulleted_list_item' ? 'ul' : 'ol';
            const itemHtml = getRichTextHTML(block[block.type].rich_text);
            
            if (currentList !== listType) {
                if (currentList) html += `</${currentList}>`;
                html += `<${listType}>`;
                currentList = listType;
            }
            html += `<li>${itemHtml}</li>`;
            continue;
        }
        
        // Close any open list
        if (currentList) {
            html += `</${currentList}>`;
            currentList = null;
        }
        
        // Handle headings with potential image pairing
        if (block.type.includes('heading')) {
            const level = block.type.split('_')[1];
            const headingText = getPlainText(block[block.type].rich_text);
            
            // Look ahead for an image in the next block
            if (i + 1 < blocks.length && blocks[i + 1].type === 'image') {
                const imageBlock = blocks[i + 1];
                const imageUrl = imageBlock.image.type === 'external' 
                    ? imageBlock.image.external.url 
                    : imageBlock.image.file?.url || '';
                
                // Create side-by-side layout
                html += `
                    <div class="content-section with-image">
                        <div class="text-content">
                            <h${level}>${headingText}</h${level}>
                `;
                
                // Add any following text blocks until we hit another heading or image
                let j = i + 2;
                while (j < blocks.length && 
                       !blocks[j].type.includes('heading') && 
                       blocks[j].type !== 'image') {
                    if (blocks[j].type === 'paragraph') {
                        const text = getRichTextHTML(blocks[j].paragraph.rich_text);
                        if (text) html += `<p>${text}</p>`;
                    }
                    j++;
                }
                
                html += `
                        </div>
                        <div class="image-container">
                            <img src="${imageUrl}" alt="" />
                        </div>
                    </div>
                `;
                
                i = j - 1; // Skip processed blocks
            } else {
                html += `<div class="content-section"><h${level}>${headingText}</h${level}>`;
                sectionCount++;
                
                // Add following content until next heading
                let j = i + 1;
                while (j < blocks.length && !blocks[j].type.includes('heading')) {
                    const nextBlock = blocks[j];
                    
                    if (nextBlock.type === 'paragraph') {
                        const text = getRichTextHTML(nextBlock.paragraph.rich_text);
                        if (text) html += `<p>${text}</p>`;
                    } else if (nextBlock.type === 'image') {
                        // Standalone image
                        const imageUrl = nextBlock.image.type === 'external' 
                            ? nextBlock.image.external.url 
                            : nextBlock.image.file?.url || '';
                        html += `</div><div class="content-section image-only"><img src="${imageUrl}" alt="" /></div><div class="content-section">`;
                    }
                    j++;
                }
                html += '</div>';
                i = j - 1;
            }
        }
        // Handle other blocks
        else if (block.type === 'paragraph') {
            const text = getRichTextHTML(block.paragraph.rich_text);
            if (text) html += `<div class="content-section"><p>${text}</p></div>`;
        } else if (block.type === 'image') {
            const imageUrl = block.image.type === 'external' 
                ? block.image.external.url 
                : block.image.file?.url || '';
            html += `<div class="content-section image-only"><img src="${imageUrl}" alt="" /></div>`;
        } else if (block.type === 'divider') {
            html += '<hr />';
        }
    }
    
    // Close any remaining list
    if (currentList) html += `</${currentList}>`;
    
    return html;
}

// Generate PDF with automatic scaling to fit 3 pages
async function generatePDF(htmlContent: string) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Parameters to try for fitting content
        const scalingParams = [
            { fontSize: 11, lineHeight: 1.5, spacingScale: 1, imageScale: 1 },
            { fontSize: 10.5, lineHeight: 1.45, spacingScale: 0.95, imageScale: 0.95 },
            { fontSize: 10, lineHeight: 1.4, spacingScale: 0.9, imageScale: 0.9 },
            { fontSize: 9.5, lineHeight: 1.35, spacingScale: 0.85, imageScale: 0.85 },
            { fontSize: 9, lineHeight: 1.3, spacingScale: 0.8, imageScale: 0.8 },
            { fontSize: 8.5, lineHeight: 1.25, spacingScale: 0.75, imageScale: 0.75 },
            { fontSize: 8, lineHeight: 1.2, spacingScale: 0.7, imageScale: 0.7 },
            { fontSize: 7.5, lineHeight: 1.15, spacingScale: 0.65, imageScale: 0.65 },
            { fontSize: 7, lineHeight: 1.1, spacingScale: 0.6, imageScale: 0.6 }
        ];
        
        let optimalParams = scalingParams[0];
        let finalHTML = '';
        
        console.log('🔄 Auto-scaling content to fit exactly 3 pages...');
        
        for (const params of scalingParams) {
            // Apply scaling parameters
            const styledHTML = PAGED_HTML_TEMPLATE
                .replace('{{CONTENT}}', htmlContent)
                .replace('<body>', `<body style="
                    --base-font-size: ${params.fontSize}pt;
                    --line-height: ${params.lineHeight};
                    --spacing-scale: ${params.spacingScale};
                    --image-scale: ${params.imageScale};
                ">`);
            
            await page.setContent(styledHTML, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });
            
            // Wait for Paged.js to render
            await page.waitForFunction(() => {
                return document.querySelectorAll('.pagedjs_page').length > 0;
            }, { timeout: 10000 });
            
            // Additional wait for rendering to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check page count
            const pageCount = await page.evaluate(() => {
                return (window as any).renderedPageCount || document.querySelectorAll('.pagedjs_page').length;
            });
            
            console.log(`  Font: ${params.fontSize}pt, Spacing: ${params.spacingScale}x → ${pageCount} pages`);
            
            if (pageCount <= 3) {
                optimalParams = params;
                finalHTML = styledHTML;
                console.log(`✅ Found optimal scaling: ${params.fontSize}pt font, ${params.spacingScale}x spacing`);
                break;
            }
        }
        
        // If still too long, apply content scaling as last resort
        if (!finalHTML) {
            console.log('⚠️ Content too long, applying aggressive scaling...');
            const contentScale = 0.8; // Scale down entire content
            finalHTML = PAGED_HTML_TEMPLATE
                .replace('{{CONTENT}}', htmlContent)
                .replace('<body>', `<body style="
                    --base-font-size: 7pt;
                    --line-height: 1.1;
                    --spacing-scale: 0.5;
                    --image-scale: 0.5;
                    --content-scale: ${contentScale};
                ">`);
        }
        
        // Set final content
        await page.setContent(finalHTML, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        // Wait for final render
        await page.waitForTimeout(3000);
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `newsletter-${timestamp}.pdf`;
        const outputPath = path.join(CONFIG.outputDir, filename);
        
        // Ensure output directory exists
        if (!fs.existsSync(CONFIG.outputDir)) {
            fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        }
        
        // Generate PDF
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            margin: {
                top: '0',
                right: '0',
                bottom: '0',
                left: '0'
            }
        });
        
        console.log(`\n📄 Newsletter generated: ${outputPath}`);
        console.log(`   Scaling used: ${optimalParams.fontSize}pt font, ${optimalParams.spacingScale}x spacing`);
        return outputPath;
        
    } finally {
        await browser.close();
    }
}

// Main function
async function main() {
    try {
        console.log('🚀 Starting Notion to 3-Page Newsletter conversion...\n');
        
        // Fetch content from Notion
        const blocks = await fetchNotionContent();
        console.log(`📊 Fetched ${blocks.length} blocks from Notion\n`);
        
        // Convert blocks to HTML with smart layout
        const htmlContent = convertBlocksToHTML(blocks);
        
        // Generate PDF with auto-scaling
        await generatePDF(htmlContent);
        
        console.log('\n✨ Newsletter formatting complete!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

main();