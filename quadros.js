/* ============================================================
   MUNDANA · QUADROS (gestão de trabalho estilo quadros)
   Instalação: UMA linha no index.html, DEPOIS do script principal
   e antes de </body>:
       <script src="quadros.js" charset="utf-8"></script>
   O módulo adiciona sozinho o item "Quadros" no menu (módulo
   Criação). Dados guardados com o mesmo mecanismo do sistema
   (DB.set -> localStorage + tabela app_data, chave "quadros").
   Autoteste: abra o console (F12) e rode  QuadrosTeste()
   ============================================================ */
(function () {
  'use strict';

  if (typeof NAV === 'undefined' || typeof render !== 'function' || typeof DB === 'undefined' || typeof openModal !== 'function') {
    console.error('quadros.js: carregue este arquivo DEPOIS do script principal do sistema (antes de </body>).');
    return;
  }

  var CHAVE = 'quadros';
  var IC = (typeof I !== 'undefined') ? I : {};

  var TIPOS = {
    texto:  { nome: 'Texto',              w: '160px' },
    numero: { nome: 'Número',             w: '110px' },
    moeda:  { nome: 'Moeda (R$)',         w: '126px' },
    data:   { nome: 'Data',               w: '134px' },
    status: { nome: 'Status',             w: '134px' },
    lista:  { nome: 'Lista de opções',    w: '134px' },
    pessoa: { nome: 'Pessoa',             w: '110px' },
    check:  { nome: 'Caixa de marcação',  w: '64px'  },
    link:   { nome: 'Link',               w: '160px' }
  };
  var CORES = ['#9a9490', '#be9c60', '#998ea2', '#b17a7f', '#5c7161', '#6f8473', '#383a37', '#cca2a6', '#93a597', '#b2aec3'];
  var CORES_GRUPO = ['#b17a7f', '#998ea2', '#5c7161', '#be9c60', '#383a37', '#6f8473'];

  /* ---------------- utilidades ---------------- */
  function uid() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtData(iso) {
    if (!iso || String(iso).length < 10) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function fmtDataHora(d) {
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function parseNum(t) {
    if (t === null || t === undefined) return null;
    if (typeof t === 'number') return isNaN(t) ? null : t;
    var s = String(t).trim();
    if (!s) return null;
    s = s.replace(/R\$/g, '').replace(/\s/g, '');
    if (s.indexOf(',') > -1) { s = s.replace(/\./g, '').replace(',', '.'); }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function fmtMoeda(n) {
    if (n === null || n === undefined || n === '') return '';
    return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function iniciais(n) {
    var p = String(n || '').trim().split(/\s+/);
    return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toUpperCase();
  }
  function slug(s) {
    return String(s || 'quadro').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'quadro';
  }
  function csvCampo(v) {
    var s = String(v == null ? '' : v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---------------- núcleo (sem DOM, testável) ---------------- */
  function novoEstado() {
    return {
      quadros: [], atual: null, visao: 'tabela', colKanban: null,
      filtro: { busca: '', pessoa: '', status: '', atrasados: false }, ordem: null
    };
  }

  function opcoesStatusPadrao() {
    return [
      { id: uid(), nome: 'Não iniciado', cor: '#9a9490' },
      { id: uid(), nome: 'Em andamento', cor: '#be9c60' },
      { id: uid(), nome: 'Em revisão', cor: '#998ea2' },
      { id: uid(), nome: 'Travado', cor: '#b17a7f' },
      { id: uid(), nome: 'Concluído', cor: '#5c7161', final: true }
    ];
  }
  function opcoesPrioridadePadrao() {
    return [
      { id: uid(), nome: 'Alta', cor: '#b17a7f' },
      { id: uid(), nome: 'Média', cor: '#be9c60' },
      { id: uid(), nome: 'Baixa', cor: '#93a597' }
    ];
  }
  function colunasPadrao() {
    return [
      { id: uid(), nome: 'Status', tipo: 'status', opcoes: opcoesStatusPadrao() },
      { id: uid(), nome: 'Prioridade', tipo: 'lista', opcoes: opcoesPrioridadePadrao() },
      { id: uid(), nome: 'Responsável', tipo: 'pessoa' },
      { id: uid(), nome: 'Prazo', tipo: 'data' }
    ];
  }
  function pessoasPadrao() {
    var nomes = [];
    try {
      (DB.get('empresa_users') || []).forEach(function (u) {
        if (u && u.name && nomes.indexOf(u.name) < 0) nomes.push(u.name);
      });
    } catch (e) { /* sem usuários cadastrados */ }
    if (!nomes.length) nomes = ['Ana'];
    return nomes;
  }

  function quadroPorId(s, id) { for (var i = 0; i < s.quadros.length; i++) { if (s.quadros[i].id === id) return s.quadros[i]; } return null; }
  function quadroAtualDe(s) {
    var q = quadroPorId(s, s.atual);
    if (q && !q.arquivado) return q;
    for (var i = 0; i < s.quadros.length; i++) { if (!s.quadros[i].arquivado) return s.quadros[i]; }
    return null;
  }
  function achar(s, itemId) {
    for (var a = 0; a < s.quadros.length; a++) {
      var q = s.quadros[a];
      for (var b = 0; b < q.grupos.length; b++) {
        var g = q.grupos[b];
        for (var c = 0; c < g.itens.length; c++) {
          if (g.itens[c].id === itemId) return { q: q, g: g, it: g.itens[c], idx: c };
        }
      }
    }
    return null;
  }
  function acharGrupo(s, gid) {
    for (var a = 0; a < s.quadros.length; a++) {
      var q = s.quadros[a];
      for (var b = 0; b < q.grupos.length; b++) {
        if (q.grupos[b].id === gid) return { q: q, g: q.grupos[b], idx: b };
      }
    }
    return null;
  }

  function criarQuadro(s, nome, pessoas) {
    var q = { id: uid(), nome: nome || 'Novo quadro', colunas: colunasPadrao(), pessoas: (pessoas && pessoas.length ? pessoas.slice() : ['Ana']), grupos: [], arquivado: false };
    s.quadros.push(q);
    criarGrupo(s, q, 'Grupo 1');
    if (!s.atual) s.atual = q.id;
    return q;
  }
  function renomearQuadro(s, q, nome) { q.nome = (nome || '').trim() || q.nome; }
  function arquivarQuadro(s, id) {
    var q = quadroPorId(s, id); if (!q) return false;
    q.arquivado = true;
    if (s.atual === id) { var n = quadroAtualDe(s); s.atual = n ? n.id : null; }
    return true;
  }
  function restaurarQuadro(s, id) {
    var q = quadroPorId(s, id); if (!q) return false;
    q.arquivado = false; if (!s.atual) s.atual = q.id; return true;
  }
  function excluirQuadro(s, id) {
    var q = quadroPorId(s, id); if (!q) return false;
    s.quadros.splice(s.quadros.indexOf(q), 1);
    if (s.atual === id) { var n = quadroAtualDe(s); s.atual = n ? n.id : null; }
    return true;
  }

  function criarGrupo(s, q, nome) {
    var g = { id: uid(), nome: nome || 'Novo grupo', cor: CORES_GRUPO[q.grupos.length % CORES_GRUPO.length], aberto: true, arquivado: false, itens: [] };
    q.grupos.push(g); return g;
  }
  function renomearGrupo(s, g, nome) { g.nome = (nome || '').trim() || g.nome; }
  function proximaCorGrupo(s, g) {
    var i = CORES_GRUPO.indexOf(g.cor); g.cor = CORES_GRUPO[(i + 1) % CORES_GRUPO.length];
  }
  function alternarGrupo(s, g) { g.aberto = !g.aberto; }
  function moverGrupo(s, q, gid, idxDest) {
    var from = -1;
    for (var i = 0; i < q.grupos.length; i++) { if (q.grupos[i].id === gid) from = i; }
    if (from < 0) return false;
    var g = q.grupos.splice(from, 1)[0];
    if (idxDest > from) idxDest--;
    if (idxDest == null || idxDest > q.grupos.length) idxDest = q.grupos.length;
    if (idxDest < 0) idxDest = 0;
    q.grupos.splice(idxDest, 0, g);
    return true;
  }
  function deslocarGrupo(s, q, gid, dir) {
    var from = -1;
    for (var i = 0; i < q.grupos.length; i++) { if (q.grupos[i].id === gid) from = i; }
    var to = from + dir;
    if (from < 0 || to < 0 || to >= q.grupos.length) return false;
    var g = q.grupos.splice(from, 1)[0]; q.grupos.splice(to, 0, g);
    return true;
  }
  function arquivarGrupo(s, gid) { var a = acharGrupo(s, gid); if (!a) return false; a.g.arquivado = true; return true; }
  function restaurarGrupo(s, gid) { var a = acharGrupo(s, gid); if (!a) return false; a.g.arquivado = false; return true; }
  function excluirGrupo(s, gid) {
    var a = acharGrupo(s, gid); if (!a) return false;
    a.q.grupos.splice(a.idx, 1); return true;
  }

  function criarItem(s, q, g, nome, idx) {
    var it = { id: uid(), nome: nome, valores: {}, arquivado: false };
    q.colunas.forEach(function (c) {
      if (c.tipo === 'status' && c.opcoes && c.opcoes.length) it.valores[c.id] = c.opcoes[0].id;
    });
    if (idx == null || idx >= g.itens.length) g.itens.push(it); else g.itens.splice(idx, 0, it);
    return it;
  }
  function renomearItem(s, it, nome) { it.nome = (nome || '').trim() || 'Sem título'; }
  function setValor(s, it, colId, val) {
    if (val === '' || val === undefined || val === null) delete it.valores[colId];
    else it.valores[colId] = val;
  }
  function moverItem(s, itemId, gDestId, idxDest) {
    var a = achar(s, itemId); if (!a) return false;
    var gd = null;
    a.q.grupos.forEach(function (g) { if (g.id === gDestId) gd = g; });
    if (!gd) return false;
    a.g.itens.splice(a.idx, 1);
    if (a.g === gd && idxDest != null && idxDest > a.idx) idxDest--;
    if (idxDest == null || idxDest > gd.itens.length) idxDest = gd.itens.length;
    if (idxDest < 0) idxDest = 0;
    gd.itens.splice(idxDest, 0, a.it);
    return true;
  }
  function deslocarItem(s, itemId, dir) {
    var a = achar(s, itemId); if (!a) return false;
    var n = a.idx + dir;
    if (n < 0 || n >= a.g.itens.length) return false;
    a.g.itens.splice(a.idx, 1); a.g.itens.splice(n, 0, a.it);
    return true;
  }
  function moverItemParaQuadro(s, itemId, qDestId) {
    var a = achar(s, itemId); var qd = quadroPorId(s, qDestId);
    if (!a || !qd || qd === a.q) return false;
    var gd = null;
    qd.grupos.forEach(function (g) { if (!gd && !g.arquivado) gd = g; });
    if (!gd) gd = criarGrupo(s, qd, 'Grupo 1');
    var novos = {};
    a.q.colunas.forEach(function (c) {
      var v = a.it.valores[c.id]; if (v === undefined) return;
      var alvo = null;
      qd.colunas.forEach(function (x) { if (!alvo && x.nome === c.nome && x.tipo === c.tipo) alvo = x; });
      if (!alvo) return;
      if (c.tipo === 'status' || c.tipo === 'lista') {
        var o = opcaoPorId(c, v);
        var oa = null;
        (alvo.opcoes || []).forEach(function (x) { if (o && x.nome === o.nome) oa = x; });
        if (oa) novos[alvo.id] = oa.id;
      } else {
        if (c.tipo === 'pessoa' && qd.pessoas.indexOf(v) < 0) qd.pessoas.push(v);
        novos[alvo.id] = v;
      }
    });
    a.g.itens.splice(a.idx, 1);
    a.it.valores = novos; gd.itens.push(a.it);
    return true;
  }
  function arquivarItem(s, id) { var a = achar(s, id); if (!a) return false; a.it.arquivado = true; return true; }
  function restaurarItem(s, id) {
    var a = achar(s, id); if (!a) return false;
    a.it.arquivado = false;
    if (a.g.arquivado) a.g.arquivado = false;
    return true;
  }
  function excluirItem(s, id) {
    var a = achar(s, id); if (!a) return false;
    a.g.itens.splice(a.idx, 1); return true;
  }

  function opcaoPorId(col, id) {
    if (!col || !col.opcoes) return null;
    for (var i = 0; i < col.opcoes.length; i++) { if (col.opcoes[i].id === id) return col.opcoes[i]; }
    return null;
  }
  function colPrincipal(q) {
    var f = null;
    q.colunas.forEach(function (c) { if (!f && c.tipo === 'status') f = c; });
    if (!f) q.colunas.forEach(function (c) { if (!f && c.tipo === 'lista') f = c; });
    return f;
  }
  function colunaPorId(q, id) {
    for (var i = 0; i < q.colunas.length; i++) { if (q.colunas[i].id === id) return q.colunas[i]; }
    return null;
  }
  function adicionarColuna(s, q, nome, tipo) {
    if (!TIPOS[tipo]) tipo = 'texto';
    var c = { id: uid(), nome: (nome || '').trim() || TIPOS[tipo].nome, tipo: tipo };
    if (tipo === 'status') c.opcoes = opcoesStatusPadrao();
    if (tipo === 'lista') c.opcoes = [{ id: uid(), nome: 'Opção 1', cor: CORES[1] }, { id: uid(), nome: 'Opção 2', cor: CORES[2] }];
    q.colunas.push(c); return c;
  }
  function renomearColuna(s, q, colId, nome) {
    var c = colunaPorId(q, colId); if (!c) return false;
    c.nome = (nome || '').trim() || c.nome; return true;
  }
  function deslocarColuna(s, q, colId, dir) {
    var from = -1;
    for (var i = 0; i < q.colunas.length; i++) { if (q.colunas[i].id === colId) from = i; }
    var to = from + dir;
    if (from < 0 || to < 0 || to >= q.colunas.length) return false;
    var c = q.colunas.splice(from, 1)[0]; q.colunas.splice(to, 0, c);
    return true;
  }
  function limparValoresDaColuna(s, q, colId, soOpcaoId) {
    q.grupos.forEach(function (g) {
      g.itens.forEach(function (it) {
        if (it.valores[colId] === undefined) return;
        if (soOpcaoId && it.valores[colId] !== soOpcaoId) return;
        delete it.valores[colId];
      });
    });
  }
  function removerColuna(s, q, colId) {
    var c = colunaPorId(q, colId); if (!c) return false;
    limparValoresDaColuna(s, q, colId, null);
    q.colunas.splice(q.colunas.indexOf(c), 1);
    if (s.ordem && s.ordem.col === colId) s.ordem = null;
    if (s.colKanban === colId) s.colKanban = null;
    return true;
  }
  function contarValores(q, colId) {
    var n = 0;
    q.grupos.forEach(function (g) { g.itens.forEach(function (it) { if (it.valores[colId] !== undefined) n++; }); });
    return n;
  }
  function adicionarOpcao(s, q, col, nome) {
    var o = { id: uid(), nome: (nome || '').trim() || 'Nova etiqueta', cor: CORES[(col.opcoes.length + 1) % CORES.length] };
    col.opcoes.push(o); return o;
  }
  function editarOpcao(s, q, col, opId, campos) {
    var o = opcaoPorId(col, opId); if (!o) return false;
    if (campos.nome !== undefined) o.nome = String(campos.nome).trim() || o.nome;
    if (campos.cor !== undefined) o.cor = campos.cor;
    if (campos.final !== undefined) { if (campos.final) o.final = true; else delete o.final; }
    return true;
  }
  function removerOpcao(s, q, col, opId) {
    var o = opcaoPorId(col, opId); if (!o) return false;
    limparValoresDaColuna(s, q, col.id, opId);
    col.opcoes.splice(col.opcoes.indexOf(o), 1);
    if (s.filtro.status === opId) s.filtro.status = '';
    return true;
  }
  function adicionarPessoa(s, q, nome) {
    nome = (nome || '').trim(); if (!nome || q.pessoas.indexOf(nome) >= 0) return false;
    q.pessoas.push(nome); return true;
  }
  function removerPessoa(s, q, nome) {
    var i = q.pessoas.indexOf(nome); if (i < 0) return false;
    q.pessoas.splice(i, 1); return true;
  }

  /* ---- consulta: filtros, ordem, atraso, progresso, resumo ---- */
  function statusFinal(q, it) {
    var c = null;
    q.colunas.forEach(function (x) { if (!c && x.tipo === 'status') c = x; });
    if (!c) return false;
    var o = opcaoPorId(c, it.valores[c.id]);
    return !!(o && o.final);
  }
  function atrasado(q, it, hoje) {
    if (statusFinal(q, it)) return false;
    for (var i = 0; i < q.colunas.length; i++) {
      var c = q.colunas[i];
      if (c.tipo === 'data' && it.valores[c.id] && it.valores[c.id] < hoje) return true;
    }
    return false;
  }
  function textoValor(q, c, v, paraPdf) {
    if (v === undefined || v === null) return c.tipo === 'check' ? 'Não' : '';
    switch (c.tipo) {
      case 'status': case 'lista': { var o = opcaoPorId(c, v); return o ? o.nome : ''; }
      case 'data': return fmtData(v);
      case 'moeda': return paraPdf ? fmtMoeda(v) : Number(v).toFixed(2).replace('.', ',');
      case 'numero': return String(v).replace('.', ',');
      case 'check': return v ? 'Sim' : 'Não';
      default: return String(v);
    }
  }
  function textoBusca(q, it) {
    var partes = [it.nome];
    q.colunas.forEach(function (c) {
      var v = it.valores[c.id]; if (v === undefined || v === null) return;
      partes.push(c.tipo === 'check' ? '' : textoValor(q, c, v, true));
    });
    return partes.join(' ').toLowerCase();
  }
  function chaveOrdem(col, it) {
    if (!col) return it.nome;
    var v = it.valores[col.id];
    if (col.tipo === 'status' || col.tipo === 'lista') {
      var idx = -1;
      (col.opcoes || []).forEach(function (o, i) { if (o.id === v) idx = i; });
      return idx < 0 ? null : idx;
    }
    if (col.tipo === 'check') return v ? 1 : 0;
    if (col.tipo === 'moeda' || col.tipo === 'numero') return v == null ? null : Number(v);
    return v == null ? '' : v;
  }
  function ordenarLista(q, lista, ord) {
    var dir = ord.dir === 'desc' ? -1 : 1;
    var col = ord.col === 'nome' ? null : colunaPorId(q, ord.col);
    var copia = lista.slice();
    copia.sort(function (a, b) {
      var va = chaveOrdem(col, a), vb = chaveOrdem(col, b);
      var ea = (va === '' || va === null || va === undefined);
      var eb = (vb === '' || vb === null || vb === undefined);
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'pt-BR') * dir;
    });
    return copia;
  }
  function itensVisiveis(s, q, g, hoje) {
    var f = s.filtro; var busca = (f.busca || '').trim().toLowerCase();
    var cp = colPrincipal(q);
    var lista = g.itens.filter(function (it) {
      if (it.arquivado) return false;
      if (busca && textoBusca(q, it).indexOf(busca) < 0) return false;
      if (f.pessoa) {
        var tem = q.colunas.some(function (c) { return c.tipo === 'pessoa' && it.valores[c.id] === f.pessoa; });
        if (!tem) return false;
      }
      if (f.status) { if (!cp || it.valores[cp.id] !== f.status) return false; }
      if (f.atrasados && !atrasado(q, it, hoje)) return false;
      return true;
    });
    if (s.ordem) lista = ordenarLista(q, lista, s.ordem);
    return lista;
  }
  function progresso(q, g) {
    var col = colPrincipal(q);
    if (!col || col.tipo !== 'status') return null;
    var itens = g.itens.filter(function (i) { return !i.arquivado; });
    if (!itens.length) return null;
    var segs = [];
    (col.opcoes || []).forEach(function (o) {
      var n = itens.filter(function (i) { return i.valores[col.id] === o.id; }).length;
      if (n > 0) segs.push({ cor: o.cor, n: n });
    });
    var feitos = itens.filter(function (i) { var o = opcaoPorId(col, i.valores[col.id]); return o && o.final; }).length;
    return { total: itens.length, segs: segs, feitos: feitos };
  }
  function resumoQuadro(q, hoje) {
    var total = 0, feitos = 0, atras = 0;
    var cs = null;
    q.colunas.forEach(function (c) { if (!cs && c.tipo === 'status') cs = c; });
    q.grupos.forEach(function (g) {
      if (g.arquivado) return;
      g.itens.forEach(function (it) {
        if (it.arquivado) return;
        total++;
        if (statusFinal(q, it)) feitos++;
        if (atrasado(q, it, hoje)) atras++;
      });
    });
    return { total: total, feitos: feitos, atrasados: atras, temStatus: !!cs, pct: total ? Math.round(feitos / total * 100) : 0 };
  }

  function gerarCSV(q) {
    var linhas = [];
    linhas.push(['Quadro', 'Grupo', 'Item'].concat(q.colunas.map(function (c) { return c.nome; })).map(csvCampo).join(';'));
    q.grupos.forEach(function (g) {
      if (g.arquivado) return;
      g.itens.forEach(function (it) {
        if (it.arquivado) return;
        var cel = [q.nome, g.nome, it.nome].concat(q.colunas.map(function (c) { return textoValor(q, c, it.valores[c.id], false); }));
        linhas.push(cel.map(csvCampo).join(';'));
      });
    });
    return '\uFEFF' + linhas.join('\r\n');
  }

  function semear(s) {
    var q = criarQuadro(s, 'Meu primeiro quadro', pessoasPadrao());
    var g = q.grupos[0]; g.nome = 'A fazer';
    criarItem(s, q, g, 'Clique no nome para editar este item');
    criarItem(s, q, g, 'Arraste pela alça para reordenar');
    criarItem(s, q, g, 'Use o botão Colunas para criar campos novos');
    s.atual = q.id;
    return q;
  }

  /* ---------------- persistência (mesmo mecanismo do sistema) ---------------- */
  var Q = novoEstado();
  var timerSalvar = null;
  var pendente = false;

  function salvarAgora() {
    clearTimeout(timerSalvar);
    if (!pendente) return;
    pendente = false;
    try {
      DB.set(CHAVE, { versao: 1, atual: Q.atual, quadros: Q.quadros });
    } catch (e) {
      console.error('Quadros: erro ao salvar', e);
      if (typeof toast === 'function') toast('Não foi possível salvar os Quadros');
    }
  }
  function salvar() {
    pendente = true;
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(salvarAgora, 400);
  }
  function carregar() {
    if (pendente) return;
    var d = null;
    try { d = DB.get(CHAVE); } catch (e) { d = null; }
    if (d && !Array.isArray(d) && Array.isArray(d.quadros)) {
      Q.quadros = d.quadros; Q.atual = d.atual || null;
    }
  }

  /* ---------------- interface ---------------- */
  var popCtx = null;
  var drag = null;
  var foco = null;
  var colAberta = null;

  function ativo() { return typeof S !== 'undefined' && S.page === 'quadros'; }
  function quadroAtual() { return quadroAtualDe(Q); }
  function trocarQuadro(id) {
    Q.atual = id; Q.ordem = null; Q.colKanban = null;
    Q.filtro = { busca: '', pessoa: '', status: '', atrasados: false };
  }
  function aviso(msg) { if (typeof toast === 'function') toast(msg); }

  function injetarCSS() {
    if ($('qd-css')) return;
    var css = [
      '#qd-root .qd-boards,#qd-root .qd-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}',
      '#qd-root .qd-tools .qd-sel{width:auto;font-size:12px;padding:7px 12px}',
      '#qd-root .qd-busca{width:190px}',
      '#qd-root .qd-resumo{font-size:12px;color:var(--text-muted)}',
      '#qd-root .qd-ic{border:none;background:transparent;cursor:pointer;color:var(--text-muted);font-size:15px;line-height:1;padding:5px 7px;border-radius:8px;font-family:inherit}',
      '#qd-root .qd-ic:hover{background:var(--bg-warm);color:var(--text-primary)}',
      '#qd-root .qd-g{background:var(--surface);border:1.5px solid var(--border-light);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:14px 18px;margin-bottom:16px}',
      '#qd-root .qd-gh{display:flex;align-items:center;gap:8px;padding-bottom:10px}',
      '#qd-root .qd-grip{cursor:grab;color:var(--text-muted);font-size:12px;user-select:none;padding:2px 3px;letter-spacing:-2px}',
      '#qd-root .qd-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0}',
      '#qd-root .qd-dotc{cursor:pointer}',
      '#qd-root input.qd-gnome{width:auto;min-width:90px;max-width:280px;font-family:inherit;font-size:15px;font-weight:700;border:1.5px solid transparent;background:transparent;padding:3px 6px;border-radius:8px;outline:none}',
      '#qd-root input.qd-gnome:focus{background:var(--bg-warm);border-color:var(--border)}',
      '#qd-root .qd-cnt{font-size:12px;color:var(--text-muted)}',
      '#qd-root .qd-barra{margin-left:auto;display:flex;height:7px;width:120px;border-radius:4px;overflow:hidden;background:var(--border-light)}',
      '#qd-root .qd-scroll{overflow-x:auto}',
      '#qd-root .qd-tbl{border-left:4px solid var(--rosa-antigo);padding-left:8px}',
      '#qd-root .qd-hr,#qd-root .qd-r,#qd-root .qd-ar{display:grid;grid-template-columns:var(--qd-cols);gap:6px;align-items:center;border-bottom:1px solid var(--border-light)}',
      '#qd-root .qd-hr{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);font-weight:700;padding:6px 0}',
      '#qd-root .qd-hc{cursor:pointer;user-select:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#qd-root .qd-r{padding:3px 0;transition:background .12s}',
      '#qd-root .qd-r:hover{background:var(--bg-warm)}',
      '#qd-root .qd-c{min-width:0;display:flex;align-items:center;gap:4px}',
      '#qd-root input.qd-nome,#qd-root input.qd-val{font-family:inherit;width:100%;height:32px;font-size:13px;color:var(--text-primary);border:1.5px solid transparent;background:transparent;padding:0 8px;border-radius:8px;outline:none}',
      '#qd-root input.qd-nome:focus,#qd-root input.qd-val:focus{background:var(--surface);border-color:var(--rosa-antigo)}',
      '#qd-root input[type=checkbox].qd-val{width:18px;height:18px;margin:0 auto}',
      '#qd-root .qd-r.atrasado input[type=date]{color:var(--rosa-antigo);font-weight:700}',
      '#qd-root .qd-pill{height:28px;border-radius:6px;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;width:100%;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#qd-root .qd-pill.vazio{background:transparent;color:var(--text-muted);border:1.5px dashed var(--border)}',
      '#qd-root .qd-av{width:28px;height:28px;border-radius:50%;background:var(--lavanda-pale);color:var(--violeta-suave);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto;cursor:pointer}',
      '#qd-root .qd-av.vazio{background:transparent;border:1.5px dashed var(--border);color:var(--text-muted)}',
      '#qd-root .qd-ar{border-bottom:none}',
      '#qd-root input.qd-add{font-family:inherit;width:100%;height:32px;font-size:13px;border:1.5px solid transparent;background:transparent;padding:0 8px;border-radius:8px;color:var(--text-muted);outline:none}',
      '#qd-root input.qd-add:focus{background:var(--surface);border-color:var(--rosa-antigo);color:var(--text-primary)}',
      '#qd-root .qd-kb{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}',
      '#qd-root .qd-kc{min-width:190px;flex:1;background:var(--bg-warm);border-radius:var(--radius-lg);padding:12px}',
      '#qd-root .qd-kh{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700}',
      '#qd-root .qd-sw{width:11px;height:11px;border-radius:3px;display:inline-block;flex-shrink:0}',
      '#qd-root .qd-kcard{background:var(--surface);border:1.5px solid var(--border-light);border-radius:var(--radius-md);padding:12px;margin-top:8px;cursor:grab;font-size:13px}',
      '#qd-root .qd-kcard.atrasado{border-color:var(--rosa-antigo)}',
      '#qd-root .qd-km{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);margin-top:8px}',
      '#qd-root .drop-a{box-shadow:0 -2px 0 var(--rosa-antigo)}',
      '#qd-root .drop-b{box-shadow:0 2px 0 var(--rosa-antigo)}',
      '#qd-root .over{outline:2px dashed var(--rosa-antigo)}',
      '.qd-pop{position:fixed;z-index:300;display:none;min-width:200px;max-width:270px;background:var(--surface);border:1.5px solid var(--border-light);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:6px;font-size:13px;color:var(--text-primary);max-height:70vh;overflow-y:auto}',
      '.qd-pt{font-size:10px;color:var(--text-muted);padding:6px 10px 3px;text-transform:uppercase;letter-spacing:1px;font-weight:700}',
      '.qd-pi{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer}',
      '.qd-pi:hover{background:var(--bg-warm)}',
      '.qd-pi.mut{color:var(--text-muted)}',
      '.qd-pi.perigo{color:var(--rosa-antigo)}',
      '.qd-sw{width:11px;height:11px;border-radius:3px;display:inline-block;flex-shrink:0}',
      '.qd-colbox{border:1.5px solid var(--border-light);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:8px}',
      '.qd-linha{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.qd-tipo{font-size:11px;color:var(--text-muted);background:var(--bg-warm);padding:3px 10px;border-radius:10px}',
      '.qd-op{display:flex;align-items:center;gap:8px;margin-top:8px;padding-left:10px}',
      '.qd-op label{font-size:11.5px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;white-space:nowrap}',
      '.qd-sec{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:20px 0 8px}',
      '.qd-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.qd-pessoa{display:inline-flex;align-items:center;gap:6px;background:var(--bg-warm);border-radius:20px;padding:4px 6px 4px 12px;font-size:12px}',
      '.qd-arq{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border-light)}',
      '.qd-arq .n{flex:1;min-width:0}',
      '.qd-arq .s{font-size:11px;color:var(--text-muted)}',
      '.qd-snack{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:310;background:var(--carvao);color:#fff;border-radius:50px;padding:12px 22px;font-size:13px;font-weight:500;display:none;align-items:center;gap:16px;box-shadow:var(--shadow-lg)}',
      '.qd-snack button{border:none;background:transparent;color:var(--espuma);font-weight:700;cursor:pointer;font-size:13px;font-family:inherit}',
      '@media (max-width:760px){',
      '#qd-root .qd-hr{display:none}',
      '#qd-root .qd-scroll{overflow-x:visible}',
      '#qd-root .qd-tbl{min-width:0;border-left:none;padding-left:0}',
      '#qd-root .qd-r{display:flex;flex-wrap:wrap;gap:8px;padding:12px;margin-bottom:8px;border:1.5px solid var(--border-light);border-radius:var(--radius-md);position:relative}',
      '#qd-root .qd-r .qd-grip{display:none}',
      '#qd-root .qd-r .qd-c{flex:1 1 44%;flex-direction:column;align-items:flex-start}',
      '#qd-root .qd-r .qd-c::before{content:attr(data-label);font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px}',
      '#qd-root .qd-r .qd-c.qd-cn{flex:1 1 100%}',
      '#qd-root .qd-r .qd-c.qd-cn::before{display:none}',
      '#qd-root .qd-r>.qd-ic{position:absolute;top:6px;right:6px}',
      '#qd-root .qd-ar{display:block}',
      '#qd-root .qd-barra{width:70px}',
      '}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'qd-css'; st.textContent = css; document.head.appendChild(st);
  }

  var timerSnack = null;
  function snack(msg, desfazer) {
    var el = $('qd-snack'); if (!el) return;
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (desfazer ? '<button data-sa="desfazer">Desfazer</button>' : '');
    el.style.display = 'flex'; el._desfazer = desfazer;
    clearTimeout(timerSnack); timerSnack = setTimeout(function () { el.style.display = 'none'; }, 6500);
  }

  /* --- HTML (recebem o estado s; sem tocar no DOM) --- */
  function kanbanColunas(q) {
    return q.colunas.filter(function (c) { return c.tipo === 'status' || c.tipo === 'lista'; });
  }
  function kanbanCol(s, q) {
    var cands = kanbanColunas(q); if (!cands.length) return null;
    for (var i = 0; i < cands.length; i++) { if (cands[i].id === s.colKanban) return cands[i]; }
    return cands[0];
  }
  function htmlHead(s, q) {
    var sub = 'Organize tarefas e projetos em quadros';
    if (q) {
      var r = resumoQuadro(q, hojeISO());
      sub = esc(q.nome) + ' \u00B7 ' + r.total + (r.total === 1 ? ' item' : ' itens') + (r.temStatus ? ' \u00B7 ' + r.feitos + ' concluídos (' + r.pct + '%)' : '') + (r.atrasados ? ' \u00B7 ' + r.atrasados + (r.atrasados > 1 ? ' atrasados' : ' atrasado') : '');
    }
    return '<div class="page-header anim"><div class="page-header-left"><h2>Quadros</h2><p id="qd-resumo">' + sub + '</p></div><div class="page-header-actions">' +
      (q ? '<button class="btn btn-secondary btn-sm" data-qd="rotinas">Rotinas</button>' + '<button class="btn btn-secondary btn-sm" data-qd="colunas">Colunas</button>' +
        '<button class="btn btn-secondary btn-sm" data-qd="arquivados">Arquivados</button>' +
        '<button class="btn btn-secondary btn-sm" data-qd="csv">' + (IC.download || '') + ' CSV</button>' + '<button class="btn btn-secondary btn-sm" data-qd="importar">' + (IC.arrowIn || '') + ' Importar</button>' +
        '<button class="btn btn-secondary btn-sm" data-qd="pdf">' + (IC.file || '') + ' PDF</button>' +
        '<button class="btn btn-primary" data-qd="g-novo">' + (IC.plus || '') + ' Novo grupo</button>' : '') +
      '</div></div>';
  }
  function htmlBoards(s) {
    var h = s.quadros.filter(function (q) { return !q.arquivado; }).map(function (q) {
      var n = 0; q.grupos.forEach(function (g) { if (!g.arquivado) g.itens.forEach(function (i) { if (!i.arquivado) n++; }); });
      return '<div class="folder-chip' + (q.id === s.atual ? ' active' : '') + '" data-qd="quadro" data-q="' + q.id + '">' + esc(q.nome) + ' <span class="count">' + n + '</span></div>';
    }).join('');
    h += '<div class="folder-chip" data-qd="novo-quadro">+ Novo quadro</div>';
    if (quadroAtualDe(s)) h += '<button class="qd-ic" data-qd="menu-quadro" aria-label="Opções do quadro">&#8943;</button>';
    return h;
  }
  function htmlTools(s, q) {
    if (!q) return '';
    var f = s.filtro; var cp = colPrincipal(q);
    var temPessoa = q.colunas.some(function (c) { return c.tipo === 'pessoa'; });
    var h = '<div class="search-box">' + (IC.search || '') + '<input class="form-input qd-busca" placeholder="Buscar..." value="' + esc(f.busca) + '"></div>';
    if (temPessoa) {
      h += '<select class="form-select qd-sel qd-f-pessoa"><option value="">Todas as pessoas</option>' + q.pessoas.map(function (p) { return '<option value="' + esc(p) + '"' + (f.pessoa === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select>';
    }
    if (cp) {
      h += '<select class="form-select qd-sel qd-f-status"><option value="">Todos: ' + esc(cp.nome) + '</option>' + (cp.opcoes || []).map(function (o) { return '<option value="' + o.id + '"' + (f.status === o.id ? ' selected' : '') + '>' + esc(o.nome) + '</option>'; }).join('') + '</select>';
    }
    h += '<div class="folder-chip' + (f.atrasados ? ' active' : '') + '" data-qd="f-atr">Atrasados</div>';
    if (s.visao === 'kanban' && kanbanColunas(q).length > 1) {
      var kc = kanbanCol(s, q);
      h += '<select class="form-select qd-sel qd-f-kcol">' + kanbanColunas(q).map(function (c) { return '<option value="' + c.id + '"' + (kc && kc.id === c.id ? ' selected' : '') + '>Colunas por: ' + esc(c.nome) + '</option>'; }).join('') + '</select>';
    }
    if (s.ordem) {
      var cn = s.ordem.col === 'nome' ? 'Item' : (colunaPorId(q, s.ordem.col) || { nome: '?' }).nome;
      h += '<div class="folder-chip active" data-qd="limpar-ordem">Ordem: ' + esc(cn) + (s.ordem.dir === 'desc' ? ' (z-a)' : ' (a-z)') + ' &#10005;</div>';
    }
    if (f.busca || f.pessoa || f.status || f.atrasados) h += '<div class="folder-chip" data-qd="limpar-filtros">Limpar filtros</div>';
    h += '<button class="btn btn-secondary btn-sm" data-qd="automacoes" style="margin-left:auto">Automações</button><div class="view-toggle" style="margin-left:8px"><button class="' + (s.visao === 'tabela' ? 'active' : '') + '" data-qd="visao" data-v="tabela" title="Tabela">' + (IC.list || 'Tabela') + '</button><button class="' + (s.visao === 'kanban' ? 'active' : '') + '" data-qd="visao" data-v="kanban" title="Kanban">' + (IC.grid || 'Kanban') + '</button><button class="' + (s.visao === 'linha' ? 'active' : '') + '" data-qd="visao" data-v="linha" title="Linha do tempo">' + (IC.calCheck || 'Linha do tempo') + '</button><button class="' + (s.visao === 'painel' ? 'active' : '') + '" data-qd="visao" data-v="painel" title="Painel">' + (IC.dashboard || 'Painel') + '</button></div>';
    return h;
  }
  function gridCols(q) {
    return '26px minmax(220px,1.6fr) ' + q.colunas.map(function (c) { return (TIPOS[c.tipo] || TIPOS.texto).w; }).join(' ') + ' 34px';
  }
  function htmlBarra(q, g) {
    var p = progresso(q, g); if (!p) return '';
    return p.segs.map(function (sg) { return '<div style="width:' + (sg.n / p.total * 100) + '%;background:' + sg.cor + '"></div>'; }).join('');
  }
  function htmlCabecalho(s, q) {
    function seta(id) { return s.ordem && s.ordem.col === id ? (s.ordem.dir === 'desc' ? ' \u2193' : ' \u2191') : ''; }
    return '<div class="qd-hr"><span></span><span class="qd-hc" data-qd="ordenar" data-col="nome">Item' + seta('nome') + '</span>' +
      q.colunas.map(function (c) { return '<span class="qd-hc" data-qd="ordenar" data-col="' + c.id + '">' + esc(c.nome) + seta(c.id) + '</span>'; }).join('') + '<span></span></div>';
  }
  function htmlCelula(q, c, it) {
    var v = it.valores[c.id];
    var base = 'data-i="' + it.id + '" data-col="' + c.id + '"';
    switch (c.tipo) {
      case 'status': case 'lista': {
        var o = opcaoPorId(c, v);
        return o ? '<div class="qd-pill" data-qd="opc" ' + base + ' style="background:' + o.cor + '">' + esc(o.nome) + '</div>' : '<div class="qd-pill vazio" data-qd="opc" ' + base + '>-</div>';
      }
      case 'pessoa':
        return v ? '<div class="qd-av" data-qd="pes" ' + base + ' title="' + esc(v) + '">' + esc(iniciais(v)) + '</div>' : '<div class="qd-av vazio" data-qd="pes" ' + base + '>+</div>';
      case 'check':
        return '<input class="qd-val" type="checkbox" data-tipo="check" ' + base + (v ? ' checked' : '') + '>';
      case 'data':
        return '<input class="qd-val" type="date" data-tipo="data" ' + base + ' value="' + esc(v || '') + '">';
      case 'numero':
        return '<input class="qd-val" type="text" inputmode="decimal" data-tipo="numero" ' + base + ' value="' + esc(v == null ? '' : String(v).replace('.', ',')) + '">';
      case 'moeda':
        return '<input class="qd-val" type="text" inputmode="decimal" data-tipo="moeda" ' + base + ' value="' + esc(v == null ? '' : fmtMoeda(v)) + '" placeholder="R$ 0,00">';
      case 'link':
        return '<input class="qd-val" type="url" data-tipo="link" ' + base + ' value="' + esc(v || '') + '" placeholder="https://">' + (v ? '<a href="' + esc(v) + '" target="_blank" rel="noopener" style="font-size:13px;color:var(--rosa-antigo);text-decoration:none" aria-label="Abrir link">&#8599;</a>' : '');
      default:
        return c.tipo === 'vinculo' ? htmlVinculo(it, c, v) : '<input class="qd-val" type="text" data-tipo="texto" ' + base + ' value="' + esc(v || '') + '">';
    }
  }
  function htmlLinha(s, q, g, it, hoje) {
    var atr = atrasado(q, it, hoje);
    return '<div class="qd-r' + (atr ? ' atrasado' : '') + '" data-i="' + it.id + '" data-g="' + g.id + '">' +
      '<span class="qd-grip" ' + (s.ordem ? '' : 'draggable="true" ') + 'data-idrag="' + it.id + '" title="Arrastar">&#8942;&#8942;</span>' +
      '<div class="qd-c qd-cn" data-label="Item"><input class="qd-nome" data-i="' + it.id + '" value="' + esc(it.nome) + '">' + htmlDetalheBtn(it) + '</div>' +
      q.colunas.map(function (c) { return '<div class="qd-c" data-label="' + esc(c.nome) + '">' + htmlCelula(q, c, it) + '</div>'; }).join('') +
      '<button class="qd-ic" data-qd="i-menu" data-i="' + it.id + '" aria-label="Opções do item">&#8943;</button></div>';
  }
  function htmlGrupo(s, q, g, hoje) {
    var itens = itensVisiveis(s, q, g, hoje);
    var tot = g.itens.filter(function (i) { return !i.arquivado; }).length;
    var h = '<section class="qd-g" data-g="' + g.id + '"><div class="qd-gh">' +
      '<span class="qd-grip" draggable="true" data-gdrag="' + g.id + '" title="Arrastar grupo">&#8942;&#8942;</span>' +
      '<button class="qd-ic" data-qd="g-tog" data-g="' + g.id + '" aria-label="Recolher ou expandir">' + (g.aberto ? '&#9662;' : '&#9656;') + '</button>' +
      '<span class="qd-dot qd-dotc" data-qd="g-cor" data-g="' + g.id + '" style="background:' + g.cor + '" title="Mudar cor"></span>' +
      '<input class="qd-gnome" data-g="' + g.id + '" value="' + esc(g.nome) + '" style="color:' + g.cor + '">' +
      '<span class="qd-cnt">' + tot + (tot === 1 ? ' item' : ' itens') + '</span>' +
      '<div class="qd-barra" data-gbarra="' + g.id + '">' + htmlBarra(q, g) + '</div>' +
      '<button class="qd-ic" data-qd="g-menu" data-g="' + g.id + '" aria-label="Opções do grupo">&#8943;</button></div>';
    if (g.aberto) {
      h += '<div class="qd-scroll"><div class="qd-tbl" style="--qd-cols:' + gridCols(q) + ';border-left-color:' + g.cor + '">' + htmlCabecalho(s, q) +
        itens.map(function (it) { return htmlLinha(s, q, g, it, hoje); }).join('') +
        '<div class="qd-ar"><span></span><input class="qd-add" data-g="' + g.id + '" placeholder="+ Adicionar item (Enter)"></div></div></div>';
    }
    return h + '</section>';
  }
  function htmlTabela(s, q) {
    var hoje = hojeISO();
    var grupos = q.grupos.filter(function (g) { return !g.arquivado; });
    var h = grupos.map(function (g) { return htmlGrupo(s, q, g, hoje); }).join('');
    if (!grupos.length) h = '<div class="empty-state"><h3>Este quadro não tem grupos</h3><p>Crie o primeiro grupo para começar.</p></div>';
    return h;
  }
  function htmlKanban(s, q) {
    var col = kanbanCol(s, q);
    if (!col) return '<div class="empty-state"><h3>Kanban indisponível</h3><p>Crie uma coluna do tipo Status ou Lista em "Colunas".</p></div>';
    var hoje = hojeISO();
    var cols = (col.opcoes || []).map(function (o) { return { id: o.id, nome: o.nome, cor: o.cor }; });
    cols.push({ id: '', nome: 'Sem ' + col.nome.toLowerCase(), cor: '#c7baae' });
    var todos = [];
    q.grupos.forEach(function (g) {
      if (g.arquivado) return;
      itensVisiveis(s, q, g, hoje).forEach(function (it) { todos.push({ g: g, it: it }); });
    });
    var colData = null, colPessoa = null;
    q.colunas.forEach(function (c) { if (!colData && c.tipo === 'data') colData = c; if (!colPessoa && c.tipo === 'pessoa') colPessoa = c; });
    return '<div class="qd-kb">' + cols.map(function (c) {
      var lista = todos.filter(function (x) { return (x.it.valores[col.id] || '') === c.id; });
      return '<div class="qd-kc" data-opt="' + c.id + '" data-col="' + col.id + '"><div class="qd-kh"><span class="qd-sw" style="background:' + c.cor + '"></span>' + esc(c.nome) + '<span class="qd-cnt">' + lista.length + '</span></div>' +
        lista.map(function (x) {
          var atr = atrasado(q, x.it, hoje);
          var pv = colPessoa ? x.it.valores[colPessoa.id] : '';
          var dv = colData ? x.it.valores[colData.id] : '';
          return '<div class="qd-kcard' + (atr ? ' atrasado' : '') + '" draggable="true" data-kcard="' + x.it.id + '"><div>' + esc(x.it.nome) + '</div><div class="qd-km"><span class="qd-dot" style="background:' + x.g.cor + '"></span>' + esc(x.g.nome) +
            '<span style="margin-left:auto;display:flex;gap:8px;align-items:center">' + (dv ? '<span style="' + (atr ? 'color:var(--rosa-antigo);font-weight:700' : '') + '">' + esc(fmtData(dv).slice(0, 5)) + '</span>' : '') + (pv ? '<span class="qd-av" style="margin:0;width:22px;height:22px;font-size:10px" title="' + esc(pv) + '">' + esc(iniciais(pv)) + '</span>' : '') + '</span></div></div>';
        }).join('') + '</div>';
    }).join('') + '</div>';
  }
  function htmlVazio() {
    return '<div class="empty-state anim d1"><div class="empty-icon">' + (IC.layers || '') + '</div><h3>Nenhum quadro ainda</h3><p>Crie quadros para organizar tarefas, campanhas, lotes ou qualquer projeto.</p>' +
      '<button class="btn btn-primary" data-qd="novo-quadro">' + (IC.plus || '') + ' Criar primeiro quadro</button> ' +
      '<button class="btn btn-secondary" data-qd="exemplo">Criar com exemplo</button></div>';
  }

  /* --- render --- */
  function rQuadros() {
    carregar();
    if (gerarRotinas(Q, hojeISO()) + avaliarParados(Q, hojeISO()) > 0) salvar();
    var el = $('content'); if (!el) return;
    el.innerHTML = '<div id="qd-root"><div id="qd-head"></div><div class="qd-boards" id="qd-boards"></div><div class="qd-tools" id="qd-tools"></div><div id="qd-corpo"></div></div>';
    renderTudo();
  }
  function renderCorpo() {
    var el = $('qd-corpo'); if (!el) return;
    var q = quadroAtual();
    el.innerHTML = !q ? htmlVazio() : (Q.visao === 'kanban' ? htmlKanban(Q, q) : (Q.visao === 'linha' ? htmlLinhaTempo(Q, q) : (Q.visao === 'painel' ? htmlPainel(Q, q) : htmlTabela(Q, q))));
    if (foco) {
      var inp = el.querySelector('input.qd-add[data-g="' + foco + '"]');
      if (inp) inp.focus();
      foco = null;
    }
  }
  function atualizarResumo() {
    var el = $('qd-resumo'); var q = quadroAtual(); if (!el || !q) return;
    var r = resumoQuadro(q, hojeISO());
    el.textContent = q.nome + ' \u00B7 ' + r.total + (r.total === 1 ? ' item' : ' itens') + (r.temStatus ? ' \u00B7 ' + r.feitos + ' concluídos (' + r.pct + '%)' : '') + (r.atrasados ? ' \u00B7 ' + r.atrasados + (r.atrasados > 1 ? ' atrasados' : ' atrasado') : '');
  }
  function renderTudo() {
    if (!ativo() || !$('qd-root')) return;
    var q = quadroAtual();
    $('qd-head').innerHTML = htmlHead(Q, q);
    $('qd-boards').innerHTML = htmlBoards(Q);
    $('qd-tools').innerHTML = htmlTools(Q, q);
    renderCorpo();
  }
  function mudou() { salvar(); renderTudo(); }
  function atualizarVivo() {
    var q = quadroAtual(); if (!q) return;
    var hoje = hojeISO();
    var rows = document.querySelectorAll('#qd-corpo .qd-r');
    for (var i = 0; i < rows.length; i++) {
      var a = achar(Q, rows[i].dataset.i);
      if (a) rows[i].classList.toggle('atrasado', atrasado(a.q, a.it, hoje));
    }
    q.grupos.forEach(function (g) {
      var el = document.querySelector('[data-gbarra="' + g.id + '"]');
      if (el) el.innerHTML = htmlBarra(q, g);
    });
    atualizarResumo();
  }

  /* --- popover --- */
  function abrirPop(ancora, html) {
    var p = $('qd-pop'); p.innerHTML = html; p.style.display = 'block';
    var r = ancora.getBoundingClientRect();
    var w = p.offsetWidth, h = p.offsetHeight;
    var x = Math.min(r.left, window.innerWidth - w - 8);
    var y = r.bottom + 4;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 4);
    p.style.left = Math.max(8, x) + 'px'; p.style.top = y + 'px';
  }
  function fecharPop() { var p = $('qd-pop'); if (p) p.style.display = 'none'; }
  function popItem(a, v, rotulo, extra) {
    return '<div class="qd-pi' + (extra ? ' ' + extra : '') + '" data-pa="' + a + '" data-v="' + esc(v == null ? '' : v) + '">' + rotulo + '</div>';
  }
  function menuItem(itemId, ancora) {
    var a = achar(Q, itemId); if (!a) return;
    popCtx = { item: itemId };
    var h = popItem('i-up', '', 'Subir') + popItem('i-down', '', 'Descer');
    var outros = a.q.grupos.filter(function (g) { return g.id !== a.g.id && !g.arquivado; });
    if (outros.length) {
      h += '<div class="qd-pt">Mover para o grupo</div>' + outros.map(function (g) { return popItem('i-grupo', g.id, '<span class="qd-sw" style="background:' + g.cor + '"></span>' + esc(g.nome)); }).join('');
    }
    var qs = Q.quadros.filter(function (q) { return q.id !== a.q.id && !q.arquivado; });
    if (qs.length) {
      h += '<div class="qd-pt">Mover para o quadro</div>' + qs.map(function (q) { return popItem('i-quadro', q.id, esc(q.nome)); }).join('');
    }
    h += '<div class="qd-pt">&nbsp;</div>' + popItem('i-arq', '', 'Arquivar item', 'perigo');
    abrirPop(ancora, h);
  }
  function menuGrupo(gid, ancora) {
    popCtx = { grupo: gid };
    abrirPop(ancora, popItem('g-ren', '', 'Renomear') + popItem('g-up', '', 'Mover para cima') + popItem('g-down', '', 'Mover para baixo') + popItem('g-arq', '', 'Arquivar grupo', 'perigo'));
  }
  function menuQuadro(ancora) {
    var q = quadroAtual(); if (!q) return;
    popCtx = { quadro: q.id };
    abrirPop(ancora, popItem('q-ren', '', 'Renomear quadro') + popItem('q-dup', '', 'Duplicar estrutura (sem itens)') + popItem('q-arq', '', 'Arquivar quadro', 'perigo'));
  }
  function menuOpcoes(itemId, colId, ancora) {
    var q = quadroAtual(); var col = q && colunaPorId(q, colId); if (!col) return;
    popCtx = { item: itemId, col: colId };
    var h = '<div class="qd-pt">' + esc(col.nome) + '</div>' + (col.opcoes || []).map(function (o) {
      return popItem('opc', o.id, '<span class="qd-sw" style="background:' + o.cor + '"></span>' + esc(o.nome));
    }).join('') + popItem('opc', '', 'Limpar', 'mut') + popItem('opc-editar', colId, 'Editar etiquetas', 'mut');
    abrirPop(ancora, h);
  }
  function menuPessoas(itemId, colId, ancora) {
    var q = quadroAtual(); if (!q) return;
    popCtx = { item: itemId, col: colId };
    var h = '<div class="qd-pt">Responsável</div>' + q.pessoas.map(function (p) { return popItem('pes', p, '<span class="qd-av" style="margin:0;width:22px;height:22px;font-size:10px">' + esc(iniciais(p)) + '</span>' + esc(p)); }).join('') +
      popItem('pes', '', 'Sem responsável', 'mut') + popItem('pes-add', '', '+ Adicionar pessoa', 'mut');
    abrirPop(ancora, h);
  }

  /* --- modais (usam openModal do sistema) --- */
  var RODAPE_FECHAR = '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>';
  function htmlModalColunas(q) {
    var h = '';
    q.colunas.forEach(function (c, i) {
      h += '<div class="qd-colbox"><div class="qd-linha"><input class="form-input qd-cn" data-col="' + c.id + '" value="' + esc(c.nome) + '" style="flex:1;min-width:130px;width:auto"><span class="qd-tipo">' + esc((TIPOS[c.tipo] || TIPOS.texto).nome) + '</span>' +
        '<button class="btn btn-secondary btn-sm" data-qm="col-up" data-col="' + c.id + '"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button><button class="btn btn-secondary btn-sm" data-qm="col-down" data-col="' + c.id + '"' + (i === q.colunas.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        (c.opcoes ? '<button class="btn btn-secondary btn-sm" data-qm="col-opc" data-col="' + c.id + '">Etiquetas ' + (colAberta === c.id ? '&#9662;' : '&#9656;') + '</button>' : '') +
        '<button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qm="col-del" data-col="' + c.id + '">Remover</button></div>';
      if (c.opcoes && colAberta === c.id) {
        c.opcoes.forEach(function (o) {
          h += '<div class="qd-op"><span class="qd-sw" style="background:' + o.cor + ';cursor:pointer;width:20px;height:20px" data-qm="op-cor" data-col="' + c.id + '" data-op="' + o.id + '" title="Mudar cor"></span>' +
            '<input class="form-input qd-on" data-col="' + c.id + '" data-op="' + o.id + '" value="' + esc(o.nome) + '" style="flex:1;width:auto">' +
            (c.tipo === 'status' ? '<label><input type="checkbox" class="qd-of" data-col="' + c.id + '" data-op="' + o.id + '"' + (o.final ? ' checked' : '') + '>conta como concluído</label>' : '') +
            '<button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qm="op-del" data-col="' + c.id + '" data-op="' + o.id + '">&times;</button></div>';
        });
        h += '<div class="qd-op"><button class="btn btn-secondary btn-sm" data-qm="op-add" data-col="' + c.id + '">+ Etiqueta</button></div>';
      }
      h += '</div>';
    });
    h += '<div class="qd-sec">Nova coluna</div><div class="qd-linha"><input class="form-input" id="qd-nc-nome" placeholder="Nome da coluna" style="flex:1;min-width:140px;width:auto"><select class="form-select" id="qd-nc-tipo" style="width:auto">' +
      Object.keys(TIPOS).map(function (k) { return '<option value="' + k + '">' + TIPOS[k].nome + '</option>'; }).join('') + '</select><button class="btn btn-primary btn-sm" data-qm="col-add">Adicionar</button></div>';
    h += '<div class="qd-sec">Pessoas deste quadro</div><div class="qd-chips">' + q.pessoas.map(function (p) {
      return '<span class="qd-pessoa">' + esc(p) + '<button class="qd-ic" data-qm="pes-del" data-nome="' + esc(p) + '" aria-label="Remover">&times;</button></span>';
    }).join('') + '</div><div class="qd-linha" style="margin-top:10px"><input class="form-input" id="qd-np-nome" placeholder="Nome da pessoa" style="flex:1;width:auto"><button class="btn btn-primary btn-sm" data-qm="pes-add">Adicionar</button></div>';
    return h;
  }
  function abrirColunas(abrirCol) {
    var q = quadroAtual(); if (!q) return;
    if (abrirCol !== undefined) colAberta = abrirCol;
    openModal('Colunas e pessoas \u00B7 ' + q.nome, htmlModalColunas(q), RODAPE_FECHAR, true);
  }
  function htmlModalArquivados(q) {
    var vazio = true;
    function linha(tipo, id, nome, sub) {
      vazio = false;
      return '<div class="qd-arq"><div class="n"><strong>' + esc(nome) + '</strong><div class="s">' + esc(sub) + '</div></div><button class="btn btn-secondary btn-sm" data-qm="arq-rest" data-t="' + tipo + '" data-id="' + id + '">Restaurar</button><button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qm="arq-del" data-t="' + tipo + '" data-id="' + id + '">Excluir</button></div>';
    }
    var hq = '', hg = '', hi = '';
    Q.quadros.forEach(function (x) { if (x.arquivado) hq += linha('quadro', x.id, x.nome, 'Quadro'); });
    if (q) {
      q.grupos.forEach(function (g) {
        if (g.arquivado) hg += linha('grupo', g.id, g.nome, 'Grupo \u00B7 ' + g.itens.length + ' itens');
        g.itens.forEach(function (it) { if (it.arquivado) hi += linha('item', it.id, it.nome, 'Item \u00B7 grupo ' + g.nome); });
      });
    }
    var h = '';
    if (hq) h += '<div class="qd-sec" style="margin-top:0">Quadros</div>' + hq;
    if (hg) h += '<div class="qd-sec">Grupos deste quadro</div>' + hg;
    if (hi) h += '<div class="qd-sec">Itens deste quadro</div>' + hi;
    if (vazio) h = '<div style="padding:24px;text-align:center;color:var(--text-muted)">Nada arquivado por aqui.</div>';
    return h;
  }
  function abrirArquivados() { openModal('Arquivados', htmlModalArquivados(quadroAtual()), RODAPE_FECHAR, false); }

  /* --- exportação (mesmo padrão do Planejamento: CSV por Blob, PDF por janela de impressão) --- */
  function baixar(nome, conteudo, mime) {
    var b = new Blob([conteudo], { type: mime });
    var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportarCSV() {
    var q = quadroAtual(); if (!q) return;
    baixar('mundana_quadro_' + slug(q.nome) + '_' + hojeISO() + '.csv', gerarCSV(q), 'text/csv;charset=utf-8;');
    aviso('CSV exportado');
  }
  function htmlRelatorio(s, q, hoje) {
    var r = resumoQuadro(q, hoje); var f = s.filtro; var filtros = [];
    if (f.busca) filtros.push('busca "' + f.busca + '"');
    if (f.pessoa) filtros.push('pessoa ' + f.pessoa);
    if (f.status) { var cp = colPrincipal(q); var o = cp && opcaoPorId(cp, f.status); if (o) filtros.push(cp.nome + ': ' + o.nome); }
    if (f.atrasados) filtros.push('somente atrasados');
    var corpo = '';
    q.grupos.forEach(function (g) {
      if (g.arquivado) return;
      var itens = itensVisiveis(s, q, g, hoje); if (!itens.length) return;
      corpo += '<h2 style="color:' + esc(g.cor) + '">' + esc(g.nome) + ' <small>(' + itens.length + ')</small></h2><table><thead><tr><th>Item</th>' +
        q.colunas.map(function (c) { return '<th>' + esc(c.nome) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        itens.map(function (it) {
          return '<tr><td>' + esc(it.nome) + '</td>' + q.colunas.map(function (c) {
            var v = it.valores[c.id]; var t = esc(textoValor(q, c, v, true));
            if (c.tipo === 'status' || c.tipo === 'lista') {
              var op = opcaoPorId(c, v);
              if (op) return '<td><span class="st" style="background:' + esc(op.cor) + '">' + t + '</span></td>';
            }
            if (c.tipo === 'data' && v && v < hoje && !statusFinal(q, it)) return '<td class="atr">' + t + '</td>';
            return '<td>' + t + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    });
    if (!corpo) corpo = '<p>Nenhum item para exibir com os filtros atuais.</p>';
    var resumo = r.total + (r.total === 1 ? ' item' : ' itens') + (r.temStatus ? ' \u00B7 ' + r.feitos + ' concluídos (' + r.pct + '%)' : '') + (r.atrasados ? ' \u00B7 ' + r.atrasados + ' atrasados' : '');
    return '<html><head><meta charset="UTF-8"><title>' + esc(q.nome) + ' - Mundana</title><style>' +
      '@page{size:A4 ' + (q.colunas.length > 4 ? 'landscape' : 'portrait') + ';margin:14mm}' +
      '*{box-sizing:border-box}body{margin:0;font-family:Montserrat,Arial,sans-serif;color:#383A37;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #B17A7F;padding-bottom:12px;margin-bottom:8px}' +
      '.brand{font-family:Georgia,serif;font-size:26px;font-weight:600;color:#B17A7F;letter-spacing:1px}' +
      '.title{text-align:right}.title h1{font-size:15px;margin:0 0 2px}.title p{font-size:10px;color:#8a8580;margin:0}' +
      '.filtros{font-size:10px;color:#8a8580;margin:0 0 6px}' +
      'h2{font-size:13px;margin:18px 0 6px}h2 small{color:#9a9490;font-weight:400}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:6px;page-break-inside:auto}tr{page-break-inside:avoid}' +
      'thead th{background:#252829;color:#fff;text-align:left;padding:7px 9px;font-size:9px;text-transform:uppercase;letter-spacing:.5px}' +
      'tbody td{padding:7px 9px;border-bottom:1px solid #ECE4D9;vertical-align:top}' +
      'tbody tr:nth-child(even){background:#FAF6F1}' +
      '.st{display:inline-block;color:#fff;padding:2px 9px;border-radius:10px;font-weight:700;font-size:10px}' +
      '.atr{color:#B17A7F;font-weight:700}' +
      '.footer{margin-top:16px;display:flex;justify-content:space-between;font-size:9px;color:#9a9490;border-top:1px solid #ECE4D9;padding-top:8px}' +
      '</style></head><body><div class="header"><div class="brand">mundana</div><div class="title"><h1>' + esc(q.nome) + '</h1><p>' + esc(resumo) + '</p></div></div>' +
      (filtros.length ? '<p class="filtros">Filtros aplicados: ' + esc(filtros.join(', ')) + '</p>' : '') +
      corpo + '<div class="footer"><span>Mundana \u00B7 Sistema de Gestão</span><span>Gerado em ' + esc(fmtDataHora(new Date())) + '</span></div>' +
      '<script>setTimeout(function(){window.print();},500)<\/script></body></html>';
  }
  function exportarPDF() {
    var q = quadroAtual(); if (!q) return;
    var w = window.open('', '_blank');
    if (!w) { aviso('O navegador bloqueou a janela do PDF. Permita pop-ups para este site e tente de novo.'); return; }
    w.document.write(htmlRelatorio(Q, q, hojeISO()));
    w.document.close();
  }

  /* --- eventos --- */
  function achaItemPorEl(el) { return achar(Q, el.dataset.i); }

  function onClick(e) {
    if (!ativo()) return;
    var t = e.target.closest('[data-qd]'); if (!t) return;
    var q = quadroAtual(); var act = t.dataset.qd; var a;
    switch (act) {
      case 'quadro': trocarQuadro(t.dataset.q); salvar(); renderTudo(); break;
      case 'novo-quadro': {
        var n = window.prompt('Nome do quadro:');
        if (n && n.trim()) { var nq = criarQuadro(Q, n.trim(), pessoasPadrao()); trocarQuadro(nq.id); mudou(); }
        break;
      }
      case 'exemplo': semear(Q); mudou(); break;
      case 'menu-quadro': menuQuadro(t); break;
      case 'visao': Q.visao = t.dataset.v; renderTudo(); break;
      case 'f-atr': Q.filtro.atrasados = !Q.filtro.atrasados; renderTudo(); break;
      case 'limpar-filtros': Q.filtro = { busca: '', pessoa: '', status: '', atrasados: false }; renderTudo(); break;
      case 'limpar-ordem': Q.ordem = null; renderTudo(); break;
      case 'ordenar':
        if (Q.ordem && Q.ordem.col === t.dataset.col) { if (Q.ordem.dir === 'asc') Q.ordem.dir = 'desc'; else Q.ordem = null; }
        else Q.ordem = { col: t.dataset.col, dir: 'asc' };
        renderTudo(); break;
      case 'g-tog': a = acharGrupo(Q, t.dataset.g); if (a) { alternarGrupo(Q, a.g); mudou(); } break;
      case 'g-cor': a = acharGrupo(Q, t.dataset.g); if (a) { proximaCorGrupo(Q, a.g); mudou(); } break;
      case 'g-menu': menuGrupo(t.dataset.g, t); break;
      case 'g-novo': if (q) { criarGrupo(Q, q, 'Novo grupo'); mudou(); } break;
      case 'i-menu': menuItem(t.dataset.i, t); break;
      case 'opc': menuOpcoes(t.dataset.i, t.dataset.col, t); break;
      case 'pes': menuPessoas(t.dataset.i, t.dataset.col, t); break;
      case 'colunas': abrirColunas(); break;
      case 'arquivados': abrirArquivados(); break;
      case 'csv': exportarCSV(); break;
      case 'pdf': exportarPDF(); break;
      default: break;
    }
  }
  function onChange(e) {
    if (!ativo()) return;
    var el = e.target; var q = quadroAtual(); if (!q || !el.classList) return;
    if (el.classList.contains('qd-f-pessoa')) { Q.filtro.pessoa = el.value; renderTudo(); return; }
    if (el.classList.contains('qd-f-status')) { Q.filtro.status = el.value; renderTudo(); return; }
    if (el.classList.contains('qd-f-kcol')) { Q.colKanban = el.value; renderTudo(); return; }
    if (el.classList.contains('qd-nome')) {
      var a = achaItemPorEl(el); if (a) { renomearItem(Q, a.it, el.value); el.value = a.it.nome; salvar(); }
      return;
    }
    if (el.classList.contains('qd-gnome')) {
      var ag = acharGrupo(Q, el.dataset.g); if (ag) { renomearGrupo(Q, ag.g, el.value); el.value = ag.g.nome; salvar(); }
      return;
    }
    if (el.classList.contains('qd-val')) {
      var ai = achaItemPorEl(el); if (!ai) return;
      var tipo = el.dataset.tipo; var val;
      if (tipo === 'check') val = el.checked;
      else if (tipo === 'numero') { val = parseNum(el.value); el.value = val == null ? '' : String(val).replace('.', ','); }
      else if (tipo === 'moeda') { val = parseNum(el.value); el.value = val == null ? '' : fmtMoeda(val); }
      else val = el.value;
      setValor(Q, ai.it, el.dataset.col, val);
      salvar(); atualizarVivo();
    }
  }
  function onInput(e) {
    if (!ativo()) return;
    var el = e.target;
    if (el.classList && el.classList.contains('qd-busca')) { Q.filtro.busca = el.value; renderCorpo(); }
  }
  function onKeydown(e) {
    if (!ativo()) return;
    var el = e.target; if (!el.classList) return;
    if (e.key === 'Enter' && el.classList.contains('qd-add') && el.value.trim()) {
      var ag = acharGrupo(Q, el.dataset.g); if (!ag) return;
      criarItem(Q, ag.q, ag.g, el.value.trim()); foco = ag.g.id; salvar(); renderCorpo(); $('qd-boards').innerHTML = htmlBoards(Q); atualizarResumo();
      return;
    }
    if (e.key === 'Enter' && (el.classList.contains('qd-nome') || el.classList.contains('qd-gnome') || el.classList.contains('qd-val'))) { el.blur(); }
  }

  function onPopClick(e) {
    var t = e.target.closest('[data-pa]'); if (!t) return;
    var a = t.dataset.pa; var c = popCtx || {}; var q = quadroAtual();
    fecharPop();
    var x;
    switch (a) {
      case 'opc': x = achar(Q, c.item); if (x) { setValor(Q, x.it, c.col, t.dataset.v); mudou(); } break;
      case 'opc-editar': abrirColunas(t.dataset.v); break;
      case 'pes': x = achar(Q, c.item); if (x) { setValor(Q, x.it, c.col, t.dataset.v); mudou(); } break;
      case 'pes-add': {
        var nome = window.prompt('Nome da pessoa:');
        if (nome && nome.trim() && q) {
          adicionarPessoa(Q, q, nome);
          x = achar(Q, c.item); if (x) setValor(Q, x.it, c.col, nome.trim());
          mudou();
        }
        break;
      }
      case 'i-up': if (deslocarItem(Q, c.item, -1)) mudou(); break;
      case 'i-down': if (deslocarItem(Q, c.item, 1)) mudou(); break;
      case 'i-grupo': if (moverItem(Q, c.item, t.dataset.v, null)) mudou(); break;
      case 'i-quadro': if (moverItemParaQuadro(Q, c.item, t.dataset.v)) { mudou(); aviso('Item movido para outro quadro'); } break;
      case 'i-arq': {
        var id = c.item; var nm = achar(Q, id);
        if (arquivarItem(Q, id)) {
          mudou();
          snack('Item arquivado' + (nm ? ': ' + nm.it.nome : ''), function () { restaurarItem(Q, id); mudou(); });
        }
        break;
      }
      case 'g-ren': {
        var gi = document.querySelector('#qd-corpo .qd-gnome[data-g="' + c.grupo + '"]');
        if (gi) { gi.focus(); gi.select(); }
        break;
      }
      case 'g-up': if (q && deslocarGrupo(Q, q, c.grupo, -1)) mudou(); break;
      case 'g-down': if (q && deslocarGrupo(Q, q, c.grupo, 1)) mudou(); break;
      case 'g-arq': {
        var gid = c.grupo;
        if (arquivarGrupo(Q, gid)) { mudou(); snack('Grupo arquivado', function () { restaurarGrupo(Q, gid); mudou(); }); }
        break;
      }
      case 'q-ren': {
        var nn = window.prompt('Novo nome do quadro:', q ? q.nome : '');
        if (nn && nn.trim() && q) { renomearQuadro(Q, q, nn); mudou(); }
        break;
      }
      case 'q-dup': {
        if (!q) break;
        var cp = criarQuadro(Q, q.nome + ' (cópia)', q.pessoas);
        cp.colunas = JSON.parse(JSON.stringify(q.colunas)).map(function (col) {
          col.id = uid(); (col.opcoes || []).forEach(function (o) { o.id = uid(); }); return col;
        });
        cp.grupos[0].nome = q.grupos[0] ? q.grupos[0].nome : 'Grupo 1';
        trocarQuadro(cp.id); mudou(); aviso('Quadro duplicado (colunas e etiquetas, sem itens)');
        break;
      }
      case 'q-arq': {
        if (!q) break;
        var qid = q.id;
        if (window.confirm('Arquivar o quadro "' + q.nome + '"? Você pode restaurar depois em Arquivados.')) {
          arquivarQuadro(Q, qid); trocarQuadro(Q.atual); mudou();
          snack('Quadro arquivado', function () { restaurarQuadro(Q, qid); trocarQuadro(qid); mudou(); });
        }
        break;
      }
      default: break;
    }
  }

  function onModalClick(e) {
    if (!ativo()) return;
    var t = e.target.closest('[data-qm]'); if (!t) return;
    var q = quadroAtual(); var a = t.dataset.qm; var col = q && t.dataset.col ? colunaPorId(q, t.dataset.col) : null;
    switch (a) {
      case 'col-up': if (q && deslocarColuna(Q, q, t.dataset.col, -1)) { salvar(); renderTudo(); abrirColunas(); } return;
      case 'col-down': if (q && deslocarColuna(Q, q, t.dataset.col, 1)) { salvar(); renderTudo(); abrirColunas(); } return;
      case 'col-opc': colAberta = (colAberta === t.dataset.col) ? null : t.dataset.col; abrirColunas(); return;
      case 'col-del':
        if (q && col) {
          var n = contarValores(q, col.id);
          if (window.confirm('Remover a coluna "' + col.nome + '"?' + (n ? ' Os valores de ' + n + ' item(ns) nessa coluna serão apagados.' : ''))) { removerColuna(Q, q, col.id); salvar(); renderTudo(); abrirColunas(); }
        }
        return;
      case 'col-add': {
        var nome = $('qd-nc-nome').value; var tipo = $('qd-nc-tipo').value;
        if (q) { var nc = adicionarColuna(Q, q, nome, tipo); if (nc.opcoes) colAberta = nc.id; salvar(); renderTudo(); abrirColunas(); }
        return;
      }
      case 'op-add': if (q && col) { adicionarOpcao(Q, q, col, ''); salvar(); renderTudo(); abrirColunas(); } return;
      case 'op-cor':
        if (q && col) { var o = opcaoPorId(col, t.dataset.op); if (o) { var i = CORES.indexOf(o.cor); editarOpcao(Q, q, col, o.id, { cor: CORES[(i + 1) % CORES.length] }); salvar(); renderTudo(); abrirColunas(); } }
        return;
      case 'op-del':
        if (q && col) {
          if (col.opcoes.length <= 1) { aviso('A coluna precisa de pelo menos uma etiqueta'); return; }
          removerOpcao(Q, q, col, t.dataset.op); salvar(); renderTudo(); abrirColunas();
        }
        return;
      case 'pes-add': { var pn = $('qd-np-nome').value; if (q && adicionarPessoa(Q, q, pn)) { salvar(); renderTudo(); abrirColunas(); } return; }
      case 'pes-del': if (q && removerPessoa(Q, q, t.dataset.nome)) { salvar(); renderTudo(); abrirColunas(); } return;
      case 'arq-rest': {
        var id = t.dataset.id;
        if (t.dataset.t === 'item') restaurarItem(Q, id); else if (t.dataset.t === 'grupo') restaurarGrupo(Q, id); else restaurarQuadro(Q, id);
        salvar(); renderTudo(); abrirArquivados(); return;
      }
      case 'arq-del': {
        var idd = t.dataset.id;
        if (window.confirm('Excluir definitivamente? Esta ação não pode ser desfeita.')) {
          if (t.dataset.t === 'item') excluirItem(Q, idd); else if (t.dataset.t === 'grupo') excluirGrupo(Q, idd); else excluirQuadro(Q, idd);
          salvar(); renderTudo(); abrirArquivados();
        }
        return;
      }
      default: return;
    }
  }
  function onModalChange(e) {
    if (!ativo()) return;
    var el = e.target; var q = quadroAtual(); if (!q || !el.classList) return;
    var col = el.dataset.col ? colunaPorId(q, el.dataset.col) : null;
    if (el.classList.contains('qd-cn') && col) { renomearColuna(Q, q, col.id, el.value); el.value = col.nome; salvar(); renderTudo(); }
    else if (el.classList.contains('qd-on') && col) { editarOpcao(Q, q, col, el.dataset.op, { nome: el.value }); salvar(); renderTudo(); }
    else if (el.classList.contains('qd-of') && col) { editarOpcao(Q, q, col, el.dataset.op, { final: el.checked }); salvar(); renderTudo(); }
  }

  function limparDrop() {
    var els = document.querySelectorAll('#qd-root .drop-a, #qd-root .drop-b, #qd-root .over');
    for (var i = 0; i < els.length; i++) { els[i].classList.remove('drop-a', 'drop-b', 'over'); }
  }
  function onDragStart(e) {
    if (!ativo() || !e.target.closest) return;
    var gi = e.target.closest('[data-idrag]');
    var gg = e.target.closest('[data-gdrag]');
    var kc = e.target.closest('[data-kcard]');
    if (gi) { drag = { tipo: 'item', id: gi.dataset.idrag }; var row = gi.closest('.qd-r'); if (row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 10, 10); }
    else if (kc) { drag = { tipo: 'item', id: kc.dataset.kcard }; }
    else if (gg) { drag = { tipo: 'grupo', id: gg.dataset.gdrag }; var sec = gg.closest('.qd-g'); if (sec && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(sec, 10, 10); }
    else return;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', drag.id); } catch (err) { /* ignorar */ }
  }
  function onDragOver(e) {
    if (!ativo() || !drag) return;
    var t = e.target; if (!t.closest) return;
    var kc = t.closest('.qd-kc');
    if (drag.tipo === 'item' && kc) { e.preventDefault(); limparDrop(); kc.classList.add('over'); return; }
    if (drag.tipo === 'item') {
      var row = t.closest('.qd-r');
      if (row) {
        e.preventDefault(); limparDrop();
        var r = row.getBoundingClientRect();
        row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-b' : 'drop-a'); return;
      }
      var sec = t.closest('.qd-g');
      if (sec) { e.preventDefault(); limparDrop(); sec.classList.add('over'); }
      return;
    }
    if (drag.tipo === 'grupo') {
      var sg = t.closest('.qd-g');
      if (sg && sg.dataset.g !== drag.id) {
        e.preventDefault(); limparDrop();
        var rg = sg.getBoundingClientRect();
        sg.classList.add(e.clientY > rg.top + rg.height / 2 ? 'drop-b' : 'drop-a');
      }
    }
  }
  function onDrop(e) {
    if (!ativo() || !drag) return;
    var t = e.target; var d = drag; drag = null;
    var q = quadroAtual(); limparDrop();
    if (!q || !t.closest) return;
    e.preventDefault();
    var kc = t.closest('.qd-kc');
    if (d.tipo === 'item' && kc) {
      var x = achar(Q, d.id); if (x) { setValor(Q, x.it, kc.dataset.col, kc.dataset.opt); mudou(); }
      return;
    }
    if (d.tipo === 'item') {
      var row = t.closest('.qd-r'); var sec = t.closest('.qd-g');
      if (row) {
        var alvo = achar(Q, row.dataset.i); if (!alvo) return;
        var rr = row.getBoundingClientRect();
        var idx = alvo.idx + (e.clientY > rr.top + rr.height / 2 ? 1 : 0);
        if (moverItem(Q, d.id, alvo.g.id, idx)) mudou();
      } else if (sec) {
        if (moverItem(Q, d.id, sec.dataset.g, null)) mudou();
      }
      return;
    }
    if (d.tipo === 'grupo') {
      var sg = t.closest('.qd-g'); if (!sg || sg.dataset.g === d.id) return;
      var ag = acharGrupo(Q, sg.dataset.g); if (!ag) return;
      var rs = sg.getBoundingClientRect();
      var ix = ag.idx + (e.clientY > rs.top + rs.height / 2 ? 1 : 0);
      if (moverGrupo(Q, q, d.id, ix)) mudou();
    }
  }

  /* --- instalação no sistema --- */
  function instalarMenu() {
    var mod = null;
    NAV.forEach(function (m) { if (m.module === 'Criação') mod = m; });
    if (!mod) { mod = { module: 'Criação', icon: 'bulb', items: [] }; NAV.push(mod); }
    var ja = mod.items.some(function (i) { return i.id === 'quadros'; });
    if (!ja) mod.items.push({ id: 'quadros', label: 'Quadros', icon: 'layers' });
    if (typeof renderNav === 'function') renderNav();
  }
  function envolverRender() {
    if (window.render && window.render._qdEnvolvido) return;
    var original = window.render;
    var novo = function () {
      if (typeof S !== 'undefined' && S.page === 'quadros') {
        rQuadros();
        if (typeof renderTopBar === 'function') { try { renderTopBar(); } catch (e) { /* ignorar */ } }
        return;
      }
      return original.apply(this, arguments);
    };
    novo._qdEnvolvido = true;
    window.render = novo;
  }
  function ligarEventos() {
    var c = $('content');
    c.addEventListener('click', onClick);
    c.addEventListener('change', onChange);
    c.addEventListener('input', onInput);
    c.addEventListener('keydown', onKeydown);
    c.addEventListener('dragstart', onDragStart);
    c.addEventListener('dragover', onDragOver);
    c.addEventListener('dragleave', function (e) { if (e.target.classList && e.target.classList.contains('over')) e.target.classList.remove('over'); });
    c.addEventListener('dragend', function () { drag = null; limparDrop(); });
    c.addEventListener('drop', onDrop);
    var pop = document.createElement('div'); pop.id = 'qd-pop'; pop.className = 'qd-pop'; document.body.appendChild(pop);
    var sn = document.createElement('div'); sn.id = 'qd-snack'; sn.className = 'qd-snack'; document.body.appendChild(sn);
    pop.addEventListener('click', onPopClick);
    sn.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.sa === 'desfazer') {
        var f = sn._desfazer; sn.style.display = 'none'; if (f) f();
      }
    });
    var mb = $('modalBody');
    if (mb) { mb.addEventListener('click', onModalClick); mb.addEventListener('change', onModalChange); }
    document.addEventListener('click', function (e) {
      var p = $('qd-pop');
      if (p && p.style.display === 'block' && !p.contains(e.target)) fecharPop();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharPop(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') salvarAgora(); });
    window.addEventListener('beforeunload', salvarAgora);
  }

  /* ---------------- autoteste (console: QuadrosTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var hoje = '2026-11-12';
    var s = novoEstado();
    var q = criarQuadro(s, 'Teste', ['Ana', 'Bia']);
    var g1 = q.grupos[0]; var g2 = criarGrupo(s, q, 'Grupo 2');
    var cSt = q.colunas[0], cPr = q.colunas[1], cPe = q.colunas[2], cDt = q.colunas[3];
    ok('quadro nasce com 4 colunas e 2 grupos', q.colunas.length === 4 && q.grupos.length === 2 && q.pessoas.length === 2);
    var a = criarItem(s, q, g1, 'A'), b = criarItem(s, q, g1, 'B'), c = criarItem(s, q, g1, 'C');
    ok('item novo recebe o primeiro status', a.valores[cSt.id] === cSt.opcoes[0].id);
    setValor(s, a, cDt.id, '2026-11-10'); setValor(s, b, cDt.id, '2026-11-20'); setValor(s, c, cPe.id, 'Bia');
    ok('valor guardado', a.valores[cDt.id] === '2026-11-10');
    setValor(s, a, cDt.id, ''); ok('valor vazio apaga a chave', a.valores[cDt.id] === undefined);
    setValor(s, a, cDt.id, '2026-11-10');
    var chk = adicionarColuna(s, q, 'Pago', 'check'); setValor(s, a, chk.id, false);
    ok('check false é preservado', a.valores[chk.id] === false);
    ok('atrasado: prazo vencido e não concluído', atrasado(q, a, hoje) === true);
    ok('não atrasado: prazo futuro', atrasado(q, b, hoje) === false);
    setValor(s, a, cSt.id, cSt.opcoes[4].id);
    ok('concluído não conta como atrasado', atrasado(q, a, hoje) === false);
    setValor(s, a, cSt.id, cSt.opcoes[0].id);
    ok('mover item dentro do grupo (A para depois de C)', moverItem(s, a.id, g1.id, 3) && g1.itens.map(function (i) { return i.nome; }).join('') === 'BCA');
    ok('mover item para outro grupo', moverItem(s, c.id, g2.id, 0) && g2.itens.length === 1 && g1.itens.length === 2);
    ok('deslocar item no limite não quebra', deslocarItem(s, g1.itens[0].id, -1) === false);
    ok('deslocar item para baixo', deslocarItem(s, g1.itens[0].id, 1) === true);
    s.filtro.busca = 'bia';
    ok('busca encontra por valor de pessoa', itensVisiveis(s, q, g2, hoje).length === 1);
    s.filtro.busca = ''; s.filtro.pessoa = 'Ana';
    ok('filtro por pessoa exclui quem não tem', itensVisiveis(s, q, g2, hoje).length === 0);
    s.filtro.pessoa = ''; s.filtro.atrasados = true;
    var todosAtras = itensVisiveis(s, q, g1, hoje).concat(itensVisiveis(s, q, g2, hoje));
    ok('filtro de atrasados', todosAtras.length === 1 && todosAtras[0].nome === 'A');
    s.filtro.atrasados = false;
    var d = criarItem(s, q, g1, 'D');
    s.ordem = { col: cDt.id, dir: 'asc' };
    ok('ordenar por data deixa vazios no fim', itensVisiveis(s, q, g1, hoje).map(function (i) { return i.nome; }).join('') === 'ABD');
    excluirItem(s, d.id);
    s.ordem = { col: 'nome', dir: 'desc' };
    ok('ordenar por nome decrescente', itensVisiveis(s, q, g1, hoje).map(function (i) { return i.nome; }).join('') === 'BA');
    s.ordem = null;
    var p = progresso(q, g1);
    ok('progresso conta itens', p && p.total === 2 && p.feitos === 0);
    ok('arquivar esconde o item', arquivarItem(s, b.id) && itensVisiveis(s, q, g1, hoje).every(function (i) { return i.id !== b.id; }));
    ok('restaurar devolve o item', restaurarItem(s, b.id) && itensVisiveis(s, q, g1, hoje).some(function (i) { return i.id === b.id; }));
    var csv = gerarCSV(q);
    ok('CSV começa com BOM UTF-8', csv.charCodeAt(0) === 0xFEFF);
    ok('CSV usa ponto e vírgula e tem cabeçalho', csv.split('\r\n')[0] === '\uFEFFQuadro;Grupo;Item;Status;Prioridade;Responsável;Prazo;Pago');
    ok('CSV formata data dd/mm/aaaa', csv.indexOf('10/11/2026') > -1);
    ok('CSV tem uma linha por item mais o cabeçalho', csv.split('\r\n').length === 1 + 3);
    renomearItem(s, b, 'Tem; ponto e "aspas"');
    ok('CSV protege ; e aspas', gerarCSV(q).indexOf('"Tem; ponto e ""aspas"""') > -1);
    var m = adicionarColuna(s, q, 'Valor', 'moeda'); setValor(s, b, m.id, 1240.5);
    ok('CSV moeda com vírgula decimal', gerarCSV(q).indexOf('1240,50') > -1);
    ok('parseNum 1.240,50', parseNum('1.240,50') === 1240.5);
    ok('parseNum 1240,5', parseNum('1240,5') === 1240.5);
    ok('parseNum 12.5', parseNum('12.5') === 12.5);
    ok('parseNum R$ 3,00', parseNum('R$ 3,00') === 3);
    ok('parseNum inválido', parseNum('abc') === null && parseNum('') === null);
    var q2 = criarQuadro(s, 'Outro', ['Ana']);
    var mapeado = q2.colunas[0].opcoes[1].id;
    setValor(s, g1.itens[0], cSt.id, q.colunas[0].opcoes[1].id);
    var idMov = g1.itens[0].id;
    ok('mover para outro quadro', moverItemParaQuadro(s, idMov, q2.id) && achar(s, idMov).q.id === q2.id);
    ok('mover para outro quadro mapeia status por nome', achar(s, idMov).it.valores[q2.colunas[0].id] === mapeado);
    var opId = cPr.opcoes[0].id; setValor(s, g2.itens[0], cPr.id, opId);
    removerOpcao(s, q, cPr, opId);
    ok('remover etiqueta limpa valores que a usavam', g2.itens[0].valores[cPr.id] === undefined);
    removerColuna(s, q, cPe.id);
    ok('remover coluna limpa os valores', g2.itens[0].valores[cPe.id] === undefined && !colunaPorId(q, cPe.id));
    ok('excluir item remove do grupo', excluirItem(s, g2.itens[0].id) && g2.itens.length === 0);
    ok('arquivar e restaurar quadro', arquivarQuadro(s, q2.id) && quadroPorId(s, q2.id).arquivado === true && restaurarQuadro(s, q2.id) && !quadroPorId(s, q2.id).arquivado);
    var copia = JSON.parse(JSON.stringify({ versao: 1, atual: s.atual, quadros: s.quadros }));
    ok('estado sobrevive a JSON (como no DB.set)', copia.quadros.length === s.quadros.length && copia.quadros[0].colunas.length === q.colunas.length && copia.quadros[0].grupos[0].itens.length === g1.itens.length);
    var h1 = htmlTabela(s, q), h2 = htmlKanban(s, q);
    ok('HTML da tabela é gerado', typeof h1 === 'string' && h1.indexOf('qd-g') > -1);
    ok('HTML do kanban é gerado', typeof h2 === 'string' && h2.indexOf('qd-kc') > -1);
    ok('HTML do relatório PDF é gerado', htmlRelatorio(s, q, hoje).indexOf('mundana') > -1);
    ok('pessoasPadrao devolve lista', Array.isArray(pessoasPadrao()) && pessoasPadrao().length > 0);
    ok('SISTEMA: item Quadros está no menu', NAV.some(function (mm) { return mm.items.some(function (i) { return i.id === 'quadros'; }); }));
    ok('SISTEMA: render foi envolvido', window.render && window.render._qdEnvolvido === true);
    ok('SISTEMA: popover criado', !!$('qd-pop'));
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS: ' + r.length + ' testes, 0 falhas' : 'QUADROS: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  /* ---------------- detalhe do item: subitens, links e comentários (Fase 2B) ---------------- */
  function normalizarUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) return /^https?:\/\//i.test(u) ? u : '';
    return 'https://' + u;
  }
  function dominio(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; }
  }
  function addSub(it, nome) {
    nome = String(nome || '').trim(); if (!nome) return null;
    if (!it.subitens) it.subitens = [];
    var s = { id: uid(), nome: nome, feito: false };
    it.subitens.push(s); return s;
  }
  function achaSub(it, id) {
    var r = null;
    (it.subitens || []).forEach(function (s) { if (s.id === id) r = s; });
    return r;
  }
  function toggleSub(it, id) { var s = achaSub(it, id); if (!s) return false; s.feito = !s.feito; return true; }
  function renameSub(it, id, nome) {
    var s = achaSub(it, id); nome = String(nome || '').trim();
    if (!s || !nome) return false;
    s.nome = nome; return true;
  }
  function delSub(it, id) {
    var s = achaSub(it, id); if (!s) return false;
    it.subitens.splice(it.subitens.indexOf(s), 1); return true;
  }
  function progressoSub(it) {
    var subs = it.subitens || [];
    var feitos = subs.filter(function (s) { return s.feito; }).length;
    return { total: subs.length, feitos: feitos, pct: subs.length ? Math.round(feitos / subs.length * 100) : 0 };
  }
  function addComentario(it, texto, autor, em) {
    texto = String(texto || '').trim(); if (!texto) return null;
    if (!it.comentarios) it.comentarios = [];
    var c = { id: uid(), autor: String(autor || 'Ana'), texto: texto, em: em || new Date().toISOString() };
    it.comentarios.push(c); return c;
  }
  function delComentario(it, id) {
    var lista = it.comentarios || [];
    for (var i = 0; i < lista.length; i++) { if (lista[i].id === id) { lista.splice(i, 1); return true; } }
    return false;
  }
  function addLink(it, titulo, url) {
    var u = normalizarUrl(url); if (!u) return null;
    if (!it.links) it.links = [];
    var l = { id: uid(), titulo: String(titulo || '').trim() || dominio(u), url: u };
    it.links.push(l); return l;
  }
  function delLink(it, id) {
    var lista = it.links || [];
    for (var i = 0; i < lista.length; i++) { if (lista[i].id === id) { lista.splice(i, 1); return true; } }
    return false;
  }
  function contagensItem(it) {
    var p = progressoSub(it);
    return { subs: p.total, feitos: p.feitos, coms: (it.comentarios || []).length, links: (it.links || []).length };
  }
  function htmlDetalheBtn(it) {
    var c = contagensItem(it); var p = [];
    if (c.subs) p.push('<span class="i">' + (IC.list || '') + c.feitos + '/' + c.subs + '</span>');
    if (c.coms) p.push('<span class="i">' + (IC.chat || '') + c.coms + '</span>');
    if (c.links) p.push('<span class="i">' + (IC.link || '') + c.links + '</span>');
    if (!p.length) p.push('<span class="i">&#8250;</span>');
    return '<button class="qd-det" data-qd="det" data-i="' + esc(it.id) + '" title="Abrir detalhes" aria-label="Abrir detalhes do item">' + p.join('') + '</button>';
  }

  function injetarCSSDet() {
    if ($('qdt-css')) return;
    var css = [
      '#qd-root .qd-cn input.qd-nome{flex:1 1 auto;width:auto;min-width:0}',
      '#qd-root .qd-det{display:inline-flex;align-items:center;gap:8px;border:none;background:transparent;cursor:pointer;color:var(--text-muted);font-size:11px;font-family:inherit;padding:4px 6px;border-radius:8px;flex-shrink:0;white-space:nowrap}',
      '#qd-root .qd-det:hover{background:var(--bg-warm);color:var(--rosa-antigo)}',
      '#qd-root .qd-det svg{width:12px;height:12px}',
      '#qd-root .qd-det .i{display:inline-flex;align-items:center;gap:3px}',
      '.qdt-meta{font-size:12px;color:var(--text-muted);margin-bottom:6px}',
      '.qdt-sec{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:20px 0 8px;display:flex;align-items:center;gap:8px}',
      '.qdt-cnt{font-weight:700;color:var(--rosa-antigo);letter-spacing:0}',
      '.qdt-sub{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-light)}',
      '.qdt-sub input[type=checkbox]{width:18px;height:18px;flex-shrink:0;cursor:pointer;accent-color:var(--oliva)}',
      '.qdt-sub input.qdt-subnome{flex:1;min-width:0;border:1.5px solid transparent;background:transparent;font-family:inherit;font-size:13px;padding:6px 8px;border-radius:8px;outline:none;color:var(--text-primary)}',
      '.qdt-sub input.qdt-subnome:focus{background:var(--surface);border-color:var(--rosa-antigo)}',
      '.qdt-sub.feito input.qdt-subnome{text-decoration:line-through;color:var(--text-muted)}',
      '.qdt-x{border:none;background:transparent;color:var(--text-muted);cursor:pointer;font-size:16px;line-height:1;padding:4px 8px;border-radius:8px;font-family:inherit}',
      '.qdt-x:hover{background:var(--rose-pale);color:var(--rosa-antigo)}',
      '.qdt-link{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-light);font-size:13px}',
      '.qdt-link a{color:var(--rosa-antigo);font-weight:600;text-decoration:none;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.qdt-link .url{font-size:11px;color:var(--text-muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.qdt-com{background:var(--bg-warm);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:8px}',
      '.qdt-com-h{display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:4px}',
      '.qdt-com-h .quando{color:var(--text-muted);font-size:11px;flex:1}',
      '.qdt-com-t{font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
      '.qdt-linha{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'qdt-css'; st.textContent = css; document.head.appendChild(st);
  }

  function corpoDetalhe(a) {
    var it = a.it, q = a.q, g = a.g;
    var cs = colPrincipal(q); var op = cs ? opcaoPorId(cs, it.valores[cs.id]) : null;
    var pr = progressoSub(it);
    var coms = it.comentarios || []; var links = it.links || [];
    var h = '<div id="qdt-root" data-item="' + esc(it.id) + '">';
    h += '<div class="qdt-meta">' + esc(q.nome) + ' \u00B7 ' + esc(g.nome) + (op ? ' \u00B7 <span style="color:' + esc(op.cor) + ';font-weight:700">' + esc(op.nome) + '</span>' : '') + '</div>';
    h += '<div class="qdt-sec">Descrição</div><textarea class="form-textarea qdt-desc" rows="3" placeholder="Contexto, objetivo, observações...">' + esc(it.descricao || '') + '</textarea>';
    h += '<div class="qdt-sec">Subitens' + (pr.total ? ' <span class="qdt-cnt">' + pr.feitos + '/' + pr.total + '</span>' : '') + '</div>';
    if (pr.total) h += '<div class="progress-bar"><div class="progress-fill" style="width:' + pr.pct + '%"></div></div>';
    (it.subitens || []).forEach(function (s) {
      h += '<div class="qdt-sub' + (s.feito ? ' feito' : '') + '"><input type="checkbox" class="qdt-chk" data-id="' + esc(s.id) + '"' + (s.feito ? ' checked' : '') + '><input class="qdt-subnome" data-id="' + esc(s.id) + '" value="' + esc(s.nome) + '"><button class="qdt-x" data-qdt="sub-del" data-id="' + esc(s.id) + '" aria-label="Excluir subitem">&times;</button></div>';
    });
    h += '<input class="form-input" id="qdt-sub-add" placeholder="+ Adicionar subitem (Enter)" style="margin-top:8px">';
    h += '<div class="qdt-sec">Links e referências' + (links.length ? ' <span class="qdt-cnt">' + links.length + '</span>' : '') + '</div>';
    links.forEach(function (l) {
      h += '<div class="qdt-link"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.titulo) + '</a><span class="url">' + esc(dominio(l.url)) + '</span><button class="qdt-x" data-qdt="lnk-del" data-id="' + esc(l.id) + '" aria-label="Excluir link">&times;</button></div>';
    });
    h += '<div class="qdt-linha"><input class="form-input" id="qdt-lnk-tit" placeholder="Título (opcional)" style="flex:1;min-width:120px;width:auto"><input class="form-input" id="qdt-lnk-url" placeholder="Endereço (https://...)" style="flex:2;min-width:160px;width:auto"><button class="btn btn-secondary btn-sm" data-qdt="lnk-add">Adicionar link</button></div>';
    h += '<div class="qdt-sec">Comentários' + (coms.length ? ' <span class="qdt-cnt">' + coms.length + '</span>' : '') + '</div>';
    coms.forEach(function (c) {
      h += '<div class="qdt-com"><div class="qdt-com-h"><strong>' + esc(c.autor) + '</strong><span class="quando">' + esc(fmtDataHora(new Date(c.em))) + '</span><button class="qdt-x" data-qdt="com-del" data-id="' + esc(c.id) + '" aria-label="Excluir comentário">&times;</button></div><div class="qdt-com-t">' + esc(c.texto) + '</div></div>';
    });
    var autores = (q.pessoas || []).slice(); if (!autores.length) autores = ['Ana'];
    var ultimo = ''; try { ultimo = localStorage.getItem('qd_autor') || ''; } catch (e) { ultimo = ''; }
    if (autores.indexOf(ultimo) < 0) ultimo = autores[0];
    h += '<textarea class="form-textarea" id="qdt-com-txt" rows="2" placeholder="Escreva um comentário (Cmd+Enter para enviar)" style="margin-top:8px"></textarea>';
    h += '<div class="qdt-linha"><select class="form-select" id="qdt-com-aut" style="width:auto">' + autores.map(function (p) { return '<option value="' + esc(p) + '"' + (p === ultimo ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select><button class="btn btn-primary btn-sm" data-qdt="com-add">Comentar</button></div>';
    return h + '</div>';
  }
  function abrirDetalhe(itemId) {
    var a = achar(Q, itemId); if (!a) return;
    openModal(a.it.nome, corpoDetalhe(a), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', false);
  }
  function pintarDetalhe(itemId, focoId) {
    var a = achar(Q, itemId); var mb = $('modalBody'); if (!a || !mb) return;
    var m = $('modal'); var st = m ? m.scrollTop : 0;
    mb.innerHTML = corpoDetalhe(a);
    if (m) m.scrollTop = st;
    if (focoId) { var f = $(focoId); if (f) f.focus(); }
  }
  function depoisDet(itemId, focoId) { salvar(); renderTudo(); pintarDetalhe(itemId, focoId); }
  function ctxDetalhe() {
    var raiz = $('qdt-root'); if (!raiz) return null;
    var a = achar(Q, raiz.dataset.item);
    return a ? { id: raiz.dataset.item, it: a.it, q: a.q } : null;
  }
  function comentarDoModal(ctx) {
    var txt = $('qdt-com-txt'), aut = $('qdt-com-aut');
    if (!txt) return;
    var autor = aut ? aut.value : 'Ana';
    try { localStorage.setItem('qd_autor', autor); } catch (e) { /* ignorar */ }
    if (!addComentario(ctx.it, txt.value, autor)) { aviso('Escreva o comentário antes de enviar'); return; }
    depoisDet(ctx.id, 'qdt-com-txt');
  }
  function linkDoModal(ctx) {
    var tit = $('qdt-lnk-tit'), url = $('qdt-lnk-url');
    if (!addLink(ctx.it, tit ? tit.value : '', url ? url.value : '')) { aviso('Informe um endereço válido (http:// ou https://)'); return; }
    depoisDet(ctx.id, 'qdt-lnk-url');
  }
  function onDetClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qdt]') : null; if (!t) return;
    var ctx = ctxDetalhe(); if (!ctx) return;
    switch (t.dataset.qdt) {
      case 'sub-del': delSub(ctx.it, t.dataset.id); depoisDet(ctx.id); break;
      case 'lnk-del': delLink(ctx.it, t.dataset.id); depoisDet(ctx.id); break;
      case 'lnk-add': linkDoModal(ctx); break;
      case 'com-del': if (window.confirm('Excluir este comentário?')) { delComentario(ctx.it, t.dataset.id); depoisDet(ctx.id); } break;
      case 'com-add': comentarDoModal(ctx); break;
      default: break;
    }
  }
  function onDetChange(e) {
    var el = e.target; if (!el.classList) return;
    var ctx = ctxDetalhe(); if (!ctx) return;
    if (el.classList.contains('qdt-desc')) { ctx.it.descricao = el.value; salvar(); return; }
    if (el.classList.contains('qdt-chk')) { toggleSub(ctx.it, el.dataset.id); depoisDet(ctx.id); return; }
    if (el.classList.contains('qdt-subnome')) {
      if (!renameSub(ctx.it, el.dataset.id, el.value)) { var s = achaSub(ctx.it, el.dataset.id); el.value = s ? s.nome : ''; }
      else salvar();
      return;
    }
    if (el.id === 'qdt-com-aut') { try { localStorage.setItem('qd_autor', el.value); } catch (err) { /* ignorar */ } }
  }
  function onDetKeydown(e) {
    var el = e.target; if (!el || !el.id) return;
    var ctx = ctxDetalhe(); if (!ctx) return;
    if (e.key === 'Enter' && el.id === 'qdt-sub-add') {
      e.preventDefault();
      if (addSub(ctx.it, el.value)) depoisDet(ctx.id, 'qdt-sub-add');
    } else if (e.key === 'Enter' && (el.id === 'qdt-lnk-url' || el.id === 'qdt-lnk-tit')) {
      e.preventDefault(); linkDoModal(ctx);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && el.id === 'qdt-com-txt') {
      e.preventDefault(); comentarDoModal(ctx);
    }
  }
  function onContentDet(e) {
    if (!ativo()) return;
    var t = e.target.closest ? e.target.closest('[data-qd="det"]') : null; if (!t) return;
    abrirDetalhe(t.dataset.i);
  }
  function ligarDetalhe() {
    injetarCSSDet();
    $('content').addEventListener('click', onContentDet);
    var mb = $('modalBody');
    if (mb) { mb.addEventListener('click', onDetClick); mb.addEventListener('change', onDetChange); mb.addEventListener('keydown', onDetKeydown); }
  }

  function testeDetalhe() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var it = { id: 'i1', nome: 'Item', valores: {} };
    ok('subitem vazio é ignorado', addSub(it, '   ') === null && !(it.subitens && it.subitens.length));
    var s1 = addSub(it, ' Comprar frascos ');
    ok('adiciona subitem com trim', !!s1 && it.subitens[0].nome === 'Comprar frascos' && it.subitens[0].feito === false);
    addSub(it, 'Gravar vídeo'); addSub(it, 'Postar');
    ok('progresso 0 de 3', progressoSub(it).total === 3 && progressoSub(it).feitos === 0 && progressoSub(it).pct === 0);
    toggleSub(it, s1.id);
    ok('marcar um subitem dá 33%', progressoSub(it).feitos === 1 && progressoSub(it).pct === 33);
    toggleSub(it, s1.id);
    ok('desmarcar volta a 0', progressoSub(it).feitos === 0);
    ok('renomear subitem', renameSub(it, s1.id, 'Comprar frascos âmbar') && achaSub(it, s1.id).nome === 'Comprar frascos âmbar');
    ok('renomear para vazio é recusado', renameSub(it, s1.id, '  ') === false && achaSub(it, s1.id).nome === 'Comprar frascos âmbar');
    ok('excluir subitem', delSub(it, s1.id) && it.subitens.length === 2 && delSub(it, 'zzz') === false);
    ok('comentário vazio é ignorado', addComentario(it, '  ', 'Ana') === null && !(it.comentarios && it.comentarios.length));
    var c1 = addComentario(it, ' Aprovado pela Ana ', 'Ana', '2026-11-12T10:30:00.000Z');
    ok('adiciona comentário com autor e data', !!c1 && it.comentarios[0].autor === 'Ana' && it.comentarios[0].texto === 'Aprovado pela Ana' && it.comentarios[0].em === '2026-11-12T10:30:00.000Z');
    ok('excluir comentário', delComentario(it, c1.id) && it.comentarios.length === 0);
    var l1 = addLink(it, 'Pasta', 'drive.google.com/abc');
    ok('link sem protocolo ganha https', !!l1 && l1.url === 'https://drive.google.com/abc' && l1.titulo === 'Pasta');
    ok('link javascript é recusado', addLink(it, 'x', 'javascript:alert(1)') === null);
    ok('link com outro protocolo é recusado', addLink(it, 'x', 'ftp://a.com') === null);
    var l2 = addLink(it, '', 'https://www.canva.com/design/1');
    ok('título vazio usa o domínio', !!l2 && l2.titulo === 'canva.com');
    ok('excluir link', delLink(it, l1.id) && it.links.length === 1);
    var cont = contagensItem(it);
    ok('contagens do item', cont.subs === 2 && cont.feitos === 0 && cont.coms === 0 && cont.links === 1);
    var b = htmlDetalheBtn(it);
    ok('botão mostra subitens e links', b.indexOf('0/2') > -1 && b.indexOf('data-i="i1"') > -1);
    ok('botão sem detalhes mostra a seta', htmlDetalheBtn({ id: 'x', valores: {} }).indexOf('&#8250;') > -1);
    var s = novoEstado(); var q = criarQuadro(s, 'T', ['Ana']); var g = q.grupos[0];
    var item = criarItem(s, q, g, '<b>x</b>');
    addSub(item, '<img src=x onerror=alert(1)>'); addComentario(item, '<script>alert(1)<\/script>', 'Ana'); addLink(item, '<i>t</i>', 'a.com');
    var html = corpoDetalhe({ q: q, g: g, it: item });
    ok('o painel é gerado', html.indexOf('qdt-root') > -1 && html.indexOf('Subitens') > -1 && html.indexOf('Comentários') > -1);
    ok('o painel escapa HTML digitado pelo usuário', html.indexOf('<img') < 0 && html.indexOf('<script') < 0 && html.indexOf('<i>') < 0);
    var copia = JSON.parse(JSON.stringify(item));
    ok('subitens, links e comentários sobrevivem ao JSON', copia.subitens.length === 1 && copia.comentarios.length === 1 && copia.links.length === 1);
    var q2 = criarQuadro(s, 'Outro', ['Ana']);
    ok('mover para outro quadro mantém os detalhes', moverItemParaQuadro(s, item.id, q2.id) && achar(s, item.id).it.subitens.length === 1);
    ok('SISTEMA: estilos do painel injetados', !!$('qdt-css'));
    ok('SISTEMA: painel disponível', typeof abrirDetalhe === 'function');
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS-DETALHE: ' + r.length + ' testes, 0 falhas' : 'QUADROS-DETALHE: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  /* ---------------- rotinas e modelos de quadro (Fase 2C) ---------------- */
  var NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var rotEdit = null;
  var ultimaGer = 0;

  function isoDe(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function dataDe(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
  function somarDias(iso, n) { var d = dataDe(iso); d.setDate(d.getDate() + n); return isoDe(d); }
  function ultimoDiaMes(ano, mes) { return new Date(ano, mes + 1, 0).getDate(); }
  function dataMensal(ano, mes, dia) { return isoDe(new Date(ano, mes, Math.min(dia, ultimoDiaMes(ano, mes)), 12, 0, 0)); }

  function primeiraOcorrencia(r) {
    var ini = r.inicio || hojeISO();
    if (r.freq === 'semanal') {
      var d = dataDe(ini);
      for (var i = 0; i < 7; i++) { if (d.getDay() === (r.diaSemana || 0)) break; d.setDate(d.getDate() + 1); }
      return isoDe(d);
    }
    if (r.freq === 'mensal') {
      var di = dataDe(ini);
      var cand = dataMensal(di.getFullYear(), di.getMonth(), r.diaMes || 1);
      if (cand < ini) cand = dataMensal(di.getFullYear(), di.getMonth() + 1, r.diaMes || 1);
      return cand;
    }
    return ini;
  }
  function proximaApos(r, iso) {
    var n = Math.max(1, r.intervalo || 1);
    if (r.freq === 'semanal') return somarDias(iso, 7 * n);
    if (r.freq === 'mensal') { var d = dataDe(iso); return dataMensal(d.getFullYear(), d.getMonth() + n, r.diaMes || 1); }
    return somarDias(iso, n);
  }
  function proximaDesde(r, hoje) {
    var p = primeiraOcorrencia(r); var guarda = 0;
    while (p < hoje && guarda < 2000) { p = proximaApos(r, p); guarda++; }
    return p;
  }
  function descreverRotina(r) {
    var n = r.intervalo || 1;
    if (r.freq === 'dias') return n === 1 ? 'Todo dia' : 'A cada ' + n + ' dias';
    if (r.freq === 'semanal') {
      var d = NOMES_DIA[r.diaSemana || 0];
      var art = (r.diaSemana === 0 || r.diaSemana === 6) ? 'Todo ' : 'Toda ';
      return n === 1 ? art + d : 'A cada ' + n + ' semanas, ' + d;
    }
    return n === 1 ? 'Todo mês, dia ' + r.diaMes : 'A cada ' + n + ' meses, dia ' + r.diaMes;
  }

  function criarDaRotina(s, q, r, data) {
    var marca = r.id + '@' + data;
    var existe = false;
    q.grupos.forEach(function (g) { g.itens.forEach(function (it) { if (it._rot === marca) existe = true; }); });
    if (existe) return false;
    var g = null;
    q.grupos.forEach(function (x) { if (x.id === r.grupoId && !x.arquivado) g = x; });
    if (!g) q.grupos.forEach(function (x) { if (!g && !x.arquivado) g = x; });
    if (!g) g = criarGrupo(s, q, 'Rotinas');
    var it = criarItem(s, q, g, r.titulo);
    it._rot = marca;
    var cd = null, cp = null;
    q.colunas.forEach(function (c) { if (!cd && c.tipo === 'data') cd = c; if (!cp && c.tipo === 'pessoa') cp = c; });
    if (cd) it.valores[cd.id] = data;
    if (cp && r.responsavel) it.valores[cp.id] = r.responsavel;
    (r.subitens || []).forEach(function (n) { addSub(it, n); });
    return true;
  }
  function gerarRotinas(est, hoje) {
    var total = 0;
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado || !q.rotinas || !q.rotinas.length) return;
      q.rotinas.forEach(function (r) {
        if (!r.ativa) return;
        if (!r.proxima) r.proxima = primeiraOcorrencia(r);
        var devidas = []; var guarda = 0;
        while (r.proxima && somarDias(r.proxima, -(r.antecedencia || 0)) <= hoje && guarda < 400) {
          devidas.push(r.proxima); r.proxima = proximaApos(r, r.proxima); guarda++;
        }
        devidas.slice(-3).forEach(function (data) { if (criarDaRotina(est, q, r, data)) total++; });
      });
    });
    return total;
  }
  /* Gera direto no banco (usado pelo Modo Dia e pelo Dashboard, mesmo sem abrir Quadros). */
  function gerarNoBanco(forcar) {
    if (pendente) return;
    if (!forcar && Date.now() - ultimaGer < 30000) return;
    ultimaGer = Date.now();
    var d = null;
    try { d = DB.get(CHAVE); } catch (e) { d = null; }
    if (!d || Array.isArray(d) || !Array.isArray(d.quadros)) return;
    var n = gerarRotinas(d, hojeISO());
    if (n > 0) {
      try { DB.set(CHAVE, { versao: 1, atual: d.atual || null, quadros: d.quadros }); } catch (e) { console.error('quadros: rotinas', e); }
    }
  }
  function envolverGeracao() {
    ['getModoDiaTasks', 'rDash'].forEach(function (nome) {
      var orig = window[nome];
      if (typeof orig !== 'function' || orig._qdGer) return;
      var novo = function () {
        try { gerarNoBanco(false); } catch (e) { console.error('quadros: rotinas', e); }
        return orig.apply(this, arguments);
      };
      novo._qdGer = true; window[nome] = novo;
    });
  }

  /* --- modelos prontos --- */
  var MODELOS = [
    { id: 'branco', nome: 'Em branco', desc: 'Status, prioridade, responsável e prazo, com um grupo vazio.', grupos: [{ nome: 'Grupo 1', itens: [] }] },
    { id: 'lancamento', nome: 'Lançamento de produto', desc: 'Da fórmula à divulgação, com as etapas já listadas.', grupos: [
      { nome: 'Fórmula e testes', itens: ['Definir conceito e fragrância', 'Testes de estabilidade', 'Aprovar lote piloto'] },
      { nome: 'Produção e embalagem', itens: ['Cotar frascos e rótulos', 'Produzir o primeiro lote', 'Conferir lote e validade'] },
      { nome: 'Conteúdo e divulgação', itens: ['Fotografar o produto', 'Roteiro do Reel de lançamento', 'Publicar nas redes', 'Avisar a lista de leads'] },
      { nome: 'Lançamento', itens: ['Cadastrar na loja e definir o preço', 'Dia do lançamento'] }
    ] },
    { id: 'conteudo', nome: 'Calendário de conteúdo', desc: 'Das ideias ao publicado, com formato, canal e link.',
      colunas: [
        { nome: 'Status', tipo: 'status' },
        { nome: 'Formato', tipo: 'lista', opcoes: ['Reel', 'Feed', 'Carrossel', 'Stories'] },
        { nome: 'Canal', tipo: 'lista', opcoes: ['Instagram', 'TikTok', 'E-mail'] },
        { nome: 'Responsável', tipo: 'pessoa' },
        { nome: 'Publicação', tipo: 'data' },
        { nome: 'Link', tipo: 'link' }
      ],
      grupos: [{ nome: 'Ideias', itens: [] }, { nome: 'Em produção', itens: [] }, { nome: 'Aprovado', itens: [] }, { nome: 'Publicado', itens: [] }] },
    { id: 'producao', nome: 'Produção do mês', desc: 'Lotes planejados, em produção e concluídos.',
      colunas: [
        { nome: 'Status', tipo: 'status' },
        { nome: 'Produto', tipo: 'texto' },
        { nome: 'Quantidade', tipo: 'numero' },
        { nome: 'Responsável', tipo: 'pessoa' },
        { nome: 'Data', tipo: 'data' }
      ],
      grupos: [{ nome: 'Planejados', itens: [] }, { nome: 'Em produção', itens: [] }, { nome: 'Concluídos', itens: [] }] },
    { id: 'rotina', nome: 'Rotinas de gestão', desc: 'Conferências semanais e mensais, prontas para virarem Rotinas.', grupos: [
      { nome: 'Toda semana', itens: ['Conferir estoque de matérias-primas', 'Conferir contas a pagar da semana', 'Responder leads do quiz'] },
      { nome: 'Todo mês', itens: ['Fechar o financeiro do mês', 'Revisar preços e margens', 'Planejar o conteúdo do próximo mês'] }
    ] }
  ];
  function criarDeModelo(s, modelo, nome, pessoas) {
    var q = criarQuadro(s, nome || modelo.nome, pessoas);
    if (modelo.colunas) {
      q.colunas = modelo.colunas.map(function (c) {
        var col = { id: uid(), nome: c.nome, tipo: c.tipo };
        if (c.tipo === 'status') col.opcoes = c.opcoes ? opcoesDeModelo(c.opcoes) : opcoesStatusPadrao();
        else if (c.tipo === 'lista') col.opcoes = (c.opcoes || ['Opção 1', 'Opção 2']).map(function (n, i) { return { id: uid(), nome: n, cor: CORES[(i + 1) % CORES.length] }; });
        return col;
      });
    }
    q.grupos = [];
    (modelo.grupos || [{ nome: 'Grupo 1', itens: [] }]).forEach(function (gm) {
      var g = criarGrupo(s, q, gm.nome);
      (gm.itens || []).forEach(function (n) { criarItem(s, q, g, n); });
    });
    return q;
  }

  /* --- interface: rotinas e novo quadro --- */
  function injetarCSSRot() {
    if ($('qdr-css')) return;
    var css = [
      '.qdr-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px}',
      '.qdr-row input[type=checkbox]{width:18px;height:18px;accent-color:var(--oliva);cursor:pointer;flex-shrink:0}',
      '.qdr-row .info{flex:1;min-width:0}',
      '.qdr-row .info .sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
      '.qdr-linha{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '.qdr-linha>div{flex:1;min-width:130px}',
      '.qdn-mod{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1.5px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px;cursor:pointer}',
      '.qdn-mod:hover{border-color:var(--rosa-antigo)}',
      '.qdn-mod:has(input:checked){border-color:var(--rosa-antigo);background:var(--rose-pale)}',
      '.qdn-mod input{margin-top:3px;accent-color:var(--rosa-antigo)}',
      '.qdn-mod .sub{font-size:11.5px;color:var(--text-muted);margin-top:2px}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'qdr-css'; st.textContent = css; document.head.appendChild(st);
  }
  function opcSel(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }

  function corpoNovoQuadro() {
    var h = '<div id="qdn-root"><label class="form-label">Nome do quadro</label><input class="form-input" id="qdn-nome" placeholder="Ex.: Lançamento Caramel Nut" style="margin-bottom:14px"><div class="qdt-sec" style="margin-top:6px">Começar com</div>';
    MODELOS.forEach(function (m, i) {
      h += '<label class="qdn-mod"><input type="radio" name="qdn-mod" value="' + esc(m.id) + '"' + (i === 0 ? ' checked' : '') + '><div><strong>' + esc(m.nome) + '</strong><div class="sub">' + esc(m.desc) + '</div></div></label>';
    });
    return h + '<button class="btn btn-primary" data-qr="nq-criar" style="margin-top:8px">Criar quadro</button>' + htmlSecaoModelos() + '</div>';
  }
  function abrirNovoQuadro() {
    openModal('Novo quadro', corpoNovoQuadro(), '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>', false);
    setTimeout(function () { var e = $('qdn-nome'); if (e) e.focus(); }, 50);
  }
  function criarQuadroDoModal() {
    if (!$('qdn-root')) return;
    var nome = ($('qdn-nome').value || '').trim();
    var sel = document.querySelector('input[name="qdn-mod"]:checked');
    var modelo = MODELOS[0];
    MODELOS.forEach(function (m) { if (sel && m.id === sel.value) modelo = m; });
    var q = criarDeModelo(Q, modelo, nome || modelo.nome, pessoasPadrao());
    trocarQuadro(q.id); salvar(); closeModal(); renderTudo();
    aviso('Quadro criado');
  }

  function corpoRotinas(q) {
    var lista = q.rotinas || [];
    var ed = null;
    if (rotEdit) lista.forEach(function (x) { if (x.id === rotEdit) ed = x; });
    var h = '<div id="qdr-root"><p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Rotinas criam itens sozinhas no grupo escolhido, na data certa. Os itens aparecem no Modo Dia e no Dashboard.</p>';
    if (!lista.length) h += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;background:var(--bg-warm);border-radius:var(--radius-md);margin-bottom:8px">Nenhuma rotina ainda.</div>';
    lista.forEach(function (r) {
      var g = null; q.grupos.forEach(function (x) { if (x.id === r.grupoId) g = x; });
      h += '<div class="qdr-row"><input type="checkbox" class="qdr-ativa" data-id="' + esc(r.id) + '"' + (r.ativa ? ' checked' : '') + ' title="Ativa"><div class="info"><strong>' + esc(r.titulo) + '</strong><div class="sub">' + esc(descreverRotina(r)) + ' \u00B7 ' + esc(g ? g.nome : 'sem grupo') + (r.ativa && r.proxima ? ' \u00B7 próxima em ' + esc(fmtData(r.proxima)) : ' \u00B7 pausada') + ((r.subitens || []).length ? ' \u00B7 ' + r.subitens.length + ' subitens' : '') + '</div></div>' +
        '<button class="btn btn-secondary btn-sm" data-qr="rot-edit" data-id="' + esc(r.id) + '">Editar</button><button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qr="rot-del" data-id="' + esc(r.id) + '">Excluir</button></div>';
    });
    var v = ed || { titulo: '', grupoId: '', responsavel: '', freq: 'semanal', intervalo: 1, diaSemana: 1, diaMes: 1, inicio: hojeISO(), antecedencia: 0, subitens: [] };
    h += '<div class="qdt-sec">' + (ed ? 'Editar rotina' : 'Nova rotina') + '</div>';
    h += '<input class="form-input" id="qdr-titulo" placeholder="Título do item (ex.: Conferir estoque de matérias-primas)" value="' + esc(v.titulo) + '" style="margin-bottom:10px">';
    h += '<div class="qdr-linha"><div><label class="form-label">Criar no grupo</label><select class="form-select" id="qdr-grupo">' +
      q.grupos.filter(function (g) { return !g.arquivado; }).map(function (g) { return opcSel(g.id, g.nome, g.id === v.grupoId); }).join('') + '</select></div>' +
      '<div><label class="form-label">Responsável</label><select class="form-select" id="qdr-resp">' + opcSel('', 'Sem responsável', !v.responsavel) +
      (q.pessoas || []).map(function (p) { return opcSel(p, p, p === v.responsavel); }).join('') + '</select></div></div>';
    h += '<div class="qdr-linha"><div><label class="form-label">Repetir</label><select class="form-select" id="qdr-freq">' + opcSel('dias', 'Por dias', v.freq === 'dias') + opcSel('semanal', 'Por semanas', v.freq === 'semanal') + opcSel('mensal', 'Por meses', v.freq === 'mensal') + '</select></div>' +
      '<div><label class="form-label">A cada</label><input class="form-input" id="qdr-intervalo" type="number" min="1" max="365" value="' + esc(v.intervalo || 1) + '"></div>' +
      '<div id="qdr-box-semana"><label class="form-label">Dia da semana</label><select class="form-select" id="qdr-dsemana">' + NOMES_DIA.map(function (n, i) { return opcSel(String(i), n, i === (v.diaSemana || 0)); }).join('') + '</select></div>' +
      '<div id="qdr-box-mes"><label class="form-label">Dia do mês</label><input class="form-input" id="qdr-dmes" type="number" min="1" max="31" value="' + esc(v.diaMes || 1) + '"></div></div>';
    h += '<div class="qdr-linha"><div><label class="form-label">Começa em</label><input class="form-input" id="qdr-inicio" type="date" value="' + esc(v.inicio || hojeISO()) + '"></div>' +
      '<div><label class="form-label">Criar com antecedência (dias)</label><input class="form-input" id="qdr-ant" type="number" min="0" max="30" value="' + esc(v.antecedencia || 0) + '"></div></div>';
    h += '<label class="form-label">Subitens (um por linha, opcional)</label><textarea class="form-textarea" id="qdr-subs" rows="3" placeholder="Contar frascos&#10;Contar matérias-primas">' + esc((v.subitens || []).join('\n')) + '</textarea>';
    h += '<div class="qdr-linha" style="margin-top:12px"><button class="btn btn-primary" data-qr="rot-salvar">Salvar rotina</button>' + (ed ? '<button class="btn btn-secondary" data-qr="rot-cancelar">Cancelar edição</button>' : '') + '</div></div>';
    return h;
  }
  function ajustarCamposRotina() {
    var f = $('qdr-freq'); if (!f) return;
    var s = $('qdr-box-semana'), m = $('qdr-box-mes');
    if (s) s.style.display = f.value === 'semanal' ? '' : 'none';
    if (m) m.style.display = f.value === 'mensal' ? '' : 'none';
  }
  function abrirRotinas(editId) {
    var q = quadroAtual(); if (!q) return;
    rotEdit = editId || null;
    openModal('Rotinas \u00B7 ' + q.nome, corpoRotinas(q), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', true);
    ajustarCamposRotina();
  }
  function lerFormRotina() {
    function v(id) { var el = $(id); return el ? el.value : ''; }
    return {
      titulo: v('qdr-titulo').trim(), grupoId: v('qdr-grupo'), responsavel: v('qdr-resp'),
      freq: v('qdr-freq') || 'semanal', intervalo: Math.max(1, parseInt(v('qdr-intervalo'), 10) || 1),
      diaSemana: parseInt(v('qdr-dsemana'), 10) || 0,
      diaMes: Math.min(31, Math.max(1, parseInt(v('qdr-dmes'), 10) || 1)),
      inicio: v('qdr-inicio') || hojeISO(),
      antecedencia: Math.min(30, Math.max(0, parseInt(v('qdr-ant'), 10) || 0)),
      subitens: v('qdr-subs').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)
    };
  }
  function assinaturaRotina(r) { return [r.freq, r.intervalo, r.diaSemana, r.diaMes, r.inicio].join('|'); }
  function salvarRotinaDoModal() {
    var q = quadroAtual(); if (!q || !$('qdr-root')) return;
    var f = lerFormRotina();
    if (!f.titulo) { aviso('Dê um título para a rotina'); return; }
    if (!q.rotinas) q.rotinas = [];
    var r = null;
    if (rotEdit) q.rotinas.forEach(function (x) { if (x.id === rotEdit) r = x; });
    var antes = r ? assinaturaRotina(r) : '';
    if (!r) { r = { id: uid(), ativa: true }; q.rotinas.push(r); }
    var k;
    for (k in f) { if (Object.prototype.hasOwnProperty.call(f, k)) r[k] = f[k]; }
    if (!r.proxima || assinaturaRotina(r) !== antes) r.proxima = primeiraOcorrencia(r);
    var n = gerarRotinas(Q, hojeISO());
    rotEdit = null; salvar(); renderTudo();
    aviso(n > 0 ? 'Rotina salva: ' + n + ' item' + (n > 1 ? 'ns' : '') + ' criado' + (n > 1 ? 's' : '') : 'Rotina salva');
    abrirRotinas();
  }
  function onRotClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qr]') : null; if (!t) return;
    var q = quadroAtual();
    var acao = t.dataset.qr;
    if (acao === 'nq-criar') { criarQuadroDoModal(); return; }
    if (!q || !$('qdr-root')) return;
    if (acao === 'rot-salvar') salvarRotinaDoModal();
    else if (acao === 'rot-edit') abrirRotinas(t.dataset.id);
    else if (acao === 'rot-cancelar') abrirRotinas();
    else if (acao === 'rot-del') {
      if (window.confirm('Excluir esta rotina? Os itens já criados continuam nos quadros.')) {
        q.rotinas = (q.rotinas || []).filter(function (x) { return x.id !== t.dataset.id; });
        salvar(); abrirRotinas();
      }
    }
  }
  function onRotChange(e) {
    var el = e.target; if (!el.classList && !el.id) return;
    if (el.id === 'qdr-freq') { ajustarCamposRotina(); return; }
    if (el.classList && el.classList.contains('qdr-ativa')) {
      var q = quadroAtual(); if (!q) return;
      var r = null; (q.rotinas || []).forEach(function (x) { if (x.id === el.dataset.id) r = x; });
      if (!r) return;
      r.ativa = el.checked;
      if (r.ativa) r.proxima = proximaDesde(r, hojeISO());
      salvar(); abrirRotinas(rotEdit);
    }
  }
  function onRotKeydown(e) {
    var el = e.target;
    if (e.key === 'Enter' && el && el.id === 'qdn-nome') { e.preventDefault(); criarQuadroDoModal(); }
  }
  function ligarRotinas() {
    injetarCSSRot();
    var c = $('content');
    c.addEventListener('click', function (e) {
      if (!ativo()) return;
      var t = e.target.closest ? e.target.closest('[data-qd="novo-quadro"]') : null;
      if (!t) return;
      e.stopPropagation(); e.preventDefault();
      abrirNovoQuadro();
    }, true);
    c.addEventListener('click', function (e) {
      if (!ativo()) return;
      var t = e.target.closest ? e.target.closest('[data-qd="rotinas"]') : null;
      if (t) abrirRotinas();
    });
    var mb = $('modalBody');
    if (mb) { mb.addEventListener('click', onRotClick); mb.addEventListener('change', onRotChange); mb.addEventListener('keydown', onRotKeydown); }
  }

  function testeRotinas() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    ok('somar dias atravessa o mês', somarDias('2026-11-30', 1) === '2026-12-01' && somarDias('2026-03-01', -1) === '2026-02-28');
    ok('mensal dia 31 em fevereiro cai no último dia', dataMensal(2026, 1, 31) === '2026-02-28' && dataMensal(2028, 1, 31) === '2028-02-29');
    ok('mensal passa de dezembro para janeiro', dataMensal(2026, 12, 15) === '2027-01-15');
    var sem = { freq: 'semanal', intervalo: 1, diaSemana: 1, inicio: '2026-11-12' };
    ok('semanal: a primeira segunda depois de quinta 12/11 é 16/11', primeiraOcorrencia(sem) === '2026-11-16');
    ok('semanal: a próxima é 7 dias depois', proximaApos(sem, '2026-11-16') === '2026-11-23');
    ok('semanal a cada 2 semanas', proximaApos({ freq: 'semanal', intervalo: 2, diaSemana: 1 }, '2026-11-16') === '2026-11-30');
    var men = { freq: 'mensal', intervalo: 1, diaMes: 31, inicio: '2026-01-15' };
    ok('mensal: a primeira ocorrência é 31/01', primeiraOcorrencia(men) === '2026-01-31');
    ok('mensal: fevereiro usa o último dia e março volta ao 31', proximaApos(men, '2026-01-31') === '2026-02-28' && proximaApos(men, '2026-02-28') === '2026-03-31');
    ok('mensal: se o dia já passou, vai para o mês seguinte', primeiraOcorrencia({ freq: 'mensal', intervalo: 1, diaMes: 5, inicio: '2026-11-12' }) === '2026-12-05');
    ok('a cada N dias', proximaApos({ freq: 'dias', intervalo: 10 }, '2026-11-12') === '2026-11-22' && primeiraOcorrencia({ freq: 'dias', inicio: '2026-11-12' }) === '2026-11-12');
    ok('descrições em português', descreverRotina(sem) === 'Toda segunda' && descreverRotina({ freq: 'semanal', intervalo: 1, diaSemana: 6 }) === 'Todo sábado' && descreverRotina({ freq: 'mensal', intervalo: 2, diaMes: 5 }) === 'A cada 2 meses, dia 5' && descreverRotina({ freq: 'dias', intervalo: 1 }) === 'Todo dia');
    var s = novoEstado(); var q = criarQuadro(s, 'Rot', ['Ana', 'Bia']); var g = q.grupos[0];
    var rot = { id: 'r1', titulo: 'Conferir estoque', grupoId: g.id, freq: 'semanal', intervalo: 1, diaSemana: 1, inicio: '2026-11-02', antecedencia: 0, ativa: true, responsavel: 'Bia', subitens: ['Contar frascos', 'Contar MP'] };
    q.rotinas = [rot];
    ok('cria as ocorrências devidas (02/11 e 09/11)', gerarRotinas(s, '2026-11-12') === 2 && g.itens.length === 2);
    ok('a próxima fica em 16/11', rot.proxima === '2026-11-16');
    var cdt = null, cpe = null; q.colunas.forEach(function (c) { if (c.tipo === 'data') cdt = c; if (c.tipo === 'pessoa') cpe = c; });
    var datas = g.itens.map(function (i) { return i.valores[cdt.id]; }).sort();
    ok('o prazo é a data da ocorrência', datas[0] === '2026-11-02' && datas[1] === '2026-11-09');
    ok('responsável e subitens são copiados', g.itens[0].valores[cpe.id] === 'Bia' && g.itens[0].subitens.length === 2);
    ok('os itens nascem com o status inicial', g.itens[0].valores[q.colunas[0].id] === q.colunas[0].opcoes[0].id);
    ok('rodar de novo no mesmo dia não duplica', gerarRotinas(s, '2026-11-12') === 0 && g.itens.length === 2);
    ok('chegando 16/11 cria mais um e avança para 23/11', gerarRotinas(s, '2026-11-16') === 1 && g.itens.length === 3 && rot.proxima === '2026-11-23');
    rot.proxima = '2026-11-16';
    ok('a marca de cada item evita duplicar mesmo se a data voltar', gerarRotinas(s, '2026-11-16') === 0 && g.itens.length === 3);
    var s2 = novoEstado(); var q2 = criarQuadro(s2, 'Ant', ['Ana']);
    q2.rotinas = [{ id: 'r2', titulo: 'Fechar o mês', grupoId: q2.grupos[0].id, freq: 'mensal', intervalo: 1, diaMes: 20, inicio: '2026-11-01', antecedencia: 3, ativa: true, subitens: [] }];
    ok('antes da antecedência não cria', gerarRotinas(s2, '2026-11-16') === 0);
    ok('com 3 dias de antecedência cria em 17/11', gerarRotinas(s2, '2026-11-17') === 1);
    var cd2 = null; q2.colunas.forEach(function (c) { if (c.tipo === 'data') cd2 = c; });
    ok('o prazo continua sendo o dia 20', q2.grupos[0].itens[0].valores[cd2.id] === '2026-11-20');
    var s3 = novoEstado(); var q3 = criarQuadro(s3, 'Cap', ['Ana']);
    q3.rotinas = [{ id: 'r3', titulo: 'Diária', grupoId: q3.grupos[0].id, freq: 'dias', intervalo: 1, inicio: '2026-01-01', antecedencia: 0, ativa: true, subitens: [] }];
    ok('depois de muito tempo, só cria as 3 últimas', gerarRotinas(s3, '2026-11-12') === 3 && q3.grupos[0].itens.length === 3);
    q3.rotinas[0].ativa = false; q3.rotinas[0].proxima = '2026-11-13';
    ok('rotina pausada não gera', gerarRotinas(s3, '2026-11-20') === 0);
    q3.rotinas[0].ativa = true; q3.arquivado = true;
    ok('quadro arquivado não gera', gerarRotinas(s3, '2026-11-20') === 0);
    q3.arquivado = false;
    ok('reativar pula o atraso', proximaDesde({ freq: 'dias', intervalo: 7, inicio: '2026-11-01' }, '2026-11-12') === '2026-11-15');
    var s4 = novoEstado(); var q4 = criarQuadro(s4, 'SemGrupo', ['Ana']);
    q4.rotinas = [{ id: 'r4', titulo: 'Órfã', grupoId: 'inexistente', freq: 'dias', intervalo: 1, inicio: '2026-11-12', antecedencia: 0, ativa: true, subitens: [] }];
    ok('se o grupo foi apagado, cai no primeiro grupo', gerarRotinas(s4, '2026-11-12') === 1 && q4.grupos[0].itens.length === 1);
    MODELOS.forEach(function (m) {
      var sx = novoEstado(); var qx = criarDeModelo(sx, m, 'X', ['Ana']);
      var tiposOk = qx.colunas.every(function (c) { return !!TIPOS[c.tipo]; });
      var nItens = 0; qx.grupos.forEach(function (gx) { nItens += gx.itens.length; });
      var esperado = 0; (m.grupos || []).forEach(function (gm) { esperado += (gm.itens || []).length; });
      var idsUnicos = {}; var unico = true;
      qx.colunas.forEach(function (c) { if (idsUnicos[c.id]) unico = false; idsUnicos[c.id] = 1; });
      ok('modelo "' + m.nome + '": colunas válidas, ' + (m.grupos || []).length + ' grupos, ' + esperado + ' itens', tiposOk && unico && qx.grupos.length === (m.grupos || []).length && nItens === esperado);
    });
    var sl = novoEstado(); var ql = criarDeModelo(sl, MODELOS[1], 'Lanç', ['Ana']);
    ok('itens do modelo nascem com o status inicial', ql.grupos[0].itens[0].valores[ql.colunas[0].id] === ql.colunas[0].opcoes[0].id);
    var sc = novoEstado(); var qc = criarDeModelo(sc, MODELOS[2], 'Cont', ['Ana']);
    ok('modelo de conteúdo tem as colunas Formato, Canal e Link', ['Formato', 'Canal', 'Link'].every(function (n) { return qc.colunas.some(function (c) { return c.nome === n; }); }));
    ok('SISTEMA: estilos de rotinas injetados', !!$('qdr-css'));
    ok('SISTEMA: Modo Dia gera rotinas', typeof window.getModoDiaTasks !== 'function' || window.getModoDiaTasks._qdGer === true || window.getModoDiaTasks._qdx === true);
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS-ROTINAS: ' + r.length + ' testes, 0 falhas' : 'QUADROS-ROTINAS: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  window.QuadrosRotinasTeste = testeRotinas;
  ligarRotinas();
  envolverGeracao();
  /* ---------------- importar CSV e modelos do usuário (Fase 2C, parte 2) ---------------- */
  var CHAVE_MOD = 'quadros_modelos';
  var QTD_PRONTOS = MODELOS.length;
  var impDados = null;

  function normalizar(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

  /* --- modelos do usuário --- */
  function opcoesDeModelo(lista) {
    return lista.map(function (o, i) {
      if (typeof o === 'string') return { id: uid(), nome: o, cor: CORES[(i + 1) % CORES.length] };
      var x = { id: uid(), nome: o.nome, cor: o.cor || CORES[(i + 1) % CORES.length] };
      if (o.final) x.final = true;
      return x;
    });
  }
  function lerModelosUsuario() {
    var d = null;
    try { d = DB.get(CHAVE_MOD); } catch (e) { d = null; }
    return (d && !Array.isArray(d) && Array.isArray(d.modelos)) ? d.modelos : [];
  }
  function gravarModelosUsuario(lista) { DB.set(CHAVE_MOD, { versao: 1, modelos: lista }); }
  function sincronizarModelos() {
    MODELOS.length = QTD_PRONTOS;
    lerModelosUsuario().forEach(function (m) { MODELOS.push(m); });
  }
  function modeloDeQuadro(q, nome, incluirItens) {
    var grupos = q.grupos.filter(function (g) { return !g.arquivado; }).map(function (g) {
      return { nome: g.nome, itens: incluirItens ? g.itens.filter(function (i) { return !i.arquivado; }).map(function (i) { return i.nome; }) : [] };
    });
    if (!grupos.length) grupos = [{ nome: 'Grupo 1', itens: [] }];
    return {
      id: 'u' + uid(), nome: nome, usuario: true,
      desc: 'Seu modelo, criado a partir de "' + q.nome + '"' + (incluirItens ? ' (com itens)' : ''),
      colunas: q.colunas.map(function (c) {
        var r = { nome: c.nome, tipo: c.tipo };
        if (c.tipo === 'status') r.opcoes = (c.opcoes || []).map(function (o) { var x = { nome: o.nome, cor: o.cor }; if (o.final) x.final = true; return x; });
        else if (c.tipo === 'lista') r.opcoes = (c.opcoes || []).map(function (o) { return o.nome; });
        return r;
      }),
      grupos: grupos
    };
  }
  function htmlSecaoModelos() {
    sincronizarModelos();
    var q = quadroAtual();
    var meus = MODELOS.filter(function (m) { return m.usuario; });
    var h = '<div class="qdt-sec">Meus modelos</div>';
    if (!meus.length) h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Você ainda não salvou modelos.</div>';
    meus.forEach(function (m) {
      h += '<div class="qdr-row"><div class="info"><strong>' + esc(m.nome) + '</strong><div class="sub">' + esc(m.desc) + '</div></div><button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qr="mod-del" data-id="' + esc(m.id) + '">Excluir</button></div>';
    });
    if (q) {
      h += '<div class="qdt-sec">Salvar o quadro atual como modelo</div>' +
        '<input class="form-input" id="qdm-nome" placeholder="Nome do modelo" value="' + esc(q.nome) + '" style="margin-bottom:8px">' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:10px"><input type="checkbox" id="qdm-itens"> Incluir os itens atuais no modelo</label>' +
        '<button class="btn btn-secondary btn-sm" data-qr="mod-salvar">Salvar modelo</button>';
    }
    return h;
  }
  function salvarModeloDoModal() {
    var q = quadroAtual(); if (!q || !$('qdn-root')) return;
    var nome = ($('qdm-nome').value || '').trim();
    if (!nome) { aviso('Dê um nome ao modelo'); return; }
    var lista = lerModelosUsuario();
    lista.push(modeloDeQuadro(q, nome, !!$('qdm-itens').checked));
    gravarModelosUsuario(lista); sincronizarModelos();
    aviso('Modelo salvo'); abrirNovoQuadro();
  }
  function onModClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qr]') : null; if (!t) return;
    var acao = t.dataset.qr;
    if (acao === 'mod-salvar') salvarModeloDoModal();
    else if (acao === 'mod-del') {
      if (!$('qdn-root')) return;
      if (window.confirm('Excluir este modelo? Os quadros já criados com ele não mudam.')) {
        gravarModelosUsuario(lerModelosUsuario().filter(function (m) { return m.id !== t.dataset.id; }));
        sincronizarModelos(); abrirNovoQuadro();
      }
    }
  }

  /* --- leitura do CSV --- */
  function contarFora(s, d) {
    var n = 0, dentro = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '"') dentro = !dentro; else if (!dentro && ch === d) n++;
    }
    return n;
  }
  function parseCSV(texto) {
    texto = String(texto || '').replace(/^\uFEFF/, '');
    var primeira = texto.split(/\r?\n/)[0] || '';
    var delim = ';', melhor = -1;
    [';', ',', '\t'].forEach(function (d) { var n = contarFora(primeira, d); if (n > melhor) { melhor = n; delim = d; } });
    var linhas = [], linha = [], campo = '', dentro = false;
    for (var i = 0; i < texto.length; i++) {
      var c = texto.charAt(i);
      if (dentro) {
        if (c === '"') { if (texto.charAt(i + 1) === '"') { campo += '"'; i++; } else dentro = false; }
        else campo += c;
      } else if (c === '"') { dentro = true; }
      else if (c === delim) { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto.charAt(i + 1) === '\n') i++;
        linha.push(campo); campo = ''; linhas.push(linha); linha = [];
      } else { campo += c; }
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    linhas = linhas.filter(function (l) { return l.some(function (x) { return String(x).trim() !== ''; }); });
    return { delim: delim, linhas: linhas };
  }
  function dataValida(a, m, d) {
    a = +a; m = +m; d = +d;
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    var x = new Date(a, m - 1, d, 12, 0, 0);
    if (x.getFullYear() !== a || x.getMonth() !== m - 1 || x.getDate() !== d) return '';
    return isoDe(x);
  }
  function parseData(v) {
    v = String(v || '').trim(); if (!v) return '';
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
    if (m) return dataValida(m[1], m[2], m[3]);
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(v);
    if (m) { var a = +m[3]; if (a < 100) a += 2000; return dataValida(a, m[2], m[1]); }
    m = /^(\d{1,2})[\/\-.](\d{1,2})$/.exec(v);
    if (m) return dataValida(new Date().getFullYear(), m[2], m[1]);
    return '';
  }
  function opcaoPorNome(col, nome) {
    var n = normalizar(nome), r = null;
    (col.opcoes || []).forEach(function (o) { if (!r && normalizar(o.nome) === n) r = o; });
    return r;
  }
  function mapaAutomatico(q, cab) {
    var usados = {}; var nomeFeito = false, grupoFeito = false, descFeita = false;
    var sin = {
      status: ['status', 'situacao', 'andamento'],
      pessoa: ['responsavel', 'responsaveis', 'dono', 'pessoa', 'owner'],
      data: ['prazo', 'data', 'vencimento', 'entrega', 'data limite'],
      link: ['link', 'url', 'site']
    };
    var mapa = cab.map(function (h) {
      var n = normalizar(h);
      if (!n || n === 'quadro') return 'ignorar';
      if (!grupoFeito && (n === 'grupo' || n === 'fase')) { grupoFeito = true; return 'grupo'; }
      if (!nomeFeito && ['item', 'nome', 'titulo', 'tarefa', 'atividade'].indexOf(n) > -1) { nomeFeito = true; return 'nome'; }
      if (!descFeita && ['descricao', 'observacao', 'observacoes', 'notas', 'detalhes'].indexOf(n) > -1) { descFeita = true; return 'descricao'; }
      var alvo = null;
      q.colunas.forEach(function (c) { if (!alvo && !usados[c.id] && normalizar(c.nome) === n) alvo = c; });
      if (!alvo) q.colunas.forEach(function (c) { if (!alvo && !usados[c.id] && sin[c.tipo] && sin[c.tipo].indexOf(n) > -1) alvo = c; });
      if (alvo) { usados[alvo.id] = true; return 'c:' + alvo.id; }
      return 'novo';
    });
    if (mapa.indexOf('nome') < 0) {
      for (var i = 0; i < mapa.length; i++) {
        if ((mapa[i] === 'novo' || mapa[i] === 'ignorar') && normalizar(cab[i]) !== 'quadro') { mapa[i] = 'nome'; break; }
      }
    }
    return mapa;
  }
  function achaGrupoPorNome(s, q, nome) {
    var n = normalizar(nome), r = null;
    q.grupos.forEach(function (g) { if (!r && !g.arquivado && normalizar(g.nome) === n) r = g; });
    return r || criarGrupo(s, q, nome);
  }
  function aplicarValor(s, q, col, it, bruto, opts, res) {
    var v = String(bruto == null ? '' : bruto).trim();
    if (v === '') return;
    var n, o, u, d;
    switch (col.tipo) {
      case 'texto': it.valores[col.id] = v; break;
      case 'link': u = normalizarUrl(v); if (u) it.valores[col.id] = u; break;
      case 'numero': case 'moeda': n = parseNum(v); if (n !== null) it.valores[col.id] = n; break;
      case 'data': d = parseData(v); if (d) it.valores[col.id] = d; else res.datasInvalidas++; break;
      case 'check': it.valores[col.id] = /^(sim|s|true|1|x|ok|feito|yes)$/.test(normalizar(v)); break;
      case 'pessoa': if (opts.criarNovos) adicionarPessoa(s, q, v); it.valores[col.id] = v; break;
      case 'status': case 'lista':
        o = opcaoPorNome(col, v);
        if (!o && opts.criarNovos) {
          o = adicionarOpcao(s, q, col, v);
          if (col.tipo === 'status' && /^(conclu|feito|finaliz|entreg|pago|publicad)/.test(normalizar(v))) o.final = true;
          res.etiquetasNovas++;
        }
        if (o) it.valores[col.id] = o.id;
        break;
      default: break;
    }
  }
  function executarImportacao(s, q, linhas, mapaOrig, opts) {
    var res = { criados: 0, semNome: 0, datasInvalidas: 0, etiquetasNovas: 0, colunasNovas: 0, cortadas: 0 };
    var mapa = mapaOrig.slice();
    if (mapa.indexOf('nome') < 0) { res.erro = 'Escolha qual coluna da planilha é o nome do item.'; return res; }
    var cab = linhas[0];
    mapa = mapa.map(function (m, j) {
      if (m !== 'novo') return m;
      var col = adicionarColuna(s, q, String(cab[j] || '').trim() || 'Coluna ' + (j + 1), 'texto');
      res.colunasNovas++;
      return 'c:' + col.id;
    });
    var idxNome = mapa.indexOf('nome'), idxGrupo = mapa.indexOf('grupo');
    var gPadrao = null;
    function grupoPadrao() {
      if (gPadrao) return gPadrao;
      if (opts.grupoId) q.grupos.forEach(function (g) { if (g.id === opts.grupoId && !g.arquivado) gPadrao = g; });
      if (!gPadrao) gPadrao = achaGrupoPorNome(s, q, 'Importados');
      return gPadrao;
    }
    var dados = linhas.slice(1);
    if (dados.length > 1000) { res.cortadas = dados.length - 1000; dados = dados.slice(0, 1000); }
    dados.forEach(function (row) {
      var nome = String(row[idxNome] == null ? '' : row[idxNome]).trim();
      if (!nome) { res.semNome++; return; }
      var g = (idxGrupo >= 0 && String(row[idxGrupo] || '').trim()) ? achaGrupoPorNome(s, q, String(row[idxGrupo]).trim()) : grupoPadrao();
      var it = criarItem(s, q, g, nome);
      mapa.forEach(function (m, j) {
        if (m === 'descricao') { var t = String(row[j] == null ? '' : row[j]).trim(); if (t) it.descricao = t; return; }
        if (m.indexOf('c:') !== 0) return;
        var col = colunaPorId(q, m.slice(2));
        if (col) aplicarValor(s, q, col, it, row[j], opts, res);
      });
      res.criados++;
    });
    return res;
  }

  /* --- interface: importar --- */
  function corpoImportar1() {
    return '<div id="qdi-root"><p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Traga itens de uma planilha para este quadro. A primeira linha deve ter os nomes das colunas. Colunas com o mesmo nome das do quadro são reconhecidas sozinhas, e o CSV exportado pelo próprio sistema volta sem ajuste.</p>' +
      '<label class="form-label">Arquivo CSV</label><input class="form-input" type="file" id="qdi-arq" accept=".csv,.txt,text/csv" style="margin-bottom:12px">' +
      '<div class="qdt-sec" style="margin-top:6px">ou cole o conteúdo da planilha</div>' +
      '<textarea class="form-textarea" id="qdi-txt" rows="5" placeholder="Item;Status;Prazo&#10;Gravar reel;Em andamento;15/11/2026"></textarea>' +
      '<div class="qdr-linha" style="margin-top:10px"><button class="btn btn-primary" data-qi="ler">Ler dados</button></div></div>';
  }
  function opcoesMapa(q, atual) {
    return opcSel('ignorar', 'Ignorar', atual === 'ignorar') + opcSel('nome', 'Nome do item', atual === 'nome') +
      opcSel('descricao', 'Descrição do item', atual === 'descricao') + opcSel('grupo', 'Grupo', atual === 'grupo') +
      opcSel('novo', 'Nova coluna (texto)', atual === 'novo') +
      q.colunas.map(function (c) { return opcSel('c:' + c.id, c.nome + ' (' + (TIPOS[c.tipo] || TIPOS.texto).nome + ')', atual === 'c:' + c.id); }).join('');
  }
  function corpoImportar2(q) {
    var d = impDados; var cab = d.linhas[0]; var resto = d.linhas.slice(1);
    var nomeDelim = { ';': 'ponto e vírgula', ',': 'vírgula', '\t': 'tabulação' }[d.delim] || d.delim;
    var h = '<div id="qdi-root"><p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">' + resto.length + (resto.length === 1 ? ' linha encontrada' : ' linhas encontradas') + ' (separador: ' + nomeDelim + '). Confira o que cada coluna da planilha vira no quadro.</p>';
    h += '<table style="width:100%;font-size:12px"><thead><tr><th>Coluna da planilha</th><th>Exemplo</th><th>Vira</th></tr></thead><tbody>';
    cab.forEach(function (c, j) {
      var ex = '';
      for (var k = 0; k < resto.length; k++) { if (resto[k][j] && String(resto[k][j]).trim()) { ex = String(resto[k][j]).trim(); break; } }
      h += '<tr><td><strong>' + esc(c) + '</strong></td><td style="color:var(--text-muted)">' + esc(ex.slice(0, 40)) + '</td><td><select class="form-select qdi-map" data-j="' + j + '" style="width:auto;font-size:12px">' + opcoesMapa(q, d.mapa[j]) + '</select></td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="qdr-linha" style="margin-top:14px"><div><label class="form-label">Itens sem grupo na planilha vão para</label><select class="form-select" id="qdi-grupo"><option value="__novo__">Novo grupo "Importados"</option>' +
      q.grupos.filter(function (g) { return !g.arquivado; }).map(function (g) { return opcSel(g.id, g.nome, false); }).join('') + '</select></div></div>';
    h += '<label style="display:flex;align-items:center;gap:8px;font-size:12px;margin:6px 0 14px"><input type="checkbox" id="qdi-auto" checked> Criar etiquetas e pessoas que ainda não existem no quadro</label>';
    h += '<div class="qdr-linha"><button class="btn btn-primary" data-qi="importar">Importar ' + resto.length + (resto.length === 1 ? ' item' : ' itens') + '</button><button class="btn btn-secondary" data-qi="voltar">Voltar</button></div></div>';
    return h;
  }
  function abrirImportar() {
    var q = quadroAtual(); if (!q) return;
    impDados = null;
    openModal('Importar CSV \u00B7 ' + q.nome, corpoImportar1(), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', true);
  }
  function prepararImport(texto) {
    var q = quadroAtual(); if (!q) return;
    var p = parseCSV(texto);
    if (p.linhas.length < 2) { aviso('Não encontrei linhas de dados. A primeira linha deve ter os nomes das colunas.'); return; }
    impDados = { delim: p.delim, linhas: p.linhas, mapa: mapaAutomatico(q, p.linhas[0]) };
    openModal('Importar CSV \u00B7 ' + q.nome, corpoImportar2(q), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', true);
  }
  function lerArquivoImport(arq) {
    var r = new FileReader();
    r.onload = function () {
      var t = String(r.result || '');
      if (t.indexOf('\uFFFD') > -1) {
        var r2 = new FileReader();
        r2.onload = function () { prepararImport(String(r2.result || '')); };
        r2.readAsText(arq, 'windows-1252');
      } else { prepararImport(t); }
    };
    r.readAsText(arq);
  }
  function confirmarImportacao() {
    var q = quadroAtual(); if (!q || !impDados) return;
    var sel = $('qdi-grupo'), auto = $('qdi-auto');
    var opts = { grupoId: sel && sel.value !== '__novo__' ? sel.value : '', criarNovos: !!(auto && auto.checked) };
    var res = executarImportacao(Q, q, impDados.linhas, impDados.mapa, opts);
    if (res.erro) { aviso(res.erro); return; }
    impDados = null; salvar(); renderTudo(); closeModal();
    var msg = res.criados + (res.criados === 1 ? ' item importado' : ' itens importados');
    if (res.semNome) msg += ' \u00B7 ' + res.semNome + ' sem nome ignorada' + (res.semNome > 1 ? 's' : '');
    if (res.datasInvalidas) msg += ' \u00B7 ' + res.datasInvalidas + ' data' + (res.datasInvalidas > 1 ? 's' : '') + ' não reconhecida' + (res.datasInvalidas > 1 ? 's' : '');
    if (res.cortadas) msg += ' \u00B7 ' + res.cortadas + ' linhas além do limite de 1000 ficaram de fora';
    aviso(msg);
  }
  function onImpClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qi]') : null; if (!t || !$('qdi-root')) return;
    var acao = t.dataset.qi;
    if (acao === 'ler') { var tx = $('qdi-txt'); prepararImport(tx ? tx.value : ''); }
    else if (acao === 'voltar') abrirImportar();
    else if (acao === 'importar') confirmarImportacao();
  }
  function onImpChange(e) {
    var el = e.target; if (!el) return;
    if (el.id === 'qdi-arq') { if (el.files && el.files[0]) lerArquivoImport(el.files[0]); return; }
    if (el.classList && el.classList.contains('qdi-map') && impDados) impDados.mapa[parseInt(el.dataset.j, 10)] = el.value;
  }
  function ligarImportModelos() {
    sincronizarModelos();
    var c = $('content');
    c.addEventListener('click', function (e) {
      if (!ativo()) return;
      var t = e.target.closest ? e.target.closest('[data-qd="importar"]') : null;
      if (t) abrirImportar();
    });
    var mb = $('modalBody');
    if (mb) { mb.addEventListener('click', onImpClick); mb.addEventListener('change', onImpChange); mb.addEventListener('click', onModClick); }
    var rn = window.renderNav;
    if (typeof rn === 'function' && !rn._qdMod) {
      var novo = function () { try { sincronizarModelos(); } catch (e) { /* ignorar */ } return rn.apply(this, arguments); };
      novo._qdMod = true; window.renderNav = novo;
    }
  }

  function testeImport() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var p = parseCSV('\uFEFFItem;Status;Prazo\r\nGravar reel;Em andamento;15/11/2026\n\nPostar;"Em; revisão";\n');
    ok('detecta o ponto e vírgula, ignora o BOM e as linhas vazias', p.delim === ';' && p.linhas.length === 3 && p.linhas[0][0] === 'Item');
    ok('respeita aspas com o separador dentro', p.linhas[2][1] === 'Em; revisão');
    ok('mantém o campo vazio no fim da linha', p.linhas[2].length === 3 && p.linhas[2][2] === '');
    var p2 = parseCSV('a,b\n1,"linha 1\nlinha 2"\n2,"diz ""oi"""');
    ok('detecta vírgula, quebra de linha entre aspas e aspas duplas', p2.delim === ',' && p2.linhas[1][1] === 'linha 1\nlinha 2' && p2.linhas[2][1] === 'diz "oi"');
    ok('detecta tabulação', parseCSV('a\tb\n1\t2').delim === '\t');
    ok('data dd/mm/aaaa', parseData('12/11/2026') === '2026-11-12');
    ok('data dd/mm/aa', parseData('12/11/26') === '2026-11-12');
    ok('data aaaa-mm-dd e com hora', parseData('2026-11-12') === '2026-11-12' && parseData('2026-11-12T10:00:00') === '2026-11-12');
    ok('data com hífen e ponto', parseData('12-11-2026') === '2026-11-12' && parseData('12.11.2026') === '2026-11-12');
    ok('data dd/mm usa o ano atual', parseData('12/11') === new Date().getFullYear() + '-11-12');
    ok('data inválida é recusada', parseData('31/02/2026') === '' && parseData('abc') === '' && parseData('') === '');
    ok('normalizar tira acento e caixa', normalizar('  Responsável ') === 'responsavel');
    var s = novoEstado(); var q = criarQuadro(s, 'Origem', ['Ana', 'Bia']); var g = q.grupos[0]; g.nome = 'Semana 1';
    var g2 = criarGrupo(s, q, 'Semana 2');
    var cSt = q.colunas[0], cPe = q.colunas[2], cDt = q.colunas[3];
    var chk = adicionarColuna(s, q, 'Pago', 'check'); var mo = adicionarColuna(s, q, 'Valor', 'moeda');
    var a = criarItem(s, q, g, 'Gravar reel');
    setValor(s, a, cSt.id, cSt.opcoes[1].id); setValor(s, a, cDt.id, '2026-11-15'); setValor(s, a, cPe.id, 'Bia'); setValor(s, a, chk.id, true); setValor(s, a, mo.id, 1240.5);
    var b = criarItem(s, q, g2, 'Postar'); setValor(s, b, cSt.id, cSt.opcoes[4].id);
    var parsed = parseCSV(gerarCSV(q));
    var q2 = criarQuadro(s, 'Destino', ['Ana']);
    adicionarColuna(s, q2, 'Pago', 'check'); adicionarColuna(s, q2, 'Valor', 'moeda');
    var mapa = mapaAutomatico(q2, parsed.linhas[0]);
    ok('o CSV exportado pelo sistema é reconhecido sem ajuste', mapa[0] === 'ignorar' && mapa[1] === 'grupo' && mapa[2] === 'nome' && mapa.slice(3).every(function (m) { return m.indexOf('c:') === 0; }));
    var res = executarImportacao(s, q2, parsed.linhas, mapa, { grupoId: '', criarNovos: true });
    ok('importa os 2 itens e cria os grupos da planilha', res.criados === 2 && q2.grupos.some(function (x) { return x.nome === 'Semana 1'; }) && q2.grupos.some(function (x) { return x.nome === 'Semana 2'; }));
    var ia = null, ib = null;
    q2.grupos.forEach(function (x) { x.itens.forEach(function (i) { if (i.nome === 'Gravar reel') ia = i; if (i.nome === 'Postar') ib = i; }); });
    var cSt2 = q2.colunas[0], cPe2 = q2.colunas[2], cDt2 = q2.colunas[3], chk2 = q2.colunas[4], mo2 = q2.colunas[5];
    ok('status, data, pessoa, check e moeda voltam iguais', ia.valores[cSt2.id] === cSt2.opcoes[1].id && ia.valores[cDt2.id] === '2026-11-15' && ia.valores[cPe2.id] === 'Bia' && ia.valores[chk2.id] === true && ia.valores[mo2.id] === 1240.5);
    ok('o status concluído também volta', ib.valores[cSt2.id] === cSt2.opcoes[4].id);
    ok('pessoa nova é adicionada ao quadro', q2.pessoas.indexOf('Bia') > -1);
    var s3 = novoEstado(); var q3 = criarQuadro(s3, 'Etiq', ['Ana']); var cs3 = q3.colunas[0];
    var r3 = executarImportacao(s3, q3, [['Item', 'Status'], ['X', 'Publicado']], ['nome', 'c:' + cs3.id], { grupoId: '', criarNovos: true });
    var nova = null; cs3.opcoes.forEach(function (o) { if (o.nome === 'Publicado') nova = o; });
    ok('status desconhecido vira etiqueta nova marcada como concluído', r3.etiquetasNovas === 1 && !!nova && nova.final === true);
    var s4 = novoEstado(); var q4 = criarQuadro(s4, 'SemAuto', ['Ana']); var cs4 = q4.colunas[0]; var antes = cs4.opcoes.length;
    executarImportacao(s4, q4, [['Item', 'Status'], ['X', 'Publicado']], ['nome', 'c:' + cs4.id], { grupoId: '', criarNovos: false });
    ok('sem criar novos, o status fica no inicial e nenhuma etiqueta nasce', cs4.opcoes.length === antes && q4.grupos[0].itens.length === 0 && q4.grupos.some(function (x) { return x.nome === 'Importados' && x.itens[0].valores[cs4.id] === cs4.opcoes[0].id; }));
    var s5 = novoEstado(); var q5 = criarQuadro(s5, 'Dest', ['Ana']); var gid = q5.grupos[0].id;
    executarImportacao(s5, q5, [['Item'], ['A'], ['B']], ['nome'], { grupoId: gid, criarNovos: true });
    ok('usa o grupo escolhido quando a planilha não tem grupo', q5.grupos.length === 1 && q5.grupos[0].itens.length === 2);
    var s6 = novoEstado(); var q6 = criarQuadro(s6, 'Novo', ['Ana']); var n0 = q6.colunas.length;
    var r6 = executarImportacao(s6, q6, [['Item', 'Observação'], ['A', 'texto livre']], ['nome', 'novo'], { grupoId: '', criarNovos: true });
    var cob = q6.colunas[q6.colunas.length - 1];
    ok('coluna nova de texto é criada com o nome da planilha', r6.colunasNovas === 1 && q6.colunas.length === n0 + 1 && cob.nome === 'Observação' && cob.tipo === 'texto');
    var s7 = novoEstado(); var q7 = criarQuadro(s7, 'Mix', ['Ana']); var cd7 = q7.colunas[3];
    var r7 = executarImportacao(s7, q7, [['Item', 'Prazo'], ['', '12/11/2026'], ['B', '31/02/2026'], ['C', '12/11/2026']], ['nome', 'c:' + cd7.id], { grupoId: '', criarNovos: true });
    ok('linhas sem nome são ignoradas e datas inválidas contadas', r7.criados === 2 && r7.semNome === 1 && r7.datasInvalidas === 1);
    ok('sem coluna de nome, avisa em vez de importar', !!executarImportacao(s7, q7, [['X'], ['1']], ['ignorar'], { grupoId: '', criarNovos: true }).erro);
    ok('se nenhuma coluna parece nome, a primeira vira o nome', mapaAutomatico(q7, ['Ação', 'Prazo'])[0] === 'nome' && mapaAutomatico(q7, ['Ação', 'Prazo'])[1] === 'c:' + cd7.id);
    ok('Descrição vira a descrição do item', (function () {
      var sd = novoEstado(); var qd = criarQuadro(sd, 'D', ['Ana']);
      executarImportacao(sd, qd, [['Item', 'Descrição'], ['A', 'Contexto longo']], ['nome', 'descricao'], { grupoId: '', criarNovos: true });
      return qd.grupos.some(function (x) { return x.itens.some(function (i) { return i.descricao === 'Contexto longo'; }); });
    })());
    ok('limite de 1000 linhas', (function () {
      var sl = novoEstado(); var ql = criarQuadro(sl, 'L', ['Ana']); var linhas = [['Item']];
      for (var i = 0; i < 1005; i++) linhas.push(['I' + i]);
      var rl = executarImportacao(sl, ql, linhas, ['nome'], { grupoId: '', criarNovos: true });
      return rl.criados === 1000 && rl.cortadas === 5;
    })());
    var sm = novoEstado(); var qm = criarDeModelo(sm, MODELOS[1], 'Base', ['Ana']);
    qm.colunas[0].opcoes.push({ id: 'x', nome: 'Aprovado', cor: '#112233', final: true });
    var mod = modeloDeQuadro(qm, 'Meu', true);
    ok('modelo do usuário guarda colunas, grupos e itens', mod.usuario === true && mod.colunas.length === qm.colunas.length && mod.grupos.length === qm.grupos.length && mod.grupos[0].itens.length === qm.grupos[0].itens.length);
    var qn = criarDeModelo(novoEstado(), mod, 'Novo', ['Ana']);
    var apr = null; qn.colunas[0].opcoes.forEach(function (o) { if (o.nome === 'Aprovado') apr = o; });
    ok('o quadro criado do modelo mantém a etiqueta personalizada e a marca de concluído', !!apr && apr.final === true && apr.cor === '#112233');
    ok('modelo sem itens não leva itens', modeloDeQuadro(qm, 'Meu', false).grupos.every(function (x) { return x.itens.length === 0; }));
    ok('o quadro novo não reaproveita ids do original', qn.id !== qm.id && qn.colunas[0].id !== qm.colunas[0].id);
    ok('modelo de quadro sem grupos ativos ganha um grupo', (function () { var sq = novoEstado(); var qq = criarQuadro(sq, 'V', ['Ana']); qq.grupos[0].arquivado = true; return modeloDeQuadro(qq, 'M', false).grupos.length === 1; })());
    ok('modelo guarda listas só com os nomes', (function () { var lc = modeloDeQuadro(criarDeModelo(novoEstado(), MODELOS[2], 'C', ['Ana']), 'M', false).colunas.filter(function (c) { return c.tipo === 'lista'; })[0]; return typeof lc.opcoes[0] === 'string'; })());
    ok('os modelos prontos continuam no início da lista', MODELOS.length >= QTD_PRONTOS && MODELOS[0].id === 'branco');
    ok('SISTEMA: importar disponível', typeof abrirImportar === 'function');
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS-IMPORT: ' + r.length + ' testes, 0 falhas' : 'QUADROS-IMPORT: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  window.QuadrosImportTeste = testeImport;
  ligarImportModelos();
  /* ---------------- vínculos, automações, linha do tempo e painel (Fases 2D e 3) ---------------- */
  var vinTab = 'fornecedor';
  var tlOff = 0;
  var MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  TIPOS.vinculo = { nome: 'Vínculo com o sistema', w: '180px' };

  function diasEntre(a, b) { return Math.round((dataDe(b) - dataDe(a)) / 86400000); }
  function inicioDaSemana(iso) { var d = dataDe(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDe(d); }
  function colStatusDe(q) { var c = null; q.colunas.forEach(function (x) { if (!c && x.tipo === 'status') c = x; }); return c; }
  function colPessoaDe(q) { var c = null; q.colunas.forEach(function (x) { if (!c && x.tipo === 'pessoa') c = x; }); return c; }

  /* --- 2D: vínculos --- */
  var FONTES_VIN = {
    fornecedor: { nome: 'Fornecedor', plural: 'Fornecedores', chave: 'suppliers' },
    pedido: { nome: 'Pedido', plural: 'Pedidos', chave: 'pedidos' },
    produto: { nome: 'Produto', plural: 'Produtos', chave: 'products' },
    formula: { nome: 'Fórmula', plural: 'Fórmulas', chave: 'formulas' }
  };
  var ORDEM_VIN = ['fornecedor', 'pedido', 'produto', 'formula'];
  var cacheFonte = { t: 0, d: {} };
  function lerFonte(tipo) {
    var f = FONTES_VIN[tipo]; if (!f) return [];
    var agora = Date.now();
    if (agora - cacheFonte.t > 1500) cacheFonte = { t: agora, d: {} };
    if (!cacheFonte.d[tipo]) {
      var l = null;
      try { l = DB.get(f.chave); } catch (e) { l = null; }
      cacheFonte.d[tipo] = Array.isArray(l) ? l : [];
    }
    return cacheFonte.d[tipo];
  }
  function rotuloVinculo(tipo, r) {
    if (tipo === 'pedido') return '#' + (r.numero || '?') + (r.cliente ? ' ' + r.cliente : '');
    return r.name || r.nome || '(sem nome)';
  }
  function subVinculo(tipo, r) {
    if (tipo === 'fornecedor') return r.phone || r.email || '';
    if (tipo === 'pedido') return (r.total != null ? fmtMoeda(r.total) : '') + (r.status ? ' \u00B7 ' + r.status : '');
    if (tipo === 'produto') return [r.line, r.type].filter(Boolean).join(' \u00B7 ');
    return r.productType || '';
  }
  function resolverVinculo(ref, leitor) {
    var lista = (leitor || lerFonte)(ref.tipo); var r = null;
    lista.forEach(function (x) { if (x && x.id === ref.id) r = x; });
    if (!r) return { removido: true, rotulo: '(removido)' };
    return { removido: false, rotulo: rotuloVinculo(ref.tipo, r), registro: r };
  }
  function definirVinculo(it, colId, tipo, reg) {
    it.valores[colId] = rotuloVinculo(tipo, reg);
    if (!it.vinculos) it.vinculos = {};
    it.vinculos[colId] = { tipo: tipo, id: reg.id };
  }
  function limparVinculo(it, colId) {
    delete it.valores[colId];
    if (it.vinculos) delete it.vinculos[colId];
  }
  function htmlVinculo(it, c, v, leitor) {
    var ref = it.vinculos ? it.vinculos[c.id] : null;
    var base = 'data-i="' + esc(it.id) + '" data-col="' + esc(c.id) + '"';
    if (!v) return '<div class="qd-pill vazio" data-qd="vin-sel" ' + base + '>+ vincular</div>';
    var r = (ref && FONTES_VIN[ref.tipo]) ? resolverVinculo(ref, leitor) : null;
    var rot = (r && !r.removido) ? r.rotulo : v;
    var abre = !!(r && !r.removido);
    return '<span class="qd-vin' + (r && r.removido ? ' removido' : '') + '"' + (abre ? ' data-qd="vin-ir" ' + base + ' title="Abrir ' + esc(FONTES_VIN[ref.tipo].nome) + '"' : '') + '>' +
      (ref && FONTES_VIN[ref.tipo] ? '<small>' + esc(FONTES_VIN[ref.tipo].nome) + '</small>' : '') + esc(rot) + '</span>' +
      '<button class="qd-ic" data-qd="vin-sel" ' + base + ' aria-label="Alterar vínculo">&#8943;</button>';
  }
  function listaVinculos(busca) {
    var n = normalizar(busca); var lista = lerFonte(vinTab);
    var itens = lista.filter(function (r) { return !n || normalizar(rotuloVinculo(vinTab, r) + ' ' + subVinculo(vinTab, r)).indexOf(n) > -1; }).slice(0, 40);
    if (!itens.length) return '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">' + (lista.length ? 'Nada encontrado.' : 'Nenhum registro em ' + FONTES_VIN[vinTab].plural + ' ainda.') + '</div>';
    return itens.map(function (r) {
      return '<div class="qdr-row" style="cursor:pointer" data-qv="pick" data-id="' + esc(r.id) + '"><div class="info"><strong>' + esc(rotuloVinculo(vinTab, r)) + '</strong><div class="sub">' + esc(subVinculo(vinTab, r)) + '</div></div></div>';
    }).join('');
  }
  function corpoVinculo(itemId, colId) {
    var a = achar(Q, itemId); var ref = a && a.it.vinculos ? a.it.vinculos[colId] : null;
    var h = '<div id="qdv-root" data-item="' + esc(itemId) + '" data-col="' + esc(colId) + '"><div class="qdr-linha" style="gap:6px">';
    ORDEM_VIN.forEach(function (t) {
      h += '<button class="btn ' + (t === vinTab ? 'btn-primary' : 'btn-secondary') + ' btn-sm" style="flex:0 0 auto" data-qv="tab" data-tipo="' + t + '">' + FONTES_VIN[t].plural + '</button>';
    });
    h += '</div><input class="form-input" id="qdv-busca" placeholder="Buscar..." style="margin-bottom:10px"><div id="qdv-lista">' + listaVinculos('') + '</div>';
    if (ref) h += '<div class="qdr-linha" style="margin-top:12px"><button class="btn btn-ghost" style="color:var(--rosa-antigo);flex:0 0 auto" data-qv="limpar">Remover vínculo</button></div>';
    return h + '</div>';
  }
  function abrirVinculo(itemId, colId) {
    var a = achar(Q, itemId); if (!a || !colunaPorId(a.q, colId)) return;
    openModal('Vincular \u00B7 ' + a.it.nome, corpoVinculo(itemId, colId), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', false);
    setTimeout(function () { var b = $('qdv-busca'); if (b) b.focus(); }, 50);
  }
  function abrirRegistro(ref) {
    try {
      if (ref.tipo === 'fornecedor' && typeof openSupModal === 'function') { go('suppliers'); openSupModal(ref.id); }
      else if (ref.tipo === 'pedido' && typeof viewPedido === 'function') { go('pedidos'); viewPedido(ref.id); }
      else if (ref.tipo === 'produto' && typeof openProdModal === 'function') { go('products'); openProdModal(ref.id); }
      else if (ref.tipo === 'formula' && typeof viewFormula === 'function') { go('formulas'); viewFormula(ref.id); }
    } catch (e) { console.error('quadros: abrir registro', e); aviso('Não foi possível abrir o registro'); }
  }
  function onVinClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qv]') : null; if (!t) return;
    var raiz = $('qdv-root'); if (!raiz) return;
    var a = achar(Q, raiz.dataset.item); if (!a) return;
    var colId = raiz.dataset.col;
    if (t.dataset.qv === 'tab') { vinTab = t.dataset.tipo; abrirVinculo(raiz.dataset.item, colId); }
    else if (t.dataset.qv === 'pick') {
      var reg = null; lerFonte(vinTab).forEach(function (r) { if (r.id === t.dataset.id) reg = r; });
      if (reg) { definirVinculo(a.it, colId, vinTab, reg); salvar(); renderTudo(); closeModal(); }
    } else if (t.dataset.qv === 'limpar') { limparVinculo(a.it, colId); salvar(); renderTudo(); closeModal(); }
  }
  function onVinInput(e) {
    var el = e.target;
    if (el && el.id === 'qdv-busca' && $('qdv-root')) { var l = $('qdv-lista'); if (l) l.innerHTML = listaVinculos(el.value); }
  }

  /* --- 3: automações (disparam quando o status de um item muda) --- */
  function executarAcao(est, q, g, it, a, hoje) {
    var dest = null, col = null;
    if (a.tipo === 'mover') {
      q.grupos.forEach(function (x) { if (x.id === a.grupoId && !x.arquivado) dest = x; });
      if (!dest || dest.id === g.id) return false;
      return !!moverItem(est, it.id, dest.id, null);
    }
    if (a.tipo === 'definir') {
      col = colunaPorId(q, a.colId);
      if (!col || !opcaoPorId(col, a.opcaoId) || it.valores[col.id] === a.opcaoId) return false;
      it.valores[col.id] = a.opcaoId; return true;
    }
    if (a.tipo === 'atribuir') {
      col = colPessoaDe(q);
      if (!col || !a.pessoa) return false;
      it.valores[col.id] = a.pessoa;
      if (q.pessoas.indexOf(a.pessoa) < 0) q.pessoas.push(a.pessoa);
      return true;
    }
    if (a.tipo === 'data') {
      col = colunaPorId(q, a.colId);
      if (!col || col.tipo !== 'data') return false;
      it.valores[col.id] = hoje; return true;
    }
    if (a.tipo === 'criar') {
      q.grupos.forEach(function (x) { if (x.id === a.grupoId && !x.arquivado) dest = x; });
      var titulo = String(a.titulo || '').replace(/\{nome\}/g, it.nome).trim();
      if (!dest || !titulo) return false;
      var novo = criarItem(est, q, dest, titulo);
      var cp = colPessoaDe(q);
      if (a.copiarResp && cp && it.valores[cp.id]) novo.valores[cp.id] = it.valores[cp.id];
      var cs2 = colStatusDe(q);
      novo._ult = (cs2 && novo.valores[cs2.id] !== undefined) ? novo.valores[cs2.id] : null;
      return true;
    }
    return false;
  }
  function aplicarAutomacoes(est, hoje) {
    var n = 0;
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      var cs = colStatusDe(q); if (!cs) return;
      var regras = (q.automacoes || []).filter(function (r) { return r.ativa && r.quando && r.acao; });
      q.grupos.forEach(function (g) {
        g.itens.slice().forEach(function (it) {
          if (it.arquivado) return;
          var atual = it.valores[cs.id];
          if (it._ult === undefined || (it._ult !== null && !opcaoPorId(cs, it._ult))) { it._ult = atual === undefined ? null : atual; return; }
          var anterior = it._ult === null ? undefined : it._ult;
          if (atual === anterior) return;
          regras.forEach(function (r) {
            if (r.quando.opcaoId === atual && executarAcao(est, q, g, it, r.acao, hoje)) n++;
          });
          var depois = it.valores[cs.id];
          it._ult = depois === undefined ? null : depois;
          var op = opcaoPorId(cs, depois);
          if (op && op.final) { if (!it._conclEm) it._conclEm = hoje; } else { delete it._conclEm; }
        });
      });
    });
    return n;
  }
  function instalarAutomacoes() {
    if (DB.set._qdAut) return;
    var orig = DB.set;
    var novo = function (k, d) {
      var n = 0;
      if (k === CHAVE && d && !Array.isArray(d) && Array.isArray(d.quadros)) {
        try { n = aplicarAutomacoes(d, hojeISO()); } catch (e) { console.error('quadros: automações', e); }
      }
      var r = orig.apply(DB, arguments);
      if (n > 0) setTimeout(function () { aviso(n + (n === 1 ? ' automação aplicada' : ' automações aplicadas')); if (ativo()) renderTudo(); }, 0);
      return r;
    };
    novo._qdAut = true; DB.set = novo;
  }
  function descreverAutomacao(q, r) {
    var cs = colStatusDe(q); var o = cs ? opcaoPorId(cs, r.quando.opcaoId) : null;
    var a = r.acao; var txt = '';
    function grupo(id) { var g = null; q.grupos.forEach(function (x) { if (x.id === id) g = x; }); return g ? g.nome : '?'; }
    if (a.tipo === 'mover') txt = 'mover o item para \u201C' + grupo(a.grupoId) + '\u201D';
    else if (a.tipo === 'definir') { var col = colunaPorId(q, a.colId); var op = col ? opcaoPorId(col, a.opcaoId) : null; txt = 'definir ' + (col ? col.nome : '?') + ' como \u201C' + (op ? op.nome : '?') + '\u201D'; }
    else if (a.tipo === 'atribuir') txt = 'atribuir a ' + (a.pessoa || '?');
    else if (a.tipo === 'data') { var cd = colunaPorId(q, a.colId); txt = 'registrar a data de hoje em ' + (cd ? cd.nome : '?'); }
    else if (a.tipo === 'criar') txt = 'criar o item \u201C' + (a.titulo || '') + '\u201D em \u201C' + grupo(a.grupoId) + '\u201D' + (a.copiarResp ? ' (mesmo responsável)' : '');
    return 'Quando o status virar \u201C' + (o ? o.nome : '?') + '\u201D, ' + txt;
  }
  function corpoAutomacoes(q) {
    var cs = colStatusDe(q);
    if (!cs) return '<div id="qda-root"><p style="font-size:13px;color:var(--text-muted)">As automações usam a coluna de Status. Crie uma coluna do tipo Status em "Colunas".</p></div>';
    var lista = q.automacoes || [];
    var grupos = q.grupos.filter(function (g) { return !g.arquivado; }).map(function (g) { return opcSel(g.id, g.nome, false); }).join('');
    var h = '<div id="qda-root"><p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Automações agem sozinhas quando o status de um item muda. Uma automação não dispara outra, para evitar ciclos.</p>';
    if (!lista.length) h += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;background:var(--bg-warm);border-radius:var(--radius-md);margin-bottom:8px">Nenhuma automação ainda.</div>';
    lista.forEach(function (r) {
      h += '<div class="qdr-row"><input type="checkbox" class="qda-ativa" data-id="' + esc(r.id) + '"' + (r.ativa ? ' checked' : '') + ' title="Ativa"><div class="info"><strong>' + esc(descreverAutomacao(q, r)) + '</strong></div><button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qa="aut-del" data-id="' + esc(r.id) + '">Excluir</button></div>';
    });
    h += '<div class="qdt-sec">Nova automação</div>';
    h += '<div class="qdr-linha"><div><label class="form-label">Quando o status virar</label><select class="form-select" id="qda-quando">' + cs.opcoes.map(function (o) { return opcSel(o.id, o.nome, false); }).join('') + '</select></div>' +
      '<div><label class="form-label">Então</label><select class="form-select" id="qda-acao">' + opcSel('mover', 'Mover para um grupo', true) + opcSel('definir', 'Definir uma coluna (lista ou status)', false) + opcSel('atribuir', 'Atribuir a uma pessoa', false) + opcSel('data', 'Registrar a data de hoje', false) + opcSel('criar', 'Criar um novo item', false) + '</select></div></div>';
    h += '<div id="qda-box-mover" class="qdr-linha"><div><label class="form-label">Grupo de destino</label><select class="form-select" id="qda-grupo">' + grupos + '</select></div></div>';
    h += '<div id="qda-box-definir" class="qdr-linha"><div><label class="form-label">Coluna</label><select class="form-select" id="qda-col">' + q.colunas.filter(function (c) { return !!c.opcoes; }).map(function (c) { return opcSel(c.id, c.nome, false); }).join('') + '</select></div><div><label class="form-label">Valor</label><select class="form-select" id="qda-opc"></select></div></div>';
    h += '<div id="qda-box-atribuir" class="qdr-linha"><div><label class="form-label">Pessoa</label><select class="form-select" id="qda-pessoa">' + (q.pessoas || []).map(function (p) { return opcSel(p, p, false); }).join('') + '</select></div></div>';
    h += '<div id="qda-box-data" class="qdr-linha"><div><label class="form-label">Coluna de data</label><select class="form-select" id="qda-cdata">' + q.colunas.filter(function (c) { return c.tipo === 'data'; }).map(function (c) { return opcSel(c.id, c.nome, false); }).join('') + '</select></div></div>';
    h += '<div id="qda-box-criar" class="qdr-linha"><div><label class="form-label">Grupo do novo item</label><select class="form-select" id="qda-grupo2">' + grupos + '</select></div><div style="flex:2"><label class="form-label">Título (use {nome} para o nome do item)</label><input class="form-input" id="qda-titulo" placeholder="Ex.: Publicar: {nome}"></div><label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:0 0 100%"><input type="checkbox" id="qda-copiar" checked> Manter o mesmo responsável</label></div>';
    h += '<div class="qdr-linha"><button class="btn btn-primary" style="flex:0 0 auto" data-qa="aut-salvar">Salvar automação</button></div></div>';
    return h;
  }
  function ajustarFormAutomacao() {
    var q = quadroAtual(); var acao = $('qda-acao'); if (!q || !acao) return;
    ['mover', 'definir', 'atribuir', 'data', 'criar'].forEach(function (t) { var b = $('qda-box-' + t); if (b) b.style.display = acao.value === t ? '' : 'none'; });
    var cs = $('qda-col'), os = $('qda-opc');
    if (cs && os) {
      var col = colunaPorId(q, cs.value);
      os.innerHTML = col ? (col.opcoes || []).map(function (o) { return opcSel(o.id, o.nome, false); }).join('') : '';
    }
  }
  function abrirAutomacoes() {
    var q = quadroAtual(); if (!q) return;
    openModal('Automações \u00B7 ' + q.nome, corpoAutomacoes(q), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', true);
    ajustarFormAutomacao();
  }
  function salvarAutomacaoDoModal() {
    var q = quadroAtual(); if (!q || !$('qda-root')) return;
    var tipo = $('qda-acao').value; var quando = $('qda-quando').value;
    var a = { tipo: tipo };
    if (tipo === 'mover') { a.grupoId = $('qda-grupo').value; if (!a.grupoId) { aviso('Escolha o grupo de destino'); return; } }
    else if (tipo === 'definir') { a.colId = $('qda-col').value; a.opcaoId = $('qda-opc').value; if (!a.colId || !a.opcaoId) { aviso('Escolha a coluna e o valor'); return; } }
    else if (tipo === 'atribuir') { a.pessoa = $('qda-pessoa').value; if (!a.pessoa) { aviso('Escolha a pessoa'); return; } }
    else if (tipo === 'data') { a.colId = $('qda-cdata').value; if (!a.colId) { aviso('Crie uma coluna de data primeiro'); return; } }
    else if (tipo === 'criar') {
      a.grupoId = $('qda-grupo2').value; a.titulo = $('qda-titulo').value.trim(); a.copiarResp = !!$('qda-copiar').checked;
      if (!a.grupoId || !a.titulo) { aviso('Informe o grupo e o título do novo item'); return; }
    }
    if (!q.automacoes) q.automacoes = [];
    q.automacoes.push({ id: uid(), ativa: true, quando: { opcaoId: quando }, acao: a });
    salvar(); abrirAutomacoes(); aviso('Automação salva');
  }
  function onAutClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qa]') : null; if (!t || !$('qda-root')) return;
    var q = quadroAtual(); if (!q) return;
    if (t.dataset.qa === 'aut-salvar') salvarAutomacaoDoModal();
    else if (t.dataset.qa === 'aut-del') {
      if (window.confirm('Excluir esta automação?')) {
        q.automacoes = (q.automacoes || []).filter(function (r) { return r.id !== t.dataset.id; });
        salvar(); abrirAutomacoes();
      }
    }
  }
  function onAutChange(e) {
    var el = e.target; if (!el || !$('qda-root')) return;
    if (el.id === 'qda-acao' || el.id === 'qda-col') { ajustarFormAutomacao(); return; }
    if (el.classList && el.classList.contains('qda-ativa')) {
      var q = quadroAtual(); if (!q) return;
      (q.automacoes || []).forEach(function (r) { if (r.id === el.dataset.id) r.ativa = el.checked; });
      salvar(); abrirAutomacoes();
    }
  }

  /* --- 3: linha do tempo --- */
  function htmlLinhaTempo(s, q, hojeParam) {
    var hoje = hojeParam || hojeISO();
    var cols = q.colunas.filter(function (c) { return c.tipo === 'data'; });
    if (!cols.length) return '<div class="empty-state"><h3>Linha do tempo indisponível</h3><p>Crie uma coluna do tipo Data em "Colunas" para posicionar os itens no calendário.</p></div>';
    var DIAS = 56, LARG = 22, LABEL = 230;
    var ini = somarDias(inicioDaSemana(hoje), -14 + tlOff), fim = somarDias(ini, DIAS - 1);
    var cs = colStatusDe(q); var larguraArea = DIAS * LARG;
    var cab = '<div class="qdl-row qdl-head"><div class="qdl-lab"></div><div class="qdl-area" style="width:' + larguraArea + 'px">';
    for (var i = 0; i < DIAS; i++) {
      var di = somarDias(ini, i); var dd = dataDe(di); var dow = dd.getDay();
      var mostraMes = dd.getDate() === 1 || i === 0;
      cab += '<div class="qdl-dia' + ((dow === 0 || dow === 6) ? ' fim' : '') + (di === hoje ? ' hoje' : '') + '" style="left:' + (i * LARG) + 'px;width:' + LARG + 'px">' + (mostraMes ? '<b>' + MESES_CURTOS[dd.getMonth()] + '</b>' : '<b>&nbsp;</b>') + '<span>' + dd.getDate() + '</span></div>';
    }
    cab += '</div></div>';
    var corpo = ''; var fora = 0, semData = 0, total = 0;
    q.grupos.forEach(function (g) {
      if (g.arquivado) return;
      var itens = itensVisiveis(s, q, g, hoje); if (!itens.length) return;
      corpo += '<div class="qdl-row qdl-grp"><div class="qdl-lab" style="color:' + esc(g.cor) + '">' + esc(g.nome) + ' <span class="qd-cnt">' + itens.length + '</span></div><div class="qdl-area" style="width:' + larguraArea + 'px"></div></div>';
      itens.forEach(function (it) {
        total++;
        var ds = cols.map(function (c) { return it.valores[c.id]; }).filter(Boolean).sort();
        var op = cs ? opcaoPorId(cs, it.valores[cs.id]) : null;
        var cor = op ? op.cor : g.cor;
        var barra = '';
        if (!ds.length) { semData++; barra = '<span class="qdl-hint">sem data</span>'; }
        else {
          var i0 = ds[0], i1 = ds[ds.length - 1];
          if (i1 < ini || i0 > fim) {
            fora++;
            barra = '<span class="qdl-hint">' + esc(fmtData(i0)) + (i1 !== i0 ? ' a ' + esc(fmtData(i1)) : '') + ' (fora desta janela)</span>';
          } else {
            var x0 = i0 < ini ? ini : i0, x1 = i1 > fim ? fim : i1;
            barra = '<div class="qdl-barra' + (statusFinal(q, it) ? ' feito' : '') + (atrasado(q, it, hoje) ? ' atr' : '') + '" data-qd="det" data-i="' + esc(it.id) + '" style="left:' + (diasEntre(ini, x0) * LARG) + 'px;width:' + ((diasEntre(x0, x1) + 1) * LARG) + 'px;background:' + esc(cor) + '" title="' + esc(it.nome) + '">' + esc(it.nome) + '</div>';
          }
        }
        corpo += '<div class="qdl-row"><div class="qdl-lab">' + esc(it.nome) + '</div><div class="qdl-area" style="width:' + larguraArea + 'px">' + barra + '</div></div>';
      });
    });
    var h = '<div class="card" style="padding:12px 14px"><div class="qdr-linha" style="margin-bottom:10px;align-items:center"><button class="btn btn-secondary btn-sm" style="flex:0 0 auto" data-qd="tl-ant">&#8249; Antes</button><button class="btn btn-secondary btn-sm" style="flex:0 0 auto" data-qd="tl-hoje">Hoje</button><button class="btn btn-secondary btn-sm" style="flex:0 0 auto" data-qd="tl-prox">Depois &#8250;</button><span class="qd-cnt" style="margin-left:6px;flex:0 0 auto">' + esc(fmtData(ini)) + ' a ' + esc(fmtData(fim)) + '</span></div>';
    if (!total) return h + '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">Nenhum item para mostrar.</div></div>';
    var linhaHoje = (hoje >= ini && hoje <= fim) ? '<div class="qdl-hojelinha" style="left:' + (LABEL + diasEntre(ini, hoje) * LARG + LARG / 2) + 'px"></div>' : '';
    h += '<div class="qdl-wrap"><div class="qdl" style="min-width:' + (LABEL + larguraArea) + 'px">' + cab + '<div style="position:relative">' + corpo + linhaHoje + '</div></div></div>';
    h += '<div style="font-size:11px;color:var(--text-muted);margin-top:10px">' + total + (total === 1 ? ' item' : ' itens') + (fora ? ' \u00B7 ' + fora + ' fora desta janela' : '') + (semData ? ' \u00B7 ' + semData + ' sem data' : '') + '. Com duas colunas de data, a barra vai da primeira à segunda. Clique em uma barra para abrir o item.</div></div>';
    return h;
  }

  /* --- 3: painel --- */
  function metricasPainel(s, q, hoje) {
    var cs = colStatusDe(q), cp = colPessoaDe(q);
    var datasCols = q.colunas.filter(function (c) { return c.tipo === 'data'; });
    var ws = inicioDaSemana(hoje);
    var m = { total: 0, concluidos: 0, atrasados: 0, proximos: 0, semPrazo: 0, porStatus: [], porPessoa: [], porGrupo: [], prazos: [0, 0, 0, 0, 0, 0], semanas: [] };
    var mapaSt = {}, mapaPe = {}, todos = [];
    q.grupos.forEach(function (g) {
      if (g.arquivado) return;
      var gc = { nome: g.nome, cor: g.cor, abertos: 0, concluidos: 0 };
      itensVisiveis(s, q, g, hoje).forEach(function (it) {
        todos.push(it); m.total++;
        var fin = statusFinal(q, it);
        if (fin) { m.concluidos++; gc.concluidos++; } else { gc.abertos++; }
        var sid = cs ? (it.valores[cs.id] || '') : ''; mapaSt[sid] = (mapaSt[sid] || 0) + 1;
        if (cp) { var p = it.valores[cp.id] || ''; mapaPe[p] = (mapaPe[p] || 0) + 1; }
        if (fin) return;
        var datas = datasCols.map(function (c) { return it.valores[c.id]; }).filter(Boolean).sort();
        if (atrasado(q, it, hoje)) { m.atrasados++; m.prazos[0]++; return; }
        var fut = datas.filter(function (d) { return d >= hoje; })[0];
        if (!fut) { m.semPrazo++; m.prazos[5]++; return; }
        var dif = diasEntre(ws, fut);
        if (dif < 7) m.prazos[1]++; else if (dif < 14) m.prazos[2]++; else if (dif < 21) m.prazos[3]++; else m.prazos[4]++;
        if (diasEntre(hoje, fut) <= 7) m.proximos++;
      });
      m.porGrupo.push(gc);
    });
    if (cs) cs.opcoes.forEach(function (o) { m.porStatus.push({ rotulo: o.nome, n: mapaSt[o.id] || 0, cor: o.cor }); });
    if (mapaSt['']) m.porStatus.push({ rotulo: 'Sem status', n: mapaSt[''], cor: '#c7baae' });
    Object.keys(mapaPe).sort(function (a, b) { return mapaPe[b] - mapaPe[a]; }).forEach(function (k) { m.porPessoa.push({ rotulo: k || 'Sem responsável', n: mapaPe[k], cor: 'var(--lavanda)' }); });
    for (var k = 7; k >= 0; k--) {
      var ini = somarDias(ws, -7 * k), fim = somarDias(ini, 7);
      var n = todos.filter(function (it) { return it._conclEm && it._conclEm >= ini && it._conclEm < fim; }).length;
      m.semanas.push({ rotulo: fmtData(ini).slice(0, 5), n: n, cor: 'var(--oliva)' });
    }
    return m;
  }
  function barrasHtml(lista) {
    var max = 0; lista.forEach(function (x) { if (x.n > max) max = x.n; });
    if (!lista.length || !max) return '<div style="font-size:12px;color:var(--text-muted)">Sem dados.</div>';
    return lista.map(function (x) {
      return '<div class="qdp-lin"><span class="r">' + esc(x.rotulo) + '</span><span class="b"><i style="width:' + Math.round(x.n / max * 100) + '%;background:' + esc(x.cor || 'var(--rosa-antigo)') + '"></i></span><span class="n">' + x.n + '</span></div>';
    }).join('');
  }
  function htmlPainel(s, q, hojeParam) {
    var hoje = hojeParam || hojeISO();
    var m = metricasPainel(s, q, hoje);
    if (!m.total) return '<div class="empty-state"><h3>Sem itens para o painel</h3><p>Adicione itens ao quadro ou limpe os filtros.</p></div>';
    function kpi(rot, v, cor) { return '<div class="qdp-kpi"><div class="l">' + rot + '</div><div class="v" style="color:' + cor + '">' + v + '</div></div>'; }
    var pct = Math.round(m.concluidos / m.total * 100);
    var h = '<div class="qdp-kpis">' + kpi('Itens', m.total, 'var(--text-primary)') + kpi('Concluídos', m.concluidos + ' (' + pct + '%)', 'var(--oliva)') + kpi('Atrasados', m.atrasados, 'var(--rosa-antigo)') + kpi('Vencem em 7 dias', m.proximos, 'var(--sol-ancestral)') + kpi('Sem prazo', m.semPrazo, 'var(--text-muted)') + '</div>';
    var grupos = m.porGrupo.filter(function (g) { return g.abertos + g.concluidos > 0; }).map(function (g) {
      var t = g.abertos + g.concluidos;
      return '<div class="qdp-lin"><span class="r" style="color:' + esc(g.cor) + ';font-weight:600">' + esc(g.nome) + '</span><span class="b"><i style="width:' + Math.round(g.concluidos / t * 100) + '%;background:var(--oliva)"></i></span><span class="n">' + g.concluidos + '/' + t + '</span></div>';
    }).join('');
    var prazos = barrasHtml([
      { rotulo: 'Atrasados', n: m.prazos[0], cor: 'var(--rosa-antigo)' },
      { rotulo: 'Esta semana', n: m.prazos[1], cor: 'var(--sol-ancestral)' },
      { rotulo: 'Próxima semana', n: m.prazos[2], cor: 'var(--lavanda)' },
      { rotulo: 'Em 2 semanas', n: m.prazos[3], cor: 'var(--lavanda)' },
      { rotulo: 'Depois', n: m.prazos[4], cor: 'var(--lavanda)' },
      { rotulo: 'Sem prazo', n: m.prazos[5], cor: '#c7baae' }
    ]);
    function cartao(t, c) { return '<div class="card"><div class="card-header"><h3>' + t + '</h3></div><div class="card-body">' + c + '</div></div>'; }
    h += '<div class="qdp-grid">' + cartao('Por status', barrasHtml(m.porStatus)) + cartao('Por responsável', barrasHtml(m.porPessoa)) + cartao('Progresso por grupo', grupos || '<div style="font-size:12px;color:var(--text-muted)">Sem dados.</div>') + cartao('Prazos dos itens em aberto', prazos) +
      cartao('Conclusões por semana', barrasHtml(m.semanas) + '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Conta os itens concluídos a partir da instalação desta versão.</div>') + '</div>';
    return h;
  }

  /* --- estilos e ligações --- */
  function injetarCSSF3() {
    if ($('qdf3-css')) return;
    var css = [
      '#qd-root .qd-vin{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--rosa-antigo);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#qd-root .qd-vin[data-qd]{cursor:pointer;text-decoration:underline}',
      '#qd-root .qd-vin small{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);font-weight:700;text-decoration:none}',
      '#qd-root .qd-vin.removido{text-decoration:line-through;color:var(--text-muted)}',
      '.qdl-wrap{overflow-x:auto;border:1.5px solid var(--border-light);border-radius:var(--radius-md)}',
      '.qdl{position:relative}',
      '.qdl-row{display:flex;height:30px;border-bottom:1px solid var(--border-light)}',
      '.qdl-head{height:42px;background:var(--bg-warm)}',
      '.qdl-grp{background:var(--bg-warm);font-weight:700}',
      '.qdl-lab{flex:0 0 230px;position:sticky;left:0;z-index:3;background:inherit;background-color:var(--surface);padding:0 12px;font-size:12px;line-height:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-right:1px solid var(--border-light)}',
      '.qdl-head .qdl-lab,.qdl-grp .qdl-lab{background-color:var(--bg-warm)}',
      '.qdl-area{position:relative;flex:0 0 auto;background-image:linear-gradient(to right,var(--border-light) 1px,transparent 1px);background-size:154px 100%}',
      '.qdl-dia{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;color:var(--text-muted)}',
      '.qdl-dia b{font-size:9px;text-transform:uppercase;color:var(--text-primary)}',
      '.qdl-dia.fim{background:rgba(0,0,0,.04)}',
      '.qdl-dia.hoje span{background:var(--rosa-antigo);color:#fff;border-radius:50%;width:16px;height:16px;line-height:16px;text-align:center}',
      '.qdl-barra{position:absolute;top:4px;height:22px;border-radius:6px;color:#fff;font-size:11px;font-weight:600;padding:0 8px;line-height:22px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;box-sizing:border-box}',
      '.qdl-barra.feito{opacity:.45}',
      '.qdl-barra.atr{box-shadow:0 0 0 2px var(--rosa-antigo)}',
      '.qdl-hint{position:absolute;left:8px;top:7px;font-size:11px;color:var(--text-muted);white-space:nowrap}',
      '.qdl-hojelinha{position:absolute;top:0;bottom:0;width:2px;background:var(--rosa-antigo);opacity:.55;z-index:2;pointer-events:none}',
      '.qdp-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}',
      '.qdp-kpi{flex:1;min-width:130px;background:var(--surface);border:1.5px solid var(--border-light);border-radius:var(--radius-lg);padding:14px 16px}',
      '.qdp-kpi .l{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);font-weight:700}',
      '.qdp-kpi .v{font-size:24px;font-weight:800;margin-top:2px}',
      '.qdp-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
      '.qdp-lin{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12px}',
      '.qdp-lin .r{flex:0 0 130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.qdp-lin .b{flex:1;background:var(--border-light);height:10px;border-radius:5px;overflow:hidden}',
      '.qdp-lin .b i{display:block;height:100%;border-radius:5px}',
      '.qdp-lin .n{flex:0 0 44px;text-align:right;font-weight:700}',
      '@media (max-width:760px){.qdp-grid{grid-template-columns:1fr}.qdl-lab{flex-basis:150px}}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'qdf3-css'; st.textContent = css; document.head.appendChild(st);
  }
  function onContentF3(e) {
    if (!ativo() || !e.target.closest) return;
    var t = e.target.closest('[data-qd]'); if (!t) return;
    switch (t.dataset.qd) {
      case 'vin-sel': abrirVinculo(t.dataset.i, t.dataset.col); break;
      case 'vin-ir': {
        var a = achar(Q, t.dataset.i); var ref = a && a.it.vinculos ? a.it.vinculos[t.dataset.col] : null;
        if (ref) abrirRegistro(ref);
        break;
      }
      case 'automacoes': abrirAutomacoes(); break;
      case 'tl-ant': tlOff -= 14; renderTudo(); break;
      case 'tl-prox': tlOff += 14; renderTudo(); break;
      case 'tl-hoje': tlOff = 0; renderTudo(); break;
      default: break;
    }
  }
  function ligarFase3() {
    injetarCSSF3();
    instalarAutomacoes();
    var c = $('content'); c.addEventListener('click', onContentF3);
    var mb = $('modalBody');
    if (mb) { mb.addEventListener('click', onVinClick); mb.addEventListener('input', onVinInput); mb.addEventListener('click', onAutClick); mb.addEventListener('change', onAutChange); }
  }

  function testeFase3() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var hoje = '2026-11-12';
    var fontes = {
      fornecedor: [{ id: 'f1', name: 'Aromaville', phone: '11 99999-0000' }],
      pedido: [{ id: 'p1', numero: '0042', cliente: 'Maria', total: 120, status: 'novo' }],
      produto: [{ id: 'pr1', name: 'Body Mist', line: 'Boreal', type: 'Body Splash' }],
      formula: [{ id: 'fo1', name: 'Hidratante', productType: 'Hidratante Corporal' }]
    };
    var leitor = function (t) { return fontes[t] || []; };
    ok('rótulo do pedido', rotuloVinculo('pedido', fontes.pedido[0]) === '#0042 Maria');
    ok('rótulo do fornecedor', rotuloVinculo('fornecedor', fontes.fornecedor[0]) === 'Aromaville');
    ok('detalhe do produto', subVinculo('produto', fontes.produto[0]) === 'Boreal \u00B7 Body Splash');
    var it = { id: 'i1', nome: 'Repor karité', valores: {} };
    definirVinculo(it, 'c1', 'fornecedor', fontes.fornecedor[0]);
    ok('vínculo guarda rótulo e referência', it.valores.c1 === 'Aromaville' && it.vinculos.c1.tipo === 'fornecedor' && it.vinculos.c1.id === 'f1');
    ok('resolve o registro atual', resolverVinculo(it.vinculos.c1, leitor).rotulo === 'Aromaville' && resolverVinculo(it.vinculos.c1, leitor).removido === false);
    fontes.fornecedor[0].name = 'Aromaville Ltda';
    ok('o rótulo acompanha o nome atual do registro', resolverVinculo(it.vinculos.c1, leitor).rotulo === 'Aromaville Ltda');
    ok('registro apagado vira "removido"', resolverVinculo({ tipo: 'fornecedor', id: 'zzz' }, leitor).removido === true);
    var col = { id: 'c1', nome: 'Fornecedor', tipo: 'vinculo' };
    var hv = htmlVinculo(it, col, it.valores.c1, leitor);
    ok('célula vinculada tem link para abrir e botão de alterar', hv.indexOf('data-qd="vin-ir"') > -1 && hv.indexOf('data-qd="vin-sel"') > -1 && hv.indexOf('Aromaville Ltda') > -1);
    ok('célula vazia convida a vincular', htmlVinculo({ id: 'x', valores: {} }, col, undefined, leitor).indexOf('+ vincular') > -1);
    ok('registro removido não abre', htmlVinculo({ id: 'x', valores: { c1: 'Antigo' }, vinculos: { c1: { tipo: 'fornecedor', id: 'zzz' } } }, col, 'Antigo', leitor).indexOf('data-qd="vin-ir"') < 0);
    ok('texto digitado é escapado', htmlVinculo({ id: 'x', valores: { c1: '<b>x</b>' } }, col, '<b>x</b>', leitor).indexOf('<b>x</b>') < 0);
    limparVinculo(it, 'c1');
    ok('limpar vínculo apaga valor e referência', it.valores.c1 === undefined && it.vinculos.c1 === undefined);
    var sv = novoEstado(); var qv = criarQuadro(sv, 'V', ['Ana']);
    ok('a coluna Vínculo pode ser criada', !!TIPOS.vinculo && adicionarColuna(sv, qv, 'Fornecedor', 'vinculo').tipo === 'vinculo');

    function estAut() {
      var e = novoEstado(); var q = criarQuadro(e, 'Aut', ['Ana', 'Bia']);
      var A = { e: e, q: q, cs: q.colunas[0], cpr: q.colunas[1], cpe: q.colunas[2], cdt: q.colunas[3], g1: q.grupos[0] };
      A.g2 = criarGrupo(e, q, 'Publicado');
      A.it = criarItem(e, q, A.g1, 'Reel Boreal'); setValor(e, A.it, A.cpe.id, 'Bia');
      return A;
    }
    var A = estAut(); var concl = A.cs.opcoes[4];
    A.q.automacoes = [{ id: 'a1', ativa: true, quando: { opcaoId: concl.id }, acao: { tipo: 'mover', grupoId: A.g2.id } }];
    ok('a primeira passada só registra o estado e não dispara', aplicarAutomacoes(A.e, hoje) === 0 && A.it._ult === A.cs.opcoes[0].id && A.g1.itens.length === 1);
    setValor(A.e, A.it, A.cs.id, concl.id);
    ok('mudar para o status da regra move o item', aplicarAutomacoes(A.e, hoje) === 1 && A.g2.itens.length === 1 && A.g1.itens.length === 0);
    ok('registra a data de conclusão', A.it._conclEm === hoje);
    ok('não dispara de novo sem mudança', aplicarAutomacoes(A.e, hoje) === 0 && A.g2.itens.length === 1);
    setValor(A.e, A.it, A.cs.id, A.cs.opcoes[1].id); aplicarAutomacoes(A.e, hoje);
    ok('reabrir o item apaga a data de conclusão', A.it._conclEm === undefined);

    var B = estAut(); var alta = B.cpr.opcoes[0];
    B.q.automacoes = [{ id: 'b1', ativa: true, quando: { opcaoId: B.cs.opcoes[1].id }, acao: { tipo: 'definir', colId: B.cpr.id, opcaoId: alta.id } }];
    aplicarAutomacoes(B.e, hoje); setValor(B.e, B.it, B.cs.id, B.cs.opcoes[1].id);
    ok('automação de definir coluna', aplicarAutomacoes(B.e, hoje) === 1 && B.it.valores[B.cpr.id] === alta.id);

    var C = estAut();
    C.q.automacoes = [{ id: 'c1', ativa: true, quando: { opcaoId: C.cs.opcoes[1].id }, acao: { tipo: 'atribuir', pessoa: 'Ana' } }];
    aplicarAutomacoes(C.e, hoje); setValor(C.e, C.it, C.cs.id, C.cs.opcoes[1].id); aplicarAutomacoes(C.e, hoje);
    ok('automação de atribuir pessoa', C.it.valores[C.cpe.id] === 'Ana');

    var D = estAut();
    D.q.automacoes = [{ id: 'd1', ativa: true, quando: { opcaoId: D.cs.opcoes[4].id }, acao: { tipo: 'data', colId: D.cdt.id } }];
    aplicarAutomacoes(D.e, hoje); setValor(D.e, D.it, D.cs.id, D.cs.opcoes[4].id); aplicarAutomacoes(D.e, hoje);
    ok('automação de registrar a data de hoje', D.it.valores[D.cdt.id] === hoje);

    var E = estAut();
    E.q.automacoes = [{ id: 'e1', ativa: true, quando: { opcaoId: E.cs.opcoes[3].id }, acao: { tipo: 'criar', grupoId: E.g2.id, titulo: 'Publicar: {nome}', copiarResp: true } }];
    aplicarAutomacoes(E.e, hoje); setValor(E.e, E.it, E.cs.id, E.cs.opcoes[3].id);
    ok('automação de criar item usa o nome e copia o responsável', aplicarAutomacoes(E.e, hoje) === 1 && E.g2.itens.length === 1 && E.g2.itens[0].nome === 'Publicar: Reel Boreal' && E.g2.itens[0].valores[E.cpe.id] === 'Bia');
    ok('o item criado não dispara nada depois', aplicarAutomacoes(E.e, hoje) === 0 && E.g2.itens.length === 1);

    var F = estAut();
    F.q.automacoes = [
      { id: 'f1', ativa: true, quando: { opcaoId: F.cs.opcoes[1].id }, acao: { tipo: 'definir', colId: F.cs.id, opcaoId: F.cs.opcoes[2].id } },
      { id: 'f2', ativa: true, quando: { opcaoId: F.cs.opcoes[2].id }, acao: { tipo: 'atribuir', pessoa: 'Ana' } }
    ];
    aplicarAutomacoes(F.e, hoje); setValor(F.e, F.it, F.cs.id, F.cs.opcoes[1].id);
    ok('uma automação não dispara a outra na mesma passada', aplicarAutomacoes(F.e, hoje) === 1 && F.it.valores[F.cs.id] === F.cs.opcoes[2].id && F.it.valores[F.cpe.id] === 'Bia');
    ok('e a mudança feita pela automação também não dispara depois', aplicarAutomacoes(F.e, hoje) === 0 && F.it.valores[F.cpe.id] === 'Bia');

    var G = estAut();
    G.q.automacoes = [{ id: 'g1', ativa: false, quando: { opcaoId: G.cs.opcoes[1].id }, acao: { tipo: 'atribuir', pessoa: 'Ana' } }];
    aplicarAutomacoes(G.e, hoje); setValor(G.e, G.it, G.cs.id, G.cs.opcoes[1].id);
    ok('automação desligada não dispara', aplicarAutomacoes(G.e, hoje) === 0 && G.it.valores[G.cpe.id] === 'Bia');
    G.q.automacoes[0].ativa = true; G.it.arquivado = true;
    ok('item arquivado é ignorado', aplicarAutomacoes(G.e, hoje) === 0);
    ok('item que mudou de quadro (etiqueta inexistente) não dispara', (function () {
      var H = estAut(); H.it._ult = 'etiqueta-de-outro-quadro';
      H.q.automacoes = [{ id: 'h1', ativa: true, quando: { opcaoId: H.cs.opcoes[0].id }, acao: { tipo: 'atribuir', pessoa: 'Ana' } }];
      return aplicarAutomacoes(H.e, hoje) === 0 && H.it._ult === H.cs.opcoes[0].id;
    })());
    ok('descrição da automação em português', descreverAutomacao(A.q, A.q.automacoes[0]).indexOf('Quando o status virar \u201CConcluído\u201D, mover o item para \u201CPublicado\u201D') === 0);
    ok('SISTEMA: automações instaladas no salvamento', DB.set._qdAut === true);

    ok('início da semana é segunda', inicioDaSemana('2026-11-12') === '2026-11-09' && inicioDaSemana('2026-11-15') === '2026-11-09' && inicioDaSemana('2026-11-16') === '2026-11-16');
    ok('diferença de dias', diasEntre('2026-10-26', '2026-11-10') === 15);
    var T = novoEstado(); var qt = criarQuadro(T, 'Linha', ['Ana']); var gt = qt.grupos[0]; var cdt = qt.colunas[3];
    var t1 = criarItem(T, qt, gt, 'Dentro'); setValor(T, t1, cdt.id, '2026-11-12');
    var t2 = criarItem(T, qt, gt, 'Fora'); setValor(T, t2, cdt.id, '2026-12-30');
    criarItem(T, qt, gt, 'Sem data');
    var ht = htmlLinhaTempo(T, qt, hoje);
    ok('linha do tempo: 1 barra, 1 fora da janela, 1 sem data', (ht.match(/class="qdl-barra/g) || []).length === 1 && ht.indexOf('(fora desta janela)') > -1 && ht.indexOf('sem data') > -1);
    ok('linha do tempo marca o dia de hoje', ht.indexOf('qdl-hojelinha') > -1);
    var c2 = adicionarColuna(T, qt, 'Entrega', 'data'); setValor(T, t1, c2.id, '2026-11-14'); setValor(T, t1, cdt.id, '2026-11-10');
    var ht2 = htmlLinhaTempo(T, qt, hoje);
    ok('com duas datas a barra vai da primeira à segunda (5 dias)', ht2.indexOf('left:330px;width:110px') > -1);
    tlOff = 14; var ht3 = htmlLinhaTempo(T, qt, hoje); tlOff = 0;
    ok('o botão Depois desloca a janela em 14 dias', ht3.indexOf('09/11/2026 a 03/01/2027') > -1 && (ht3.match(/class="qdl-barra/g) || []).length === 2 && ht3.indexOf('(fora desta janela)') < 0);
    var qs = criarQuadro(T, 'SemData', ['Ana']); qs.colunas = qs.colunas.filter(function (c) { return c.tipo !== 'data'; });
    ok('sem coluna de data, avisa como resolver', htmlLinhaTempo(T, qs, hoje).indexOf('Linha do tempo indisponível') > -1);

    var P = novoEstado(); var qp = criarQuadro(P, 'Painel', ['Ana', 'Bia']); var gp = qp.grupos[0];
    var cspl = qp.colunas[0], cpe = qp.colunas[2], cdp = qp.colunas[3];
    function novoP(nome, st, dt, pe) { var x = criarItem(P, qp, gp, nome); setValor(P, x, cspl.id, cspl.opcoes[st].id); if (dt) setValor(P, x, cdp.id, dt); if (pe) setValor(P, x, cpe.id, pe); return x; }
    novoP('Atrasado', 1, '2026-11-10', 'Ana');
    novoP('Hoje', 0, '2026-11-12', 'Ana');
    novoP('Daqui a 10 dias', 0, '2026-11-22', 'Bia');
    var feito = novoP('Concluído', 4, '2026-11-01', 'Bia'); feito._conclEm = '2026-11-11';
    novoP('Sem data', 0, '', '');
    var m = metricasPainel(P, qp, hoje);
    ok('painel: totais', m.total === 5 && m.concluidos === 1 && m.atrasados === 1 && m.proximos === 1 && m.semPrazo === 1);
    ok('painel: prazos por faixa', m.prazos[0] === 1 && m.prazos[1] === 1 && m.prazos[2] === 1 && m.prazos[5] === 1);
    ok('painel: por status e por responsável', m.porStatus[0].n === 3 && m.porStatus[1].n === 1 && m.porPessoa[0].n === 2);
    ok('painel: conclusões da semana atual', m.semanas.length === 8 && m.semanas[7].n === 1 && m.semanas[6].n === 0);
    var hp = htmlPainel(P, qp, hoje);
    ok('painel: gera os cartões', hp.indexOf('Por status') > -1 && hp.indexOf('Prazos dos itens em aberto') > -1 && hp.indexOf('Conclusões por semana') > -1);
    ok('painel vazio avisa', htmlPainel(novoEstado(), criarQuadro(novoEstado(), 'Vazio', ['Ana']), hoje).indexOf('Sem itens para o painel') > -1);
    ok('SISTEMA: o botão Automações e as visões existem', typeof abrirAutomacoes === 'function' && typeof htmlLinhaTempo === 'function' && typeof htmlPainel === 'function');
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS-FASE3: ' + r.length + ' testes, 0 falhas' : 'QUADROS-FASE3: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  /* ---------------- Fase 4: automações combinadas (parado há N dias, arquivar, alerta) e datas nos subitens ---------------- */
  var acoesPend = [];

  function herdarMarcas(novo, antigo) {
    if (antigo) { Object.keys(antigo).forEach(function (k) { if (k.charAt(0) === '_') novo[k] = antigo[k]; }); }
    return novo;
  }
  function textoDias(n) { return n + (n === 1 ? ' dia' : ' dias'); }

  /* regras antigas (quando/acao) são lidas como o formato novo (gatilho/acoes) */
  function migrarRegra(r) {
    if (r && !r.gatilho && r.quando) r.gatilho = { tipo: 'virar', opcaoId: r.quando.opcaoId };
    if (r && !r.acoes && r.acao) r.acoes = [r.acao];
    return r;
  }
  function condicaoOk(q, it, c) {
    if (!c || !c.colId) return true;
    var col = colunaPorId(q, c.colId);
    if (!col) return true;
    var v = it.valores[col.id];
    return v !== undefined && String(v) === String(c.valor);
  }
  function arquivarItemAuto(est, it, hoje) {
    try { if (typeof arquivarItem === 'function') arquivarItem(est, it.id); } catch (e) { /* segue com a marca direta */ }
    if (!it.arquivado) it.arquivado = true;
    if (!it.arquivadoEm) it.arquivadoEm = new Date().toISOString();
    it._arqAuto = hoje;
    return true;
  }

  function executarAcao(est, q, g, it, a, hoje) {
    var dest = null, col = null;
    if (a.tipo === 'alerta') return false;
    if (a.tipo === 'arquivar') { if (it.arquivado) return false; return arquivarItemAuto(est, it, hoje); }
    if (a.tipo === 'mover') {
      q.grupos.forEach(function (x) { if (x.id === a.grupoId && !x.arquivado) dest = x; });
      if (!dest || dest.id === g.id) return false;
      return !!moverItem(est, it.id, dest.id, null);
    }
    if (a.tipo === 'definir') {
      col = colunaPorId(q, a.colId);
      if (!col || !opcaoPorId(col, a.opcaoId) || it.valores[col.id] === a.opcaoId) return false;
      it.valores[col.id] = a.opcaoId; return true;
    }
    if (a.tipo === 'atribuir') {
      col = colPessoaDe(q);
      if (!col || !a.pessoa) return false;
      it.valores[col.id] = a.pessoa;
      if (q.pessoas.indexOf(a.pessoa) < 0) q.pessoas.push(a.pessoa);
      return true;
    }
    if (a.tipo === 'data') {
      col = colunaPorId(q, a.colId);
      if (!col || col.tipo !== 'data') return false;
      it.valores[col.id] = hoje; return true;
    }
    if (a.tipo === 'criar') {
      q.grupos.forEach(function (x) { if (x.id === a.grupoId && !x.arquivado) dest = x; });
      var titulo = String(a.titulo || '').replace(/\{nome\}/g, it.nome).trim();
      if (!dest || !titulo) return false;
      var novo = criarItem(est, q, dest, titulo);
      var cp = colPessoaDe(q);
      if (a.copiarResp && cp && it.valores[cp.id]) novo.valores[cp.id] = it.valores[cp.id];
      var cs2 = colStatusDe(q);
      novo._ult = (cs2 && novo.valores[cs2.id] !== undefined) ? novo.valores[cs2.id] : null;
      novo._desde = hoje;
      return true;
    }
    return false;
  }

  /* roda quando o status de um item muda (gatilho "virar") e guarda desde quando o item está no status */
  function aplicarAutomacoes(est, hoje) {
    var n = 0;
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      var cs = colStatusDe(q); if (!cs) return;
      var regras = (q.automacoes || []).map(migrarRegra).filter(function (r) { return r.ativa && r.gatilho && r.acoes && r.acoes.length; });
      q.grupos.forEach(function (g) {
        g.itens.slice().forEach(function (it) {
          if (it.arquivado) return;
          var atual = it.valores[cs.id];
          if (it._desde === undefined) it._desde = hoje;
          if (it._ult === undefined || (it._ult !== null && !opcaoPorId(cs, it._ult))) { it._ult = atual === undefined ? null : atual; it._desde = hoje; return; }
          var anterior = it._ult === null ? undefined : it._ult;
          if (atual === anterior) return;
          it._desde = hoje;
          regras.forEach(function (r) {
            if (r.gatilho.tipo !== 'virar' || r.gatilho.opcaoId !== atual) return;
            if (!condicaoOk(q, it, r.condicao)) return;
            r.acoes.forEach(function (a) { if (executarAcao(est, q, g, it, a, hoje)) n++; });
          });
          var depois = it.valores[cs.id];
          if (depois !== atual) it._desde = hoje;
          it._ult = depois === undefined ? null : depois;
          var op = opcaoPorId(cs, depois);
          if (op && op.final) { if (!it._conclEm) it._conclEm = hoje; } else { delete it._conclEm; }
        });
      });
    });
    return n;
  }

  /* gatilho "parado há N dias": roda ao abrir o sistema, o Modo Dia, o Dashboard e os Quadros */
  function avaliarParados(est, hoje) {
    var n = 0;
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      var cs = colStatusDe(q); if (!cs) return;
      var regras = (q.automacoes || []).map(migrarRegra).filter(function (r) {
        return r.ativa && r.gatilho && r.gatilho.tipo === 'parado' && (r.acoes || []).some(function (a) { return a.tipo !== 'alerta'; });
      });
      q.grupos.forEach(function (g) {
        g.itens.slice().forEach(function (it) {
          if (it.arquivado) return;
          if (!it._desde) { it._desde = hoje; n++; return; }
          if (!regras.length) return;
          var atual = it.valores[cs.id];
          regras.forEach(function (r) {
            if (it.arquivado || r.gatilho.opcaoId !== atual) return;
            if (diasEntre(it._desde, hoje) < (r.gatilho.dias || 0)) return;
            if (!condicaoOk(q, it, r.condicao)) return;
            if (!it._aut) it._aut = {};
            if (it._aut[r.id] === it._desde) return;
            r.acoes.forEach(function (a) { if (executarAcao(est, q, g, it, a, hoje)) n++; });
            it._aut[r.id] = it._desde;
            n++;
          });
        });
      });
    });
    return n;
  }

  function gerarNoBanco(forcar) {
    if (pendente) return;
    if (!forcar && Date.now() - ultimaGer < 30000) return;
    ultimaGer = Date.now();
    var d = null;
    try { d = DB.get(CHAVE); } catch (e) { d = null; }
    if (!d || Array.isArray(d) || !Array.isArray(d.quadros)) return;
    var hoje = hojeISO();
    var n = gerarRotinas(d, hoje) + avaliarParados(d, hoje);
    if (n > 0) {
      try { DB.set(CHAVE, { versao: 1, atual: d.atual || null, quadros: d.quadros }); } catch (e) { console.error('quadros: rotinas', e); }
    }
  }

  /* alertas no Modo Dia: aparecem enquanto o item estiver no status (e, no gatilho "parado", depois dos dias combinados) */
  function tarefasAlertas(est, hoje) {
    var tasks = [];
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      var cs = colStatusDe(q); if (!cs) return;
      (q.automacoes || []).map(migrarRegra).forEach(function (r) {
        if (!r.ativa || !r.gatilho) return;
        var alertas = (r.acoes || []).filter(function (a) { return a.tipo === 'alerta'; });
        if (!alertas.length) return;
        q.grupos.forEach(function (g) {
          if (g.arquivado) return;
          g.itens.forEach(function (it) {
            if (it.arquivado || it.valores[cs.id] !== r.gatilho.opcaoId) return;
            var dias = it._desde ? diasEntre(it._desde, hoje) : 0;
            if (r.gatilho.tipo === 'parado' && (!it._desde || dias < (r.gatilho.dias || 0))) return;
            if (!condicaoOk(q, it, r.condicao)) return;
            var op = opcaoPorId(cs, r.gatilho.opcaoId);
            alertas.forEach(function (a, i) {
              var texto = (a.texto || '{nome} está em \u201C{status}\u201D há {dias}')
                .replace(/\{nome\}/g, it.nome).replace(/\{status\}/g, op ? op.nome : '').replace(/\{dias\}/g, textoDias(dias));
              tasks.push({
                priority: a.urgente ? 1 : 2, type: a.urgente ? 'urgente' : 'hoje', cat: 'Quadros', catColor: 'purple',
                text: texto, sub: q.nome + ' \u00B7 ' + g.nome,
                action: "QuadrosAbrirItem('" + q.id + "','" + it.id + "')", btnLabel: 'Abrir item',
                id: 'qa_' + it.id + '_' + r.id + '_' + i
              });
            });
          });
        });
      });
    });
    return tasks;
  }

  /* subitens com data no Modo Dia e na Agenda */
  function tarefasSubitens(est, hoje) {
    var tasks = [];
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      q.grupos.forEach(function (g) {
        if (g.arquivado) return;
        g.itens.forEach(function (it) {
          if (it.arquivado) return;
          var paiFeito = statusFinal(q, it);
          (it.subitens || []).forEach(function (s) {
            if (!s.data) return;
            var base = { cat: 'Quadros', catColor: 'purple', text: s.nome, action: "QuadrosAbrirItem('" + q.id + "','" + it.id + "')", btnLabel: 'Abrir item', id: 'qs_' + it.id + '_' + s.id };
            var onde = 'Subitem de \u201C' + it.nome + '\u201D \u00B7 ' + q.nome + ' \u00B7 ' + g.nome;
            if (s.feito) {
              if (s.feitoEm === hoje) { base.priority = 2; base.type = 'hoje'; base.sub = onde + ' \u00B7 concluído hoje'; tasks.push(base); }
              return;
            }
            if (paiFeito) return;
            if (s.data < hoje) { base.priority = 1; base.type = 'urgente'; base.sub = onde + ' \u00B7 venceu há ' + textoDias(diasEntre(s.data, hoje)); tasks.push(base); }
            else if (s.data === hoje) { base.priority = 2; base.type = 'hoje'; base.sub = onde + ' \u00B7 vence hoje'; tasks.push(base); }
          });
        });
      });
    });
    return tasks;
  }
  function itensAgendaSubitens(est, hoje) {
    var out = [];
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      q.grupos.forEach(function (g) {
        if (g.arquivado) return;
        g.itens.forEach(function (it) {
          if (it.arquivado || statusFinal(q, it)) return;
          (it.subitens || []).forEach(function (s) {
            if (s.data && !s.feito && s.data >= hoje) out.push({ date: s.data, text: s.nome, tipo: 'normal', cat: 'Quadros \u00B7 subitem de ' + it.nome, id: 'qs_' + it.id + '_' + s.id });
          });
        });
      });
    });
    return out;
  }
  function marcarSubitem(est, itemId, subId, concluindo, hoje) {
    var a = achar(est, itemId); if (!a) return false;
    var s = achaSub(a.it, subId); if (!s) return false;
    if (concluindo) { s.feito = true; s.feitoEm = hoje; } else { s.feito = false; delete s.feitoEm; }
    return true;
  }

  window.QuadrosAbrirItem = function (qid, iid) {
    var d = null;
    try { d = DB.get(CHAVE); } catch (e) { d = null; }
    if (d && !Array.isArray(d) && Array.isArray(d.quadros) && d.quadros.some(function (q) { return q.id === qid; })) {
      DB.set(CHAVE, { versao: 1, atual: qid, quadros: d.quadros });
    }
    go('quadros');
    setTimeout(function () { try { abrirDetalhe(iid); } catch (e) { /* ignorar */ } }, 80);
  };

  function lerEstadoQuadros() {
    var d = null;
    try { d = DB.get(CHAVE); } catch (e) { d = null; }
    return (d && !Array.isArray(d) && Array.isArray(d.quadros)) ? d : null;
  }
  function instalarModoDiaF4() {
    if (typeof window.getModoDiaTasks === 'function' && !window.getModoDiaTasks._qdF4) {
      var tAntes = window.getModoDiaTasks;
      var novoT = function () {
        var tasks = tAntes.apply(this, arguments);
        try {
          var est = lerEstadoQuadros();
          if (est) {
            var hoje = hojeISO();
            var extra = tarefasAlertas(est, hoje).concat(tarefasSubitens(est, hoje));
            if (extra.length) {
              var ja = {}; tasks.forEach(function (t) { ja[t.id] = 1; });
              extra.forEach(function (t) { if (!ja[t.id]) tasks.push(t); });
              tasks.sort(function (a, b) { return a.priority - b.priority; });
            }
          }
        } catch (e) { console.error('quadros: alertas e subitens', e); }
        return tasks;
      };
      herdarMarcas(novoT, tAntes); novoT._qdF4 = true; window.getModoDiaTasks = novoT;
    }
    if (typeof window.toggleModoDiaTask === 'function' && !window.toggleModoDiaTask._qdF4) {
      var gAntes = window.toggleModoDiaTask;
      var novoG = function (id) {
        var tid = String(id);
        if (tid.indexOf('qs_') === 0) {
          try {
            var partes = tid.split('_'); var est = lerEstadoQuadros();
            if (est && partes.length === 3) {
              var feitos = JSON.parse(localStorage.getItem('mundana_mododia_done_' + localDateStr()) || '[]');
              if (marcarSubitem(est, partes[1], partes[2], feitos.indexOf(tid) < 0, hojeISO())) DB.set(CHAVE, { versao: 1, atual: est.atual || null, quadros: est.quadros });
            }
          } catch (e) { console.error('quadros: concluir subitem', e); }
        }
        return gAntes.apply(this, arguments);
      };
      herdarMarcas(novoG, gAntes); novoG._qdF4 = true; window.toggleModoDiaTask = novoG;
    }
    if (typeof window.mdWeekBuildItems === 'function' && !window.mdWeekBuildItems._qdF4) {
      var mAntes = window.mdWeekBuildItems;
      var novoM = function () {
        var items = mAntes.apply(this, arguments);
        try { var est = lerEstadoQuadros(); if (est) itensAgendaSubitens(est, hojeISO()).forEach(function (i) { items.push(i); }); } catch (e) { console.error('quadros: agenda', e); }
        return items;
      };
      herdarMarcas(novoM, mAntes); novoM._qdF4 = true; window.mdWeekBuildItems = novoM;
    }
  }

  /* --- interface das automações (versão 2) --- */
  function descreverAcao(q, a) {
    function grupo(id) { var g = null; q.grupos.forEach(function (x) { if (x.id === id) g = x; }); return g ? g.nome : '?'; }
    if (a.tipo === 'mover') return 'mover o item para \u201C' + grupo(a.grupoId) + '\u201D';
    if (a.tipo === 'definir') { var col = colunaPorId(q, a.colId); var op = col ? opcaoPorId(col, a.opcaoId) : null; return 'definir ' + (col ? col.nome : '?') + ' como \u201C' + (op ? op.nome : '?') + '\u201D'; }
    if (a.tipo === 'atribuir') return 'atribuir a ' + (a.pessoa || '?');
    if (a.tipo === 'data') { var cd = colunaPorId(q, a.colId); return 'registrar a data de hoje em ' + (cd ? cd.nome : '?'); }
    if (a.tipo === 'criar') return 'criar o item \u201C' + (a.titulo || '') + '\u201D em \u201C' + grupo(a.grupoId) + '\u201D' + (a.copiarResp ? ' (mesmo responsável)' : '');
    if (a.tipo === 'arquivar') return 'arquivar o item';
    if (a.tipo === 'alerta') return 'criar um alerta no Modo Dia' + (a.urgente ? ' (urgente)' : '');
    return '?';
  }
  function descreverAutomacao(q, r) {
    migrarRegra(r);
    var cs = colStatusDe(q); var g = r.gatilho || {};
    var o = cs ? opcaoPorId(cs, g.opcaoId) : null; var nomeS = o ? o.nome : '?';
    var quando = g.tipo === 'parado'
      ? 'Quando o item ficar ' + textoDias(g.dias || 0) + ' em \u201C' + nomeS + '\u201D'
      : 'Quando o status virar \u201C' + nomeS + '\u201D';
    if (r.condicao && r.condicao.colId) {
      var col = colunaPorId(q, r.condicao.colId);
      var vtxt = r.condicao.valor;
      if (col && col.opcoes) { var ov = opcaoPorId(col, r.condicao.valor); vtxt = ov ? ov.nome : '?'; }
      quando += ' e ' + (col ? col.nome : '?') + ' for \u201C' + vtxt + '\u201D';
    }
    return quando + ', ' + (r.acoes || []).map(function (a) { return descreverAcao(q, a); }).join(' e ');
  }
  function htmlPendentes(q) {
    if (!acoesPend.length) return '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">Nenhuma ação adicionada. A ação escolhida acima entra sozinha ao salvar; use "Adicionar" para combinar várias na mesma regra.</div>';
    return acoesPend.map(function (a, i) {
      return '<div class="qdr-row" style="padding:6px 10px;margin-top:6px"><div class="info"><strong>' + esc(descreverAcao(q, a)) + '</strong></div><button class="qdt-x" data-qa="aut-rm" data-i="' + i + '" aria-label="Remover ação">&times;</button></div>';
    }).join('');
  }
  function corpoAutomacoes(q) {
    var cs = colStatusDe(q);
    if (!cs) return '<div id="qda-root"><p style="font-size:13px;color:var(--text-muted)">As automações usam a coluna de Status. Crie uma coluna do tipo Status em "Colunas".</p></div>';
    var lista = q.automacoes || [];
    var grupos = q.grupos.filter(function (g) { return !g.arquivado; }).map(function (g) { return opcSel(g.id, g.nome, false); }).join('');
    var h = '<div id="qda-root"><p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Automações agem sozinhas. Uma automação não dispara outra, para evitar ciclos. Itens que já existem contam o tempo "parado" a partir de hoje.</p>';
    if (!lista.length) h += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;background:var(--bg-warm);border-radius:var(--radius-md);margin-bottom:8px">Nenhuma automação ainda.</div>';
    lista.forEach(function (r) {
      h += '<div class="qdr-row"><input type="checkbox" class="qda-ativa" data-id="' + esc(r.id) + '"' + (r.ativa ? ' checked' : '') + ' title="Ativa"><div class="info"><strong>' + esc(descreverAutomacao(q, r)) + '</strong></div><button class="btn btn-ghost btn-sm" style="color:var(--rosa-antigo)" data-qa="aut-del" data-id="' + esc(r.id) + '">Excluir</button></div>';
    });
    h += '<div class="qdt-sec">Nova automação</div>';
    h += '<div class="qdr-linha"><div><label class="form-label">Quando</label><select class="form-select" id="qda-gatilho">' + opcSel('virar', 'O status virar...', true) + opcSel('parado', 'O item ficar parado no status...', false) + '</select></div>' +
      '<div><label class="form-label">Status</label><select class="form-select" id="qda-quando">' + cs.opcoes.map(function (o) { return opcSel(o.id, o.nome, false); }).join('') + '</select></div>' +
      '<div id="qda-box-dias"><label class="form-label">Por quantos dias</label><input class="form-input" id="qda-dias" type="number" min="0" max="365" value="5"></div></div>';
    h += '<div class="qdr-linha"><div><label class="form-label">E somente se (opcional)</label><select class="form-select" id="qda-ccol">' + opcSel('', '(sem condição)', true) +
      q.colunas.filter(function (c) { return !!c.opcoes || c.tipo === 'pessoa'; }).map(function (c) { return opcSel(c.id, c.nome, false); }).join('') + '</select></div>' +
      '<div id="qda-box-cval"><label class="form-label">For igual a</label><select class="form-select" id="qda-cval"></select></div></div>';
    h += '<div class="qdr-linha"><div><label class="form-label">Então</label><select class="form-select" id="qda-acao">' + opcSel('mover', 'Mover para um grupo', true) + opcSel('definir', 'Definir uma coluna (lista ou status)', false) +
      opcSel('atribuir', 'Atribuir a uma pessoa', false) + opcSel('data', 'Registrar a data de hoje', false) + opcSel('criar', 'Criar um novo item', false) +
      opcSel('arquivar', 'Arquivar o item', false) + opcSel('alerta', 'Criar um alerta no Modo Dia', false) + '</select></div></div>';
    h += '<div id="qda-box-mover" class="qdr-linha"><div><label class="form-label">Grupo de destino</label><select class="form-select" id="qda-grupo">' + grupos + '</select></div></div>';
    h += '<div id="qda-box-definir" class="qdr-linha"><div><label class="form-label">Coluna</label><select class="form-select" id="qda-col">' + q.colunas.filter(function (c) { return !!c.opcoes; }).map(function (c) { return opcSel(c.id, c.nome, false); }).join('') + '</select></div><div><label class="form-label">Valor</label><select class="form-select" id="qda-opc"></select></div></div>';
    h += '<div id="qda-box-atribuir" class="qdr-linha"><div><label class="form-label">Pessoa</label><select class="form-select" id="qda-pessoa">' + (q.pessoas || []).map(function (p) { return opcSel(p, p, false); }).join('') + '</select></div></div>';
    h += '<div id="qda-box-data" class="qdr-linha"><div><label class="form-label">Coluna de data</label><select class="form-select" id="qda-cdata">' + q.colunas.filter(function (c) { return c.tipo === 'data'; }).map(function (c) { return opcSel(c.id, c.nome, false); }).join('') + '</select></div></div>';
    h += '<div id="qda-box-criar" class="qdr-linha"><div><label class="form-label">Grupo do novo item</label><select class="form-select" id="qda-grupo2">' + grupos + '</select></div><div style="flex:2"><label class="form-label">Título (use {nome} para o nome do item)</label><input class="form-input" id="qda-titulo" placeholder="Ex.: Publicar: {nome}"></div><label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:0 0 100%"><input type="checkbox" id="qda-copiar" checked> Manter o mesmo responsável</label></div>';
    h += '<div id="qda-box-alerta" class="qdr-linha"><div style="flex:2"><label class="form-label">Texto do alerta (opcional; use {nome}, {status} e {dias})</label><input class="form-input" id="qda-atxt" placeholder="Ex.: {nome} está em {status} há {dias}"></div><label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:0 0 100%"><input type="checkbox" id="qda-aurg"> Marcar como urgente no Modo Dia</label></div>';
    h += '<div class="qdr-linha"><button class="btn btn-secondary btn-sm" style="flex:0 0 auto" data-qa="aut-add">+ Adicionar esta ação à combinação</button></div>';
    h += '<div id="qda-pend">' + htmlPendentes(q) + '</div>';
    h += '<div class="qdr-linha" style="margin-top:14px"><button class="btn btn-primary" style="flex:0 0 auto" data-qa="aut-salvar">Salvar automação</button></div></div>';
    return h;
  }
  function ajustarFormAutomacao() {
    var q = quadroAtual(); var acao = $('qda-acao'); if (!q || !acao) return;
    ['mover', 'definir', 'atribuir', 'data', 'criar', 'alerta'].forEach(function (t) { var b = $('qda-box-' + t); if (b) b.style.display = acao.value === t ? '' : 'none'; });
    var gat = $('qda-gatilho'), bd = $('qda-box-dias');
    if (gat && bd) bd.style.display = gat.value === 'parado' ? '' : 'none';
    var cs = $('qda-col'), os = $('qda-opc');
    if (cs && os) {
      var col = colunaPorId(q, cs.value);
      os.innerHTML = col ? (col.opcoes || []).map(function (o) { return opcSel(o.id, o.nome, false); }).join('') : '';
    }
    var cc = $('qda-ccol'), cv = $('qda-cval'), bcv = $('qda-box-cval');
    if (cc && cv) {
      var cond = cc.value ? colunaPorId(q, cc.value) : null;
      if (!cond) { cv.innerHTML = ''; if (bcv) bcv.style.display = 'none'; }
      else {
        if (bcv) bcv.style.display = '';
        cv.innerHTML = cond.opcoes ? cond.opcoes.map(function (o) { return opcSel(o.id, o.nome, false); }).join('') : (q.pessoas || []).map(function (p) { return opcSel(p, p, false); }).join('');
      }
    }
  }
  function abrirAutomacoes() {
    var q = quadroAtual(); if (!q) return;
    acoesPend = [];
    openModal('Automações \u00B7 ' + q.nome, corpoAutomacoes(q), '<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>', true);
    ajustarFormAutomacao();
  }
  function lerAcaoDoForm() {
    var tipo = $('qda-acao').value; var a = { tipo: tipo };
    if (tipo === 'mover') { a.grupoId = $('qda-grupo').value; if (!a.grupoId) return { erro: 'Escolha o grupo de destino' }; }
    else if (tipo === 'definir') { a.colId = $('qda-col').value; a.opcaoId = $('qda-opc').value; if (!a.colId || !a.opcaoId) return { erro: 'Escolha a coluna e o valor' }; }
    else if (tipo === 'atribuir') { a.pessoa = $('qda-pessoa').value; if (!a.pessoa) return { erro: 'Escolha a pessoa' }; }
    else if (tipo === 'data') { a.colId = $('qda-cdata').value; if (!a.colId) return { erro: 'Crie uma coluna de data primeiro' }; }
    else if (tipo === 'criar') {
      a.grupoId = $('qda-grupo2').value; a.titulo = $('qda-titulo').value.trim(); a.copiarResp = !!$('qda-copiar').checked;
      if (!a.grupoId || !a.titulo) return { erro: 'Informe o grupo e o título do novo item' };
    } else if (tipo === 'alerta') { a.texto = ($('qda-atxt').value || '').trim(); a.urgente = !!$('qda-aurg').checked; }
    return { acao: a };
  }
  function salvarAutomacaoDoModal() {
    var q = quadroAtual(); if (!q || !$('qda-root')) return;
    var acoes = acoesPend.slice();
    if (!acoes.length) { var l = lerAcaoDoForm(); if (l.erro) { aviso(l.erro); return; } acoes.push(l.acao); }
    var gat = { tipo: $('qda-gatilho').value, opcaoId: $('qda-quando').value };
    if (gat.tipo === 'parado') gat.dias = Math.max(0, parseInt($('qda-dias').value, 10) || 0);
    var cc = $('qda-ccol').value, cond = null;
    if (cc) { var cv = $('qda-cval').value; if (cv) cond = { colId: cc, valor: cv }; }
    if (!q.automacoes) q.automacoes = [];
    q.automacoes.push({ id: uid(), ativa: true, gatilho: gat, condicao: cond, acoes: acoes });
    acoesPend = [];
    salvar(); abrirAutomacoes(); aviso('Automação salva');
  }
  function onAutClick(e) {
    var t = e.target.closest ? e.target.closest('[data-qa]') : null; if (!t || !$('qda-root')) return;
    var q = quadroAtual(); if (!q) return;
    var acao = t.dataset.qa;
    if (acao === 'aut-salvar') salvarAutomacaoDoModal();
    else if (acao === 'aut-add') {
      var l = lerAcaoDoForm(); if (l.erro) { aviso(l.erro); return; }
      acoesPend.push(l.acao);
      var el = $('qda-pend'); if (el) el.innerHTML = htmlPendentes(q);
    } else if (acao === 'aut-rm') {
      acoesPend.splice(parseInt(t.dataset.i, 10), 1);
      var el2 = $('qda-pend'); if (el2) el2.innerHTML = htmlPendentes(q);
    } else if (acao === 'aut-del') {
      if (window.confirm('Excluir esta automação?')) {
        q.automacoes = (q.automacoes || []).filter(function (r) { return r.id !== t.dataset.id; });
        salvar(); abrirAutomacoes();
      }
    }
  }
  function onAutChange(e) {
    var el = e.target; if (!el || !$('qda-root')) return;
    if (el.id === 'qda-acao' || el.id === 'qda-col' || el.id === 'qda-gatilho' || el.id === 'qda-ccol') { ajustarFormAutomacao(); return; }
    if (el.classList && el.classList.contains('qda-ativa')) {
      var q = quadroAtual(); if (!q) return;
      (q.automacoes || []).forEach(function (r) { if (r.id === el.dataset.id) r.ativa = el.checked; });
      salvar(); abrirAutomacoes();
    }
  }

  /* --- detalhe do item: data nos subitens --- */
  function corpoDetalhe(a) {
    var it = a.it, q = a.q, g = a.g; var hoje = hojeISO();
    var cs = colPrincipal(q); var op = cs ? opcaoPorId(cs, it.valores[cs.id]) : null;
    var pr = progressoSub(it);
    var coms = it.comentarios || []; var links = it.links || [];
    var h = '<div id="qdt-root" data-item="' + esc(it.id) + '">';
    h += '<div class="qdt-meta">' + esc(q.nome) + ' \u00B7 ' + esc(g.nome) + (op ? ' \u00B7 <span style="color:' + esc(op.cor) + ';font-weight:700">' + esc(op.nome) + '</span>' : '') + '</div>';
    h += '<div class="qdt-sec">Descrição</div><textarea class="form-textarea qdt-desc" rows="3" placeholder="Contexto, objetivo, observações...">' + esc(it.descricao || '') + '</textarea>';
    h += '<div class="qdt-sec">Subitens' + (pr.total ? ' <span class="qdt-cnt">' + pr.feitos + '/' + pr.total + '</span>' : '') + '</div>';
    if (pr.total) h += '<div class="progress-bar"><div class="progress-fill" style="width:' + pr.pct + '%"></div></div>';
    (it.subitens || []).forEach(function (s) {
      var atr = !!(s.data && !s.feito && s.data < hoje);
      h += '<div class="qdt-sub' + (s.feito ? ' feito' : '') + '"><input type="checkbox" class="qdt-chk" data-id="' + esc(s.id) + '"' + (s.feito ? ' checked' : '') + '><input class="qdt-subnome" data-id="' + esc(s.id) + '" value="' + esc(s.nome) + '">' +
        '<input type="date" class="qdt-subdata' + (atr ? ' atr' : '') + '" data-id="' + esc(s.id) + '" value="' + esc(s.data || '') + '" title="Prazo do subitem (aparece no Modo Dia)">' +
        '<button class="qdt-x" data-qdt="sub-del" data-id="' + esc(s.id) + '" aria-label="Excluir subitem">&times;</button></div>';
    });
    h += '<input class="form-input" id="qdt-sub-add" placeholder="+ Adicionar subitem (Enter)" style="margin-top:8px">';
    h += '<div class="qdt-sec">Links e referências' + (links.length ? ' <span class="qdt-cnt">' + links.length + '</span>' : '') + '</div>';
    links.forEach(function (l) {
      h += '<div class="qdt-link"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.titulo) + '</a><span class="url">' + esc(dominio(l.url)) + '</span><button class="qdt-x" data-qdt="lnk-del" data-id="' + esc(l.id) + '" aria-label="Excluir link">&times;</button></div>';
    });
    h += '<div class="qdt-linha"><input class="form-input" id="qdt-lnk-tit" placeholder="Título (opcional)" style="flex:1;min-width:120px;width:auto"><input class="form-input" id="qdt-lnk-url" placeholder="Endereço (https://...)" style="flex:2;min-width:160px;width:auto"><button class="btn btn-secondary btn-sm" data-qdt="lnk-add">Adicionar link</button></div>';
    h += '<div class="qdt-sec">Comentários' + (coms.length ? ' <span class="qdt-cnt">' + coms.length + '</span>' : '') + '</div>';
    coms.forEach(function (c) {
      h += '<div class="qdt-com"><div class="qdt-com-h"><strong>' + esc(c.autor) + '</strong><span class="quando">' + esc(fmtDataHora(new Date(c.em))) + '</span><button class="qdt-x" data-qdt="com-del" data-id="' + esc(c.id) + '" aria-label="Excluir comentário">&times;</button></div><div class="qdt-com-t">' + esc(c.texto) + '</div></div>';
    });
    var autores = (q.pessoas || []).slice(); if (!autores.length) autores = ['Ana'];
    var ultimo = ''; try { ultimo = localStorage.getItem('qd_autor') || ''; } catch (e) { ultimo = ''; }
    if (autores.indexOf(ultimo) < 0) ultimo = autores[0];
    h += '<textarea class="form-textarea" id="qdt-com-txt" rows="2" placeholder="Escreva um comentário (Cmd+Enter para enviar)" style="margin-top:8px"></textarea>';
    h += '<div class="qdt-linha"><select class="form-select" id="qdt-com-aut" style="width:auto">' + autores.map(function (p) { return '<option value="' + esc(p) + '"' + (p === ultimo ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select><button class="btn btn-primary btn-sm" data-qdt="com-add">Comentar</button></div>';
    return h + '</div>';
  }
  function onDetChange(e) {
    var el = e.target; if (!el.classList) return;
    var ctx = ctxDetalhe(); if (!ctx) return;
    if (el.classList.contains('qdt-desc')) { ctx.it.descricao = el.value; salvar(); return; }
    if (el.classList.contains('qdt-chk')) { toggleSub(ctx.it, el.dataset.id); depoisDet(ctx.id); return; }
    if (el.classList.contains('qdt-subdata')) {
      var sd = achaSub(ctx.it, el.dataset.id);
      if (sd) { if (el.value) sd.data = el.value; else delete sd.data; depoisDet(ctx.id); }
      return;
    }
    if (el.classList.contains('qdt-subnome')) {
      if (!renameSub(ctx.it, el.dataset.id, el.value)) { var s = achaSub(ctx.it, el.dataset.id); el.value = s ? s.nome : ''; }
      else salvar();
      return;
    }
    if (el.id === 'qdt-com-aut') { try { localStorage.setItem('qd_autor', el.value); } catch (err) { /* ignorar */ } }
  }

  function injetarCSSF4() {
    if ($('qdf4-css')) return;
    var css = [
      '.qdt-sub input.qdt-subdata{flex:0 0 auto;width:132px;border:1.5px solid var(--border-light);border-radius:8px;padding:4px 6px;font-family:inherit;font-size:11px;color:var(--text-secondary);background:var(--surface)}',
      '.qdt-sub input.qdt-subdata.atr{color:var(--rosa-antigo);border-color:var(--rosa-antigo)}',
      '.qdt-sub.feito input.qdt-subdata{opacity:.5}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'qdf4-css'; st.textContent = css; document.head.appendChild(st);
  }
  function ligarFase4() { injetarCSSF4(); instalarModoDiaF4(); }

  function testeFase4() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var hoje = '2026-11-12';
    function est() {
      var e = novoEstado(); var q = criarQuadro(e, 'F4', ['Ana', 'Bia']);
      var A = { e: e, q: q, cs: q.colunas[0], cpr: q.colunas[1], cpe: q.colunas[2], g1: q.grupos[0] };
      A.g2 = criarGrupo(e, q, 'Feitos');
      A.it = criarItem(e, q, A.g1, 'Reel');
      return A;
    }
    var m = { id: 'r', ativa: true, quando: { opcaoId: 'x' }, acao: { tipo: 'mover', grupoId: 'g' } };
    migrarRegra(m);
    ok('regra antiga é lida no formato novo', m.gatilho.tipo === 'virar' && m.gatilho.opcaoId === 'x' && m.acoes.length === 1 && m.acoes[0].tipo === 'mover');

    var A = est();
    A.q.automacoes = [{ id: 'a1', ativa: true, gatilho: { tipo: 'virar', opcaoId: A.cs.opcoes[4].id }, acoes: [{ tipo: 'arquivar' }] }];
    aplicarAutomacoes(A.e, hoje); setValor(A.e, A.it, A.cs.id, A.cs.opcoes[4].id);
    ok('virar Concluído arquiva o item', aplicarAutomacoes(A.e, hoje) === 1 && A.it.arquivado === true);
    ok('o item já arquivado não dispara de novo', aplicarAutomacoes(A.e, hoje) === 0);

    var B = est();
    B.q.automacoes = [{ id: 'b1', ativa: true, gatilho: { tipo: 'virar', opcaoId: B.cs.opcoes[1].id }, acoes: [{ tipo: 'definir', colId: B.cpr.id, opcaoId: B.cpr.opcoes[0].id }, { tipo: 'atribuir', pessoa: 'Ana' }] }];
    aplicarAutomacoes(B.e, hoje); setValor(B.e, B.it, B.cs.id, B.cs.opcoes[1].id);
    ok('uma regra pode combinar várias ações', aplicarAutomacoes(B.e, hoje) === 2 && B.it.valores[B.cpr.id] === B.cpr.opcoes[0].id && B.it.valores[B.cpe.id] === 'Ana');

    var C = est(); setValor(C.e, C.it, C.cpe.id, 'Bia');
    C.q.automacoes = [{ id: 'c1', ativa: true, gatilho: { tipo: 'virar', opcaoId: C.cs.opcoes[1].id }, condicao: { colId: C.cpe.id, valor: 'Ana' }, acoes: [{ tipo: 'arquivar' }] }];
    aplicarAutomacoes(C.e, hoje); setValor(C.e, C.it, C.cs.id, C.cs.opcoes[1].id);
    ok('a condição extra impede quando o responsável é outro', aplicarAutomacoes(C.e, hoje) === 0 && !C.it.arquivado);
    var C2 = est(); setValor(C2.e, C2.it, C2.cpe.id, 'Ana');
    C2.q.automacoes = [{ id: 'c2', ativa: true, gatilho: { tipo: 'virar', opcaoId: C2.cs.opcoes[1].id }, condicao: { colId: C2.cpe.id, valor: 'Ana' }, acoes: [{ tipo: 'arquivar' }] }];
    aplicarAutomacoes(C2.e, hoje); setValor(C2.e, C2.it, C2.cs.id, C2.cs.opcoes[1].id);
    ok('a condição extra deixa passar quando é o responsável certo', aplicarAutomacoes(C2.e, hoje) === 1 && C2.it.arquivado === true);

    var D = est();
    D.q.automacoes = [{ id: 'd1', ativa: true, gatilho: { tipo: 'parado', opcaoId: D.cs.opcoes[4].id, dias: 3 }, acoes: [{ tipo: 'arquivar' }] }];
    setValor(D.e, D.it, D.cs.id, D.cs.opcoes[4].id); aplicarAutomacoes(D.e, '2026-11-01');
    ok('parado: a data de entrada no status é guardada', D.it._desde === '2026-11-01');
    ok('parado: antes dos dias combinados não faz nada', avaliarParados(D.e, '2026-11-03') === 0 && !D.it.arquivado);
    ok('parado: depois dos dias combinados executa a ação (arquivar)', avaliarParados(D.e, '2026-11-04') >= 1 && D.it.arquivado === true);

    var E = est();
    E.q.automacoes = [{ id: 'e1', ativa: true, gatilho: { tipo: 'parado', opcaoId: E.cs.opcoes[1].id, dias: 2 }, acoes: [{ tipo: 'criar', grupoId: E.g2.id, titulo: 'Cobrar {nome}', copiarResp: false }] }];
    setValor(E.e, E.it, E.cs.id, E.cs.opcoes[1].id); aplicarAutomacoes(E.e, '2026-11-01');
    avaliarParados(E.e, '2026-11-04');
    ok('parado: a ação roda uma vez por permanência no status', E.g2.itens.length === 1 && E.g2.itens[0].nome === 'Cobrar Reel');
    avaliarParados(E.e, '2026-11-05');
    ok('parado: não repete enquanto o item continua no mesmo status', E.g2.itens.length === 1);
    setValor(E.e, E.it, E.cs.id, E.cs.opcoes[0].id); aplicarAutomacoes(E.e, '2026-11-06');
    setValor(E.e, E.it, E.cs.id, E.cs.opcoes[1].id); aplicarAutomacoes(E.e, '2026-11-07');
    avaliarParados(E.e, '2026-11-09');
    ok('parado: ao voltar para o status, a regra vale de novo', E.g2.itens.length === 2);

    var F = est();
    F.q.automacoes = [{ id: 'f1', ativa: true, gatilho: { tipo: 'parado', opcaoId: F.cs.opcoes[1].id, dias: 5 }, acoes: [{ tipo: 'alerta' }] }];
    setValor(F.e, F.it, F.cs.id, F.cs.opcoes[1].id); aplicarAutomacoes(F.e, '2026-11-01');
    ok('alerta: antes dos dias combinados não aparece', tarefasAlertas(F.e, '2026-11-05').length === 0);
    var tf = tarefasAlertas(F.e, '2026-11-06');
    ok('alerta: com 5 dias no status vira tarefa no Modo Dia', tf.length === 1 && tf[0].id.indexOf('qa_' + F.it.id + '_f1') === 0 && tf[0].text.indexOf('Reel') === 0 && tf[0].text.indexOf('5 dias') > -1 && tf[0].type === 'hoje');
    ok('alerta: uma regra só de alerta não grava nada nos dados', avaliarParados(F.e, '2026-11-06') === 0);
    F.q.automacoes[0].gatilho.dias = 1;
    var t1 = tarefasAlertas(F.e, '2026-11-02');
    ok('alerta: singular "1 dia"', t1.length === 1 && t1[0].text.indexOf('1 dia') > -1 && t1[0].text.indexOf('1 dias') < 0);
    F.q.automacoes[0].acoes = [{ tipo: 'alerta', urgente: true, texto: 'Atenção: {nome}' }];
    var tu = tarefasAlertas(F.e, '2026-11-06');
    ok('alerta: urgente e com texto próprio', tu.length === 1 && tu[0].type === 'urgente' && tu[0].priority === 1 && tu[0].text === 'Atenção: Reel');
    F.q.automacoes[0].gatilho = { tipo: 'virar', opcaoId: F.cs.opcoes[1].id };
    ok('alerta com "virar" aparece enquanto o item estiver no status', tarefasAlertas(F.e, '2026-11-20').length === 1);
    F.it.arquivado = true;
    ok('item arquivado não gera alerta', tarefasAlertas(F.e, '2026-11-20').length === 0);

    function estSub() {
      var S = est(); addSub(S.it, 'Gravar'); addSub(S.it, 'Editar'); addSub(S.it, 'Postar'); addSub(S.it, 'Sem data');
      S.it.subitens[0].data = '2026-11-10'; S.it.subitens[1].data = '2026-11-12'; S.it.subitens[2].data = '2026-11-20';
      return S;
    }
    var S1 = estSub(); var ts = tarefasSubitens(S1.e, hoje);
    var tGravar = ts.filter(function (x) { return x.text === 'Gravar'; })[0], tEditar = ts.filter(function (x) { return x.text === 'Editar'; })[0];
    ok('subitem vencido vira tarefa urgente e o de hoje vira pendência do dia', ts.length === 2 && tGravar.type === 'urgente' && tGravar.priority === 1 && tGravar.sub.indexOf('venceu há 2 dias') > -1 && tEditar.type === 'hoje' && tEditar.sub.indexOf('vence hoje') > -1);
    ok('subitem futuro ou sem data não vira tarefa', ts.every(function (x) { return x.text !== 'Postar' && x.text !== 'Sem data'; }));
    ok('a tarefa do subitem mostra o item, o quadro e o grupo e abre o item', tGravar.sub.indexOf('Subitem de \u201CReel\u201D \u00B7 F4 \u00B7') === 0 && tGravar.action.indexOf('QuadrosAbrirItem(') === 0 && tGravar.id === 'qs_' + S1.it.id + '_' + S1.it.subitens[0].id);
    ok('marcar e desmarcar o subitem grava o feito e a data', marcarSubitem(S1.e, S1.it.id, S1.it.subitens[0].id, true, hoje) === true && S1.it.subitens[0].feito === true && S1.it.subitens[0].feitoEm === hoje && marcarSubitem(S1.e, S1.it.id, S1.it.subitens[0].id, false, hoje) === true && S1.it.subitens[0].feito === false && S1.it.subitens[0].feitoEm === undefined && marcarSubitem(S1.e, 'zzz', 'y', true, hoje) === false);
    marcarSubitem(S1.e, S1.it.id, S1.it.subitens[0].id, true, hoje);
    var ts2 = tarefasSubitens(S1.e, hoje);
    ok('subitem concluído hoje continua na lista como concluído', ts2.some(function (x) { return x.text === 'Gravar' && x.sub.indexOf('concluído hoje') > -1; }) && ts2.length === 2);
    var S2 = estSub(); setValor(S2.e, S2.it, S2.cs.id, S2.cs.opcoes[4].id);
    ok('item concluído esconde os subitens pendentes', tarefasSubitens(S2.e, hoje).length === 0);
    var S3 = estSub(); var ag = itensAgendaSubitens(S3.e, hoje);
    ok('agenda leva os subitens de hoje em diante, sem os concluídos', ag.length === 2 && ag.map(function (x) { return x.date; }).sort().join() === '2026-11-12,2026-11-20' && ag[0].cat.indexOf('subitem de Reel') > -1);

    var X = est(); X.q.automacoes = [
      { id: 'x1', ativa: true, gatilho: { tipo: 'virar', opcaoId: X.cs.opcoes[4].id }, acoes: [{ tipo: 'arquivar' }] },
      { id: 'x2', ativa: true, gatilho: { tipo: 'parado', opcaoId: X.cs.opcoes[1].id, dias: 5 }, condicao: { colId: X.cpe.id, valor: 'Ana' }, acoes: [{ tipo: 'alerta', urgente: true }, { tipo: 'atribuir', pessoa: 'Bia' }] },
      { id: 'x3', ativa: true, quando: { opcaoId: X.cs.opcoes[4].id }, acao: { tipo: 'mover', grupoId: X.g2.id } }
    ];
    var dx = X.q.automacoes.map(function (rx) { return descreverAutomacao(X.q, rx); });
    ok('descrições: virar, parado com condição e várias ações, regra antiga', dx[0] === 'Quando o status virar \u201C' + X.cs.opcoes[4].nome + '\u201D, arquivar o item' && dx[1] === 'Quando o item ficar 5 dias em \u201C' + X.cs.opcoes[1].nome + '\u201D e Responsável for \u201CAna\u201D, criar um alerta no Modo Dia (urgente) e atribuir a Bia' && dx[2] === 'Quando o status virar \u201C' + X.cs.opcoes[4].nome + '\u201D, mover o item para \u201CFeitos\u201D');

    var Y = est(); delete Y.it._desde;
    ok('itens sem a data de entrada no status recebem a de hoje', avaliarParados(Y.e, hoje) >= 1 && Y.it._desde === hoje);
    var Z = est(); var itz = Z.it; itz.subitens = [{ id: 's1', nome: '<b>x</b>', feito: false, data: '2026-11-01' }];
    var hz = corpoDetalhe({ q: Z.q, g: Z.g1, it: itz });
    ok('o painel do item mostra a data do subitem (atrasada em destaque) e escapa o texto', hz.indexOf('class="qdt-subdata atr"') > -1 && hz.indexOf('value="2026-11-01"') > -1 && hz.indexOf('<b>x</b>') < 0);
    ok('SISTEMA: automações combinadas e abrir item disponíveis', typeof window.QuadrosAbrirItem === 'function' && typeof avaliarParados === 'function' && typeof tarefasAlertas === 'function');
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS-FASE4: ' + r.length + ' testes, 0 falhas' : 'QUADROS-FASE4: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  window.QuadrosFase4Teste = testeFase4;
  ligarFase4();
  window.QuadrosFase3Teste = testeFase3;
  ligarFase3();
  window.QuadrosDetalheTeste = testeDetalhe;
  window.QuadrosTeste = teste;
  window.Quadros = { estado: Q, abrir: function () { go('quadros'); } };

  injetarCSS();
  ligarEventos();
  instalarMenu();
  ligarDetalhe();
  envolverRender();
})();
