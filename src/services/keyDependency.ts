import { window, workspace, ProgressLocation, Uri, ViewColumn, Position, Selection, Range, env } from 'vscode'
import fs from 'fs'
import { TranslationStore } from '../core/store'
import { Scanner, ScannerMatch } from '../core/types'
import { getIgnoreDirs } from '../core/constants'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'
import { t } from '../i18n'

export interface KeyReference {
  key: string
  filepath: string
  line: number
  column: number
}

export interface KeyDependencyGraph {
  [key: string]: KeyReference[]
}

export class KeyDependencyService {
  private store: TranslationStore
  private scanners: Scanner[]

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async buildDependencyGraph(): Promise<KeyDependencyGraph> {
    const graph: KeyDependencyGraph = {}
    const rootPath = this.store.projectConfig.rootPath

    const fg = require('fast-glob')
    const codeFiles: string[] = await fg('**/*.{go,vue,js,ts,jsx,tsx,html}', {
      cwd: rootPath,
      ignore: getIgnoreDirs(),
      onlyFiles: true,
      absolute: true,
    })

    for (const filepath of codeFiles) {
      try {
        const content = fs.readFileSync(filepath, 'utf-8')
        const ext = filepath.split('.').pop() || ''
        const languageId = this.extToLanguageId(ext)

        const scanner = this.scanners.find(s => s.languageIds.includes(languageId))
        if (!scanner) continue

        const matches = scanner.scan(content, filepath)

        for (const match of matches) {
          if (!graph[match.key]) {
            graph[match.key] = []
          }
          graph[match.key].push({
            key: match.key,
            filepath,
            line: match.line,
            column: match.column,
          })
        }
      } catch { /* skip unreadable files */ }
    }

    for (const key of Object.keys(graph)) {
      graph[key].sort((a, b) => {
        const fileCmp = a.filepath.localeCompare(b.filepath)
        if (fileCmp !== 0) return fileCmp
        return a.line - b.line
      })
    }

    return graph
  }

