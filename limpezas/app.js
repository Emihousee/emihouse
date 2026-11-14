import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, updateDoc, setDoc, deleteDoc, addDoc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const VIEWS = ['agenda', 'proximas', 'imoveis', 'mais'];
const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const PRIO = { 1: 'Urgente', 2: 'Entra amanhã', 3: 'Flexível' };
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => (n < 10 ? '0' : '') + n;
const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const parse = s => { const a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); };
const mais = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const dif = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const hoje = () => iso(new Date());
const brl = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const longo = s => parse(s).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const curto = s => { const d = parse(s); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1); };
const medio = s => DSEM[parse(s).getDay()] + ', ' + curto(s);
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

let auth = null, db = null, user = null, admin = false;
let R = [], IM = [], L = [], EQ = [];
let subs = [];
let instalar = null;
// fase: config (sem Firebase), inicio (aguardando login), login, app, negado
const est = { fase: 'inicio', carregando: true, nota: '', erroLogin: '', importando: '' };
const ui = { view: 'agenda', dia: hoje(), filtro: '', feitas: false };

const imv = id => IM.find(i => i.id === id);
const nomeImv = id => { const i = imv(id); return i ? i.nome : id; };
function derivar() {
  L = R.filter(r => +r.taxa > 0 && r.co && r.ci).map(r => {
    let nx = null;
    R.forEach(o => { if (o.id !== r.id && o.imovel === r.imovel && o.ci >= r.co && (!nx || o.ci < nx)) nx = o.ci; });
    const dias = nx ? dif(r.co, nx) : null;
    return { r, id: r.id, nx, dias, p: dias === 0 ? 1 : dias === 1 ? 2 : 3, dia: r.plan || r.co, feita: !!r.feita || !!(nx && nx < hoje()) };
  });
}
const lim = id => L.find(x => x.id === id);
function quando(x) {
  if (x.p === 1) return 'Mesmo dia, entre o check-out e o check-in';
  if (x.p === 2) return 'Mesmo dia à tarde ou no dia seguinte cedo';
  return x.nx ? 'Encaixar em dia livre até ' + curto(mais(x.nx, -1)) : 'Encaixar quando a equipe tiver folga';
}
const ordem = (a, b) => (a.feita - b.feita) || (a.p - b.p) || nomeImv(a.r.imovel).localeCompare(nomeImv(b.r.imovel), 'pt-BR');
const doDia = d => L.filter(x => x.dia === d).sort(ordem);

function linha(x) {
  const r = x.r;
  const sub = x.p === 1 ? 'Próxima entrada no mesmo dia da saída (' + curto(x.nx) + ')' : x.p === 2 ? 'Próxima entrada no dia seguinte à saída (' + curto(x.nx) + ')' : x.nx ? 'Próxima entrada em ' + curto(x.nx) : 'Sem próxima reserva';
  return '<li><button class="item ' + (x.feita ? 'feita' : 'p' + x.p) + '" data-act="ver" data-id="' + esc(x.id) + '"><span class="corpo"><strong>' + esc(nomeImv(r.imovel)) + '</strong><span>Saiu: ' + esc(r.hospede || 'hóspede') + (r.n ? ' · ' + r.n + ' pessoas' : '') + '</span><span>' + sub + (r.resp ? ' · ' + esc(r.resp) : '') + '</span></span><span class="chip">' + (x.feita ? 'Feita' : PRIO[x.p]) + '</span></button></li>';
}

/* ---------- telas ---------- */
const avisos = () => est.nota ? '<div class="aviso">' + esc(est.nota) + '</div>' : '';

