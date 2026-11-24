/* ============================================================
   MUNDANA · FATURAMENTO (Financeiro)
   Carregado pelo correcoes-receitas.js (não precisa mexer no index.html).
   Autoteste: no console (F12) digite  FaturamentoTeste()

   Importar planilha: dois relatórios do Upseller (.xlsx ou .csv).
   (1) Exportação de pedidos: traz a plataforma de cada pedido, então o sistema separa sozinho
   por plataforma e dia (Nuvemshop vira Site). Vale pedido pago e não cancelado, o mesmo critério
   do relatório de performance. Só os totais por dia e plataforma são guardados.
   (2) Performance das Vendas (uma linha por dia, sem plataforma): na hora de subir o arquivo o
   sistema pergunta de qual plataforma ele é (Site, Shopee, TikTok Shop, Geral ou outra). O mesmo dia e plataforma nunca duplica: importar de
   novo o mesmo período substitui os dias. Antes de gravar mostra o período, os totais e o que
   já existe, e avisa se os mesmos valores já estão lançados em outra plataforma.
   Lançar manualmente: um dia e uma plataforma por vez.
   Painel (por mês): (1) total faturado, (2) faturado por canal e (3) lucro ou prejuízo = faturado
   menos as despesas do A Pagar (lançamentos com vencimento no mês, pagos ou não).
   Só vendas válidas contam como faturamento (valor bruto, antes de comissões e taxas).
   "Geral" é o arquivo com todas as plataformas juntas: nos dias em que existem plataformas
   separadas, o Geral é ignorado nos totais para não contar em dobro.
   Os dados ficam na chave "faturamento" (entram no backup completo).
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof S === 'undefined' || typeof localDateStr !== 'function' || typeof openModal !== 'function') {
    console.error('faturamento.js: carregue este arquivo depois do script principal.');
    return;
  }
  if (window.__faturamento) { return; }
  window.__faturamento = true;

  var CHAVE_DB = 'faturamento';
  var GERAL = 'Geral';
  var CANAIS_PADRAO = ['Site', 'Shopee', 'TikTok Shop'];
  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var CORES = ['var(--rosa-antigo)', 'var(--oliva)', 'var(--carvao)', 'var(--lavanda)', 'var(--areia)', 'var(--musgo)'];

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  function chave(s) { return norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? e.value : ''; }
  function envolver(nome, fabrica) {
    var antes = window[nome];
    if (typeof antes !== 'function') return;
    var novo = fabrica(antes);
    Object.keys(antes).forEach(function (k) { if (k.charAt(0) === '_') novo[k] = antes[k]; });
    novo._fat = true;
    window[nome] = novo;
  }
  function arred2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
  function fmtInt(n) { return (Math.round(n) || 0).toLocaleString('pt-BR'); }
  function fmtPctN(x) { return (x * 100).toFixed(1).replace('.', ',') + '%'; }

  /* ---------------- leitura de .xlsx sem biblioteca ---------------- */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }
  function listarZip(b) {
    var fim = -1, i;
    for (i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) { if (u32(b, i) === 0x06054b50) { fim = i; break; } }
    if (fim < 0) throw new Error('Este arquivo não parece ser uma planilha .xlsx.');
    var n = u16(b, fim + 10), off = u32(b, fim + 16), ents = {};
    for (var k = 0; k < n; k++) {
      if (u32(b, off) !== 0x02014b50) break;
      var metodo = u16(b, off + 10), csize = u32(b, off + 20), nl = u16(b, off + 28), xl = u16(b, off + 30), cl = u16(b, off + 32), loc = u32(b, off + 42);
      ents[utf8(b.subarray(off + 46, off + 46 + nl))] = { metodo: metodo, csize: csize, loc: loc };
      off += 46 + nl + xl + cl;
    }
    return ents;
  }
  async function extrair(b, ent) {
    var nl = u16(b, ent.loc + 26), xl = u16(b, ent.loc + 28), ini = ent.loc + 30 + nl + xl;
    var dados = b.subarray(ini, ini + ent.csize);
    if (ent.metodo === 0) return dados;
    if (ent.metodo !== 8) throw new Error('Este .xlsx usa uma compactação que não consigo abrir. Salve a planilha como CSV.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx. Salve a planilha como CSV ou use o Chrome.');
    var fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }
  function lerXml(bytes) { return new DOMParser().parseFromString(utf8(bytes), 'application/xml'); }
  function indiceColuna(ref) {
    var m = /^([A-Z]+)/.exec(ref || ''), s = m ? m[1] : 'A', n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  async function lerXlsx(buffer) {
    var b = new Uint8Array(buffer), ents = listarZip(b);
    async function ler(nome) { return ents[nome] ? lerXml(await extrair(b, ents[nome])) : null; }
    var wb = await ler('xl/workbook.xml'), rels = await ler('xl/_rels/workbook.xml.rels'), alvo = 'xl/worksheets/sheet1.xml';
    if (wb && rels) {
      var sheet = wb.getElementsByTagName('sheet')[0];
      var rid = sheet && (sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      var rel = [].slice.call(rels.getElementsByTagName('Relationship')).filter(function (r) { return r.getAttribute('Id') === rid; })[0];
      if (rel) { var t = rel.getAttribute('Target'); alvo = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t; }
    }
    var ss = await ler('xl/sharedStrings.xml'), compart = [];
    if (ss) [].slice.call(ss.getElementsByTagName('si')).forEach(function (si) { compart.push([].slice.call(si.getElementsByTagName('t')).map(function (x) { return x.textContent; }).join('')); });
    var folha = await ler(alvo);
    if (!folha) throw new Error('Não encontrei a planilha dentro do arquivo.');
    var linhas = [];
    [].slice.call(folha.getElementsByTagName('row')).forEach(function (row) {
      var arr = [];
      [].slice.call(row.getElementsByTagName('c')).forEach(function (c) {
        var idx = indiceColuna(c.getAttribute('r')), t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], valor = null;
        if (t === 'inlineStr') valor = [].slice.call(c.getElementsByTagName('t')).map(function (x) { return x.textContent; }).join('');
        else if (v) {
          var tx = v.textContent;
          valor = t === 's' ? (compart[parseInt(tx, 10)] || '') : (t === 'str' || t === 'e' ? tx : (t === 'b' ? tx === '1' : parseFloat(tx)));
        }
        arr[idx] = valor;
      });
      linhas.push(arr);
    });
    return linhas;
  }
  function lerCSV(texto) {
    texto = String(texto).replace(/^\uFEFF/, '');
    var primeira = texto.split(/\r?\n/)[0] || '';
    var sep = ',';
    if (primeira.split(';').length > primeira.split(',').length) sep = ';';
    else if (primeira.split('\t').length > primeira.split(',').length) sep = '\t';
    var linhas = [], atual = [], campo = '', aspas = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto.charAt(i);
      if (aspas) {
        if (ch === '"') { if (texto.charAt(i + 1) === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === sep) { atual.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto.charAt(i + 1) === '\n') i++; atual.push(campo); linhas.push(atual); atual = []; campo = ''; }
      else campo += ch;
    }
    if (campo !== '' || atual.length) { atual.push(campo); linhas.push(atual); }
    return linhas.filter(function (l) { return l.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* ---------------- interpretação do relatório "Performance das Vendas" ---------------- */
  function numero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/R\$|\s/g, '');
    if (!s) return 0;
    if (s.indexOf(',') > -1 && s.indexOf('.') > -1) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    } else if (s.indexOf(',') > -1) s = s.replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function dataISO(v) {
    if (typeof v === 'number') {
      if (v < 20000 || v > 90000) return '';
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }
    var s = String(v == null ? '' : v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10), dia = a, mes = b;
      if (y < 100) y += 2000;
      if (b > 12 && a <= 12) { dia = b; mes = a; }
      if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
      return y + '-' + pad2(mes) + '-' + pad2(dia);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) return dataISO(parseFloat(s));
    return '';
  }
  var COLS = {
    data: ['data', 'date', 'dia'],
    validos: ['pedidos validos', 'pedidos validos '],
    valor: ['valor de vendas validas', 'valor vendas validas'],
    cancelados: ['pedidos cancelados'],
    valorCancelados: ['valor de vendas canceladas', 'valor vendas canceladas'],
    valorTotal: ['valor total de vendas'],
    totalPedidos: ['total de pedidos']
  };
  function lerPerformance(linhas, nomeArquivo) {
    var res = { tipo: 'performance', registros: [], avisos: [], periodo: ['', ''], nome: nomeArquivo || '', erro: '' };
    var h = -1, mapa = {};
    for (var i = 0; i < Math.min(linhas.length, 15) && h < 0; i++) {
      var tmp = {};
      (linhas[i] || []).forEach(function (cel, c) {
        var k = chave(cel);
        Object.keys(COLS).forEach(function (campo) { if (COLS[campo].indexOf(k) > -1 && tmp[campo] === undefined) tmp[campo] = c; });
      });
      if (tmp.data !== undefined && tmp.valor !== undefined && tmp.validos !== undefined) { h = i; mapa = tmp; }
    }
    if (h < 0) {
      res.erro = 'Não reconheci as colunas. O arquivo precisa ser o relatório "Performance das Vendas" do Upseller, com as colunas Data, Pedidos Válidos e Valor de Vendas Válidas.';
      return res;
    }
    var porData = {}, divergentes = 0, ignoradas = 0;
    for (var r = h + 1; r < linhas.length; r++) {
      var l = linhas[r] || [], d = dataISO(l[mapa.data]);
      if (!d) { if (l.some(function (c) { return c !== null && c !== undefined && String(c).trim() !== ''; })) ignoradas++; continue; }
      var reg = {
        data: d, pedidos: Math.round(numero(l[mapa.validos])), valor: arred2(numero(l[mapa.valor])),
        cancelados: mapa.cancelados !== undefined ? Math.round(numero(l[mapa.cancelados])) : 0,
        valorCancelados: mapa.valorCancelados !== undefined ? arred2(numero(l[mapa.valorCancelados])) : 0
      };
      if (mapa.valorTotal !== undefined && Math.abs(numero(l[mapa.valorTotal]) - reg.valor - reg.valorCancelados) > 0.02) divergentes++;
      if (reg.valor < 0 || reg.pedidos < 0) { res.avisos.push('Há valores negativos em ' + d.split('-').reverse().join('/') + '.'); }
      if (porData[d]) res.avisos.push('A data ' + d.split('-').reverse().join('/') + ' aparece mais de uma vez no arquivo; vale a última linha.');
      porData[d] = reg;
    }
    res.registros = Object.keys(porData).sort().map(function (k) { return porData[k]; });
    if (!res.registros.length) { res.erro = 'Não encontrei nenhuma linha com data válida.'; return res; }
    res.periodo = [res.registros[0].data, res.registros[res.registros.length - 1].data];
    if (divergentes) res.avisos.push(divergentes + ' dia(s) em que o valor total não bate com vendas válidas + canceladas. Confira o arquivo.');
    if (ignoradas) res.avisos.push(ignoradas + ' linha(s) sem data válida foram ignoradas (totais, por exemplo).');
    return res;
  }
  /* ---------------- exportação de pedidos do Upseller (traz a plataforma de cada pedido) ---------------- */
  function detectarTipo(linhas) {
    for (var i = 0; i < Math.min(linhas.length, 15); i++) {
      var ks = (linhas[i] || []).map(chave);
      if (ks.indexOf('plataformas') > -1 && ks.indexOf('hora do pedido') > -1 && ks.indexOf('valor do pedido') > -1) return 'pedidos';
    }
    return 'performance';
  }
  var NOMES_CANAL = { nuvemshop: 'Site' };
  /* pedido válido = pago e não cancelado (é o critério do relatório "Performance das Vendas": bate com ele ao centavo).
     Pedido sem pagamento (cancelado antes de pagar ou aguardando) não conta. Pago e depois cancelado vai para "cancelados". */
  function lerPedidos(linhas, nomeArquivo, hoje) {
    var res = { tipo: 'pedidos', registros: [], avisos: [], periodo: ['', ''], nome: nomeArquivo || '', erro: '', semPagamento: 0, aguardando: 0, cancSemPag: 0, renomeados: [], parcial: null, emAndamento: false };
    var h = -1, mp = {}, i;
    for (i = 0; i < Math.min(linhas.length, 15) && h < 0; i++) {
      var tmp = {};
      (linhas[i] || []).forEach(function (cel, c) {
        var k = chave(cel);
        if (k === 'plataformas' || k === 'plataforma') tmp.plat = c;
        else if (k === 'hora do pedido') tmp.hora = c;
        else if (k === 'valor do pedido') tmp.valor = c;
        else if (k === 'hora do pagamento') tmp.pag = c;
        else if (k === 'pos-venda/cancelado/devolvido') tmp.pos = c;
        else if (k === 'valor total de produtos') tmp.prod = c;
        else if (k === 'descontos e cupons') tmp.desc = c;
      });
      if (tmp.plat !== undefined && tmp.hora !== undefined && tmp.valor !== undefined) { h = i; mp = tmp; }
    }
    if (h < 0) { res.erro = 'Não reconheci as colunas da exportação de pedidos.'; return res; }
    if (mp.pag === undefined) { res.erro = 'A exportação precisa ter a coluna "Hora do Pagamento" (é por ela que o sistema separa o que foi pago).'; return res; }
    var por = {}, primeira = {}, devolvidos = 0, semData = 0, dMin = '', dMax = '';
    for (var r = h + 1; r < linhas.length; r++) {
      var l = linhas[r] || [], plat = String(l[mp.plat] == null ? '' : l[mp.plat]).trim(), d = dataISO(l[mp.hora]);
      if (!plat || !d) { if (l.some(function (c) { return c !== null && c !== undefined && String(c).trim() !== ''; })) semData++; continue; }
      var hm = /(\d{1,2}):(\d{2})/.exec(String(l[mp.hora])), hhmm = hm ? pad2(parseInt(hm[1], 10)) + ':' + hm[2] : '';
      if (hhmm && (!primeira[d] || hhmm < primeira[d])) primeira[d] = hhmm;
      if (!dMin || d < dMin) dMin = d;
      if (!dMax || d > dMax) dMax = d;
      var pago = l[mp.pag] !== null && l[mp.pag] !== undefined && String(l[mp.pag]).trim() !== '';
      var pos = mp.pos !== undefined ? chave(l[mp.pos]) : '', cancel = pos.indexOf('cancel') > -1, valor = numero(l[mp.valor]);
      if (pos.indexOf('devolv') > -1) devolvidos++;
      if (!pago) { res.semPagamento++; if (cancel) res.cancSemPag++; else res.aguardando++; continue; }
      var renomeado = NOMES_CANAL[chave(plat)], canal = renomeado || plat;
      if (renomeado && res.renomeados.indexOf(plat) < 0) res.renomeados.push(plat);
      var k2 = d + '|' + chave(canal), o = por[k2] || (por[k2] = { data: d, canal: canal, pedidos: 0, valor: 0, cancelados: 0, valorCancelados: 0, produtos: 0, descontos: 0 });
      if (cancel) { o.cancelados++; o.valorCancelados += valor; }
      else {
        o.pedidos++; o.valor += valor;
        if (mp.prod !== undefined) o.produtos += numero(l[mp.prod]);
        if (mp.desc !== undefined) o.descontos += Math.abs(numero(l[mp.desc]));
      }
    }
    res.registros = Object.keys(por).map(function (k) {
      var o = por[k];
      o.valor = arred2(o.valor); o.valorCancelados = arred2(o.valorCancelados); o.produtos = arred2(o.produtos); o.descontos = arred2(o.descontos);
      return o;
    }).sort(function (a, b) { return a.data.localeCompare(b.data) || a.canal.localeCompare(b.canal, 'pt-BR'); });
    if (!res.registros.length) { res.erro = 'Não encontrei nenhum pedido pago nesse arquivo.'; return res; }
    res.periodo = [dMin, dMax];
    if (primeira[dMin] && primeira[dMin] > '12:00') res.parcial = { data: dMin, hora: primeira[dMin] };
    res.emAndamento = dMax === (hoje || localDateStr());
    if (devolvidos) res.avisos.push(devolvidos + ' pedido(s) marcado(s) como devolvido(s) foram contados como venda. Confira no Upseller.');
    if (semData) res.avisos.push(semData + ' linha(s) sem plataforma ou data foram ignoradas.');
    return res;
  }
  async function interpretarArquivo(buffer, nome) {
    var ext = (/\.([a-z0-9]+)$/i.exec(nome || '') || [, ''])[1].toLowerCase();
    try {
      var linhas;
      if (ext === 'xlsx') linhas = await lerXlsx(buffer);
      else if (ext === 'csv' || ext === 'txt') linhas = lerCSV(new TextDecoder('utf-8').decode(new Uint8Array(buffer)));
      else if (ext === 'xls') return { registros: [], avisos: [], periodo: ['', ''], nome: nome, erro: 'Arquivos .xls (Excel antigo) não são lidos. Salve como .xlsx ou .csv e tente de novo.' };
      else return { registros: [], avisos: [], periodo: ['', ''], nome: nome, erro: 'Envie um arquivo .xlsx ou .csv.' };
      return detectarTipo(linhas) === 'pedidos' ? lerPedidos(linhas, nome) : lerPerformance(linhas, nome);
    } catch (e) {
      return { registros: [], avisos: [], periodo: ['', ''], nome: nome, erro: e && e.message ? e.message : 'Não consegui ler o arquivo.' };
    }
  }

  /* ---------------- dados ---------------- */
  function lista() { return DB.get(CHAVE_DB); }
  function chaveReg(r) { return r.data + '|' + chave(r.canal); }
  /* grava (ou substitui) um dia de uma plataforma; devolve a nova lista e as contagens */
  function upsert(atual, novos, canal, origem, arquivo) {
    var res = { lista: atual.slice(), adicionados: 0, substituidos: 0, iguais: 0 }, agora = new Date().toISOString();
    novos.forEach(function (n) {
      var cn = n.canal || canal;
      var reg = { id: '', data: n.data, canal: cn, pedidos: n.pedidos, valor: n.valor, cancelados: n.cancelados || 0, valorCancelados: n.valorCancelados || 0, produtos: n.produtos || 0, descontos: n.descontos || 0, origem: origem, arquivo: arquivo || '', atualizadoEm: agora };
      var k = n.data + '|' + chave(cn), i = -1;
      res.lista.forEach(function (r, idx) { if (chaveReg(r) === k) i = idx; });
      if (i >= 0) {
        var o = res.lista[i];
        var igual = o.pedidos === reg.pedidos && Math.abs(o.valor - reg.valor) < 0.005 && (o.cancelados || 0) === reg.cancelados && Math.abs((o.valorCancelados || 0) - reg.valorCancelados) < 0.005;
        if (igual) res.iguais++; else res.substituidos++;
        reg.id = o.id;
        res.lista[i] = reg;
      } else { reg.id = uid(); res.lista.push(reg); res.adicionados++; }
    });
    return res;
  }
  /* nos dias em que existem plataformas separadas, o arquivo "Geral" não conta (evita contar em dobro) */
  function efetivos(regs) {
    var separado = {};
    regs.forEach(function (r) { if (chave(r.canal) !== chave(GERAL)) separado[r.data] = true; });
    return regs.filter(function (r) { return chave(r.canal) !== chave(GERAL) || !separado[r.data]; });
  }
  function somar(regs) {
    var t = { pedidos: 0, valor: 0, cancelados: 0, valorCancelados: 0, produtos: 0, descontos: 0, dias: 0, ticket: 0 }, dias = {};
    regs.forEach(function (r) { t.pedidos += r.pedidos || 0; t.valor += r.valor || 0; t.cancelados += r.cancelados || 0; t.valorCancelados += r.valorCancelados || 0; t.produtos += r.produtos || 0; t.descontos += r.descontos || 0; dias[r.data] = true; });
    t.dias = Object.keys(dias).length;
    t.valor = arred2(t.valor); t.valorCancelados = arred2(t.valorCancelados); t.produtos = arred2(t.produtos); t.descontos = arred2(t.descontos);
    t.ticket = t.pedidos > 0 ? t.valor / t.pedidos : 0;
    return t;
  }
  function canaisDe(regs) {
    var vistos = {}, out = [];
    regs.forEach(function (r) { var k = chave(r.canal); if (!vistos[k]) { vistos[k] = 1; out.push(r.canal); } });
    function pos(c) { var i = CANAIS_PADRAO.map(chave).indexOf(chave(c)); return chave(c) === chave(GERAL) ? 999 : (i >= 0 ? i : 100); }
    return out.sort(function (a, b) { return (pos(a) - pos(b)) || a.localeCompare(b, 'pt-BR'); });
  }
  function mesesDisponiveis(regs) {
    var vistos = {};
    regs.forEach(function (r) { vistos[r.data.slice(0, 7)] = true; });
    return Object.keys(vistos).sort().reverse();
  }
  function ymAnterior(ym) { var p = ym.split('-'), a = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1; if (m < 1) { m = 12; a--; } return a + '-' + pad2(m); }
  function ymSeguinte(ym) { var p = ym.split('-'), a = parseInt(p[0], 10), m = parseInt(p[1], 10) + 1; if (m > 12) { m = 1; a++; } return a + '-' + pad2(m); }
  function nomeMes(ym) { var p = ym.split('-'); return MESES[parseInt(p[1], 10) - 1] + ' de ' + p[0]; }
  function ultimoDiaComDados(regs, ym) {
    var u = 0;
    regs.forEach(function (r) { if (r.data.slice(0, 7) === ym) u = Math.max(u, parseInt(r.data.slice(8), 10)); });
    return u;
  }
  /* dias do mês (até o último com dados) sem nenhum lançamento */
  function diasSemLancamento(regs, ym) {
    var ef = efetivos(regs), tem = {}, ult = ultimoDiaComDados(ef, ym), falta = [];
    ef.forEach(function (r) { if (r.data.slice(0, 7) === ym) tem[parseInt(r.data.slice(8), 10)] = true; });
    for (var d = 1; d <= ult; d++) if (!tem[d]) falta.push(d);
    return { ate: ult, faltam: falta, com: ult - falta.length };
  }
  function intervalos(dias) {
    var out = [], i = 0;
    while (i < dias.length) {
      var j = i;
      while (j + 1 < dias.length && dias[j + 1] === dias[j] + 1) j++;
      out.push(j > i ? dias[i] + ' a ' + dias[j] : String(dias[i]));
      i = j + 1;
    }
    return out.join(', ');
  }
  /* despesas do mês: lançamentos do A Pagar com vencimento no mês (os pagos e os ainda a pagar) */
  function despesasDoMes(pagar, ym) {
    var t = { total: 0, pago: 0, aPagar: 0, n: 0 };
    (pagar || []).forEach(function (p) {
      if (!p || !p.vencimento || String(p.vencimento).slice(0, 7) !== ym) return;
      var v = parseFloat(p.valor) || 0;
      t.total += v; t.n++;
      if (p.status === 'pago') t.pago += v; else t.aPagar += v;
    });
    t.total = arred2(t.total); t.pago = arred2(t.pago); t.aPagar = arred2(t.aPagar);
    return t;
  }
  /* resultado do mês = faturado - despesas; margem em relação ao faturado (null se não houve faturamento) */
  function resultadoDoMes(faturado, despesas) {
    var r = arred2(faturado - despesas);
    return { valor: r, margem: faturado > 0 ? r / faturado : null, lucro: r >= 0 };
  }
  function conflitoOutroCanal(atual, novos, canal) {
    var k = chave(canal), por = {};
    novos.forEach(function (n) {
      if (!(n.valor > 0)) return;
      atual.forEach(function (r) { if (r.data === n.data && chave(r.canal) !== k && r.pedidos === n.pedidos && Math.abs(r.valor - n.valor) < 0.005) por[r.canal] = (por[r.canal] || 0) + 1; });
    });
    var melhor = null;
    Object.keys(por).forEach(function (c) { if (!melhor || por[c] > por[melhor]) melhor = c; });
    return melhor && por[melhor] >= Math.max(3, Math.ceil(novos.length / 2)) ? { canal: melhor, dias: por[melhor] } : null;
  }

  /* ---------------- plataforma: lista de opções ---------------- */
  function opcoesCanal() {
    var out = CANAIS_PADRAO.slice();
    lista().forEach(function (r) { if (chave(r.canal) !== chave(GERAL) && out.map(chave).indexOf(chave(r.canal)) < 0) out.push(r.canal); });
    return out;
  }
  function htmlSelectCanal(id, atual, comEscolha) {
    var ops = opcoesCanal(), a = chave(atual);
    return '<select class="form-select" id="' + id + '" onchange="fatCanalMudou(\'' + id + '\')">' +
      (comEscolha ? '<option value="">Escolha a plataforma...</option>' : '') +
      ops.map(function (c) { return '<option value="' + esc(c) + '"' + (chave(c) === a ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '<option value="' + GERAL + '"' + (a === chave(GERAL) ? ' selected' : '') + '>Geral (todas as plataformas juntas)</option>' +
      '<option value="__outra">Outra plataforma...</option></select>' +
      '<input class="form-input" id="' + id + 'Outro" placeholder="Nome da plataforma" style="display:none;margin-top:6px" oninput="fatPrever()">';
  }
  function lerCanal(id) {
    var v = val(id);
    if (v === '__outra') return val(id + 'Outro').trim();
    return v;
  }
  window.fatCanalMudou = function (id) {
    var o = el(id + 'Outro');
    if (o) o.style.display = val(id) === '__outra' ? 'block' : 'none';
    if (id === 'fatCanal') window.fatPrever();
  };

  /* ---------------- importar planilha ---------------- */
  var imp = null;
  function linhaPrev(rot, v) { return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-light);font-size:13px"><span>' + rot + '</span><strong>' + v + '</strong></div>'; }
  function aviso(txt, cor) { return '<div style="font-size:12px;color:' + (cor === 'rosa' ? 'var(--rosa-antigo)' : 'var(--text-muted)') + ';margin-top:8px">' + txt + '</div>'; }
  function textoExistentes(up) {
    return 'Dias novos: <strong>' + up.adicionados + '</strong>' + (up.iguais ? ' &middot; já lançados e iguais: ' + up.iguais : '') +
      (up.substituidos ? ' &middot; <strong style="color:var(--rosa-antigo)">com valores diferentes, serão substituídos: ' + up.substituidos + '</strong>' : '');
  }
  function registrosParaImportar(p, pular) {
    return pular && p.parcial ? p.registros.filter(function (r) { return r.data !== p.parcial.data; }) : p.registros;
  }
  /* arquivo "Performance das Vendas": não traz a plataforma, então o sistema pergunta */
  function htmlPrevia(p, canal, atual) {
    if (p.erro) return aviso(esc(p.erro), 'rosa');
    var tot = somar(p.registros), h = '<div style="background:var(--bg-warm);border-radius:var(--radius-md);padding:12px 16px;margin-top:6px">' +
      linhaPrev('Período', fmtD(p.periodo[0]) + ' a ' + fmtD(p.periodo[1]) + ' (' + p.registros.length + ' dia' + (p.registros.length > 1 ? 's' : '') + ')') +
      linhaPrev('Pedidos válidos', fmtInt(tot.pedidos)) + linhaPrev('Faturamento (vendas válidas)', fmtR(tot.valor)) +
      linhaPrev('Ticket médio', fmtR(tot.ticket)) + linhaPrev('Cancelados', fmtInt(tot.cancelados) + ' pedido' + (tot.cancelados === 1 ? '' : 's') + ' (' + fmtR(tot.valorCancelados) + ')') + '</div>';
    if (!canal) return h + aviso('Escolha a plataforma acima para poder importar.', 'rosa');
    var up = upsert(atual, p.registros, canal, 'importacao', p.nome);
    h += aviso('Plataforma: <strong>' + esc(chave(canal) === chave(GERAL) ? 'Geral (todas juntas)' : canal) + '</strong>. ' + textoExistentes(up) + '.');
    var cf = conflitoOutroCanal(atual, p.registros, canal);
    if (cf) h += aviso('Atenção: os mesmos valores de ' + cf.dias + ' dias já estão lançados em <strong>' + esc(cf.canal) + '</strong>. Este arquivo pode ser de outra plataforma, ou ser o mesmo arquivo importado duas vezes.', 'rosa');
    var geral = chave(canal) === chave(GERAL);
    var existeOutro = atual.some(function (r) { return (chave(r.canal) === chave(GERAL)) !== geral && p.registros.some(function (n) { return n.data === r.data; }); });
    if (existeOutro) h += aviso(geral ? 'Nos dias em que já existem plataformas separadas, o Geral não entra nos totais (para não contar em dobro).' : 'Nos dias em que já existe um arquivo Geral, ele deixa de entrar nos totais (as plataformas separadas valem).');
    p.avisos.forEach(function (a) { h += aviso(esc(a), 'rosa'); });
    return h;
  }
  /* exportação de pedidos: a plataforma vem em cada pedido, então não precisa perguntar */
  function htmlPreviaPedidos(p, atual, pular) {
    var regs = registrosParaImportar(p, pular), tot = somar(regs), por = {};
    regs.forEach(function (r) { (por[r.canal] = por[r.canal] || []).push(r); });
    var linhas = canaisDe(regs).map(function (c) {
      var t = somar(por[c]);
      return '<tr><td><strong>' + esc(c) + '</strong></td><td>' + t.dias + '</td><td>' + fmtInt(t.pedidos) + '</td><td><strong>' + fmtR(t.valor) + '</strong></td><td>' + (t.descontos ? fmtR(t.descontos) : '-') + '</td></tr>';
    }).join('');
    var h = '<div style="background:var(--bg-warm);border-radius:var(--radius-md);padding:12px 16px;margin-top:6px">' +
      linhaPrev('Pedidos do arquivo', fmtD(p.periodo[0]) + ' a ' + fmtD(p.periodo[1])) +
      linhaPrev('Pedidos pagos e não cancelados', fmtInt(tot.pedidos)) + linhaPrev('Faturamento', fmtR(tot.valor)) + linhaPrev('Ticket médio', fmtR(tot.ticket)) +
      (tot.descontos ? linhaPrev('Descontos e cupons', fmtR(tot.descontos) + (tot.produtos > 0 ? ' (' + fmtPctN(tot.descontos / tot.produtos) + ' dos produtos)' : '')) : '') + '</div>' +
      '<div class="table-wrapper" style="margin-top:10px"><table><thead><tr><th>Plataforma (lida do arquivo)</th><th>Dias</th><th>Pedidos</th><th>Faturamento</th><th>Descontos</th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
    h += aviso(textoExistentes(upsert(atual, regs, '', 'importacao', p.nome)) + '.');
    if (p.semPagamento) h += aviso(fmtInt(p.semPagamento) + ' pedido' + (p.semPagamento === 1 ? '' : 's') + ' sem pagamento não entra' + (p.semPagamento === 1 ? '' : 'm') + ' (' + p.cancSemPag + ' cancelado' + (p.cancSemPag === 1 ? '' : 's') + ' antes de pagar e ' + p.aguardando + ' aguardando pagamento). É o mesmo critério do relatório "Performance das Vendas" do Upseller.');
    if (p.renomeados.length) h += aviso(esc(p.renomeados.join(', ')) + ' é gravada como <strong>Site</strong>.');
    if (p.parcial) h += '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;margin-top:10px;color:var(--rosa-antigo)"><input type="checkbox" id="fatPular"' + (pular ? ' checked' : '') + ' onchange="fatPrever()" style="margin-top:2px"><span>Não importar ' + fmtD(p.parcial.data) + ': o arquivo começa às ' + p.parcial.hora + ', então esse dia parece incompleto. Importe esse dia depois, em um arquivo que comece à meia-noite.</span></label>';
    if (p.emAndamento) h += aviso('O último dia do arquivo é hoje e ainda está em andamento; importe de novo mais tarde para atualizar.');
    p.avisos.forEach(function (a) { h += aviso(esc(a), 'rosa'); });
    return h;
  }
  window.fatImportar = function () {
    imp = { parse: null, pular: false };
    openModal('Importar faturamento',
      '<div class="form-group"><label class="form-label">Arquivo do Upseller (.xlsx ou .csv)</label><input class="form-input" id="fatArq" type="file" accept=".xlsx,.csv,.txt" onchange="fatArquivo(this)"></div>' +
      '<div id="fatPlat"></div><div id="fatPrev"></div>' +
      '<p style="font-size:11px;color:var(--text-muted);margin-top:10px">Serve a <strong>exportação de pedidos</strong> (traz a plataforma de cada pedido, então o sistema separa sozinho) e o relatório <strong>Performance das Vendas</strong> (um arquivo por plataforma: o sistema pergunta de qual é). Importar de novo o mesmo período substitui os dias, sem duplicar. Só os totais por dia e plataforma são guardados, nunca dados de clientes.</p>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="fatBtnImp" onclick="fatConfirmar()" disabled style="opacity:.5">Importar</button>', true);
  };
  function prepararPlataforma() {
    var box = el('fatPlat'), p = imp && imp.parse;
    if (!box) return;
    box.innerHTML = p && !p.erro && p.tipo !== 'pedidos' ? '<div class="form-group"><label class="form-label">De qual plataforma é este arquivo?</label>' + htmlSelectCanal('fatCanal', '', true) + '</div>' : '';
  }
  window.fatArquivo = async function (input) {
    var f = input && input.files && input.files[0];
    if (!f || !imp) return;
    var prev = el('fatPrev');
    if (prev) prev.innerHTML = aviso('Lendo o arquivo...');
    try { imp.parse = await interpretarArquivo(await f.arrayBuffer(), f.name); }
    catch (e) { imp.parse = { tipo: '', registros: [], avisos: [], periodo: ['', ''], nome: f.name, erro: 'Não consegui ler o arquivo.' }; }
    imp.pular = !!imp.parse.parcial;
    prepararPlataforma();
    window.fatPrever();
  };
  window.fatPrever = function () {
    if (!imp || !imp.parse) return;
    var p = imp.parse, prev = el('fatPrev'), btn = el('fatBtnImp'), pode;
    if (el('fatPular')) imp.pular = el('fatPular').checked;
    if (p.tipo === 'pedidos' && !p.erro) {
      if (prev) prev.innerHTML = htmlPreviaPedidos(p, lista(), !!imp.pular);
      pode = registrosParaImportar(p, !!imp.pular).length > 0;
    } else {
      var canal = lerCanal('fatCanal');
      if (prev) prev.innerHTML = htmlPrevia(p, canal, lista());
      pode = !p.erro && p.registros.length > 0 && !!canal;
    }
    if (btn) { btn.disabled = !pode; btn.style.opacity = pode ? '1' : '.5'; }
  };
  window.fatConfirmar = function () {
    if (!imp || !imp.parse || imp.parse.erro) return;
    var p = imp.parse, canal = '', regs;
    if (p.tipo === 'pedidos') regs = registrosParaImportar(p, !!imp.pular);
    else {
      canal = lerCanal('fatCanal');
      if (!canal) { toast('Escolha a plataforma'); return; }
      regs = p.registros;
    }
    if (!regs.length) return;
    var up = upsert(lista(), regs, canal, 'importacao', p.nome);
    DB.set(CHAVE_DB, up.lista);
    S._fatMes = regs.map(function (r) { return r.data; }).sort().pop().slice(0, 7); S._fatAba = 'resumo';
    var n = up.adicionados, msg = n + ' lançamento' + (n === 1 ? '' : 's') + ' novo' + (n === 1 ? '' : 's') + (up.substituidos ? ', ' + up.substituidos + ' substituído' + (up.substituidos === 1 ? '' : 's') : '') + (canal ? ' em ' + canal : ' (por plataforma)');
    imp = null;
    closeModal();
    mostrar();
    toast('Faturamento importado: ' + msg);
  };

  /* ---------------- lançar manualmente ---------------- */
  window.fatManual = function (id) {
    var r = null;
    lista().forEach(function (x) { if (x.id === id) r = x; });
    var d = r || { data: localDateStr(), canal: '', pedidos: '', valor: '', cancelados: '', valorCancelados: '' };
    openModal(id ? 'Editar lançamento' : 'Lançar faturamento do dia',
      '<div class="form-row form-row-2"><div class="form-group"><label class="form-label">Data</label><input class="form-input" id="fmData" type="date" value="' + esc(d.data) + '"></div>' +
      '<div class="form-group"><label class="form-label">Plataforma</label>' + htmlSelectCanal('fmCanal', d.canal, !r) + '</div></div>' +
      '<div class="form-row form-row-2"><div class="form-group"><label class="form-label">Pedidos válidos</label><input class="form-input" id="fmPed" type="number" min="0" step="1" value="' + esc(d.pedidos) + '" placeholder="0"></div>' +
      '<div class="form-group"><label class="form-label">Vendas válidas (R$)</label><input class="form-input" id="fmVal" type="number" min="0" step="0.01" value="' + esc(d.valor) + '" placeholder="0,00"></div></div>' +
      '<div class="form-row form-row-2"><div class="form-group"><label class="form-label">Pedidos cancelados (opcional)</label><input class="form-input" id="fmCan" type="number" min="0" step="1" value="' + esc(d.cancelados || '') + '" placeholder="0"></div>' +
      '<div class="form-group"><label class="form-label">Vendas canceladas (R$, opcional)</label><input class="form-input" id="fmVCan" type="number" min="0" step="0.01" value="' + esc(d.valorCancelados || '') + '" placeholder="0,00"></div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="fatSalvarManual(\'' + esc(id || '') + '\')">Salvar</button>', true);
  };
  window.fatSalvarManual = function (id) {
    var data = val('fmData'), canal = lerCanal('fmCanal');
    if (!data) { toast('Preencha a data'); return; }
    if (!canal) { toast('Escolha a plataforma'); return; }
    if (String(val('fmVal')).trim() === '' || String(val('fmPed')).trim() === '') { toast('Preencha os pedidos e o valor das vendas válidas'); return; }
    var novo = { data: data, pedidos: Math.round(numero(val('fmPed'))), valor: arred2(numero(val('fmVal'))), cancelados: Math.round(numero(val('fmCan'))), valorCancelados: arred2(numero(val('fmVCan'))) };
    var atual = lista().filter(function (r) { return r.id !== id; });
    var existe = atual.filter(function (r) { return chaveReg(r) === data + '|' + chave(canal); })[0];
    if (existe && (existe.pedidos !== novo.pedidos || Math.abs(existe.valor - novo.valor) > 0.005) &&
      !window.confirm('Já existe lançamento de ' + canal + ' em ' + fmtD(data) + ' (' + existe.pedidos + ' pedidos, ' + fmtR(existe.valor) + '). Substituir?')) return;
    var up = upsert(atual, [novo], canal, 'manual', '');
    DB.set(CHAVE_DB, up.lista);
    S._fatMes = data.slice(0, 7);
    closeModal(); mostrar(); toast('Lançamento salvo');
  };
  window.fatExcluir = function (id) {
    var r = null;
    lista().forEach(function (x) { if (x.id === id) r = x; });
    if (!r || !window.confirm('Excluir o lançamento de ' + r.canal + ' em ' + fmtD(r.data) + '?')) return;
    DB.set(CHAVE_DB, lista().filter(function (x) { return x.id !== id; }));
    mostrar(); toast('Lançamento excluído');
  };

  /* ---------------- tela ---------------- */
  function cartao(rot, valor, sub, cor) {
    return '<div class="card" style="padding:14px 16px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:' + (cor || 'var(--text-muted)') + ';font-weight:700;margin-bottom:4px">' + rot + '</div>' +
      '<div style="font-size:18px;font-weight:800">' + valor + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + sub + '</div></div>';
  }
  function corDoCanal(canais, c) { var i = canais.map(chave).indexOf(chave(c)); return CORES[(i < 0 ? 0 : i) % CORES.length]; }
  function htmlResumoFat(todos) {
    var ym = S._fatMes, doMes = efetivos(todos).filter(function (r) { return r.data.slice(0, 7) === ym; });
    if (!doMes.length) return '<div class="empty-state"><h3>Sem faturamento lançado em ' + nomeMes(ym) + '</h3><p>Escolha outro mês ou importe a planilha desse período.</p></div>';
    var t = somar(doMes), canais = canaisDe(doMes), desp = despesasDoMes(DB.get('pagar'), ym), res = resultadoDoMes(t.valor, desp.total);
    var cob = diasSemLancamento(todos, ym);
    var aviso_ = cob.faltam.length ? '<div style="font-size:12px;color:var(--rosa-antigo);margin-bottom:12px" class="anim d1">Sem lançamento de faturamento em ' + (cob.faltam.length === 1 ? 'dia ' : 'dias ') + intervalos(cob.faltam) + ' (contam como zero). Importe o período completo para ver o mês inteiro.</div>' : '';
    var cor = res.lucro ? 'var(--oliva)' : 'var(--rosa-antigo)';
    var h = aviso_ + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px" class="anim d1">' +
      cartao('Faturado no mês', fmtR(t.valor), fmtInt(t.pedidos) + ' pedido' + (t.pedidos === 1 ? '' : 's') + ' válido' + (t.pedidos === 1 ? '' : 's') + ' &middot; vendas pagas e não canceladas', 'var(--oliva)') +
      cartao('Despesas do mês (A Pagar)', desp.n ? fmtR(desp.total) : '-', desp.n ? 'pago ' + fmtR(desp.pago) + ' &middot; a pagar ' + fmtR(desp.aPagar) + ' (' + desp.n + ' lançamento' + (desp.n === 1 ? '' : 's') + ')' : 'nenhum lançamento no A Pagar com vencimento em ' + nomeMes(ym)) +
      '<div class="card" style="padding:14px 16px;border-left:3px solid ' + cor + '"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:' + cor + ';font-weight:700;margin-bottom:4px">' + (res.lucro ? 'Lucro do mês' : 'Prejuízo do mês') + '</div>' +
      '<div style="font-size:18px;font-weight:800;color:' + cor + '">' + fmtR(res.valor) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">faturado &minus; despesas' + (res.margem === null ? '' : ' &middot; ' + fmtPctN(res.margem) + ' do faturado') + '</div></div></div>';
    var linhas = canais.map(function (c) {
      var rs = doMes.filter(function (r) { return chave(r.canal) === chave(c); }), tc = somar(rs), ate = rs.map(function (r) { return r.data; }).sort().pop(), pct = t.valor > 0 ? tc.valor / t.valor : 0;
      return '<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:' + corDoCanal(canais, c) + '"></span><strong>' + esc(chave(c) === chave(GERAL) ? 'Geral (todas juntas)' : c) + '</strong></td>' +
        '<td><strong>' + fmtR(tc.valor) + '</strong></td><td style="min-width:160px"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;border-radius:3px;background:var(--border-light);overflow:hidden"><div style="height:100%;width:' + (pct * 100).toFixed(1) + '%;background:' + corDoCanal(canais, c) + '"></div></div><span style="font-size:12px;min-width:44px;text-align:right">' + fmtPctN(pct) + '</span></div></td>' +
        '<td style="color:var(--text-muted)">' + fmtD(ate) + '</td></tr>';
    }).join('');
    h += '<div class="card anim d2" style="margin-bottom:12px"><div class="card-header"><h3>Faturado por canal</h3></div><div class="card-body"><div class="table-wrapper"><table><thead><tr><th>Canal</th><th>Faturado</th><th>% do total</th><th>Dados até</th></tr></thead><tbody>' + linhas +
      '<tr style="font-weight:700;background:var(--bg-warm)"><td>Total</td><td>' + fmtR(t.valor) + '</td><td></td><td></td></tr></tbody></table></div></div></div>';
    h += '<p style="font-size:11px;color:var(--text-muted)" class="anim d3">Faturado é o valor bruto das vendas pagas e não canceladas. As despesas vêm do <a href="#" onclick="go(\'pagar\');return false" style="color:var(--rosa-antigo)">A Pagar</a> (lançamentos com vencimento no mês, pagos ou não). Comissões das plataformas e impostos só entram no resultado se estiverem lançados no A Pagar.</p>';
    return h;
  }
  function htmlLancamentos(todos) {
    var ym = S._fatMes, rs = todos.filter(function (r) { return r.data.slice(0, 7) === ym; }).sort(function (a, b) { return b.data.localeCompare(a.data) || a.canal.localeCompare(b.canal, 'pt-BR'); });
    if (!rs.length) return '<div class="empty-state"><h3>Sem lançamentos em ' + nomeMes(ym) + '</h3></div>';
    return '<div class="card anim d2"><div class="table-wrapper"><table><thead><tr><th>Data</th><th>Plataforma</th><th>Pedidos válidos</th><th>Vendas válidas</th><th>Cancelados</th><th>Origem</th><th></th></tr></thead><tbody>' + rs.map(function (r) {
      return '<tr><td>' + fmtD(r.data) + '</td><td>' + esc(chave(r.canal) === chave(GERAL) ? 'Geral' : r.canal) + '</td><td>' + fmtInt(r.pedidos) + '</td><td><strong>' + fmtR(r.valor) + '</strong></td><td>' + (r.cancelados ? fmtInt(r.cancelados) + ' (' + fmtR(r.valorCancelados) + ')' : '-') + '</td><td style="font-size:11px;color:var(--text-muted)">' + (r.origem === 'manual' ? 'manual' : 'planilha') + '</td>' +
        '<td style="text-align:right"><button class="btn-icon" onclick="fatManual(\'' + esc(r.id) + '\')" style="display:inline-flex">' + I.edit + '</button><button class="btn-icon" onclick="fatExcluir(\'' + esc(r.id) + '\')" style="display:inline-flex;margin-left:4px">' + I.trash + '</button></td></tr>';
    }).join('') + '</tbody></table></div></div>';
  }
  window.fatMes = function (ym) { S._fatMes = ym; mostrar(); };
  window.fatAba = function (a) { S._fatAba = a; mostrar(); };
  function renderFaturamento() {
    var c = el('content');
    if (!c) return;
    var todos = lista(), meses = mesesDisponiveis(todos);
    if (!S._fatMes) S._fatMes = meses[0] || localDateStr().slice(0, 7);
    var aba = S._fatAba || 'resumo', ym = S._fatMes;
    function aba_(id, rot) { return '<div style="padding:9px 18px;font-size:13px;cursor:pointer;font-weight:' + (aba === id ? '700' : '500') + ';color:' + (aba === id ? 'var(--rosa-antigo)' : 'var(--text-muted)') + ';border-bottom:2px solid ' + (aba === id ? 'var(--rosa-antigo)' : 'transparent') + '" onclick="fatAba(\'' + id + '\')">' + rot + '</div>'; }
    var cab = '<div class="page-header anim"><div class="page-header-left"><h2>Faturamento</h2><p>Faturado por mês e por canal, e o resultado contra as despesas do A Pagar</p></div><div class="page-header-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="fatManual()">' + I.plus + ' Lançar manualmente</button><button class="btn btn-primary" onclick="fatImportar()">' + I.plus + ' Importar planilha</button></div></div>';
    if (!todos.length) {
      c.innerHTML = cab + '<div class="empty-state anim d1"><h3>Nenhum faturamento registrado</h3><p>Importe o relatório "Performance das Vendas" do Upseller. O sistema pergunta de qual plataforma é o arquivo.</p><button class="btn btn-primary" onclick="fatImportar()">' + I.plus + ' Importar planilha</button></div>';
      return;
    }
    var seletor = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap" class="anim d1"><button class="btn btn-secondary btn-sm" onclick="fatMes(\'' + ymAnterior(ym) + '\')">&larr;</button>' +
      '<input type="month" class="form-input" style="font-size:13px;padding:7px 12px;width:auto" value="' + esc(ym) + '" onchange="if(this.value)fatMes(this.value)"><button class="btn btn-secondary btn-sm" onclick="fatMes(\'' + ymSeguinte(ym) + '\')">&rarr;</button>' +
      '<strong style="font-size:15px;margin-left:6px">' + nomeMes(ym) + '</strong></div>';
    c.innerHTML = cab + '<div style="display:flex;gap:0;border-bottom:1.5px solid var(--border);margin-bottom:18px" class="anim d1">' + aba_('resumo', 'Resumo') + aba_('lancamentos', 'Lançamentos') + '</div>' + seletor + (aba === 'resumo' ? htmlResumoFat(todos) : htmlLancamentos(todos));
  }
  function mostrar() { S.page = 'faturamento'; renderFaturamento(); marcarNav(); }
  window.renderFaturamento = renderFaturamento;
  window.abrirFaturamento = function () {
    S.page = 'faturamento';
    document.body.classList.remove('menu-aberto');
    if (typeof window.render === 'function') window.render(); else mostrar();
  };

  /* ---------------- menu lateral (Financeiro > Faturamento) ---------------- */
  var NAV_ID = 'navFaturamento';
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="12"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="18" y1="20" x2="18" y2="9"></line></svg>';
  function raizNav() { return el('sidebarNav') || document.querySelector('.sidebar'); }
  function acharItemNav(texto) {
    var nav = raizNav(), achado = null;
    if (!nav) return null;
    [].slice.call(nav.querySelectorAll('*')).forEach(function (e) {
      if (achado) return;
      var proprio = [].slice.call(e.childNodes).filter(function (n) { return n.nodeType === 3; }).map(function (n) { return n.nodeValue; }).join('');
      if (chave(proprio) === chave(texto)) {
        /* sobe até o maior bloco que contém só esse rótulo: é o item do menu, qualquer que seja a classe dele */
        var item = e;
        while (item.parentNode && item.parentNode !== nav && chave(item.parentNode.textContent) === chave(texto)) item = item.parentNode;
        achado = item;
      }
    });
    return achado;
  }
  function marcarNav() {
    var item = el(NAV_ID), nav = raizNav();
    if (!item || !nav) return;
    if (S.page === 'faturamento') {
      [].slice.call(nav.querySelectorAll('.active')).forEach(function (e) { e.classList.remove('active'); });
      item.classList.add('active');
    } else item.classList.remove('active');
  }
  function injetarNav() {
    if (el(NAV_ID)) { marcarNav(); return; }
    var base = acharItemNav('A Receber') || acharItemNav('A Pagar');
    if (!base || !base.parentNode) return;
    var novo = base.cloneNode(true), feito = false;
    novo.id = NAV_ID;
    [].slice.call(novo.attributes).forEach(function (a) { if (/^data-/.test(a.name)) novo.removeAttribute(a.name); });
    novo.setAttribute('onclick', 'event.stopPropagation();abrirFaturamento()');
    novo.classList.remove('active');
    [].slice.call(novo.childNodes).forEach(function (n) { if (!feito && n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = ' Faturamento'; feito = true; } });
    if (!feito) {
      var folhas = [].slice.call(novo.querySelectorAll('*')).filter(function (e) { return e.children.length === 0 && e.textContent.trim() !== ''; });
      if (folhas.length) folhas[folhas.length - 1].textContent = 'Faturamento'; else novo.textContent = 'Faturamento';
    }
    var svg = novo.querySelector('svg');
    if (svg) {
      var tmp = document.createElement('div');
      tmp.innerHTML = ICONE;
      var ns = tmp.firstChild;
      [].slice.call(svg.attributes).forEach(function (a) { if (a.name !== 'viewBox' && a.name !== 'fill' && a.name !== 'stroke' && !/^stroke/.test(a.name)) ns.setAttribute(a.name, a.value); });
      svg.parentNode.replaceChild(ns, svg);
    }
    base.parentNode.insertBefore(novo, base.nextSibling);
    marcarNav();
  }
  function ligarNav() {
    injetarNav();
    var nav = raizNav();
    if (nav && window.MutationObserver) {
      var agendado = false;
      new MutationObserver(function () {
        if (agendado) return;
        agendado = true;
        (window.requestAnimationFrame || setTimeout)(function () { agendado = false; try { injetarNav(); } catch (e) { console.warn('faturamento: menu', e); } });
      }).observe(nav, { childList: true, subtree: true });
    }
  }
  /* a tela do sistema desenha pelo S.page; para "faturamento" desenhamos a nossa */
  envolver('render', function (antes) {
    return function () {
      if (S.page === 'faturamento') {
        try { if (typeof window.renderNav === 'function') window.renderNav(); } catch (e0) { /* ignorar */ }
        injetarNav();
        renderFaturamento();
        marcarNav();
        return;
      }
      var r = antes.apply(this, arguments);
      try { marcarNav(); } catch (e) { /* ignorar */ }
      return r;
    };
  });
  envolver('renderNav', function (antes) {
    return function () {
      var r = antes.apply(this, arguments);
      try { injetarNav(); } catch (e) { console.warn('faturamento: menu', e); }
      return r;
    };
  });

  /* ---------------- autoteste (console: FaturamentoTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    ok('números e datas de planilha e de texto', numero('1.234,56') === 1234.56 && numero('R$ 10,5') === 10.5 && numero(7) === 7 && dataISO(46350) === '2026-11-24' && dataISO('24/11/2026') === '2026-11-24' && dataISO('2026-11-24 10:00') === '2026-11-24' && dataISO('abc') === '');
    var linhas = [['Data', 'Total de Pedidos', 'Valor Total de Vendas', 'Pedidos Válidos', 'Valor de Vendas Válidas', 'Pedidos Cancelados', 'Valor de Vendas Canceladas'],
      [46350, 3, 150, 2, 100, 1, 50], [46349, 1, 70, 1, 70, 0, 0], [46349, 2, 90, 2, 90, 0, 0]];
    var p = lerPerformance(linhas, 'x.xlsx');
    ok('lê o relatório do Upseller pelas colunas, ignora a ordem e avisa de data repetida', !p.erro && p.registros.length === 2 && p.registros[0].data === '2026-11-23' && p.registros[0].pedidos === 2 && p.registros[0].valor === 90 && p.registros[1].valor === 100 && p.registros[1].cancelados === 1 && p.avisos.length === 1 && p.periodo[1] === '2026-11-24');
    ok('arquivo de outro formato é recusado com mensagem', lerPerformance([['a', 'b'], [1, 2]], 'y.csv').erro.indexOf('Performance das Vendas') > -1);
    var csv = lerCSV('Data;Pedidos Válidos;Valor de Vendas Válidas\n24/11/2026;2;"294,66"\n23/11/2026;3;211,19\n');
    var pc = lerPerformance(csv, 'z.csv');
    ok('lê CSV com ponto e vírgula e vírgula decimal', pc.registros.length === 2 && pc.registros[1].valor === 294.66 && pc.registros[0].pedidos === 3);
    var base = upsert([], pc.registros, 'Shopee', 'importacao', 'z.csv');
    var de_novo = upsert(base.lista, pc.registros, 'shopee', 'importacao', 'z.csv');
    ok('importar o mesmo período e plataforma de novo não duplica', base.adicionados === 2 && de_novo.adicionados === 0 && de_novo.iguais === 2 && de_novo.lista.length === 2);
    var alterado = upsert(base.lista, [{ data: '2026-11-24', pedidos: 9, valor: 900 }], 'Shopee', 'manual', '');
    ok('valores diferentes no mesmo dia e plataforma substituem', alterado.substituidos === 1 && alterado.lista.length === 2 && alterado.lista.filter(function (x) { return x.data === '2026-11-24'; })[0].valor === 900);
    var mix = base.lista.concat(upsert([], [{ data: '2026-11-24', pedidos: 5, valor: 500 }, { data: '2026-11-20', pedidos: 4, valor: 400 }], 'Geral', 'importacao', '').lista);
    var efs = efetivos(mix);
    ok('o Geral não conta em dobro nos dias em que há plataformas separadas', efs.length === 3 && efs.filter(function (x) { return x.canal === 'Geral'; }).length === 1 && efs.filter(function (x) { return x.canal === 'Geral'; })[0].data === '2026-11-20');
    var cf = conflitoOutroCanal(upsert([], [{ data: '2026-11-01', pedidos: 3, valor: 10 }, { data: '2026-11-02', pedidos: 3, valor: 20 }, { data: '2026-11-03', pedidos: 3, valor: 30 }], 'Site', 'importacao', '').lista, [{ data: '2026-11-01', pedidos: 3, valor: 10 }, { data: '2026-11-02', pedidos: 3, valor: 20 }, { data: '2026-11-03', pedidos: 3, valor: 30 }], 'Shopee');
    ok('avisa quando os mesmos valores já estão em outra plataforma', !!cf && cf.canal === 'Site' && cf.dias === 3);
    var nov = [{ data: '2026-11-01', canal: 'Site', pedidos: 2, valor: 200, cancelados: 0, valorCancelados: 0 }, { data: '2026-11-02', canal: 'Site', pedidos: 4, valor: 400, cancelados: 1, valorCancelados: 50 }, { data: '2026-10-01', canal: 'Site', pedidos: 1, valor: 100 }, { data: '2026-10-02', canal: 'Site', pedidos: 1, valor: 100 }, { data: '2026-10-03', canal: 'Site', pedidos: 1, valor: 300 }];
    var tt = somar(nov.filter(function (x) { return x.data.slice(0, 7) === '2026-11'; }));
    ok('totais por mês somam só vendas válidas e calculam o ticket', tt.valor === 600 && tt.pedidos === 6 && tt.ticket === 100 && tt.valorCancelados === 50);
    var pagarT = [{ vencimento: '2026-11-05', valor: '1200', status: 'pago' }, { vencimento: '2026-11-27', valor: '799', status: 'pendente' }, { vencimento: '2026-12-05', valor: '1200', status: 'pendente' }, { vencimento: '2026-10-31', valor: '500', status: 'pago' }, { valor: '10' }];
    var dsp = despesasDoMes(pagarT, '2026-11'), rs1 = resultadoDoMes(5000, dsp.total), rs2 = resultadoDoMes(1000, 1999);
    ok('as despesas do mês vêm do A Pagar pelo vencimento (pagas e a pagar) e o resultado é faturado menos despesas',
      dsp.total === 1999 && dsp.pago === 1200 && dsp.aPagar === 799 && dsp.n === 2 && rs1.valor === 3001 && rs1.lucro === true && Math.abs(rs1.margem - 0.6002) < 1e-9 && rs2.valor === -999 && rs2.lucro === false && resultadoDoMes(0, 100).margem === null && despesasDoMes([], '2026-11').n === 0);
    ok('navegação entre meses', ymAnterior('2026-01') === '2025-12' && ymSeguinte('2026-12') === '2027-01' && nomeMes('2026-11') === 'Novembro de 2026');
    var ped = [['Plataformas', 'Hora do Pedido', 'Hora do Pagamento', 'Valor do Pedido', 'Valor Total de Produtos', 'Descontos e Cupons', 'Pós-venda/Cancelado/Devolvido'],
      ['Shopee', '2026-11-10 18:30:00', '2026-11-10 18:31:00', 100, 110, -10, null],
      ['Shopee', '2026-11-10 19:00:00', null, 50, 50, 0, 'Cancelado'],
      ['Nuvemshop', '2026-11-11 09:00:00', '2026-11-11 09:05:00', 200, 200, 0, null],
      ['TikTok Shop', '2026-11-11 10:00:00', null, 70, 70, 0, null],
      ['Shopee', '2026-11-11 11:00:00', '2026-11-11 11:01:00', 80, 80, 0, 'Cancelado']];
    var pp = lerPedidos(ped, 'pedidos.xlsx', '2026-11-30');
    var rSh = pp.registros.filter(function (x) { return x.canal === 'Shopee'; });
    ok('a exportação de pedidos é reconhecida e separada por plataforma e dia (Nuvemshop vira Site)',
      detectarTipo(ped) === 'pedidos' && detectarTipo(linhas) === 'performance' && pp.tipo === 'pedidos' && pp.registros.length === 3 && pp.registros.some(function (x) { return x.canal === 'Site' && x.data === '2026-11-11' && x.valor === 200 && x.pedidos === 1; }) && pp.renomeados[0] === 'Nuvemshop');
    ok('vale pedido pago e não cancelado; sem pagamento não conta; pago e cancelado vai para cancelados; descontos somam',
      rSh.length === 2 && rSh[0].pedidos === 1 && rSh[0].valor === 100 && rSh[0].produtos === 110 && rSh[0].descontos === 10 && rSh[1].pedidos === 0 && rSh[1].cancelados === 1 && rSh[1].valorCancelados === 80 && pp.semPagamento === 2 && pp.cancSemPag === 1 && pp.aguardando === 1);
    ok('avisa quando o primeiro dia do arquivo começa tarde (dia incompleto) e quando o último dia é hoje',
      pp.parcial && pp.parcial.data === '2026-11-10' && pp.parcial.hora === '18:30' && pp.emAndamento === false && lerPedidos(ped, 'x', '2026-11-11').emAndamento === true && registrosParaImportar(pp, true).every(function (x) { return x.data !== '2026-11-10'; }));
    ok('arquivo de pedidos sem a coluna de pagamento é recusado', lerPedidos([['Plataformas', 'Hora do Pedido', 'Valor do Pedido'], ['Shopee', '2026-11-10 10:00:00', 5]], 'x').erro.indexOf('Hora do Pagamento') > -1);
    var parcialMes = [{ data: '2026-11-18', canal: 'Site', pedidos: 3, valor: 300 }, { data: '2026-11-19', canal: 'Site', pedidos: 3, valor: 300 }, { data: '2026-11-20', canal: 'Site', pedidos: 3, valor: 300 }];
    var sl = diasSemLancamento(parcialMes, '2026-11');
    ok('aponta os dias do mês sem lançamento (eles contam como zero)', sl.faltam.length === 17 && intervalos(sl.faltam) === '1 a 17' && intervalos([3, 5, 6, 7, 9]) === '3, 5 a 7, 9' && diasSemLancamento(nov, '2026-11').faltam.length === 0);
    ok('SISTEMA: faturamento instalado', typeof window.abrirFaturamento === 'function' && typeof window.fatImportar === 'function');
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'FATURAMENTO: ' + r.length + ' testes, 0 falhas' : 'FATURAMENTO: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }
  window.FaturamentoTeste = teste;
  if (typeof window.__fatExport === 'function') window.__fatExport({ lerPedidos: lerPedidos, detectarTipo: detectarTipo, registrosParaImportar: registrosParaImportar, lerXlsx: lerXlsx, lerCSV: lerCSV, lerPerformance: lerPerformance, interpretarArquivo: interpretarArquivo, upsert: upsert, efetivos: efetivos, somar: somar, despesasDoMes: despesasDoMes, resultadoDoMes: resultadoDoMes, diasSemLancamento: diasSemLancamento });

  try { ligarNav(); } catch (e) { console.warn('faturamento: menu', e); }
})();
