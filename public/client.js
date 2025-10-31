const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const content = document.getElementById('content');
const errorEl = document.getElementById('error');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');

function getStoredToken() {
  try { return localStorage.getItem('notionToken') || ''; } catch { return ''; }
}

async function render(url) {
  errorEl.hidden = true;
  statusEl.textContent = 'Rendering…';
  copyBtn.disabled = true;
  content.innerHTML = '<div class="placeholder"><p>Rendering…</p></div>';
  try {
    const token = getStoredToken();
    if (window.api && typeof window.api.render === 'function') {
      const res = await window.api.render(url, token);
      if (!res || !res.ok) throw new Error((res && res.error) || 'Failed to render');
      content.innerHTML = res.html;
    } else {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to render');
      content.innerHTML = data.html;
    }
    statusEl.textContent = 'Rendered. You can copy the preview.';
    copyBtn.disabled = false;
  } catch (e) {
    errorEl.textContent = e.message || 'Something went wrong';
    errorEl.hidden = false;
    statusEl.textContent = '';
    content.innerHTML = '<div class="placeholder"><p>Render failed.</p></div>';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  render(url);
});

copyBtn.addEventListener('click', async () => {
  try {
    // Prefer copying HTML if available; most email editors accept rich paste
    const html = content.innerHTML;
    const text = content.innerText;
    if (navigator.clipboard && window.ClipboardItem) {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([text], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText }),
      ]);
    } else {
      // Fallback: select and execCommand
      const range = document.createRange();
      range.selectNodeContents(content);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
    }
    statusEl.textContent = 'Copied to clipboard.';
  } catch (e) {
    statusEl.textContent = 'Copy failed. Select and copy manually.';
  }
});

// Settings modal logic
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const notionTokenInput = document.getElementById('notionToken');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

function openSettings() {
  try { notionTokenInput.value = localStorage.getItem('notionToken') || ''; } catch {}
  settingsModal.hidden = false;
}
function closeSettings() {
  settingsModal.hidden = true;
}
settingsBtn?.addEventListener('click', openSettings);
cancelSettingsBtn?.addEventListener('click', closeSettings);
settingsModal?.addEventListener('click', (e) => {
  if (e.target === settingsModal || e.target.classList.contains('modal-backdrop')) closeSettings();
});
saveSettingsBtn?.addEventListener('click', () => {
  const val = notionTokenInput.value.trim();
  try { localStorage.setItem('notionToken', val); } catch {}
  closeSettings();
});