function telaConfig() {
  return '<div class="entrada"><h2>Falta ligar o banco de dados</h2><p>O arquivo firebase-config.js ainda está com os valores de exemplo. Cole nele a configuração do projeto Firebase e publique de novo.</p></div>';
}
function telaLogin() {
  return '<div class="entrada"><h2>Agenda de limpezas</h2><p>Entre com o e-mail e a senha cadastrados para a equipe.</p>' +
    '<form data-form="login" class="bloco"><div class="campo"><label for="lg-email">E-mail</label><input id="lg-email" name="email" type="email" autocomplete="username" required></div>' +
    '<div class="campo"><label for="lg-senha">Senha</label><input id="lg-senha" name="senha" type="password" autocomplete="current-password" required></div>' +
    (est.erroLogin ? '<div class="alerta">' + esc(est.erroLogin) + '</div>' : '') +
    '<button class="btn pri" type="submit">Entrar</button><button class="link" type="button" data-act="esqueci">Esqueci minha senha</button></form></div>';
}
function telaNegado() {
  return '<div class="entrada"><h2>Acesso ainda não liberado</h2><p>O e-mail ' + esc(user ? user.email : '') + ' não está na lista da equipe. Peça ao administrador para incluir e entre de novo.</p><button class="btn" data-act="sair">Sair</button></div>';
}
function telaAgenda() {
  const d = ui.dia, h = hoje(), ini = mais(d, -((parse(d).getDay() + 6) % 7));
  let dias = '';
  for (let i = 0; i < 7; i++) {
    const x = mais(ini, i), pd = doDia(x).filter(k => !k.feita), u = pd.some(k => k.p === 1);
    dias += '<button class="dia' + (x === d ? ' sel' : '') + (x === h ? ' hoje' : '') + (u ? ' urg' : pd.length ? ' tem' : '') + '" data-act="dia" data-d="' + x + '" aria-label="' + esc(longo(x)) + (pd.length ? ', ' + pd.length + ' limpezas pendentes' : '') + '"' + (x === d ? ' aria-current="date"' : '') + '><span>' + DSEM[parse(x).getDay()] + '</span><b>' + parse(x).getDate() + '</b><i></i></button>';
  }
  const l = doDia(d), pend = l.filter(k => !k.feita), urg = pend.filter(k => k.p === 1).length;
  const atras = L.filter(k => !k.feita && k.dia < h).length;
  let out = avisos();
  if (atras) out += '<div class="aviso urg">' + atras + (atras === 1 ? ' limpeza pendente' : ' limpezas pendentes') + ' de dias anteriores. <button data-act="ir-proximas">Ver lista</button></div>';
  out += '<div class="semana"><button class="seta" data-act="dia" data-d="' + mais(d, -7) + '" aria-label="Semana anterior">‹</button><div class="dias">' + dias + '</div><button class="seta" data-act="dia" data-d="' + mais(d, 7) + '" aria-label="Próxima semana">›</button></div>';
  out += '<div class="cab"><h2 class="cap">' + esc(longo(d)) + '</h2>' + (d !== h ? '<button class="link" data-act="dia" data-d="' + h + '">Hoje</button>' : '') + '</div>';
  if (l.length) {
    out += '<p class="resumo"><span><b>' + l.length + '</b> ' + (l.length === 1 ? 'limpeza' : 'limpezas') + '</span><span><b>' + pend.length + '</b> pendentes</span><span><b>' + brl(l.reduce((t, k) => t + (+k.r.taxa || 0), 0)) + '</b> em taxas</span></p>';
    if (urg >= 2) out += '<div class="aviso urg">' + urg + ' urgentes no mesmo dia. Escale duas equipes ou negocie check-out antecipado e check-in mais tarde.</div>';
    out += '<ol class="lista">' + l.map(linha).join('') + '</ol>';
    if (pend.length) out += '<a class="btn" href="' + esc(zapDia(d, pend)) + '" target="_blank" rel="noopener">Enviar escala do dia pelo WhatsApp</a>';
  } else {
    const prox = L.filter(k => !k.feita && k.dia > d).sort((a, b) => a.dia < b.dia ? -1 : 1)[0];
    out += '<div class="vazio">' + (est.carregando ? 'Carregando limpezas…' : !R.length ? 'Nenhuma reserva cadastrada ainda.' + (admin ? ' Importe a planilha em Mais.' : '') : 'Nenhuma limpeza neste dia.' + (prox ? ' A próxima é em ' + medio(prox.dia) + '.' : '')) + '</div>';
    if (prox) out += '<button class="btn" data-act="dia" data-d="' + prox.dia + '">Ir para a próxima limpeza</button>';
  }
  return out;
}
function zapDia(d, pend) {
  let t = 'Limpezas Emi House, ' + longo(d) + '\n';
  pend.forEach((x, i) => { t += '\n' + (i + 1) + '. ' + PRIO[x.p].toUpperCase() + ' · ' + nomeImv(x.r.imovel) + '\n' + quando(x) + (x.r.obs ? '\nObs.: ' + x.r.obs : '') + '\n'; });
  return 'https://wa.me/?text=' + encodeURIComponent(t);
}
function telaProximas() {
  const h = hoje();
  const l = L.filter(x => (ui.feitas || !x.feita) && (!ui.filtro || x.r.imovel === ui.filtro)).sort((a, b) => a.dia === b.dia ? ordem(a, b) : a.dia < b.dia ? -1 : 1);
  let out = avisos() + '<div class="filtros"><div class="campo"><label for="f-imv">Imóvel</label><select id="f-imv"><option value="">Todos</option>' + IM.map(i => '<option value="' + esc(i.id) + '"' + (i.id === ui.filtro ? ' selected' : '') + '>' + esc(i.nome) + '</option>').join('') + '</select></div><label class="marca"><input type="checkbox" id="f-feitas"' + (ui.feitas ? ' checked' : '') + '>Mostrar feitas</label></div>';
  const pend = l.filter(x => !x.feita);
  out += '<p class="resumo"><span><b>' + pend.length + '</b> pendentes</span><span><b>' + pend.filter(x => x.p === 1).length + '</b> urgentes</span><span><b>' + brl(pend.reduce((t, k) => t + (+k.r.taxa || 0), 0)) + '</b> em taxas</span></p>';
  if (!l.length) return out + '<div class="vazio">' + (est.carregando ? 'Carregando limpezas…' : 'Nenhuma limpeza nesta lista.') + '</div>';
  let ult = '';
  l.forEach(x => {
    if (x.dia !== ult) {
      if (ult) out += '</ol>';
      ult = x.dia;
      const n = l.filter(k => k.dia === x.dia).length;
      out += '<h3 class="grupo">' + esc(medio(x.dia)) + (x.dia < h ? ' · atrasada' : x.dia === h ? ' · hoje' : '') + (n > 1 ? ' · ' + n + ' saídas' : '') + '</h3><ol class="lista">';
    }
    out += linha(x);
  });
  return out + '</ol>';
}
function telaImoveis() {
  let out = avisos() + '<div class="cab"><h2>' + IM.length + ' ' + (IM.length === 1 ? 'imóvel' : 'imóveis') + '</h2>' + (admin ? '<button class="link" data-act="novo-imv">+ Novo imóvel</button>' : '') + '</div>';
  if (!IM.length) return out + '<div class="vazio">' + (est.carregando ? 'Carregando…' : 'Nenhum imóvel cadastrado.' + (admin ? ' Importe a planilha em Mais ou cadastre aqui.' : '')) + '</div>';
  return out + '<ul class="lista">' + IM.map(i => {
    const pd = L.filter(x => x.r.imovel === i.id && !x.feita).sort((a, b) => a.dia < b.dia ? -1 : 1);
    const fora = !(+i.longa > 0);
    return '<li><button class="item neutro" data-act="ver-imv" data-id="' + esc(i.id) + '"><span class="corpo"><strong>' + esc(i.nome) + '</strong><span>' + (fora ? 'Limpeza não é nossa' : pd.length ? pd.length + (pd.length === 1 ? ' limpeza pendente' : ' limpezas pendentes') + ' · próxima ' + curto(pd[0].dia) : 'Sem limpezas pendentes') + '</span></span><span class="valor">' + (fora ? '' : brl(i.longa) + (+i.curta !== +i.longa ? '<small>' + brl(i.curta) + ' até 2 noites</small>' : '')) + '</span></button></li>';
  }).join('') + '</ul>';
}
function telaMais() {
  let out = avisos();
  if (admin) {
    out += '<div class="bloco"><h3>Importar planilha</h3><p>Escolha o arquivo Reservas_Emihouse.xlsx. Reservas novas entram, as existentes são atualizadas e o que a equipe já marcou é mantido.</p>' +
      '<div class="campo"><label for="imp-arq">Arquivo .xlsx</label><input id="imp-arq" type="file" accept=".xlsx"></div>' +
      (est.importando ? '<p>' + esc(est.importando) + '</p>' : '') + '</div>';
    out += '<div class="bloco"><h3>Equipe</h3><p>Quem está nesta lista vê a agenda e marca limpezas. A pessoa também precisa de um usuário com o mesmo e-mail no Firebase (Authentication &gt; Adicionar usuário).</p>' +
      (EQ.length ? EQ.map(e => '<div class="pessoa"><span><strong>' + esc(e.nome || e.id) + '</strong>' + (e.nome ? '<br>' + esc(e.id) : '') + '</span><button data-act="pedir-tirar" data-id="' + esc(e.id) + '">Remover</button></div>').join('') : '<p>Ninguém além de você.</p>') +
      '<form data-form="equipe"><div class="duo"><div class="campo"><label for="eq-nome">Nome</label><input id="eq-nome" name="nome" required></div><div class="campo"><label for="eq-email">E-mail</label><input id="eq-email" name="email" type="email" required></div></div><button class="btn" type="submit">Adicionar à equipe</button></form></div>';
  }
  out += '<div class="bloco"><h3>Instalar no celular</h3><p>No Android (Chrome): menu de três pontos, Adicionar à tela inicial. No iPhone (Safari): botão Compartilhar, Adicionar à Tela de Início.</p>' + (instalar ? '<button class="btn pri" data-act="instalar">Instalar agora</button>' : '') + '</div>';
  out += '<div class="bloco"><h3>Conta</h3><p>' + esc(user ? user.email : '') + (admin ? ' · administrador' : '') + '</p><button class="btn" data-act="sair">Sair</button></div>';
  return out;
}
function render() {
  const m = $('main'), naApp = est.fase === 'app';
  $('nav').hidden = !naApp;
  $('fab').hidden = !(naApp && admin && ui.view !== 'imoveis' && ui.view !== 'mais');
  if (!naApp) {
    $('titulo').textContent = 'Limpezas';
    m.innerHTML = est.fase === 'config' ? telaConfig() : est.fase === 'login' ? telaLogin() : est.fase === 'negado' ? telaNegado() : '<div class="vazio">Carregando…</div>';
    return;
  }
  derivar();
  $('titulo').textContent = { agenda: 'Limpezas', proximas: 'Próximas limpezas', imoveis: 'Imóveis', mais: 'Mais' }[ui.view];
  const sc = m.scrollTop;
  m.innerHTML = ui.view === 'agenda' ? telaAgenda() : ui.view === 'proximas' ? telaProximas() : ui.view === 'imoveis' ? telaImoveis() : telaMais();
  m.scrollTop = sc;
  document.querySelectorAll('nav a').forEach(a => { if (a.dataset.v === ui.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
function rota() {
  const h = location.hash.slice(1);
  ui.view = VIEWS.includes(h) ? h : 'agenda';
  fechar(); $('main').scrollTop = 0; render();
}

/* ---------- folhas ---------- */
function abrir(titulo, html) {
  $('folha').innerHTML = '<header><h2 id="folha-t">' + esc(titulo) + '</h2><button class="fechar" data-act="fechar" aria-label="Fechar">×</button></header>' + html;
  $('folha').setAttribute('aria-labelledby', 'folha-t');
  $('fundo').hidden = false;
  const f = $('folha').querySelector('button:not(.fechar),input,select,textarea');
  if (f) f.focus();
}
function fechar() { $('fundo').hidden = true; $('folha').innerHTML = ''; }
let tt;
function toast(msg) {
  const o = document.querySelector('.toast'); if (o) o.remove();
  const e = document.createElement('div'); e.className = 'toast'; e.setAttribute('role', 'status'); e.textContent = msg;
  document.querySelector('.app').appendChild(e);
  clearTimeout(tt); tt = setTimeout(() => e.remove(), 2800);
}

function ver(id) {
  const x = lim(id); if (!x) return; const r = x.r;
  abrir(nomeImv(r.imovel), '<dl class="dados"><dt>Prioridade</dt><dd><span class="chip ' + (x.feita ? 'feita' : 'p' + x.p) + '">' + (x.feita ? 'Feita' : PRIO[x.p]) + '</span></dd><dt>Quando limpar</dt><dd>' + esc(quando(x)) + '</dd><dt>Saída</dt><dd>' + esc(longo(r.co)) + '</dd><dt>Saiu</dt><dd>' + esc(r.hospede || '') + (r.n ? ' (' + r.n + ' pessoas)' : '') + '</dd><dt>Próxima entrada</dt><dd>' + (x.nx ? esc(longo(x.nx)) + (x.dias ? ' (' + x.dias + (x.dias === 1 ? ' dia livre)' : ' dias livres)') : ' (mesmo dia)') : 'Sem reserva') + '</dd><dt>Taxa</dt><dd>' + brl(r.taxa) + ' · ' + esc(r.plat || '') + '</dd></dl>' +
    '<button class="btn ' + (x.feita ? '' : 'ok') + '" data-act="feita" data-id="' + esc(x.id) + '">' + (x.feita ? 'Desfazer: marcar como pendente' : 'Marcar limpeza como feita') + '</button>' +
    '<form data-form="plano" data-id="' + esc(x.id) + '">' +
    '<div class="duo"><div class="campo"><label for="pl-data">Limpar no dia</label><input id="pl-data" name="plan" type="date" min="' + r.co + '"' + (x.nx ? ' max="' + x.nx + '"' : '') + ' value="' + x.dia + '"></div><div class="campo"><label for="pl-resp">Responsável</label><input id="pl-resp" name="resp" value="' + esc(r.resp || '') + '" placeholder="Quem limpa"></div></div>' +
    '<div class="campo"><label for="pl-obs">Observações</label><textarea id="pl-obs" name="obs" placeholder="Chave, enxoval, reparos">' + esc(r.obs || '') + '</textarea></div>' +
    '<div id="pl-alerta"></div><button class="btn pri" type="submit">Salvar</button></form>' +
    (admin ? '<div class="acoes"><button class="btn" data-act="editar-res" data-id="' + esc(x.id) + '">Editar reserva</button><button class="btn perigo" data-act="pedir-excluir" data-id="' + esc(x.id) + '">Excluir</button></div>' : ''));
}
function taxaDe(imovel, ci, co) { const i = imv(imovel); if (!i) return 0; return (ci && co && dif(ci, co) <= 2) ? +i.curta || 0 : +i.longa || 0; }
function formRes(r) {
  const novo = !r;
  r = r || { imovel: (IM[0] || {}).id || '', plat: 'Airbnb', hospede: '', n: 2, ci: ui.dia, co: mais(ui.dia, 3), taxa: '' };
  if (novo) r.taxa = taxaDe(r.imovel, r.ci, r.co);
  abrir(novo ? 'Nova reserva' : 'Editar reserva', '<form data-form="res" data-id="' + (novo ? '' : esc(r.id)) + '">' +
    '<div class="campo"><label for="rs-imv">Imóvel</label><select id="rs-imv" name="imovel" required>' + IM.map(i => '<option value="' + esc(i.id) + '"' + (i.id === r.imovel ? ' selected' : '') + '>' + esc(i.nome) + '</option>').join('') + '</select></div>' +
    '<div class="duo"><div class="campo"><label for="rs-hosp">Hóspede</label><input id="rs-hosp" name="hospede" required value="' + esc(r.hospede) + '"></div><div class="campo"><label for="rs-n">Pessoas</label><input id="rs-n" name="n" type="number" min="1" value="' + (+r.n || 1) + '"></div></div>' +
    '<div class="duo"><div class="campo"><label for="rs-ci">Check-in</label><input id="rs-ci" name="ci" type="date" required value="' + r.ci + '"></div><div class="campo"><label for="rs-co">Check-out</label><input id="rs-co" name="co" type="date" required value="' + r.co + '"></div></div>' +
    '<div class="duo"><div class="campo"><label for="rs-plat">Plataforma</label><select id="rs-plat" name="plat">' + ['Airbnb', 'Booking.com', 'Direto'].map(p => '<option' + (p === r.plat ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div><div class="campo"><label for="rs-taxa">Taxa de limpeza (R$)</label><input id="rs-taxa" name="taxa" type="number" min="0" step="1" required value="' + (+r.taxa || 0) + '"></div></div>' +
    '<div class="campo"><small>A limpeza entra na agenda no dia do check-out. Taxa zero significa que a limpeza não é nossa.</small></div>' +
    '<div id="rs-alerta"></div><button class="btn pri" type="submit">Salvar</button></form>');
}
function formImv(i) {
  const novo = !i;
  i = i || { nome: '', longa: 250, curta: 250 };
  abrir(novo ? 'Novo imóvel' : 'Imóvel', '<form data-form="imv" data-id="' + (novo ? '' : esc(i.id)) + '">' +
    '<div class="campo"><label for="im-nome">Nome</label><input id="im-nome" name="nome" required value="' + esc(i.nome) + '"></div>' +
    '<div class="duo"><div class="campo"><label for="im-longa">Taxa de limpeza (R$)</label><input id="im-longa" name="longa" type="number" min="0" step="1" required value="' + (+i.longa || 0) + '"></div><div class="campo"><label for="im-curta">Até 2 noites (R$)</label><input id="im-curta" name="curta" type="number" min="0" step="1" required value="' + (+i.curta || 0) + '"></div></div>' +
    '<div class="campo"><small>Vale para as próximas reservas que você cadastrar. As reservas já lançadas mantêm a taxa delas.</small></div>' +
    '<button class="btn pri" type="submit">Salvar</button></form>');
}

/* ---------- gravação ---------- */
function gravar(p, msg) {
  p.then(() => { if (msg) toast(msg); }, e => toast(e && e.code === 'permission-denied' ? 'Você não tem permissão para essa alteração.' : 'Não foi possível salvar. Confira a conexão.'));
}
const limpaImv = i => ({ id: i.id, nome: i.nome, longa: +i.longa || 0, curta: +i.curta || 0, planilha: i.planilha || '' });

function enviar(f) {
  const d = {}, tipo = f.dataset.form, id = f.dataset.id;
  [...f.elements].forEach(e => { if (e.name) d[e.name] = e.value.trim(); });
  if (tipo === 'login') {
    est.erroLogin = '';
    signInWithEmailAndPassword(auth, d.email, d.senha).catch(() => { est.erroLogin = 'E-mail ou senha incorretos.'; render(); });
    return;
  }
  if (!db) return;
  if (tipo === 'plano') {
    const x = lim(id); if (!x) return;
    if (d.plan < x.r.co) { $('pl-alerta').innerHTML = '<div class="alerta">O dia da limpeza não pode ser antes da saída do hóspede (' + curto(x.r.co) + ').</div>'; return; }
    if (x.nx && d.plan > x.nx) { $('pl-alerta').innerHTML = '<div class="alerta">O próximo hóspede entra em ' + curto(x.nx) + '. Escolha um dia até essa data.</div>'; return; }
    gravar(updateDoc(doc(db, 'reservas', id), { plan: d.plan === x.r.co ? '' : d.plan, resp: d.resp, obs: d.obs }), 'Limpeza atualizada');
    fechar();
  } else if (tipo === 'res') {
    if (d.co <= d.ci) { $('rs-alerta').innerHTML = '<div class="alerta">O check-out precisa ser depois do check-in.</div>'; return; }
    const corpo = { imovel: d.imovel, plat: d.plat, hospede: d.hospede, n: +d.n || 0, ci: d.ci, co: d.co, taxa: +d.taxa || 0 };
    if (id) gravar(updateDoc(doc(db, 'reservas', id), corpo), 'Reserva salva');
    else { gravar(addDoc(collection(db, 'reservas'), { ...corpo, feita: false, plan: '', resp: '', obs: '' }), 'Reserva salva'); ui.dia = d.co; }
    fechar(); render();
  } else if (tipo === 'imv') {
    let lista = IM.map(limpaImv);
    const antigo = id ? imv(id) : null;
    const novo = limpaImv({ id: id || ('imv-' + Date.now().toString(36)), nome: d.nome, longa: d.longa, curta: d.curta, planilha: antigo ? antigo.planilha : '' });
    if (id) lista = lista.map(i => i.id === id ? novo : i); else lista.push(novo);
    gravar(setDoc(doc(db, 'config', 'imoveis'), { lista }), 'Imóvel salvo');
    fechar();
  } else if (tipo === 'equipe') {
    gravar(setDoc(doc(db, 'equipe', d.email.toLowerCase()), { nome: d.nome }), 'Pessoa adicionada');
    f.reset();
  }
}

/* ---------- importar planilha ---------- */
function carregarXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => erro(new Error('lib'));
    document.head.appendChild(s);
  });
}
function dataDe(v) {
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  if (typeof v === 'string') {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + p2(+m[2]) + '-' + p2(+m[1]);
  }
  return '';
}
function nomeCurto(longoNome) {
  const partes = String(longoNome).split('|').map(s => s.trim()).filter(Boolean);
  let n = partes[0] || String(longoNome);
  if (n.length < 8 && partes[1]) n += ' ' + partes[1];
  return n;
}
const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
async function importar(arquivo) {
  const passo = t => { est.importando = t; render(); };
  try {
    passo('Lendo a planilha…');
    const XLSX = await carregarXlsx();
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const aba = nome => { const k = wb.SheetNames.find(n => semAcento(n) === nome); return k ? XLSX.utils.sheet_to_json(wb.Sheets[k], { header: 1, raw: true, defval: null }) : null; };
    const res = aba('reservas');
    if (!res) throw new Error('A planilha não tem a aba Reservas.');
    const cab = res[0].map(semAcento), col = n => cab.findIndex(c => c === n || c.startsWith(n));
    const c = { plat: col('plataforma'), imv: col('imovel'), cod: col('codigo'), hosp: col('hospede'), st: col('status'), n: col('total hospedes'), ci: col('check-in'), co: col('check-out'), taxa: col('taxa de limpeza') };
    if (c.imv < 0 || c.ci < 0 || c.co < 0) throw new Error('Não encontrei as colunas Imovel, Check-in e Check-out na aba Reservas.');

    // Imóveis: aproveita a aba Parametros, se existir, e mantém os nomes já editados no app.
    const lista = IM.map(limpaImv);
    const porPlanilha = nome => lista.find(i => i.planilha === nome);
    const garante = (nome, longa, curta) => {
      let i = porPlanilha(nome);
      if (!i) { i = { id: slug(nome) || ('imv-' + lista.length), nome: nomeCurto(nome), longa: 0, curta: 0, planilha: nome }; while (lista.some(o => o.id === i.id)) i.id += '-2'; lista.push(i); }
      if (longa != null) i.longa = +longa || 0;
      if (curta != null) i.curta = +curta || 0;
      return i;
    };
    const par = aba('parametros');
    if (par) {
      const hi = par.findIndex(r => r && semAcento(r[0]) === 'imovel');
      if (hi >= 0) {
        const ph = par[hi].map(semAcento), cl = ph.findIndex(x => x.includes('longa')), cc = ph.findIndex(x => x.includes('curta'));
        par.slice(hi + 1).forEach(r => { if (r && r[0]) garante(String(r[0]).trim(), cl >= 0 ? r[cl] : null, cc >= 0 ? r[cc] : null); });
      }
    }
    const corte = mais(hoje(), -30);
    const docs = [];
    res.slice(1).forEach(r => {
      if (!r || !r[c.imv]) return;
      const ci = dataDe(r[c.ci]), co = dataDe(r[c.co]);
      if (!ci || !co || co < corte) return;
      if (c.st >= 0 && semAcento(r[c.st]).startsWith('cancel')) return;
      const i = garante(String(r[c.imv]).trim());
      const hosp = c.hosp >= 0 && r[c.hosp] ? String(r[c.hosp]).trim() : '';
      const cod = c.cod >= 0 && r[c.cod] ? slug(r[c.cod]) : '';
      const taxa = c.taxa >= 0 && typeof r[c.taxa] === 'number' ? r[c.taxa] : taxaDe(i.id, ci, co);
      docs.push({ id: 'r-' + (cod.length > 3 ? cod : slug(i.id + '-' + ci + '-' + hosp)), data: { imovel: i.id, plat: c.plat >= 0 && r[c.plat] ? String(r[c.plat]).trim() : '', hospede: hosp, n: c.n >= 0 ? +r[c.n] || 0 : 0, ci, co, taxa: +taxa || 0 } });
    });
    passo('Gravando ' + docs.length + ' reservas…');
    await setDoc(doc(db, 'config', 'imoveis'), { lista });
    for (let k = 0; k < docs.length; k += 400) {
      const lote = writeBatch(db);
      docs.slice(k, k + 400).forEach(d => lote.set(doc(db, 'reservas', d.id), d.data, { merge: true }));
      await lote.commit();
    }
    passo(docs.length + ' reservas importadas em ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.');
  } catch (e) {
    passo('Não deu para importar: ' + (e && e.code === 'permission-denied' ? 'sem permissão.' : e && e.message === 'lib' ? 'sem internet para carregar o leitor de planilhas.' : (e && e.message) || 'arquivo inválido.'));
  }
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  if (e.target === $('fundo')) { fechar(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  let x;
  if (act === 'fechar') fechar();
  else if (act === 'dia') { ui.dia = b.dataset.d; render(); }
  else if (act === 'ir-proximas') location.hash = 'proximas';
  else if (act === 'ver') ver(id);
  else if (act === 'nova-res') { if (!IM.length) { toast('Cadastre um imóvel primeiro.'); return; } formRes(); }
  else if (act === 'editar-res') { x = lim(id); if (x) formRes(x.r); }
  else if (act === 'novo-imv') formImv();
  else if (act === 'ver-imv') { if (admin) formImv(imv(id)); }
  else if (act === 'feita') { x = lim(id); if (!x) return; gravar(updateDoc(doc(db, 'reservas', id), { feita: !x.feita }), x.feita ? 'Marcada como pendente' : 'Limpeza feita'); fechar(); }
  else if (act === 'pedir-excluir') { x = lim(id); if (!x) return; abrir('Excluir reserva?', '<p style="margin:0">A reserva de ' + esc(x.r.hospede || 'hóspede') + ' em ' + esc(nomeImv(x.r.imovel)) + ' e a limpeza de ' + curto(x.r.co) + ' saem da agenda. Não dá para desfazer.</p><div class="acoes"><button class="btn" data-act="fechar">Cancelar</button><button class="btn perigo" data-act="excluir" data-id="' + esc(id) + '">Excluir</button></div>'); }
  else if (act === 'excluir') { gravar(deleteDoc(doc(db, 'reservas', id)), 'Reserva excluída'); fechar(); }
  else if (act === 'pedir-tirar') abrir('Remover da equipe?', '<p style="margin:0">' + esc(id) + ' deixa de ver a agenda.</p><div class="acoes"><button class="btn" data-act="fechar">Cancelar</button><button class="btn perigo" data-act="tirar" data-id="' + esc(id) + '">Remover</button></div>');
  else if (act === 'tirar') { gravar(deleteDoc(doc(db, 'equipe', id)), 'Pessoa removida'); fechar(); }
  else if (act === 'sair') signOut(auth);
  else if (act === 'esqueci') {
    const em = $('lg-email').value.trim();
    if (!em) { est.erroLogin = 'Digite seu e-mail e toque de novo em Esqueci minha senha.'; render(); return; }
    sendPasswordResetEmail(auth, em).then(() => toast('Se o e-mail estiver cadastrado, o link para criar a senha foi enviado.'), () => toast('Não foi possível enviar o e-mail agora.'));
  }
  else if (act === 'instalar' && instalar) { instalar.prompt(); instalar = null; render(); }
});
document.addEventListener('submit', e => { e.preventDefault(); if (e.target.dataset.form) enviar(e.target); });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'f-imv') { ui.filtro = t.value; render(); }
  else if (t.id === 'f-feitas') { ui.feitas = t.checked; render(); }
  else if (t.id === 'rs-imv' || t.id === 'rs-ci' || t.id === 'rs-co') $('rs-taxa').value = taxaDe($('rs-imv').value, $('rs-ci').value, $('rs-co').value);
  else if (t.id === 'imp-arq' && t.files && t.files[0]) importar(t.files[0]);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('fundo').hidden) fechar(); });
