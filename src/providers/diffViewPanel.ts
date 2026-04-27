import { window, ViewColumn, Uri, workspace } from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, getLocaleName, t } from '../i18n'

export class DiffViewPanel {
  private store: TranslationStore
  private panel: import('vscode').WebviewPanel | null = null

  constructor(store: TranslationStore) {
    this.store = store
  }

  show() {
    if (this.panel) {
      this.panel.reveal()
      this.update()
      return
    }

    this.panel = window.createWebviewPanel(
      'i18nAllyPro.diffView',
      '🔀 i18n Translation Diff',
      ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.onDidDispose(() => { this.panel = null })
    this.panel.webview.onDidReceiveMessage(async (msg: { type: string; key?: string; locale?: string }) => {
      if (msg.type === 'openKey' && msg.key) {
        const config = this.store.projectConfig
        const file = this.store.getTranslationFiles().find(f => f.locale === (msg.locale || config.sourceLanguage))
        if (file) {
          const doc = await workspace.openTextDocument(Uri.file(file.filepath))
          await window.showTextDocument(doc, ViewColumn.One)
        }
      } else if (msg.type === 'refresh') {
        await this.store.refresh()
        this.update()
      }
    })
    this.update()
  }

  refresh() {
    if (this.panel) this.update()
  }

  private update() {
    if (!this.panel) return
    this.panel.webview.html = this.getHtml()
  }

  private getHtml(): string {
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage
    const allKeys = this.store.getAllKeys()
    const locales = this.store.locales

    const diffData: { key: string; source: string; translations: { locale: string; value: string; status: 'missing' | 'empty' | 'different' | 'same' }[] }[] = []

    for (const key of allKeys) {
      const sourceVal = this.store.getTranslation(sourceLocale, key) || ''
      const translations = locales
        .filter(l => l !== sourceLocale)
        .map(locale => {
          const val = this.store.getTranslation(locale, key)
          let status: 'missing' | 'empty' | 'different' | 'same' = 'same'
          if (val === undefined) status = 'missing'
          else if (val === '') status = 'empty'
          else if (val !== sourceVal) status = 'different'
          return { locale, value: val || '', status }
        })

      const hasDiff = translations.some(t => t.status !== 'same')
      if (hasDiff) {
        diffData.push({ key, source: sourceVal, translations })
      }
    }

    diffData.sort((a, b) => {
      const aMissing = a.translations.filter(t => t.status === 'missing').length
      const bMissing = b.translations.filter(t => t.status === 'missing').length
      if (aMissing !== bMissing) return bMissing - aMissing
      return a.key.localeCompare(b.key)
    })

    const totalKeys = allKeys.length
    const diffKeys = diffData.length
    const sameKeys = totalKeys - diffKeys

    const diffDataJson = JSON.stringify(diffData)
    const localesJson = JSON.stringify(locales.filter(l => l !== sourceLocale))
    const sourceLocaleFlag = getLocaleFlag(sourceLocale)
    const sourceLocaleName = getLocaleName(sourceLocale)

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>i18n Translation Diff</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, var(--vscode-editorWidget-border, #333));
    --accent: var(--vscode-charts-blue);
    --green: var(--vscode-terminal-ansiGreen, #4ec9b0);
    --red: var(--vscode-terminal-ansiRed, #f44747);
    --yellow: var(--vscode-terminal-ansiYellow, #dcdcaa);
    --card: var(--vscode-editorWidget-background, #1e1e1e);
    --hover: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--fg); font-family:var(--vscode-font-family); font-size:13px; padding:16px; }
  h1 { font-size:18px; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
  .stats { display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap; }
  .stat-card { background:var(--card); border:1px solid var(--border); border-radius:6px; padding:10px 16px; min-width:120px; }
  .stat-card .num { font-size:22px; font-weight:700; }
  .stat-card .label { font-size:11px; opacity:0.7; margin-top:2px; }
  .controls { display:flex; gap:8px; margin-bottom:12px; align-items:center; flex-wrap:wrap; }
  .controls input { background:var(--card); border:1px solid var(--border); color:var(--fg); padding:5px 10px; border-radius:4px; font-size:13px; width:220px; }
  .controls select { background:var(--card); border:1px solid var(--border); color:var(--fg); padding:5px 10px; border-radius:4px; font-size:13px; }
  .controls button { background:var(--accent); color:#fff; border:none; padding:5px 14px; border-radius:4px; cursor:pointer; font-size:13px; }
  .controls button:hover { opacity:0.85; }
  .filter-btn { background:transparent; border:1px solid var(--border); color:var(--fg); padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
  .filter-btn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th { text-align:left; padding:8px 10px; border-bottom:2px solid var(--border); font-size:12px; opacity:0.7; position:sticky; top:0; background:var(--bg); z-index:1; }
  td { padding:6px 10px; border-bottom:1px solid var(--border); vertical-align:top; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  td:hover { white-space:normal; word-break:break-all; }
  tr:hover { background:var(--hover); }
  .key-cell { font-family:var(--vscode-editor-font-family, monospace); font-weight:600; color:var(--accent); cursor:pointer; }
  .key-cell:hover { text-decoration:underline; }
  .status-missing { color:var(--red); font-weight:600; }
  .status-empty { color:var(--yellow); font-style:italic; }
  .status-different { color:var(--fg); }
  .status-same { color:var(--green); opacity:0.6; }
  .badge { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:600; margin-left:4px; }
  .badge-missing { background:rgba(244,71,71,0.2); color:var(--red); }
  .badge-empty { background:rgba(220,220,170,0.2); color:var(--yellow); }
  .badge-diff { background:rgba(78,201,176,0.2); color:var(--green); }
  .locale-header { display:flex; align-items:center; gap:4px; }
  .empty-msg { text-align:center; padding:40px; opacity:0.5; }
</style>
</head>
<body>
<h1>🔀 Translation Diff View</h1>
<div class="stats">
  <div class="stat-card"><div class="num">${totalKeys}</div><div class="label">Total Keys</div></div>
  <div class="stat-card"><div class="num" style="color:var(--green)">${sameKeys}</div><div class="label">Fully Translated</div></div>
  <div class="stat-card"><div class="num" style="color:var(--red)">${diffKeys}</div><div class="label">Need Attention</div></div>
</div>
<div class="controls">
  <input type="text" id="searchInput" placeholder="Filter keys..." oninput="filterTable()">
  <select id="statusFilter" onchange="filterTable()">
    <option value="all">All Issues</option>
    <option value="missing">Missing Only</option>
    <option value="empty">Empty Only</option>
    <option value="different">Different Only</option>
  </select>
  <button onclick="refresh()">🔄 Refresh</button>
</div>
<div style="overflow-x:auto; max-height:calc(100vh - 200px); overflow-y:auto;">
<table id="diffTable">
<thead><tr>
  <th>Key</th>
  <th>${sourceLocaleFlag} ${sourceLocaleName} (Source)</th>
</tr></thead>
<tbody id="diffBody"></tbody>
</table>
</div>
<script>
const DATA=${diffDataJson};
const TARGET_LOCALES=${localesJson};
const VS=acquireVsCodeApi();

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function renderTable(){
  const search=document.getElementById('searchInput').value.toLowerCase();
  const statusFilter=document.getElementById('statusFilter').value;
  const thead=document.querySelector('#diffTable thead tr');
  thead.innerHTML='<th>Key</th><th>${sourceLocaleFlag} ${sourceLocaleName} (Source)</th>'+TARGET_LOCALES.map(l=>{
    const flag=${JSON.stringify(locales.filter(l=>l!==sourceLocale).map(l=>getLocaleFlag(l)))}[TARGET_LOCALES.indexOf(l)]||'🌐';
    return '<th><span class="locale-header">'+flag+' '+l+'</span></th>';
  }).join('');

  const tbody=document.getElementById('diffBody');
  let html='';
  DATA.forEach((row,idx)=>{
    if(search && !row.key.toLowerCase().includes(search) && !row.source.toLowerCase().includes(search)) return;
    if(statusFilter!=='all'){
      const hasStatus=row.translations.some(t=>t.status===statusFilter);
      if(!hasStatus) return;
    }
    html+='<tr data-idx="'+idx+'">';
    html+='<td class="key-cell" onclick="openKey(\\''+esc(row.key)+'\\')">'+esc(row.key)+'</td>';
    html+='<td title="'+esc(row.source)+'">'+esc(row.source)+'</td>';
    row.translations.forEach(t=>{
      let cls='status-'+t.status;
      let badge='';
      if(t.status==='missing') badge='<span class="badge badge-missing">MISS</span>';
      else if(t.status==='empty') badge='<span class="badge badge-empty">EMPTY</span>';
      else if(t.status==='different') badge='<span class="badge badge-diff">DIFF</span>';
      html+='<td class="'+cls+'" title="'+esc(t.value)+'">'+(t.value?esc(t.value):'—')+badge+'</td>';
    });
    html+='tr>';
  });
  if(!html) html='<tr><td colspan="'+(2+TARGET_LOCALES.length)+'" class="empty-msg">No differences found 🎉</td></tr>';
  tbody.innerHTML=html;
}

function filterTable(){renderTable();}
function openKey(key){VS.postMessage({type:'openKey',key});}
function refresh(){VS.postMessage({type:'refresh'});}

renderTable();
</script>
</body>
</html>`
  }
}