  async showDependencyGraph(): Promise<void> {
    const graph = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Building key dependency graph...',
        cancellable: false,
      },
      async () => this.buildDependencyGraph()
    )

    const allKeys = this.store.getAllKeys()
    const referencedKeys = Object.keys(graph)
    const unreferencedKeys = allKeys.filter(k => !referencedKeys.includes(k))
    const rootPath = this.store.projectConfig.rootPath

    const nodes: { id: string; group: string; value: string; refCount: number }[] = []
    const links: { source: string; target: string; line: number; column: number }[] = []

    const fileSet = new Set<string>()
    for (const [key, refs] of Object.entries(graph)) {
      for (const ref of refs) {
        const rel = ref.filepath.replace(rootPath + '\\', '').replace(rootPath + '/', '')
        fileSet.add(rel)
        links.push({ source: rel, target: key, line: ref.line, column: ref.column })
      }
    }

    for (const file of fileSet) {
      nodes.push({ id: file, group: 'file', value: '', refCount: 0 })
    }
    for (const key of referencedKeys.sort()) {
      const sourceValue = this.store.getTranslation(this.store.projectConfig.sourceLanguage, key) || ''
      nodes.push({ id: key, group: 'key', value: sourceValue, refCount: graph[key].length })
    }
    for (const key of unreferencedKeys.sort()) {
      const sourceValue = this.store.getTranslation(this.store.projectConfig.sourceLanguage, key) || ''
      nodes.push({ id: key, group: 'unreferenced', value: sourceValue, refCount: 0 })
    }

    const graphData = { nodes, links }

    const panel = window.createWebviewPanel(
      'i18nKeyDependencies',
      '🔗 i18n Key Dependencies',
      ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    panel.webview.html = this.getGraphHtml(graphData, allKeys.length, referencedKeys.length, unreferencedKeys.length)

    panel.webview.onDidReceiveMessage(async (msg: { type: string; file?: string; line?: number; column?: number; prompt?: string; keys?: string[] }) => {
      if (msg.type === 'openFile' && msg.file) {
        const path = require('path')
        const absPath = path.join(rootPath, msg.file)
        try {
          const doc = await workspace.openTextDocument(Uri.file(absPath))
          const editor = await window.showTextDocument(doc, ViewColumn.One)
          if (msg.line && msg.line > 0) {
            const line = msg.line - 1
            const col = Math.max(0, (msg.column || 1) - 1)
            const pos = new Position(line, col)
            editor.selection = new Selection(pos, pos)
            editor.revealRange(new Range(pos, pos))
          }
        } catch {
          window.showErrorMessage(t('editor.file_not_found', msg.file))
        }
      } else if (msg.type === 'copyPrompt' && msg.prompt) {
        await env.clipboard.writeText(msg.prompt)
        window.showInformationMessage('✅ AI prompt copied to clipboard')
      } else if (msg.type === 'deleteUnrefKeys' && msg.keys && msg.keys.length > 0) {
        const confirm = await window.showWarningMessage(
          `Delete ${msg.keys.length} unreferenced keys from all locales?`,
          { modal: true },
          'Delete',
        )
        if (confirm === 'Delete') {
          let deleted = 0
          for (const key of msg.keys) {
            for (const locale of this.store.locales) {
              await this.store.deleteTranslation(locale, key)
            }
            deleted++
          }
          window.showInformationMessage(`✅ Deleted ${deleted} unreferenced keys`)
          panel.dispose()
        }
      }
    })
  }

  private getGraphHtml(
    data: { nodes: { id: string; group: string; value: string; refCount: number }[]; links: { source: string; target: string; line: number; column: number }[] },
    totalKeys: number,
    referencedCount: number,
    unreferencedCount: number,
  ): string {
    const dataJson = JSON.stringify(data)
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>i18n Key Dependency Graph</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);overflow:hidden;height:100vh}
.toolbar{position:fixed;top:0;left:0;right:0;z-index:100;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border,var(--vscode-input-border));padding:8px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.toolbar h1{font-size:13px;color:var(--vscode-charts-blue);margin-right:auto;white-space:nowrap}
.stat{font-size:10px;padding:2px 7px;border-radius:8px;white-space:nowrap}
.stat.total{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.stat.ref{background:color-mix(in srgb,var(--vscode-charts-green) 20%,transparent);color:var(--vscode-charts-green)}
.stat.unref{background:color-mix(in srgb,var(--vscode-charts-red) 20%,transparent);color:var(--vscode-charts-red)}
.search-box{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:3px 8px;color:var(--vscode-input-foreground);font-size:11px;width:180px;outline:none}
.search-box:focus{border-color:var(--vscode-focusBorder)}
.search-box::placeholder{color:var(--vscode-input-placeholderForeground)}
.btn{background:var(--vscode-button-secondaryBackground);border:none;border-radius:3px;padding:3px 10px;color:var(--vscode-button-secondaryForeground);font-size:10px;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.main{position:fixed;top:40px;left:0;right:0;bottom:0;overflow-y:auto}
.main::-webkit-scrollbar{width:8px}
.main::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:4px}
.main::-webkit-scrollbar-thumb:hover{background:var(--vscode-scrollbarSlider-hoverBackground)}
.section{margin:0}
.section-header{position:sticky;top:0;background:var(--vscode-sideBar-background);padding:6px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--vscode-panel-border,var(--vscode-input-border));z-index:10;display:flex;align-items:center;gap:6px;cursor:pointer}
.section-header:hover{background:var(--vscode-list-hoverBackground)}
.section-header .arrow{font-size:8px;transition:transform .15s}
.section-header.collapsed .arrow{transform:rotate(-90deg)}
.section-header .count{font-weight:400;opacity:0.6;font-size:10px}
.section-body{border-bottom:1px solid var(--vscode-panel-border,var(--vscode-input-border))}
.section-header.collapsed+.section-body{display:none}
.node-item{padding:6px 14px 6px 24px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;transition:background .1s}
.node-item:hover{background:var(--vscode-list-hoverBackground)}
.node-item.selected{background:var(--vscode-list-activeSelectionBackground);border-left-color:var(--vscode-charts-blue)}
.node-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.node-name{flex-shrink:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.node-path{flex-shrink:0;max-width:25%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);font-size:10px}
.node-value{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-charts-green);font-size:10px;opacity:0.8}
.node-badge{font-size:9px;padding:1px 5px;border-radius:8px;flex-shrink:0}
.badge-ref{background:color-mix(in srgb,var(--vscode-charts-green) 20%,transparent);color:var(--vscode-charts-green)}
.badge-unref{background:color-mix(in srgb,var(--vscode-charts-red) 20%,transparent);color:var(--vscode-charts-red)}
.detail-panel{position:fixed;top:40px;right:0;width:320px;bottom:0;background:var(--vscode-sideBar-background);border-left:1px solid var(--vscode-panel-border,var(--vscode-input-border));z-index:100;padding:14px;overflow-y:auto;display:none}
.detail-panel.show{display:block}
.detail-panel h3{color:var(--vscode-charts-blue);font-size:12px;margin-bottom:8px;word-break:break-all}
.detail-value{color:var(--vscode-charts-green);font-size:11px;margin-bottom:10px;word-break:break-all}
.detail-section{margin-bottom:8px}
.detail-section-title{color:var(--vscode-descriptionForeground);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.ref-item{background:var(--vscode-list-hoverBackground);border-radius:3px;padding:4px 6px;margin-bottom:2px;font-size:10px;color:var(--vscode-editor-foreground);cursor:pointer;word-break:break-all}
.ref-item:hover{background:var(--vscode-list-activeSelectionBackground)}
.ref-file{font-weight:500}
.ref-line{color:var(--vscode-charts-blue);font-weight:600}
.ref-dir{color:var(--vscode-descriptionForeground);font-size:9px;margin-left:4px}
.empty-hint{color:var(--vscode-descriptionForeground);font-size:10px;padding:16px 14px;text-align:center;opacity:0.5}
</style>
</head>
<body>
<div class="toolbar">
  <h1>🔗 Key Dependency Graph</h1>
  <span class="stat total">${totalKeys} Keys</span>
  <span class="stat ref">✅ ${referencedCount} Ref</span>
  <span class="stat unref">⚠️ ${unreferencedCount} Unref</span>
  <input class="search-box" id="search" placeholder="Search..." />
  <button class="btn" id="btnAll" onclick="setFilter('all')">All</button>
  <button class="btn" id="btnFile" onclick="setFilter('file')">Files</button>
  <button class="btn" id="btnKey" onclick="setFilter('key')">Keys</button>
  <button class="btn" id="btnCopyPrompt" onclick="copyAIPrompt()" title="Copy AI prompt for unreferenced keys">📋 AI Prompt</button>
  <button class="btn" id="btnDeleteUnref" onclick="deleteUnrefKeys()" title="Delete all unreferenced keys" style="background:color-mix(in srgb,var(--vscode-charts-red) 30%,transparent);color:var(--vscode-charts-red)">🗑️ Clean</button>
  <select id="sortSelect" onchange="changeSort()" style="background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px;padding:2px 6px;color:var(--vscode-input-foreground);font-size:10px">
    <option value="alpha">A→Z</option>
    <option value="freq">Freq ↓</option>
    <option value="freqAsc">Freq ↑</option>
  </select>
</div>
<div class="main" id="main"></div>
<div class="detail-panel" id="detailPanel">
  <h3 id="detailTitle"></h3>
  <div class="detail-value" id="detailValue"></div>
  <div class="detail-section" id="detailRefs">
    <div class="detail-section-title">Referenced By</div>
    <div id="detailRefList"></div>
  </div>
</div>
<script>
const DATA=${dataJson};
const VS=acquireVsCodeApi();
let currentFilter='all',selectedId=null,searchTerm='',currentSort='alpha';

const fileNodes=DATA.nodes.filter(n=>n.group==='file');
const keyNodes=DATA.nodes.filter(n=>n.group==='key');
const unrefNodes=DATA.nodes.filter(n=>n.group==='unreferenced');

const fileToKeys={},keyToFiles={},keyToRefs={};
DATA.links.forEach(l=>{
  const sid=l.source.id||l.source,tid=l.target.id||l.target;
  if(!fileToKeys[sid])fileToKeys[sid]=[];
  fileToKeys[sid].push(tid);
  if(!keyToFiles[tid])keyToFiles[tid]=[];
  keyToFiles[tid].push(sid);
  if(!keyToRefs[tid])keyToRefs[tid]=[];
  keyToRefs[tid].push({file:sid,line:l.line,column:l.column});
});

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function splitPath(id){
  const idx=id.lastIndexOf('/');
  if(idx===-1)return{dir:'',name:id};
  return{dir:id.substring(0,idx)+'/',name:id.substring(idx+1)};
}

function render(){
  const main=document.getElementById('main');
  main.innerHTML='';

  const showFiles=currentFilter!=='key';
  const showKeys=currentFilter!=='file';

  if(showFiles){
    const filtered=fileNodes.filter(n=>!searchTerm||n.id.toLowerCase().includes(searchTerm));
    const sec=mkSection('📄 Files','('+filtered.length+')','file-section',filtered.length===0);
    const body=sec.querySelector('.section-body');
    if(filtered.length===0){
      body.innerHTML='<div class="empty-hint">No files found</div>';
    }else{
      filtered.forEach(n=>{
        const keys=fileToKeys[n.id]||[];
        const p=splitPath(n.id);
        const div=document.createElement('div');
        div.className='node-item'+(selectedId===n.id?' selected':'');
        div.innerHTML='<div class="node-dot" style="background:var(--vscode-charts-green)"></div><div class="node-name">'+esc(p.name)+'</div><div class="node-path">'+esc(p.dir)+'</div><div class="node-value"></div><span class="node-badge badge-ref">'+keys.length+' keys</span>';
        div.onclick=()=>selectNode(n.id,'file');
        body.appendChild(div);
      });
    }
    main.appendChild(sec);
  }

  if(showKeys){
    const allKeyNodes=[...keyNodes,...unrefNodes];
    const filtered=allKeyNodes.filter(n=>!searchTerm||n.id.toLowerCase().includes(searchTerm));
    const sec=mkSection('🔑 Referenced Keys','('+keyNodes.filter(n=>!searchTerm||n.id.toLowerCase().includes(searchTerm)).length+')','key-section',false);
    const body=sec.querySelector('.section-body');
    const filteredRef=sortNodes(keyNodes.filter(n=>!searchTerm||n.id.toLowerCase().includes(searchTerm)));
    if(filteredRef.length===0){
      body.innerHTML='<div class="empty-hint">No referenced keys</div>';
    }else{
      filteredRef.forEach(n=>{
        const files=keyToFiles[n.id]||[];
        const div=document.createElement('div');
        div.className='node-item'+(selectedId===n.id?' selected':'');
        const valPreview=n.value?esc(n.value.length>50?n.value.slice(0,50)+'…':n.value):'';
        div.innerHTML='<div class="node-dot" style="background:var(--vscode-charts-blue)"></div><div class="node-name">'+esc(n.id)+'</div><div class="node-path"></div><div class="node-value">'+(valPreview?'"'+valPreview+'"':'')+'</div><span class="node-badge badge-ref">'+files.length+' ref'+(files.length!==1?'s':'')+'</span>';
        div.onclick=()=>selectNode(n.id,'key');
        body.appendChild(div);
      });
    }
    main.appendChild(sec);

    if(showFiles){
      const sec2=mkSection('⚠️ Unreferenced Keys','('+unrefNodes.filter(n=>!searchTerm||n.id.toLowerCase().includes(searchTerm)).length+')','unref-section',false);
      const body2=sec2.querySelector('.section-body');
      const filteredUnref=sortNodes(unrefNodes.filter(n=>!searchTerm||n.id.toLowerCase().includes(searchTerm)));
      if(filteredUnref.length===0){
        body2.innerHTML='<div class="empty-hint">No unreferenced keys ✅</div>';
      }else{
        filteredUnref.forEach(n=>{
          const div=document.createElement('div');
          div.className='node-item'+(selectedId===n.id?' selected':'');
          const valPreview=n.value?esc(n.value.length>50?n.value.slice(0,50)+'…':n.value):'';
          div.innerHTML='<div class="node-dot" style="background:var(--vscode-charts-red)"></div><div class="node-name">'+esc(n.id)+'</div><div class="node-path"></div><div class="node-value">'+(valPreview?'"'+valPreview+'"':'')+'</div><span class="node-badge badge-unref">0 ref</span>';
          div.onclick=()=>selectNode(n.id,'key');
          body2.appendChild(div);
        });
      }
      main.appendChild(sec2);
    }
  }
}

function mkSection(title,count,cls,collapsed){
  const sec=document.createElement('div');
  sec.className='section';
  const header=document.createElement('div');
  header.className='section-header'+(collapsed?' collapsed':'');
  header.innerHTML='<span class="arrow">▼</span> '+title+' <span class="count">'+count+'</span>';
  header.onclick=()=>{header.classList.toggle('collapsed');};
  const body=document.createElement('div');
  body.className='section-body';
  sec.appendChild(header);
  sec.appendChild(body);
  return sec;
}

function selectNode(id,type){
  selectedId=selectedId===id?null:id;
  render();
  if(selectedId)showDetail(id,type);
  else document.getElementById('detailPanel').classList.remove('show');
}

function showDetail(id,type){
  const panel=document.getElementById('detailPanel');
  document.getElementById('detailTitle').textContent=id;
  const node=DATA.nodes.find(n=>n.id===id);
  document.getElementById('detailValue').textContent=node&&node.value?'"'+node.value+'"':'';
  const refList=document.getElementById('detailRefList');
  refList.innerHTML='';
  if(type==='file'){
    const keys=fileToKeys[id]||[];
    if(keys.length===0){refList.innerHTML='<div style="color:var(--vscode-descriptionForeground);font-size:10px">No keys referenced</div>';}
    else{keys.forEach(k=>{const div=document.createElement('div');div.className='ref-item';div.textContent='🔑 '+k;div.onclick=()=>selectNode(k,'key');refList.appendChild(div);});}
  }else{
    const refs=keyToRefs[id]||[];
    if(refs.length===0){refList.innerHTML='<div style="color:var(--vscode-descriptionForeground);font-size:10px">No references found</div>';}
    else{refs.forEach(r=>{
      const p=splitPath(r.file);
      const div=document.createElement('div');
      div.className='ref-item';
      div.innerHTML='<span class="ref-file">'+esc(p.name)+'</span><span class="ref-line">:'+r.line+'</span><span class="ref-dir">'+esc(p.dir)+'</span>';
      div.onclick=()=>openFile(r.file,r.line,r.column);
      refList.appendChild(div);
    });}
  }
  panel.classList.add('show');
}

function openFile(file,line,column){
  VS.postMessage({type:'openFile',file,line,column});
}

function copyAIPrompt(){
  const unrefKeys=unrefNodes;
  if(unrefKeys.length===0){
    document.getElementById('btnCopyPrompt').textContent='✅ No unref';
    setTimeout(()=>{document.getElementById('btnCopyPrompt').textContent='📋 AI Prompt';},1500);
    return;
  }
  let prompt='I have the following i18n keys that are NOT referenced in any code file. Please review and remove them if they are truly unused, or add the missing references:\\n\\n';
  unrefKeys.forEach(n=>{
    const val=n.value||'(no value)';
    prompt+='- Key: "'+n.id+'"  Value: "'+val+'"\\n';
  });
  prompt+='\\nPlease check each key and either:\\n1. Remove the key if it is truly unused\\n2. Add the missing code reference if the key should be used\\n3. Keep the key if it is intentionally reserved for future use';
  VS.postMessage({type:'copyPrompt',prompt:prompt});
  document.getElementById('btnCopyPrompt').textContent='✅ Copied!';
  setTimeout(()=>{document.getElementById('btnCopyPrompt').textContent='📋 AI Prompt';},2000);
}

function deleteUnrefKeys(){
  if(unrefNodes.length===0){
    document.getElementById('btnDeleteUnref').textContent='✅ No unref';
    setTimeout(()=>{document.getElementById('btnDeleteUnref').textContent='🗑️ Clean';},1500);
    return;
  }
  const keys=unrefNodes.map(n=>n.id);
  VS.postMessage({type:'deleteUnrefKeys',keys:keys});
  document.getElementById('btnDeleteUnref').textContent='⏳ Deleting...';
}

function changeSort(){
  currentSort=document.getElementById('sortSelect').value;
  render();
}

function sortNodes(nodes){
  const sorted=[...nodes];
  if(currentSort==='freq'){
    sorted.sort((a,b)=>{
      const ra=(keyToRefs[a.id]||[]).length;
      const rb=(keyToRefs[b.id]||[]).length;
      return rb-ra||a.id.localeCompare(b.id);
    });
  }else if(currentSort==='freqAsc'){
    sorted.sort((a,b)=>{
      const ra=(keyToRefs[a.id]||[]).length;
      const rb=(keyToRefs[b.id]||[]).length;
      return ra-rb||a.id.localeCompare(b.id);
    });
  }else{
    sorted.sort((a,b)=>a.id.localeCompare(b.id));
  }
  return sorted;
}

function setFilter(type){
  currentFilter=type;
  document.querySelectorAll('.btn').forEach(b=>b.classList.remove('active'));
  const id='btn'+type.charAt(0).toUpperCase()+type.slice(1);
  const el=document.getElementById(id);if(el)el.classList.add('active');
  render();
}

document.getElementById('search').addEventListener('input',e=>{
  searchTerm=(e.target.value||'').toLowerCase();
  render();
});

render();
</script>
</body>
</html>`
  }

  async getKeyReferences(key: string): Promise<KeyReference[]> {
    const graph = await this.buildDependencyGraph()
    return graph[key] || []
  }

  private extToLanguageId(ext: string): string {
    switch (ext) {
      case 'go': return 'go'
      case 'vue': return 'vue'
      case 'html': return 'html'
      case 'js': return 'javascript'
      case 'ts': return 'typescript'
      case 'jsx': return 'javascriptreact'
      case 'tsx': return 'typescriptreact'
      default: return ext
    }
  }
}
