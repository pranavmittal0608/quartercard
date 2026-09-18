"use strict";

/* ============================================================
   CARDS & RANDOMNESS
   ============================================================ */
const SUITS = [
  {sym:"\u2660", red:false}, {sym:"\u2665", red:true},
  {sym:"\u2666", red:true},  {sym:"\u2663", red:false}
];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const TARGET = 25;

// Unbiased integer in [0,n) via rejection sampling on crypto entropy.
function randInt(n){
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return v % n;
}
function freshDeck(){
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({rank:r, suit:s.sym, red:s.red});
  // Fisher-Yates, unbiased: every one of the 52! orderings is equally likely.
  for (let i = d.length - 1; i > 0; i--){
    const j = randInt(i + 1);
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}
function cardBase(c){
  if (c.rank === "A") return 1;
  if (c.rank === "J" || c.rank === "Q" || c.rank === "K" || c.rank === "10") return 10;
  return parseInt(c.rank, 10);
}
// Every total reachable by valuing each ace as 1 or 11.
function totalsOf(cards){
  let base = 0, aces = 0;
  for (const c of cards){ base += cardBase(c); if (c.rank === "A") aces++; }
  const out = [];
  for (let i = 0; i <= aces; i++) out.push(base + i * 10);
  return out;
}
// The player picks whichever ace value suits them, so the hand is worth
// the total closest to 25; on a tie in distance, the lower (safe) one.
function bestTotal(cards){
  const ts = totalsOf(cards);
  let b = ts[0];
  for (const t of ts){
    const d = Math.abs(t - TARGET), db = Math.abs(b - TARGET);
    if (d < db || (d === db && t < b)) b = t;
  }
  return b;
}
// Only bust if even the kindest reading of the aces is over 25.
function isBust(cards){ return Math.min.apply(null, totalsOf(cards)) > TARGET; }
function distance(cards){ return Math.abs(bestTotal(cards) - TARGET); }

/* ============================================================
   STATE
   ============================================================ */
const STAKES = {
  1: {name:"Low",    ante:10, hit:2,  call:5,  pen:7, bank:200},
  2: {name:"Middle", ante:20, hit:4,  call:10, pen:14, bank:400},
  5: {name:"High",   ante:50, hit:10, call:25, pen:35, bank:1000}
};
const MAX_HITS = 4;

// Every number that means money is stamped with a chip token.
const TOK = '<i class="tok" aria-hidden="true"></i>';
function amt(n){
  return '<span class="amt">' + TOK + n + '<span class="sr-only"> chips</span></span>';
}

let G = null;
const felt = document.getElementById("felt");
const seatsEl = document.getElementById("seats");
const potEl = document.getElementById("pot");
const roundTagEl = document.getElementById("roundTag");
const deckCountEl = document.getElementById("deckCount");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const scrim = document.getElementById("scrim");
const panelHost = document.getElementById("panelHost");

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 12) : ms));

const SEATMAP = {
  2: [{x:50,y:86},{x:50,y:14}],
  3: [{x:50,y:86},{x:12,y:34},{x:88,y:34}],
  4: [{x:26,y:87},{x:9,y:34},{x:91,y:34},{x:74,y:87}]
};
const CENTRE = {x:50, y:47};

/* ============================================================
   RENDER
   ============================================================ */
function cardHTML(c, faceUp, big){
  if (!c) return "";
  const cls = "card" + (faceUp ? " up" : "") + (big ? " lg" : "");
  const red = c.red ? " red" : "";
  return '<div class="' + cls + '">' +
    '<div class="back"></div>' +
    '<div class="face' + red + '">' +
      '<div class="r">' + c.rank + '</div>' +
      '<div class="mid">' + c.suit + '</div>' +
      '<div class="s">' + c.suit + '</div>' +
    '</div></div>';
}

function statusText(html){
  statusEl.innerHTML = html;
  if (NET.role === "host") netAll({t:"status", html});
}

function log(msg, hi){
  const li = document.createElement("li");
  if (hi) li.className = "hi";
  li.innerHTML = '<span>' + (G ? "H" + G.handNo : "—") + '</span><em style="font-style:normal">' + msg + '</em>';
  logEl.appendChild(li);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
}

/* The mini log sits on the felt where everyone can see it, so it only ever
   carries what is already public: who acted, how many cards they hold, and
   how calls resolved. Never a total that has not been turned face up. */
const miniEl = document.getElementById("miniLog");
const flashEl = document.getElementById("flash");
const MINI = [];
function miniLog(msg){
  if (msg) MINI.push(msg);
  while (MINI.length > 3) MINI.shift();
  if (NET.role === "host") netAll({t:"mini", rows:MINI.slice()});
  if (!miniEl) return;
  miniEl.innerHTML = MINI.map((m, i) =>
    '<div class="mrow' + (i === MINI.length - 1 ? " now" : "") + '">' + m + '</div>'
  ).join("");
}
function clearMini(){ MINI.length = 0; if (miniEl) miniEl.innerHTML = ""; }

// A short banner across the felt for things that would otherwise pass silently.
function flash(msg, ms){
  if (NET.role === "host") netAll({t:"flash", msg});
  if (!flashEl) return Promise.resolve();
  flashEl.innerHTML = '<div class="fmsg">' + msg + '</div>';
  flashEl.classList.add("on");
  return wait(reduced ? 40 : (ms || 1250)).then(() => {
    flashEl.classList.remove("on");
    return wait(reduced ? 10 : 180);
  });
}

function render(){
  if (!G){ seatsEl.innerHTML = ""; return; }
  if (NET.role === "host") netPush();
  potEl.textContent = G.pot;
  deckCountEl.textContent = G.deck.length;
  roundTagEl.textContent = G.phase === "setup" ? "—"
    : (G.phase === "showdown" || G.phase === "handover") ? "Showdown"
    : "Round " + G.round + " of 2";

  const live = G.players.filter(p => !p.eliminated);
  const map = SEATMAP[Math.max(2, Math.min(4, live.length))] || SEATMAP[4];

  seatsEl.innerHTML = "";
  live.forEach((p, i) => {
    const pos = map[i] || CENTRE;
    p._pos = pos;
    const el = document.createElement("div");
    el.className = "seat"
      + (G.activeId === p.id && G.phase === "turn" ? " active" : "")
      + (p.out ? " folded" : "")
      + (p.isWinner ? " winner" : "");
    el.style.left = pos.x + "%";
    el.style.top = pos.y + "%";
    el.id = "seat-" + p.id;

    const showFaces = p.revealed;
    const cards = p.cards.map(c => cardHTML(c, showFaces, false)).join("");

    const pills = [];
    if (p.isBot) pills.push('<span class="pill botpill">' + BOT_LEVELS[p.botLevel].diff + '</span>');
    if (p.out) pills.push('<span class="pill bad">Called out</span>');
    else if (p.locked) pills.push('<span class="pill brass">Locked</span>');
    else if (p.stuckThisRound) pills.push('<span class="pill">Stuck</span>');
    if (p.inHand && p.hits > 0 && !p.out) pills.push('<span class="pill">' + p.hits + '/' + MAX_HITS + ' hits</span>');
    if (showFaces && !p.out){
      const t = bestTotal(p.cards);
      pills.push('<span class="pill tot ' + (isBust(p.cards) ? "bad" : "good") + '">' + t + '</span>');
    }

    el.innerHTML =
      '<div class="seatplate">' +
        '<div class="pname">' + escapeHTML(p.name) + '</div>' +
        '<div class="pchips">' + amt(p.chips) + '</div>' +
        '<div class="hand" data-hand="' + p.id + '">' + cards + '</div>' +
        '<div class="pmeta">' + pills.join("") + '</div>' +
      '</div>';
    seatsEl.appendChild(el);
  });
}
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function seatPos(p){ return p._pos || CENTRE; }

/* ============================================================
   ANIMATION
   ============================================================ */
function fly(from, to, html, dur, spin){
  return new Promise(res => {
    if (reduced){ res(); return; }
    const el = document.createElement("div");
    el.className = "flyer";
    el.innerHTML = html;
    el.style.left = from.x + "%";
    el.style.top = from.y + "%";
    el.style.transform = "translate(-50%,-50%) scale(.7)" + (spin ? " rotate(-160deg)" : "");
    felt.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "left " + dur + "ms var(--ease), top " + dur + "ms var(--ease), transform " + dur + "ms var(--ease)";
      el.style.left = to.x + "%";
      el.style.top = to.y + "%";
      el.style.transform = "translate(-50%,-50%) scale(1)" + (spin ? " rotate(0deg)" : "");
    }));
    setTimeout(() => { el.remove(); res(); }, dur + 30);
  });
}
function bumpPot(){
  potEl.classList.add("bump");
  setTimeout(() => potEl.classList.remove("bump"), 260);
}
async function dealCardTo(p, faceUp){
  const c = G.deck.pop();
  await fly(CENTRE, seatPos(p), cardHTML(c, false, false), 340);
  p.cards.push(c);
  if (faceUp) p.revealed = true;
  render();
  const hand = seatsEl.querySelector('[data-hand="' + p.id + '"]');
  if (hand && hand.lastElementChild) hand.lastElementChild.classList.add("dealt");
  deckCountEl.textContent = G.deck.length;
  return c;
}
async function chipsTo(p, amount, toCentre){
  const from = toCentre ? seatPos(p) : CENTRE;
  const to   = toCentre ? CENTRE : seatPos(p);
  await fly(from, to, '<div class="chip sm">' + amount + '</div>', 320);
  bumpPot();
}

/* ============================================================
   PANELS
   ============================================================ */
/* A result everyone is entitled to see: shown here and mirrored to every
   other screen. Only ever used once the relevant cards are already face up. */
function openPublicPanel(html, wide){
  if (NET.role === "host") netAll({t:"panel", html});
  return openPanel(html, wide);
}
function closePublicPanel(){
  if (NET.role === "host") netAll({t:"close"});
  closePanel();
}

function openPanel(html, wide){
  panelHost.innerHTML = '<div class="panel' + (wide ? " wide" : "") + '">' + html + '</div>';
  scrim.classList.add("on");
  const first = panelHost.querySelector("input, button");
  if (first) setTimeout(() => first.focus(), 60);
  return panelHost.querySelector(".panel");
}
function closePanel(){ scrim.classList.remove("on"); panelHost.innerHTML = ""; }

