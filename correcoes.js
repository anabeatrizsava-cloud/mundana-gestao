/* ============================================================
   MUNDANA · CORREÇÕES — Lote 1: proteção dos dados
   Instalação: no index.html, DEPOIS de todos os outros scripts e antes de </body>:
       <script src="correcoes.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha.
   Autoteste: no console (F12) digite  await CorrecoesTeste()

   O que corrige:
   C1  Documentos: o arquivo passa a ser guardado em linha própria (docfile_<id>)
       e a lista só leva os dados do arquivo. Abrir/baixar busca o arquivo na hora.
       Documentos antigos são migrados quando possível.
   C2  Backup completo (todos os módulos, inclusive Quadros e Planejamento, mais
       os Leads do quiz) e restauração com escolha dos módulos, que nunca troca
       dados por backup vazio sem você marcar.
   C3  Excluir o último item de uma lista agora funciona (não volta sozinho).
   C4  Envio ao Supabase: grava primeiro e só depois apaga o que sobrou; nunca
       deixa a tabela vazia se o envio falhar; os envios de cada módulo entram
       em fila (sem corrida); campos que a tabela não conhece não derrubam mais o envio.
   Extra: a carga inicial não baixa mais os arquivos dos documentos, e a busca de
       Documentos não perde o foco a cada letra.
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof TABLE_MAP === 'undefined' || typeof SIMPLE_ARRAY_TABLES === 'undefined' ||
      typeof SUPABASE_URL === 'undefined' || typeof sbFetch !== 'function' || typeof uid !== 'function') {
    console.error('correcoes.js: carregue este arquivo DEPOIS do script principal do sistema (antes de </body>).');
    return;
  }
  if (window.__correcoesLote1) { return; }
  window.__correcoesLote1 = true;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- transporte (trocável nos testes) ---------------- */
  var T = {
    enviar: async function (metodo, caminho, corpo, extra) {
      var h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
      if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k]; } }
      var r = await fetch(SUPABASE_URL + '/rest/v1/' + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      var dados = null;
      try { dados = await r.json(); } catch (e) { dados = null; }
      return { ok: r.ok, status: r.status, dados: dados };
    }
  };

  /* ---------------- C4: campos desconhecidos não derrubam o envio ---------------- */
  Object.keys(TABLE_MAP).forEach(function (k) {
    var m = TABLE_MAP[k];
    if (m.isJsonStore || m.toRow || !m.cols) return;
    m.toRow = function (r) {
      var o = {};
      m.cols.forEach(function (c) { if (r[c] !== undefined) o[c] = r[c]; });
      return o;
    };
  });

  function normalizarLinhas(linhas) {
    var chaves = {};
    linhas.forEach(function (l) { Object.keys(l).forEach(function (k) { chaves[k] = true; }); });
    var lista = Object.keys(chaves);
    return linhas.map(function (l) {
      var o = {};
      lista.forEach(function (k) { o[k] = (l[k] === undefined) ? null : l[k]; });
      return o;
    });
  }

  /* ---------------- C4: envio seguro ao Supabase ---------------- */
  function erroDeConstraint(r) {
    return !!r && r.status === 400 && /on conflict|constraint|42P10/i.test(JSON.stringify(r.dados || ''));
  }

  async function sincronizarJson(k, data) {
    var r = await T.enviar('POST', 'app_data?on_conflict=key', { key: k, value: data }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (r.ok) return true;
    var p = await T.enviar('PATCH', 'app_data?key=eq.' + encodeURIComponent(k), { value: data }, { Prefer: 'return=representation' });
    if (p.ok && Array.isArray(p.dados) && p.dados.length > 0) return true;
    var q = await T.enviar('POST', 'app_data', { key: k, value: data });
    return q.ok;
  }

  /* Caminho antigo (apaga tudo e reinsere), agora com cópia de segurança e devolução se falhar. */
  async function tabelaCaminhoAntigo(map, linhas) {
    var snap = await T.enviar('GET', map.table + '?select=*');
    if (!snap.ok || !Array.isArray(snap.dados)) return false;
    var d = await T.enviar('DELETE', map.table + '?id=neq.___never___');
    if (!d.ok) return false;
    var p = await T.enviar('POST', map.table, linhas);
    if (p.ok) return true;
    if (snap.dados.length) await T.enviar('POST', map.table, snap.dados);
    return false;
  }

  async function sincronizarTabela(k, map, data, vazio) {
    var linhas = map.toRow ? data.map(map.toRow) : data.slice();
    if (!linhas.length) {
      if (!vazio) return true;
      var d0 = await T.enviar('DELETE', map.table + '?id=neq.___never___');
      return d0.ok;
    }
    linhas = normalizarLinhas(linhas);
    var u = await T.enviar('POST', map.table + '?on_conflict=id', linhas, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (!u.ok) {
      if (!erroDeConstraint(u)) return false;
      return tabelaCaminhoAntigo(map, linhas);
    }
    var temId = {};
    linhas.forEach(function (l) { temId[String(l.id)] = true; });
    var ex = await T.enviar('GET', map.table + '?select=id');
    if (ex.ok && Array.isArray(ex.dados)) {
      var sobra = ex.dados.map(function (x) { return String(x.id); }).filter(function (id) { return !temId[id]; });
      for (var i = 0; i < sobra.length; i += 40) {
        var lote = sobra.slice(i, i + 40).map(function (id) { return '"' + id.replace(/(["\\])/g, '\\$1') + '"'; });
        await T.enviar('DELETE', map.table + '?id=in.(' + lote.join(',') + ')');
      }
    }
    return true;
  }

  async function sincronizarSimples(k, data, vazio) {
    if (!data || data.length === 0) {
      if (!vazio) return true;
      var d0 = await T.enviar('DELETE', k + '?id=gt.0');
      return d0.ok;
    }
    var snap = await T.enviar('GET', k + '?select=*');
    if (!snap.ok || !Array.isArray(snap.dados)) return false;
    var d = await T.enviar('DELETE', k + '?id=gt.0');
    if (!d.ok) return false;
    var p = await T.enviar('POST', k, data.map(function (n) { return { name: n }; }));
    if (p.ok) return true;
    if (snap.dados.length) await T.enviar('POST', k, snap.dados);
    return false;
  }

  async function sincronizar(k, data, vazio) {
    var map = TABLE_MAP[k];
    if (map && !map.isJsonStore) return sincronizarTabela(k, map, Array.isArray(data) ? data : [], vazio);
    if (SIMPLE_ARRAY_TABLES.indexOf(k) > -1) return sincronizarSimples(k, data, vazio);
    return sincronizarJson(k, data);
  }

  /* Fila por módulo: um envio de cada vez e, se chegarem vários, só o mais novo é enviado. */
  var fila = {};
  function agendar(k, data, vazio) {
    var f = fila[k];
    if (!f) { f = fila[k] = { rodando: false, pendente: null, promessa: null }; }
    f.pendente = { data: data, vazio: vazio };
    if (f.rodando) return f.promessa;
    f.rodando = true;
    f.promessa = (async function () {
      try {
        while (f.pendente) {
          var item = f.pendente; f.pendente = null;
          try {
            var ok = await sincronizar(k, item.data, item.vazio);
            if (!ok) console.warn('correcoes: envio não confirmado para', k);
          } catch (e) { console.warn('Sync error:', k, e); }
        }
      } finally { f.rodando = false; }
    })();
    return f.promessa;
  }

  /* ---------------- C3: esvaziar a lista de propósito ---------------- */
  var intencional = {};
  var setAnterior = DB.set;
  DB.set = function (k, d) {
    try {
      if (Array.isArray(d) && d.length === 0) {
        var antes = DB.get(k);
        if (Array.isArray(antes) && antes.length > 0) {
          intencional[k] = true;
          try { localStorage.removeItem('mundana_bkp_' + k); } catch (e) { /* ignorar */ }
        }
      }
    } catch (e) { console.warn('correcoes: set', e); }
    return setAnterior.apply(DB, arguments);
  };
  DB.set._qdAut = setAnterior._qdAut;

  DB._syncToSupabase = function (k, data) {
    var vazio = !!intencional[k];
    delete intencional[k];
    return agendar(k, data, vazio);
  };
  DB._flush = function () {
    return Promise.all(Object.keys(fila).map(function (k) { return fila[k].promessa || Promise.resolve(); }));
  };

  /* ---------------- carga inicial mais leve ---------------- */
  function ajustarCaminhoCarga(path) {
    if (path === 'app_data?select=key,value') return 'app_data?select=key,value&key=not.like.docfile_*';
    return path;
  }
  var sbFetchAnterior = window.sbFetch;
  window.sbFetch = function (path, opts) { return sbFetchAnterior.call(this, ajustarCaminhoCarga(path), opts); };

  /* ---------------- C1: documentos com o arquivo em linha própria ---------------- */
  var LIMITE_ARQUIVO = 3 * 1024 * 1024;
  var cacheArq = {};

  async function enviarArquivo(id, dataUrl) {
    var r = await T.enviar('POST', 'app_data?on_conflict=key', { key: 'docfile_' + id, value: dataUrl }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    return r.ok;
  }
  async function buscarArquivo(id) {
    var r = await T.enviar('GET', 'app_data?key=eq.docfile_' + encodeURIComponent(id) + '&select=value');
    if (r.ok && Array.isArray(r.dados) && r.dados[0] && typeof r.dados[0].value === 'string') return r.dados[0].value;
    return null;
  }
  async function apagarArquivo(id) {
    try { await T.enviar('DELETE', 'app_data?key=eq.docfile_' + encodeURIComponent(id)); } catch (e) { /* ignorar */ }
  }
  function temDados(d) { return typeof d.data === 'string' && d.data.indexOf('data:') === 0; }
  function indisponivel(d) { return !d.remoto && !temDados(d); }

  async function obterArquivo(d) {
    if (cacheArq[d.id]) return cacheArq[d.id];
    if (temDados(d)) { cacheArq[d.id] = d.data; return d.data; }
    if (d.remoto) {
      var v = await buscarArquivo(d.id);
      if (v) { cacheArq[d.id] = v; return v; }
    }
    return null;
  }

  function miniatura(dataUrl) {
    return new Promise(function (resolve) {
      var feito = false;
      function fim(v) { if (!feito) { feito = true; resolve(v || ''); } }
      setTimeout(function () { fim(''); }, 3000);
      try { compressImage(dataUrl, 80, 0.6, fim); } catch (e) { fim(''); }
    });
  }

  /* Move documentos antigos (arquivo dentro da lista) para linhas próprias. */
  async function migrarLegados(lista) {
    var itens = DB.get(lista); var mudou = false;
    var precisaRecuperar = itens.some(function (d) { return !d.remoto && !temDados(d); });
    var remotos = null;
    if (precisaRecuperar) {
      try {
        var rr = await T.enviar('GET', 'app_data?key=eq.' + encodeURIComponent(lista) + '&select=value');
        if (rr.ok && Array.isArray(rr.dados) && rr.dados[0] && Array.isArray(rr.dados[0].value)) remotos = rr.dados[0].value;
      } catch (e) { remotos = null; }
    }
    for (var i = 0; i < itens.length; i++) {
      var d = itens[i];
      if (d.remoto) continue;
      var dados = temDados(d) ? d.data : null;
      if (!dados && remotos) {
        var rem = null;
        for (var j = 0; j < remotos.length; j++) { if (remotos[j] && remotos[j].id === d.id) { rem = remotos[j]; break; } }
        if (rem && typeof rem.data === 'string' && rem.data.indexOf('data:') === 0) dados = rem.data;
      }
      if (!dados) continue;
      var enviado = false;
      try { enviado = await enviarArquivo(d.id, dados); } catch (e) { enviado = false; }
      if (enviado) { cacheArq[d.id] = dados; delete d.data; d.remoto = true; mudou = true; }
    }
    if (mudou) DB.set(lista, itens);
    return mudou;
  }

  var migrou = false;
  function migrarLegadosUmaVez() {
    if (migrou) return;
    migrou = true;
    Promise.all([migrarLegados('mydocs'), migrarLegados('empresa_docs')]).then(function (res) {
      if (res[0] && S.page === 'docs') rDocs();
      if (res[1] && S.page === 'empresa') rEmpresa();
    }).catch(function (e) { console.warn('correcoes: migração', e); migrou = false; });
  }

  async function baixarItem(lista, id) {
    var d = null;
    DB.get(lista).forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return;
    var data = await obterArquivo(d);
    if (!data) { toast('Arquivo indisponível. Envie novamente.'); return; }
    var blob = await (await fetch(data)).blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = d.fileName || d.name || 'arquivo';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* --- Documentos --- */
  function htmlLinhaDoc(d) {
    var ehImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(d.fileName || '');
    var sem = indisponivel(d);
    var id = esc(d.id);
    var icone = (ehImg && d.thumb)
      ? '<img src="' + esc(d.thumb) + '" style="width:36px;height:36px;border-radius:6px;object-fit:cover">'
      : '<span style="width:24px;height:24px;flex-shrink:0;color:var(--text-muted)">' + I.file + '</span>';
    return '<tr><td><div style="display:flex;align-items:center;gap:10px;' + (sem ? '' : 'cursor:pointer') + '"' + (sem ? '' : ' onclick="previewDoc(\'' + id + '\')"') + '>' + icone +
      '<div><strong>' + esc(d.name || d.fileName) + '</strong><div style="font-size:11px;color:var(--text-muted)">' + esc(d.fileName || '') +
      (sem ? ' \u00B7 <span style="color:var(--rosa-antigo)">arquivo indisponível, envie de novo</span>' : '') + '</div></div></div></td>' +
      '<td style="font-size:12px;color:var(--text-muted)">' + (d.size ? formatSize(d.size) : '-') + '</td>' +
      '<td style="font-size:12px;color:var(--text-muted)">' + fmtD(d.date) + '</td><td style="text-align:right">' +
      (sem ? '' : '<button class="btn-icon" onclick="previewDoc(\'' + id + '\')" title="Visualizar" style="display:inline-flex">' + I.eye + '</button>' +
        '<button class="btn-icon" onclick="baixarDoc(\'' + id + '\')" title="Baixar" style="display:inline-flex;margin-left:4px">' + I.download + '</button>') +
      '<button class="btn-icon" onclick="editDoc(\'' + id + '\')" style="display:inline-flex;margin-left:4px">' + I.edit + '</button>' +
      '<button class="btn-icon" onclick="delDoc(\'' + id + '\')" style="display:inline-flex;margin-left:4px">' + I.trash + '</button></td></tr>';
  }
  function docsFiltrados() {
    return DB.get('mydocs').filter(function (i) {
      if (S.docFolder !== 'all' && i.folder !== S.docFolder) return false;
      if (S._docBusca) {
        var q = S._docBusca.toLowerCase();
        if ((i.name || '').toLowerCase().indexOf(q) < 0 && (i.fileName || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function htmlListaDocs() {
    var todos = DB.get('mydocs'); var filtrados = docsFiltrados();
    if (!filtrados.length) {
      return '<div class="empty-state"><div class="empty-icon">' + I.file + '</div><h3>Nenhum documento</h3><p>' + (todos.length > 0 ? 'Nenhum resultado para busca/filtro' : 'Envie seus primeiros arquivos') + '</p>' +
        (todos.length === 0 ? '<button class="btn btn-primary" onclick="uploadDoc()">' + I.plus + ' Enviar Arquivo</button>' : '') + '</div>';
    }
    return '<div class="card"><div class="table-wrapper"><table><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th><th></th></tr></thead><tbody>' +
      filtrados.map(htmlLinhaDoc).join('') + '</tbody></table></div></div>';
  }
  function atualizarListaDocs() {
    var el = document.getElementById('docsLista');
    if (el) el.innerHTML = htmlListaDocs();
  }
  function rDocsNovo() {
    var items = DB.get('mydocs'), folders = DB.get('doc_folders');
    if (!S._docBusca) S._docBusca = '';
    var totalSize = items.reduce(function (s, i) { return s + (i.size || 0); }, 0);
    document.getElementById('content').innerHTML =
      '<div class="page-header anim"><div class="page-header-left"><h2>Documentos</h2><p>' + items.length + ' arquivo' + (items.length !== 1 ? 's' : '') + (totalSize > 0 ? ' \u00B7 ' + formatSize(totalSize) : '') + '</p></div>' +
      '<div class="page-header-actions"><button class="btn btn-secondary btn-sm" onclick="openDocFolderModal()">' + I.folder + ' Pastas</button><button class="btn btn-primary" onclick="uploadDoc()">' + I.plus + ' Enviar Arquivo</button></div></div>' +
      '<div style="display:grid;grid-template-columns:200px 1fr;gap:16px" class="anim d1"><div style="align-self:start">' +
      '<div class="search-box" style="margin-bottom:10px;width:100%">' + I.search + '<input class="form-input" placeholder="Buscar..." value="' + esc(S._docBusca) + '" oninput="S._docBusca=this.value;atualizarListaDocs()" style="width:100%"></div>' +
      '<div class="card" style="padding:8px"><div style="padding:8px 12px;font-size:13px;cursor:pointer;border-radius:var(--radius-md);' + (S.docFolder === 'all' ? 'font-weight:700;background:var(--bg-warm)' : '') + '" onclick="S.docFolder=\'all\';rDocs()">Todos <span style="float:right;font-size:12px;color:var(--text-muted)">' + items.length + '</span></div>' +
      folders.map(function (f) {
        return '<div style="padding:8px 12px;font-size:13px;cursor:pointer;border-radius:var(--radius-md);' + (S.docFolder === f.id ? 'font-weight:700;background:var(--bg-warm)' : 'color:var(--text-secondary)') + '" onclick="S.docFolder=\'' + esc(f.id) + '\';rDocs()">' + esc(f.name) +
          ' <span style="float:right;font-size:12px;color:var(--text-muted)">' + items.filter(function (i) { return i.folder === f.id; }).length + '</span></div>';
      }).join('') + '</div></div><div id="docsLista">' + htmlListaDocs() + '</div></div>';
    migrarLegadosUmaVez();
  }

  async function saveDocUploadNovo() {
    if (!_docUpData) { toast('Selecione um arquivo'); return; }
    if (_docUpSize > LIMITE_ARQUIVO) { toast('O arquivo passa de 3 MB. Reduza ou comprima antes de enviar.'); return; }
    var id = uid(), nomeArq = _docUpFileName, dados = _docUpData, tam = _docUpSize;
    var nomeEl = document.getElementById('docUpName'), pastaEl = document.getElementById('docUpFolder');
    var nome = (nomeEl && nomeEl.value) || nomeArq, pasta = (pastaEl && pastaEl.value) || '';
    toast('Enviando arquivo...');
    var ok = false;
    try { ok = await enviarArquivo(id, dados); } catch (e) { ok = false; }
    if (!ok) { toast('Não consegui enviar o arquivo. Nada foi salvo; tente de novo.'); return; }
    cacheArq[id] = dados;
    var thumb = '';
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(nomeArq)) thumb = await miniatura(dados);
    var itens = DB.get('mydocs');
    itens.push({ id: id, name: nome, fileName: nomeArq, folder: pasta, size: tam, date: localDateStr(), thumb: thumb, remoto: true });
    DB.set('mydocs', itens);
    _docUpData = ''; _docUpFileName = ''; _docUpSize = 0;
    closeModal(); rDocs(); toast('Arquivo salvo');
  }

  async function previewDocNovo(id) {
    var d = null;
    DB.get('mydocs').forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return;
    var data = await obterArquivo(d);
    if (!data) { toast('Arquivo indisponível. Envie novamente.'); return; }
    var fn = d.fileName || '';
    var blob = await (await fetch(data)).blob();
    var url = URL.createObjectURL(blob);
    var ehImg = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fn), ehPdf = /\.pdf$/i.test(fn);
    var conteudo;
    if (ehImg) conteudo = '<div style="text-align:center;max-height:70vh;overflow:auto"><img src="' + url + '" style="max-width:100%;border-radius:var(--radius-md)"></div>';
    else if (ehPdf) conteudo = '<iframe src="' + url + '" style="width:100%;height:70vh;border:none;border-radius:var(--radius-md)"></iframe>';
    else conteudo = '<div style="text-align:center;padding:40px"><div style="width:48px;height:48px;margin:0 auto 16px;color:var(--text-muted)">' + I.file + '</div><p style="color:var(--text-muted);margin-bottom:16px">Pré-visualização não disponível para este tipo de arquivo</p><button class="btn btn-primary" onclick="baixarDoc(\'' + esc(d.id) + '\')">' + I.download + ' Baixar arquivo</button></div>';
    openModal(d.name || fn, conteudo, '<button class="btn btn-secondary" onclick="baixarDoc(\'' + esc(d.id) + '\')" style="margin-right:auto">' + I.download + ' Baixar</button><button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', true);
  }

  function delDocNovo(id) {
    if (!window.confirm('Excluir documento?')) return;
    DB.set('mydocs', DB.get('mydocs').filter(function (x) { return x.id !== id; }));
    apagarArquivo(id); delete cacheArq[id];
    rDocs(); toast('Excluído');
  }

  /* --- Documentos da empresa (Dados Mundana) --- */
  function renderEmpresaDocsNovo() {
    var docs = DB.get('empresa_docs');
    migrarLegadosUmaVez();
    return '<div class="card"><div class="card-header"><h3>Documentos da Empresa</h3><button class="btn btn-primary btn-sm" onclick="openEmpDocModal()">' + I.plus + ' Anexar Documento</button></div><div class="card-body">' +
      (docs.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">Nenhum documento anexado</div>' :
        '<div class="table-wrapper"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Data</th><th></th></tr></thead><tbody>' +
        docs.map(function (d) {
          var sem = indisponivel(d);
          return '<tr><td><div style="display:flex;align-items:center;gap:8px"><span style="width:18px;height:18px;flex-shrink:0;color:var(--text-muted)">' + I.file + '</span> <strong>' + esc(d.name) + '</strong>' +
            (sem ? ' <span style="font-size:11px;color:var(--rosa-antigo)">arquivo indisponível, anexe de novo</span>' : '') + '</div></td>' +
            '<td><span class="badge badge-lavanda">' + esc(d.tipo || 'Geral') + '</span></td><td>' + fmtD(d.date) + '</td><td style="text-align:right">' +
            (sem ? '' : '<button class="btn-icon" onclick="baixarEmpDoc(\'' + esc(d.id) + '\')" style="display:inline-flex">' + I.download + '</button>') +
            '<button class="btn-icon" onclick="delEmpDoc(\'' + esc(d.id) + '\')" style="display:inline-flex;margin-left:4px">' + I.trash + '</button></td></tr>';
        }).join('') + '</tbody></table></div>') + '</div></div>';
  }
  async function saveEmpDocNovo() {
    var nomeEl = document.getElementById('edN'), tipoEl = document.getElementById('edT');
    var name = nomeEl ? nomeEl.value : '';
    if (!name || !_empDocData) { toast('Preencha nome e anexe arquivo'); return; }
    var tam = Math.round(_empDocData.length * 0.75);
    if (tam > LIMITE_ARQUIVO) { toast('O arquivo passa de 3 MB. Reduza ou comprima antes de enviar.'); return; }
    var id = uid(), dados = _empDocData, nomeArq = _empDocFileName, tipo = tipoEl ? tipoEl.value : '';
    toast('Enviando arquivo...');
    var ok = false;
    try { ok = await enviarArquivo(id, dados); } catch (e) { ok = false; }
    if (!ok) { toast('Não consegui enviar o arquivo. Nada foi salvo; tente de novo.'); return; }
    cacheArq[id] = dados;
    var docs = DB.get('empresa_docs');
    docs.push({ id: id, name: name, tipo: tipo, date: localDateStr(), fileName: nomeArq, size: tam, remoto: true });
    DB.set('empresa_docs', docs);
    _empDocData = ''; _empDocFileName = '';
    closeModal(); rEmpresa(); toast('Documento anexado');
  }
  function delEmpDocNovo(id) {
    if (!window.confirm('Excluir documento?')) return;
    DB.set('empresa_docs', DB.get('empresa_docs').filter(function (d) { return d.id !== id; }));
    apagarArquivo(id); delete cacheArq[id];
    rEmpresa(); toast('Documento excluído');
  }

  /* ---------------- C2: backup completo e restauração segura ---------------- */
  var EFEMERAS = /^(bkp_|mododia_done_|mododia_dismiss_|mododia_firstseen|mododia_seen|last_backup|auth)/;
  var NOMES = {
    products: 'Produtos', product_folders: 'Pastas de produtos', formulas: 'Fórmulas', stockmp: 'Estoque de matérias-primas',
    stockpa: 'Estoque de produto acabado', lots: 'Lotes', suppliers: 'Fornecedores', sup_mp_link: 'Fornecedor x matéria-prima',
    mp_price_hist: 'Histórico de preços (MP)', price_history: 'Histórico de preços (produtos)', pagar: 'A Pagar', receber: 'A Receber',
    pedidos: 'Pedidos', ideias: 'Banco de Ideias', ideia_folders: 'Pastas de ideias', mydocs: 'Documentos', doc_folders: 'Pastas de documentos',
    roteiros: 'Roteiros', rot_fases: 'Roteiros: fases', rot_tipos: 'Roteiros: tipos', rot_freqs: 'Roteiros: frequências',
    lembretes: 'Lembretes (Modo Dia)', empresa: 'Ficha da empresa', empresa_users: 'Acessos', empresa_docs: 'Documentos da empresa',
    config: 'Precificação: parâmetros', fixed_costs: 'Precificação: custos fixos', pricing_lines: 'Precificação: linhas',
    product_types: 'Tipos de produto', pag_types: 'Tipos de lançamento', idea_types: 'Tipos de ideia', planejamento: 'Planejamento',
    quadros: 'Quadros', quadros_modelos: 'Modelos de quadros', alerts_read: 'Alertas lidos'
  };

  function contar(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') {
      if (Array.isArray(v.quadros)) return v.quadros.length;
      if (Array.isArray(v.modelos)) return v.modelos.length;
      return Object.keys(v).length;
    }
    return v ? 1 : 0;
  }

  function coletarBackup() {
    var dados = {};
    Object.keys(localStorage).forEach(function (cheia) {
      if (cheia.indexOf('mundana_') !== 0) return;
      var k = cheia.slice(8);
      if (EFEMERAS.test(k)) return;
      var raw = localStorage.getItem(cheia), v;
      try { v = JSON.parse(raw); } catch (e) { v = raw; }
      dados[k] = v;
    });
    Object.keys(DB._mem || {}).forEach(function (k) {
      if (!(k in dados) && !EFEMERAS.test(k)) dados[k] = DB._mem[k];
    });
    ['mydocs', 'empresa_docs'].forEach(function (k) {
      if (Array.isArray(dados[k])) {
        dados[k] = dados[k].map(function (d) {
          var c = {}; Object.keys(d).forEach(function (p) { c[p] = d[p]; });
          if (c.remoto || !temDados(c)) delete c.data;
          return c;
        });
      }
    });
    return dados;
  }

  function baixarJson(obj, nome) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function exportarBackupCompleto() {
    var dados = coletarBackup();
    var leads = null;
    try {
      var r = await T.enviar('GET', 'leads_quiz?select=*');
      if (r.ok && Array.isArray(r.dados)) leads = r.dados;
    } catch (e) { leads = null; }
    var saida = { _meta: { exportedAt: new Date().toISOString(), version: 'mundana-gestao-v2', tipo: 'completo', modulos: Object.keys(dados).length }, dados: dados };
    if (leads) saida.leads_quiz = leads;
    baixarJson(saida, 'mundana_backup_completo_' + localDateStr() + '.json');
    try { localStorage.setItem('mundana_last_backup', localDateStr()); } catch (e) { /* ignorar */ }
    toast('Backup completo exportado');
    if (typeof rEmpresa === 'function' && S.page === 'empresa') rEmpresa();
    return saida;
  }

  async function exportarArquivosDocs() {
    var saida = [];
    toast('Reunindo arquivos...');
    var listas = ['mydocs', 'empresa_docs'];
    for (var li = 0; li < listas.length; li++) {
      var itens = DB.get(listas[li]);
      for (var i = 0; i < itens.length; i++) {
        var data = await obterArquivo(itens[i]);
        if (data) saida.push({ lista: listas[li], id: itens[i].id, fileName: itens[i].fileName, data: data });
      }
    }
    if (!saida.length) { toast('Nenhum arquivo para exportar'); return; }
    baixarJson({ _meta: { exportedAt: new Date().toISOString(), tipo: 'arquivos' }, arquivos: saida }, 'mundana_arquivos_' + localDateStr() + '.json');
    toast(saida.length + ' arquivo(s) exportado(s)');
  }

  function importarArquivosDocs(event) {
    var arq = event.target.files[0]; if (!arq) return;
    var reader = new FileReader();
    reader.onload = async function (e) {
      try {
        var b = JSON.parse(e.target.result);
        if (!b || !b._meta || b._meta.tipo !== 'arquivos' || !Array.isArray(b.arquivos)) { toast('Este não é um arquivo de documentos do Mundana'); return; }
        var ok = 0;
        for (var i = 0; i < b.arquivos.length; i++) {
          var a = b.arquivos[i];
          if (a && a.id && typeof a.data === 'string' && a.data.indexOf('data:') === 0) {
            if (await enviarArquivo(a.id, a.data)) { cacheArq[a.id] = a.data; ok++; }
          }
        }
        toast(ok + ' arquivo(s) restaurado(s)');
      } catch (err) { toast('Erro ao ler o arquivo: ' + err.message); }
    };
    reader.readAsText(arq);
    event.target.value = '';
  }

  function planejarImportacao(b, atualFn) {
    if (!b || typeof b !== 'object' || !b._meta) return { erro: 'Arquivo inválido: não parece um backup do Mundana Gestão.' };
    var v2 = !!(b.dados && typeof b.dados === 'object');
    var origem = v2 ? b.dados : b;
    var lerAtual = atualFn || function (k) { return DB.get(k); };
    var linhas = [];
    Object.keys(origem).forEach(function (k) {
      if (k === '_meta' || k === 'leads_quiz') return;
      var nb = contar(origem[k]), na = contar(lerAtual(k));
      var arquivos = (k === 'mydocs' || k === 'empresa_docs');
      var avisos = [], padrao = true, bloqueada = false;
      if (nb === 0 && na > 0) { padrao = false; avisos.push('o backup está vazio aqui e o sistema tem ' + na); }
      if (arquivos && !v2) { padrao = false; bloqueada = true; avisos.push('backups antigos não guardam os arquivos'); }
      if (nb === 0 && na === 0) padrao = false;
      linhas.push({ chave: k, nome: NOMES[k] || k, noBackup: nb, noSistema: na, padrao: padrao, bloqueada: bloqueada, aviso: avisos.join('; ') });
    });
    linhas.sort(function (a, c) { return a.nome < c.nome ? -1 : 1; });
    return { linhas: linhas, origem: origem, v2: v2 };
  }

  var planoAtual = null;
  function mostrarPlano(plano) {
    planoAtual = plano;
    var corpo = plano.linhas.map(function (l, i) {
      return '<tr><td><input type="checkbox" class="cr-sel" data-i="' + i + '"' + (l.padrao ? ' checked' : '') + (l.bloqueada ? ' disabled' : '') + '></td>' +
        '<td><strong>' + esc(l.nome) + '</strong>' + (l.aviso ? '<div style="font-size:11px;color:var(--rosa-antigo)">' + esc(l.aviso) + '</div>' : '') + '</td>' +
        '<td style="text-align:center">' + l.noBackup + '</td><td style="text-align:center">' + l.noSistema + '</td></tr>';
    }).join('');
    openModal('Restaurar backup',
      '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Marque o que deve ser restaurado. O que está desmarcado não será alterado. Antes de restaurar, um backup do estado atual é baixado como segurança.</p>' +
      '<table style="width:100%;font-size:12px"><thead><tr><th></th><th>Módulo</th><th>No backup</th><th>No sistema agora</th></tr></thead><tbody>' + corpo + '</tbody></table>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="confirmarRestauracao()">Restaurar selecionados</button>', true);
  }

  async function confirmarRestauracao() {
    if (!planoAtual) return;
    var sel = [].slice.call(document.querySelectorAll('.cr-sel:checked')).map(function (el) { return planoAtual.linhas[parseInt(el.dataset.i, 10)]; });
    if (!sel.length) { toast('Selecione ao menos um módulo'); return; }
    if (!window.confirm('Restaurar ' + sel.length + ' módulo(s)? Antes, será baixado um backup do estado atual como segurança.')) return;
    try { await exportarBackupCompleto(); } catch (e) {
      if (!window.confirm('Não consegui baixar o backup de segurança. Continuar mesmo assim?')) return;
    }
    var origem = planoAtual.origem;
    sel.forEach(function (l) { DB.set(l.chave, origem[l.chave]); });
    planoAtual = null;
    closeModal(); renderNav(); render();
    toast(sel.length + ' módulo(s) restaurado(s)');
  }

  function importarBackup(event) {
    var arq = event.target.files[0]; if (!arq) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var plano = planejarImportacao(JSON.parse(e.target.result));
        if (plano.erro) { toast(plano.erro); return; }
        mostrarPlano(plano);
      } catch (err) { toast('Arquivo inválido: ' + err.message); }
    };
    reader.readAsText(arq);
    event.target.value = '';
  }

  function renderBackupNovo() {
    var dados = coletarBackup();
    var modulos = Object.keys(dados).length, registros = 0;
    Object.keys(dados).forEach(function (k) { registros += contar(dados[k]); });
    var ultimo = localStorage.getItem('mundana_last_backup') || 'Nunca';
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">' +
      '<div class="card" style="border-left:3px solid var(--oliva)"><div class="card-body" style="padding:24px">' +
      '<h3 style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--oliva);display:flex;align-items:center;gap:8px"><span style="width:20px;height:20px;flex-shrink:0">' + I.download + '</span> Exportar Backup</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">Gera um arquivo JSON com <strong>todos os módulos do sistema</strong>, incluindo Quadros, Planejamento, Custos fixos, parâmetros de Precificação e os Leads do quiz. Os <strong>arquivos</strong> dos Documentos têm exportação própria, abaixo.</p>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Dados neste aparelho: <strong>' + registros + ' registros</strong> em ' + modulos + ' módulos<br>Último backup: <strong>' + esc(ultimo) + '</strong></p>' +
      '<button class="btn btn-primary" onclick="exportFullBackup()" style="width:100%"><span style="width:16px;height:16px;display:inline-flex">' + I.download + '</span> Exportar backup completo</button>' +
      '<button class="btn btn-secondary" onclick="exportarArquivosDocs()" style="width:100%;margin-top:8px">Exportar arquivos dos documentos</button></div></div>' +
      '<div class="card" style="border-left:3px solid var(--lavanda)"><div class="card-body" style="padding:24px">' +
      '<h3 style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--lavanda);display:flex;align-items:center;gap:8px"><span style="width:20px;height:20px;flex-shrink:0">' + I.archive + '</span> Restaurar Backup</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">Escolha o arquivo e, na próxima tela, <strong>marque quais módulos restaurar</strong>. Nada é trocado sem confirmação, backup vazio nunca vem marcado por padrão e um backup do estado atual é baixado antes.</p>' +
      '<div class="photo-upload" onclick="document.getElementById(\'backupFileIn\').click()" style="height:70px;margin-bottom:12px"><span style="width:24px;height:24px;display:inline-flex">' + I.file + '</span><span>Selecionar backup (.json)</span><input type="file" id="backupFileIn" accept=".json" onchange="importFullBackup(event)" style="display:none"></div>' +
      '<div class="photo-upload" onclick="document.getElementById(\'arquivosFileIn\').click()" style="height:70px"><span style="width:24px;height:24px;display:inline-flex">' + I.file + '</span><span>Restaurar arquivos dos documentos (.json)</span><input type="file" id="arquivosFileIn" accept=".json" onchange="importarArquivosDocs(event)" style="display:none"></div>' +
      '</div></div></div>' +
      '<div class="card" style="margin-top:20px;border-left:3px solid var(--sol-ancestral)"><div class="card-body" style="padding:20px">' +
      '<h3 style="font-size:14px;font-weight:700;margin-bottom:8px;color:var(--sol-ancestral)">Forçar restauração do Supabase</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Se os dados sumiram do navegador mas podem estar no Supabase, clique abaixo para tentar recuperar.</p>' +
      '<button class="btn btn-secondary" onclick="forceLoadFromSupabase()">Tentar recuperar do Supabase</button></div></div>';
  }

  /* ---------------- instalação das funções novas ---------------- */
  window.rDocs = rDocsNovo;
  window.atualizarListaDocs = atualizarListaDocs;
  window.saveDocUpload = saveDocUploadNovo;
  window.previewDoc = previewDocNovo;
  window.baixarDoc = function (id) { return baixarItem('mydocs', id); };
  window.delDoc = delDocNovo;
  window.renderEmpresaDocs = renderEmpresaDocsNovo;
  window.saveEmpDoc = saveEmpDocNovo;
  window.delEmpDoc = delEmpDocNovo;
  window.baixarEmpDoc = function (id) { return baixarItem('empresa_docs', id); };
  window.renderEmpresaBackup = renderBackupNovo;
  window.exportFullBackup = exportarBackupCompleto;
  window.importFullBackup = importarBackup;
  window.exportarArquivosDocs = exportarArquivosDocs;
  window.importarArquivosDocs = importarArquivosDocs;
  window.confirmarRestauracao = confirmarRestauracao;

  /* ---------------- autoteste (console: await CorrecoesTeste()) ---------------- */
  async function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var enviarOriginal = T.enviar;
    var chamadas = [];
    function mock(resp) {
      T.enviar = async function (m, c, b, e) {
        chamadas.push({ m: m, c: c, b: b, e: e || {} });
        return (resp && resp(m, c, b, e)) || { ok: true, status: 200, dados: null };
      };
    }
    function limpar() { chamadas.length = 0; }
    var criadas = [];
    function limparChave(k) {
      localStorage.removeItem('mundana_' + k); localStorage.removeItem('mundana_bkp_' + k); delete DB._mem[k];
    }
    try {
      /* envio de chaves genéricas */
      mock();
      await sincronizar('zz_json', [{ id: 1 }], false);
      ok('chave genérica usa um único upsert em app_data', chamadas.length === 1 && chamadas[0].m === 'POST' && chamadas[0].c === 'app_data?on_conflict=key' && chamadas[0].b.key === 'zz_json' && /merge-duplicates/.test(chamadas[0].e.Prefer));
      limpar();
      mock(function (m, c) {
        if (c.indexOf('on_conflict') > -1) return { ok: false, status: 404, dados: null };
        if (m === 'PATCH') return { ok: true, status: 200, dados: [] };
        return null;
      });
      var okf = await sincronizar('zz_json', [1], false);
      ok('se o upsert falhar, cai no caminho antigo (PATCH e depois POST)', okf === true && chamadas.map(function (x) { return x.m; }).join(',') === 'POST,PATCH,POST');
      limpar();

      /* tabelas */
      TABLE_MAP.zz_tab = { table: 'zz_tab', cols: ['id', 'name'] };
      mock(function (m) { if (m === 'GET') return { ok: true, status: 200, dados: [{ id: '1' }, { id: '2' }, { id: '3' }] }; return null; });
      await sincronizar('zz_tab', [{ id: '1', name: 'a' }, { id: '2', name: 'b' }], false);
      var del = chamadas.filter(function (x) { return x.m === 'DELETE'; });
      ok('tabela: grava primeiro e só apaga o que sobrou no servidor', chamadas[0].m === 'POST' && chamadas[0].c === 'zz_tab?on_conflict=id' && del.length === 1 && del[0].c.indexOf('id=in.(') > -1 && del[0].c.indexOf('"3"') > -1 && del[0].c.indexOf('"1"') < 0);
      limpar();
      mock(function (m) { if (m === 'POST') return { ok: false, status: 500, dados: null }; return { ok: true, status: 200, dados: [] }; });
      var o5 = await sincronizar('zz_tab', [{ id: '1', name: 'a' }], false);
      ok('se o envio falhar, nada é apagado no servidor', o5 === false && chamadas.every(function (x) { return x.m !== 'DELETE'; }));
      limpar();
      mock(function (m, c) {
        if (m === 'POST' && c.indexOf('on_conflict') > -1) return { ok: false, status: 400, dados: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } };
        if (m === 'GET') return { ok: true, status: 200, dados: [{ id: 'x', name: 'antigo' }] };
        if (m === 'POST') return { ok: false, status: 400, dados: { message: 'coluna inexistente' } };
        return null;
      });
      var o6 = await sincronizar('zz_tab', [{ id: '1', name: 'a' }], false);
      var posts = chamadas.filter(function (x) { return x.m === 'POST'; });
      ok('sem chave em id: usa o caminho antigo e, se a reinserção falhar, devolve o que havia', o6 === false && posts.length === 3 && posts[2].b[0].id === 'x');
      limpar();
      mock();
      await sincronizar('zz_tab', [], false);
      ok('lista vazia sem intenção não apaga o servidor', chamadas.length === 0);
      await sincronizar('zz_tab', [], true);
      ok('lista vazia de propósito apaga o servidor', chamadas.length === 1 && chamadas[0].m === 'DELETE');
      limpar();
      var nl = normalizarLinhas([{ id: 1, a: 2 }, { id: 2 }]);
      ok('todas as linhas enviadas têm as mesmas colunas', nl[1].a === null && Object.keys(nl[0]).join() === Object.keys(nl[1]).join());
      var rr = TABLE_MAP.receber.toRow({ id: '1', descricao: 'x', tipo: 'Venda', pedidoId: 'p' });
      ok('A Receber: campos extras não vão para a tabela', rr.id === '1' && rr.tipo === undefined && rr.pedidoId === undefined);
      ok('Acessos: o campo modules não vai para a tabela', TABLE_MAP.empresa_users.toRow({ id: 'u', name: 'A', modules: ['x'] }).modules === undefined);

      /* fila */
      T.enviar = async function (m, c, b, e) { chamadas.push({ m: m, c: c, b: b, e: e || {} }); await new Promise(function (res) { setTimeout(res, 15); }); return { ok: true, status: 200, dados: null }; };
      agendar('zz_fila', [1], false); agendar('zz_fila', [2], false); agendar('zz_fila', [3], false);
      await fila.zz_fila.promessa;
      var cargas = chamadas.filter(function (x) { return x.c.indexOf('app_data') === 0; }).map(function (x) { return x.b.value[0]; });
      ok('envios rápidos em sequência são juntados: vai o primeiro e o último', cargas.length === 2 && cargas[0] === 1 && cargas[1] === 3);
      limpar();

      /* excluir o último item */
      mock();
      var K = 'zz_ultimo_' + Date.now(); criadas.push(K);
      DB.set(K, [{ id: 'a' }]);
      DB.set(K, []);
      var v = DB.get(K);
      ok('esvaziar a lista de propósito não ressuscita o último item', Array.isArray(v) && v.length === 0);
      await DB._flush(); limpar();
      DB.set('zz_tab', [{ id: '1', name: 'a' }]); await DB._flush(); limpar();
      DB.set('zz_tab', []); await DB._flush();
      ok('excluir o último item também apaga no servidor', chamadas.filter(function (x) { return x.m === 'DELETE'; }).length === 1);
      limpar();
      DB.set('zz_tab', []); await DB._flush();
      ok('salvar de novo uma lista que já estava vazia não apaga nada', chamadas.filter(function (x) { return x.m === 'DELETE'; }).length === 0);
      criadas.push('zz_tab');
      limpar();
      ok('compatível com as automações dos Quadros', typeof window.QuadrosFase3Teste !== 'function' || DB.set._qdAut === true);

      /* backup */
      localStorage.setItem('mundana_zz_bk', JSON.stringify([1, 2]));
      localStorage.setItem('mundana_bkp_zz_bk', '[9]');
      localStorage.setItem('mundana_auth', '{"t":1}');
      localStorage.setItem('mundana_mododia_done_2000-01-01', '[]');
      var dados = coletarBackup();
      ok('o backup leva todos os módulos mundana_*', Array.isArray(dados.zz_bk) && dados.zz_bk.length === 2);
      ok('o backup não leva cópias de segurança, sessão nem estados do dia', dados.bkp_zz_bk === undefined && dados.auth === undefined && dados['mododia_done_2000-01-01'] === undefined);
      localStorage.removeItem('mundana_zz_bk'); localStorage.removeItem('mundana_bkp_zz_bk'); localStorage.removeItem('mundana_auth'); localStorage.removeItem('mundana_mododia_done_2000-01-01');
      var plano = planejarImportacao({ _meta: { version: 'mundana-gestao-v1' }, pagar: [], lembretes: [{ id: 1 }], mydocs: [{ id: 'd', data: '[BASE64_STRIPPED]' }] },
        function (k) { return k === 'pagar' ? [{ id: 1 }, { id: 2 }] : []; });
      var lp = plano.linhas.filter(function (l) { return l.chave === 'pagar'; })[0];
      var ll = plano.linhas.filter(function (l) { return l.chave === 'lembretes'; })[0];
      var ld = plano.linhas.filter(function (l) { return l.chave === 'mydocs'; })[0];
      ok('backup vazio não sobrescreve dados do sistema por padrão', lp.padrao === false && /vazio/.test(lp.aviso));
      ok('backup com dados vem marcado', ll.padrao === true);
      ok('backup antigo não restaura arquivos de documentos', ld.bloqueada === true && ld.padrao === false);
      ok('arquivo que não é backup é recusado', !!planejarImportacao({ x: 1 }).erro);
      var plano2 = planejarImportacao({ _meta: { version: 'mundana-gestao-v2' }, dados: { pagar: [{ id: 1 }] } }, function () { return []; });
      ok('formato novo (dados) é reconhecido', plano2.linhas.length === 1 && plano2.v2 === true);
      ok('contagem de itens por módulo', contar([1, 2, 3]) === 3 && contar({ quadros: [1, 2] }) === 2 && contar({ a: 1, b: 2 }) === 2 && contar(null) === 0);

      /* documentos */
      ok('arquivo esvaziado pela versão antiga é marcado como indisponível', indisponivel({ id: 'a', data: '' }) === true && indisponivel({ id: 'b', remoto: true }) === false && indisponivel({ id: 'c', data: 'data:text/plain;base64,QQ==' }) === false);
      var h = htmlLinhaDoc({ id: 'a', name: '<b>x</b>', fileName: 'a.pdf', size: 100, date: '2026-11-13', remoto: true });
      ok('linha do documento escapa o texto e tem visualizar e baixar', h.indexOf('<b>x</b>') < 0 && h.indexOf("previewDoc('a')") > -1 && h.indexOf("baixarDoc('a')") > -1);
      var hs = htmlLinhaDoc({ id: 'z', name: 'Velho', fileName: 'v.pdf', data: '' });
      ok('documento sem arquivo avisa e não oferece abrir', hs.indexOf('indisponível') > -1 && hs.indexOf('previewDoc') < 0);
      ok('a carga inicial não baixa os arquivos', ajustarCaminhoCarga('app_data?select=key,value') === 'app_data?select=key,value&key=not.like.docfile_*' && ajustarCaminhoCarga('pagar?select=*') === 'pagar?select=*');
      var KD = 'zz_docs_' + Date.now(); criadas.push(KD);
      mock();
      DB.set(KD, [{ id: 'd1', name: 'N', fileName: 'a.txt', data: 'data:text/plain;base64,QUJD' }, { id: 'd2', name: 'Perdido', fileName: 'b.txt', data: '' }]);
      limpar();
      var mudou = await migrarLegados(KD);
      var lista = DB.get(KD);
      ok('documento antigo é movido para linha própria e sai da lista', mudou === true && lista[0].remoto === true && lista[0].data === undefined && chamadas.some(function (x) { return x.b && x.b.key === 'docfile_d1' && x.b.value.indexOf('data:') === 0; }));
      ok('documento antigo sem conteúdo continua marcado como indisponível', indisponivel(lista[1]) === true);
      limpar();
      var KR = 'zz_rec_' + Date.now(); criadas.push(KR);
      DB.set(KR, [{ id: 'q1', name: 'Recuperável', fileName: 'r.txt', data: '' }]);
      mock(function (m, c) {
        if (m === 'GET' && c.indexOf('app_data?key=eq.' + KR) === 0) return { ok: true, status: 200, dados: [{ value: [{ id: 'q1', data: 'data:text/plain;base64,UVJT' }] }] };
        return null;
      });
      var rec = await migrarLegados(KR);
      ok('conteúdo que ainda está no servidor é recuperado', rec === true && DB.get(KR)[0].remoto === true && cacheArq.q1 === 'data:text/plain;base64,UVJT');
      ok('funções novas instaladas', window.rDocs === rDocsNovo && window.exportFullBackup === exportarBackupCompleto && window.saveDocUpload === saveDocUploadNovo);
    } catch (e) {
      ok('o teste não deve lançar erro: ' + e, false);
    } finally {
      T.enviar = enviarOriginal;
      delete TABLE_MAP.zz_tab;
      try { await DB._flush(); } catch (e2) { /* ignorar */ }
      criadas.forEach(limparChave);
      ['zz_json', 'zz_fila'].forEach(function (k) { delete fila[k]; });
    }
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'CORRECOES: ' + r.length + ' testes, 0 falhas' : 'CORRECOES: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }
  window.CorrecoesTeste = teste;
})();
