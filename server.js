// Dependency-free HTTP and WebSocket server for Flappy Friends.
// Run with: node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const rooms = new Map();
const peers = new Set();
const BIRD_X = -1.45;
const FLOOR = -3.38;
const CEILING = 3.55;
const RADIUS = 0.27;
const GRAVITY = -13.2;
const FLAP = 4.65;
const PIPE_WIDTH = 0.86;
const MAX_PLAYERS = 7;
const DIFFICULTIES = Object.freeze({
  normal: { startSpeed: 2.65, maxSpeed: 3.7, speedRamp: 0.012, startGap: 2.85, minGap: 2.22, gapRamp: 0.004, spacing: 3.85 },
  hard: { startSpeed: 3.25, maxSpeed: 4.45, speedRamp: 0.018, startGap: 2.45, minGap: 1.9, gapRamp: 0.005, spacing: 3.55 },
});

function obstacleSpeed(room) {
  const settings = DIFFICULTIES[room.difficulty];
  return Math.min(settings.maxSpeed, settings.startSpeed + room.elapsed * settings.speedRamp);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(INDEX);
  } else if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

function send(peer, data) {
  if (peer.closed) return;
  if (peer.socket.writableLength > 256 * 1024) { peer.socket.destroy(); return; }
  const payload = Buffer.from(JSON.stringify(data));
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  peer.socket.write(Buffer.concat([head, payload]));
}

function broadcast(room, data) {
  for (const player of room.players) send(player.peer, data);
}

function roomSnapshot(room) {
  return {
    type: 'room', code: room.code, phase: room.phase, hostId: room.hostId, difficulty: room.difficulty,
    roundId: room.roundId, readyCount: room.ready.size,
    countdownMs: room.startsAt ? Math.max(0, room.startsAt - Date.now()) : null,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, alive: p.alive, score: p.score })),
    obstacles: room.obstacles.map(o => ({ x: o.x, gapY: o.gapY, gap: o.gap })),
  };
}

function stateSnapshot(room) {
  return {
    type: 'state', phase: room.phase, speed: obstacleSpeed(room),
    players: room.players.map(p => ({ id: p.id, y: p.y, vy: p.vy, alive: p.alive, score: p.score })),
    obstacles: room.obstacles.map(o => ({ id: o.id, x: o.x, gapY: o.gapY, gap: o.gap })),
  };
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(5), b => chars[b % chars.length]).join(''); } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  const name = (typeof value === 'string' ? value : '').replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 16);
  return name || 'Pemain';
}