/* ---------- setup ---------- */
function setupPanel(){
  // Every seat starts human. Turning one over reveals its level picker.
  let seats = [{name:"", bot:false, lvl:3}, {name:"", bot:false, lvl:3}];
  let stake = 1;
  let bank = STAKES[1].bank;

  function draw(){
    const rows = seats.map((s, i) =>
      '<div class="prow">' +
        '<div class="seatno">' + (i + 1) + '</div>' +
        '<input class="inp nm" data-i="' + i + '" value="' + escapeHTML(s.name) + '" placeholder="' +
          (s.bot ? BOT_LEVELS[s.lvl].name : "Player " + (i + 1)) + '" maxlength="14">' +
        '<button class="who' + (s.bot ? " bot" : "") + '" data-who="' + i + '">' +
          (s.bot ? "Bot" : "You") + '</button>' +
        (seats.length > 2 ? '<button class="kill" data-kill="' + i + '" aria-label="Remove seat ' + (i + 1) + '">&times;</button>' : "") +
      '</div>' +
      (s.bot
        ? '<div class="lvrow">' + [1,2,3,4].map(L =>
            '<button class="lv' + (s.lvl === L ? " sel" : "") + '" data-lv="' + i + '-' + L + '">' +
              '<b>' + BOT_LEVELS[L].short + '</b><s>' + BOT_LEVELS[L].diff + '</s></button>').join("") +
          '<div class="lvhint"><b>' + BOT_LEVELS[s.lvl].name + '</b> \u00b7 ' + BOT_LEVELS[s.lvl].diff +
          ' \u2014 ' + BOT_LEVELS[s.lvl].blurb + '</div></div>'
        : "")
    ).join("");

    const stakeOpts = Object.keys(STAKES).map(k => {
      const s = STAKES[k];
      return '<button class="choice' + (String(stake) === k ? " sel" : "") + '" data-stake="' + k + '">' +
        '<b>' + amt(s.ante) + '</b><s>' + s.name + '</s></button>';
    }).join("");

    const s = STAKES[stake];
    const p = openPanel(
      '<div class="eyebrow">Table setup</div>' +
      '<h2>Take your <em>seats</em></h2>' +
      '<p>Two to four seats, at least one of them yours. I deal, hold the deck and settle every call.</p>' +
      '<div class="field"><label>Seats</label>' + rows +
        (seats.length < 4 ? '<button class="btn ghost" id="addP">Add a seat</button>' : "") +
      '</div>' +
      '<div class="field"><label>Stakes</label><div class="choices">' + stakeOpts + '</div></div>' +
      '<div class="field"><label>Starting chips each</label>' +
        '<input class="inp" id="bank" type="number" min="' + (s.ante * 4) + '" step="10" value="' + bank + '"></div>' +
      '<div class="ledger">' +
        '<div>Ante, paid after the deal<b>' + amt(s.ante) + '</b></div>' +
        '<div>Each card you take<b>' + amt(s.hit) + '</b></div>' +
        '<div>Throwing a chip to call<b>' + amt(s.call) + '</b></div>' +
        '<div>Getting a call wrong<b>' + amt(s.call + s.pen) + '</b></div>' +
      '</div>' +
      (walletEligible(seats)
        ? '<div class="lvhint" style="margin-top:10px">Buying in from your wallet' +
          (WALLET_BALANCE !== null ? ' \u00b7 you have ' + amt(WALLET_BALANCE) : '') +
          '. Whatever you leave with goes back in.</div>'
        : '<div class="lvhint" style="margin-top:10px">Free practice \u2014 these chips are ' +
          'just for this table and don\u2019t touch your wallet.</div>') +
      '<div class="err" id="err"></div>' +
      '<button class="btn" id="go">Deal the first hand</button>' +
      '<button class="btn ghost" id="back">Back</button>'
    );

    p.querySelectorAll(".nm").forEach(inp => {
      inp.addEventListener("input", e => { seats[+e.target.dataset.i].name = e.target.value; });
    });
    p.querySelectorAll("[data-who]").forEach(b => {
      b.addEventListener("click", e => {
        const i = +e.currentTarget.dataset.who;
        seats[i].bot = !seats[i].bot;
        draw();
      });
    });
    p.querySelectorAll("[data-lv]").forEach(b => {
      b.addEventListener("click", e => {
        const [i, L] = e.currentTarget.dataset.lv.split("-").map(Number);
        seats[i].lvl = L;
        draw();
      });
    });
    p.querySelectorAll("[data-kill]").forEach(b => {
      b.addEventListener("click", e => { seats.splice(+e.currentTarget.dataset.kill, 1); draw(); });
    });
    const addBtn = p.querySelector("#addP");
    if (addBtn) addBtn.addEventListener("click", () => { seats.push({name:"", bot:false, lvl:3}); draw(); });
    p.querySelectorAll("[data-stake]").forEach(b => {
      b.addEventListener("click", e => {
        stake = +e.currentTarget.dataset.stake;
        bank = STAKES[stake].bank;
        draw();
      });
    });
    p.querySelector("#bank").addEventListener("input", e => { bank = +e.target.value; });
    p.querySelector("#back").addEventListener("click", () => { closePanel(); if (!G) showLanding(); });
    p.querySelector("#go").addEventListener("click", () => {
      const err = p.querySelector("#err");
      const filled = seats.map((s, i) => ({name: s.name.trim(), bot: s.bot, lvl: s.lvl}));
      if (!filled.some(f => !f.bot)){
        err.textContent = "Somebody has to play. Keep at least one seat as yours.";
        return;
      }
      // Fill blank seats with a default, numbering them apart so three bots
      // on the same level don't all end up called the same thing.
      const used = new Set(filled.filter(f => f.name).map(f => f.name.toLowerCase()));
      filled.forEach((f, i) => {
        if (f.name) return;
        const base = f.bot ? BOT_LEVELS[f.lvl].name : "Player " + (i + 1);
        let nm = base, k = 2;
        while (used.has(nm.toLowerCase())) nm = base + " " + (k++);
        used.add(nm.toLowerCase());
        f.name = nm;
      });
      if (new Set(filled.map(f => f.name.toLowerCase())).size !== filled.length){
        err.textContent = "Two seats share a name. Give them different ones.";
        return;
      }
      const st = STAKES[stake];
      if (!(bank >= st.ante * 2)){
        err.textContent = "Starting chips must cover at least two antes (" + (st.ante * 2) + ").";
        return;
      }
      closePanel();
      pinPanel(async () => {
        if (walletEligible(filled)){
          const res = await walletBuyIn(bank);
          if (!res.ok){
            // Send them back to setup with the reason, rather than
            // silently starting an unbacked game they thought was real.
            setupPanel();
            const e2 = document.querySelector("#err");
            if (e2) e2.textContent = res.msg;
            return;
          }
        }
        startGame(filled, stake, bank);
      });
    });
  }
  draw();
}

/* ---------- rules ---------- */
function rulesPanel(){
  const s = G ? G.stakes : STAKES[1];
  const oddsRows = [15,16,17,18,19,20,21,22,23,24].map(t => {
    const c = bustChance(t);
    return '<tr><td>On ' + t + '</td><td>' +
      '<i class="bar" style="width:' + Math.round(c * 84) + 'px"></i>' +
      Math.round(c * 100) + '%</td></tr>';
  }).join("");
  const p = openPanel(
    '<div class="eyebrow">How it plays</div>' +
    '<h2>Twenty<em>·</em>Five</h2>' +
    '<div class="rules">' +
      '<h3>The hand</h3>' +
      'Two cards each, face down. <em>Then</em> everyone pays the ante. The table goes round twice, and on each ' +
      'of your two turns you may take as many cards as you like or stick — but four cards is your ceiling for the ' +
      'whole hand. Aces are 1 or 11 and you choose freely, so a hand only counts as over 25 if even the kindest ' +
      'reading of its aces goes over.' +
      '<h3>Calling</h3>' +
      'The instant someone takes a card, a window opens on them and only them. Throw a chip in to accuse them of ' +
      'being over 25. First chip counts. The accused turns their cards face up and their hand is locked at that ' +
      'total either way — they take no more cards.' +
      '<h3>The two outcomes</h3>' +
      '<em>Over 25.</em> You were right. You get your call fee back, take every chip the accused put in, and a ' +
      'bonus from the pot. They are out of the hand.<br>' +
      '<em>25 or under.</em> You were wrong. You pay ' + amt(s.call + s.pen) + ' straight to them. They stay in with ' +
      'a locked hand that everyone can now see.' +
      '<h3>Showdown</h3>' +
      'Closest to 25 takes the pot. Equal distance splits it — 24 and 26 tie. Going over does not lose you the ' +
      'showdown, so the only real punishment for busting is getting caught.' +
      '<h3>This table</h3>' +
      '<table>' +
        '<tr><td>Ante</td><td>' + amt(s.ante) + '</td></tr>' +
        '<tr><td>Each card</td><td>' + amt(s.hit) + '</td></tr>' +
        '<tr><td>To call</td><td>' + amt(s.call) + '</td></tr>' +
        '<tr><td>Wrong call</td><td>' + amt(s.call + s.pen) + '</td></tr>' +
        '<tr><td>Correct call bonus</td><td>' + amt(s.call) + '</td></tr>' +
      '</table>' +
      '<h3>Taking another card</h3>' +
      'One deck, so the odds are fixed and worth knowing. This is the chance the next card puts you over 25:' +
      '<table class="oddstable">' + oddsRows + '</table>' +
      '<h3>Running dry</h3>' +
      'One deck, reshuffled every hand. When you can no longer cover the ante you leave the table. Last player ' +
      'seated wins.' +
    '</div>' +
    '<button class="btn ghost" id="cl">Close</button>', true
  );
  p.querySelector("#cl").addEventListener("click", closePanel);
}

/* ============================================================
   GAME FLOW
   ============================================================ */
function startGame(seats, stakeKey, bank, net){
  const st = STAKES[stakeKey];
  G = {
    players: seats.map((s, i) => ({
      id: net ? (s.id || ("bot" + i)) : ("p" + i), name:s.name, chips:bank,
      isBot: !!s.bot, botLevel: s.lvl || 3,
      cards:[], hits:0, contributed:0,
      inHand:false, revealed:false, locked:false, out:false,
      stuckThisRound:false, eliminated:false, isWinner:false
    })),
    stakes:{ante:st.ante, hit:st.hit, call:st.call, pen:st.pen},
    deck:[], pot:0, round:1, handNo:0, activeId:null, phase:"setup"
  };
  logEl.innerHTML = "";
  closePanel();
  showTable();
  const bots = seats.filter(s => s.bot).length;
  log("Table opens \u2014 " + seats.length + " seats" +
    (bots ? " (" + bots + " bot" + (bots > 1 ? "s" : "") + ")" : "") +
    ", " + amt(bank) + " each.", true);
  newHand();
}

async function newHand(){
  // Anyone who cannot cover the ante leaves the table.
  G.players.forEach(p => {
    if (!p.eliminated && p.chips < G.stakes.ante){
      p.eliminated = true;
      log(p.name + " cannot cover the ante and leaves the table.", true);
    }
  });
  const live = G.players.filter(p => !p.eliminated);
  if (live.length < 2){ return gameOver(live[0]); }

  G.handNo++;
  G.round = 1;
  G.phase = "dealing";
  clearMini();
  miniLog("Hand " + G.handNo + " dealt" + (G.pot ? " \u00b7 " + G.pot + " carried in" : ""));
  G.deck = freshDeck();
  G.activeId = null;
  live.forEach(p => {
    p.cards = []; p.hits = 0; p.contributed = 0;
    p.inHand = true; p.revealed = false; p.locked = false;
    p.out = false; p.stuckThisRound = false; p.isWinner = false;
  });
  render();
  statusText("Shuffling a fresh deck\u2026");
  log("Hand " + G.handNo + " \u2014 deck shuffled.");
  await wait(500);

  // Two cards each, face down, one at a time round the table.
  statusText("Dealing.");
  for (let r = 0; r < 2; r++){
    for (const p of live){ await dealCardTo(p, false); await wait(70); }
  }
  await wait(220);

  // Antes are paid AFTER the cards are in hand.
  statusText("Antes.");
  for (const p of live){
    p.chips -= G.stakes.ante;
    p.contributed += G.stakes.ante;
    G.pot += G.stakes.ante;
    render();
    await chipsTo(p, G.stakes.ante, true);
    await wait(50);
  }
  log("Antes in \u2014 pot at " + amt(G.pot) + ".");
  render();
  await wait(260);
  beginRound();
}

function actionOrder(){
  return G.players.filter(p => !p.eliminated);
}
function canAct(p){
  return p.inHand && !p.out && !p.locked && !p.eliminated && !p.stuckThisRound && p.hits < MAX_HITS;
}

function beginRound(){
  actionOrder().forEach(p => { p.stuckThisRound = false; });
  G.phase = "turn";
  render();
  nextTurn(-1);
}

function nextTurn(fromIdx){
  const order = actionOrder();
  for (let i = fromIdx + 1; i < order.length; i++){
    if (canAct(order[i])) return takeTurn(order[i]);
  }
  // Round finished.
  if (G.round < 2){
    G.round++;
    log("Round " + G.round + " begins.");
    return beginRound();
  }
  return showdown();
}
function indexOfPlayer(p){ return actionOrder().indexOf(p); }

function takeTurn(p){
  G.phase = "turn";
  G.activeId = p.id;
  render();
  statusText("<b>" + escapeHTML(p.name) + "</b> to act.");
  if (p.isBot) return botTurn(p);
  if (NET.role === "host"){
    // Everyone has their own screen, so the pass-the-phone gate is pointless.
    for (const pid in NET.conns){
      netTo(pid, pid === p.id ? {t:"screen", kind:"hand"}
                              : {t:"screen", kind:"wait", who:p.name});
    }
    if (isRemote(p)) return closePanel();
    return handPanel(p);
  }
  gatePanel(p);
}

/* ---------- a bot takes its turn ---------- */
async function botTurn(p){
  render();
  statusText("<b>" + escapeHTML(p.name) + "</b> is thinking\u2026");
  await wait(reduced ? 20 : 560);
  if (botWantsHit(p)) return doHit(p);
  p.stuckThisRound = true;
  log(p.name + " sticks.");          // never leak the total
  miniLog(escapeHTML(p.name) + " stuck");
  render();
  nextTurn(indexOfPlayer(p));
}

/* ============================================================
   BOTS

   The four levels differ by WHAT THEY KNOW, not by how well they
   use it. None of them are careless — a level 1 bot will never
   stand on 8 or hit on 25. What falls away as you go down is the
   arithmetic behind the decision:

     4 Counter  counts every card it can legally see and works the
                real odds out of what is genuinely left in the deck
     3 Odds     knows the correct average probabilities, but does
                not adjust them for what is on the table
     2 Rules    sound rules of thumb, no probability at all
     1 Gut      a feel for the game that shifts hand to hand

   Blunders only ever fire on decisions that are already close, and
   the rate stays low. A worse bot misreads a marginal spot; it does
   not throw away an obvious one.
   ============================================================ */
const BOT_LEVELS = {
  1: {short:"Guess", name:"Guesser",      diff:"Easy",
      blurb:"goes on gut feel \u2014 no arithmetic at all"},
  2: {short:"Rules", name:"Rule Player",  diff:"Medium",
      blurb:"sound rules of thumb, but still never does the maths"},
  3: {short:"Odds",  name:"Odds Player",  diff:"Hard",
      blurb:"works out the true probability behind every decision"},
  4: {short:"Count", name:"Card Counter", diff:"Expert",
      blurb:"counts every card shown and re-reads the deck as it thins"}
};
const BLUNDER_RATE = {1:0.15, 2:0.08, 3:0.03, 4:0};

// Only flip a decision when it was nearly a coin toss anyway.
function maybeBlunder(level, margin, close, choice){
  const rate = BLUNDER_RATE[level] || 0;
  if (rate === 0 || Math.abs(margin) > close) return choice;
  return Math.random() < rate ? !choice : choice;
}

