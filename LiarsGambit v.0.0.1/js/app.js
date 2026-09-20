(() => {
  const RANKS = ["K", "Q", "A"];
  const RANK_NAME = { K: "Kings", Q: "Queens", A: "Aces", J: "Joker" };
  const RANK_ONE = { K: "King", Q: "Queen", A: "Ace", J: "Joker" };

  const BOTS = [
    { name: "Silas", portrait: "assets/portrait-silas.jpg",
      persona: { call: 0.18, bluff: 0.35, three: 0.12, lines: {
        play: ["Very well.", "As you like.", "Hmm."],
        liar: ["I think not.", "No.", "That's a lie."],
        truth: ["As I said.", "Count them."],
        caught: ["So it is."]
      }}},
    { name: "Vera", portrait: "assets/portrait-vera.jpg",
      persona: { call: 0.38, bluff: 0.55, three: 0.28, lines: {
        play: ["Darling.", "Don't wait up.", "Obviously."],
        liar: ["Liar.", "Please.", "Don't insult me."],
        truth: ["Of course it was.", "Keep up."],
        caught: ["How tedious."]
      }}},
    { name: "Rook", portrait: "assets/portrait-rook.jpg",
      persona: { call: 0.26, bluff: 0.7, three: 0.4, lines: {
        play: ["Ha.", "Sure.", "Watch this."],
        liar: ["LIAR!", "Nah.", "You're full of it."],
        truth: ["Told you.", "Easy money."],
        caught: ["Ah, hell."]
      }}},
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ui = {
    screens: {
      home: $("#screen-home"),
      howto: $("#screen-howto"),
      lobby: $("#screen-lobby"),
      game: $("#screen-game"),
    },
    overlay: $("#overlay"),
    overlayCard: $("#overlay-card"),
    hand: $("#hand"),
    pile: $("#played-pile"),
    claim: $("#claim-text"),
    hint: $("#turn-hint"),
    round: $("#round-label"),
    tableLabel: $("#table-label"),
    badgeRank: $("#table-badge-rank"),
    playBtn: $("#btn-play"),
    liarBtn: $("#btn-liar"),
    playCount: $("#play-count"),
    youStatus: $("#you-status"),
    youName: $("#you-name"),
    mute: $("#btn-mute"),
    lobbyName: $("#lobby-name"),
    lobbyCode: $("#lobby-code"),
    lobbyError: $("#lobby-error"),
    lobbyRoom: $("#lobby-room"),
    roomCode: $("#room-code-label"),
    lobbySeats: $("#lobby-seats"),
    btnStartMp: $("#btn-start-mp"),
    profileAvatar: $("#profile-avatar"),
    iconPicks: $("#icon-picks"),
    colorPicks: $("#color-picks"),
  };

  const PROFILE_KEY = "liarsbar-profile-v1";
  const ICON_SET = [
    { id: "initial", glyph: "" },
    { id: "spade", glyph: "♠" },
    { id: "heart", glyph: "♥" },
    { id: "diamond", glyph: "♦" },
    { id: "club", glyph: "♣" },
    { id: "star", glyph: "★" },
  ];
  const COLOR_SET = ["#c9a227", "#c43c3c", "#2d6a4f", "#3d5a80", "#7a3e9d", "#c46b2d", "#d4d0c8", "#1a1410"];

  function loadProfile() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch (_) {}
    if (!p || !p.id) {
      p = {
        id: "P" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36),
        name: "Stranger",
        color: COLOR_SET[0],
        icon: "initial",
      };
      saveProfile(p);
    }
    return p;
  }
  function saveProfile(p) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  }
  let profile = loadProfile();

  function profileGlyph(p, name) {
    const n = (name || p.name || "S").trim() || "S";
    if (!p.icon || p.icon === "initial") return n.slice(0, 1).toUpperCase();
    const found = ICON_SET.find((x) => x.id === p.icon);
    return (found && found.glyph) || n.slice(0, 1).toUpperCase();
  }
  function avatarStyle(color) {
    return `background:${color || "#2a1c12"};color:#f3ead8`;
  }

  const net = {
    role: "solo",
    clientId: null,
    hostId: null,
    code: null,
    polling: false,
    lobby: null,
    transport: "http",
  };

  const state = {
    screen: "home",
    muted: false,
    busy: false,
    selected: new Set(),
    round: 0,
    tableType: "K",
    current: 0,
    lastPlay: null,
    players: [],
    started: false,
    revealPlay: false,
    netOverlay: null,
    waitingFor: null,
    cancelPull: null,
    myId: 0,
  };

  /* ---------- audio ---------- */
  let ctx, master, noiseBuf, hbTimer = null, droneOsc = null;
  const SAMPLE_URLS = {
    bang: "assets/sfx/gun-bang.mp3",
    click: "assets/sfx/gun-click.mp3",
    spin: "assets/sfx/gun-spin.mp3",
    cock: "assets/sfx/gun-cock.mp3",
    cockMove: "assets/sfx/gun-cock-move.mp3",
    heart: "assets/sfx/heartbeat.mp3",
  };
  const samples = {};
  let samplesLoading = false;
  function loadSamples() {
    if (samplesLoading || !ctx) return;
    samplesLoading = true;
    Object.entries(SAMPLE_URLS).forEach(([key, url]) => {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => ctx.decodeAudioData(buf))
        .then((audioBuf) => { samples[key] = audioBuf; })
        .catch(() => {});
    });
  }
  function playSample(name, opts = {}) {
    if (state.muted) return null;
    const buf = samples[name];
    if (!buf) return null;
    const a = audio();
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    const g = a.createGain();
    const gain = opts.gain == null ? 1 : opts.gain;
    const t = a.currentTime + (opts.delay || 0);
    g.gain.setValueAtTime(Math.max(gain, 0.0001), t);
    src.connect(g).connect(master);
    const off = opts.offset || 0;
    if (opts.duration) {
      src.start(t, off, opts.duration);
      g.gain.setValueAtTime(Math.max(gain, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
    } else {
      src.start(t, off);
    }
    return src;
  }
  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      loadSamples();
    }
    if (ctx.state === "suspended") ctx.resume();
    master.gain.value = state.muted ? 0 : 1;
    return ctx;
  }
  function envGain(t, peak, dur, attack = 0.008) {
    const g = audio().createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  }
  function osc(freq, dur, type, gain, delay = 0, slide = 0) {
    if (state.muted) return;
    const a = audio();
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 20), t + dur);
    o.connect(envGain(t, gain, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noiseBurst(dur, gain, delay, startHz, endHz) {
    if (state.muted) return;
    const a = audio();
    const t = a.currentTime + delay;
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(startHz, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(endHz, 40), t + dur);
    src.connect(f).connect(envGain(t, gain, dur, 0.004));
    src.start(t);
    src.stop(t + dur + 0.05);
  }
  function metalTick(delay = 0, gain = 0.08) {
    osc(1800 + Math.random() * 900, 0.04, "square", gain * 0.35, delay);
    osc(220 + Math.random() * 40, 0.07, "triangle", gain, delay);
    noiseBurst(0.05, gain * 0.5, delay, 2500, 400);
  }
  let heartSrc = null;
  let hbPeriod = 1180;
  let hbTarget = 1180;
  function stopHeart() {
    if (heartSrc) {
      try { heartSrc.stop(); } catch (_) {}
      heartSrc = null;
    }
  }
  function stopTension() {
    if (hbTimer) { clearTimeout(hbTimer); hbTimer = null; }
    stopHeart();
    if (droneOsc) {
      try { droneOsc.stop(); } catch (_) {}
      droneOsc = null;
    }
  }
  function startHeartbeat(period) {
    hbTarget = period;
    if (hbTimer) return;
    hbPeriod = period;
    const beat = () => {
      if (!hbTimer) return;
      stopHeart();
      const buf = samples.heart;
      if (buf && !state.muted) {
        const a = audio();
        const src = a.createBufferSource();
        src.buffer = buf;
        const dur = buf.duration || 1.2;
        src.playbackRate.value = Math.min(1.7, Math.max(1, dur / Math.max(hbPeriod / 1000, 0.45)));
        const g = a.createGain();
        g.gain.value = 1.05;
        src.connect(g).connect(master);
        src.start();
        heartSrc = src;
        src.onended = () => { if (heartSrc === src) heartSrc = null; };
      } else {
        osc(48, 0.16, "sine", 0.22);
        osc(32, 0.22, "sine", 0.14, 0.04);
      }
      hbPeriod += (hbTarget - hbPeriod) * 0.4;
      if (Math.abs(hbTarget - hbPeriod) < 16) hbPeriod = hbTarget;
      hbTimer = setTimeout(beat, hbPeriod);
    };
    hbTimer = setTimeout(beat, 40);
  }
  function startDrone() {
    if (state.muted) return;
    const a = audio();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "sine";
    o.frequency.value = 46;
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.linearRampToValueAtTime(0.045, a.currentTime + 1.4);
    o.connect(g).connect(master);
    o.start();
    droneOsc = o;
  }
  const sfx = {
    card: () => { osc(190, 0.05, "triangle", 0.05); noiseBurst(0.05, 0.04, 0, 1800, 500); },
    play: () => { noiseBurst(0.12, 0.1, 0, 900, 180); osc(90, 0.16, "sine", 0.07); },
    deal: () => { noiseBurst(0.06, 0.05, 0, 1600, 400); osc(240 + Math.random() * 80, 0.05, "triangle", 0.035); },
    liar: () => { osc(70, 0.45, "sawtooth", 0.07); noiseBurst(0.25, 0.1, 0, 700, 120); osc(55, 0.5, "sine", 0.08, 0.05); },
    cock: () => {
      const a = playSample("cockMove", { gain: 1.35 });
      if (!a) {
        metalTick(0, 0.1);
        osc(140, 0.12, "square", 0.05, 0.09);
        noiseBurst(0.1, 0.08, 0.1, 2200, 300);
      }
    },
    spin: () => {
      if (samples.spin) {
        for (let i = 0; i < 12; i++) {
          playSample("spin", {
            gain: Math.max(0.25, 1.05 - i * 0.06),
            rate: Math.max(0.55, 1 - i * 0.035),
            delay: 0.06 + i * (0.15 + i * 0.012),
          });
        }
      } else {
        for (let i = 0; i < 10; i++) metalTick(0.12 + i * (0.14 + i * 0.018), 0.055 - i * 0.002);
      }
    },
    click: () => {
      if (!playSample("click", { gain: 1.55, duration: 0.07 })) {
        osc(210, 0.05, "triangle", 0.16);
        noiseBurst(0.04, 0.1, 0, 2800, 500);
      }
    },
    bang: () => {
      const used = playSample("bang", { gain: 1.35 });
      noiseBurst(0.09, used ? 0.22 : 0.55, 0, 5000, 700);
      noiseBurst(0.45, used ? 0.18 : 0.38, 0.01, 700, 70);
      osc(48, 0.7, "sine", used ? 0.2 : 0.32);
      osc(78, 0.28, "sawtooth", used ? 0.06 : 0.1);
      noiseBurst(0.22, used ? 0.08 : 0.14, 0.18, 500, 90);
      osc(40, 0.9, "sine", used ? 0.08 : 0.12, 0.05, 28);
    },
    survive: () => { osc(196, 0.25, "sine", 0.05); osc(247, 0.4, "sine", 0.045, 0.12); },
    win: () => { osc(262, 0.25, "sine", 0.06); osc(330, 0.3, "sine", 0.05, 0.14); osc(392, 0.5, "sine", 0.06, 0.3); },
    sting: () => { osc(110, 0.28, "triangle", 0.05); osc(165, 0.2, "sine", 0.04, 0.08); },
  };

  /* ---------- helpers ---------- */
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const alive = () => state.players.filter((p) => p.alive);
  const nextAlive = (id) => {
    let i = id;
    for (let n = 0; n < 4; n++) {
      i = (i + 1) % 4;
      if (state.players[i].alive) return i;
    }
    return id;
  };
  const isTruth = (card) => card.rank === state.tableType || card.rank === "J";
  function sortHand(p) {
    const order = { J: 0 };
    order[state.tableType] = 1;
    p.hand.sort((a, b) => (order[a.rank] ?? 2) - (order[b.rank] ?? 2) || a.rank.localeCompare(b.rank));
  }
  function makeDeck() {
    const cards = [];
    let n = 0;
    for (const r of RANKS) for (let i = 0; i < 6; i++) cards.push({ id: `${r}${n++}`, rank: r });
    cards.push({ id: "J1", rank: "J" }, { id: "J2", rank: "J" });
    return shuffle(cards);
  }
  function myPlayer() {
    if (net.role === "solo") return state.players[0];
    return state.players.find((p) => p.clientId === net.clientId) || state.players[0];
  }
  function isLocal(p) {
    const me = myPlayer();
    return !!(me && p && me.id === p.id);
  }
  function visualSeat(playerId) {
    const me = myPlayer();
    const myId = me ? me.id : 0;
    return (playerId - myId + 4) % 4;
  }
  const isHostEngine = () => net.role === "solo" || net.role === "host";

  /* ---------- net ---------- */
  const LS_KEY = "liarsbar-net-v1";
  let bc = null;
  try { bc = new BroadcastChannel("liarsbar"); } catch (_) {}

  function busLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{"rooms":{},"clients":{}}'); }
    catch (_) { return { rooms: {}, clients: {} }; }
  }
  function busSave(db) {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
    try { if (bc) bc.postMessage({ t: "tick" }); } catch (_) {}
  }
  function busLobby(room, db) {
    return {
      type: "lobby",
      code: room.code,
      hostId: room.hostId,
      started: room.started,
      seats: room.seats.map((id) => {
        if (!id) return { empty: true, bot: true };
        const cl = db.clients[id];
        return {
          empty: false, bot: false, id,
          name: cl ? cl.name : "-",
          profileId: cl ? cl.profileId : "",
          color: cl ? cl.color : "#c9a227",
          icon: cl ? cl.icon : "initial",
        };
      }),
    };
  }
  function busPush(db, clientId, msg) {
    const cl = db.clients[clientId];
    if (!cl) return;
    cl.queue = cl.queue || [];
    cl.queue.push(msg);
  }
  function localApi(path, body) {
    const db = busLoad();
    if (path === "/api/create") {
      const name = String(body.name || "Stranger").trim().slice(0, 16) || "Stranger";
      const profileId = String(body.profileId || "");
      const color = String(body.color || "#c9a227");
      const icon = String(body.icon || "initial");
      const id = "L" + Math.random().toString(36).slice(2, 12);
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code;
      do {
        code = "";
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
      } while (db.rooms[code]);
      const room = { code, hostId: id, started: false, seats: [id, null, null, null] };
      db.rooms[code] = room;
      db.clients[id] = { id, name, room: code, queue: [], profileId, color, icon };
      busSave(db);
      return { ok: true, clientId: id, lobby: busLobby(room, db) };
    }
    if (path === "/api/join") {
      const name = String(body.name || "Stranger").trim().slice(0, 16) || "Stranger";
      const profileId = String(body.profileId || "");
      const color = String(body.color || "#c9a227");
      const icon = String(body.icon || "initial");
      const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      const room = db.rooms[code];
      if (!room) return { ok: false, error: "No table with that code on this device." };
      if (room.started) return { ok: false, error: "That table already started." };
      if (profileId && room.seats.some((sid) => sid && db.clients[sid] && db.clients[sid].profileId === profileId)) {
        return { ok: false, error: "This profile is already seated." };
      }
      const slot = room.seats.findIndex((s) => !s);
      if (slot < 0) return { ok: false, error: "Table is full." };
      const id = "L" + Math.random().toString(36).slice(2, 12);
      room.seats[slot] = id;
      db.clients[id] = { id, name, room: code, queue: [], profileId, color, icon };
      const lobby = busLobby(room, db);
      room.seats.forEach((sid) => { if (sid && sid !== id) busPush(db, sid, lobby); });
      busSave(db);
      return { ok: true, clientId: id, lobby };
    }
    if (path === "/api/kick") {
      const host = db.clients[body.clientId];
      if (!host) return { ok: false, error: "Not at a table." };
      const room = db.rooms[host.room];
      if (!room || room.hostId !== host.id) return { ok: false, error: "Only the host can kick." };
      if (room.started) return { ok: false, error: "Game already started." };
      const targetId = body.targetId;
      if (!targetId || targetId === host.id || !room.seats.includes(targetId)) {
        return { ok: false, error: "Can't kick that seat." };
      }
      busPush(db, targetId, { type: "kicked" });
      const idx = room.seats.indexOf(targetId);
      if (idx >= 0) room.seats[idx] = null;
      delete db.clients[targetId];
      const lobby = busLobby(room, db);
      room.seats.forEach((sid) => { if (sid) busPush(db, sid, lobby); });
      busSave(db);
      return { ok: true, lobby };
    }
    if (path === "/api/leave") {
      const cl = db.clients[body.clientId];
      if (cl) {
        const room = db.rooms[cl.room];
        if (room) {
          const idx = room.seats.indexOf(body.clientId);
          if (idx >= 0) room.seats[idx] = null;
          const lobby = busLobby(room, db);
          room.seats.forEach((sid) => {
            if (sid) busPush(db, sid, { type: "peerLeft", clientId: body.clientId, lobby });
          });
          if (!room.seats.filter(Boolean).length) delete db.rooms[cl.room];
          else if (room.hostId === body.clientId) {
            room.hostId = room.seats.find(Boolean);
            const lobby2 = busLobby(room, db);
            room.seats.forEach((sid) => { if (sid) busPush(db, sid, lobby2); });
          }
        }
        delete db.clients[body.clientId];
        busSave(db);
      }
      return { ok: true };
    }
    if (path === "/api/start") {
      const cl = db.clients[body.clientId];
      if (!cl) return { ok: false, error: "Not at a table." };
      const room = db.rooms[cl.room];
      if (!room || room.hostId !== cl.id) return { ok: false, error: "Only the host can start." };
      room.started = true;
      const lobby = busLobby(room, db);
      room.seats.forEach((sid) => {
        if (sid && sid !== cl.id) busPush(db, sid, { type: "start", lobby });
      });
      busSave(db);
      return { ok: true, lobby };
    }
    if (path === "/api/send") {
      const cl = db.clients[body.clientId];
      if (!cl) return { ok: false };
      const room = db.rooms[cl.room];
      if (!room) return { ok: false };
      const wrap = { type: "relay", from: cl.id, msg: body.msg };
      if (body.to === "all") room.seats.forEach((sid) => { if (sid && sid !== cl.id) busPush(db, sid, wrap); });
      else if (body.to === "host") { if (cl.id !== room.hostId) busPush(db, room.hostId, wrap); }
      else if (body.to) busPush(db, body.to, wrap);
      busSave(db);
      return { ok: true };
    }
    return { ok: false, error: "Unknown." };
  }

  async function api(path, body) {
    const q = new URLSearchParams();
    Object.entries(body || {}).forEach(([k, v]) => {
      q.set(k, typeof v === "string" ? v : JSON.stringify(v));
    });
    try {
      const r = await fetch(path + "?" + q.toString(), { method: "GET", cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (data && typeof data === "object") {
          net.transport = "http";
          return data;
        }
      }
    } catch (_) {}
    net.transport = "local";
    return localApi(path, body);
  }
  function netSend(msg, to) {
    if (!net.clientId) return;
    api("/api/send", { clientId: net.clientId, to, msg }).catch(() => {});
  }
  function snapshotFor(clientId) {
    const me = state.players.find((p) => p.clientId === clientId);
    return {
      round: state.round,
      tableType: state.tableType,
      current: state.current,
      busy: state.busy,
      started: state.started,
      claim: ui.claim.textContent,
      hint: ui.hint.textContent,
      lastPlay: state.lastPlay ? {
        playerId: state.lastPlay.playerId,
        count: state.lastPlay.cards.length,
        cards: state.revealPlay ? state.lastPlay.cards : null,
      } : null,
      players: state.players.map((p) => ({
        id: p.id, name: p.name, alive: p.alive, fired: p.fired,
        handCount: p.hand.length, isBot: p.isBot, portrait: p.portrait,
        clientId: p.clientId, color: p.color, icon: p.icon,
      })),
      myId: me ? me.id : -1,
      myHand: me ? me.hand : [],
      overlay: state.netOverlay,
    };
  }
  function broadcast() {
    if (net.role !== "host") return;
    for (const p of state.players) {
      if (p.clientId && p.clientId !== net.clientId) {
        netSend({ type: "state", snap: snapshotFor(p.clientId) }, p.clientId);
      }
    }
  }
  async function pollLoop() {
    net.polling = true;
    while (net.clientId && net.polling) {
      try {
        let messages = [];
        if (net.transport === "local") {
          const db = busLoad();
          const cl = db.clients[net.clientId];
          if (!cl) messages = [{ type: "gone" }];
          else {
            messages = (cl.queue || []).splice(0, cl.queue.length);
            busSave(db);
          }
          await wait(350);
        } else {
          const r = await fetch("/api/poll?id=" + encodeURIComponent(net.clientId), { cache: "no-store" });
          const data = await r.json();
          messages = data.messages || [];
        }
        for (const m of messages) handleNet(m);
      } catch (_) {
        net.transport = "local";
        await wait(400);
      }
    }
  }
  function handleNet(m) {
    if (!m) return;
    if (m.type === "gone") {
      kickHome("Table closed.");
      return;
    }
    if (m.type === "kicked") {
      net.polling = false;
      net.clientId = null;
      net.role = "solo";
      state.started = false;
      hideOverlay();
      showLobbyError("The host asked you to leave.");
      showScreen("lobby");
      return;
    }
    if (m.type === "lobby" || (m.lobby && m.type !== "start")) {
      net.lobby = m.lobby || m;
      net.hostId = net.lobby.hostId;
      renderLobbyRoom(net.lobby);
    }
    if (m.type === "start") {
      net.lobby = m.lobby;
      if (net.role === "guest") {
        showScreen("game");
        ui.hint.textContent = "The host is dealing...";
      }
    }
    if (m.type === "peerLeft") {
      net.lobby = m.lobby || net.lobby;
      if (net.lobby) renderLobbyRoom(net.lobby);
      if (net.role === "host" && state.started) onPeerLeft(m.clientId);
    }
    if (m.type === "relay" && m.msg) {
      if (net.role === "guest" && m.msg.type === "state") applySnapshot(m.msg.snap);
      if (net.role === "host" && m.msg.type === "action") handleRemoteAction(m.from, m.msg);
    }
  }
  function kickHome(msg) {
    net.polling = false;
    if (net.clientId) api("/api/leave", { clientId: net.clientId }).catch(() => {});
    net.clientId = null;
    net.role = "solo";
    state.started = false;
    if (msg) showLobbyError(msg);
    showScreen("home");
  }

  /* ---------- navigation ---------- */
  function showScreen(name) {
    state.screen = name;
    Object.entries(ui.screens).forEach(([k, el]) => {
      if (el) el.classList.toggle("is-active", k === name);
    });
    document.body.style.overflow = name === "game" ? "hidden" : "";
    if (name === "game" && !state.started && net.role !== "guest") {
      net.role = "solo";
      startMatch(soloPlayers());
    }
  }

  document.addEventListener("click", (e) => {
    try { audio(); } catch (_) {}
    const go = e.target.closest("[data-go]");
    if (!go) return;
    const dest = go.dataset.go;
    if (dest === "game") {
      if (state.screen === "lobby" && net.clientId) return;
      net.role = "solo";
      showScreen("game");
    } else if (dest === "home") {
      if (state.screen === "game" && state.started) leaveTable();
      else {
        if (net.clientId && state.screen === "lobby") kickHome();
        else showScreen("home");
      }
    } else showScreen(dest);
  });

  $("#btn-leave").addEventListener("click", leaveTable);
  ui.mute.addEventListener("click", () => {
    state.muted = !state.muted;
    if (state.muted) stopTension();
    try { audio(); } catch (_) {}
    ui.mute.textContent = state.muted ? "×" : "♪";
  });
  $("#btn-rules").addEventListener("click", () => {
    ui.overlay.onclick = null;
    openOverlay();
    ui.overlayCard.innerHTML = `
      <p class="eyebrow">House rules</p>
      <h2>Quick reminder</h2>
      <p style="text-align:left;max-width:36ch;margin:12px auto 0">Play 1-3 cards as ${RANK_NAME[state.tableType] || "the table card"}. Jokers always count. Mixing in a fake makes the whole play a lie. The next player can call Liar. Loser takes the barrel.</p>
      <div class="actions"><button class="btn btn-gold" id="btn-rules-close">Got it</button></div>`;
    $("#btn-rules-close").onclick = hideOverlay;
  });

  function leaveTable() {
    if (state.started && !confirm("Leave the table? This match ends.")) return;
    if (state.cancelPull) state.cancelPull();
    stopTension();
    hideOverlay();
    state.started = false;
    state.busy = false;
    if (net.clientId) kickHome();
    else showScreen("home");
  }

  /* ---------- lobby ---------- */
  function playerNameInput() {
    const v = ui.lobbyName && ui.lobbyName.value;
    return String(v || profile.name || "Stranger").trim().slice(0, 16) || "Stranger";
  }
  function persistProfileFromForm() {
    profile.name = playerNameInput();
    saveProfile(profile);
    paintProfile();
  }
  function profilePayload() {
    persistProfileFromForm();
    return { name: profile.name, profileId: profile.id, color: profile.color, icon: profile.icon };
  }
  function paintProfile() {
    if (!ui.profileAvatar) return;
    ui.profileAvatar.textContent = profileGlyph(profile, profile.name);
    ui.profileAvatar.style.background = profile.color || "#2a1c12";
    ui.profileAvatar.style.color = "#f3ead8";
    if (ui.lobbyName && document.activeElement !== ui.lobbyName) ui.lobbyName.value = profile.name || "";
    if (ui.iconPicks) {
      ui.iconPicks.innerHTML = ICON_SET.map((ic) => {
        const g = ic.id === "initial" ? (profile.name || "S").slice(0, 1).toUpperCase() : ic.glyph;
        return `<button type="button" class="pick${profile.icon === ic.id ? " is-on" : ""}" data-icon="${ic.id}">${g}</button>`;
      }).join("");
    }
    if (ui.colorPicks) {
      ui.colorPicks.innerHTML = COLOR_SET.map((c) =>
        `<button type="button" class="pick${profile.color === c ? " is-on" : ""}" data-color="${c}" style="background:${c}"></button>`
      ).join("");
    }
  }
  function showLobbyError(text) {
    ui.lobbyError.hidden = !text;
    ui.lobbyError.textContent = text || "";
  }
  function renderLobbyRoom(lobby) {
    if (!lobby) return;
    ui.lobbyRoom.hidden = false;
    ui.roomCode.textContent = lobby.code;
    net.code = lobby.code;
    net.hostId = lobby.hostId;
    const isHost = net.clientId === lobby.hostId;
    ui.btnStartMp.hidden = !isHost || lobby.started;
    ui.lobbySeats.innerHTML = lobby.seats.map((s, i) => {
      if (s.empty) {
        const b = BOTS[i % 3];
        return `<div class="lobby-seat is-bot"><img src="${b.portrait}" alt=""><div class="seat-main"><strong>${b.name}</strong><span>Bot will sit</span></div></div>`;
      }
      const you = s.id === net.clientId;
      const glyph = profileGlyph({ icon: s.icon || "initial", name: s.name }, s.name);
      const kick = isHost && !you
        ? `<button type="button" class="kick-btn" data-kick="${s.id}">Kick</button>`
        : "";
      return `<div class="lobby-seat${you ? " is-you" : ""}"><div class="ini" style="${avatarStyle(s.color)}">${esc(glyph)}</div><div class="seat-main"><strong>${esc(s.name)}</strong><span>${you ? "You" : s.id === lobby.hostId ? "Host" : "Player"}</span></div>${kick}</div>`;
    }).join("");
  }

  paintProfile();
  if (ui.lobbyName) {
    ui.lobbyName.addEventListener("input", () => {
      profile.name = playerNameInput();
      saveProfile(profile);
      paintProfile();
    });
  }
  if (ui.iconPicks) {
    ui.iconPicks.addEventListener("click", (e) => {
      const b = e.target.closest("[data-icon]");
      if (!b) return;
      profile.icon = b.dataset.icon;
      saveProfile(profile);
      paintProfile();
    });
  }
  if (ui.colorPicks) {
    ui.colorPicks.addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (!b) return;
      profile.color = b.dataset.color;
      saveProfile(profile);
      paintProfile();
    });
  }
  if (ui.lobbySeats) {
    ui.lobbySeats.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-kick]");
      if (!b) return;
      const data = await api("/api/kick", { clientId: net.clientId, targetId: b.dataset.kick });
      if (!data.ok) return showLobbyError(data.error || "Couldn't kick.");
      net.lobby = data.lobby;
      renderLobbyRoom(data.lobby);
    });
  }

  async function dropSeat() {
    net.polling = false;
    const id = net.clientId;
    net.clientId = null;
    if (id) {
      try { await api("/api/leave", { clientId: id }); } catch (_) {}
    }
  }

  $("#btn-create").addEventListener("click", async () => {
    showLobbyError("");
    await dropSeat();
    try {
      const data = await api("/api/create", profilePayload());
      if (!data.ok) return showLobbyError(data.error || "Couldn't open a table.");
      net.role = "host";
      net.clientId = data.clientId;
      net.lobby = data.lobby;
      net.hostId = data.lobby.hostId;
      renderLobbyRoom(data.lobby);
      pollLoop();
    } catch (err) {
      const data = localApi("/api/create", profilePayload());
      net.transport = "local";
      net.role = "host";
      net.clientId = data.clientId;
      net.lobby = data.lobby;
      net.hostId = data.lobby.hostId;
      renderLobbyRoom(data.lobby);
      pollLoop();
    }
  });
  $("#btn-join").addEventListener("click", joinTable);
  ui.lobbyCode.addEventListener("keydown", (e) => { if (e.key === "Enter") joinTable(); });
  async function joinTable() {
    showLobbyError("");
    const code = ui.lobbyCode.value.trim();
    if (!code) return showLobbyError("Enter a table code.");
    const want = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (net.clientId && net.code === want) return showLobbyError("You're already at this table.");
    if (net.clientId && net.code !== want) await dropSeat();
    try {
      const data = await api("/api/join", { ...profilePayload(), code });
      if (!data.ok) return showLobbyError(data.error || "Couldn't join.");
      net.role = "guest";
      net.clientId = data.clientId;
      net.lobby = data.lobby;
      net.hostId = data.lobby.hostId;
      renderLobbyRoom(data.lobby);
      pollLoop();
    } catch (_) {
      const data = localApi("/api/join", { ...profilePayload(), code });
      if (!data.ok) return showLobbyError(data.error || "Couldn't join.");
      net.transport = "local";
      net.role = "guest";
      net.clientId = data.clientId;
      net.lobby = data.lobby;
      net.hostId = data.lobby.hostId;
      renderLobbyRoom(data.lobby);
      pollLoop();
    }
  }
  ui.btnStartMp.addEventListener("click", async () => {
    try {
      const data = await api("/api/start", { clientId: net.clientId });
      if (!data.ok) return showLobbyError(data.error || "Couldn't start.");
      net.lobby = data.lobby;
      startMatch(playersFromLobby(data.lobby));
      showScreen("game");
    } catch (_) {
      showLobbyError("Couldn't start.");
    }
  });

  function soloPlayers() {
    persistProfileFromForm();
    return [
      { id: 0, name: profile.name || "You", isBot: false, clientId: null, portrait: null, persona: null, color: profile.color, icon: profile.icon },
      ...BOTS.map((b, i) => ({ id: i + 1, name: b.name, isBot: true, clientId: null, portrait: b.portrait, persona: b.persona })),
    ];
  }
  function playersFromLobby(lobby) {
    let bot = 0;
    return lobby.seats.map((s, i) => {
      if (!s.empty) {
        return { id: i, name: s.name, isBot: false, clientId: s.id, portrait: null, persona: null, color: s.color, icon: s.icon };
      }
      const b = BOTS[bot++ % 3];
      return { id: i, name: b.name, isBot: true, clientId: null, portrait: b.portrait, persona: b.persona };
    });
  }

  /* ---------- match ---------- */
  function startMatch(list) {
    state.started = true;
    state.round = 0;
    state.selected.clear();
    state.busy = false;
    state.lastPlay = null;
    state.revealPlay = false;
    hideOverlay();
    state.players = list.map((p) => ({
      ...p,
      alive: true,
      hand: [],
      fired: 0,
      bullet: 1 + Math.floor(Math.random() * 6),
      isHuman: !p.isBot,
    }));
    const me = myPlayer();
    state.myId = me ? me.id : 0;
    renderSeats();
    beginRound(Math.floor(Math.random() * 4));
  }

  function onPeerLeft(clientId) {
    const p = state.players.find((x) => x.clientId === clientId);
    if (!p || !p.alive) return;
    const b = BOTS.find((x) => !state.players.some((pl) => pl.name === x.name)) || BOTS[2];
    p.isBot = true;
    p.isHuman = false;
    p.clientId = null;
    p.persona = b.persona;
    p.portrait = b.portrait;
    p.name = p.name + "";
    say(p, "The house takes this chair.");
    renderSeats();
    broadcast();
    if (state.waitingFor && state.waitingFor.playerId === p.id) {
      const kind = state.waitingFor.kind;
      state.waitingFor = null;
      if (kind === "pull" && state.cancelPull) state.cancelPull();
      else turn();
    }
  }

  function nextActor(fromId) {
    const withCards = alive().filter((p) => p.hand.length > 0);
    if (withCards.length === 0) {
      return { player: state.players[nextAlive(fromId)], forcedCall: !!state.lastPlay };
    }
    let id = fromId;
    for (let i = 0; i < 4; i++) {
      id = nextAlive(id);
      if (state.players[id].hand.length > 0) return { player: state.players[id], forcedCall: false };
    }
    return { player: state.players[nextAlive(fromId)], forcedCall: !!state.lastPlay };
  }

  async function beginRound(firstId) {
    if (!state.started || !isHostEngine()) return;
    const living = alive();
    if (living.length <= 1) return endMatch();

    state.round += 1;
    state.tableType = pick(RANKS);
    state.lastPlay = null;
    state.revealPlay = false;
    state.selected.clear();
    state.busy = true;

    const deck = makeDeck();
    living.forEach((p) => { p.hand = deck.splice(0, 5); sortHand(p); });
    state.players.filter((p) => !p.alive).forEach((p) => { p.hand = []; });

    let start = firstId;
    if (!state.players[start]?.alive) start = nextAlive(start);
    state.current = start;

    ui.round.textContent = `Round ${state.round}`;
    ui.tableLabel.textContent = `${RANK_NAME[state.tableType]} table`;
    ui.badgeRank.textContent = RANK_NAME[state.tableType];
    ui.pile.innerHTML = "";
    ui.claim.textContent = "";
    renderAll();
    sfx.sting();
    for (let i = 0; i < 5; i++) setTimeout(() => sfx.deal(), i * 85);

    await splash({
      kicker: `Round ${state.round}`,
      title: RANK_NAME[state.tableType],
      body: `Everyone claims ${RANK_NAME[state.tableType]}. Jokers always count.`,
      auto: 1500,
      splashRank: true,
    });
    if (!state.started) return;
    await turn();
  }

  async function turn() {
    if (!state.started || !isHostEngine()) return;
    if (alive().length <= 1) return endMatch();

    let p = state.players[state.current];
    if (!p || !p.alive) {
      state.current = nextAlive(state.current);
      p = state.players[state.current];
    }
    if (p.hand.length === 0) {
      const nxt = nextActor(p.id);
      if (nxt.forcedCall) return callLiar(nxt.player);
      state.current = nxt.player.id;
      return turn();
    }

    renderAll();
    setHint(p);
    broadcast();

    if (p.isBot) {
      state.busy = true;
      updateButtons();
      await wait(750 + Math.random() * 850);
      if (!state.started) return;
      const decision = aiDecide(p);
      if (decision.action === "liar") {
        say(p, pick(p.persona.lines.liar));
        await wait(320);
        return callLiar(p);
      }
      say(p, pick(p.persona.lines.play));
      await wait(180);
      return playCards(p, decision.cards);
    }

    if (isLocal(p)) {
      state.busy = false;
      updateButtons();
      broadcast();
      return;
    }

    state.busy = true;
    state.waitingFor = { kind: "turn", playerId: p.id };
    updateButtons();
    broadcast();
  }

  function handleRemoteAction(fromId, msg) {
    const p = state.players.find((x) => x.clientId === fromId);
    if (!p || !state.started) return;
    if (msg.action === "pull") {
      if (state.waitingFor?.kind === "pull" && state.waitingFor.playerId === p.id && state.cancelPull) {
        const fn = state.cancelPull;
        state.cancelPull = null;
        state.waitingFor = null;
        fn();
      }
      return;
    }
    if (state.waitingFor?.kind !== "turn" || state.waitingFor.playerId !== p.id) return;
    if (state.current !== p.id) return;
    state.waitingFor = null;
    if (msg.action === "liar") return callLiar(p);
    if (msg.action === "play") {
      const ids = new Set(msg.cardIds || []);
      const cards = p.hand.filter((c) => ids.has(c.id));
      if (cards.length >= 1 && cards.length <= 3) return playCards(p, cards);
      state.waitingFor = { kind: "turn", playerId: p.id };
    }
  }

  function setHint(p) {
    if (!p || !p.alive) { ui.hint.textContent = ""; return; }
    if (isLocal(p)) {
      ui.hint.textContent = state.lastPlay ? "Play 1-3 cards, or call Liar" : "Play 1-3 cards";
      ui.youStatus.textContent = "Your move.";
    } else {
      ui.hint.textContent = p.isBot ? `${p.name} is watching the table...` : `Waiting on ${p.name}...`;
      ui.youStatus.textContent = "";
    }
  }

  function aiDecide(p) {
    const truths = p.hand.filter(isTruth);
    const lies = p.hand.filter((c) => !isTruth(c));
    const persona = p.persona || BOTS[2].persona;
    if (state.lastPlay) {
      const maxPossible = 8 - truths.length;
      const claimed = state.lastPlay.cards.length;
      if (claimed > maxPossible) return { action: "liar" };
      if (p.hand.length === 0) return { action: "liar" };
      let chance = persona.call;
      if (claimed === 3) chance += 0.22;
      if (claimed === 2) chance += 0.08;
      if (claimed > maxPossible - 2) chance += 0.25;
      if (truths.length >= 3 && claimed >= 2) chance += 0.12;
      if (p.hand.length <= 1) chance += 0.15;
      if (Math.random() < Math.min(0.92, chance)) return { action: "liar" };
    }
    if (p.hand.length === 0) return { action: "liar" };
    const wantBluff = (truths.length === 0) || (Math.random() < persona.bluff && lies.length > 0 && truths.length < 3);
    const pool = wantBluff && lies.length ? lies : (truths.length ? truths : p.hand);
    let n = 1;
    if (pool.length >= 2 && Math.random() < 0.55) n = 2;
    if (pool.length >= 3 && Math.random() < persona.three) n = 3;
    n = Math.min(n, pool.length, 3);
    return { action: "play", cards: pool.slice(0, n) };
  }

  async function playCards(player, cards) {
    if (!isHostEngine()) return;
    if (isLocal(player)) {
      if (state.busy) return;
      state.busy = true;
    }
    if (!cards.length) {
      if (state.lastPlay) return callLiar(player);
      state.busy = false;
      return;
    }
    updateButtons();
    player.hand = player.hand.filter((c) => !cards.includes(c));
    state.lastPlay = { playerId: player.id, cards };
    state.revealPlay = false;
    state.selected.clear();
    sfx.play();
    renderAll();
    ui.claim.textContent = `${player.name} played ${cards.length} ${cards.length === 1 ? RANK_ONE[state.tableType] : RANK_NAME[state.tableType]}`;
    broadcast();
    const nxt = nextActor(player.id);
    await wait(320);
    if (nxt.forcedCall) return callLiar(nxt.player);
    state.current = nxt.player.id;
    return turn();
  }

  async function callLiar(caller) {
    if (!isHostEngine()) return;
    if (!state.lastPlay) return turn();
    state.busy = true;
    updateButtons();
    sfx.liar();
    const accused = state.players[state.lastPlay.playerId];
    const cards = state.lastPlay.cards;
    const honest = cards.every(isTruth);

    await splash({
      kicker: `${esc(caller.name)} calls`,
      title: "LIAR",
      body: `Revealing ${esc(accused.name)}'s ${cards.length === 1 ? "card" : "cards"}...`,
      auto: 900,
    });
    if (!state.started) return;

    state.revealPlay = true;
    renderPile(true);
    broadcast();
    const row = cards.map((c) => cardFaceHTML(c, true, isTruth(c) ? "truth" : "lie")).join("");
    await splash({
      kicker: honest ? "Every card matches" : "A fake in the pile",
      title: honest ? "Truth" : "Caught",
      body: honest
        ? `${esc(accused.name)} told the truth. ${esc(caller.name)} faces the barrel.`
        : `${esc(accused.name)} lied. The revolver is theirs.`,
      extra: `<div class="reveal-row">${row}</div>`,
      auto: 1600,
    });
    if (!state.started) return;
    if (honest) say(accused, pick(accused.persona?.lines.truth || ["."]));
    else say(accused, pick(accused.persona?.lines.caught || ["."]));
    await roulette(honest ? caller : accused);
  }

  function setPullStatus(text) {
    const el = $("#pull-status");
    if (el) el.textContent = text;
    if (state.netOverlay && state.netOverlay.type === "roulette") {
      state.netOverlay.status = text;
      broadcast();
    }
  }

  function waitForPull(player) {
    if (player.isBot) {
      return wait(1600 + Math.random() * 1800);
    }
    if (isLocal(player)) {
      return new Promise((resolve) => {
        const btn = $("#btn-pull");
        const go = () => {
          if (btn) btn.disabled = true;
          state.cancelPull = null;
          resolve();
        };
        state.cancelPull = go;
        if (btn) btn.addEventListener("click", go, { once: true });
        else setTimeout(go, 600);
      });
    }
    return new Promise((resolve) => {
      state.waitingFor = { kind: "pull", playerId: player.id };
      state.cancelPull = () => { state.waitingFor = null; resolve(); };
      broadcast();
    });
  }

  async function roulette(player) {
    player.fired += 1;
    const fatal = player.fired >= player.bullet;
    const chamberIndex = player.fired - 1;
    const left = 7 - player.fired;
    const showPull = isLocal(player);

    ui.overlay.onclick = null;
    hideOverlay(true);
    openOverlay();
    ui.overlay.classList.add("is-roulette");
    state.netOverlay = {
      type: "roulette", name: player.name, fired: player.fired, left,
      status: showPull || player.isBot ? (isLocal(player) ? "Your shot." : `${player.name} picks up the gun.`) : `Waiting on ${player.name}...`,
      result: null, showPull: false, targetId: player.id, spin: 0, chamberIndex,
    };
    paintRoulette(state.netOverlay, showPull);
    placeCylinders();
    broadcast();

    if (player.isBot) {
      await wait(1600 + Math.random() * 1400);
      setPullStatus(`${player.name} raises it.`);
      await wait(1200);
    } else {
      await waitForPull(player);
    }
    if (!state.started) { stopTension(); return; }

    const holdBtn = $("#btn-pull");
    if (holdBtn) holdBtn.parentElement?.remove();
    if (state.netOverlay) state.netOverlay.showPull = false;

    setPullStatus("The hammer goes back...");
    sfx.cock();
    await wait(1100);
    if (!state.started) { stopTension(); return; }

    startHeartbeat(1180);
    setPullStatus("Cylinder turns.");
    const spinTo = 360 * 2 + (chamberIndex + 1) * 60;
    const cylEl = $(".cylinder");
    if (cylEl) {
      cylEl.style.transition = "transform 3.4s cubic-bezier(.15,.7,.1,1)";
      cylEl.style.transform = `rotate(${spinTo}deg)`;
    }
    if (state.netOverlay) state.netOverlay.spin = spinTo;
    sfx.spin();
    broadcast();
    await wait(2200);
    if (!state.started) { stopTension(); return; }

    setPullStatus("Finger on the trigger.");
    await wait(1600);
    startHeartbeat(780);
    startDrone();
    await wait(1800);
    if (!state.started) { stopTension(); return; }

    setPullStatus("...");
    startHeartbeat(560);
    await wait(1600);
    stopTension();
    await wait(950);
    if (!state.started) return;

    const result = $("#roulette-result");
    ui.overlay.classList.remove("is-roulette");

    if (fatal) {
      ui.overlay.classList.add("flash-bang");
      sfx.bang();
      $$(".cyl-ch")[chamberIndex]?.classList.add("is-dead");
      setPullStatus("");
      if (result) result.innerHTML = `<span class="bang">BANG</span>`;
      if (state.netOverlay) { state.netOverlay.result = "BANG"; state.netOverlay.sfx = "bang"; }
      broadcast();
      player.alive = false;
      player.hand = [];
      await wait(2200);
      ui.overlay.classList.remove("flash-bang");
      hideOverlay();
      renderAll();
      if (alive().length <= 1) return endMatch();
      await splash({
        kicker: "Empty chair",
        title: `${esc(player.name)} is out`,
        body: alive().length === 2 ? "Two remain." : "The table gets quieter.",
        auto: 1600,
      });
      if (!state.started) return;
      return beginRound(nextAlive(player.id));
    }

    ui.overlay.classList.add("flash-click");
    sfx.click();
    $$(".cyl-ch")[chamberIndex]?.classList.add("is-blank");
    setPullStatus("");
    if (result) result.innerHTML = `<span class="click">CLICK</span>`;
    if (state.netOverlay) { state.netOverlay.result = "CLICK"; state.netOverlay.sfx = "click"; }
    broadcast();
    await wait(900);
    sfx.survive();
    await wait(1600);
    ui.overlay.classList.remove("flash-click");
    hideOverlay();
    renderAll();
    await splash({
      kicker: esc(player.name),
      title: "Still here",
      body: `${6 - player.fired} chambers left. New hand.`,
      auto: 1400,
    });
    if (!state.started) return;
    return beginRound(player.id);
  }

  function paintRoulette(o, showPull) {
    ui.overlayCard.innerHTML = `
      <p class="eyebrow">${esc(o.name)}</p>
      <h2>The barrel</h2>
      <p>${o.fired} of 6 · ${o.left === 1 ? "Last chamber" : o.left + " chambers left"}</p>
      ${cylinderHTML()}
      <p id="pull-status" class="pull-status">${esc(o.status || "")}</p>
      <p id="roulette-result" class="roulette-result">${o.result === "BANG" ? '<span class="bang">BANG</span>' : o.result === "CLICK" ? '<span class="click">CLICK</span>' : ""}</p>
      ${showPull && !o.result ? `<div class="actions"><button class="btn btn-blood" id="btn-pull">Pull</button></div>` : ""}
    `;
  }

  function endMatch() {
    state.busy = true;
    const winner = alive()[0];
    sfx.win();
    const youWin = winner && isLocal(winner);
    const title = youWin ? "The bar is yours" : winner ? `${esc(winner.name)} walks` : "Empty bar";
    const body = youWin
      ? "They believed you, or they didn't, and paid for it."
      : "The house keeps your seat warm.";
    state.netOverlay = { type: "end", youWin, title, body };
    broadcast();
    openOverlay();
    ui.overlayCard.innerHTML = `
      <p class="eyebrow">${youWin ? "Last one standing" : "Match over"}</p>
      <h2>${title}</h2>
      <p>${body}</p>
      <div class="actions">
        <button class="btn btn-gold" id="btn-again">Play again</button>
        <button class="btn btn-ghost" id="btn-home">Leave</button>
      </div>`;
    $("#btn-again").onclick = () => {
      hideOverlay();
      if (net.role === "host" && net.lobby) startMatch(playersFromLobby(net.lobby));
      else startMatch(soloPlayers());
    };
    $("#btn-home").onclick = () => { hideOverlay(); state.started = false; leaveTable(); };
  }

  /* ---------- overlays ---------- */
  function hideOverlay(keepNet) {
    stopTension();
    ui.overlay.hidden = true;
    document.body.classList.remove("overlay-open");
    ui.overlay.classList.remove("is-roulette", "flash-bang", "flash-click");
    ui.overlayCard.innerHTML = "";
    ui.overlay.onclick = null;
    if (!keepNet) state.netOverlay = null;
  }
  function openOverlay() {
    ui.overlay.hidden = false;
    document.body.classList.add("overlay-open");
  }

  function splash({ kicker, title, body, extra = "", auto = 0, splashRank = false }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        ui.overlay.onclick = null;
        hideOverlay();
        broadcast();
        resolve();
      };
      state.netOverlay = { type: "splash", kicker, title, body, extra, splashRank };
      broadcast();
      openOverlay();
      ui.overlayCard.innerHTML = `
        <p class="eyebrow">${kicker || ""}</p>
        ${splashRank ? `<div class="rank-splash">${title}</div>` : `<h2>${title}</h2>`}
        <p>${body || ""}</p>
        ${extra}
        <p class="overlay-skip">Click to continue</p>`;
      const t = setTimeout(finish, auto || 1200);
      ui.overlay.onclick = () => { clearTimeout(t); finish(); };
    });
  }

  function cylinderHTML() {
    const ch = Array.from({ length: 6 }, (_, i) =>
      `<span class="cyl-ch" data-i="${i}"></span>`
    ).join("");
    return `<div class="cylinder" id="cylinder">${ch}</div>`;
  }
  function placeCylinders() {
    $$(".cyl-ch").forEach((el, i) => {
      const a = ((i * 60) - 90) * (Math.PI / 180);
      const r = 58;
      el.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`;
    });
  }

  /* ---------- guest snapshot ---------- */
  let lastGuestSfx = "";
  function applySnapshot(s) {
    if (!s) return;
    state.started = s.started;
    state.round = s.round;
    state.tableType = s.tableType;
    state.current = s.current;
    state.busy = s.busy;
    state.myId = s.myId;
    state.lastPlay = s.lastPlay ? {
      playerId: s.lastPlay.playerId,
      cards: s.lastPlay.cards || Array.from({ length: s.lastPlay.count }, (_, i) => ({ id: "x" + i, rank: "?" })),
    } : null;
    state.revealPlay = !!(s.lastPlay && s.lastPlay.cards);
    state.players = s.players.map((p) => ({
      ...p,
      hand: p.id === s.myId ? (s.myHand || []) : [],
      isHuman: !p.isBot,
      bullet: 9,
    }));
    ui.round.textContent = `Round ${s.round}`;
    ui.tableLabel.textContent = `${RANK_NAME[s.tableType] || "-"} table`;
    ui.badgeRank.textContent = RANK_NAME[s.tableType] || "-";
    ui.claim.textContent = s.claim || "";
    ui.hint.textContent = s.hint || "";
    renderAll();
    applyGuestOverlay(s.overlay);
  }
  function applyGuestOverlay(o) {
    if (!o) {
      if (!ui.overlay.hidden) hideOverlay();
      lastGuestSfx = "";
      return;
    }
    openOverlay();
    ui.overlay.onclick = null;
    if (o.type === "splash") {
      ui.overlay.classList.remove("is-roulette", "flash-bang", "flash-click");
      ui.overlayCard.innerHTML = `
        <p class="eyebrow">${o.kicker || ""}</p>
        ${o.splashRank ? `<div class="rank-splash">${o.title}</div>` : `<h2>${o.title}</h2>`}
        <p>${o.body || ""}</p>
        ${o.extra || ""}`;
    } else if (o.type === "roulette") {
      ui.overlay.classList.add("is-roulette");
      const me = myPlayer();
      const showPull = me && o.targetId === me.id && !o.result;
      paintRoulette(o, showPull);
      placeCylinders();
      const cylEl = $(".cylinder");
      if (cylEl && o.spin) {
        cylEl.style.transition = "transform 3.4s cubic-bezier(.15,.7,.1,1)";
        cylEl.style.transform = `rotate(${o.spin}deg)`;
      }
      if (showPull) {
        const btn = $("#btn-pull");
        if (btn) btn.onclick = () => {
          btn.disabled = true;
          netSend({ type: "action", action: "pull" }, "host");
        };
      }
      if (o.result === "BANG") ui.overlay.classList.add("flash-bang");
      if (o.result === "CLICK") ui.overlay.classList.add("flash-click");
      if (o.sfx && o.sfx !== lastGuestSfx) {
        lastGuestSfx = o.sfx;
        if (o.sfx === "bang") sfx.bang();
        if (o.sfx === "click") sfx.click();
      }
    } else if (o.type === "end") {
      ui.overlay.classList.remove("is-roulette");
      ui.overlayCard.innerHTML = `
        <p class="eyebrow">${o.youWin ? "Last one standing" : "Match over"}</p>
        <h2>${o.title}</h2>
        <p>${o.body}</p>
        <div class="actions"><button class="btn btn-ghost" id="btn-home">Leave</button></div>`;
      const b = $("#btn-home");
      if (b) b.onclick = () => leaveTable();
    }
  }

  /* ---------- render ---------- */
  function renderSeats() {
    state.players.forEach((p) => {
      const vis = visualSeat(p.id);
      const seat = $(`.seat[data-seat="${vis}"]`);
      if (!seat) return;
      const card = $(".seat-card", seat);
      const img = $(".portrait", seat);
      let ini = $(".seat-ini", seat);
      if (p.portrait) {
        if (img) { img.hidden = false; img.src = p.portrait; img.alt = p.name; }
        if (ini) ini.hidden = true;
      } else {
        if (img) { img.hidden = true; img.removeAttribute("src"); }
        if (card && vis !== 0) {
          if (!ini) {
            ini = document.createElement("div");
            ini.className = "ini seat-ini";
            card.insertBefore(ini, card.firstChild);
          }
          ini.hidden = false;
          ini.textContent = profileGlyph({ icon: p.icon || "initial", name: p.name }, p.name);
          ini.style.background = p.color || "#2a1c12";
          ini.style.color = "#f3ead8";
        }
      }
      const name = $(".seat-name", seat);
      if (name) name.textContent = p.name;
    });
  }

  function renderAll() {
    if (!state.players.length) return;
    const me = myPlayer();
    state.players.forEach((p) => {
      const vis = visualSeat(p.id);
      const seat = $(`.seat[data-seat="${vis}"]`);
      if (!seat) return;
      seat.classList.toggle("is-turn", p.alive && p.id === state.current);
      seat.classList.toggle("is-dead", !p.alive);
      const ch = $(".chambers", seat);
      if (ch) {
        ch.innerHTML = Array.from({ length: 6 }, (_, i) => {
          const on = i < p.fired;
          const kill = !p.alive && i === p.fired - 1;
          return `<span class="chamber${on ? " is-spent" : ""}${kill ? " is-kill" : ""}"></span>`;
        }).join("");
      }
      const mini = $(".mini-hand", seat);
      if (mini) {
        const n = p.alive ? (isLocal(p) ? 0 : p.hand.length || p.handCount || 0) : 0;
        mini.innerHTML = Array.from({ length: n }, () => `<span class="mini-card"></span>`).join("");
      }
    });
    if (me && ui.youName) ui.youName.textContent = me.name;
    const av = $(".you-avatar");
    if (av && me) {
      av.textContent = profileGlyph({ icon: me.icon || "initial", name: me.name }, me.name);
      if (me.color) {
        av.style.background = me.color;
        av.style.color = "#f3ead8";
        av.style.fontSize = "18px";
        av.style.letterSpacing = "0";
      }
    }
    renderPile(state.revealPlay);
    renderHand();
    updateButtons();
    ui.screens.game.classList.toggle("is-dead-you", !!(me && !me.alive));
    if (isHostEngine()) broadcast();
  }

  function renderPile(reveal) {
    const play = state.lastPlay;
    if (!play) { ui.pile.innerHTML = ""; return; }
    const cards = play.cards || [];
    ui.pile.innerHTML = cards.map((c, i) => {
      const r = (i - (cards.length - 1) / 2) * 8;
      if (reveal && c.rank && c.rank !== "?") {
        const ok = isTruth(c);
        return `<div class="pcard face-up ${ok ? "truth" : "lie"}" style="--r:${r}deg">${rankGlyph(c.rank)}</div>`;
      }
      return `<div class="pcard" style="--r:${r}deg"></div>`;
    }).join("");
  }

  function renderHand() {
    const me = myPlayer();
    if (!me) { ui.hand.innerHTML = ""; return; }
    const n = me.hand.length;
    ui.hand.innerHTML = me.hand.map((c, i) => {
      const tilt = n === 1 ? 0 : (i - (n - 1) / 2) * 6;
      const sel = state.selected.has(c.id) ? " is-selected" : "";
      const match = isTruth(c) ? " is-match" : "";
      return `<button class="card rank-${c.rank}${sel}${match}" data-id="${c.id}" style="--tilt:${tilt}deg" ${!me.alive ? "disabled" : ""}>
        ${cardFaceHTML(c)}
      </button>`;
    }).join("");
  }

  function rankGlyph(r) {
    return r === "K" ? "K" : r === "Q" ? "Q" : r === "A" ? "A" : "★";
  }
  function cardFaceHTML(c, compact = false, cls = "") {
    const g = rankGlyph(c.rank);
    if (compact) return `<div class="pcard face-up ${cls}">${g}</div>`;
    return `<div class="face">
      <span class="corner">${g}</span>
      <div class="pip">${c.rank === "J" ? "★" : g}</div>
      <span class="corner bl">${g}</span>
    </div>`;
  }

  function updateButtons() {
    const me = myPlayer();
    const myTurn = !!(me && me.alive && state.current === me.id && state.started);
    const hostTurn = isHostEngine() && myTurn && !state.busy;
    const guestTurn = net.role === "guest" && myTurn;
    const canAct = hostTurn || guestTurn;
    const n = state.selected.size;
    ui.playBtn.disabled = !(canAct && n >= 1 && n <= 3);
    ui.liarBtn.disabled = !(canAct && state.lastPlay);
    ui.playCount.textContent = n ? `(${n})` : "";
    if (!me?.alive) ui.youStatus.textContent = "You're out.";
    else if (!canAct && state.started) ui.youStatus.textContent = "";
  }

  function say(p, text) {
    if (!p || isLocal(p) || !text) return;
    const seat = $(`.seat[data-seat="${visualSeat(p.id)}"]`);
    if (!seat) return;
    const b = $(".bubble", seat);
    if (!b) return;
    b.hidden = false;
    b.textContent = text;
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.hidden = true; }, 1600);
  }

  /* ---------- input ---------- */
  function submitPlay() {
    const me = myPlayer();
    if (!me) return;
    const cards = me.hand.filter((c) => state.selected.has(c.id));
    if (!cards.length) return;
    if (net.role === "guest") {
      netSend({ type: "action", action: "play", cardIds: cards.map((c) => c.id) }, "host");
      state.selected.clear();
      ui.playBtn.disabled = true;
      ui.liarBtn.disabled = true;
      return;
    }
    playCards(me, cards);
  }
  function submitLiar() {
    const me = myPlayer();
    if (!me) return;
    if (net.role === "guest") {
      netSend({ type: "action", action: "liar" }, "host");
      ui.playBtn.disabled = true;
      ui.liarBtn.disabled = true;
      return;
    }
    callLiar(me);
  }

  ui.hand.addEventListener("click", (e) => {
    const btn = e.target.closest(".card");
    const me = myPlayer();
    if (!btn || !me || !me.alive) return;
    if (isHostEngine() && (state.busy || state.current !== me.id)) return;
    if (net.role === "guest" && state.current !== me.id) return;
    const id = btn.dataset.id;
    if (state.selected.has(id)) state.selected.delete(id);
    else {
      if (state.selected.size >= 3) return;
      state.selected.add(id);
      sfx.card();
    }
    renderHand();
    updateButtons();
  });
  ui.playBtn.addEventListener("click", () => { if (!ui.playBtn.disabled) submitPlay(); });
  ui.liarBtn.addEventListener("click", () => { if (!ui.liarBtn.disabled) submitLiar(); });
  document.addEventListener("keydown", (e) => {
    if (state.screen !== "game") return;
    if (e.key === "x" || e.key === "X") { if (!ui.liarBtn.disabled) submitLiar(); }
    if (e.key === "Enter") { if (!ui.playBtn.disabled) submitPlay(); }
  });
})();
