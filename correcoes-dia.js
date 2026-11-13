/* ============================================================
   MUNDANA · CORREÇÕES — Lote 2: dia a dia
   Instalação: no index.html, DEPOIS do correcoes.js e antes de </body>:
       <script src="correcoes-dia.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha.
   Autoteste: no console (F12) digite  CorrecoesDiaTeste()

   O que corrige:
   A5  Lembretes sem repetição que não foram feitos no dia agora continuam no Modo
       Dia como "atrasados" até você marcar. O "feito" fica guardado no lembrete.
   A6  O Modo Dia desenha na hora, sem esperar a internet; a sincronização com o
       servidor acontece depois, em segundo plano.
   --  Desmarcar uma tarefa no Modo Dia agora vale para todas (antes o ok voltava sozinho).
   M7  A busca de A Pagar, Banco de Ideias e Roteiros não perde mais o foco a cada letra.
   M1  Autocomplete de fornecedor no A Pagar (a função não existia).
   M4  Link do WhatsApp nos Leads usa só os dígitos do telefone.
   M5  Precificação > Configurações aceita 0 (antes 0 virava o valor padrão).
   M12 "1 mensagen" vira "1 mensagem" em Roteiros.
   M15 Botão Configurações da Precificação usa o ícone do sistema.
   M2/M3 Visualização da Fórmula: botões Duplicar/Editar e passos do preparo.
   Extra: SerieMensalPrevia('Circes', 5) e SerieMensalAplicar('Circes', 5) refazem
       séries de recorrência "personalizado" como mensais no dia escolhido.
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof sbFetch !== 'function' || typeof getModoDiaTasks !== 'function' ||
      typeof toggleModoDiaTask !== 'function' || typeof rModoDia !== 'function' || typeof localDateStr !== 'function') {
    console.error('correcoes-dia.js: carregue este arquivo DEPOIS do script principal e do correcoes.js.');
    return;
  }
  if (window.__correcoesDia) { return; }
  window.__correcoesDia = true;

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function normalizar(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function diasEntreISO(a, b) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000); }

  var PREFIXO_FEITOS = 'mundana_mododia_done_';
  function lerFeitos() {
    try { return JSON.parse(localStorage.getItem(PREFIXO_FEITOS + localDateStr()) || '[]'); } catch (e) { return []; }
  }

  /* ---------------- A5: lembretes que não foram feitos ---------------- */
  var cacheMapa = { t: 0, m: {} };
  function mapaFeitos(forcar) {
    var agora = Date.now();
    if (!forcar && agora - cacheMapa.t < 3000) return cacheMapa.m;
    var m = {};
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf(PREFIXO_FEITOS) !== 0) return;
      var arr; try { arr = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
      if (Array.isArray(arr)) arr.forEach(function (id) {
        var s = String(id);
        if (s.indexOf('lembrete_') === 0) m[s.slice(9)] = k.slice(PREFIXO_FEITOS.length);
      });
    });
    cacheMapa = { t: agora, m: m };
    return m;
  }

  /* "feito" guardado no lembrete vale mais que o histórico dos dias; sem ele, vale o histórico (lembretes antigos). */
  function lembreteConcluido(l, mapa) {
    if (l.feito === true) return true;
    if (l.feito === false) return false;
    return !!(mapa && mapa[l.id]);
  }

  function tarefasLembretes(lembretes, hoje, mapa) {
    var out = [];
    (lembretes || []).forEach(function (l) {
      if (!l || !l.text || !l.date) return;
      if (l.repeat && l.repeat !== 'none') return;
      if (l.date >= hoje) return;
      var base = { cat: 'Lembrete', catColor: 'purple', action: "openLembreteModal('" + l.id + "')", btnLabel: 'Editar', id: 'lembrete_' + l.id, text: l.text };
      if (!lembreteConcluido(l, mapa)) {
        var dias = diasEntreISO(l.date, hoje);
        base.priority = 1; base.type = 'urgente';
        base.sub = 'Atrasado desde ' + fmtD(l.date) + ' \u00B7 ' + dias + ' dia' + (dias !== 1 ? 's' : '');
        out.push(base);
      } else if (l.feito === true && l.feitoEm === hoje) {
        base.priority = 2; base.type = 'hoje';
        base.sub = 'Concluído hoje \u00B7 era de ' + fmtD(l.date);
        out.push(base);
      }
    });
    return out;
  }

  function marcarLembrete(lista, id, concluindo, hoje) {
    var l = null;
    (lista || []).forEach(function (x) { if (x && x.id === id) l = x; });
    if (!l || (l.repeat && l.repeat !== 'none')) return false;
    if (concluindo) { l.feito = true; l.feitoEm = hoje; } else { l.feito = false; delete l.feitoEm; }
    return true;
  }

  var tasksAntes = window.getModoDiaTasks;
  window.getModoDiaTasks = function () {
    var tasks = tasksAntes.apply(this, arguments);
    try {
      var extra = tarefasLembretes(DB.get('lembretes'), localDateStr(), mapaFeitos(false));
      if (extra.length) {
        var ja = {}; tasks.forEach(function (t) { ja[t.id] = 1; });
        extra.forEach(function (t) { if (!ja[t.id]) tasks.push(t); });
        tasks.sort(function (a, b) { return a.priority - b.priority; });
      }
    } catch (e) { console.error('correcoes-dia: lembretes', e); }
    return tasks;
  };
  window.getModoDiaTasks._dia = true;

  /* ---------------- desmarcar vale para todas as tarefas ---------------- */
  async function tirarDoEspelho(taskId) {
    try {
      var chave = 'mododia_done_' + localDateStr();
      var res = await window.sbFetch('app_data?key=eq.' + chave, { method: 'GET' });
      var remoto = (res && res[0] && res[0].value) ? res[0].value : [];
      if (typeof remoto === 'string') remoto = JSON.parse(remoto);
      if (!Array.isArray(remoto) || remoto.indexOf(taskId) < 0) return;
      await window.sbFetch('app_data?key=eq.' + chave, {
        method: 'PATCH',
        body: { value: remoto.filter(function (x) { return x !== taskId; }) },
        headers: { 'Prefer': 'return=representation' }
      });
    } catch (e) { console.warn('correcoes-dia: espelho', e); }
  }

  var toggleAntes = window.toggleModoDiaTask;
  window.toggleModoDiaTask = function (id) {
    var self = this, args = arguments, tid = String(id);
    var desmarcando = lerFeitos().indexOf(tid) > -1;
    if (tid.indexOf('lembrete_') === 0) {
      try {
        var lista = DB.get('lembretes');
        if (marcarLembrete(lista, tid.slice(9), !desmarcando, localDateStr())) DB.set('lembretes', lista);
      } catch (e) { console.error('correcoes-dia: marcar lembrete', e); }
    }
    function seguir() {
      var r = toggleAntes.apply(self, args);
      cacheMapa.t = 0;
      return r;
    }
    if (desmarcando) return tirarDoEspelho(tid).then(seguir);
    return seguir();
  };
  window.toggleModoDiaTask._dia = true;

  /* ---------------- A6: Modo Dia desenha na hora ---------------- */
  var semRede = false;
  function deveIgnorarRede(flag, path, opts) {
    return !!flag && typeof path === 'string' && path.indexOf('app_data?key=eq.mododia_done_') === 0 && (!opts || !opts.method || opts.method === 'GET');
  }
  var sbAntes = window.sbFetch;
  window.sbFetch = function (path, opts) {
    if (deveIgnorarRede(semRede, path, opts)) return Promise.resolve([]);
    return sbAntes.apply(this, arguments);
  };

  var modoDiaAntes = window.rModoDia;
  var mesclando = false;
  async function mesclarEspelhoEmFundo() {
    if (mesclando) return;
    mesclando = true;
    try {
      var chave = PREFIXO_FEITOS + localDateStr();
      var res = await sbAntes('app_data?key=eq.mododia_done_' + localDateStr(), { method: 'GET' });
      var remoto = (res && res[0] && res[0].value) ? res[0].value : [];
      if (typeof remoto === 'string') remoto = JSON.parse(remoto);
      if (!Array.isArray(remoto)) return;
      var local = lerFeitos(), mudou = false;
      remoto.forEach(function (id) { if (local.indexOf(id) < 0) { local.push(id); mudou = true; } });
      if (mudou) {
        localStorage.setItem(chave, JSON.stringify(local));
        cacheMapa.t = 0;
        if (S.page === 'mododia') {
          semRede = true;
          try { modoDiaAntes.call(window); } finally { semRede = false; }
          if (typeof renderNav === 'function') renderNav();
        }
      }
    } catch (e) { console.warn('correcoes-dia: mesclar', e); } finally { mesclando = false; }
  }
  window.rModoDia = function () {
    var p;
    semRede = true;
    try { p = modoDiaAntes.apply(this, arguments); } finally { semRede = false; }
    mesclarEspelhoEmFundo();
    return p;
  };
  window.rModoDia._dia = true;

  /* ---------------- M7 e M12: busca sem perder o foco ---------------- */
  function corrigirMensagem(texto) { return String(texto || '').replace(/\b1 mensagen\b/, '1 mensagem'); }

  function protegerBusca(nome) {
    var orig = window[nome];
    if (typeof orig !== 'function') return;
    window[nome] = function () {
      var ativo = document.activeElement;
      var conteudo = document.getElementById('content');
      var guardar = !!(ativo && ativo.tagName === 'INPUT' && ativo.getAttribute('placeholder') === 'Buscar...' && conteudo && conteudo.contains(ativo));
      var ini = guardar ? ativo.selectionStart : 0, fim = guardar ? ativo.selectionEnd : 0;
      var r = orig.apply(this, arguments);
      if (guardar) {
        var novo = document.querySelector('#content input[placeholder="Buscar..."]');
        if (novo) { novo.focus(); try { novo.setSelectionRange(ini, fim); } catch (e) { /* ignorar */ } }
      }
      if (nome === 'rRoteiros') {
        var p = document.querySelector('#content .page-header-left p');
        if (p) p.textContent = corrigirMensagem(p.textContent);
      }
      return r;
    };
    window[nome]._dia = true;
  }
  protegerBusca('rPagar');
  protegerBusca('rIdeias');
  protegerBusca('rRoteiros');

  /* ---------------- M1: autocomplete de fornecedor no A Pagar ---------------- */
  function filtrarFornecedores(lista, q) {
    var n = normalizar(q);
    return (lista || []).filter(function (s) { return s && s.name && (!n || normalizar(s.name).indexOf(n) > -1); }).slice(0, 8);
  }
  window.searchSupplier = function (q) {
    var el = document.getElementById('pgFornList'); if (!el) return;
    var sups = filtrarFornecedores(DB.get('suppliers'), q);
    if (!sups.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = sups.map(function (s) {
      return '<div style="padding:7px 10px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--bg-warm)\'" onmouseout="this.style.background=\'\'" onclick="escolherFornecedorPagar(\'' + esc(s.id) + '\')">' + esc(s.name) + '</div>';
    }).join('');
  };
  window.escolherFornecedorPagar = function (id) {
    var s = null;
    DB.get('suppliers').forEach(function (x) { if (x.id === id) s = x; });
    var campo = document.getElementById('pgForn'), lista = document.getElementById('pgFornList');
    if (s && campo) campo.value = s.name;
    if (lista) lista.style.display = 'none';
  };
  document.addEventListener('click', function (e) {
    var l = document.getElementById('pgFornList'); if (!l) return;
    if (!e.target.closest || (!e.target.closest('#pgFornList') && e.target.id !== 'pgForn')) l.style.display = 'none';
  });

  /* ---------------- M4: link do WhatsApp dos Leads ---------------- */
  function corrigirHrefWhats(href) {
    var m = /^https:\/\/wa\.me\/55(.*)$/.exec(String(href || ''));
    if (!m) return href;
    return 'https://wa.me/55' + m[1].replace(/\D/g, '');
  }
  if (typeof window.rLeads === 'function') {
    var leadsAntes = window.rLeads;
    window.rLeads = async function () {
      var r = await leadsAntes.apply(this, arguments);
      try {
        [].slice.call(document.querySelectorAll('#leadsTable a[href^="https://wa.me/"]')).forEach(function (a) {
          a.setAttribute('href', corrigirHrefWhats(a.getAttribute('href')));
        });
      } catch (e) { console.warn('correcoes-dia: whatsapp', e); }
      return r;
    };
    window.rLeads._dia = true;
  }

  /* ---------------- M5 e M15: Precificação ---------------- */
  function numOu(el, padrao) {
    var v = parseFloat(el && el.value);
    return isNaN(v) ? padrao : v;
  }
  if (typeof window.savePricingConfig === 'function' && typeof getCfg === 'function') {
    window.savePricingConfig = function () {
      var cfg = getCfg();
      cfg.taxRate = numOu(document.getElementById('cfgTax'), 6) / 100;
      cfg.cardRate = numOu(document.getElementById('cfgCard'), 1.5) / 100;
      cfg.marginTarget = numOu(document.getElementById('cfgMargin'), 35) / 100;
      cfg.lossRate = numOu(document.getElementById('cfgLoss'), 2) / 100;
      cfg.totalUnitsMonth = numOu(document.getElementById('cfgUnits'), 150);
      cfg.laborCostHr = numOu(document.getElementById('cfgLabor'), 0);
      DB.set('config', [cfg]);
      toast('Configurações salvas');
      rPricing();
    };
  }
  if (typeof I !== 'undefined' && !I.settings && I.production) I.settings = I.production;

  /* ---------------- M2 e M3: visualização da Fórmula ---------------- */
  function htmlPassos(prep) {
    return String(prep || '').split('\n').filter(function (s) { return s.trim(); }).map(function (s, i) {
      return '<div style="padding:4px 0"><span style="color:var(--text-muted);font-weight:600;margin-right:6px">' + (i + 1) + '.</span>' + esc(s) + '</div>';
    }).join('');
  }
  if (typeof window.viewFormula === 'function') {
    var formulaAntes = window.viewFormula;
    window.viewFormula = function (id) {
      var r = formulaAntes.apply(this, arguments);
      try {
        var rod = document.getElementById('modalFooter');
        if (rod && typeof I !== 'undefined') rod.innerHTML = rod.innerHTML.split('${I.copy}').join(I.copy).split('${I.edit}').join(I.edit);
        var f = null;
        DB.get('formulas').forEach(function (x) { if (x.id === id) f = x; });
        if (f && f.prepSteps) {
          [].slice.call(document.querySelectorAll('#modalBody h4')).forEach(function (h) {
            if (/Modo de Preparo/i.test(h.textContent) && h.nextElementSibling) h.nextElementSibling.innerHTML = htmlPassos(f.prepSteps);
          });
        }
      } catch (e) { console.warn('correcoes-dia: fórmula', e); }
      return r;
    };
    window.viewFormula._dia = true;
  }

  /* ---------------- série de recorrência mensal ---------------- */
  function dataMensalLocal(ano, mes, dia) {
    var ult = new Date(ano, mes + 1, 0).getDate();
    var d = new Date(ano, mes, Math.min(dia, ult), 12, 0, 0);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function planejarSerieMensal(pagar, descricao, dia) {
    var alvos = (pagar || []).filter(function (p) {
      return p && p.descricao === descricao && p.status !== 'pago' && p.recorrente === 'personalizado';
    }).sort(function (a, b) { return a.vencimento < b.vencimento ? -1 : (a.vencimento > b.vencimento ? 1 : 0); });
    if (!alvos.length) return { erro: 'Nenhum lançamento pendente com recorrência "personalizado" e a descrição "' + descricao + '".' };
    var d = Math.min(31, Math.max(1, parseInt(dia, 10) || 1));
    var primeira = alvos[0].vencimento;
    var ano = parseInt(primeira.slice(0, 4), 10), mes = parseInt(primeira.slice(5, 7), 10) - 1;
    return {
      linhas: alvos.map(function (p, i) { return { id: p.id, de: p.vencimento, para: dataMensalLocal(ano, mes + i, d) }; })
    };
  }
  window.SerieMensalPrevia = function (descricao, dia) {
    var p = planejarSerieMensal(DB.get('pagar'), descricao, dia);
    if (p.erro) { console.log(p.erro); return p; }
    if (console.table) console.table(p.linhas.map(function (l) { return { de: l.de, para: l.para }; }));
    console.log(p.linhas.length + ' lançamento(s) de "' + descricao + '" iriam para o dia ' + (parseInt(dia, 10) || 1) + ' de cada mês. Nada foi alterado.');
    return p;
  };
  window.SerieMensalAplicar = function (descricao, dia) {
    var itens = DB.get('pagar');
    var p = planejarSerieMensal(itens, descricao, dia);
    if (p.erro) { console.log(p.erro); return p; }
    if (!window.confirm('Mover ' + p.linhas.length + ' lançamento(s) de "' + descricao + '" para o dia ' + (parseInt(dia, 10) || 1) + ' de cada mês e marcá-los como Mensal?')) return null;
    var porId = {};
    p.linhas.forEach(function (l) { porId[l.id] = l.para; });
    itens.forEach(function (x) { if (porId[x.id]) { x.vencimento = porId[x.id]; x.recorrente = 'mensal'; x.recorrDias = ''; } });
    DB.set('pagar', itens);
    if (typeof render === 'function') render();
    toast(p.linhas.length + ' lançamento(s) atualizado(s)');
    return p;
  };

  /* ---------------- autoteste (console: CorrecoesDiaTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var hoje = '2026-11-13';
    var vazio = {};
    ok('lembrete com "feito" marcado conta como concluído', lembreteConcluido({ id: 'a', feito: true }, vazio) === true);
    ok('lembrete com "feito" falso explícito não conta, mesmo com histórico', lembreteConcluido({ id: 'a', feito: false }, { a: '2026-11-01' }) === false);
    ok('lembrete antigo sem marca usa o histórico dos dias', lembreteConcluido({ id: 'a' }, { a: '2026-11-01' }) === true && lembreteConcluido({ id: 'b' }, { a: '2026-11-01' }) === false);
    var t = tarefasLembretes([{ id: 'p1', text: 'Pagar Sabrina', date: '2026-11-12', repeat: 'none' }], hoje, vazio);
    ok('lembrete de ontem não feito vira tarefa atrasada', t.length === 1 && t[0].type === 'urgente' && t[0].priority === 1 && t[0].id === 'lembrete_p1' && t[0].sub.indexOf('Atrasado desde') === 0 && t[0].sub.indexOf('1 dia') > -1);
    ok('lembrete de hoje ou futuro não é atrasado', tarefasLembretes([{ id: 'a', text: 'x', date: hoje, repeat: 'none' }, { id: 'b', text: 'y', date: '2026-11-20' }], hoje, vazio).length === 0);
    ok('lembrete com repetição não é tratado como atrasado', tarefasLembretes([{ id: 'a', text: 'x', date: '2026-11-01', repeat: 'weekly' }], hoje, vazio).length === 0);
    ok('lembrete já feito não aparece', tarefasLembretes([{ id: 'a', text: 'x', date: '2026-11-01', repeat: 'none', feito: true, feitoEm: '2026-11-02' }], hoje, vazio).length === 0);
    ok('lembrete feito em algum dia (histórico) não aparece', tarefasLembretes([{ id: 'a', text: 'x', date: '2026-11-01' }], hoje, { a: '2026-11-01' }).length === 0);
    ok('desmarcado de propósito volta a aparecer', tarefasLembretes([{ id: 'a', text: 'x', date: '2026-11-01', feito: false }], hoje, { a: '2026-11-01' }).length === 1);
    var tc = tarefasLembretes([{ id: 'a', text: 'x', date: '2026-11-01', repeat: 'none', feito: true, feitoEm: hoje }], hoje, vazio);
    ok('atrasado concluído hoje fica na lista como concluído', tc.length === 1 && tc[0].type === 'hoje' && tc[0].sub.indexOf('Concluído hoje') === 0);
    var lista = [{ id: 'a', text: 'x', date: '2026-11-12', repeat: 'none' }, { id: 'w', text: 'semanal', date: '2026-11-01', repeat: 'weekly' }];
    ok('marcar o lembrete grava o feito e a data', marcarLembrete(lista, 'a', true, hoje) === true && lista[0].feito === true && lista[0].feitoEm === hoje);
    ok('desmarcar o lembrete tira o feito', marcarLembrete(lista, 'a', false, hoje) === true && lista[0].feito === false && lista[0].feitoEm === undefined);
    ok('lembrete com repetição ou inexistente não é alterado', marcarLembrete(lista, 'w', true, hoje) === false && marcarLembrete(lista, 'zzz', true, hoje) === false && lista[1].feito === undefined);
    localStorage.setItem(PREFIXO_FEITOS + '2000-01-02', JSON.stringify(['lembrete_zzteste', 'pag_x']));
    var mapa = mapaFeitos(true);
    ok('o histórico dos dias é lido das chaves do Modo Dia', mapa.zzteste === '2000-01-02' && mapa.x === undefined);
    localStorage.removeItem(PREFIXO_FEITOS + '2000-01-02'); cacheMapa.t = 0;
    var serie = [
      { id: '1', descricao: 'Circes', vencimento: '2027-01-04', recorrente: 'personalizado', status: 'pendente' },
      { id: '2', descricao: 'Circes', vencimento: '2026-12-05', recorrente: 'personalizado', status: 'pendente' },
      { id: '3', descricao: 'Circes', vencimento: '2027-02-03', recorrente: 'personalizado', status: 'pendente' },
      { id: '4', descricao: 'Aluguel', vencimento: '2026-12-01', recorrente: 'mensal', status: 'pendente' },
      { id: '5', descricao: 'Circes', vencimento: '2026-11-05', recorrente: 'personalizado', status: 'pago' }
    ];
    var ps = planejarSerieMensal(serie, 'Circes', 5);
    ok('série vira mensal no dia escolhido, em ordem', ps.linhas.length === 3 && ps.linhas.map(function (l) { return l.id + ':' + l.para; }).join() === '2:2026-12-05,1:2027-01-05,3:2027-02-05');
    ok('lançamentos pagos ou de outra série não entram', ps.linhas.every(function (l) { return l.id !== '4' && l.id !== '5'; }));
    var p31 = planejarSerieMensal([{ id: 'a', descricao: 'X', vencimento: '2027-01-31', recorrente: 'personalizado', status: 'pendente' }, { id: 'b', descricao: 'X', vencimento: '2027-03-02', recorrente: 'personalizado', status: 'pendente' }, { id: 'c', descricao: 'X', vencimento: '2027-04-01', recorrente: 'personalizado', status: 'pendente' }], 'X', 31);
    ok('dia 31 cai no último dia dos meses curtos', p31.linhas.map(function (l) { return l.para; }).join() === '2027-01-31,2027-02-28,2027-03-31');
    ok('sem série correspondente, avisa em vez de alterar', !!planejarSerieMensal(serie, 'Inexistente', 5).erro);
    ok('link do WhatsApp usa só os dígitos', corrigirHrefWhats('https://wa.me/55(14) 99811-2006') === 'https://wa.me/5514998112006' && corrigirHrefWhats('https://wa.me/5511999990000') === 'https://wa.me/5511999990000' && corrigirHrefWhats('https://outro.com/x') === 'https://outro.com/x');
    ok('zero é aceito na Precificação; vazio ou texto usa o padrão', numOu({ value: '0' }, 6) === 0 && numOu({ value: '' }, 6) === 6 && numOu({ value: 'abc' }, 6) === 6 && numOu({ value: '6.5' }, 6) === 6.5 && numOu(null, 3) === 3);
    ok('singular de mensagem corrigido, plural intacto', corrigirMensagem('1 mensagen cadastrada') === '1 mensagem cadastrada' && corrigirMensagem('2 mensagens cadastradas') === '2 mensagens cadastradas' && corrigirMensagem('11 mensagens') === '11 mensagens');
    var fs = filtrarFornecedores([{ id: '1', name: 'Aromaville' }, { id: '2', name: 'Solfarma' }, { id: '3', name: 'AR2M Cosméticos' }, null], 'ar');
    ok('busca de fornecedor ignora acento e caixa', fs.length === 3 && filtrarFornecedores([{ id: '3', name: 'AR2M Cosméticos' }], 'cosmeticos').length === 1 && filtrarFornecedores([{ id: '1', name: 'A' }], '').length === 1);
    var hp = htmlPassos('Misturar\n\n<b>Esfriar</b>');
    ok('passos do preparo são numerados e escapados', hp.indexOf('1.') > -1 && hp.indexOf('2.') > -1 && hp.indexOf('<b>') < 0 && hp.indexOf('3.') < 0);
    ok('a leitura do espelho do Modo Dia só é pulada quando pedido', deveIgnorarRede(true, 'app_data?key=eq.mododia_done_2026-11-13', { method: 'GET' }) === true && deveIgnorarRede(false, 'app_data?key=eq.mododia_done_2026-11-13', { method: 'GET' }) === false && deveIgnorarRede(true, 'app_data?key=eq.mododia_done_2026-11-13', { method: 'PATCH' }) === false && deveIgnorarRede(true, 'pagar?select=id') === false);
    ok('SISTEMA: Modo Dia integrado', window.getModoDiaTasks._dia === true && window.toggleModoDiaTask._dia === true && window.rModoDia._dia === true);
    ok('SISTEMA: buscas protegidas', window.rPagar._dia === true && window.rIdeias._dia === true && window.rRoteiros._dia === true);
    ok('SISTEMA: fornecedor e ícone', typeof window.searchSupplier === 'function' && (typeof I === 'undefined' || !!I.settings));
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'CORRECOES-DIA: ' + r.length + ' testes, 0 falhas' : 'CORRECOES-DIA: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }
  /* Cada arquivo envolve as mesmas funções do Modo Dia, e a marca de um fica escondida pelo seguinte.
     Como este arquivo é o último, recoloca aqui as marcas dos outros (as verificações "SISTEMA" dos testes procuram por elas).
     Só marca o que foi carregado: cada arquivo publica sua função de teste depois de instalar os próprios ajustes. */
  function marcarModulos(fn, marcas) {
    if (typeof fn === 'function') marcas.forEach(function (m) { fn[m] = true; });
  }
  var temExtras = typeof window.QuadrosExtrasTeste === 'function';
  var temBaixa = typeof window.BaixaModoDiaTeste === 'function';
  var temRotinas = typeof window.QuadrosRotinasTeste === 'function';
  marcarModulos(window.getModoDiaTasks, [].concat(temExtras ? ['_qdx'] : [], temBaixa ? ['_baixa'] : [], temRotinas ? ['_qdGer'] : []));
  marcarModulos(window.toggleModoDiaTask, [].concat(temExtras ? ['_qdx'] : [], temBaixa ? ['_baixa'] : []));
  window.CorrecoesDiaTeste = teste;
})();