// Everything this bot is entitled to have seen: its own cards, plus any
// hand forced face up by a call. Nobody's hidden cards, ever.
function seenByBot(bot){
  const seen = bot.cards.slice();
  for (const q of G.players){
    if (q.id !== bot.id && q.revealed) seen.push.apply(seen, q.cards);
  }
  return seen;
}
// Ranks left in the pool that is unseen from this bot's seat. Drawing from
// the deck is equivalent to drawing from this pool, since the bot cannot
// tell which unseen cards sit in the stub and which sit in other hands.
function unseenPool(bot){
  const pool = {};
  for (const r of RANKS) pool[r] = 4;
  for (const c of seenByBot(bot)) if (pool[c.rank] !== undefined) pool[c.rank]--;
  return pool;
}
function fullPool(){
  const pool = {};
  for (const r of RANKS) pool[r] = 4;
  return pool;
}
// Exact one-card lookahead against a given pool.
function drawOutlook(cards, pool){
  let n = 0, bustN = 0, sumDist = 0;
  for (const r of RANKS){
    const k = pool[r];
    if (k <= 0) continue;
    const probe = cards.concat([{rank:r, suit:"\u2660", red:false}]);
    sumDist += k * distance(probe);
    if (isBust(probe)) bustN += k;
    n += k;
  }
  if (!n) return {expDist: distance(cards), pBust: 0};
  return {expDist: sumDist / n, pBust: bustN / n};
}

/* ---------- what a bot believes about the player it might call ---------- */

// Level 4: sample real hands out of the real remaining pool, keeping only
// those consistent with the fact that this player kept taking cards.
function beliefByCounting(bot, target){
  const pool = unseenPool(bot);
  const bag = [];
  for (const r of RANKS) for (let i = 0; i < pool[r]; i++) bag.push(r);
  const need = 2 + target.hits;
  if (bag.length < need) return BUST_BY_HITS ? BUST_BY_HITS[Math.min(4, target.hits)] : 0.4;

  // Players stop at different totals, and assuming a single one biases the
  // read badly: fix it at 21 and every hand where somebody pushed from 22
  // into a bust gets thrown away as "inconsistent". Sample the threshold
  // across the range real players actually use instead.
  let over = 0, under = 0, tries = 0;
  // Math.random is right here: this is the bot's private estimate, not a deal.
  // Card dealing stays on crypto entropy where fairness actually matters.
  while (over + under < 900 && tries < 7000){
    tries++;
    // partial Fisher-Yates: pull `need` distinct cards off the front
    for (let k = 0; k < need; k++){
      const j = k + Math.floor(Math.random() * (bag.length - k));
      const t = bag[k]; bag[k] = bag[j]; bag[j] = t;
    }
    const KEEP = 20 + Math.floor(Math.random() * 4);   // 20-23
    const hand = [];
    for (let k = 0; k < need; k++) hand.push({rank:bag[k], suit:"\u2660", red:false});
    // They took every one of those cards, so each earlier prefix must have
    // been a total they'd still hit on. Anything else is not this player.
    let consistent = true;
    for (let k = 2; k < need; k++){
      if (bestTotal(hand.slice(0, k)) >= KEEP){ consistent = false; break; }
    }
    if (!consistent) continue;
    if (isBust(hand)) over++; else under++;
  }
  if (over + under < 20) return BUST_BY_HITS ? BUST_BY_HITS[Math.min(4, target.hits)] : 0.4;
  return over / (over + under);
}

function botBustBelief(bot, target){
  const hits = Math.min(4, Math.max(1, target.hits));
  if (bot.botLevel === 4) return beliefByCounting(bot, target);
  if (bot.botLevel === 3) return BUST_BY_HITS ? BUST_BY_HITS[hits] : 0.4;
  return null;                     // levels 1-2 do not think in probabilities
}

/* ---------- hit or stick ---------- */
function botWantsHit(p){
  if (p.hits >= MAX_HITS || p.chips < G.stakes.hit) return false;
  const now = distance(p.cards);
  const lvl = p.botLevel;

  if (lvl === 4){
    // Only a counter tracks what the called hands actually showed. If a hand
    // is face up and closer than yours, standing pat loses to it for certain,
    // and since going over only costs you when someone calls, the card is
    // free money in expectation. Take it.
    let mustBeat = null;
    for (const q of G.players){
      if (q.id === p.id || !q.inHand || q.out || !q.revealed) continue;
      const d = distance(q.cards);
      mustBeat = (mustBeat === null) ? d : Math.min(mustBeat, d);
    }
    if (mustBeat !== null && now > mustBeat) return true;
  }

  if (lvl === 4){
    // Minimising expected distance turned out to be the wrong objective: it
    // is blind to the fact that landing exactly on 25 wins outright, so it
    // stopped a full two pips early. The sweeps put the best fixed stopping
    // point at 23, so that is the baseline -- and the counting goes into
    // shading it, by comparing the live deck against a full one.
    const live = drawOutlook(p.cards, unseenPool(p));
    const full = drawOutlook(p.cards, fullPool());
    let bar = 23;
    if (live.pBust < full.pBust - 0.06) bar = 24;      // deck ran low on tens, push on
    else if (live.pBust > full.pBust + 0.06) bar = 22; // tens still out there, ease off
    const b4 = bestTotal(p.cards);
    return maybeBlunder(4, b4 - bar, 0.6, b4 < bar);
  }

  if (lvl === 3){
    // Knows the real probabilities and plays a solid, settled line off them,
    // but plays that same line every hand rather than re-reading the deck.
    const best = bestTotal(p.cards);
    return maybeBlunder(3, best - 22, 1.2, best < 22);
  }

  if (lvl === 2){
    // A plain rule: get close to 25 and stop. Perfectly sensible, and it
    // stops a couple of pips short of where the arithmetic says to stop.
    const best = bestTotal(p.cards);
    return maybeBlunder(2, best - 21, 1.5, best < 21);
  }

  // Level 1 picks a nerve for the hand and plays to it.
  if (p._nerve === undefined || p._nerveHand !== G.handNo){
    p._nerve = 19 + randInt(6);            // 19-24
    p._nerveHand = G.handNo;
  }
  const best = bestTotal(p.cards);
  return maybeBlunder(1, best - p._nerve, 1.5, best < p._nerve);
}

/* ---------- throw a chip, or let it go ---------- */
function botWantsCall(bot, target){
  const lvl = bot.botLevel;
  const hits = Math.min(4, Math.max(1, target.hits));

  if (lvl >= 3){
    const p = botBustBelief(bot, target);
    const win = Math.min(G.pot, target.contributed + G.stakes.call);
    const lose = G.stakes.call + G.stakes.pen;
    // Only the Counter prices the new rule properly. A wrong call no longer
    // just costs the fee, it kills the hand: the pot survives to the next
    // deal, so what you really give up is the edge you had in this one --
    // the gap between your equity in a hand you like and an even split of
    // the same money next time round. The Odds Player sees the chips and
    // stops there; this is the layer above the arithmetic.
    let ev;
    if (lvl === 4){
      const live = G.players.filter(q => q.inHand && !q.out && !q.eliminated).length || 1;
      const mine = distance(bot.cards);
      const standing = mine <= 1 ? 0.55 : mine <= 3 ? 0.35 : mine <= 6 ? 0.20 : 0.10;
      const forfeited = Math.max(0, standing - 1 / live) * G.pot;
      ev = p * win - (1 - p) * (lose + forfeited);
    } else {
      ev = p * win - (1 - p) * lose;
    }
    return maybeBlunder(lvl, ev, 2.5, ev > 0);
  }

  if (lvl === 2){
    // No arithmetic — just the sound rule that three cards is a lot of cards.
    const want = hits >= 3;
    return maybeBlunder(2, hits - 2.5, 0.6, want);
  }

  // Level 1 gets suspicious as the pile grows, without ever pricing it.
  // The shape is roughly right and the calibration is not.
  const feel = {1:0.07, 2:0.24, 3:0.44, 4:0.58}[hits];
  return Math.random() < feel;
}


function gatePanel(p){
  const panel = openPanel(
    '<div class="eyebrow">Round ' + G.round + ' of 2</div>' +
    '<h2>Pass to <em>' + escapeHTML(p.name) + '</em></h2>' +
    '<p>Hold the screen so nobody else can see it. Your cards are yours alone until someone makes you show them.</p>' +
    '<button class="btn" id="ok">I\u2019m ' + escapeHTML(p.name) + ' \u2014 show my hand</button>'
  );
  panel.querySelector("#ok").addEventListener("click", () => handPanel(p));
}

/* ---------- private hand + hit/stick ---------- */
function handPanel(p){
  const totals = totalsOf(p.cards);
  const best = bestTotal(p.cards);
  const over = isBust(p.cards);
  const altLine = totals.length > 1
    ? "Your aces let this read as " + totals.join(" or ") + "."
    : "";
  const canHit = p.hits < MAX_HITS && p.chips >= G.stakes.hit;
  let why = "";
  if (p.hits >= MAX_HITS) why = "You have taken your four cards for this hand.";
  else if (p.chips < G.stakes.hit) why = "Not enough chips to take another card.";

  const panel = openPanel(
    '<div class="eyebrow">' + escapeHTML(p.name) + ' \u00b7 ' + amt(p.chips) + ' \u00b7 ' + p.hits + '/' + MAX_HITS + ' cards taken</div>' +
    '<h2>Your <em>hand</em></h2>' +
    '<div class="privhand">' + p.cards.map(c => cardHTML(c, true, true)).join("") + '</div>' +
    '<div class="bigtot' + (over ? " over" : "") + '">' +
      '<div class="n">' + best + '</div>' +
      '<div class="l">' + (over ? "Over 25 \u2014 you can be called" : distance(p.cards) + " from 25") + '</div>' +
      (altLine ? '<div class="alt">' + altLine + '</div>' : "") +
    '</div>' +
    '<div class="btnrow">' +
      '<button class="btn ghost" id="stick">Stick</button>' +
      '<button class="btn" id="hit"' + (canHit ? "" : " disabled") + '>Take a card \u00b7 ' + amt(G.stakes.hit) + '</button>' +
    '</div>' +
    (why ? '<div class="err">' + why + '</div>' : '')
  );
  panel.querySelector("#stick").addEventListener("click", () => {
    closePanel();
    if (NET.role === "guest"){ statusText("Sticking\u2026"); return NET.conn.send({t:"act", a:"stick"}); }
    p.stuckThisRound = true;
    log(p.name + " sticks.");
    miniLog(escapeHTML(p.name) + " stuck");
    render();
    nextTurn(indexOfPlayer(p));
  });
  const hitBtn = panel.querySelector("#hit");
  if (canHit) hitBtn.addEventListener("click", () => {
    if (NET.role === "guest"){ closePanel(); statusText("Taking a card\u2026"); return NET.conn.send({t:"act", a:"hit"}); }
    doHit(p);
  });
}

async function doHit(p){
  closePanel();
  p.chips -= G.stakes.hit;
  p.contributed += G.stakes.hit;
  p.hits++;
  G.pot += G.stakes.hit;
  render();
  statusText("<b>" + escapeHTML(p.name) + "</b> takes a card.");
  await chipsTo(p, G.stakes.hit, true);
  await dealCardTo(p, false);
  log(p.name + " takes card " + p.hits + ".");
  miniLog(escapeHTML(p.name) + " took card " + p.hits);
  await wait(200);
  openCallWindow(p);
}

/* ---------- the call window ---------- */
function eligibleCallers(hitter){
  const need = G.stakes.call + G.stakes.pen;
  return G.players.filter(q =>
    !q.eliminated && q.inHand && !q.out && q.id !== hitter.id && q.chips >= need
  );
}

function openCallWindow(hitter){
  const callers = eligibleCallers(hitter);
  if (callers.length === 0){
    log("No one can afford to call.");
    return afterHit(hitter);
  }
  if (NET.role === "host") return openCallWindowNet(hitter, callers);
  const humans = callers.filter(q => !q.isBot);
  const bots   = callers.filter(q => q.isBot);

  // Nobody at the table has a decision to make by hand — let it play itself out.
  if (humans.length === 0) return autoCallWindow(hitter, bots);

  G.phase = "call";
  render();
  statusText("Call window open on <b>" + escapeHTML(hitter.name) + "</b>.");

  const cost = G.stakes.call + G.stakes.pen;
  const picked = new Set();

  function rowsHTML(){
    return humans.map(q =>
      '<button class="callbtn' + (picked.has(q.id) ? " picked" : "") + '" data-caller="' + q.id + '">' +
        '<b>' + escapeHTML(q.name) + '</b>' +
        '<s>' + (picked.has(q.id) ? "Chip\u2019s in \u2014 tap to take it back" : amt(G.stakes.call) + " to call") + '</s>' +
      '</button>'
    ).join("");
  }
  function goLabel(){
    if (picked.size === 0) return bots.length ? "Nobody here calls" : "Nobody calls";
    if (picked.size === 1) return "Throw the chip";
    return "Settle it \u2014 " + picked.size + " chips in";
  }

  const panel = openPanel(
    '<div class="eyebrow">Card ' + hitter.hits + ' of ' + MAX_HITS + '</div>' +
    '<h2><em>' + escapeHTML(hitter.name) + '</em> just took a card</h2>' +
    '<p>Anyone who thinks they\u2019re over 25 can throw a chip in \u2014 tap every name that wants to call, then ' +
      'settle it. Get it right and take their stake plus a bonus \u2014 shared if more than one of you throws in. ' +
      'Get it wrong and pay ' + amt(cost) + ' to them, same way.</p>' +
    '<div class="callgrid" id="callRows">' + rowsHTML() + '</div>' +
    (bots.length
      ? '<div class="botnote">' + bots.map(q => escapeHTML(q.name)).join(", ") +
        (bots.length > 1 ? ' decide' : ' decides') + ' at the same time you do \u2014 you\u2019ll see it when you settle.</div>'
      : "") +
    '<button class="btn ghost" id="goCall">' + goLabel() + '</button>'
  );

  const rowsEl = panel.querySelector("#callRows");
  const goBtn = panel.querySelector("#goCall");

  function wireRows(){
    rowsEl.querySelectorAll("[data-caller]").forEach(b => {
      b.addEventListener("click", e => {
        const id = e.currentTarget.dataset.caller;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        rowsEl.innerHTML = rowsHTML();
        goBtn.textContent = goLabel();
        goBtn.classList.toggle("ghost", picked.size === 0);
        wireRows();
      });
    });
  }
  wireRows();

  goBtn.addEventListener("click", () => {
    closePanel();
    // Bots are asked only now, so nobody gets to read their chips first.
    const botCallers = bots.filter(q => botWantsCall(q, hitter));
    const chosen = callers.filter(q => picked.has(q.id) || botCallers.indexOf(q) !== -1);
    if (chosen.length === 0){
      log("No call \u2014 " + hitter.name + " is left alone.");
      miniLog("Nobody called " + escapeHTML(hitter.name));
      return flash("Nobody called").then(() => afterHit(hitter));
    }
    resolveCall(chosen, hitter);
  });
}

