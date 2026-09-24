const test = require('node:test');
const assert = require('node:assert/strict');
const { begin, tick, handleMessage, stateSnapshot } = require('../server');

function roomWithPlayers(count = 2) {
  const players = Array.from({ length: count }, (_, i) => {
    const peer = { id: `p${i}`, closed: false, writes: [], socket: { writableLength: 0, write(data) { peer.writes.push(data); } } };
    return { peer, id: peer.id, name: `P${i}`, color: i, y: 0, vy: 0, alive: true, score: 0,
      lastFlap: 0, phaseUntil: 0 };
  });
  const room = { code: 'TEST1', hostId: players[0].id, phase: 'playing', difficulty: 'normal', players,
    obstacles: [], powerUps: [], ready: new Set(), roundId: 1, startsAt: null,
    elapsed: 0, nextId: 1, nextPowerId: 1, spawnIn: 100, broadcastIn: 0, timer: null };
  for (const player of players) player.peer.room = room;
  return room;
}

function collect(room, durationSeconds, owner = room.players[0]) {
  room.powerUps.push({ id: durationSeconds, x: -1.45, y: owner.y, durationSeconds });
  for (const other of room.players) if (other !== owner) other.y = owner.y + 1.5;
  tick(room, 1 / 60);
}

test('items appear between pipes, alternating three and five seconds', () => {
  const room = roomWithPlayers();
  room.spawnIn = 0;
  tick(room, 1 / 60);
  assert.equal(room.powerUps[0].durationSeconds, 3);
  assert.ok(room.powerUps[0].x > room.obstacles[0].x);
  room.nextId = 4;
  room.nextPowerId = 2;
  room.spawnIn = 0;
  tick(room, 1 / 60);
  assert.equal(room.powerUps[1].durationSeconds, 5);
  const solo = roomWithPlayers(1);
  solo.spawnIn = 0;
  tick(solo, 1 / 60);
  assert.equal(solo.powerUps.length, 0);
});

test('collecting an item immediately protects only its bird for the stated duration', () => {
  const room = roomWithPlayers();
  const before = Date.now();
  collect(room, 3);
  assert.equal(room.powerUps.length, 0);
  assert.ok(room.players[0].phaseUntil >= before + 3000);
  assert.equal(room.players[1].phaseUntil, 0);
  assert.ok(room.players[0].peer.writes.some(frame => frame.includes('"type":"powerup"')));
  assert.ok(stateSnapshot(room).players[0].phaseMs > 2900);
  collect(room, 5);
  assert.ok(stateSnapshot(room).players[0].phaseMs > 4900);
});

test('protected bird passes through a pipe while an unprotected bird collides', () => {
  const room = roomWithPlayers();
  room.players[0].phaseUntil = Date.now() + 3000;
  room.obstacles.push({ id: 1, x: -1.45, gapY: 2, gap: 2.85, passed: new Set() });
  tick(room, 1 / 60);
  assert.equal(room.players[0].alive, true);
  assert.equal(room.players[1].alive, false);
});

test('protection expires and does not prevent hitting the ground', () => {
  const expired = roomWithPlayers();
  expired.players[0].phaseUntil = Date.now() - 1;
  expired.obstacles.push({ id: 1, x: -1.45, gapY: 2, gap: 2.85, passed: new Set() });
  tick(expired, 1 / 60);
  assert.equal(expired.players[0].alive, false);

  const grounded = roomWithPlayers();
  grounded.players[0].phaseUntil = Date.now() + 5000;
  grounded.players[0].y = -3.2;
  tick(grounded, 1 / 60);
  assert.equal(grounded.players[0].alive, false);
});

test('one flap remains one press for every player', () => {
  const room = roomWithPlayers();
  room.players[0].phaseUntil = Date.now() + 5000;
  for (const player of room.players) {
    player.vy = -1;
    handleMessage(player.peer, JSON.stringify({ type: 'flap' }));
    assert.equal(player.vy, 4.65);
  }
});

test('rematch clears protection and remaining items', () => {
  const room = roomWithPlayers();
  room.phase = 'countdown';
  room.powerUps.push({ id: 1, x: 2, y: 0, durationSeconds: 3 });
  room.players[0].phaseUntil = Date.now() + 5000;
  begin(room);
  clearInterval(room.timer);
  assert.equal(room.powerUps.length, 0);
  assert.equal(room.players[0].phaseUntil, 0);
});
