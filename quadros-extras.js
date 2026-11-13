/* ============================================================
   MUNDANA · QUADROS — integração com o dia a dia (Fase 2A)
   Instalação: no index.html, DEPOIS do quadros.js e antes de </body>:
       <script src="quadros-extras.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha.
   Autoteste: no console (F12) digite  QuadrosExtrasTeste()
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof getModoDiaTasks !== 'function' || typeof rDash !== 'function' || typeof getAlerts !== 'function') {
    console.error('quadros-extras.js: carregue este arquivo DEPOIS do script principal do sistema.');
    return;
  }
  if (!window.Quadros) {
    console.error('quadros-extras.js: carregue este arquivo DEPOIS do quadros.js.');
    return;
  }

  /* ---------------- utilidades ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtCurta(iso) {
    if (!iso || String(iso).length < 10) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1];
  }
  function diasEntre(a, b) {
    return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000);
  }

  /* ---------------- acesso aos quadros (mesmo mecanismo do quadros.js) ---------------- */
  function lerEstado() {
    var d = null;
    try { d = DB.get('quadros'); } catch (e) { d = null; }
    if (d && !Array.isArray(d) && Array.isArray(d.quadros)) return d;
    return { versao: 1, atual: null, quadros: [] };
  }
  function gravarEstado(est) {
    DB.set('quadros', { versao: 1, atual: est.atual || null, quadros: est.quadros });
  }

  /* ---------------- núcleo (sem DOM, testável) ---------------- */
  function colPorTipo(q, tipo) {
    var r = null;
    (q.colunas || []).forEach(function (c) { if (!r && c.tipo === tipo) r = c; });
    return r;
  }
  function opcaoPorId(col, id) {
    if (!col || !col.opcoes) return null;
    for (var i = 0; i < col.opcoes.length; i++) { if (col.opcoes[i].id === id) return col.opcoes[i]; }
    return null;
  }
  function statusFinal(q, it) {
    var cs = colPorTipo(q, 'status');
    if (!cs) return false;
    var o = opcaoPorId(cs, it.valores[cs.id]);
    return !!(o && o.final);
  }

  /* Lista plana de itens com classificação de prazo. */
  function coletar(est, hoje) {
    var out = [];
    (est.quadros || []).forEach(function (q) {
      if (q.arquivado) return;
      var datasCols = (q.colunas || []).filter(function (c) { return c.tipo === 'data'; });
      var cp = colPorTipo(q, 'pessoa');
      (q.grupos || []).forEach(function (g) {
        if (g.arquivado) return;
        (g.itens || []).forEach(function (it) {
          if (it.arquivado) return;
          var valores = it.valores || {};
          var datas = datasCols.map(function (c) { return valores[c.id]; }).filter(Boolean);
          var final = statusFinal(q, it);
          var passadas = datas.filter(function (d) { return d < hoje; }).sort();
          var futuras = datas.filter(function (d) { return d > hoje; }).sort();
          var x = { q: q, g: g, it: it, final: final, resp: cp ? (valores[cp.id] || '') : '' };
          x.atrasado = !final && passadas.length > 0;
          x.hoje = !final && !x.atrasado && datas.indexOf(hoje) > -1;
          x.proximo = !final && !x.atrasado && !x.hoje && futuras.length > 0;
          x.dataRef = x.atrasado ? passadas[0] : (x.hoje ? hoje : (x.proximo ? futuras[0] : ''));
          x.datas = datas;
          out.push(x);
        });
      });
    });
    return out;
  }

  function tarefasModoDia(est, hoje) {
    var tasks = [];
    coletar(est, hoje).forEach(function (x) {
      var base = {
        cat: 'Quadros', catColor: 'purple', id: 'qd_' + x.it.id,
        action: "QuadrosExtras.abrir('" + x.q.id + "')", btnLabel: 'Abrir quadro'
      };
      var onde = x.q.nome + ' \u00B7 ' + x.g.nome + (x.resp ? ' \u00B7 ' + x.resp : '');
      function com(extra) { var t = {}; var k; for (k in base) t[k] = base[k]; for (k in extra) t[k] = extra[k]; return t; }
      if (x.final) {
        if (x.it._mdFeito === hoje) tasks.push(com({ priority: 2, type: 'hoje', text: x.it.nome, sub: onde + ' \u00B7 concluído hoje' }));
        return;
      }
      if (x.atrasado) {
        var dias = diasEntre(x.dataRef, hoje);
        tasks.push(com({ priority: 1, type: 'urgente', text: x.it.nome, sub: onde + ' \u00B7 venceu há ' + dias + ' dia' + (dias !== 1 ? 's' : '') }));
      } else if (x.hoje) {
        tasks.push(com({ priority: 2, type: 'hoje', text: x.it.nome, sub: onde + ' \u00B7 vence hoje' }));
      }
    });
    return tasks;
  }

  function agendaItens(est, hoje) {
    var out = [];
    coletar(est, hoje).forEach(function (x) {
      if (x.final) return;
      x.datas.forEach(function (d) {
        if (d >= hoje) out.push({ date: d, text: x.it.nome, tipo: 'normal', cat: 'Quadros \u00B7 ' + x.q.nome, id: 'qd_' + x.it.id });
      });
    });
    return out;
  }

  function resumo(est, hoje) {
    var atr = 0, hj = 0, prox = 0, lista = [];
    coletar(est, hoje).forEach(function (x) {
      if (x.final) return;
      var ordem = -1;
      if (x.atrasado) { atr++; ordem = 0; }
      else if (x.hoje) { hj++; ordem = 1; }
      else if (x.proximo && diasEntre(hoje, x.dataRef) <= 7) { prox++; ordem = 2; }
      if (ordem >= 0) lista.push({ ordem: ordem, x: x });
    });
    lista.sort(function (a, b) {
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return a.x.dataRef < b.x.dataRef ? -1 : (a.x.dataRef > b.x.dataRef ? 1 : 0);
    });
    return { atrasados: atr, hoje: hj, proximos: prox, lista: lista };
  }

  /* Marca como concluído (status final) guardando o status anterior. */
  function acharItem(est, itemId) {
    var r = null;
    (est.quadros || []).forEach(function (q) {
      (q.grupos || []).forEach(function (g) {
        (g.itens || []).forEach(function (it) { if (it.id === itemId) r = { q: q, g: g, it: it }; });
      });
    });
    return r;
  }
  function marcarConcluido(est, itemId, hoje) {
    var a = acharItem(est, itemId); if (!a) return false;
    var cs = colPorTipo(a.q, 'status'); if (!cs || !cs.opcoes || !cs.opcoes.length) return false;
    var fin = null;
    cs.opcoes.forEach(function (o) { if (!fin && o.final) fin = o; });
    if (!fin) fin = cs.opcoes[cs.opcoes.length - 1];
    var atual = a.it.valores[cs.id];
    if (atual !== fin.id) a.it._statusAntes = atual;
    a.it.valores[cs.id] = fin.id;
    a.it._mdFeito = hoje;
    return true;
  }
  function reabrir(est, itemId) {
    var a = acharItem(est, itemId); if (!a) return false;
    var cs = colPorTipo(a.q, 'status'); if (!cs || !cs.opcoes || !cs.opcoes.length) return false;
    var volta = a.it._statusAntes;
    if (!opcaoPorId(cs, volta)) volta = cs.opcoes[0].id;
    a.it.valores[cs.id] = volta;
    delete a.it._statusAntes;
    delete a.it._mdFeito;
    return true;
  }

  function htmlCard(est, hoje) {
    var temQuadro = (est.quadros || []).some(function (q) { return !q.arquivado; });
    if (!temQuadro) return '';
    var r = resumo(est, hoje);
    var cores = ['var(--rosa-antigo)', 'var(--sol-ancestral)', 'var(--lavanda)'];
    function caixa(rot, n, cor) {
      return '<div style="flex:1;background:var(--bg-warm);border-radius:var(--radius-md);padding:12px 14px;text-align:center"><div style="font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:' + cor + ';font-weight:700;margin-bottom:2px">' + rot + '</div><div style="font-size:20px;font-weight:800;color:' + cor + '">' + n + '</div></div>';
    }
    var linhas = r.lista.slice(0, 6).map(function (e) {
      var x = e.x;
      var rotulo = e.ordem === 1 ? 'hoje' : (e.ordem === 0 ? 'venceu ' + fmtCurta(x.dataRef) : fmtCurta(x.dataRef));
      return '<div class="activity-item" style="cursor:pointer" onclick="QuadrosExtras.abrir(\'' + x.q.id + '\')"><div class="activity-dot" style="background:' + cores[e.ordem] + '"></div><div class="activity-text"><strong>' + esc(x.it.nome) + '</strong> <span style="color:var(--text-muted)">\u00B7 ' + esc(x.q.nome) + ' \u00B7 ' + esc(x.g.nome) + '</span></div><div class="activity-time">' + esc(rotulo) + '</div></div>';
    }).join('');
    if (!linhas) linhas = '<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:13px">Nenhum item com prazo nos próximos 7 dias</div>';
    return '<div class="card anim d2" id="qd-dash-card" style="margin-bottom:22px;border-left:3px solid var(--rosa-antigo)">' +
      '<div class="card-header"><h3>Quadros \u00B7 prazos</h3><span style="font-size:12px;color:var(--rosa-antigo);cursor:pointer;font-weight:600" onclick="go(\'quadros\')">Abrir Quadros</span></div>' +
      '<div class="card-body"><div style="display:flex;gap:12px;margin-bottom:14px">' +
      caixa('Atrasados', r.atrasados, cores[0]) + caixa('Hoje', r.hoje, cores[1]) + caixa('Próximos 7 dias', r.proximos, cores[2]) +
      '</div>' + linhas + '</div></div>';
  }

  /* ---------------- ligação com o sistema ---------------- */
  function abrir(quadroId) {
    var est = lerEstado();
    var existe = est.quadros.some(function (q) { return q.id === quadroId; });
    if (existe) { est.atual = quadroId; gravarEstado(est); }
    go('quadros');
  }

  function sincronizarToggle(taskId) {
    var itemId = String(taskId).slice(3);
    var feitos = [];
    try { feitos = JSON.parse(localStorage.getItem('mundana_mododia_done_' + hojeISO()) || '[]'); } catch (e) { feitos = []; }
    var feito = feitos.indexOf(taskId) > -1;
    var est = lerEstado();
    var mudou = feito ? marcarConcluido(est, itemId, hojeISO()) : reabrir(est, itemId);
    if (mudou) gravarEstado(est);
  }

  var gmdOrig = window.getModoDiaTasks;
  window.getModoDiaTasks = function () {
    var tasks = gmdOrig.apply(this, arguments);
    try {
      tarefasModoDia(lerEstado(), hojeISO()).forEach(function (t) { tasks.push(t); });
      tasks.sort(function (a, b) { return a.priority - b.priority; });
    } catch (e) { console.error('quadros-extras: Modo Dia', e); }
    return tasks;
  };
  window.getModoDiaTasks._qdx = true;

  if (typeof window.toggleModoDiaTask === 'function') {
    var toggleOrig = window.toggleModoDiaTask;
    window.toggleModoDiaTask = function (id) {
      var r = toggleOrig.apply(this, arguments);
      try { if (String(id).indexOf('qd_') === 0) sincronizarToggle(String(id)); } catch (e) { console.error('quadros-extras: concluir', e); }
      return r;
    };
    window.toggleModoDiaTask._qdx = true;
  }

  var gaOrig = window.getAlerts;
  window.getAlerts = function () {
    var a = gaOrig.apply(this, arguments);
    try {
      var h = hojeISO(); var r = resumo(lerEstado(), h);
      if (r.atrasados > 0) a.push({ key: 'qd_atr_' + h + '_' + r.atrasados, type: 'rosa-antigo', text: '<strong>' + r.atrasados + '</strong> item' + (r.atrasados > 1 ? 'ns' : '') + ' atrasado' + (r.atrasados > 1 ? 's' : '') + ' em Quadros' });
      if (r.hoje > 0) a.push({ key: 'qd_hoje_' + h + '_' + r.hoje, type: 'sol-ancestral', text: '<strong>' + r.hoje + '</strong> item' + (r.hoje > 1 ? 'ns' : '') + ' de Quadros vence' + (r.hoje > 1 ? 'm' : '') + ' hoje' });
    } catch (e) { console.error('quadros-extras: alertas', e); }
    return a;
  };
  window.getAlerts._qdx = true;

  if (typeof window.mdWeekBuildItems === 'function') {
    var mwOrig = window.mdWeekBuildItems;
    window.mdWeekBuildItems = function () {
      var items = mwOrig.apply(this, arguments);
      try { agendaItens(lerEstado(), hojeISO()).forEach(function (i) { items.push(i); }); } catch (e) { console.error('quadros-extras: agenda', e); }
      return items;
    };
    window.mdWeekBuildItems._qdx = true;
  }

  var rdOrig = window.rDash;
  window.rDash = function () {
    var r = rdOrig.apply(this, arguments);
    try {
      if (typeof S !== 'undefined' && S.page !== 'dashboard') return r;
      var c = document.getElementById('content'); if (!c) return r;
      var antigo = document.getElementById('qd-dash-card'); if (antigo) antigo.parentNode.removeChild(antigo);
      var html = htmlCard(lerEstado(), hojeISO());
      if (!html) return r;
      var stat = c.querySelector('.stat-card');
      if (stat && stat.parentNode) stat.parentNode.insertAdjacentHTML('afterend', html);
      else c.insertAdjacentHTML('beforeend', html);
    } catch (e) { console.error('quadros-extras: dashboard', e); }
    return r;
  };
  window.rDash._qdx = true;

  /* ---------------- autoteste (console: QuadrosExtrasTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var hoje = '2026-11-12';
    var cSt = { id: 'cs', nome: 'Status', tipo: 'status', opcoes: [{ id: 'o1', nome: 'Não iniciado', cor: '#999' }, { id: 'o2', nome: 'Em andamento', cor: '#be9c60' }, { id: 'o3', nome: 'Concluído', cor: '#5c7161', final: true }] };
    var cDt = { id: 'cd', nome: 'Prazo', tipo: 'data' };
    var cPe = { id: 'cp', nome: 'Responsável', tipo: 'pessoa' };
    var est = { versao: 1, atual: 'q1', quadros: [{ id: 'q1', nome: 'Teste', colunas: [cSt, cDt, cPe], pessoas: ['Ana'], arquivado: false, grupos: [{ id: 'g1', nome: 'Grupo', cor: '#b17a7f', aberto: true, arquivado: false, itens: [
      { id: 'i1', nome: 'Atrasado', valores: { cs: 'o2', cd: '2026-11-10', cp: 'Ana' }, arquivado: false },
      { id: 'i2', nome: 'Hoje', valores: { cs: 'o1', cd: '2026-11-12' }, arquivado: false },
      { id: 'i3', nome: 'Futuro', valores: { cs: 'o1', cd: '2026-11-15' }, arquivado: false },
      { id: 'i4', nome: 'Concluído e vencido', valores: { cs: 'o3', cd: '2026-11-01' }, arquivado: false },
      { id: 'i5', nome: 'Arquivado', valores: { cs: 'o1', cd: '2026-11-01' }, arquivado: true },
      { id: 'i6', nome: 'Sem data', valores: { cs: 'o1' }, arquivado: false },
      { id: 'i7', nome: 'Longe', valores: { cs: 'o1', cd: '2026-12-30' }, arquivado: false }
    ] }] }] };
    var t = tarefasModoDia(est, hoje);
    ok('gera 2 tarefas (atrasado e hoje)', t.length === 2);
    ok('o atrasado é urgente e vem com prioridade 1', t.filter(function (x) { return x.text === 'Atrasado'; })[0].type === 'urgente' && t.filter(function (x) { return x.text === 'Atrasado'; })[0].priority === 1);
    ok('o de hoje é pendência do dia', t.filter(function (x) { return x.text === 'Hoje'; })[0].type === 'hoje');
    ok('mostra há quantos dias venceu', t.filter(function (x) { return x.text === 'Atrasado'; })[0].sub.indexOf('venceu há 2 dias') > -1);
    ok('mostra quadro, grupo e responsável', t.filter(function (x) { return x.text === 'Atrasado'; })[0].sub.indexOf('Teste \u00B7 Grupo \u00B7 Ana') === 0);
    ok('ids começam com qd_', t.every(function (x) { return x.id.indexOf('qd_') === 0; }));
    ok('futuro, concluído, arquivado e sem data não geram tarefa', t.every(function (x) { return ['Futuro', 'Concluído e vencido', 'Arquivado', 'Sem data', 'Longe'].indexOf(x.text) < 0; }));
    var ag = agendaItens(est, hoje);
    ok('agenda traz hoje e os futuros, sem concluídos nem vencidos', ag.length === 3 && ag.every(function (i) { return i.date >= hoje; }));
    var rs = resumo(est, hoje);
    ok('resumo conta atrasados, hoje e próximos 7 dias', rs.atrasados === 1 && rs.hoje === 1 && rs.proximos === 1);
    ok('lista do resumo vem em ordem de urgência', rs.lista[0].x.it.nome === 'Atrasado' && rs.lista[1].x.it.nome === 'Hoje');
    ok('marcar concluído muda o status e guarda o anterior', marcarConcluido(est, 'i1', hoje) && est.quadros[0].grupos[0].itens[0].valores.cs === 'o3' && est.quadros[0].grupos[0].itens[0]._statusAntes === 'o2');
    var t2 = tarefasModoDia(est, hoje);
    ok('concluído hoje pelo Modo Dia continua aparecendo como feito', t2.some(function (x) { return x.text === 'Atrasado' && x.sub.indexOf('concluído hoje') > -1; }));
    ok('reabrir devolve o status anterior', reabrir(est, 'i1') && est.quadros[0].grupos[0].itens[0].valores.cs === 'o2' && est.quadros[0].grupos[0].itens[0]._mdFeito === undefined);
    ok('item inexistente não quebra', marcarConcluido(est, 'zzz', hoje) === false && reabrir(est, 'zzz') === false);
    var h = htmlCard(est, hoje);
    ok('cartão do dashboard é gerado com os números', h.indexOf('Quadros') > -1 && h.indexOf('Atrasados') > -1 && h.indexOf('Atrasado') > -1);
    ok('sem quadros, o cartão não aparece', htmlCard({ quadros: [] }, hoje) === '');
    ok('SISTEMA: Modo Dia integrado', window.getModoDiaTasks._qdx === true);
    ok('SISTEMA: alertas integrados', window.getAlerts._qdx === true);
    ok('SISTEMA: dashboard integrado', window.rDash._qdx === true);
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'QUADROS-EXTRAS: ' + r.length + ' testes, 0 falhas' : 'QUADROS-EXTRAS: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  window.QuadrosExtras = { abrir: abrir };
  window.QuadrosExtrasTeste = teste;

  if (typeof renderNav === 'function') { try { renderNav(); } catch (e) { /* ignorar */ } }
})();