/* In a lobby every human sits behind their own screen, so the call window
   goes out to each of them at once and nobody sees another player's chip
   before committing their own. Bots are asked only when the last human has
   answered, for the same reason. */
function openCallWindowNet(hitter, callers){
  const humans = callers.filter(q => !q.isBot);
  const bots   = callers.filter(q => q.isBot);
  if (!humans.length) return autoCallWindow(hitter, bots);

  G.phase = "call";
  render();
  statusText("Call window open on <b>" + escapeHTML(hitter.name) + "</b>.");

  NET.pendingCall = {
    hitter, callers, bots,
    need: new Set(humans.map(q => q.id)),
    picked: new Set()
  };
  humans.forEach(q => {
    if (isRemote(q)) netTo(q.id, {t:"screen", kind:"call", hitter:hitter.name, hits:hitter.hits});
    else callChoicePanel(hitter.name, hitter.hits, yes => callChoiceIn(q, yes));
  });
}
function callChoiceIn(p, yes){
  const pc = NET.pendingCall;
  if (!pc || !pc.need.has(p.id)) return;
  pc.need.delete(p.id);
  if (yes) pc.picked.add(p.id);
  if (pc.need.size) return;                       // still waiting on someone
  NET.pendingCall = null;
  const botCallers = pc.bots.filter(q => botWantsCall(q, pc.hitter));
  const chosen = pc.callers.filter(q => pc.picked.has(q.id) || botCallers.indexOf(q) !== -1);
  if (!chosen.length){
    log("No call \u2014 " + pc.hitter.name + " is left alone.");
    miniLog("Nobody called " + escapeHTML(pc.hitter.name));
    return flash("Nobody called").then(() => afterHit(pc.hitter));
  }
  resolveCall(chosen, pc.hitter);
}

/* Every eligible caller is a bot, so there is nothing to tap. */
async function autoCallWindow(hitter, bots){
  G.phase = "call";
  render();
  statusText("The table looks hard at <b>" + escapeHTML(hitter.name) + "</b>\u2026");
  await wait(reduced ? 20 : 780);
  const chosen = bots.filter(q => botWantsCall(q, hitter));
  if (chosen.length === 0){
    log("Nobody calls \u2014 " + hitter.name + " is left alone.");
    miniLog("Nobody called " + escapeHTML(hitter.name));
    await flash("Nobody called");
    return afterHit(hitter);
  }
  return resolveCall(chosen, hitter);
}

function afterHit(p){
  G.phase = "turn";
  render();
  if (p.hits >= MAX_HITS){
    log(p.name + " has taken all four cards.");
    p.stuckThisRound = true;
    return nextTurn(indexOfPlayer(p));
  }
  // Same player keeps the turn — they may take another card or stick.
  if (p.isBot) return botTurn(p);
  handPanel(p);
}

/* ---------- resolving a call ---------- */
async function resolveCall(callers, accused){
  G.phase = "callresolve";
  const n = callers.length;
  const names = callers.map(c => c.name);
  const namesHTML = names.map(escapeHTML).join(", ");

  statusText(n > 1
    ? "<b>" + namesHTML + "</b> all call <b>" + escapeHTML(accused.name) + "</b>."
    : "<b>" + escapeHTML(callers[0].name) + "</b> calls <b>" + escapeHTML(accused.name) + "</b>.");
  log((n > 1 ? names.join(", ") + " all throw chips at " : names[0] + " throws a chip at ") + accused.name + ".", true);

  // Chips fly in from everyone who called, landing together.
  await Promise.all(callers.map((c, i) =>
    wait(i * 90).then(() => fly(seatPos(c), seatPos(accused),
      '<div class="chip">' + G.stakes.call + '</div>', 620, true))
  ));
  if (!reduced){
    const sw = document.createElement("div");
    sw.className = "shockwave";
    sw.style.left = seatPos(accused).x + "%";
    sw.style.top = seatPos(accused).y + "%";
    felt.appendChild(sw);
    const seatEl = document.getElementById("seat-" + accused.id);
    if (seatEl) seatEl.classList.add("struck");
    setTimeout(() => sw.remove(), 720);
    await wait(360);
  }

  // Cards go face up. The hand is locked either way.
  accused.revealed = true;
  accused.locked = true;
  render();
  await wait(reduced ? 10 : 620);

  const bust = isBust(accused.cards);
  const total = bestTotal(accused.cards);
  const stakes = G.stakes;

  // A group calling together is treated as one call whose result is split
  // n ways — the same total moves as a single caller would have moved,
  // so throwing in with others divides the outcome rather than multiplying it.
  let ledger;
  if (bust){
    const take = Math.min(G.pot, accused.contributed + stakes.call); // their stake + bonus
    G.pot -= take;
    const share = Math.floor(take / n);
    let rem = take - share * n;
    callers.forEach((c, i) => { c.chips += share + (i < rem ? 1 : 0); });
    accused.out = true;
    accused.inHand = false;
    log(accused.name + " was on " + total + " \u2014 call good. " +
      (n > 1 ? names.join(", ") + " split " + amt(take) + "." : names[0] + " takes " + amt(take) + ".") , true);
    miniLog(namesHTML + " caught " + escapeHTML(accused.name) + " on " + total);
    ledger =
      '<div class="ledger">' +
        '<div>' + escapeHTML(accused.name) + '\u2019s total<b class="dn">' + total + '</b></div>' +
        callers.map((c, i) =>
          '<div>' + escapeHTML(c.name) + ' collects<b class="up">+' + amt(share + (i < rem ? 1 : 0)) + '</b></div>'
        ).join("") +
        '<div>Remaining pot<b>' + amt(G.pot) + '</b></div>' +
      '</div>';
  } else {
    const cost = stakes.call + stakes.pen;
    const share = Math.floor(cost / n);
    let rem = cost - share * n;
    callers.forEach((c, i) => { c.chips -= share + (i < rem ? 1 : 0); });
    accused.chips += cost;
    log(accused.name + " was on " + total + " \u2014 call wrong. " +
      (n > 1 ? names.join(", ") + " split paying " + amt(cost) + "." : names[0] + " pays " + amt(cost) + ".") , true);
    miniLog(namesHTML + " called " + escapeHTML(accused.name) + " wrong \u2014 he was on " + total);
    ledger =
      '<div class="ledger">' +
        '<div>' + escapeHTML(accused.name) + '\u2019s total<b class="up">' + total + '</b></div>' +
        callers.map((c, i) =>
          '<div>' + escapeHTML(c.name) + ' pays<b class="dn">\u2212' + amt(share + (i < rem ? 1 : 0)) + '</b></div>'
        ).join("") +
        '<div>' + escapeHTML(accused.name) + ' receives<b class="up">+' + amt(cost) + '</b></div>' +
        '<div>Pot carried over<b>' + amt(G.pot) + '</b></div>' +
      '</div>';
  }
  render();

  const panel = openPublicPanel(
    '<div class="verdict ' + (bust ? "good" : "bad") + '">' +
      '<div class="stamp">' + (bust ? "Caught" : "Wrong call") + '</div>' +
      '<div class="sub">' +
        (bust
          ? escapeHTML(accused.name) + " was over 25 and is out of the hand."
          : escapeHTML(accused.name) + " was good all along. The hand dies here \u2014 " +
            amt(G.pot) + " stays on the table for the next one.") +
      '</div>' +
    '</div>' +
    '<div class="privhand">' + accused.cards.map(c => cardHTML(c, true, true)).join("") + '</div>' +
    ledger +
    '<button class="btn" id="ok">' + (bust ? "Carry on" : "Deal a new hand") + '</button>'
  );
  panel.querySelector("#ok").addEventListener("click", () => {
    closePublicPanel();
    if (!bust){
      // A wrong call kills the hand outright. Nobody won it, so the pot
      // stays where it is and rides on the next deal.
      miniLog("Hand ended \u2014 wrong call. Pot carries: " + G.pot);
      log("The hand is dead. " + amt(G.pot) + " carries over.", true);
      G.phase = "handover";
      G.activeId = null;
      render();
      return newHand();
    }
    // The accused was the one hitting, so their turn is over either way.
    accused.stuckThisRound = true;
    G.phase = "turn";
    render();
    const remaining = G.players.filter(p => !p.eliminated && p.inHand && !p.out);
    if (remaining.length <= 1) return showdown();
    nextTurn(indexOfPlayer(accused));
  });
}

/* ---------- showdown ---------- */
async function showdown(){
  G.phase = "showdown";
  G.activeId = null;
  render();
  const contenders = G.players.filter(p => !p.eliminated && p.inHand && !p.out);

  statusText("Showdown.");
  for (const p of contenders){
    if (!p.revealed){ p.revealed = true; render(); await wait(reduced ? 8 : 380); }
  }
  await wait(300);

  if (contenders.length === 0){
    log("Nobody left standing \u2014 the pot carries over.", true);
    return handOverPanel([], 0, true);
  }

  let bestDist = Infinity;
  contenders.forEach(p => { bestDist = Math.min(bestDist, distance(p.cards)); });
  const winners = contenders.filter(p => distance(p.cards) === bestDist);

  const share = Math.floor(G.pot / winners.length);
  let rem = G.pot - share * winners.length;
  const paid = G.pot;
  winners.forEach((p, i) => {
    p.chips += share + (i < rem ? 1 : 0);
    p.isWinner = true;
  });
  G.pot = 0;
  render();

  for (const w of winners) await chipsTo(w, share, false);
  render();

  const names = winners.map(w => w.name).join(" and ");
  log(names + " " + (winners.length > 1 ? "split" : "takes") + " " + amt(paid) + " with " + bestTotal(winners[0].cards) + ".", true);
  statusText(winners.length > 1 ? "<b>" + escapeHTML(names) + "</b> split the pot." : "<b>" + escapeHTML(names) + "</b> takes the pot.");
  await wait(500);
  handOverPanel(winners, paid, false);
}

function handOverPanel(winners, paid, carried){
  const contenders = G.players.filter(p => !p.eliminated && p.inHand && !p.out);
  const rows = contenders
    .slice()
    .sort((a, b) => distance(a.cards) - distance(b.cards))
    .map(p => {
      const t = bestTotal(p.cards);
      const d = distance(p.cards);
      const win = p.isWinner;
      return '<div><span>' + escapeHTML(p.name) + (win ? ' \u2605' : '') + '</span>' +
        '<b class="' + (win ? "up" : "") + '">' + t + ' <s style="text-decoration:none;color:var(--mist-dim);font-size:11px">(' + d + ' off)</s></b></div>';
    }).join("");

  const outs = G.players.filter(p => !p.eliminated && p.out)
    .map(p => '<div><span>' + escapeHTML(p.name) + '</span><b class="dn">called out</b></div>').join("");

  const stacks = G.players.filter(p => !p.eliminated)
    .map(p => '<div><span>' + escapeHTML(p.name) + '</span><b>' + amt(p.chips) + '</b></div>').join("");

  const title = carried
    ? "Pot <em>carries</em>"
    : (winners.length > 1 ? "A <em>split</em>" : "<em>" + escapeHTML(winners[0].name) + "</em> takes it");

  const panel = openPublicPanel(
    '<div class="eyebrow">Hand ' + G.handNo + ' \u00b7 showdown</div>' +
    '<h2>' + title + '</h2>' +
    (carried ? '<p>Everyone still in the hand was called out. The pot stays on the table for the next deal.</p>'
             : '<p>' + (winners.length > 1
                ? "Level distance from 25, so they share " + amt(paid) + "."
                : escapeHTML(winners[0].name) + " was " + distance(winners[0].cards) + " from 25 and takes " + amt(paid) + ".") + '</p>') +
    '<div class="eyebrow" style="margin-top:14px">At the showdown</div>' +
    '<div class="ledger">' + rows + outs + '</div>' +
    '<div class="eyebrow" style="margin-top:18px">Chip stacks</div>' +
    '<div class="ledger">' + stacks + '</div>' +
    '<button class="btn" id="next">Deal the next hand</button>'
  );
  panel.querySelector("#next").addEventListener("click", () => {
    closePublicPanel();
    G.players.forEach(p => { p.isWinner = false; p.inHand = false; });
    render();
    newHand();
  });
}