function leave(peer) {
  const room = peer.room;
  if (!room) return;
  peer.room = null;
  const i = room.players.findIndex(p => p.peer === peer);
  if (i < 0) return;
  room.players.splice(i, 1);
  room.ready.delete(peer.id);
  if (!room.players.length) {
    clearInterval(room.timer);
    clearTimeout(room.countdownTimer);
    clearTimeout(room.prepareTimer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === peer.id) room.hostId = room.players[0].id;
  if (room.phase === 'playing' && room.players.every(p => !p.alive)) finish(room);
  if (room.phase === 'preparing' && room.players.every(p => room.ready.has(p.id))) beginCountdown(room);
  else broadcast(room, roomSnapshot(room));
}

function createRoom(peer, name) {
  if (rooms.size >= 500) return send(peer, { type: 'error', message: 'Server sedang penuh. Coba sebentar lagi.' });
  leave(peer);
  const code = makeCode();
  const room = { code, hostId: peer.id, phase: 'lobby', difficulty: 'normal', players: [], obstacles: [], timer: null,
    countdownTimer: null, prepareTimer: null, startsAt: null, previousPhase: null, roundId: 0, ready: new Set(),
    elapsed: 0, nextId: 1, spawnIn: 1.55, broadcastIn: 0 };
  rooms.set(code, room);
  addPlayer(room, peer, name);
}

function addPlayer(room, peer, name) {
  peer.room = room;
  room.players.push({ peer, id: peer.id, name: cleanName(name), color: (room.players.length % 7), y: 0, vy: 0, alive: true, score: 0, lastFlap: 0 });
  send(peer, { type: 'joined', id: peer.id });
  broadcast(room, roomSnapshot(room));
}

function joinRoom(peer, code, name) {
  const room = rooms.get((typeof code === 'string' ? code : '').trim().toUpperCase());
  if (!room) return send(peer, { type: 'error', message: 'Kode sesi tidak ditemukan.' });
  if (room.phase !== 'lobby') return send(peer, { type: 'error', message: 'Game sudah dimulai.' });
  if (room.players.length >= MAX_PLAYERS) return send(peer, { type: 'error', message: 'Sesi sudah penuh (7 pemain).' });
  leave(peer);
  addPlayer(room, peer, name);
}

function start(room) {
  if (room.phase !== 'lobby' && room.phase !== 'finished') return;
  room.previousPhase = room.phase;
  room.phase = 'preparing';
  room.roundId++;
  room.ready.clear();
  room.startsAt = null;
  broadcast(room, roomSnapshot(room));
  room.prepareTimer = setTimeout(() => {
    if (room.phase !== 'preparing') return;
    room.phase = room.previousPhase;
    broadcast(room, { type: 'error', message: 'Ada pemain yang belum siap. Coba mulai lagi.' });
    broadcast(room, roomSnapshot(room));
  }, 12000);
}

function markReady(peer, roundId) {
  const room = peer.room;
  if (!room || room.phase !== 'preparing' || room.roundId !== roundId || !room.players.some(p => p.peer === peer)) return;
  room.ready.add(peer.id);
  if (room.players.every(p => room.ready.has(p.id))) beginCountdown(room);
  else broadcast(room, roomSnapshot(room));
}

function beginCountdown(room) {
  if (room.phase !== 'preparing') return;
  clearTimeout(room.prepareTimer);
  room.prepareTimer = null;
  room.phase = 'countdown';
  room.startsAt = Date.now() + 3000;
  broadcast(room, roomSnapshot(room));
  room.countdownTimer = setTimeout(() => begin(room), 3000);
}

function begin(room) {
  if (room.phase !== 'countdown') return;
  room.phase = 'playing';
  room.startsAt = null;
  room.elapsed = 0;
  room.obstacles = [];
  room.nextId = 1;
  room.spawnIn = 1.35;
  room.broadcastIn = 0;
  for (const p of room.players) Object.assign(p, { y: 0, vy: FLAP, alive: true, score: 0, lastFlap: 0 });
  broadcast(room, roomSnapshot(room));
  broadcast(room, stateSnapshot(room));
  room.timer = setInterval(() => tick(room, 1 / 60), 1000 / 60);
}

function finish(room) {
  if (room.phase !== 'playing') return;
  room.phase = 'finished';
  clearInterval(room.timer);
  room.timer = null;
  broadcast(room, stateSnapshot(room));
  broadcast(room, roomSnapshot(room));
}

function tick(room, dt) {
  if (room.phase !== 'playing') return;
  room.elapsed += dt;
  const settings = DIFFICULTIES[room.difficulty];
  const speed = obstacleSpeed(room);
  room.spawnIn -= dt;
  if (room.spawnIn <= 0) {
    const gap = Math.max(settings.minGap, settings.startGap - room.elapsed * settings.gapRamp);
    room.obstacles.push({ id: room.nextId++, x: 4.7, gapY: (Math.random() - 0.5) * 3.25, gap, passed: new Set() });
    room.spawnIn += settings.spacing / speed;
  }
  for (const o of room.obstacles) o.x -= speed * dt;
  room.obstacles = room.obstacles.filter(o => o.x > -5.5);
  for (const p of room.players) {
    if (!p.alive) continue;
    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y - RADIUS <= FLOOR || p.y + RADIUS >= CEILING) p.alive = false;
    for (const o of room.obstacles) {
      if (Math.abs(o.x - BIRD_X) < PIPE_WIDTH / 2 + RADIUS - 0.04 &&
          (p.y + RADIUS > o.gapY + o.gap / 2 || p.y - RADIUS < o.gapY - o.gap / 2)) p.alive = false;
      if (!o.passed.has(p.id) && o.x + PIPE_WIDTH / 2 < BIRD_X - RADIUS) {
        o.passed.add(p.id);
        if (p.alive) p.score++;
      }
    }
  }
  room.broadcastIn -= dt;
  if (room.broadcastIn <= 0) {
    broadcast(room, stateSnapshot(room));
    room.broadcastIn += 1 / 20;
  }
  if (room.players.every(p => !p.alive)) finish(room);
}

