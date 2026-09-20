const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = 8080;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

const rooms = new Map();
const clients = new Map();

function json(res, code, obj) {
  res.writeHead(code, { ...CORS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(d ? JSON.parse(d) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function readPayload(req, parsed) {
  if (req.method === "GET" || req.method === "HEAD") {
    const q = parsed.query || {};
    const out = { ...q };
    if (q.msg) {
      try { out.msg = JSON.parse(q.msg); } catch (_) {}
    }
    if (q.data) {
      try { Object.assign(out, JSON.parse(q.data)); } catch (_) {}
    }
    return out;
  }
  return readBody(req);
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function lobbyPayload(room) {
  return {
    type: "lobby",
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    seats: room.seats.map((id) => {
      if (!id) return { empty: true, bot: true };
      const c = clients.get(id);
      return {
        empty: false, bot: false, id,
        name: c ? c.name : "-",
        profileId: c ? c.profileId : "",
        color: c ? c.color : "#c9a227",
        icon: c ? c.icon : "initial",
      };
    }),
  };
}

function push(clientId, msg) {
  const c = clients.get(clientId);
  if (!c) return;
  c.queue.push(msg);
  if (c.waiter) {
    const { res, timer } = c.waiter;
    clearTimeout(timer);
    c.waiter = null;
    json(res, 200, { messages: c.queue.splice(0, c.queue.length) });
  }
}

function pushRoom(room, msg, except) {
  for (const id of room.seats) {
    if (id && id !== except) push(id, msg);
  }
}

function leave(clientId) {
  const c = clients.get(clientId);
  if (!c) return;
  const room = rooms.get(c.room);
  if (room) {
    const idx = room.seats.indexOf(clientId);
    if (idx >= 0) room.seats[idx] = null;
    pushRoom(room, { type: "peerLeft", clientId, lobby: lobbyPayload(room) }, clientId);
    const occupied = room.seats.filter(Boolean);
    if (!occupied.length) rooms.delete(room.code);
    else if (room.hostId === clientId) {
      room.hostId = occupied[0];
      pushRoom(room, lobbyPayload(room));
    }
  }
  if (c.waiter) {
    try { c.waiter.res.end(); } catch (_) {}
    c.waiter = null;
  }
  clients.delete(clientId);
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || "/");

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  try {
    if (pathname === "/api/create") {
      const body = await readPayload(req, parsed);
      const name = String(body.name || "Stranger").trim().slice(0, 16) || "Stranger";
      const profileId = String(body.profileId || "").slice(0, 64);
      const color = String(body.color || "#c9a227").slice(0, 16);
      const icon = String(body.icon || "initial").slice(0, 16);
      const id = crypto.randomUUID();
      const code = makeCode();
      const room = { code, hostId: id, started: false, seats: [id, null, null, null] };
      rooms.set(code, room);
      clients.set(id, { id, name, room: code, queue: [], waiter: null, profileId, color, icon });
      return json(res, 200, { ok: true, clientId: id, lobby: lobbyPayload(room) });
    }

    if (pathname === "/api/join") {
      const body = await readPayload(req, parsed);
      const name = String(body.name || "Stranger").trim().slice(0, 16) || "Stranger";
      const profileId = String(body.profileId || "").slice(0, 64);
      const color = String(body.color || "#c9a227").slice(0, 16);
      const icon = String(body.icon || "initial").slice(0, 16);
      const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, error: "No table with that code." });
      if (room.started) return json(res, 400, { ok: false, error: "That table already started." });
      if (profileId) {
        for (const cl of clients.values()) {
          if (cl.profileId === profileId) {
            return json(res, 400, { ok: false, error: "This profile is already seated." });
          }
        }
      }
      const slot = room.seats.findIndex((s) => !s);
      if (slot < 0) return json(res, 400, { ok: false, error: "Table is full." });
      const id = crypto.randomUUID();
      room.seats[slot] = id;
      clients.set(id, { id, name, room: code, queue: [], waiter: null, profileId, color, icon });
      const lobby = lobbyPayload(room);
      pushRoom(room, lobby, id);
      return json(res, 200, { ok: true, clientId: id, lobby });
    }

    if (pathname === "/api/kick") {
      const body = await readPayload(req, parsed);
      const host = clients.get(body.clientId);
      if (!host) return json(res, 400, { ok: false, error: "Not at a table." });
      const room = rooms.get(host.room);
      if (!room || room.hostId !== host.id) return json(res, 403, { ok: false, error: "Only the host can kick." });
      if (room.started) return json(res, 400, { ok: false, error: "Game already started." });
      const targetId = body.targetId;
      if (!targetId || targetId === host.id || !room.seats.includes(targetId)) {
        return json(res, 400, { ok: false, error: "Can't kick that seat." });
      }
      push(targetId, { type: "kicked" });
      leave(targetId);
      return json(res, 200, { ok: true, lobby: lobbyPayload(room) });
    }

    if (pathname === "/api/leave") {
      const body = await readPayload(req, parsed);
      leave(body.clientId);
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/start") {
      const body = await readPayload(req, parsed);
      const c = clients.get(body.clientId);
      if (!c) return json(res, 400, { ok: false, error: "Not at a table." });
      const room = rooms.get(c.room);
      if (!room || room.hostId !== c.id) return json(res, 403, { ok: false, error: "Only the host can start." });
      room.started = true;
      const lobby = lobbyPayload(room);
      pushRoom(room, { type: "start", lobby }, c.id);
      return json(res, 200, { ok: true, lobby });
    }

    if (pathname === "/api/send") {
      const body = await readPayload(req, parsed);
      const c = clients.get(body.clientId);
      if (!c) return json(res, 400, { ok: false, error: "Not at a table." });
      const room = rooms.get(c.room);
      if (!room) return json(res, 400, { ok: false, error: "Table closed." });
      const msg = body.msg;
      if (!msg || typeof msg !== "object") return json(res, 400, { ok: false });
      if (body.to === "all") pushRoom(room, { type: "relay", from: c.id, msg }, c.id);
      else if (body.to === "host") {
        if (c.id !== room.hostId) push(room.hostId, { type: "relay", from: c.id, msg });
      } else if (body.to) push(body.to, { type: "relay", from: c.id, msg });
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/poll" && req.method === "GET") {
      const id = parsed.query.id;
      const c = clients.get(id);
      if (!c) return json(res, 200, { messages: [{ type: "gone" }] });
      if (c.queue.length) return json(res, 200, { messages: c.queue.splice(0, c.queue.length) });
      const timer = setTimeout(() => {
        if (c.waiter && c.waiter.res === res) {
          c.waiter = null;
          json(res, 200, { messages: [] });
        }
      }, 20000);
      c.waiter = { res, timer };
      req.on("close", () => {
        clearTimeout(timer);
        if (c.waiter && c.waiter.res === res) c.waiter = null;
      });
      return;
    }
  } catch (err) {
    return json(res, 400, { ok: false, error: "Bad request." });
  }

  let file = pathname === "/" ? "/index.html" : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(ROOT, file);
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, CORS);
      return res.end("Not found");
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Liar's Bar on " + PORT);
});