function gameOver(winner){
  G.phase = "over";
  G.activeId = null;
  if (winner) winner.isWinner = true;
  render();
  statusText(winner ? "<b>" + escapeHTML(winner.name) + "</b> owns the table." : "Table closed.");
  log((winner ? winner.name + " wins the table with " + amt(winner.chips) + "." : "Table closed."), true);
  const panel = openPublicPanel(
    '<div class="eyebrow">Table closed \u00b7 ' + G.handNo + ' hands</div>' +
    '<h2><em>' + escapeHTML(winner ? winner.name : "Nobody") + '</em> wins the table</h2>' +
    '<p>Everyone else ran out of chips to cover the ante.</p>' +
    '<div class="ledger"><div><span>Final stack</span><b class="up">' + amt(winner ? winner.chips : 0) + '</b></div>' +
      '<div><span>Hands played</span><b>' + G.handNo + '</b></div></div>' +
    '<button class="btn" id="again">Set up a new table</button>'
  );
  panel.querySelector("#again").addEventListener("click", async () => {
    await walletCashOut();
    closePanel(); G = null; render(); potEl.textContent = "0";
    roundTagEl.textContent = "\u2014"; deckCountEl.textContent = "52";
    showLanding();
  });
}

/* ============================================================
   ODDS
   ============================================================ */
// Chance the next card takes you over 25, from the full deck.
// Aces count as 1 when you need them to, so they never bust you below 25.
function bustChance(total){
  const room = TARGET - total;
  let bad = 0;
  for (const r of RANKS){
    const v = (r === "A") ? 1 : (r === "10" || r === "J" || r === "Q" || r === "K") ? 10 : parseInt(r, 10);
    if (v > room) bad += 4;
  }
  return bad / 52;
}

/* ============================================================
   LANDING — hero
   ============================================================ */
const landing = document.getElementById("landing");
const tableview = document.getElementById("tableview");
const resetBtn = document.getElementById("resetBtn");

// Find a real hand from a real deck that lands on exactly 25.
function exactTwentyFive(){
  for (let i = 0; i < 6000; i++){
    const d = freshDeck();
    const n = 3 + randInt(2);
    const c = d.slice(0, n);
    if (bestTotal(c) === 25) return c;
  }
  return [{rank:"K",suit:"\u2660",red:false},{rank:"9",suit:"\u2665",red:true},{rank:"6",suit:"\u2663",red:false}];
}

let heroBusy = false;
async function playHero(){
  if (heroBusy) return;
  heroBusy = true;
  const wrap = document.getElementById("heroCards");
  const tot = document.getElementById("heroTotal");
  const cards = exactTwentyFive();
  wrap.innerHTML = "";
  tot.textContent = "—";

  const els = cards.map(c => {
    const d = document.createElement("div");
    d.innerHTML = cardHTML(c, false, true);
    const el = d.firstElementChild;
    wrap.appendChild(el);
    return el;
  });

  for (let i = 0; i < els.length; i++){
    els[i].classList.add("in");
    await wait(reduced ? 8 : 190);
  }
  await wait(reduced ? 8 : 200);
  for (let i = 0; i < els.length; i++){
    els[i].classList.add("up");
    await wait(reduced ? 8 : 230);
    tot.textContent = bestTotal(cards.slice(0, i + 1));
  }
  tot.classList.add("hit");
  setTimeout(() => tot.classList.remove("hit"), 700);
  heroBusy = false;
}

/* ============================================================
   LANDING — the call trainer
   ============================================================ */
// A cheap deck for simulation only. Real deals always use freshDeck.
function simCards(n){
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({rank:r, suit:s.sym, red:s.red});
  for (let i = 0; i < n; i++){
    const j = i + Math.floor(Math.random() * (52 - i));
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d.slice(0, n);
}
// A plausible opponent playing the real structure: two rounds, four cards max,
// nerve that varies. Records which round each card was taken in.
function playOut(draw){
  const c = [draw[0], draw[1]];
  const rounds = [];
  const nerve = 20 + Math.floor(Math.random() * 4);   // stops somewhere in 20-23
  let hits = 0;
  for (let round = 1; round <= 2 && hits < MAX_HITS; round++){
    // Each round they take at least one card unless they are already content.
    let tookThisRound = 0;
    while (hits < MAX_HITS){
      if (bestTotal(c) >= nerve) break;
      if (tookThisRound > 0 && Math.random() < 0.45) break;   // often spread across rounds
      c.push(draw[2 + hits]);
      hits++; tookThisRound++;
      rounds.push(round);
      if (Math.random() < 0.12) break;                        // sometimes just stops
    }
    if (hits === 0 && round === 2) {                          // the window only opens on a hit
      c.push(draw[2]); hits++; rounds.push(2);
    }
  }
  if (hits === 0){ c.push(draw[2]); hits = 1; rounds.push(1); }
  return {cards:c, hits:hits, rounds:rounds};
}

// How often a player is ACTUALLY over 25 at the moment the call window opens.
// Measured mid-hand, at a random one of their hits, exactly as the trainer presents it.
let BUST_BY_HITS = null;
function buildOdds(){
  const tally = {1:[0,0], 2:[0,0], 3:[0,0], 4:[0,0]};
  for (let i = 0; i < 60000; i++){
    const full = playOut(simCards(6));
    const at = 1 + Math.floor(Math.random() * full.hits);
    const snapshot = full.cards.slice(0, 2 + at);
    const t = tally[at];
    t[1]++;
    if (isBust(snapshot)) t[0]++;
  }
  BUST_BY_HITS = {};
  for (const k in tally) BUST_BY_HITS[k] = tally[k][1] ? tally[k][0] / tally[k][1] : 0;
}

const TS = STAKES[1];                 // the trainer plays the low-stakes table
const T = {hand:null, net:0, sharp:0, hands:0, phase:"deciding", blind:false};
const tHand   = document.getElementById("tHand");
const tTrace  = document.getElementById("tTrace");
const tStamp  = document.getElementById("tStamp");
const tSub    = document.getElementById("tSub");
const tOdds   = document.getElementById("tOdds");
const tDecide = document.getElementById("tDecide");
const tNext   = document.getElementById("tNext");

// What a correct call is worth against someone who has taken n cards,
// and what a wrong one costs. Straight from the table's own fee scale.
function callWin(n){ return TS.ante + TS.hit * n + TS.call; }
function callLose(){ return TS.call + TS.pen; }
function callEV(n, p){ return p * callWin(n) - (1 - p) * callLose(); }

function trainerDeal(){
  const d = freshDeck();
  const full = playOut(d);
  // You judge someone mid-hand, not at the end. Freeze the hand at a
  // random one of their hits — that is the moment the window actually opens.
  const at = 1 + randInt(full.hits);
  T.hand = {
    cards: full.cards.slice(0, 2 + at),
    taken: at,
    round: full.rounds[at - 1]
  };
  T.phase = "deciding";
  tDecide.hidden = false;
  tNext.hidden = true;

  tHand.innerHTML = T.hand.cards.map(c => cardHTML(c, false, true)).join("");
  Array.from(tHand.children).forEach((el, i) => setTimeout(() => el.classList.add("dealt"), i * 55));

  const r1 = T.hand.round === 1 ? T.hand.taken : full.rounds.filter(r => r === 1).length;
  const r2 = T.hand.round === 2 ? T.hand.taken - r1 : 0;
  tTrace.innerHTML =
    '<span class="tpill">Round ' + T.hand.round + '</span>' +
    '<span class="tpill">Round 1: ' + r1 + (r1 === 1 ? ' card' : ' cards') + '</span>' +
    (T.hand.round === 2 ? '<span class="tpill live">Round 2: ' + r2 + (r2 === 1 ? ' card' : ' cards') + '</span>' : '') +
    '<span class="tpill live">Just took one</span>';

  tStamp.textContent = "";
  tStamp.className = "tstamp";
  tSub.textContent = "Make the call.";
  showOdds();
}

function showOdds(){
  if (!T.hand){ tOdds.innerHTML = ""; return; }
  if (T.blind && T.phase === "deciding"){
    tOdds.innerHTML = '<em>Odds hidden.</em> Go on the read alone — the numbers come back after you decide.';
    return;
  }
  if (!BUST_BY_HITS){ tOdds.innerHTML = "Working out the odds…"; return; }
  const n = T.hand.taken;
  const p = BUST_BY_HITS[n] || 0;
  const ev = callEV(n, p);
  const good = ev > 0;
  tOdds.innerHTML =
    'Someone ' + n + (n === 1 ? " card" : " cards") + ' in is over 25 <b>' + Math.round(p * 100) + '%</b> of the time. ' +
    'A correct call here pays ' + amt(callWin(n)) + ', a wrong one costs ' + amt(callLose()) + ' — so calling is worth ' +
    '<b style="color:' + (good ? "var(--ok)" : "var(--bad)") + '">' + (ev >= 0 ? "+" : "−") + Math.abs(ev).toFixed(1) +
    ' chips</b> on average. ' + (good ? "Throw the chip." : "Leave it.");
}

function trainerAnswer(called){
  if (T.phase !== "deciding" || !T.hand) return;
  T.phase = "revealed";
  tDecide.hidden = true;
  tNext.hidden = false;
  Array.from(tHand.children).forEach((el, i) => setTimeout(() => el.classList.add("up"), i * 85));

  const over  = isBust(T.hand.cards);
  const total = bestTotal(T.hand.cards);
  const n     = T.hand.taken;
  const p     = BUST_BY_HITS ? (BUST_BY_HITS[n] || 0) : 0;
  const ev    = callEV(n, p);

  // What it actually cost or paid you this hand.
  const swing = called ? (over ? callWin(n) : -callLose()) : 0;
  T.net += swing;
  T.hands++;
  // Separately: was the decision itself correct, whatever the cards did?
  const wise = (ev > 0) === called;
  if (wise) T.sharp++;

  tStamp.textContent = called
    ? (over ? "Caught them" : "Wrong call")
    : (over ? "They slipped away" : "Good hold");
  tStamp.className = "tstamp " + (swing > 0 ? "good" : swing < 0 ? "bad" : "flat");

  const line = called
    ? (over ? "You take " + amt(callWin(n)) + " off them."
            : "That costs you " + amt(callLose()) + ", straight into their stack.")
    : (over ? "They were over and nobody made them pay." : "Nothing lost.");

  tSub.innerHTML =
    'They were on <b style="color:var(--bone);font-weight:400">' + total + '</b>' +
    (over ? " — over the line. " : " — safe. ") + line +
    '<br><span class="' + (wise ? "wise" : "unwise") + '">' +
      (wise ? "✓ Right decision" : "✗ Wrong decision") + ' — the odds made calling worth ' +
      (ev >= 0 ? "+" : "−") + Math.abs(ev).toFixed(1) + ' chips' +
      (wise && swing < 0 ? ", so the cards just beat you." : wise && swing === 0 && over ? ", so passing was still right." : ".") +
    '</span>';

  const net = document.getElementById("tNet");
  net.textContent = (T.net > 0 ? "+" : "") + T.net;
  net.style.color = T.net > 0 ? "var(--ok)" : T.net < 0 ? "var(--bad)" : "var(--brass-hi)";
  document.getElementById("tSharp").textContent = Math.round(T.sharp / T.hands * 100) + "%";
  document.getElementById("tHands").textContent = T.hands;
  showOdds();
}

function trainerNext(){ trainerDeal(); }

/* ---------- the way in ----------
   Real accounts now: Supabase Auth handles sign-up and sign-in, and a
   session persists in the browser the normal way any site's login does,
   so a returning visitor skips straight past the gate. The pin still
   guards actually dealing a hand -- signing in only gets you in the room. */
const START_PIN = "4049";

const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");
const gateForm = document.getElementById("gateForm");
const gErr = document.getElementById("gErr");
const gateP = document.getElementById("gateP");
const fNameField = document.getElementById("fName");
const gGo = document.getElementById("gGo");
const walletEl = document.getElementById("walletChip");
const signOutBtn = document.getElementById("signOutBtn");

let gateMode = "in";              // "in" | "up"
let CURRENT_USER = null;          // {id, email, displayName} once signed in
let WALLET_BALANCE = null;

function refuse(msg){
  gErr.textContent = msg;
  gateEl.classList.remove("wrong");
  void gateEl.offsetWidth;         // restart the shake
  gateEl.classList.add("wrong");
}

function setGateMode(mode){
  gateMode = mode;
  document.querySelectorAll(".gtab").forEach(b => b.classList.toggle("sel", b.dataset.mode === mode));
  fNameField.hidden = mode !== "up";
  gateP.textContent = mode === "up"
    ? "A minute to set up, and your chips are waiting for you next time."
    : "Welcome back. Sign in to take your seat.";
  gGo.textContent = mode === "up" ? "Create account" : "Sign in";
  gErr.textContent = "";
}
document.querySelectorAll(".gtab").forEach(b => b.addEventListener("click", () => setGateMode(b.dataset.mode)));

function renderWallet(){
  if (!walletEl) return;
  if (WALLET_BALANCE === null){ walletEl.hidden = true; return; }
  walletEl.innerHTML = amt(WALLET_BALANCE);
  walletEl.hidden = false;
}

async function enterApp(session){
  CURRENT_USER = {
    id: session.user.id,
    email: session.user.email,
    displayName: (session.user.user_metadata && session.user.user_metadata.display_name) || "Player"
  };
  WALLET_BALANCE = await sbBalance();
  renderWallet();
  if (signOutBtn) signOutBtn.hidden = false;
  gateEl.classList.add("out");
  setTimeout(() => {
    gateEl.remove();
    appEl.hidden = false;
    showLanding();
  }, reduced ? 0 : 460);
}

gateForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!sbReady()){
    return refuse("Not connected yet — add your project\u2019s Supabase URL and key to js/supabase-client.js.");
  }
  const email = document.getElementById("gEmail").value.trim();
  const pass = document.getElementById("gPass").value;
  if (!email || !pass) return refuse("Both fields, please.");

  gGo.disabled = true;
  try {
    if (gateMode === "up"){
      const name = document.getElementById("gName").value.trim();
      if (!name){ return refuse("Pick a name for the table to call you."); }
      if (pass.length < 8){ return refuse("Password needs at least 8 characters."); }
      const { data, error } = await sbSignUp(email, pass, name);
      if (error) return refuse(error.message);
      if (!data.session){
        // Email confirmation is on: there's no session yet to enter with.
        // Switch modes first -- setGateMode writes its own default message,
        // so setting the real one has to happen after, not before.
        setGateMode("in");
        gErr.textContent = "";
        gateP.textContent = "Almost there — check " + email + " and confirm your account, then sign in.";
        return;
      }
      // Signed up and immediately live: this is the account's very first
      // moment, and the only place the welcome bonus is ever claimed from.
      await sbClaimWelcomeBonus();
      await enterApp(data.session);
    } else {
      const { data, error } = await sbSignIn(email, pass);
      if (error){
        document.getElementById("gPass").value = "";
        return refuse("Wrong email or password.");
      }
      await enterApp(data.session);
    }
  } catch(err){
    refuse("Something went wrong. Try again.");
  } finally {
    gGo.disabled = false;
  }
});