function handleMessage(peer, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'create' || msg.type === 'join') {
    if (Date.now() - peer.lastRoomAction < 500) return;
    peer.lastRoomAction = Date.now();
  }
  if (msg.type === 'create') createRoom(peer, msg.name);
  else if (msg.type === 'join') joinRoom(peer, msg.code, msg.name);
  else if (msg.type === 'leave') leave(peer);
  else if (msg.type === 'difficulty' && peer.room?.phase === 'lobby' && peer.room.hostId === peer.id && typeof msg.difficulty === 'string' &&
           Object.hasOwn(DIFFICULTIES, msg.difficulty)) {
    peer.room.difficulty = msg.difficulty;
    broadcast(peer.room, roomSnapshot(peer.room));
  }
  else if (msg.type === 'start' && peer.room && peer.room.hostId === peer.id) start(peer.room);
  else if (msg.type === 'ready') markReady(peer, msg.roundId);
  else if (msg.type === 'flap' && peer.room?.phase === 'playing') {
    const p = peer.room.players.find(x => x.peer === peer);
    const now = Date.now();
    if (p?.alive && now - p.lastFlap > 85) { p.vy = FLAP; p.lastFlap = now; }
  }
}

function handleFrames(peer, bytes) {
  peer.lastSeen = Date.now();
  peer.buffer = Buffer.concat([peer.buffer, bytes]);
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0], second = peer.buffer[1];
    let length = second & 0x7f, offset = 2;
    if (length === 126) {
      if (peer.buffer.length < 4) return;
      length = peer.buffer.readUInt16BE(2); offset = 4;
    } else if (length === 127) { peer.socket.destroy(); return; }
    if (!(second & 0x80) || length > 4096) { peer.socket.destroy(); return; }
    if (peer.buffer.length < offset + 4 + length) return;
    const mask = peer.buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(peer.buffer.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    peer.buffer = peer.buffer.subarray(offset + 4 + length);
    const opcode = first & 0x0f;
    if (opcode === 8) { peer.socket.end(); return; }
    if (opcode === 10) continue;
    if (opcode === 9) { peer.socket.write(Buffer.from([0x8a, payload.length, ...payload])); continue; }
    if (opcode === 1 && (first & 0x80)) handleMessage(peer, payload.toString('utf8'));
  }
}

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) return socket.destroy();
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin).host; } catch { return socket.destroy(); }
    if (origin !== req.headers.host) return socket.destroy();
  }
  const ip = socket.remoteAddress;
  if (peers.size >= 1000 || [...peers].filter(p => p.ip === ip).length >= 20) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = { id: crypto.randomUUID(), ip, socket, buffer: Buffer.alloc(0), room: null, closed: false, lastSeen: Date.now(), lastRoomAction: 0 };
  peers.add(peer);
  socket.on('data', bytes => handleFrames(peer, bytes));
  socket.on('close', () => { peer.closed = true; peers.delete(peer); leave(peer); });
  socket.on('error', () => { peer.closed = true; peers.delete(peer); leave(peer); });
  if (head.length) handleFrames(peer, head);
});

// WebSocket protocol pings keep idle lobbies alive and evict lost hosts.
setInterval(() => {
  const now = Date.now();
  for (const peer of peers) {
    if (now - peer.lastSeen > 65000 || peer.socket.writableLength > 256 * 1024) peer.socket.destroy();
    else if (!peer.closed) peer.socket.write(Buffer.from([0x89, 0x00]));
  }
}, 25000).unref();

server.listen(PORT, HOST, () => console.log(`Flappy Friends ready at http://${HOST}:${PORT}`));
