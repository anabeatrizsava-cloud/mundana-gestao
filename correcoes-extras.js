/* ============================================================
   MUNDANA · CORREÇÕES — Item 7: A Pagar, custo do ingrediente e proteção do cálculo
   Instalação: no index.html, DEPOIS do correcoes-numeros.js e antes de </body>:
       <script src="correcoes-extras.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha.
   Autoteste: no console (F12) digite  CorrecoesExtrasTeste()

   A Pagar     Botões Todos, Hoje e Esta semana (com a contagem) ao lado do filtro de mês.
               A semana vai de domingo a sábado e usa a data local (o código antigo usava UTC).
   Fórmulas    Ao escolher a matéria-prima no ingrediente, o custo por unidade é preenchido
               pela última compra registrada no histórico de preços do fornecedor, com
               conversão entre kg e g e entre l e ml. Nunca sobrescreve o que foi digitado.
               O campo do custo passa a mostrar "R$/g" (ou a unidade do ingrediente).
               O campo "unidades por mês" da fórmula (que o cálculo ignora) fica escondido.
   Cálculo     Configuração incompleta é completada (custos fixos pela soma da lista, cartão
               3%, 100 unidades por mês) e o preço nunca vira NaN ou infinito. Se imposto +
               cartão + margem chegarem perto de 100%, o sistema avisa em vez de mostrar
               um preço absurdo.
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof calcFormula !== 'function' || typeof rPagar !== 'function' || typeof localDateStr !== 'function') {
    console.error('correcoes-extras.js: carregue este arquivo DEPOIS do script principal (antes de </body>).');
    return;
  }
  if (window.__correcoesExtras) { return; }
  window.__correcoesExtras = true;

  /* ---------------- utilidades ---------------- */
  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  function envolver(nome, fabrica) {
    var antes = window[nome];
    if (typeof antes !== 'function') return;
    var novo = fabrica(antes);
    Object.keys(antes).forEach(function (k) { if (k.charAt(0) === '_') novo[k] = antes[k]; });
    novo._ext = true;
    window[nome] = novo;
  }

  /* ---------------- A Pagar: Hoje e Esta semana ---------------- */
  function intervaloSemana(hojeStr) {
    var d = new Date(hojeStr + 'T12:00:00');
    var ini = new Date(d); ini.setDate(d.getDate() - d.getDay());
    var fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    return [localDateStr(ini), localDateStr(fim)];
  }
  function casaRapido(item, tipo, hoje) {
    var v = item && item.vencimento;
    if (!v) return false;
    if (tipo === 'hoje') return v === hoje;
    if (tipo === 'semana') { var iv = intervaloSemana(hoje); return v >= iv[0] && v <= iv[1]; }
    return true;
  }
  function botaoRapido(t, rotulo, n, ativo) {
    return '<button class="btn btn-sm ' + (ativo ? 'btn-primary' : 'btn-secondary') + '" onclick="S._pagRapido=\'' + t + '\';S._pagMes=\'all\';rPagar()">' + rotulo + (n == null ? '' : ' (' + n + ')') + '</button>';
  }
  function decorarPagar(cheia, tipo, hoje) {
    var content = document.getElementById('content');
    if (!content) return;
    var mes = content.querySelector('input[type="month"]');
    if (!mes) return; /* aba Visão Geral */
    var linha = mes.parentNode;
    var lista = cheia || [];
    if (!linha.querySelector('[data-rapido]')) {
      var nHoje = lista.filter(function (i) { return casaRapido(i, 'hoje', hoje); }).length;
      var nSem = lista.filter(function (i) { return casaRapido(i, 'semana', hoje); }).length;
      var box = document.createElement('div');
      box.setAttribute('data-rapido', '1'); box.style.display = 'flex'; box.style.gap = '6px';
      box.innerHTML = botaoRapido('', 'Todos', null, tipo === '' && (!S._pagMes || S._pagMes === 'all')) +
        botaoRapido('hoje', 'Hoje', nHoje, tipo === 'hoje') + botaoRapido('semana', 'Esta semana', nSem, tipo === 'semana');
      linha.insertBefore(box, mes);
    }
    if (!tipo) return;
    var n = lista.filter(function (i) { return casaRapido(i, tipo, hoje); }).length;
    var texto = tipo === 'hoje' ? 'vencem hoje' : 'vencem nesta semana (' + fmtD(intervaloSemana(hoje)[0]) + ' a ' + fmtD(intervaloSemana(hoje)[1]) + ')';
    var p = content.querySelector('.page-header-left p');
    if (p) p.textContent = n + ' lançamento' + (n !== 1 ? 's' : '') + ' que ' + texto;
    var es = content.querySelector('.empty-state');
    if (es) {
      var h3 = es.querySelector('h3'); if (h3) h3.textContent = 'Nenhum lançamento';
      var ep = es.querySelector('p'); if (ep) ep.textContent = tipo === 'hoje' ? 'Nada vence hoje' : 'Nada vence nesta semana';
      var eb = es.querySelector('button'); if (eb) eb.parentNode.removeChild(eb);
    }
  }

  /* ---------------- custo do ingrediente pela última compra ---------------- */
  var ALIAS = { g: 'g', gr: 'g', grama: 'g', gramas: 'g', kg: 'kg', quilo: 'kg', quilos: 'kg', mg: 'mg', ml: 'ml', l: 'l', lt: 'l', litro: 'l', litros: 'l', un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un' };
  var BASE = { g: ['m', 1], kg: ['m', 1000], mg: ['m', 0.001], ml: ['v', 1], l: ['v', 1000], un: ['u', 1] };
  function infoUnidade(u) {
    var k = ALIAS[norm(u).replace(/\./g, '')];
    return k ? BASE[k] : null;
  }
  /* devolve o custo por unidade do ingrediente com base na compra mais recente do histórico (preço = total pago pela quantidade) */
  function custoPorUnidade(hist, nome, unidadeAlvo) {
    var n = norm(nome), melhor = null;
    (hist || []).forEach(function (h) {
      if (norm(h.mpName) !== n) return;
      var q = parseFloat(h.qty), p = parseFloat(h.price);
      if (!(q > 0) || !(p > 0) || !infoUnidade(h.unit)) return;
      if (!melhor || String(h.date || '') >= String(melhor.date || '')) melhor = h;
    });
    if (!melhor) return null;
    var o = infoUnidade(melhor.unit);
    var alvo = unidadeAlvo ? infoUnidade(unidadeAlvo) : o;
    if (!alvo || alvo[0] !== o[0]) return null;
    var porBase = parseFloat(melhor.price) / (parseFloat(melhor.qty) * o[1]);
    var valor = Math.round(porBase * alvo[1] * 10000) / 10000;
    if (!(valor > 0)) return null;
    return { valor: valor, unidade: unidadeAlvo ? norm(unidadeAlvo) : norm(melhor.unit), qtd: parseFloat(melhor.qty), unidCompra: melhor.unit, preco: parseFloat(melhor.price), data: melhor.date || '' };
  }
  function preencherCusto(idx, nome) {
    var g = window._fIng && window._fIng[idx];
    if (!g) return;
    if (parseFloat(g.unitCost) > 0) return; /* não sobrescreve o que foi digitado */
    var c = custoPorUnidade(DB.get('mp_price_hist'), nome, g.unit);
    if (!c) return;
    g.unitCost = String(c.valor);
    var el = document.getElementById('ingUC' + idx); if (el) el.value = g.unitCost;
    if (!g.unit && c.unidade) { g.unit = c.unidade; var u = document.getElementById('ingU' + idx); if (u) u.value = c.unidade; }
    calcIngCost(idx);
    toast('Custo preenchido pela última compra: R$ ' + String(c.valor).replace('.', ',') + '/' + c.unidade + ' (R$ ' + String(c.preco).replace('.', ',') + ' por ' + c.qtd + ' ' + c.unidCompra + (c.data ? ', ' + fmtD(c.data) : '') + '). Confira.');
  }

  /* ---------------- proteção do cálculo ---------------- */
  function completarConfig(c, custos) {
    var out = Object.assign({}, c || {});
    var pad = { taxRate: 0.06, cardRate: 0.03, marginTarget: 0.35, lossRate: 0.02, laborCostHr: 0 };
    Object.keys(pad).forEach(function (k) {
      var v = parseFloat(out[k]);
      out[k] = isFinite(v) && v >= 0 ? v : pad[k];
    });
    var fx = parseFloat(out.fixedCosts);
    out.fixedCosts = isFinite(fx) && fx >= 0 ? fx : (custos || []).reduce(function (s, x) { return s + (parseFloat(x.value) || 0); }, 0);
    var un = parseFloat(out.totalUnitsMonth);
    out.totalUnitsMonth = isFinite(un) && un > 0 ? un : 100;
    return out;
  }
  function sanearCalculo(c, cfg) {
    var out = Object.assign({}, c);
    Object.keys(out).forEach(function (k) { if (typeof out[k] === 'number' && !isFinite(out[k])) out[k] = 0; });
    var tax = parseFloat(cfg.taxRate) || 0, card = parseFloat(cfg.cardRate) || 0, marg = parseFloat(cfg.marginTarget) || 0;
    out.configInvalida = (1 - tax - card - marg) <= 0.02;
    if ((1 - tax - card) <= 0.02) out.priceMin = 0;
    if (out.configInvalida) {
      out.priceSuggested = 0; out.taxVal = 0; out.cardVal = 0; out.profit = 0; out.profitLot = 0; out.marginReal = 0;
    }
    return out;
  }
  var avisouConfig = false;

  /* ---------------- campo escondido: unidades por mês da fórmula ---------------- */
  function esconderUnidadesMes() {
    [].slice.call(document.querySelectorAll('#modalBody .form-label')).forEach(function (l) {
      if (/unid[^\n]*(m[eê]s|mensal)|(m[eê]s|mensal)[^\n]*unid/i.test(l.textContent)) {
        var g = l.closest('.form-group');
        if (g) g.style.display = 'none';
      }
    });
  }

  /* ---------------- ligações com o sistema ---------------- */
  envolver('rPagar', function (antes) {
    return function () {
      var self = this, args = arguments, tipo = '', hoje = localDateStr(), cheia = null;
      try {
        if (S._pagMes && S._pagMes !== 'all') S._pagRapido = '';
        tipo = S._pagRapido || '';
        cheia = DB.get('pagar');
      } catch (e) { tipo = ''; }
      var r;
      if (tipo) {
        /* enquanto a tela desenha, ela enxerga só os lançamentos do filtro rápido: cartões, tabela e contagens ficam coerentes */
        var getOriginal = DB.get;
        DB.get = function (k) {
          var v = getOriginal.apply(DB, arguments);
          return k === 'pagar' ? v.filter(function (i) { return casaRapido(i, tipo, hoje); }) : v;
        };
        try { r = antes.apply(self, args); } finally { DB.get = getOriginal; }
      } else {
        r = antes.apply(self, args);
      }
      try { decorarPagar(cheia, tipo, hoje); } catch (e2) { console.warn('correcoes-extras: A Pagar', e2); }
      return r;
    };
  });
  envolver('pickIngMP', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try { preencherCusto(arguments[0], arguments[1]); } catch (e) { console.warn('correcoes-extras: custo', e); }
      return r;
    };
  });
  envolver('rIngs', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try {
        (window._fIng || []).forEach(function (g, i) {
          var el = document.getElementById('ingUC' + i);
          if (el) {
            el.placeholder = 'R$/' + (g.unit || 'un');
            el.title = 'Custo por ' + (g.unit || 'unidade') + '. O custo total é a quantidade vezes este valor.';
          }
        });
      } catch (e) { console.warn('correcoes-extras: ingredientes', e); }
      return r;
    };
  });
  envolver('openFormModal', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try { esconderUnidadesMes(); } catch (e) { console.warn('correcoes-extras: fórmula', e); }
      return r;
    };
  });
  envolver('getCfg', function (antes) {
    return function () {
      var c = antes.apply(this, arguments);
      try { return completarConfig(DB.get('config').length ? c : {}, DB.get('fixed_costs')); } catch (e) { return c; }
    };
  });
  envolver('calcFormula', function (antes) {
    return function () {
      var c = antes.apply(this, arguments);
      try {
        var cfg = getCfg();
        c = sanearCalculo(c, cfg);
        if (c.configInvalida && !avisouConfig) {
          avisouConfig = true;
          toast('Atenção: imposto + cartão + margem somam ' + Math.round(((parseFloat(cfg.taxRate) || 0) + (parseFloat(cfg.cardRate) || 0) + (parseFloat(cfg.marginTarget) || 0)) * 100) + '%. O preço sugerido não pode ser calculado; revise os parâmetros da Precificação.');
        }
      } catch (e) { console.warn('correcoes-extras: cálculo', e); }
      return c;
    };
  });

  /* ---------------- autoteste (console: CorrecoesExtrasTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var sem = intervaloSemana('2026-11-18');
    ok('a semana vai de domingo a sábado, a partir de qualquer dia dela', sem.join() === '2026-11-15,2026-11-21' && intervaloSemana('2026-11-15').join() === '2026-11-15,2026-11-21' && intervaloSemana('2026-11-21').join() === '2026-11-15,2026-11-21');
    ok('o filtro Hoje pega só o vencimento de hoje', casaRapido({ vencimento: '2026-11-18' }, 'hoje', '2026-11-18') === true && casaRapido({ vencimento: '2026-11-17' }, 'hoje', '2026-11-18') === false && casaRapido({}, 'hoje', '2026-11-18') === false);
    ok('o filtro Semana inclui domingo e sábado e exclui os dias vizinhos', casaRapido({ vencimento: '2026-11-15' }, 'semana', '2026-11-18') && casaRapido({ vencimento: '2026-11-21' }, 'semana', '2026-11-18') && !casaRapido({ vencimento: '2026-11-14' }, 'semana', '2026-11-18') && !casaRapido({ vencimento: '2026-11-22' }, 'semana', '2026-11-18'));
    var kg = [{ mpName: 'Karité', qty: 1, unit: 'kg', price: 50, date: '2026-11-10' }];
    ok('compra em kg vira custo por grama', custoPorUnidade(kg, 'karité', 'g').valor === 0.05);
    ok('compra em g vira custo por kg', custoPorUnidade([{ mpName: 'X', qty: 500, unit: 'g', price: 25, date: '2026-11-10' }], 'x', 'kg').valor === 50);
    ok('litro e mililitro também convertem', custoPorUnidade([{ mpName: 'Y', qty: 1, unit: 'l', price: 30, date: '2026-11-10' }], 'y', 'ml').valor === 0.03 && custoPorUnidade([{ mpName: 'Y', qty: 400, unit: 'ml', price: 12, date: '2026-11-10' }], 'y', 'l').valor === 30);
    ok('unidades de tipos diferentes ou desconhecidas não geram custo', custoPorUnidade(kg, 'karité', 'ml') === null && custoPorUnidade([{ mpName: 'Z', qty: 1, unit: 'caixa', price: 10, date: '2026-11-10' }], 'z', 'g') === null);
    var hist = [
      { mpName: 'W', qty: 1, unit: 'kg', price: 40, date: '2026-09-01' },
      { mpName: 'W', qty: 1, unit: 'kg', price: 60, date: '2026-11-01' },
      { mpName: 'W', unit: 'kg', price: 999, date: '2026-12-01' }
    ];
    ok('vale a compra mais recente que tenha quantidade e preço', custoPorUnidade(hist, 'W', 'g').valor === 0.06);
    ok('sem unidade no ingrediente, usa a da compra', custoPorUnidade(kg, 'karité', '').valor === 50 && custoPorUnidade(kg, 'karité', '').unidade === 'kg');
    var cc = completarConfig({ taxRate: 'x', cardRate: 0.02, marginTarget: 0.4, lossRate: 0.05, totalUnitsMonth: 0 }, [{ value: '100' }, { value: '50' }]);
    ok('configuração incompleta é completada, mantendo o que está válido', cc.taxRate === 0.06 && cc.cardRate === 0.02 && cc.marginTarget === 0.4 && cc.lossRate === 0.05 && cc.fixedCosts === 150 && cc.totalUnitsMonth === 100);
    var cfgOk = { taxRate: 0.06, cardRate: 0.03, marginTarget: 0.35 };
    var s1 = sanearCalculo({ priceSuggested: Infinity, priceMin: NaN, profit: -Infinity, unitsLot: 10 }, cfgOk);
    var s2 = sanearCalculo({ priceSuggested: -50, priceMin: 20, profit: 3, unitsLot: 10 }, { taxRate: 0.5, cardRate: 0.3, marginTarget: 0.3 });
    ok('o preço nunca fica infinito ou NaN, e parâmetros que somam 100% são apontados', s1.priceSuggested === 0 && s1.priceMin === 0 && s1.profit === 0 && s1.unitsLot === 10 && s1.configInvalida === false && s2.configInvalida === true && s2.priceSuggested === 0);
    ok('SISTEMA: extras instalados', window.rPagar._ext === true && window.getCfg._ext === true && window.calcFormula._ext === true && window.pickIngMP._ext === true);
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'CORRECOES-EXTRAS: ' + r.length + ' testes, 0 falhas' : 'CORRECOES-EXTRAS: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }
  window.CorrecoesExtrasTeste = teste;
})();