if (signOutBtn){
  signOutBtn.addEventListener("click", async () => {
    if (G) return;                 // don't sign out from under a live game
    await sbSignOut();
    location.reload();
  });
}

/* ---------- the wallet at the table ----------
   A wallet belongs to exactly one signed-in account, so it can only back a
   game where exactly one signed-in human is playing and every other seat
   is a bot. The other two modes deliberately involve people without
   accounts -- pass-the-phone shares a screen between several humans, and
   invite-link guests have no account at all -- and charging one person's
   wallet for everyone else's play would be wrong. Those stay free practice
   with throwaway chips, exactly as they were.

   Standing caveat, same one as everywhere else: the game still runs in the
   browser, so the number handed to cash_out is asserted by the client. The
   database bounds how far that can be abused (see sql/schema.sql) but
   cannot verify it. Until the game itself is server-authoritative, treat
   these balances as play money. */
let TABLE_REF = null;
let WALLET_BACKED = false;

function walletEligible(seats){
  if (!CURRENT_USER || !sbReady()) return false;
  if (NET.role !== "local") return false;             // lobby play involves accountless guests
  return seats.filter(s => !s.bot).length === 1;      // one human, rest bots
}

async function walletBuyIn(amount){
  TABLE_REF = "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const { data, error } = await sbBuyIn(amount, TABLE_REF);
  if (error){
    TABLE_REF = null;
    return { ok:false, msg: /insufficient/i.test(error.message)
      ? "Not enough chips in your wallet for that buy-in."
      : error.message };
  }
  WALLET_BACKED = true;
  WALLET_BALANCE = data;
  renderWallet();
  return { ok:true };
}

/* Called whenever a wallet-backed table ends, however it ends. Deliberately
   forgiving: if the cash-out call fails we still clear the session flags so
   the player isn't stuck unable to start another game. */
async function walletCashOut(){
  if (!WALLET_BACKED || !TABLE_REF || !G) return;
  const me = G.players.find(p => !p.isBot);
  const stack = me ? Math.max(0, me.chips) : 0;
  const ref = TABLE_REF;
  WALLET_BACKED = false;
  TABLE_REF = null;
  try {
    const { error } = await sbCashOut(stack, ref);
    if (!error){
      WALLET_BALANCE = await sbBalance();
      renderWallet();
    }
  } catch(e){ /* leaving the table matters more than the receipt */ }
}

// A tab closed mid-game would otherwise strand the buy-in. This is a
// best-effort nudge, not a guarantee -- browsers are allowed to ignore
// async work here, which is exactly why the real fix is server-side state.
window.addEventListener("beforeunload", () => {
  if (WALLET_BACKED && TABLE_REF && G){
    const me = G.players.find(p => !p.isBot);
    if (me) sbCashOut(Math.max(0, me.chips), TABLE_REF);
  }
});

/* ---------- invited straight to a table ----------
   A link like  ...?join=ABCDE  is for the people you invite. It skips the
   login entirely and drops them on the join screen with the code already
   filled in. They can play; they never see the front page, the trainer or
   the setup, and they never need an account of their own -- this pass
   keeps that exactly as it was. A signed-in host or player still holds
   their own wallet; a guest who joins this way is playing without one,
   the same way they always could. */
const JOIN_PARAM = (() => {
  try {
    const v = new URLSearchParams(location.search).get("join");
    if (!v) return null;
    const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    return c.length === 5 ? c : null;
  } catch(e){ return null; }
})();
let GUEST_ENTRY = false;

function inviteLink(code){
  try {
    const base = location.href.split("?")[0].split("#")[0];
    return base + "?join=" + code;
  } catch(e){ return "?join=" + code; }
}
function isFileURL(){
  try { return location.protocol === "file:"; } catch(e){ return false; }
}

if (JOIN_PARAM){
  GUEST_ENTRY = true;
  if (gateEl) gateEl.remove();
  appEl.hidden = false;
  landing.hidden = true;
  document.body.classList.add("guestmode");
  setTimeout(() => joinPanel(JOIN_PARAM), 60);
} else {
  setTimeout(() => { const f = document.getElementById("gEmail"); if (f) f.focus(); }, 240);
}

// A returning visitor with a live session skips the gate entirely -- unless
// they arrived on an invite link, which already took them straight to the
// join screen above and has nothing to do with anyone's account.
(async () => {
  if (!sbReady() || GUEST_ENTRY) return;
  const session = await sbSession();
  if (session) await enterApp(session);
})();

/* ---------- pin before the first card ---------- */
/* ============================================================
   PLAYING ACROSS DEVICES

   The host's phone is the table. It holds the one real deck and the one
   real game state, exactly as it does in pass-the-phone mode, and every
   other phone is a window onto it. Guests never receive another player's
   cards -- the host redacts them before they ever go on the wire, so a
   guest digging through their own browser has nothing to find.

   The connection is peer-to-peer through PeerJS, so there is no server
   to run and nothing to sign up for. The cost of that is real and worth
   knowing: if the host closes the tab, the table closes with it.
   ============================================================ */
const NET = {
  role: "local",              // "local" | "host" | "guest"
  peer: null,
  code: null,
  conns: {},                  // host: playerId -> connection
  me: null,                   // guest: my player id
  transport: null,            // swapped out under test
  pendingCall: null
};
const netOn = () => NET.role !== "local";
const CODE_CHARS = "ACDEFGHJKLMNPQRTUVWXY3456789";   // no O/0, I/1, S/5, B/8
function makeCode(){
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_CHARS[randInt(CODE_CHARS.length)];
  return s;
}
const peerIdFor = code => "twentyfive-v1-" + code;

/* A thin seam over PeerJS so the whole protocol can be driven in a test
   harness without a network. */
function defaultTransport(){
  return {
    available: () => typeof Peer !== "undefined",
    host(code, handlers){
      const peer = new Peer(peerIdFor(code), {debug:0});
      peer.on("open", () => handlers.ready());
      peer.on("error", e => handlers.error(e && e.type ? e.type : String(e)));
      peer.on("connection", conn => {
        conn.on("open", () => handlers.connected({
          id: conn.peer,
          send: m => { try { conn.send(m); } catch(e){} },
          close: () => { try { conn.close(); } catch(e){} }
        }));
        conn.on("data", m => handlers.data(conn.peer, m));
        conn.on("close", () => handlers.gone(conn.peer));
      });
      return peer;
    },
    join(code, handlers){
      const peer = new Peer({debug:0});
      peer.on("open", () => {
        const conn = peer.connect(peerIdFor(code), {reliable:true});
        conn.on("open", () => handlers.open({
          send: m => { try { conn.send(m); } catch(e){} },
          close: () => { try { conn.close(); } catch(e){} }
        }));
        conn.on("data", m => handlers.data(m));
        conn.on("close", () => handlers.gone());
        conn.on("error", () => handlers.error("connect"));
      });
      peer.on("error", e => handlers.error(e && e.type ? e.type : String(e)));
      return peer;
    }
  };
}
function transport(){ return NET.transport || (NET.transport = defaultTransport()); }

/* Why a lobby might not be possible here. Checked before we try, so the
   failure is explained rather than silent. */
function netEnvIssue(){
  if (typeof Peer === "undefined") return "noscript";
  try { if (!window.RTCPeerConnection) return "nowebrtc"; }
  catch(e){ return "nowebrtc"; }
  try { if (window.self !== window.top) return "embedded"; }
  catch(e){ return "embedded"; }
  return null;
}
const ENV_NOTE = {
  noscript: "The connection library didn\u2019t load. That usually means no internet.",
  nowebrtc: "This browser has peer-to-peer connections switched off.",
  embedded: "This page is running inside another app\u2019s built-in viewer, which usually blocks " +
            "the direct connection lobbies need. Open it in Safari or Chrome instead."
};

/* Every attempt ends: connected, or a clear failure. Never a spinner that
   sits there forever, which is what happens when the peer library goes
   quiet and neither its open nor its error callback ever fires. */
const NET_TIMEOUT = 12000;
function netAttempt(onFail){
  const a = {done:false, timer:null, fail:null};
  const unhook = () => { try { window.removeEventListener("error", a.onErr); } catch(e){} };
  a.fail = reason => {
    if (a.done) return;
    a.done = true;
    clearTimeout(a.timer);
    unhook();
    onFail(reason);
  };
  a.win = () => {
    if (a.done) return false;
    a.done = true;
    clearTimeout(a.timer);
    unhook();
    return true;
  };
  a.onErr = () => a.fail("script");
  try { window.addEventListener("error", a.onErr); } catch(e){}
  a.timer = setTimeout(() => a.fail("timeout"), NET_TIMEOUT);
  return a;
}

function netFailPanel(title, reason, retry, back){
  const env = netEnvIssue();
  const why =
    reason === "timeout"
      ? (env ? ENV_NOTE[env]
             : "Nothing answered in time. The matchmaking service may be busy, or your network " +
               "may be blocking peer-to-peer connections.")
    : reason === "script" ? (env ? ENV_NOTE[env] : "The connection library hit an error.")
    : reason === "nolobby" ? "No table is open on that code. Check it with the host \u2014 codes only " +
        "last while the host\u2019s phone is on that screen."
    : (env ? ENV_NOTE[env] : "The matchmaking service didn\u2019t answer.");
  const panel = openPanel(
    '<div class="eyebrow">Lobby</div>' +
    '<h2>' + title + '</h2>' +
    '<p>' + why + '</p>' +
    (env === "embedded"
      ? '<div class="lvhint" style="margin-bottom:14px">Playing on one device works fine here \u2014 ' +
        'it needs no connection at all.</div>' : "") +
    (retry ? '<button class="btn" id="nRetry">Try again</button>' : "") +
    '<button class="btn ghost" id="nBack">Back</button>'
  );
  if (retry) panel.querySelector("#nRetry").addEventListener("click", () => { closePanel(); retry(); });
  panel.querySelector("#nBack").addEventListener("click", () => { netTeardown(); closePanel(); if (back) back(); });
  return panel;
}

/* ---------- what a given player is allowed to see ---------- */
function viewFor(pid){
  return {
    players: G.players.map(p => ({
      id:p.id, name:p.name, chips:p.chips, isBot:p.isBot, botLevel:p.botLevel,
      hits:p.hits, contributed:p.contributed, inHand:p.inHand,
      revealed:p.revealed, locked:p.locked, out:p.out,
      stuckThisRound:p.stuckThisRound, eliminated:p.eliminated, isWinner:p.isWinner,
      _pos:p._pos,
      // your own hand, or anybody's once it has been turned face up.
      // Everything else leaves here as blanks, not as cards.
      cards: (p.id === pid || p.revealed) ? p.cards : p.cards.map(() => ({rank:"", suit:"", red:false}))
    })),
    stakes: G.stakes, pot: G.pot, round: G.round, handNo: G.handNo,
    activeId: G.activeId, phase: G.phase, deckLen: G.deck.length
  };
}
function netPush(){
  if (NET.role !== "host" || !G) return;
  for (const pid in NET.conns){
    const c = NET.conns[pid];
    if (c) c.send({t:"view", v: viewFor(pid)});
  }
}
function netTo(pid, msg){
  const c = NET.conns[pid];
  if (c) c.send(msg);
}
function netAll(msg){
  for (const pid in NET.conns) if (NET.conns[pid]) NET.conns[pid].send(msg);
}
const isRemote = p => NET.role === "host" && !!NET.conns[p.id];
const isMine = p => NET.role === "guest" ? p.id === NET.me : !isRemote(p) && !p.isBot;

