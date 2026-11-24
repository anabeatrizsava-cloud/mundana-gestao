/* ============================================================
   MUNDANA · FÓRMULAS EM DUAS TELAS: RECEITA (%) E CUSTOS
   Instalação: no index.html, DEPOIS do correcoes-extras.js e antes de </body>:
       <script src="correcoes-receitas.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha (volta a janela antiga).
   Autoteste: no console (F12) digite  CorrecoesReceitasTeste()

   Tela 1 (Receita): nome, tipo, linhas, ingredientes com a porcentagem de cada um e o
                     modo de preparo. A soma das porcentagens aparece ao vivo. Botão Seguir.
   Tela 2 (Custos):  você preenche o tamanho do lote, o tamanho por unidade, a embalagem e
                     outros custos por unidade, e o preço de cada ingrediente (R$/kg, R$/g ou
                     R$/L; já vem preenchido pela última compra, quando existe). O sistema
                     calcula a quantidade por lote, o custo de cada ingrediente e todo o
                     resto (custo por unidade, rateio dos custos fixos, preço mínimo,
                     preço sugerido, lucro e margem) com a mesma conta de sempre.
   A fórmula salva continua no mesmo formato de antes (mais a porcentagem), então
   Produção, Pedidos, Estoque, Precificação e Produtos seguem funcionando.
   Litro conta como 1 kg (densidade 1) e ml como g.
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof openModal !== 'function' || typeof calcFormula !== 'function' || typeof rForms !== 'function' || typeof getProductTypes !== 'function') {
    console.error('correcoes-receitas.js: carregue este arquivo DEPOIS do script principal (antes de </body>).');
    return;
  }
  if (window.__correcoesReceitas) { return; }
  window.__correcoesReceitas = true;

  var rc = null; /* estado do assistente aberto */
  var SETA = '&rarr;', VOLTA = '&larr;';

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  /* chave para comparar nomes: sem acento, sem maiúscula ("Uréia" e "Ureia" são a mesma matéria-prima) */
  function chave(s) { return norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function achar(lista, id) { var r = null; (lista || []).forEach(function (x) { if (x && x.id === id) r = x; }); return r; }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? e.value : ''; }
  function setTxt(id, t) { var e = el(id); if (e) e.textContent = t; }
  function fmt3(n) { return (Math.round(n * 1000) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function fmtPct(n) { return n.toFixed(2).replace('.', ','); }
  function envolver(nome, fabrica) {
    var antes = window[nome];
    if (typeof antes !== 'function') return;
    var novo = fabrica(antes);
    Object.keys(antes).forEach(function (k) { if (k.charAt(0) === '_') novo[k] = antes[k]; });
    novo._rec = true;
    window[nome] = novo;
  }

  /* ---------------- contas ---------------- */
  var FATOR_G = { g: 1, kg: 1000, mg: 0.001, ml: 1, l: 1000 };
  var ALIAS_G = { gr: 'g', grama: 'g', gramas: 'g', quilo: 'kg', quilos: 'kg', lt: 'l', litro: 'l', litros: 'l' };
  function fatorGramas(u) {
    var k = norm(u).replace(/\./g, '');
    k = ALIAS_G[k] || k;
    return FATOR_G[k] != null ? FATOR_G[k] : 1;
  }
  function gramasDe(g) { return (parseFloat(g.qtyLot) || 0) * fatorGramas(g.unit || 'g'); }
  function precoPorGrama(preco, un) {
    var p = parseFloat(preco);
    if (!(p > 0)) return 0;
    return p / (un === 'g' ? 1 : 1000);
  }
  function somaPct(ings) { return (ings || []).reduce(function (s, g) { return s + (parseFloat(g.pct) || 0); }, 0); }

  function montarIngredientes(s) {
    var lot = parseFloat(s.lot) || 0;
    return s.ing.filter(function (g) { return String(g.name).trim(); }).map(function (g) {
      var pct = parseFloat(g.pct) || 0;
      var gramas = lot * pct / 100;
      var perG = precoPorGrama(g.price, g.pu);
      return {
        name: String(g.name).trim(), pct: String(pct), unit: 'g',
        qtyLot: String(Math.round(gramas * 1000) / 1000),
        unitCost: perG ? String(Math.round(perG * 1e6) / 1e6) : '',
        totalCost: (gramas * perG).toFixed(4),
        priceInput: String(g.price || ''), priceUnit: g.pu || 'kg', obs: g.obs || ''
      };
    });
  }
  function formulaTemp(s) {
    return { lotSize: s.lot, unitSize: s.uni, packagingCost: s.pack, otherCosts: s.out, ingredients: montarIngredientes(s) };
  }

  function linhaVazia() { return { name: '', pct: '', obs: '', price: '', pu: 'kg', autoVal: '' }; }
  function estadoDe(f) {
    var s = {
      id: f ? f.id : '', name: f ? (f.name || '') : '', type: f ? (f.productType || '') : '',
      lines: f ? (f.lines || [f.line]).map(function (x) { return (x || '').trim(); }).filter(Boolean) : [],
      lot: f ? String(f.lotSize || '') : '', uni: f ? String(f.unitSize || '') : '',
      pack: f ? String(f.packagingCost || '') : '', out: f ? String(f.otherCosts || '') : '',
      final: f ? String(f.finalPrice || '') : '', prep: f ? (f.prepSteps || '') : '',
      ing: [], sug: {}, pausado: false
    };
    var lot = parseFloat(s.lot) || 0;
    ((f && f.ingredients) || []).forEach(function (g) {
      var pct = g.pct;
      if ((pct === undefined || pct === null || pct === '') && lot > 0) {
        var gr = gramasDe(g);
        pct = gr ? String(Math.round(gr / lot * 10000) / 100) : '';
      }
      var price = '', pu = 'kg';
      if (g.priceInput !== undefined && g.priceInput !== '') { price = String(g.priceInput); pu = g.priceUnit || 'kg'; }
      else if (parseFloat(g.unitCost) > 0) {
        var perG = parseFloat(g.unitCost) / fatorGramas(g.unit || 'g');
        price = String(Math.round(perG * 1000 * 100) / 100);
      }
      s.ing.push({ name: g.name || '', pct: pct == null ? '' : String(pct), obs: g.obs || '', price: price, pu: pu, autoVal: '' });
    });
    if (!f) { while (s.ing.length < 3) s.ing.push(linhaVazia()); }
    if (!s.ing.length) s.ing.push(linhaVazia());
    return s;
  }

  function nomesConhecidos() {
    var vistos = {}, out = [];
    function add(n) { n = String(n || '').trim(); var k = norm(n); if (n && !vistos[k]) { vistos[k] = 1; out.push(n); } }
    DB.get('stockmp').forEach(function (s) { add(s.name); });
    DB.get('formulas').forEach(function (f) { (f.ingredients || []).forEach(function (g) { add(g.name); }); });
    return out.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  /* ---------------- tela 1: receita ---------------- */
  function indicador(passo) {
    function bola(n, rotulo) {
      var ativo = n === passo;
      return '<div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:' + (ativo ? 'var(--carvao)' : 'var(--bg-warm)') + ';color:' + (ativo ? '#fff' : 'var(--text-muted)') + '">' + n + '</span><span style="font-size:12px;font-weight:' + (ativo ? '700' : '500') + ';color:' + (ativo ? 'var(--text-primary)' : 'var(--text-muted)') + '">' + rotulo + '</span></div>';
    }
    return '<div style="display:flex;gap:16px;align-items:center;margin-bottom:18px">' + bola(1, 'Receita') + '<span style="color:var(--border)">&mdash;</span>' + bola(2, 'Custos') + '</div>';
  }
  var H4 = 'font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--rosa-antigo);margin:20px 0 14px';
  var CAB = 'display:grid;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);font-weight:700;padding:0 0 6px;margin-bottom:4px;border-bottom:1.5px solid var(--border)';

  function htmlPasso1() {
    var tipos = getProductTypes();
    var linhas = [];
    DB.get('products').forEach(function (p) { var l = (p.line || '').trim(); if (l && linhas.indexOf(l) < 0) linhas.push(l); });
    linhas.sort();
    var marcadas = rc.lines.map(function (x) { return norm(x); });
    var chk = linhas.map(function (l) {
      return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:6px 10px;background:var(--bg-warm);border-radius:var(--radius-md);cursor:pointer"><input type="checkbox" class="rcLineChk" value="' + esc(l) + '"' + (marcadas.indexOf(norm(l)) > -1 ? ' checked' : '') + '> ' + esc(l) + '</label>';
    }).join('');
    return indicador(1) +
      '<h4 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--rosa-antigo);margin-bottom:14px">Dados do Produto</h4>' +
      '<div class="form-row form-row-2">' +
      '<div class="form-group"><label class="form-label">Nome da Fórmula</label><input class="form-input" id="rcN" value="' + esc(rc.name) + '" placeholder="Ex: Hidratante Copacabana Glow"></div>' +
      '<div class="form-group"><label class="form-label">Tipo de Produto</label><div style="display:flex;gap:6px"><select class="form-select" id="rcT" style="flex:1"><option value="">Selecione...</option>' +
      tipos.map(function (t) { return '<option value="' + esc(t) + '"' + (rc.type === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') +
      '</select><button class="btn-icon" onclick="rcTipos()" title="Gerenciar tipos" style="flex-shrink:0">' + I.edit + '</button></div></div></div>' +
      '<div class="form-group"><label class="form-label">Linhas</label><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (chk || '<span style="font-size:12px;color:var(--text-muted)">Nenhuma linha cadastrada ainda (as linhas vêm do módulo Produtos).</span>') + '</div></div>' +
      '<h4 style="' + H4 + '">Ingredientes e porcentagens</h4>' +
      '<div style="' + CAB + ';grid-template-columns:3fr 1fr 2fr 36px"><span>Ingrediente</span><span>%</span><span>Observação</span><span></span></div>' +
      '<div id="rcList"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="rcAddIng()">' + I.plus + ' Ingrediente</button><div id="rcSoma" style="font-size:13px"></div></div>' +
      '<h4 style="' + H4 + '">Modo de Preparo</h4>' +
      '<div class="form-group" style="margin-bottom:0"><textarea class="form-textarea" id="rcPrep" rows="5" placeholder="Cada linha será um passo separado na produção">' + esc(rc.prep) + '</textarea></div>';
  }

  function rcRender1() {
    var l = el('rcList');
    if (!l) return;
    l.innerHTML = rc.ing.map(function (g, i) {
      return '<div style="display:grid;grid-template-columns:3fr 1fr 2fr 36px;gap:6px;align-items:center;margin-bottom:5px">' +
        '<div style="position:relative"><input class="form-input" id="rcN' + i + '" value="' + esc(g.name) + '" placeholder="Nome do ingrediente" oninput="rcNome(' + i + ',this.value)" onfocus="rcBusca(' + i + ',this.value)" onblur="rcFecha(' + i + ')" autocomplete="off" style="padding:7px 8px;font-size:12px">' +
        '<div id="rcDrop' + i + '" style="position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--shadow-md);z-index:10;display:none;max-height:140px;overflow-y:auto"></div></div>' +
        '<input class="form-input" type="number" step="0.01" min="0" value="' + esc(g.pct) + '" placeholder="%" oninput="rcPct(' + i + ',this.value)" style="padding:7px 8px;font-size:12px">' +
        '<input class="form-input" value="' + esc(g.obs) + '" placeholder="Obs" oninput="rcObs(' + i + ',this.value)" style="padding:7px 8px;font-size:11px">' +
        '<button class="remove-btn" onclick="rcDelIng(' + i + ')">' + I.trash + '</button></div>';
    }).join('');
  }
  function atualizarSoma() {
    var t = somaPct(rc.ing), ok = Math.abs(t - 100) <= 0.05;
    var msg = 'Soma das porcentagens: <strong style="color:' + (ok ? 'var(--oliva)' : 'var(--rosa-antigo)') + '">' + fmtPct(t) + '%</strong>';
    if (!ok) msg += ' <span style="color:var(--rosa-antigo)">(' + (t < 100 ? 'faltam ' : 'passou ') + fmtPct(Math.abs(t - 100)) + '%)</span>';
    var e = el('rcSoma');
    if (e) e.innerHTML = msg;
  }
  function lerPasso1() {
    if (!rc || !el('rcN')) return;
    rc.name = val('rcN'); rc.type = val('rcT'); rc.prep = val('rcPrep');
    rc.lines = [].slice.call(document.querySelectorAll('.rcLineChk:checked')).map(function (c) { return c.value; });
  }

  function abrirPasso1() {
    window.__rcTrocando = true;
    try {
      openModal(rc.id ? 'Editar Fórmula' : 'Nova Fórmula', htmlPasso1(),
        (rc.id ? '<button class="btn btn-ghost" style="color:var(--rosa-antigo)" onclick="delForm(\'' + esc(rc.id) + '\');closeModal()">Excluir</button>' : '') +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="rcSeguir()">Seguir ' + SETA + '</button>', true);
    } finally { window.__rcTrocando = false; }
    rcRender1(); atualizarSoma();
  }

  window.rcAddIng = function () {
    if (!rc) return;
    rc.ing.push(linhaVazia()); rcRender1(); atualizarSoma();
    var inp = el('rcN' + (rc.ing.length - 1)); if (inp) inp.focus();
  };
  window.rcDelIng = function (i) {
    if (!rc) return;
    rc.ing.splice(i, 1);
    if (!rc.ing.length) rc.ing.push(linhaVazia());
    rcRender1(); atualizarSoma();
  };
  window.rcNome = function (i, v) { if (!rc) return; rc.ing[i].name = v; window.rcBusca(i, v); };
  window.rcPct = function (i, v) { if (!rc) return; rc.ing[i].pct = v; atualizarSoma(); };
  window.rcObs = function (i, v) { if (rc) rc.ing[i].obs = v; };
  window.rcBusca = function (i, q) {
    var d = el('rcDrop' + i);
    if (!rc || !d) return;
    var n = norm(q);
    if (!n) { d.style.display = 'none'; return; }
    var nomes = nomesConhecidos().filter(function (x) { return norm(x).indexOf(n) > -1 && norm(x) !== n; }).slice(0, 6);
    rc.sug[i] = nomes;
    if (!nomes.length) { d.style.display = 'none'; return; }
    d.style.display = 'block';
    d.innerHTML = nomes.map(function (x, k) {
      return '<div style="padding:6px 10px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--bg-warm)\'" onmouseout="this.style.background=\'\'" onmousedown="rcEscolhe(' + i + ',' + k + ')">' + esc(x) + '</div>';
    }).join('');
  };
  window.rcEscolhe = function (i, k) {
    if (!rc || !rc.sug[i]) return;
    var nome = rc.sug[i][k];
    rc.ing[i].name = nome;
    var inp = el('rcN' + i); if (inp) inp.value = nome;
    var d = el('rcDrop' + i); if (d) d.style.display = 'none';
  };
  window.rcFecha = function (i) {
    setTimeout(function () { var d = el('rcDrop' + i); if (d) d.style.display = 'none'; }, 150);
  };
  window.rcTipos = function () {
    if (!rc) return;
    lerPasso1(); rc.pausado = true;
    window.__rcTrocando = true;
    try { promptAddType(); } finally { window.__rcTrocando = false; }
  };
  window.rcAbrir1 = function () { if (!rc) return; rc.pausado = false; abrirPasso1(); };

  window.rcSeguir = function () {
    if (!rc) return;
    lerPasso1();
    if (!rc.name.trim()) { toast('Preencha o nome da fórmula'); return; }
    var validos = rc.ing.filter(function (g) { return String(g.name).trim() && parseFloat(g.pct) > 0; });
    if (!validos.length) { toast('Adicione pelo menos um ingrediente com a porcentagem'); return; }
    if (rc.ing.some(function (g) { return !String(g.name).trim() && parseFloat(g.pct) > 0; })) { toast('Há uma porcentagem sem o nome do ingrediente'); return; }
    var soma = somaPct(rc.ing);
    if (Math.abs(soma - 100) > 0.05 && !window.confirm('A soma das porcentagens é ' + fmtPct(soma) + '%, e não 100%. Seguir mesmo assim?')) return;
    rc.ing = rc.ing.filter(function (g) { return String(g.name).trim(); });
    preencherPrecos();
    abrirPasso2();
  };

  /* ---------------- tela 2: custos ---------------- */
  function preencherPrecos() {
    var calc = window.__mundanaCustoPorUnidade;
    if (typeof calc !== 'function') return;
    var hist = DB.get('mp_price_hist');
    rc.ing.forEach(function (g) {
      if (!g.name || String(g.price).trim() !== '') return;
      var un = 'kg', c = calc(hist, g.name, 'kg');
      if (!c) { c = calc(hist, g.name, 'l'); un = 'l'; }
      if (!c) return;
      g.price = String(Math.round(c.valor * 100) / 100); g.pu = un; g.autoVal = g.price;
    });
  }
  function campo(rotulo, id, valor, ph, step) {
    return '<div class="form-group"><label class="form-label">' + rotulo + '</label><input class="form-input" id="' + id + '" type="number" step="' + step + '" min="0" value="' + esc(valor) + '" placeholder="' + ph + '" oninput="rcCalc()"></div>';
  }
  function htmlPasso2() {
    var linhas = rc.ing.map(function (g, i) {
      if (!String(g.name).trim()) return '';
      return '<div style="display:grid;grid-template-columns:2.2fr 0.7fr 1fr 1.9fr 1fr;gap:6px;align-items:start;margin-bottom:6px">' +
        '<div style="padding:8px 0;font-size:13px;font-weight:600">' + esc(g.name) + '</div>' +
        '<div style="padding:8px 0;font-size:13px">' + fmtPct(parseFloat(g.pct) || 0) + '%</div>' +
        '<div id="rcQ' + i + '" style="padding:8px 0;font-size:13px;color:var(--text-muted)">-</div>' +
        '<div><div style="display:flex;gap:4px"><input class="form-input" id="rcPr' + i + '" type="number" step="0.01" min="0" value="' + esc(g.price) + '" placeholder="R$" oninput="rcCalc()" style="flex:1;min-width:0;padding:7px 8px;font-size:12px">' +
        '<select class="form-select" id="rcPu' + i + '" onchange="rcCalc()" style="width:84px;padding:7px 6px;font-size:12px">' +
        [['kg', 'R$/kg'], ['g', 'R$/g'], ['l', 'R$/L']].map(function (o) { return '<option value="' + o[0] + '"' + (g.pu === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div><div id="rcA' + i + '" style="font-size:10px;color:var(--text-muted);margin-top:2px"></div></div>' +
        '<div id="rcC' + i + '" style="padding:8px 0;font-size:13px;font-weight:600">-</div></div>';
    }).join('');
    return indicador(2) +
      '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Receita: <strong style="color:var(--text-primary)">' + esc(rc.name) + '</strong></div>' +
      '<div class="form-row" style="grid-template-columns:1fr 1fr 1fr 1fr">' +
      campo('Tamanho do lote (g)', 'rcLot', rc.lot, 'Ex: 3000', '1') + campo('Tam. por unidade (g)', 'rcUni', rc.uni, 'Ex: 300', '1') +
      campo('Embalagem/un. (R$)', 'rcPack', rc.pack, 'Ex: 15.37', '0.01') + campo('Outros custos/un. (R$)', 'rcOut', rc.out, 'Ex: 2.00', '0.01') + '</div>' +
      '<h4 style="' + H4 + '">Matérias-primas (por lote)</h4>' +
      '<div style="overflow-x:auto"><div style="min-width:640px">' +
      '<div style="' + CAB + ';grid-template-columns:2.2fr 0.7fr 1fr 1.9fr 1fr"><span>Ingrediente</span><span>%</span><span>Qtd/lote</span><span>Preço pago</span><span>Custo total</span></div>' +
      linhas + '</div></div>' +
      '<div style="text-align:right;font-size:13px;color:var(--text-muted);margin-top:6px">Total MP: <strong id="rcTot" style="color:var(--oliva)">R$ 0,00</strong></div>' +
      '<div id="rcResumo"></div>' +
      '<div class="form-group" style="margin-top:16px"><label class="form-label">Preço Final (R$)</label><input class="form-input" id="rcFinal" type="number" step="0.01" min="0" value="' + esc(rc.final) + '" placeholder="Ex: 72.67" oninput="rcCalc()"><p style="font-size:11px;color:var(--text-muted);margin-top:4px">Preço praticado. Reflete no módulo Produtos.</p></div>';
  }
  function abrirPasso2() {
    window.__rcTrocando = true;
    try {
      openModal(rc.id ? 'Editar Fórmula' : 'Nova Fórmula', htmlPasso2(),
        '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-secondary" onclick="rcVoltar()">' + VOLTA + ' Voltar</button><button class="btn btn-primary" onclick="rcSalvar()">Salvar</button>', true);
    } finally { window.__rcTrocando = false; }
    window.rcCalc();
  }
  function lerPasso2() {
    if (!rc || !el('rcLot')) return;
    rc.lot = val('rcLot'); rc.uni = val('rcUni'); rc.pack = val('rcPack'); rc.out = val('rcOut'); rc.final = val('rcFinal');
    rc.ing.forEach(function (g, i) {
      var p = el('rcPr' + i), u = el('rcPu' + i);
      if (p) g.price = p.value;
      if (u) g.pu = u.value;
    });
  }
  function htmlResumo(c, aviso, final) {
    var cfg = getCfg();
    var incompleta = c.incompleta || !(c.unitsLot > 0);
    function lin(rot, v, forte) {
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-light);font-size:13px"><span>' + rot + '</span><strong' + (forte ? ' style="color:var(--oliva)"' : '') + '>' + v + '</strong></div>';
    }
    var h = '<div style="background:var(--bg-warm);border-radius:var(--radius-md);padding:14px 16px;margin-top:16px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);font-weight:700;margin-bottom:6px">Resumo do cálculo</div>';
    if (aviso) h += '<div style="font-size:12px;color:var(--rosa-antigo);margin-bottom:8px">' + aviso + '</div>';
    h += lin('Unidades por lote', c.unitsLot) + lin('Matéria-prima (lote)', fmtR(c.totalMP)) +
      lin('Custo variável por un. (com perdas)', fmtR(c.costVarUnit)) + lin('Rateio dos custos fixos por un.', fmtR(c.fixedPerUnit)) +
      lin('Custo total por un.', fmtR(c.costTotalUnit));
    if (incompleta) h += lin('Preço sugerido', '-');
    else {
      h += lin('Preço mínimo', fmtR(c.priceMin)) + lin('Preço sugerido', fmtR(c.priceSuggested), true) +
        lin('Lucro por un. (no sugerido)', fmtR(c.profit) + ' (' + (c.marginReal * 100).toFixed(1) + '%)');
      if (final > 0) {
        var lucro = final * (1 - cfg.taxRate - cfg.cardRate) - c.costTotalUnit;
        h += lin('Lucro por un. no Preço Final', fmtR(lucro) + ' (' + (lucro / final * 100).toFixed(1) + '%)');
      }
    }
    return h + '</div>';
  }
  window.rcCalc = function () {
    if (!rc || !el('rcLot')) return;
    lerPasso2();
    var lot = parseFloat(rc.lot) || 0, total = 0, faltam = 0;
    rc.ing.forEach(function (g, i) {
      if (!String(g.name).trim()) return;
      var gramas = lot * (parseFloat(g.pct) || 0) / 100;
      var perG = precoPorGrama(g.price, g.pu);
      var temPreco = String(g.price).trim() !== ''; /* "0" digitado vale: água, por exemplo, custa zero */
      total += gramas * perG;
      if ((parseFloat(g.pct) || 0) > 0 && !temPreco) faltam++;
      setTxt('rcQ' + i, gramas > 0 ? fmt3(gramas) + ' g' : '-');
      setTxt('rcC' + i, temPreco && gramas > 0 ? fmtR(gramas * perG) : '-');
      setTxt('rcA' + i, g.autoVal && g.price === g.autoVal ? 'da última compra' : '');
    });
    var c = calcFormula(formulaTemp(rc));
    setTxt('rcTot', fmtR(c.totalMP)); /* mesmo número do resumo */
    var aviso = '';
    if (!(lot > 0) || !(parseFloat(rc.uni) > 0)) aviso = 'Preencha o tamanho do lote e o tamanho por unidade para calcular o preço.';
    else if (faltam) aviso = faltam + ' ingrediente' + (faltam > 1 ? 's' : '') + ' ainda sem preço.';
    var box = el('rcResumo');
    if (box) box.innerHTML = htmlResumo(c, aviso, parseFloat(rc.final) || 0);
  };
  window.rcVoltar = function () { if (!rc) return; lerPasso2(); abrirPasso1(); };
  window.rcSalvar = function () {
    if (!rc) return;
    lerPasso2();
    if (!(parseFloat(rc.lot) > 0) || !(parseFloat(rc.uni) > 0)) {
      if (!window.confirm('Salvar sem o tamanho do lote ou da unidade? O preço não será calculado até você preencher.')) return;
    }
    salvarReceita();
  };

  /* ---------------- salvar (mesmo formato de antes, mais a porcentagem) ---------------- */
  function salvarReceita() {
    var forms = DB.get('formulas');
    var id = rc.id;
    var existente = id ? achar(forms, id) : null;
    var d = Object.assign({}, existente || {}, {
      id: id || uid(), name: rc.name.trim(), productType: rc.type, lines: rc.lines.slice(), line: rc.lines.join(', '),
      finalPrice: rc.final || '', lotSize: rc.lot, unitSize: rc.uni, packagingCost: rc.pack, otherCosts: rc.out,
      ingredients: montarIngredientes(rc), prepSteps: rc.prep
    });
    if (id) { var i = forms.findIndex(function (f) { return f.id === id; }); if (i >= 0) forms[i] = d; else forms.push(d); } else forms.push(d);
    DB.set('formulas', forms);
    /* preço final vai para os produtos da mesma linha e do mesmo tipo (como já era) */
    if (d.finalPrice) {
      var prods = DB.get('products'), changed = 0;
      var fLines = (d.lines || []).map(function (l) { return (l || '').trim().toLowerCase(); });
      var fType = (d.productType || '').trim().toLowerCase();
      prods.forEach(function (p) {
        var pLine = (p.line || '').trim().toLowerCase(), pType = (p.type || '').trim().toLowerCase();
        if (fLines.length > 0 && fLines.indexOf(pLine) > -1 && fType && pType === fType && p.price !== d.finalPrice) {
          var ph = DB.get('price_history');
          if (p.price) ph.push({ id: uid(), productId: p.id, productName: p.name, oldPrice: parseFloat(p.price) || 0, newPrice: parseFloat(d.finalPrice) || 0, date: localDateStr() });
          DB.set('price_history', ph);
          p.price = d.finalPrice; changed++;
        }
      });
      if (changed) { DB.set('products', prods); toast('Preço atualizado em ' + changed + ' produto(s)'); }
    }
    closeModal(); rForms();
    toast(id ? 'Fórmula atualizada' : 'Fórmula cadastrada');
  }

  /* ---------------- ver a fórmula: quantidades em g e preço como foi digitado ---------------- */
  function polirVisualizacao(id) {
    var f = achar(DB.get('formulas'), id);
    var tabela = document.querySelector('#modalBody table');
    if (!f || !tabela) return;
    var linhas = tabela.querySelectorAll('tbody tr');
    (f.ingredients || []).forEach(function (g, i) {
      var tr = linhas[i];
      if (!tr || !g.priceInput) return;
      var td = tr.querySelectorAll('td');
      if (td.length < 5) return;
      if (g.pct) td[0].textContent = g.name + ' (' + String(g.pct).replace('.', ',') + '%)';
      td[2].textContent = fmt3(parseFloat(g.qtyLot) || 0) + ' g';
      td[3].textContent = fmtR(g.priceInput) + '/' + g.priceUnit;
    });
  }

  /* ---------------- ligações com o sistema ---------------- */
  function openFormModalNovo(id) {
    var f = id ? achar(DB.get('formulas'), id) : null;
    if (id && !f) return;
    rc = estadoDe(f);
    abrirPasso1();
  }
  window.openFormModal = openFormModalNovo;
  envolver('closeModal', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      if (!window.__rcTrocando) rc = null;
      return r;
    };
  });
  envolver('promptAddType', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try {
        if (rc && rc.pausado) { var b = document.querySelector('#modalFooter button'); if (b) b.setAttribute('onclick', 'rcAbrir1()'); }
      } catch (e) { /* ignorar */ }
      return r;
    };
  });
  envolver('viewFormula', function (antes) {
    return function (id) {
      var r = antes.apply(this, arguments);
      try { polirVisualizacao(id); } catch (e) { console.warn('correcoes-receitas: visualização', e); }
      return r;
    };
  });

  /* ---------------- autoteste (console: CorrecoesReceitasTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    ok('preço por grama: kg, g e litro', precoPorGrama('45', 'kg') === 0.045 && precoPorGrama('0.045', 'g') === 0.045 && precoPorGrama('30', 'l') === 0.03 && precoPorGrama('', 'kg') === 0);
    ok('quantidade em g, kg e ml vira gramas', gramasDe({ qtyLot: '250', unit: 'g' }) === 250 && gramasDe({ qtyLot: '2', unit: 'kg' }) === 2000 && gramasDe({ qtyLot: '30', unit: 'ml' }) === 30 && gramasDe({ qtyLot: '5' }) === 5);
    var s = { lot: '500', uni: '100', pack: '2', out: '1', ing: [{ name: 'A', pct: '40', price: '45', pu: 'kg' }, { name: 'B', pct: '60', price: '20', pu: 'kg' }, { name: '', pct: '', price: '', pu: 'kg' }] };
    var ings = montarIngredientes(s);
    ok('a porcentagem vira quantidade por lote e custo de cada ingrediente', ings.length === 2 && ings[0].qtyLot === '200' && ings[1].qtyLot === '300' && parseFloat(ings[0].totalCost) === 9 && parseFloat(ings[1].totalCost) === 6 && ings[0].unit === 'g' && ings[0].priceInput === '45' && ings[0].priceUnit === 'kg' && ings[0].pct === '40');
    var c = calcFormula(formulaTemp(s));
    ok('o cálculo do sistema recebe a matéria-prima montada pela receita', c.unitsLot === 5 && Math.abs(c.totalMP - 15) < 1e-9 && c.packagingLot === 10 && c.otherLot === 5);
    ok('soma das porcentagens', somaPct([{ pct: '40' }, { pct: '60' }]) === 100 && Math.abs(somaPct([{ pct: '33.33' }, { pct: '33.33' }, { pct: '33.33' }]) - 99.99) < 1e-9 && somaPct([]) === 0);
    var antiga = estadoDe({ id: 'f1', name: 'N', lotSize: '1000', ingredients: [{ name: 'A', unit: 'g', qtyLot: '250', unitCost: '0.04' }] });
    ok('fórmula antiga abre com a porcentagem e o preço por kg calculados', antiga.ing.length === 1 && antiga.ing[0].pct === '25' && antiga.ing[0].price === '40' && antiga.ing[0].pu === 'kg');
    var nova = estadoDe(null);
    ok('fórmula nova começa com 3 linhas vazias', nova.id === '' && nova.ing.length === 3 && nova.ing[0].name === '' && nova.lines.length === 0);
    var salva = estadoDe({ id: 'f2', name: 'M', lotSize: '500', ingredients: [{ name: 'A', pct: '12.5', priceInput: '30', priceUnit: 'g', unitCost: '30', qtyLot: '62.5', unit: 'g' }] });
    ok('fórmula salva pela receita reabre com o que foi digitado', salva.ing[0].pct === '12.5' && salva.ing[0].price === '30' && salva.ing[0].pu === 'g');
    var res = htmlResumo(calcFormula(formulaTemp(s)), 'Aviso de teste', 0);
    ok('o resumo mostra o cálculo e o aviso', res.indexOf('Aviso de teste') > -1 && res.indexOf('Preço sugerido') > -1 && res.indexOf('Custo total por un.') > -1);
    ok('SISTEMA: telas de receita instaladas', window.openFormModal === openFormModalNovo && typeof window.rcSeguir === 'function' && window.viewFormula._rec === true && window.closeModal._rec === true);
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'CORRECOES-RECEITAS: ' + r.length + ' testes, 0 falhas' : 'CORRECOES-RECEITAS: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }
  window.CorrecoesReceitasTeste = teste;
})();