window.addEventListener('hashchange', rota);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; if (est.fase === 'app' && ui.view === 'mais') render(); });

/* ---------- dados ---------- */
function desligar() { subs.forEach(u => u()); subs = []; R = []; IM = []; EQ = []; admin = false; }
function ligar() {
  est.fase = 'app'; est.carregando = true; est.nota = '';
  const negado = e => { if (e && e.code === 'permission-denied') { desligar(); est.fase = 'negado'; } else { est.nota = 'A conexão com os dados caiu. Feche e abra o app para atualizar.'; } est.carregando = false; render(); };
  subs.push(onSnapshot(collection(db, 'reservas'), s => {
    R = s.docs.map(d => ({ ...d.data(), id: d.id }));
    est.carregando = false;
    est.nota = s.metadata.fromCache && !navigator.onLine ? 'Sem internet. Mostrando os dados salvos neste aparelho.' : '';
    render();
  }, negado));
  subs.push(onSnapshot(doc(db, 'config', 'imoveis'), s => {
    const o = s.exists() ? s.data() : null;
    IM = o && Array.isArray(o.lista) ? o.lista.slice() : [];
    render();
  }, () => {}));
  // Só o administrador consegue ler este documento (ver firestore.rules).
  getDoc(doc(db, 'admin', 'ping')).then(() => {
    admin = true;
    subs.push(onSnapshot(collection(db, 'equipe'), s => { EQ = s.docs.map(d => ({ ...d.data(), id: d.id })); render(); }, () => {}));
    render();
  }, () => { admin = false; });
}

function iniciar() {
  if (!firebaseConfig || !firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith('COLE')) { est.fase = 'config'; render(); return; }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  onAuthStateChanged(auth, u => {
    desligar(); user = u;
    if (u) ligar(); else { est.fase = 'login'; }
    rota();
  });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
rota();
iniciar();