/* ---------- lobby ---------- */
let LOBBY = null;

function modeChooser(){
  const panel = openPanel(
    '<div class="eyebrow">Twenty\u00b7Five</div>' +
    '<h2>How are you <em>playing</em>?</h2>' +
    '<p>Pass one phone around the table, or give everyone their own screen.</p>' +
    '<div class="modes">' +
      '<button class="mode" id="mLocal">' +
        '<b>This device</b><s>One phone, passed around. Everyone in the same room.</s></button>' +
      '<button class="mode" id="mLobby">' +
        '<b>Lobby</b><s>Everyone on their own phone, wherever they are.</s></button>' +
    '</div>' +
    '<button class="btn ghost" id="mBack">Back</button>'
  );
  panel.querySelector("#mLocal").addEventListener("click", () => { closePanel(); setupPanel(); });
  panel.querySelector("#mLobby").addEventListener("click", () => { closePanel(); lobbyChooser(); });
  panel.querySelector("#mBack").addEventListener("click", () => { closePanel(); });
}

function lobbyChooser(){
  const ok = transport().available();
  const env = ok ? netEnvIssue() : "noscript";
  // Say so up front rather than letting them wait out a timeout to find out.
  const blocked = env === "noscript" || env === "nowebrtc";
  const panel = openPanel(
    '<div class="eyebrow">Lobby</div>' +
    '<h2>Create or <em>join</em></h2>' +
    (!env
      ? '<p>The host\u2019s phone runs the table. Everyone else joins with a five-character code.</p>'
      : '<div class="' + (blocked ? "err" : "lvhint") + '" style="margin-bottom:14px">' +
        ENV_NOTE[env] +
        (env === "embedded" ? ' You can still try \u2014 it just often fails here.' : '') +
        '</div>') +
    '<div class="modes">' +
      '<button class="mode" id="lCreate"' + (blocked ? " disabled" : "") + '>' +
        '<b>Create a lobby</b><s>You host. Needs the pin.</s></button>' +
      '<button class="mode" id="lJoin"' + (blocked ? " disabled" : "") + '>' +
        '<b>Join a lobby</b><s>You have a code from the host.</s></button>' +
    '</div>' +
    '<button class="btn ghost" id="lBack">Back</button>'
  );
  if (!blocked){
    panel.querySelector("#lCreate").addEventListener("click", () => {
      closePanel();
      pinPanel(() => createLobby());
    });
    panel.querySelector("#lJoin").addEventListener("click", () => { closePanel(); joinPanel(); });
  }
  panel.querySelector("#lBack").addEventListener("click", () => { closePanel(); modeChooser(); });
}

function netStatusPanel(title, body, backFn){
  const panel = openPanel(
    '<div class="eyebrow">Lobby</div>' +
    '<h2>' + title + '</h2>' +
    '<p>' + body + '</p>' +
    '<button class="btn ghost" id="nBack">Back</button>'
  );
  panel.querySelector("#nBack").addEventListener("click", () => { netTeardown(); closePanel(); if (backFn) backFn(); });
  return panel;
}

function netTeardown(){
  try { if (NET.peer && NET.peer.destroy) NET.peer.destroy(); } catch(e){}
  for (const k in NET.conns){ try { NET.conns[k].close(); } catch(e){} }
  NET.peer = null; NET.conns = {}; NET.role = "local"; NET.me = null; NET.code = null;
  NET.pendingCall = null; LOBBY = null;
}

/* ---------- host side ---------- */
function createLobby(){
  const code = makeCode();
  NET.role = "host";
  NET.code = code;
  NET.conns = {};
  LOBBY = {
    code,
    stake: 1,
    bank: STAKES[1].bank,
    hostName: "",
    seats: [],            // remote guests: {id, name}
    bots: []              // {lvl}
  };
  netStatusPanel("Opening the <em>room</em>\u2026", "Reserving the code " + code + ".");

  const attempt = netAttempt(reason => {
    netTeardown();
    netFailPanel("Couldn\u2019t open the room", reason, createLobby, modeChooser);
  });

  const handlers = {
    ready(){ if (attempt.win()) lobbyPanel(); },
    error(kind){
      if (kind === "unavailable-id"){       // that code is taken, try another
        if (!attempt.win()) return;
        netTeardown();
        return createLobby();
      }
      attempt.fail(kind);
    },
    connected(conn){
      if (!LOBBY || G){ conn.send({t:"full"}); conn.close(); return; }
      if (LOBBY.seats.length + LOBBY.bots.length >= 3){ conn.send({t:"full"}); conn.close(); return; }
      NET.conns[conn.id] = conn;
    },
    data(pid, m){ hostMessage(pid, m); },
    gone(pid){
      if (NET.conns[pid]) delete NET.conns[pid];
      if (LOBBY){
        LOBBY.seats = LOBBY.seats.filter(s => s.id !== pid);
        lobbyPanel();
        pushLobby();
      } else if (G){
        log("A player dropped out.", true);
        miniLog("A player lost connection");
        render();
      }
    }
  };
  try { NET.peer = transport().host(code, handlers); }
  catch(e){ attempt.fail("script"); }
}

function hostMessage(pid, m){
  if (!m || !m.t) return;
  if (m.t === "hello"){
    if (!LOBBY) return;
    const nm = String(m.name || "").slice(0, 14).trim();
    if (!LOBBY.seats.some(s => s.id === pid)) LOBBY.seats.push({id:pid, name:nm});
    else LOBBY.seats.find(s => s.id === pid).name = nm;
    netTo(pid, {t:"welcome", you:pid, code:NET.code});
    lobbyPanel();
    pushLobby();
    return;
  }
  if (m.t === "rename" && LOBBY){
    const s = LOBBY.seats.find(x => x.id === pid);
    if (s) s.name = String(m.name || "").slice(0, 14).trim();
    lobbyPanel(); pushLobby();
    return;
  }
  if (!G) return;
  const p = G.players.find(x => x.id === pid);
  if (!p) return;
  if (m.t === "act"){
    if (G.activeId !== p.id) return;                 // not your turn
    if (m.a === "hit"){
      if (p.hits >= MAX_HITS || p.chips < G.stakes.hit) return;
      return doHit(p);
    }
    if (m.a === "stick"){
      p.stuckThisRound = true;
      log(p.name + " sticks.");
      miniLog(escapeHTML(p.name) + " stuck");
      render();
      return nextTurn(indexOfPlayer(p));
    }
    return;
  }
  if (m.t === "callchoice") return callChoiceIn(p, !!m.yes);
  if (m.t === "ack" && NET.waitAck && NET.waitAck.need.has(p.id)){
    NET.waitAck.need.delete(p.id);
    if (!NET.waitAck.need.size){ const f = NET.waitAck.go; NET.waitAck = null; f(); }
  }
}

function pushLobby(){
  if (NET.role !== "host" || !LOBBY) return;
  const state = {
    code: LOBBY.code,
    stakeName: STAKES[LOBBY.stake].name,
    stake: LOBBY.stake,
    bank: LOBBY.bank,
    seats: lobbySeatList().map(s => ({name:s.name, kind:s.kind, diff:s.diff}))
  };
  netAll({t:"lobby", state});
}
function lobbySeatList(){
  // Numbered apart the same way the real table will name them, so the lobby
  // never shows two seats with the same label.
  const used = new Set();
  const uniq = base => {
    let n = base, k = 2;
    while (used.has(n.toLowerCase())) n = base + " " + (k++);
    used.add(n.toLowerCase());
    return n;
  };
  const out = [{name: uniq(LOBBY.hostName.trim() || "Host"), kind:"host"}];
  LOBBY.seats.forEach(s => out.push({name: uniq((s.name || "").trim() || "Player"), kind:"remote", id:s.id}));
  LOBBY.bots.forEach((b, i) => out.push({name: uniq(BOT_LEVELS[b.lvl].name), kind:"bot",
    diff: BOT_LEVELS[b.lvl].diff, idx:i}));
  return out;
}

function lobbyPanel(){
  if (!LOBBY) return;
  const seats = lobbySeatList();
  const joined = LOBBY.seats.length;
  const canStart = joined >= 1;
  const full = seats.length >= 4;

  const rows = seats.map(s =>
    '<div class="lseat' + (s.kind === "host" ? " you" : "") + '">' +
      '<div class="lname">' + escapeHTML(s.name) + '</div>' +
      '<div class="ltag">' +
        (s.kind === "host" ? "You \u00b7 host" : s.kind === "bot" ? "Bot \u00b7 " + s.diff : "Joined") +
      '</div>' +
      (s.kind === "remote" ? '<button class="kick" data-kick="' + s.id + '">Kick</button>' : "") +
      (s.kind === "bot" ? '<button class="kick" data-debot="' + s.idx + '">Remove</button>' : "") +
    '</div>').join("");

  const stakeOpts = Object.keys(STAKES).map(k => {
    const s = STAKES[k];
    return '<button class="choice' + (String(LOBBY.stake) === k ? " sel" : "") + '" data-stake="' + k + '">' +
      '<b>' + amt(s.ante) + '</b><s>' + s.name + '</s></button>';
  }).join("");

  const p = openPanel(
    '<div class="eyebrow">You are hosting</div>' +
    '<h2>Lobby <em>' + LOBBY.code + '</em></h2>' +
    '<div class="codebox"><div class="clabel">Share this code</div>' +
      '<div class="code">' + LOBBY.code + '</div>' +
      '<button class="tbtn" id="copyCode">Copy</button></div>' +
    '<button class="btn ghost" id="copyLink">Copy an invite link</button>' +
    '<div class="lvhint" style="margin:-2px 0 14px">' +
      'The link drops them straight into this table \u2014 no login, no front page. ' +
      (isFileURL()
        ? 'It only works once the game is on a real web address.'
        : 'Send it however you like.') + '</div>' +
    '<div class="field"><label>Your name</label>' +
      '<input class="inp" id="hostName" value="' + escapeHTML(LOBBY.hostName) + '" placeholder="Host" maxlength="14"></div>' +
    '<div class="field"><label>At the table (' + seats.length + ' of 4)</label>' + rows +
      (!full && LOBBY.bots.length < 2
        ? '<button class="btn ghost" id="addBot">Add a bot</button>' : "") +
      (LOBBY.bots.length >= 2 ? '<div class="lvhint">Two bots is the limit in a lobby.</div>' : "") +
    '</div>' +
    (LOBBY.bots.length
      ? '<div class="field"><label>Bot level</label><div class="lvrow">' +
        [1,2,3,4].map(L => '<button class="lv' + (LOBBY.bots[LOBBY.bots.length-1].lvl === L ? " sel" : "") +
          '" data-blv="' + L + '"><b>' + BOT_LEVELS[L].short + '</b><s>' + BOT_LEVELS[L].diff + '</s></button>').join("") +
        '<div class="lvhint">Sets the newest bot. ' + BOT_LEVELS[LOBBY.bots[LOBBY.bots.length-1].lvl].blurb + '</div>' +
        '</div></div>'
      : "") +
    '<div class="field"><label>Stakes</label><div class="choices">' + stakeOpts + '</div></div>' +
    '<div class="field"><label>Starting chips each</label>' +
      '<input class="inp" id="lbank" type="number" min="' + (STAKES[LOBBY.stake].ante * 4) + '" step="10" value="' + LOBBY.bank + '"></div>' +
    '<div class="err" id="lerr">' + (canStart ? "" : "Waiting for at least one other player to join\u2026") + '</div>' +
    '<button class="btn" id="lgo"' + (canStart ? "" : " disabled") + '>Deal the first hand</button>' +
    '<button class="btn ghost" id="lclose">Close the room</button>'
  );

  p.querySelector("#copyCode").addEventListener("click", e => {
    try { navigator.clipboard.writeText(LOBBY.code); e.currentTarget.textContent = "Copied"; }
    catch(err){ e.currentTarget.textContent = LOBBY.code; }
  });
  p.querySelector("#copyLink").addEventListener("click", e => {
    const url = inviteLink(LOBBY.code);
    try { navigator.clipboard.writeText(url); e.currentTarget.textContent = "Link copied"; }
    catch(err){ e.currentTarget.textContent = url; }
  });
  p.querySelector("#hostName").addEventListener("input", e => { LOBBY.hostName = e.target.value; pushLobby(); });
  p.querySelectorAll("[data-kick]").forEach(b => b.addEventListener("click", e => {
    const id = e.currentTarget.dataset.kick;
    netTo(id, {t:"kicked"});
    const c = NET.conns[id];
    setTimeout(() => { if (c) c.close(); }, 80);
    delete NET.conns[id];
    LOBBY.seats = LOBBY.seats.filter(s => s.id !== id);
    lobbyPanel(); pushLobby();
  }));
  p.querySelectorAll("[data-debot]").forEach(b => b.addEventListener("click", e => {
    LOBBY.bots.splice(+e.currentTarget.dataset.debot, 1); lobbyPanel(); pushLobby();
  }));
  const ab = p.querySelector("#addBot");
  if (ab) ab.addEventListener("click", () => { LOBBY.bots.push({lvl:3}); lobbyPanel(); pushLobby(); });
  p.querySelectorAll("[data-blv]").forEach(b => b.addEventListener("click", e => {
    LOBBY.bots[LOBBY.bots.length-1].lvl = +e.currentTarget.dataset.blv; lobbyPanel(); pushLobby();
  }));
  p.querySelectorAll("[data-stake]").forEach(b => b.addEventListener("click", e => {
    LOBBY.stake = +e.currentTarget.dataset.stake;
    LOBBY.bank = STAKES[LOBBY.stake].bank;
    lobbyPanel(); pushLobby();
  }));
  p.querySelector("#lbank").addEventListener("input", e => { LOBBY.bank = +e.target.value; pushLobby(); });
  p.querySelector("#lclose").addEventListener("click", () => {
    netAll({t:"closed"});
    netTeardown(); closePanel();
  });
  const go = p.querySelector("#lgo");
  if (canStart) go.addEventListener("click", () => startLobbyGame());
}

