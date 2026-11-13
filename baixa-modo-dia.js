/* ============================================================
   MUNDANA · MODO DIA — baixa automática de pagamentos
   Instalação: no index.html, DEPOIS do quadros-extras.js e antes de </body>:
       <script src="baixa-modo-dia.js" charset="utf-8"></script>
   Para desligar: basta remover essa linha.
   Autoteste: no console (F12) digite  BaixaModoDiaTeste()

   O que faz:
   - dar ok em "Pagar X" (vencido ou do dia) no Modo Dia baixa o
     pagamento no A Pagar (status = pago), igual ao botão de baixa de lá;
   - desmarcar o ok reabre o pagamento (status = pendente) e tira o item
     do espelho da lista de feitos no Supabase, para o ok não voltar sozinho;
   - o pagamento baixado hoje continua na lista em "Concluídas".
   Não mexe em A Receber nem em tarefas de outros tipos.
   ============================================================ */
(function () {
  'use strict';

  if (typeof DB === 'undefined' || typeof toggleModoDiaTask !== 'function' || typeof getModoDiaTasks !== 'function' || typeof localDateStr !== 'function') {
    console.error('baixa-modo-dia.js: carregue este arquivo DEPOIS do script principal do sistema.');
    return;
  }

  /* ---------------- núcleo (sem DOM, testável) ---------------- */
  /* As tarefas de pagamento do Modo Dia têm id "pag_<id>" (vencido) ou "pag_hoje_<id>" (vence hoje). */
  function idPagamento(taskId) {
    taskId = String(taskId == null ? '' : taskId);
    if (taskId.indexOf('pag_hoje_') === 0) return taskId.slice(9);
    if (taskId.indexOf('pag_') === 0) return taskId.slice(4);
    return null;
  }

  /* Decide o que fazer ao clicar no ok. "feitos" é a lista de feitos de hoje ANTES do clique. */
  function decidirBaixa(taskId, feitos, pagar) {
    var pid = idPagamento(taskId); if (!pid) return null;
    var p = null;
    (pagar || []).forEach(function (x) { if (x && x.id === pid) p = x; });
    if (!p) return null;
    var concluindo = (feitos || []).indexOf(taskId) < 0;
    var novo = concluindo ? 'pago' : 'pendente';
    if ((p.status === 'pago') === (novo === 'pago')) return null;
    return { pagamento: p, novoStatus: novo, concluindo: concluindo };
  }

  /* Tarefas de pagamentos baixados hoje pelo Modo Dia, para continuarem na lista como concluídas. */
  function tarefasPagasHoje(pagar, feitos, existentes) {
    var out = []; var ja = {};
    (existentes || []).forEach(function (t) { ja[t.id] = 1; });
    (pagar || []).forEach(function (p) {
      if (!p || p.status !== 'pago') return;
      var atrasada = 'pag_' + p.id, doDia = 'pag_hoje_' + p.id;
      var tid = feitos.indexOf(atrasada) > -1 ? atrasada : (feitos.indexOf(doDia) > -1 ? doDia : null);
      if (!tid || ja[tid]) return;
      out.push({
        priority: tid === atrasada ? 1 : 2,
        type: tid === atrasada ? 'urgente' : 'hoje',
        cat: 'Financeiro', catColor: 'amber',
        text: 'Pagar ' + (p.descricao || '') + ' \u2014 ' + fmtR(p.valor),
        sub: 'Pago \u2014 baixado em A Pagar',
        action: "go('pagar')", btnLabel: 'Ir para A Pagar', id: tid
      });
    });
    return out;
  }

  /* ---------------- ligação com o sistema ---------------- */
  function lerFeitos() {
    try { return JSON.parse(localStorage.getItem('mundana_mododia_done_' + localDateStr()) || '[]'); } catch (e) { return []; }
  }

  /* O Modo Dia espelha a lista de feitos no Supabase e só acrescenta itens. Ao desmarcar, tiramos o item de lá. */
  async function tirarDoEspelho(taskId) {
    try {
      var chave = 'mododia_done_' + localDateStr();
      var res = await sbFetch('app_data?key=eq.' + chave, { method: 'GET' });
      var remoto = (res && res[0] && res[0].value) ? res[0].value : [];
      if (typeof remoto === 'string') remoto = JSON.parse(remoto);
      if (!Array.isArray(remoto) || remoto.indexOf(taskId) < 0) return;
      await sbFetch('app_data?key=eq.' + chave, {
        method: 'PATCH',
        body: { value: remoto.filter(function (x) { return x !== taskId; }) },
        headers: { 'Prefer': 'return=representation' }
      });
    } catch (e) { console.warn('baixa-modo-dia: espelho', e); }
  }

  var toggleOrig = window.toggleModoDiaTask;
  window.toggleModoDiaTask = function (id) {
    var self = this, args = arguments, tid = String(id);
    function seguir() {
      var r = toggleOrig.apply(self, args);
      try { if (typeof renderTopBar === 'function') renderTopBar(); } catch (e) { /* ignorar */ }
      return r;
    }
    if (!idPagamento(tid)) return seguir();
    var concluindo = lerFeitos().indexOf(tid) < 0;
    try {
      var itens = DB.get('pagar');
      var d = decidirBaixa(tid, lerFeitos(), itens);
      if (d) {
        d.pagamento.status = d.novoStatus;
        DB.set('pagar', itens);
        toast(d.concluindo ? 'Pagamento baixado em A Pagar' : 'Pagamento reaberto em A Pagar');
      }
    } catch (e) { console.error('baixa-modo-dia: baixa', e); }
    if (concluindo) return seguir();
    return tirarDoEspelho(tid).then(seguir);
  };
  window.toggleModoDiaTask._baixa = true;

  var tasksOrig = window.getModoDiaTasks;
  window.getModoDiaTasks = function () {
    var tasks = tasksOrig.apply(this, arguments);
    try {
      var feitos = lerFeitos();
      if (feitos.length) {
        var extra = tarefasPagasHoje(DB.get('pagar'), feitos, tasks);
        if (extra.length) {
          extra.forEach(function (t) { tasks.push(t); });
          tasks.sort(function (a, b) { return a.priority - b.priority; });
        }
      }
    } catch (e) { console.error('baixa-modo-dia: tarefas', e); }
    return tasks;
  };
  window.getModoDiaTasks._baixa = true;

  /* ---------------- autoteste (console: BaixaModoDiaTeste()) ---------------- */
  function teste() {
    var r = [];
    function ok(nome, cond) { r.push({ teste: nome, ok: !!cond }); }
    ok('reconhece tarefa de pagamento vencido', idPagamento('pag_abc1') === 'abc1');
    ok('reconhece tarefa de pagamento do dia', idPagamento('pag_hoje_abc1') === 'abc1');
    ok('ignora tarefas de outros tipos', idPagamento('ped_new_1') === null && idPagamento('rec_1') === null && idPagamento('lembrete_1') === null && idPagamento('stock_1') === null && idPagamento('') === null && idPagamento(undefined) === null);
    var pagar = [
      { id: 'p1', descricao: 'Aluguel', valor: '600', status: 'pendente' },
      { id: 'p2', descricao: 'Luz', valor: 60, status: 'pago' },
      { id: 'p3', descricao: 'Internet', valor: 100 }
    ];
    var d1 = decidirBaixa('pag_p1', [], pagar);
    ok('ok em pagamento pendente baixa como pago', !!d1 && d1.novoStatus === 'pago' && d1.concluindo === true && d1.pagamento.id === 'p1');
    var d3 = decidirBaixa('pag_hoje_p3', [], pagar);
    ok('ok em pagamento sem status também baixa', !!d3 && d3.novoStatus === 'pago');
    var d2 = decidirBaixa('pag_p2', ['pag_p2'], pagar);
    ok('desmarcar reabre o pagamento', !!d2 && d2.novoStatus === 'pendente' && d2.concluindo === false);
    ok('marcar um pagamento que já está pago não muda nada', decidirBaixa('pag_p2', [], pagar) === null);
    ok('desmarcar um pagamento que já está pendente não muda nada', decidirBaixa('pag_p1', ['pag_p1'], pagar) === null);
    ok('pagamento que não existe mais é ignorado', decidirBaixa('pag_zzz', [], pagar) === null);
    ok('tarefa que não é de pagamento é ignorada', decidirBaixa('ped_new_1', [], pagar) === null);
    var t = tarefasPagasHoje(pagar, ['pag_p2'], []);
    ok('pagamento vencido baixado hoje continua na lista como concluído', t.length === 1 && t[0].id === 'pag_p2' && t[0].type === 'urgente' && t[0].priority === 1);
    ok('o texto segue o padrão do Modo Dia', t[0].text === 'Pagar Luz \u2014 R$ 60,00' && t[0].sub.indexOf('baixado') > -1 && t[0].action === "go('pagar')");
    var t2 = tarefasPagasHoje(pagar, ['pag_hoje_p2'], []);
    ok('pagamento do dia baixado hoje volta como pendência do dia', t2.length === 1 && t2[0].type === 'hoje' && t2[0].priority === 2);
    ok('não duplica uma tarefa que já está na lista', tarefasPagasHoje(pagar, ['pag_p2'], [{ id: 'pag_p2' }]).length === 0);
    ok('pagamento pago mas sem ok no dia não entra', tarefasPagasHoje(pagar, [], []).length === 0);
    ok('pagamento pendente com ok não entra', tarefasPagasHoje(pagar, ['pag_p1'], []).length === 0);
    ok('SISTEMA: o clique no ok está integrado', window.toggleModoDiaTask._baixa === true);
    ok('SISTEMA: a lista do dia está integrada', window.getModoDiaTasks._baixa === true);
    var falhas = r.filter(function (x) { return !x.ok; });
    if (console.table) console.table(r);
    console.log(falhas.length === 0 ? 'BAIXA-MODO-DIA: ' + r.length + ' testes, 0 falhas' : 'BAIXA-MODO-DIA: ' + falhas.length + ' FALHA(S): ' + falhas.map(function (f) { return f.teste; }).join(' | '));
    return { total: r.length, falhas: falhas.length, resultados: r };
  }

  window.BaixaModoDiaTeste = teste;
})();
