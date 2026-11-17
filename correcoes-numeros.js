/* ============================================================
   MUNDANA · CORREÇÕES — Lote 3: números certos e telas
   Instalação: no index.html, DEPOIS do correcoes-dia.js e antes de </body>:
       <script src="correcoes-numeros.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha.
   Autoteste: no console (F12) digite  CorrecoesNumerosTeste()

   Pedidos
   A1  O pedido usa o Preço Final da fórmula (antes usava o sugerido).
   A2  Fluxo de status: o estoque é baixado ao despachar ou entregar (uma vez só), devolvido
       ao cancelar ou voltar o status, e o A Receber nasce, é atualizado ou sai junto.
       Avançar o status pelo selo pede confirmação e avisa se o estoque não cobre o pedido.
       Excluir o pedido devolve o estoque e tira o A Receber que ainda estiver pendente.
   A8  Pedido pago à vista (PIX, Cartão, Dinheiro) entra no A Receber já como recebido.
   A9  Lead "ganho" não cria mais pedido repetido, e o rascunho usa o Preço Final.
   M9  Numeração de pedidos não repete depois de excluir.
   M11 Ao editar um pedido, o total e o preço acompanham as mudanças.
   M20 "Faturamento" conta só pedidos despachados ou entregues.
   M10 Sugestão de recompra ignora clientes que já fizeram pedido mais novo.
   Estoque e produção
   A3  A produção desconta a matéria-prima de todas as compras (a mais antiga primeiro).
   A4  Alerta de estoque baixo soma as compras da mesma matéria-prima (Dashboard, sino e Modo Dia).
   A7  Nova entrada de estoque grava o histórico de preço do fornecedor e oferece criar o lançamento no A Pagar.
   Telas
   A11 Tabelas largas ganham rolagem; no celular aparece o botão de menu.
   M8  Produtos ganha o botão Pastas.
   M13 Custos fixos esvaziados não voltam com os valores de exemplo.
   M14 Excluir registro do histórico de preços atualiza a tela.
   M16 A última parcela absorve a diferença de centavos.
   M19 A Agenda do Modo Dia mostra também os recebimentos pendentes.
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof calcFormula !== 'function' || typeof rPedidos !== 'function' || typeof localDateStr !== 'function') {
    console.error('correcoes-numeros.js: carregue este arquivo DEPOIS do script principal (antes de </body>).');
    return;
  }
  if (window.__correcoesNumeros) { return; }
  window.__correcoesNumeros = true;

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '-'); }
  function fmtNum(n) { return String(Math.round((parseFloat(n) || 0) * 100) / 100); }
  var ALIAS_U = { g: 'g', gr: 'g', grama: 'g', gramas: 'g', kg: 'kg', quilo: 'kg', quilos: 'kg', mg: 'mg', ml: 'ml', l: 'l', lt: 'l', litro: 'l', litros: 'l', un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un' };
  var BASE_U = { g: ['m', 1], kg: ['m', 1000], mg: ['m', 0.001], ml: ['v', 1], l: ['v', 1000], un: ['u', 1] };
  function infoU(u) { var k = ALIAS_U[norm(u).replace(/\./g, '')]; return k ? BASE_U[k] : null; }
  /* quanto vale 1 unidade "de" na unidade "para" (1 g = 0,001 kg); null se não der para converter */
  function fatorEntre(de, para) {
    var a = infoU(de), b = infoU(para);
    if (!a || !b || a[0] !== b[0]) return null;
    return a[1] / b[1];
  }
  function achar(lista, id) { var r = null; (lista || []).forEach(function (x) { if (x && x.id === id) r = x; }); return r; }
  function envolver(nome, fabrica) {
    var antes = window[nome];
    if (typeof antes !== 'function') return;
    var novo = fabrica(antes);
    Object.keys(antes).forEach(function (k) { if (k.charAt(0) === '_') novo[k] = antes[k]; });
    novo._num = true;
    window[nome] = novo;
  }

  /* ---------------- A1: preço do pedido ---------------- */
  function precoDoProduto(f) {
    var fp = parseFloat(f.finalPrice);
    if (!isNaN(fp) && fp > 0) return fp;
    return calcFormula(f).priceSuggested;
  }
  function precoPorNome(nome) {
    var f = null;
    DB.get('formulas').forEach(function (x) { if (x.name === nome) f = x; });
    return f ? precoDoProduto(f) : 0;
  }

  /* ---------------- M9: numeração ---------------- */
  function proximoNumeroPedido(lista) {
    var max = 0;
    (lista || []).forEach(function (p) {
      var n = parseInt(String(p && p.numero).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return String(max + 1).padStart(4, '0');
  }
  function proximoNumeroLote(lots, dataStr) {
    var max = 0;
    (lots || []).forEach(function (l) {
      var m = /-(\d+)$/.exec(String((l && l.lotNumber) || ''));
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    });
    return 'LOT-' + dataStr.replace(/-/g, '') + '-' + String(max + 1).padStart(3, '0');
  }

  /* validade do produto acabado: 1 ano depois da fabricação (29/02 vira 28/02) */
  function validadeUmAno(dataStr) {
    var p = String(dataStr).split('-');
    var a = parseInt(p[0], 10) + 1, m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    var ultimo = new Date(a, m, 0).getDate();
    return a + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(d, ultimo)).padStart(2, '0');
  }
  /* a tela de produção compara o estoque com o necessário na unidade do ingrediente: converte kg para g, etc. */
  function estoqueNasUnidadesDaFormula(stock, f) {
    var un = {};
    ((f && f.ingredients) || []).forEach(function (ing) { var n = norm(ing.name); if (n && ing.unit && !un[n]) un[n] = ing.unit; });
    return (stock || []).map(function (s) {
      var alvo = un[norm(s.name)];
      var fator = alvo ? fatorEntre(s.unit, alvo) : null;
      if (!fator || fator === 1) return s;
      return Object.assign({}, s, { quantity: String(Math.round((parseFloat(s.quantity) || 0) * fator * 1e6) / 1e6), unit: alvo });
    });
  }

  /* ---------------- A2: estoque de produto acabado ---------------- */
  function baixarEstoquePA(pa, pedido) {
    var baixas = [], faltas = [];
    (pedido.itens || []).forEach(function (it) {
      var restante = parseInt(it.qty, 10) || 0;
      pa.filter(function (s) { return s.name === it.name && s.status === 'disponivel' && (parseInt(s.quantity, 10) || 0) > 0; })
        .sort(function (a, b) { return String(a.validade || '').localeCompare(String(b.validade || '')); })
        .forEach(function (s) {
          if (restante <= 0) return;
          var disp = parseInt(s.quantity, 10) || 0, tira = Math.min(disp, restante);
          s.quantity = disp - tira; restante -= tira;
          if (s.quantity <= 0) s.status = 'vendido';
          baixas.push({ id: s.id, qty: tira });
        });
      if (restante > 0) faltas.push({ name: it.name, qty: restante });
    });
    return { baixas: baixas, faltas: faltas };
  }
  function faltasEstoque(pa, pedido) {
    return baixarEstoquePA(JSON.parse(JSON.stringify(pa || [])), pedido).faltas;
  }
  function textoFaltas(f) { return f.map(function (x) { return x.qty + ' un de ' + x.name; }).join(', '); }

  function devolverEstoquePA(pa, pedido) {
    var devolvido = 0;
    if (pedido.baixas && pedido.baixas.length) {
      pedido.baixas.forEach(function (b) {
        var s = achar(pa, b.id);
        if (!s) return;
        s.quantity = (parseInt(s.quantity, 10) || 0) + b.qty;
        if (s.status === 'vendido' && s.quantity > 0) s.status = 'disponivel';
        devolvido += b.qty;
      });
    } else {
      (pedido.itens || []).forEach(function (it) {
        var cand = pa.filter(function (s) { return s.name === it.name; })
          .sort(function (a, b) { return String(b.fabricacao || '').localeCompare(String(a.fabricacao || '')); })[0];
        if (!cand) return;
        var q = parseInt(it.qty, 10) || 0;
        cand.quantity = (parseInt(cand.quantity, 10) || 0) + q;
        if (cand.status === 'vendido') cand.status = 'disponivel';
        devolvido += q;
      });
    }
    return devolvido;
  }
  function ehAtivo(status) { return status === 'despachado' || status === 'entregue'; }
  /* pedidos antigos (sem a marca) já despachados contam como baixados, porque o sistema antigo baixava ao despachar */
  function jaBaixado(p) {
    return p.estoqueBaixado === true || (p.estoqueBaixado === undefined && ehAtivo(p.status));
  }
  function aplicarStatusPedidoPA(p, depois, pa) {
    var msgs = [];
    var ativo = ehAtivo(depois), baixado = jaBaixado(p);
    if (ativo && !baixado) {
      var res = baixarEstoquePA(pa, p);
      p.baixas = res.baixas; p.estoqueBaixado = true;
      if (res.faltas.length) msgs.push('Estoque insuficiente: ' + textoFaltas(res.faltas));
    } else if (!ativo && baixado) {
      var dev = devolverEstoquePA(pa, p);
      p.baixas = []; p.estoqueBaixado = false;
      if (dev > 0) msgs.push(dev + ' un devolvida(s) ao estoque');
    } else if (ativo && baixado && p.estoqueBaixado === undefined) {
      p.estoqueBaixado = true;
    }
    p.status = depois;
    return msgs;
  }
  function aplicarStatusPedido(p, depois) {
    var pa = DB.get('stockpa');
    var msgs = aplicarStatusPedidoPA(p, depois, pa);
    if (pa.length) DB.set('stockpa', pa);
    return msgs;
  }
  function itensMudaram(a, b) {
    function sig(l) { return JSON.stringify((l || []).map(function (i) { return [i.name, parseInt(i.qty, 10) || 0]; })); }
    return sig(a) !== sig(b);
  }

  /* ---------------- A2 e A8: A Receber do pedido ---------------- */
  var FORMAS_A_VISTA = ['PIX', 'Cartão', 'Dinheiro'];
  function planoReceber(p, existente) {
    if (ehAtivo(p.status)) {
      var recebido = FORMAS_A_VISTA.indexOf(p.pagamento) > -1;
      var descricao = 'Pedido #' + p.numero + ' \u2014 ' + (p.cliente || '');
      if (!existente) {
        return { acao: 'criar', linha: { descricao: descricao, cliente: p.cliente || '', valor: p.total, vencimento: p.data, status: recebido ? 'recebido' : 'pendente', tipo: 'Venda', pedidoId: p.id } };
      }
      if (existente.status !== 'recebido') return { acao: 'atualizar', linha: { descricao: descricao, valor: p.total, vencimento: p.data } };
      return { acao: 'nada' };
    }
    if (!existente) return { acao: 'nada' };
    if (existente.status === 'recebido') return { acao: 'nada', aviso: 'O recebimento deste pedido já estava baixado em A Receber; revise lá.' };
    return { acao: 'remover' };
  }
  function sincronizarReceberPedido(p) {
    var lista = DB.get('receber'), idx = -1;
    lista.forEach(function (r, i) { if (r.pedidoId === p.id) idx = i; });
    var plano = planoReceber(p, idx >= 0 ? lista[idx] : null);
    if (plano.acao === 'criar') { plano.linha.id = uid(); lista.push(plano.linha); DB.set('receber', lista); }
    else if (plano.acao === 'atualizar') { Object.keys(plano.linha).forEach(function (k) { lista[idx][k] = plano.linha[k]; }); DB.set('receber', lista); }
    else if (plano.acao === 'remover') { lista.splice(idx, 1); DB.set('receber', lista); }
    if (plano.aviso) toast(plano.aviso);
  }

  /* ---------------- A2: salvar, avançar e excluir pedido ---------------- */
  function rotuloStatus(s) { return { novo: 'Novo', preparando: 'Preparando', despachado: 'Despachado', entregue: 'Entregue', cancelado: 'Cancelado' }[s] || s; }
  function valorCampo(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  var savePedidoOriginal = window.savePedido;
  function savePedidoNovo(id) {
    /* proteção: se a janela do pedido não tiver os campos esperados, usa o salvar original do sistema */
    if (typeof savePedidoOriginal === 'function' && (!document.getElementById('pedNum') || !document.getElementById('pedCli') || !document.getElementById('pedData'))) {
      return savePedidoOriginal.apply(this, arguments);
    }
    var items = DB.get('pedidos');
    var itens = [];
    document.querySelectorAll('.ped-item-row').forEach(function (r) {
      var name = r.querySelector('.pedProd').value;
      var qty = parseInt(r.querySelector('.pedQty').value, 10) || 0;
      var price = parseFloat(r.querySelector('.pedPrice').value) || 0;
      var line = r.querySelector('.pedLine') ? r.querySelector('.pedLine').value : '';
      if (name && qty > 0) itens.push({ name: name, line: line, qty: qty, price: price });
    });
    if (itens.length === 0) { toast('Adicione pelo menos um item'); return; }
    var total = itens.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
    var antigo = id ? achar(items, id) : null;
    var novoStatus = id ? valorCampo('pedStatus') : 'novo';
    var d = Object.assign({}, antigo || {}, {
      id: id || uid(), numero: valorCampo('pedNum'), cliente: valorCampo('pedCli'), telefone: valorCampo('pedTel'),
      canal: valorCampo('pedCanal'), pagamento: valorCampo('pedPag'), data: valorCampo('pedData'),
      itens: itens, total: total, obs: valorCampo('pedObs')
    });
    if (!antigo) d.status = 'novo';
    /* itens mudaram depois da baixa: devolve a baixa antiga para refazer com os itens novos */
    if (antigo && jaBaixado(antigo) && itensMudaram(antigo.itens, itens)) {
      var paR = DB.get('stockpa'); devolverEstoquePA(paR, antigo); DB.set('stockpa', paR);
      d.baixas = []; d.estoqueBaixado = false;
    }
    if (ehAtivo(novoStatus) && !jaBaixado(d)) {
      var faltas = faltasEstoque(DB.get('stockpa'), d);
      if (faltas.length && !window.confirm('Estoque insuficiente: ' + textoFaltas(faltas) + '.\n\nContinuar mesmo assim? O estoque disponível será zerado.')) return;
    }
    var msgs = aplicarStatusPedido(d, novoStatus);
    if (id) { var i = items.findIndex(function (x) { return x.id === id; }); if (i >= 0) items[i] = d; else items.push(d); } else items.push(d);
    DB.set('pedidos', items);
    sincronizarReceberPedido(d);
    closeModal(); rPedidos();
    toast((id ? 'Pedido atualizado' : 'Pedido cadastrado') + (msgs.length ? ' \u00B7 ' + msgs.join(' \u00B7 ') : ''));
  }
  function advancePedidoNovo(id) {
    var items = DB.get('pedidos'), p = achar(items, id);
    if (!p) return;
    var flow = ['novo', 'preparando', 'despachado', 'entregue'];
    var idx = flow.indexOf(p.status);
    if (idx < 0 || idx >= flow.length - 1) return;
    var prox = flow[idx + 1];
    if (prox === 'despachado' && !jaBaixado(p)) {
      var faltas = faltasEstoque(DB.get('stockpa'), p);
      var aviso = 'Despachar o pedido #' + p.numero + '? O estoque será baixado.' + (faltas.length ? '\n\nATENÇÃO: estoque insuficiente (' + textoFaltas(faltas) + '). O disponível será zerado.' : '');
      if (!window.confirm(aviso)) return;
    }
    var msgs = aplicarStatusPedido(p, prox);
    DB.set('pedidos', items);
    sincronizarReceberPedido(p);
    rPedidos();
    toast('Status: ' + rotuloStatus(p.status) + (msgs.length ? ' \u00B7 ' + msgs.join(' \u00B7 ') : ''));
  }
  function delPedidoNovo(id) {
    var items = DB.get('pedidos'), p = achar(items, id);
    if (!p) return;
    if (!window.confirm('Excluir o pedido #' + p.numero + '?' + (jaBaixado(p) ? ' O estoque baixado será devolvido.' : ''))) return;
    if (jaBaixado(p)) { var pa = DB.get('stockpa'); devolverEstoquePA(pa, p); DB.set('stockpa', pa); }
    sincronizarReceberPedido(Object.assign({}, p, { status: 'cancelado' }));
    DB.set('pedidos', items.filter(function (x) { return x.id !== id; }));
    rPedidos(); toast('Pedido excluído');
  }

  /* ---------------- A1 e M11: linhas do pedido ---------------- */
  function ligarLinhasPedido() {
    [].slice.call(document.querySelectorAll('.ped-item-row')).forEach(function (row) {
      if (row.getAttribute('data-lig')) return;
      row.setAttribute('data-lig', '1');
      var prod = row.querySelector('.pedProd'), qty = row.querySelector('.pedQty'), pr = row.querySelector('.pedPrice');
      if (qty) qty.addEventListener('input', function () { calcPedTotal(); });
      if (pr) pr.addEventListener('input', function () { calcPedTotal(); });
      if (prod) prod.addEventListener('change', function () {
        var f = null;
        DB.get('formulas').forEach(function (x) { if (x.name === prod.value) f = x; });
        if (!f) return;
        var p = row.querySelector('.pedPrice'); if (p) p.value = precoDoProduto(f).toFixed(2);
        var ls = row.querySelector('.pedLine');
        if (ls && f.line) {
          var linha = String(f.line).split(',')[0].trim();
          for (var i = 0; i < ls.options.length; i++) { if (ls.options[i].value === linha) { ls.selectedIndex = i; break; } }
        }
        calcPedTotal();
      });
    });
  }

  /* ---------------- A9: rascunho do lead ---------------- */
  function montarRascunho(lead, pedidos, pa, precoDe) {
    var linha = lead.linha_resultado; if (!linha) return null;
    if (pedidos.some(function (p) { return p.leadId === lead.id; })) return null;
    var nomes = [];
    pa.forEach(function (i) {
      var linhas = String(i.line || '').split(',').map(function (s) { return s.trim(); });
      if (i.status === 'disponivel' && (parseInt(i.quantity, 10) || 0) > 0 && linhas.indexOf(linha) > -1 && nomes.indexOf(i.name) < 0) nomes.push(i.name);
    });
    if (!nomes.length) return null;
    var itens = nomes.map(function (name) { return { name: name, line: linha, qty: 1, price: Math.round(precoDe(name) * 100) / 100 }; });
    var total = itens.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
    return {
      id: uid(), numero: proximoNumeroPedido(pedidos), cliente: 'Lead Quiz \u2014 ' + (lead.telefone || ''), telefone: lead.telefone || '',
      canal: 'WhatsApp', pagamento: 'PIX', data: localDateStr(), itens: itens, total: total,
      obs: 'Pedido rascunho criado automaticamente a partir do Lead Quiz \u2014 Linha: ' + linha, status: 'novo', leadId: lead.id
    };
  }
  async function cycleLeadStatusNovo(id) {
    var cycle = ['novo', 'potencial', 'em_contato', 'ganho', 'perdido'];
    try {
      var res = await fetch(SUPABASE_URL + '/rest/v1/leads_quiz?id=eq.' + id + '&select=*', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
      var rows = await res.json();
      var lead = rows && rows[0] ? rows[0] : {};
      var cur = lead.status || 'novo';
      var next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
      await fetch(SUPABASE_URL + '/rest/v1/leads_quiz?id=eq.' + id, { method: 'PATCH', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: next }) });
      if (next === 'ganho' && lead.linha_resultado) {
        var pedidos = DB.get('pedidos');
        var ped = montarRascunho(lead, pedidos, DB.get('stockpa'), precoPorNome);
        if (ped) { pedidos.push(ped); DB.set('pedidos', pedidos); toast('Pedido rascunho #' + ped.numero + ' criado para ' + lead.linha_resultado); }
      }
      rLeads(); toast('Status: ' + ((LEAD_STATUS[next] || {}).label || next));
    } catch (e) { toast('Erro ao atualizar'); console.error(e); }
  }

  /* ---------------- A3: produção desconta de todas as compras ---------------- */
  /* o consumo vem na unidade do ingrediente (unidadeConsumo, ex.: g); cada compra pode estar em outra unidade (ex.: kg) */
  function baixarMPFifo(stock, nomeMin, consumo, unidadeConsumo) {
    var restante = consumo;
    stock.filter(function (s) { return norm(s.name) === nomeMin && (parseFloat(s.quantity) || 0) > 0; })
      .sort(function (a, b) { return String(a.purchaseDate || '').localeCompare(String(b.purchaseDate || '')); })
      .forEach(function (s) {
        if (restante <= 1e-9) return;
        var f = (unidadeConsumo ? fatorEntre(unidadeConsumo, s.unit) : null) || 1;
        var disp = parseFloat(s.quantity) || 0, tira = Math.min(disp / f, restante);
        s.quantity = String(Math.max(0, disp - tira * f).toFixed(f === 1 ? 2 : 4));
        restante -= tira;
      });
    return Math.max(0, restante);
  }
  function finishProdNovo() {
    var forms = DB.get('formulas'), f = achar(forms, S.prodFId);
    if (!f) return;
    var lots = DB.get('lots'), now = new Date();
    var fab = localDateStr(now);
    var valS = validadeUmAno(fab); /* validade: 1 ano */
    var numLote = proximoNumeroLote(lots, fab);
    lots.push({ id: uid(), lotNumber: numLote, formulaId: f.id, formulaName: f.name, line: f.line || '', quantity: S.prodQty, date: fab, validity: valS, status: 'em_estoque' });
    DB.set('lots', lots);
    var stock = DB.get('stockmp');
    var lotSize = parseFloat(f.lotSize) || 1;
    var ratio = S.prodQty / lotSize;
    var faltaMP = [];
    (f.ingredients || []).forEach(function (ing) {
      var ingName = norm(ing.name);
      var consumed = (parseFloat(ing.qtyLot) || 0) * ratio;
      if (!ingName || consumed <= 0) return;
      var falta = baixarMPFifo(stock, ingName, consumed, ing.unit);
      if (falta > 0.005) faltaMP.push(ing.name + ' (' + falta.toFixed(2) + ' ' + (ing.unit || '') + ')');
    });
    if (stock.length) DB.set('stockmp', stock);
    var c = calcFormula(f);
    var unitsProduced = c.unitsLot > 0 ? Math.round(c.unitsLot * ratio) : 0;
    var pa = DB.get('stockpa');
    pa.push({ id: uid(), name: f.name, productType: f.productType || '', line: f.line || '', lotNumber: numLote, quantity: unitsProduced, fabricacao: fab, validade: valS, formulaId: f.id, status: 'disponivel' });
    DB.set('stockpa', pa);
    document.getElementById('content').innerHTML = '<div style="max-width:500px;margin:60px auto;text-align:center" class="anim">' +
      '<div style="width:64px;height:64px;border-radius:50%;background:var(--oliva-pale);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;color:var(--oliva)">' + I.check + '</div>' +
      '<h2 style="font-size:24px;font-weight:800;margin-bottom:6px;color:var(--carvao)">Produção finalizada</h2>' +
      '<p style="color:var(--text-muted);margin-bottom:28px">Lote registrado com sucesso no sistema</p>' +
      '<div class="lot-result"><div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--musgo);font-weight:700;margin-bottom:4px">Número do Lote</div>' +
      '<div class="lot-number">' + esc(numLote) + '</div>' +
      '<div class="lot-dates"><div><strong>Fabricação:</strong> ' + fmtD(fab) + '</div><div><strong>Validade:</strong> ' + fmtD(valS) + '</div></div>' +
      '<div style="margin-top:12px;font-size:14px;color:var(--oliva)"><strong>' + esc(f.name) + '</strong> \u2014 ' + S.prodQty + 'g \u2014 ' + unitsProduced + ' unidade' + (unitsProduced !== 1 ? 's' : '') + '</div></div>' +
      '<div style="margin-top:28px;display:flex;gap:12px;justify-content:center"><button class="btn btn-secondary" onclick="S.prodFId=null;rProd()">Nova produção</button><button class="btn btn-secondary" onclick="S.stockTab=\'pa\';go(\'stockmp\')">Ver em Produto Acabado</button><button class="btn btn-primary" onclick="go(\'dashboard\')">Ir para Dashboard</button></div></div>';
    toast('Lote ' + numLote + ' registrado');
    if (!(unitsProduced > 0)) setTimeout(function () { toast('Atenção: a fórmula está sem o tamanho por unidade, então o lote entrou em Produto Acabado com 0 unidades. Preencha na fórmula e ajuste a quantidade em Estoque.'); }, 1400);
    if (faltaMP.length) setTimeout(function () { toast('Matéria-prima insuficiente em estoque: ' + faltaMP.join(', ')); }, 600);
  }

  /* ---------------- A4: estoque baixo somando as compras ---------------- */
  function consumoPorMP(formulas) {
    var m = {};
    (formulas || []).forEach(function (f) {
      (f.ingredients || []).forEach(function (ing) {
        var n = norm(ing.name);
        if (n) m[n] = (m[n] || 0) + (parseFloat(ing.qtyLot) || 0);
      });
    });
    return m;
  }
  function estoqueCriticoAgregado(stock, formulas) {
    var porNome = {};
    (stock || []).forEach(function (s) {
      var n = norm(s.name); if (!n) return;
      var o = porNome[n] || (porNome[n] = { nome: s.name, unidade: '', qtd: 0 });
      if (!o.unidade && s.unit) o.unidade = s.unit;
    });
    (stock || []).forEach(function (s) {
      var n = norm(s.name); if (!n) return;
      var o = porNome[n];
      o.qtd += (parseFloat(s.quantity) || 0) * (fatorEntre(s.unit, o.unidade) || 1);
    });
    var consumo = {};
    (formulas || []).forEach(function (f) {
      (f.ingredients || []).forEach(function (ing) {
        var n = norm(ing.name), o = porNome[n];
        if (!n || !o) return;
        consumo[n] = (consumo[n] || 0) + (parseFloat(ing.qtyLot) || 0) * (fatorEntre(ing.unit, o.unidade) || 1);
      });
    });
    var out = [];
    Object.keys(porNome).forEach(function (n) {
      var c = consumo[n] || 0, o = porNome[n];
      if (c > 0 && o.qtd <= c * 0.3) out.push({ chave: n, nome: o.nome, unidade: o.unidade, qtd: o.qtd, consumo: c, pct: Math.round(o.qtd / c * 100) });
    });
    return out;
  }
  function tarefaReposicao(c, hist) {
    var mp = (hist || []).filter(function (h) { return norm(h.mpName) === c.chave; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0];
    return {
      priority: 3, type: 'hoje', cat: 'Estoque', catColor: 'green',
      text: 'Repor ' + c.nome + ' \u2014 ' + fmtNum(c.qtd) + ' ' + c.unidade + ' restante (' + c.pct + '%)',
      sub: mp ? 'Último preço: ' + fmtR(mp.price) + '/' + (mp.unit || 'un') + ' em ' + fmtD(mp.date) : 'Sem histórico de compra',
      action: "go('stockmp')", btnLabel: 'Ver Estoque', id: 'stock_' + slug(c.chave)
    };
  }
  function recompraValida(pid, pedidos) {
    var p = achar(pedidos, pid);
    if (!p) return true;
    return !pedidos.some(function (o) {
      return o.id !== p.id && o.status !== 'cancelado' && norm(o.cliente) === norm(p.cliente) && String(o.data || '') > String(p.data || '');
    });
  }
  function corrigirCardCritico() {
    var alvo = null;
    [].slice.call(document.querySelectorAll('#content .card-header h3')).forEach(function (h) { if (/Estoque MP crítico/i.test(h.textContent)) alvo = h; });
    if (!alvo) return;
    var card = alvo.closest('.card');
    var agg = estoqueCriticoAgregado(DB.get('stockmp'), DB.get('formulas'));
    if (!agg.length) { card.parentNode.removeChild(card); return; }
    var cont = card.querySelector('.card-header span'); if (cont) cont.textContent = agg.length + ' ite' + (agg.length > 1 ? 'ns' : 'm');
    var corpo = card.querySelector('.card-body');
    if (corpo) corpo.innerHTML = agg.map(function (c) {
      return '<div class="activity-item"><div class="activity-dot" style="background:var(--rosa-antigo)"></div><div class="activity-text"><strong>' + esc(c.nome) + '</strong> \u2014 ' + fmtNum(c.qtd) + ' ' + esc(c.unidade) + ' <span style="color:var(--rosa-antigo);font-weight:600">(' + c.pct + '%)</span></div></div>';
    }).join('');
  }

  /* ---------------- A7: compra no Estoque grava histórico e oferece o A Pagar ---------------- */
  function entradaParaHistorico(e, suppliers) {
    var sup = null;
    (suppliers || []).forEach(function (s) { if (norm(s.name) === norm(e.supplier)) sup = s; });
    var preco = parseFloat(e.price), qtd = parseFloat(e.quantity);
    if (!sup || !(preco > 0) || !(qtd > 0)) return null;
    return { supplierId: sup.id, mpName: e.name, qty: qtd, unit: e.unit || '', price: preco, date: e.purchaseDate || localDateStr() };
  }
  function lancamentoDaCompra(e) {
    return {
      descricao: 'Compra ' + e.name, fornecedor: e.supplier || '', tipo: 'Matéria Prima', vencimento: e.purchaseDate || localDateStr(),
      valor: String(parseFloat(e.price) || 0), parcelado: 'nao', parcela: '', totalParcelas: '', recorrente: 'nao', recorrDias: '',
      obs: 'Compra registrada em Estoques', status: 'pendente'
    };
  }

  /* ---------------- M16: última parcela absorve os centavos ---------------- */
  function ajustarUltimaParcela(valores, total) {
    var v = valores.slice();
    var soma = 0;
    for (var i = 0; i < v.length - 1; i++) soma += parseFloat(v[i]) || 0;
    v[v.length - 1] = (Math.round((total - soma) * 100) / 100).toFixed(2);
    return v;
  }

  /* ---------------- M13: custos fixos ---------------- */
  var CHAVE_SEMEADOS = 'pg_custos_semeados';
  function deveSemearCustos(costs, jaSemeou) { return costs.length === 0 && !jaSemeou; }
  function renderPricingCustosNovo() {
    var costs = DB.get('fixed_costs');
    var flag = localStorage.getItem(CHAVE_SEMEADOS) === '1';
    if (deveSemearCustos(costs, flag)) {
      try { localStorage.setItem(CHAVE_SEMEADOS, '1'); } catch (e) { /* ignorar */ }
      DB.set('fixed_costs', [
        { id: uid(), name: 'Aluguel', value: 600, obs: '' }, { id: uid(), name: 'Luz', value: 60, obs: '' }, { id: uid(), name: 'Internet', value: 100, obs: '' },
        { id: uid(), name: 'Despesas de Social Mídia', value: 640, obs: '' }, { id: uid(), name: 'Sistema financeiro', value: 240, obs: '' },
        { id: uid(), name: 'Nuvemshop', value: 60, obs: 'nuvemshop' }, { id: uid(), name: 'Certificado digital', value: 235, obs: 'certificado digital' },
        { id: uid(), name: 'Contabilidade', value: 300, obs: 'contabilidade' }
      ]);
      return renderPricingCustosNovo();
    }
    if (costs.length > 0 && !flag) { try { localStorage.setItem(CHAVE_SEMEADOS, '1'); } catch (e2) { /* ignorar */ } }
    var total = costs.reduce(function (s, c) { return s + (parseFloat(c.value) || 0); }, 0);
    return '<div class="card"><div class="card-header"><h3>Custos Fixos Mensais</h3><button class="btn btn-primary btn-sm" onclick="openCostModal()">' + I.plus + ' Nova Despesa</button></div><div class="card-body"><div class="table-wrapper"><table><thead><tr><th>Despesa</th><th>Valor Mensal (R$)</th><th>Observações</th><th></th></tr></thead><tbody>' +
      costs.map(function (c) {
        return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + fmtR(c.value) + '</td><td style="font-size:12px;color:var(--text-muted)">' + esc(c.obs || '') + '</td><td style="text-align:right"><button class="btn-icon" onclick="openCostModal(\'' + esc(c.id) + '\')" style="display:inline-flex">' + I.edit + '</button><button class="btn-icon" onclick="delCost(\'' + esc(c.id) + '\')" style="display:inline-flex;margin-left:4px">' + I.trash + '</button></td></tr>';
      }).join('') + '<tr style="font-weight:700;background:var(--bg-warm)"><td>TOTAL</td><td>' + fmtR(total) + '</td><td></td><td></td></tr></tbody></table></div></div></div>';
  }

  /* ---------------- M14: histórico de preços do fornecedor ---------------- */
  function delMPPriceEntryNovo(id) {
    var hist = DB.get('mp_price_hist'), e = achar(hist, id);
    DB.set('mp_price_hist', hist.filter(function (h) { return h.id !== id; }));
    toast('Registro excluído');
    if (e && e.supplierId) openSupModal(e.supplierId);
  }

  /* ---------------- ligações com o sistema ---------------- */
  window.savePedido = savePedidoNovo;
  window.advancePedido = advancePedidoNovo;
  window.delPedido = delPedidoNovo;
  window.finishProd = finishProdNovo;
  window.cycleLeadStatus = cycleLeadStatusNovo;
  window.renderPricingCustos = renderPricingCustosNovo;
  window.delMPPriceEntry = delMPPriceEntryNovo;

  envolver('addPedItem', function (antes) { return function () { var r = antes.apply(this, arguments); try { ligarLinhasPedido(); } catch (e) { console.warn(e); } return r; }; });
  envolver('openPedidoModal', function (antes) {
    return function (id) {
      var r = antes.apply(this, arguments);
      try {
        ligarLinhasPedido();
        if (!id) { var n = document.getElementById('pedNum'); if (n) n.value = proximoNumeroPedido(DB.get('pedidos')); }
      } catch (e) { console.warn(e); }
      return r;
    };
  });
  envolver('openPedidoRecompra', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try { ligarLinhasPedido(); var n = document.getElementById('pedNum'); if (n) n.value = proximoNumeroPedido(DB.get('pedidos')); } catch (e) { console.warn(e); }
      return r;
    };
  });
  envolver('rPedidos', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try {
        var fat = DB.get('pedidos').filter(function (p) { return ehAtivo(p.status); }).reduce(function (s, p) { return s + (parseFloat(p.total) || 0); }, 0);
        [].slice.call(document.querySelectorAll('#content .card > div')).forEach(function (el) {
          if (el.textContent.trim() === 'Faturamento' && el.nextElementSibling) el.nextElementSibling.textContent = fmtR(fat);
        });
      } catch (e) { console.warn(e); }
      return r;
    };
  });
  envolver('getAlerts', function (antes) {
    return function () {
      var a = antes.apply(this, arguments);
      try {
        a = a.filter(function (x) { return String(x.key).indexOf('stock_') !== 0; });
        estoqueCriticoAgregado(DB.get('stockmp'), DB.get('formulas')).forEach(function (c) {
          a.push({ key: 'stock_' + slug(c.chave), type: 'rosa-antigo', text: 'Estoque baixo: <strong>' + esc(c.nome) + '</strong> \u2014 ' + fmtNum(c.qtd) + ' ' + esc(c.unidade) + ' (' + c.pct + '% do necessário por lote)' });
        });
      } catch (e) { console.warn(e); }
      return a;
    };
  });
  envolver('getModoDiaTasks', function (antes) {
    return function () {
      var tasks = antes.apply(this, arguments);
      try {
        var pedidos = DB.get('pedidos');
        tasks = tasks.filter(function (t) {
          var id = String(t.id);
          if (id.indexOf('stock_') === 0) return false;
          if (id.indexOf('recompra_') === 0) return recompraValida(id.slice(9), pedidos);
          return true;
        });
        var hist = DB.get('mp_price_hist');
        estoqueCriticoAgregado(DB.get('stockmp'), DB.get('formulas')).slice(0, 3).forEach(function (c) { tasks.push(tarefaReposicao(c, hist)); });
        tasks.sort(function (a, b) { return a.priority - b.priority; });
      } catch (e) { console.error('correcoes-numeros: tarefas', e); }
      return tasks;
    };
  });
  envolver('rDash', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try { corrigirCardCritico(); } catch (e) { console.warn(e); }
      return r;
    };
  });
  envolver('mdWeekBuildItems', function (antes) {
    return function () {
      var items = antes.apply(this, arguments);
      try {
        var hoje = localDateStr();
        DB.get('receber').filter(function (r) { return r.status !== 'recebido' && r.vencimento && r.vencimento >= hoje; }).forEach(function (r) {
          items.push({ date: r.vencimento, text: r.descricao, tipo: 'normal', cat: 'A Receber', val: fmtR(r.valor), id: r.id });
        });
      } catch (e) { console.warn(e); }
      return items;
    };
  });
  envolver('saveStock', function (antes) {
    return function (id) {
      var antesQtd = DB.get('stockmp').length;
      var r = antes.apply(this, arguments);
      try {
        var lista = DB.get('stockmp');
        if (!id && lista.length === antesQtd + 1) {
          var e = lista[lista.length - 1];
          var h = entradaParaHistorico(e, DB.get('suppliers'));
          if (h) { var hist = DB.get('mp_price_hist'); h.id = uid(); hist.push(h); DB.set('mp_price_hist', hist); }
          if (parseFloat(e.price) > 0 && window.confirm('Criar um lançamento no A Pagar para esta compra (' + fmtR(e.price) + ')?')) {
            var pagar = DB.get('pagar'), l = lancamentoDaCompra(e); l.id = uid(); pagar.push(l); DB.set('pagar', pagar);
            toast('Lançamento criado em A Pagar');
          }
        }
      } catch (err) { console.warn('correcoes-numeros: compra', err); }
      return r;
    };
  });
  envolver('savePagar', function (antes) {
    return function (id) {
      var info = null;
      try {
        if (!id) {
          var parc = document.getElementById('pgParc'), tot = document.getElementById('pgVal'), np = document.getElementById('pgParcT');
          if (parc && parc.value === 'sim' && tot && np) info = { total: parseFloat(tot.value) || 0, n: parseInt(np.value, 10) || 1, antes: DB.get('pagar').map(function (x) { return x.id; }) };
        }
      } catch (e) { info = null; }
      var r = antes.apply(this, arguments);
      try {
        if (info && info.n > 1) {
          var lista = DB.get('pagar');
          var novas = lista.filter(function (x) { return info.antes.indexOf(x.id) < 0 && x.parcelado === 'sim'; })
            .sort(function (a, b) { return (parseInt(a.parcela, 10) || 0) - (parseInt(b.parcela, 10) || 0); });
          if (novas.length === info.n) {
            var ajustados = ajustarUltimaParcela(novas.map(function (x) { return x.valor; }), info.total);
            novas[novas.length - 1].valor = ajustados[ajustados.length - 1];
            DB.set('pagar', lista);
            if (S.page === 'pagar') rPagar();
          }
        }
      } catch (e2) { console.warn('correcoes-numeros: parcelas', e2); }
      return r;
    };
  });
  envolver('rProdExec', function (antes) {
    return function () {
      var f = achar(DB.get('formulas'), S.prodFId);
      var original = DB.get;
      /* só enquanto a tela de produção desenha: o estoque aparece na mesma unidade do ingrediente (ex.: 0,8 kg vira 800 g) */
      DB.get = function (k) {
        var v = original.apply(DB, arguments);
        return (k === 'stockmp' && f) ? estoqueNasUnidadesDaFormula(v, f) : v;
      };
      try { return antes.apply(this, arguments); } finally { DB.get = original; }
    };
  });
  envolver('rProds', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try {
        var acoes = document.querySelector('#content .page-header-actions');
        if (acoes && !acoes.querySelector('[data-pastas]')) {
          var b = document.createElement('button');
          b.className = 'btn btn-secondary btn-sm'; b.setAttribute('data-pastas', '1');
          b.innerHTML = (I.folder || '') + ' Pastas';
          b.onclick = function () { openFolderModal(); };
          acoes.insertBefore(b, acoes.firstChild);
        }
      } catch (e) { console.warn(e); }
      return r;
    };
  });

  /* ---------------- A11: tabelas largas e menu no celular ---------------- */
  function instalarTelas() {
    if (document.getElementById('menuFab')) return;
    var css = [
      '.table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '#menuFab,#menuOverlay{display:none}',
      '@media (max-width:900px){',
      '.sidebar{display:flex !important;position:fixed;top:0;bottom:0;left:0;width:260px;transform:translateX(-105%);transition:transform .25s;z-index:98}',
      'body.menu-aberto .sidebar{transform:translateX(0)}',
      '#menuFab{display:flex;position:fixed;top:10px;left:10px;z-index:95;width:40px;height:40px;border-radius:50%;border:1.5px solid var(--border);background:var(--surface);align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--shadow-sm);color:var(--text-secondary)}',
      '#menuFab svg{width:18px;height:18px}',
      '#menuOverlay{display:block;position:fixed;inset:0;background:rgba(37,40,41,.4);z-index:96;opacity:0;pointer-events:none;transition:opacity .2s}',
      'body.menu-aberto #menuOverlay{opacity:1;pointer-events:auto}',
      '.top-bar{padding-left:60px !important}',
      '}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'num-css'; st.textContent = css; document.head.appendChild(st);
    var fab = document.createElement('button');
    fab.id = 'menuFab'; fab.setAttribute('aria-label', 'Abrir o menu');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
    fab.onclick = function () { document.body.classList.toggle('menu-aberto'); };
    var ov = document.createElement('div');
    ov.id = 'menuOverlay';
    ov.onclick = function () { document.body.classList.remove('menu-aberto'); };
    document.body.appendChild(fab); document.body.appendChild(ov);
    var nav = document.getElementById('sidebarNav');
    if (nav) nav.addEventListener('click', function () { document.body.classList.remove('menu-aberto'); });
  }
  instalarTelas();

  /* ---------------- autoteste (console: CorrecoesNumerosTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    var f1 = { id: 'f', name: 'TESTE', lotSize: '1000', unitSize: '100', packagingCost: '1', otherCosts: '0', ingredients: [{ name: 'MP', totalCost: '10' }], finalPrice: '72.67' };
    var f2 = Object.assign({}, f1, { finalPrice: '' });
    ok('o pedido usa o Preço Final da fórmula', precoDoProduto(f1) === 72.67);
    ok('sem Preço Final, usa o preço sugerido', precoDoProduto(f2) === calcFormula(f2).priceSuggested && precoDoProduto(f2) > 0);
    ok('a numeração de pedidos não repete depois de excluir', proximoNumeroPedido([{ numero: '0001' }, { numero: '0003' }]) === '0004' && proximoNumeroPedido([]) === '0001' && proximoNumeroPedido([{ numero: 'abc' }, { numero: '0007' }]) === '0008');

    function paBase() {
      return [
        { id: 'l1', name: 'A', quantity: 5, validade: '2027-01-01', fabricacao: '2026-11-01', status: 'disponivel' },
        { id: 'l2', name: 'A', quantity: 10, validade: '2026-12-01', fabricacao: '2026-10-01', status: 'disponivel' },
        { id: 'l3', name: 'B', quantity: 2, validade: '2027-01-01', fabricacao: '2026-11-01', status: 'disponivel' }
      ];
    }
    var pa = paBase(); var ped = { itens: [{ name: 'A', qty: 12 }, { name: 'B', qty: 5 }] };
    var res = baixarEstoquePA(pa, ped);
    ok('a baixa sai primeiro do lote que vence antes', pa[1].quantity === 0 && pa[0].quantity === 3 && pa[1].status === 'vendido' && res.baixas[0].id === 'l2' && res.baixas[0].qty === 10 && res.baixas[1].id === 'l1' && res.baixas[1].qty === 2);
    ok('estoque insuficiente é apontado, sem quantidade negativa', res.faltas.length === 1 && res.faltas[0].name === 'B' && res.faltas[0].qty === 3 && pa[2].quantity === 0);
    ok('simular a falta não mexe no estoque', faltasEstoque(paBase(), ped).length === 1 && paBase()[0].quantity === 5);
    ped.baixas = res.baixas;
    devolverEstoquePA(pa, ped);
    ok('devolver usa os lotes registrados na baixa e reativa o que estava vendido', pa[0].quantity === 5 && pa[1].quantity === 10 && pa[2].quantity === 2 && pa[1].status === 'disponivel' && pa[2].status === 'disponivel');
    var pa2 = paBase();
    ok('pedido antigo, sem registro dos lotes, devolve ao lote mais novo', devolverEstoquePA(pa2, { itens: [{ name: 'A', qty: 4 }] }) === 4 && pa2[0].quantity === 9);
    ok('pedido antigo despachado conta como já baixado; novo não', jaBaixado({ status: 'despachado' }) === true && jaBaixado({ status: 'novo' }) === false && jaBaixado({ status: 'novo', estoqueBaixado: true }) === true && jaBaixado({ status: 'despachado', estoqueBaixado: false }) === false);

    var p1 = { id: 'p1', itens: [{ name: 'A', qty: 3 }], status: 'novo' }; var pa3 = paBase();
    var m1 = aplicarStatusPedidoPA(p1, 'despachado', pa3);
    ok('despachar baixa o estoque e registra os lotes', m1.length === 0 && p1.estoqueBaixado === true && p1.baixas.length === 1 && pa3[1].quantity === 7 && p1.status === 'despachado');
    aplicarStatusPedidoPA(p1, 'entregue', pa3);
    ok('de despachado para entregue não baixa de novo', pa3[1].quantity === 7 && p1.status === 'entregue');
    var m2 = aplicarStatusPedidoPA(p1, 'cancelado', pa3);
    ok('cancelar devolve o estoque', pa3[1].quantity === 10 && p1.estoqueBaixado === false && p1.baixas.length === 0 && m2[0].indexOf('3 un devolvida') === 0);
    var p2 = { id: 'p2', itens: [{ name: 'A', qty: 2 }], status: 'novo' }; var pa4 = paBase();
    aplicarStatusPedidoPA(p2, 'entregue', pa4);
    ok('marcar direto como entregue também baixa o estoque', pa4[1].quantity === 8 && p2.estoqueBaixado === true);

    var base = { id: 'p1', numero: '0001', cliente: 'Ana', total: 100, data: '2026-11-12', pagamento: 'PIX', status: 'despachado' };
    var pr = planoReceber(base, null);
    ok('pedido pago à vista entra no A Receber já como recebido', pr.acao === 'criar' && pr.linha.status === 'recebido' && pr.linha.pedidoId === 'p1' && pr.linha.descricao === 'Pedido #0001 \u2014 Ana' && pr.linha.cliente === 'Ana');
    ok('boleto e link ficam pendentes', planoReceber(Object.assign({}, base, { pagamento: 'Boleto' }), null).linha.status === 'pendente' && planoReceber(Object.assign({}, base, { pagamento: 'Link' }), null).linha.status === 'pendente');
    ok('valor do pedido atualiza o recebimento pendente, mas não mexe no recebido', planoReceber(Object.assign({}, base, { total: 150 }), { status: 'pendente' }).linha.valor === 150 && planoReceber(base, { status: 'recebido' }).acao === 'nada');
    ok('cancelar tira o recebimento pendente e avisa se já estava recebido', planoReceber(Object.assign({}, base, { status: 'cancelado' }), { status: 'pendente' }).acao === 'remover' && !!planoReceber(Object.assign({}, base, { status: 'cancelado' }), { status: 'recebido' }).aviso && planoReceber(Object.assign({}, base, { status: 'novo' }), null).acao === 'nada');

    var formulas = [{ ingredients: [{ name: 'Karité', qtyLot: '1000' }] }];
    ok('estoque baixo soma as compras da mesma matéria-prima', estoqueCriticoAgregado([{ name: 'Karité', quantity: '0', unit: 'g' }, { name: 'karité', quantity: '5000', unit: 'g' }], formulas).length === 0);
    var cr = estoqueCriticoAgregado([{ name: 'Karité', quantity: '100', unit: 'g' }, { name: 'karité', quantity: '150', unit: 'g' }], formulas);
    ok('abaixo de 30% do lote, no total, vira crítico', cr.length === 1 && cr[0].qtd === 250 && cr[0].pct === 25 && cr[0].unidade === 'g');
    var tr = tarefaReposicao(cr[0], [{ mpName: 'karité', price: 40, unit: 'kg', date: '2026-10-01' }]);
    ok('a tarefa de reposição segue o padrão do Modo Dia', tr.id === 'stock_karit-' && tr.text.indexOf('Repor Karité') === 0 && tr.sub.indexOf('Último preço') === 0 && tr.action === "go('stockmp')");

    var st = [{ name: 'MP', quantity: '200', purchaseDate: '2026-02-01' }, { name: 'MP', quantity: '100', purchaseDate: '2026-01-01' }];
    var falta0 = baixarMPFifo(st, 'mp', 250);
    ok('a produção desconta da compra mais antiga e segue para a próxima', falta0 === 0 && st[1].quantity === '0.00' && st[0].quantity === '50.00');
    ok('matéria-prima insuficiente devolve o quanto faltou', baixarMPFifo(st, 'mp', 80) === 30 && st[0].quantity === '0.00');

    var peds = [{ id: 'p1', cliente: 'Ana', data: '2026-09-01', status: 'entregue' }, { id: 'p2', cliente: 'ana', data: '2026-10-20', status: 'novo' }, { id: 'p3', cliente: 'Bia', data: '2026-09-01', status: 'entregue' }];
    ok('recompra ignora quem já fez pedido mais novo', recompraValida('p1', peds) === false && recompraValida('p2', peds) === true && recompraValida('p3', peds) === true);
    ok('a última parcela absorve a diferença de centavos', ajustarUltimaParcela(['33.33', '33.33', '33.33'], 100).join() === '33.33,33.33,33.34' && ajustarUltimaParcela(['50.00', '50.00'], 100).join() === '50.00,50.00');

    var lead = { id: 24, telefone: '(14) 99811-2006', linha_resultado: 'Bora Breeze' };
    var paL = [{ name: 'Body Mist', line: 'Bora Breeze, Moon Milk', status: 'disponivel', quantity: 3 }, { name: 'Outro', line: 'Moon Milk', status: 'disponivel', quantity: 2 }];
    var rasc = montarRascunho(lead, [{ numero: '0002' }], paL, function (n) { return n === 'Body Mist' ? 49.9 : 0; });
    ok('o rascunho do lead pega só os produtos da linha (mesmo com várias linhas) e usa o preço informado', !!rasc && rasc.itens.length === 1 && rasc.itens[0].name === 'Body Mist' && rasc.itens[0].price === 49.9 && rasc.numero === '0003' && rasc.leadId === 24 && rasc.total === 49.9);
    ok('o lead não gera um segundo rascunho', montarRascunho(lead, [{ leadId: 24 }], paL, function () { return 1; }) === null && montarRascunho(lead, [], [], function () { return 1; }) === null);
    var eh = entradaParaHistorico({ name: 'Karité', supplier: 'Aromaville', quantity: '1000', unit: 'g', price: '50', purchaseDate: '2026-11-10' }, [{ id: 's1', name: 'aromaville' }]);
    ok('a compra no Estoque vira histórico de preço do fornecedor, só se o fornecedor existe', !!eh && eh.supplierId === 's1' && eh.price === 50 && eh.qty === 1000 && eh.date === '2026-11-10' && entradaParaHistorico({ name: 'X', supplier: 'Outro', quantity: '1', price: '1' }, [{ id: 's1', name: 'Aromaville' }]) === null);
    var ld = lancamentoDaCompra({ name: 'Karité', supplier: 'Aromaville', price: '50', purchaseDate: '2026-11-10' });
    ok('o lançamento da compra no A Pagar segue o padrão do sistema', ld.descricao === 'Compra Karité' && ld.tipo === 'Matéria Prima' && ld.valor === '50' && ld.vencimento === '2026-11-10' && ld.status === 'pendente' && ld.parcelado === 'nao');
    ok('os custos de exemplo só voltam na primeira vez', deveSemearCustos([], false) === true && deveSemearCustos([], true) === false && deveSemearCustos([{ id: 1 }], false) === false);
    ok('o número do lote não repete', proximoNumeroLote([{ lotNumber: 'LOT-20261101-001' }, { lotNumber: 'LOT-20261105-004' }], '2026-11-13') === 'LOT-20261113-005' && proximoNumeroLote([], '2026-11-13') === 'LOT-20261113-001');
    ok('a conversão entre unidades considera kg, g, l e ml', fatorEntre('g', 'kg') === 0.001 && fatorEntre('kg', 'g') === 1000 && fatorEntre('ml', 'l') === 0.001 && fatorEntre('g', 'ml') === null && fatorEntre('g', '') === null);
    var stKg = [{ name: 'MP', quantity: '1', unit: 'kg', purchaseDate: '2026-01-01' }];
    var fKg = baixarMPFifo(stKg, 'mp', 250, 'g');
    ok('a produção desconta em g de uma compra guardada em kg', Math.abs(fKg) < 1e-6 && stKg[0].quantity === '0.7500' && Math.abs(baixarMPFifo(stKg, 'mp', 1000, 'g') - 250) < 1e-6 && parseFloat(stKg[0].quantity) === 0);
    var fKgCrit = [{ ingredients: [{ name: 'manteiga', qtyLot: '1000', unit: 'g' }] }];
    var crKg = estoqueCriticoAgregado([{ name: 'Manteiga', quantity: '0.2', unit: 'kg' }], fKgCrit);
    ok('o estoque baixo compara kg com g corretamente', crKg.length === 1 && crKg[0].unidade === 'kg' && crKg[0].qtd === 0.2 && crKg[0].pct === 20 && estoqueCriticoAgregado([{ name: 'Manteiga', quantity: '2', unit: 'kg' }], fKgCrit).length === 0);
    ok('a validade é de 1 ano depois da fabricação', validadeUmAno('2026-11-17') === '2027-11-17' && validadeUmAno('2028-02-29') === '2029-02-28' && validadeUmAno('2026-01-31') === '2027-01-31');
    var stProd = estoqueNasUnidadesDaFormula([{ name: 'MP', quantity: '0.8', unit: 'kg' }, { name: 'Outra', quantity: '5', unit: 'kg' }, { name: 'Igual', quantity: '7', unit: 'g' }], { ingredients: [{ name: 'mp', unit: 'g' }, { name: 'igual', unit: 'g' }] });
    ok('a tela de produção mostra o estoque na unidade do ingrediente', stProd[0].quantity === '800' && stProd[0].unit === 'g' && stProd[1].unit === 'kg' && stProd[1].quantity === '5' && stProd[2].quantity === '7');
    ok('SISTEMA: pedidos e produção corrigidos instalados', window.savePedido === savePedidoNovo && window.advancePedido === advancePedidoNovo && window.delPedido === delPedidoNovo && window.finishProd === finishProdNovo && window.getModoDiaTasks._num === true);
    ok('SISTEMA: botão de menu do celular e rolagem das tabelas', !!document.getElementById('menuFab') && !!document.getElementById('num-css'));
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'CORRECOES-NUMEROS: ' + r.length + ' testes, 0 falhas' : 'CORRECOES-NUMEROS: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }
  window.CorrecoesNumerosTeste = teste;
})();