function startLobbyGame(){
  const st = STAKES[LOBBY.stake];
  if (!(LOBBY.bank >= st.ante * 2)){
    const e = document.querySelector("#lerr");
    if (e) e.textContent = "Starting chips must cover at least two antes (" + (st.ante * 2) + ").";
    return;
  }
  // Seat order: host, then guests in the order they arrived, then bots.
  const used = new Set();
  const uniq = base => {
    let n = base, k = 2;
    while (used.has(n.toLowerCase())) n = base + " " + (k++);
    used.add(n.toLowerCase());
    return n;
  };
  const seats = [];
  seats.push({id:"host", name: uniq(LOBBY.hostName.trim() || "Host"), bot:false, lvl:3});
  LOBBY.seats.forEach(s => seats.push({id:s.id, name: uniq((s.name || "").trim() || "Player"), bot:false, lvl:3}));
  LOBBY.bots.forEach(b => seats.push({id:null, name: uniq(BOT_LEVELS[b.lvl].name), bot:true, lvl:b.lvl}));

  closePanel();
  startGame(seats, LOBBY.stake, LOBBY.bank, true);
  netAll({t:"begin"});
  netPush();
}

/* ---------- guest side ---------- */
function joinPanel(prefill){
  const invited = GUEST_ENTRY;
  const panel = openPanel(
    '<div class="eyebrow">' + (invited ? "You\u2019ve been invited" : "Join a lobby") + '</div>' +
    '<h2>' + (invited ? "Take a <em>seat</em>" : "Enter the <em>code</em>") + '</h2>' +
    '<p>' + (invited
      ? "Put a name in and you\u2019re at the table."
      : "Five characters from whoever is hosting.") + '</p>' +
    '<div class="field"><label>Lobby code</label>' +
      '<input class="inp code-in" id="jCode" maxlength="5" autocomplete="off" spellcheck="false" ' +
      'value="' + escapeHTML(prefill || "") + '" placeholder="\u2022\u2022\u2022\u2022\u2022"></div>' +
    '<div class="field"><label>Your name</label>' +
      '<input class="inp" id="jName" maxlength="14" autocomplete="off" placeholder="Your name"></div>' +
    '<div class="err" id="jErr"></div>' +
    '<button class="btn" id="jGo">Join the table</button>' +
    (invited ? "" : '<button class="btn ghost" id="jBack">Back</button>')
  );
  setTimeout(() => { const n = panel.querySelector("#jName"); if (n && prefill) n.focus(); }, 50);
  const codeIn = panel.querySelector("#jCode");
  codeIn.addEventListener("input", () => {
    codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  const backBtn = panel.querySelector("#jBack");
  if (backBtn) backBtn.addEventListener("click", () => { closePanel(); lobbyChooser(); });
  panel.querySelector("#jGo").addEventListener("click", () => {
    const code = codeIn.value.trim();
    const name = panel.querySelector("#jName").value.trim();
    const err = panel.querySelector("#jErr");
    if (code.length !== 5) return err.textContent = "The code is five characters.";
    if (!name) return err.textContent = "Put a name in so the table knows who you are.";
    closePanel();
    connectToLobby(code, name);
  });
}

function connectToLobby(code, name){
  NET.role = "guest";
  NET.code = code;
  netStatusPanel("Knocking\u2026", "Looking for lobby " + escapeHTML(code) + ".", lobbyChooser);

  const attempt = netAttempt(reason => {
    netTeardown();
    netFailPanel("Couldn\u2019t reach that table",
      reason === "peer-unavailable" ? "nolobby" : reason,
      () => connectToLobby(code, name),
      GUEST_ENTRY ? null : lobbyChooser);
  });

  const handlers = {
    open(conn){
      if (!attempt.win()) return;
      NET.conn = conn;
      conn.send({t:"hello", name});
    },
    data(m){ guestMessage(m); },
    error(kind){ attempt.fail(kind || "connect"); },
    gone(){
      if (attempt.done && G !== null){
        netTeardown();
        showLanding();
        netStatusPanel("The table closed", "The host\u2019s phone disconnected, so the game ended.", null);
      } else {
        attempt.fail("nolobby");
      }
    }
  };
  try { NET.peer = transport().join(code, handlers); }
  catch(e){ attempt.fail("script"); }
}

function guestMessage(m){
  if (!m || !m.t) return;
  if (m.t === "welcome"){ NET.me = m.you; return; }
  if (m.t === "full"){
    netTeardown();
    return netStatusPanel("That table is full", "There are already four seats taken.", lobbyChooser);
  }
  if (m.t === "kicked"){
    netTeardown(); closePanel();
    return netStatusPanel("Removed from the lobby", "The host took your seat back.", lobbyChooser);
  }
  if (m.t === "closed"){
    netTeardown(); closePanel();
    return netStatusPanel("The room closed", "The host shut the lobby down.", lobbyChooser);
  }
  if (m.t === "lobby") return guestLobbyPanel(m.state);
  if (m.t === "begin"){ closePanel(); showTable(); logEl.innerHTML = ""; clearMini(); return; }
  if (m.t === "view"){
    const v = m.v;
    G = {
      players: v.players, stakes: v.stakes, pot: v.pot, round: v.round,
      handNo: v.handNo, activeId: v.activeId, phase: v.phase,
      deck: new Array(v.deckLen)
    };
    render();
    return;
  }
  if (m.t === "status") return statusText(m.html);
  if (m.t === "log") return log(m.msg, m.hi);
  if (m.t === "mini"){ MINI.length = 0; m.rows.forEach(r => MINI.push(r)); return miniLog("");  }
  if (m.t === "flash") return flash(m.msg);
  if (m.t === "screen") return guestScreen(m);
  if (m.t === "panel"){
    const panel = openPanel(m.html);
    const btn = panel.querySelector("#ok") || panel.querySelector(".btn");
    if (btn) btn.addEventListener("click", () => { closePanel(); NET.conn.send({t:"ack"}); });
    return;
  }
  if (m.t === "close") return closePanel();
  if (m.t === "over"){ closePanel(); openPanel(m.html); return; }
}

function guestLobbyPanel(state){
  const rows = state.seats.map(s =>
    '<div class="lseat' + (s.kind === "host" ? "" : "") + '">' +
      '<div class="lname">' + escapeHTML(s.name) + '</div>' +
      '<div class="ltag">' + (s.kind === "host" ? "Host" : s.kind === "bot" ? "Bot \u00b7 " + s.diff : "Joined") + '</div>' +
    '</div>').join("");
  openPanel(
    '<div class="eyebrow">In the lobby</div>' +
    '<h2>Table <em>' + escapeHTML(state.code) + '</em></h2>' +
    '<div class="field"><label>At the table (' + state.seats.length + ' of 4)</label>' + rows + '</div>' +
    '<div class="ledger">' +
      '<div>Stakes<b>' + escapeHTML(state.stakeName) + '</b></div>' +
      '<div>Starting chips<b>' + amt(state.bank) + '</b></div>' +
    '</div>' +
    '<div class="lvhint" style="margin-top:12px">The host sets the stakes and starts the game. Sit tight.</div>' +
    '<button class="btn ghost" id="lLeave">Leave the lobby</button>'
  ).querySelector("#lLeave").addEventListener("click", () => {
    netTeardown(); closePanel();
  });
}

function guestScreen(m){
  if (m.kind === "wait"){
    closePanel();
    return statusText("<b>" + escapeHTML(m.who) + "</b> to act.");
  }
  if (m.kind === "hand"){
    const me = G.players.find(p => p.id === NET.me);
    if (me) handPanel(me);
    return;
  }
  if (m.kind === "call"){
    return callChoicePanel(m.hitter, m.hits, yes => NET.conn.send({t:"callchoice", yes}));
  }
}

/* One player, one decision. In a lobby everyone answers on their own phone,
   so nobody sees anyone else's chip before committing their own. */
function callChoicePanel(hitterName, hits, onChoose){
  const cost = G.stakes.call + G.stakes.pen;
  const panel = openPanel(
    '<div class="eyebrow">Card ' + hits + ' of ' + MAX_HITS + '</div>' +
    '<h2><em>' + escapeHTML(hitterName) + '</em> just took a card</h2>' +
    '<p>Think they\u2019re over 25? Throw a chip in. Everyone decides at the same time, ' +
      'and a correct call is shared between whoever called it. Get it wrong and you pay ' +
      amt(cost) + ' \u2014 and the hand dies there.</p>' +
    '<div class="btnrow">' +
      '<button class="btn ghost" id="cPass">Let it go</button>' +
      '<button class="btn" id="cCall">Call \u00b7 ' + amt(G.stakes.call) + '</button>' +
    '</div>'
  );
  const done = yes => { closePanel(); statusText("Waiting for the rest of the table\u2026"); onChoose(yes); };
  panel.querySelector("#cCall").addEventListener("click", () => done(true));
  panel.querySelector("#cPass").addEventListener("click", () => done(false));
}

function pinPanel(onPass){
  let tries = 0;
  const panel = openPanel(
    '<div class="eyebrow">Table locked</div>' +
    '<h2>Enter the <em>pin</em></h2>' +
    '<p>Four digits to open the deck and deal the first hand.</p>' +
    '<div class="field"><label>Pin</label>' +
      '<input class="inp pin" id="pinIn" type="text" inputmode="numeric" pattern="[0-9]*" ' +
      'maxlength="4" autocomplete="off" placeholder="\u2022 \u2022 \u2022 \u2022"></div>' +
    '<div class="err" id="pinErr"></div>' +
    '<button class="btn" id="pinGo">Deal</button>' +
    '<button class="btn ghost" id="pinBack">Back</button>'
  );
  const inp = panel.querySelector("#pinIn");
  const err = panel.querySelector("#pinErr");
  const submit = () => {
    if (inp.value === START_PIN){ closePanel(); return onPass(); }
    tries++;
    inp.value = "";
    err.textContent = tries >= 3 ? "Still wrong. The pin is four digits." : "Wrong pin.";
    panel.classList.remove("shake");
    void panel.offsetWidth;
    panel.classList.add("shake");
    inp.focus();
  };
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "");
    if (inp.value.length === 4) submit();
  });
  inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); submit(); } });
  panel.querySelector("#pinGo").addEventListener("click", submit);
  panel.querySelector("#pinBack").addEventListener("click", () => { closePanel(); setupPanel(); });
  setTimeout(() => inp.focus(), 60);
}

function showLanding(){
  if (GUEST_ENTRY){
    // Invited guests have no front page to return to — send them back to the door.
    landing.hidden = true;
    tableview.hidden = true;
    resetBtn.hidden = true;
    return joinPanel(NET.code || JOIN_PARAM);
  }
  landing.hidden = false;
  tableview.hidden = true;
  resetBtn.hidden = true;
  window.scrollTo({top:0, behavior: reduced ? "auto" : "smooth"});
  playHero();
  trainerNext();
}
function showTable(){
  landing.hidden = true;
  tableview.hidden = false;
  resetBtn.hidden = false;
}

/* ============================================================
   BOOT
   ============================================================ */
document.getElementById("rulesBtn").addEventListener("click", rulesPanel);
document.getElementById("readBtn").addEventListener("click", rulesPanel);
document.getElementById("seatBtn").addEventListener("click", modeChooser);
document.getElementById("replayHero").addEventListener("click", playHero);
document.getElementById("tCall").addEventListener("click", () => trainerAnswer(true));
document.getElementById("tPass").addEventListener("click", () => trainerAnswer(false));
document.getElementById("tNext").addEventListener("click", trainerNext);
document.getElementById("tBlind").addEventListener("click", e => {
  T.blind = !T.blind;
  e.currentTarget.classList.toggle("on", T.blind);
  e.currentTarget.textContent = T.blind
    ? "Odds hidden \u2014 show them again"
    : "Hide the odds and go on instinct";
  showOdds();
});

resetBtn.addEventListener("click", async () => {
  if (G && G.phase !== "over" && !confirm("Leave this game and go back to the front page?")) return;
  await walletCashOut();            // must run before G is cleared
  if (NET.role === "host") netAll({t:"closed"});
  netTeardown();
  G = null; render(); logEl.innerHTML = ""; potEl.textContent = "0"; clearMini();
  roundTagEl.textContent = "\u2014"; deckCountEl.textContent = "52";
  closePanel();
  showLanding();
});

trainerNext();
setTimeout(() => { buildOdds(); showOdds(); }, 60);