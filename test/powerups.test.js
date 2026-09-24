const test = require('node:test');
const assert = require('node:assert/strict');
const { begin, tick, handleMessage, stateSnapshot } = require('../server');

function roomWithPlayers(count = 2) {
  const players = Array.from({ length: count }, (_, i) => {
    const peer = { id: `p${i}`, closed: false, socket: { writableLength: 0, write() {} } };
    return { peer, id: peer.id, name: `P${i}`, color: i, y: 0, vy: 0, alive: true, score: 0,
      lastFlap: 0, lastPress: 0, lastProgressAt: 0, heldPowerup: 0, requiredFlaps: 1, flapProgress: 0 };
  });
  const room = { code: 'TEST1', hostId: players[0].id, phase: 'playing', difficulty: 'normal', players,
    obstacles: [], powerUps: [], effects: [], ready: new Set(), roundId: 1, startsAt: null,
    elapsed: 0, nextId: 1, nextPowerId: 1, spawnIn: 0, broadcastIn: 0, timer: null };
  for (const player of players) player.peer.room = room;
  return room;
}

function press(player) {
  player.lastPress = 0;
  handleMessage(player.peer, JSON.stringify({ type: 'flap' }));
}

test('power-up appears between pipes and only one bird collects it', () => {
  const room = roomWithPlayers();
  tick(room, 1 / 60);
  assert.equal(room.powerUps.length, 1);
  const item = room.powerUps[0];
  assert.equal(item.strength, 3);
  assert.ok(item.x > room.obstacles[0].x);
  room.players[0].y = item.y;
  room.players[1].y = item.y;
  item.x = -1.45;
  tick(room, 1 / 60);
  assert.equal(room.players[0].heldPowerup, 3);
  assert.equal(room.players[1].heldPowerup, 0);
  assert.equal(room.powerUps.length, 0);
});

test('second item is ×5 and solo rooms do not spawn attack items', () => {
  const room = roomWithPlayers();
  room.nextId = 4;
  room.nextPowerId = 2;
  tick(room, 1 / 60);
  assert.equal(room.powerUps[0].strength, 5);
  const solo = roomWithPlayers(1);
  tick(solo, 1 / 60);
  assert.equal(solo.powerUps.length, 0);
});

test('activation requires three or five deliberate presses from other players', () => {
  const room = roomWithPlayers();
  const [owner, target] = room.players;
  owner.heldPowerup = 3;
  handleMessage(owner.peer, JSON.stringify({ type: 'activate' }));
  assert.equal(owner.heldPowerup, 0);
  assert.equal(owner.requiredFlaps, 1);
  assert.equal(target.requiredFlaps, 3);
  target.vy = -1;
  press(target); press(target);
  assert.equal(target.vy, -1);
  assert.equal(target.flapProgress, 2);
  press(target);
  assert.equal(target.vy, 4.65);
  assert.equal(target.flapProgress, 0);

  owner.heldPowerup = 5;
  handleMessage(owner.peer, JSON.stringify({ type: 'activate' }));
  assert.equal(target.requiredFlaps, 5);
  target.vy = -1;
  target.lastFlap = 0;
  for (let i = 0; i < 4; i++) press(target);
  assert.equal(target.vy, -1);
  assert.equal(target.flapProgress, 4);
  press(target);
  assert.equal(target.vy, 4.65);
  assert.equal(target.flapProgress, 0);

  for (const effect of room.effects) effect.until = Date.now() - 1;
  tick(room, 1 / 60);
  assert.equal(target.requiredFlaps, 1);
  assert.equal(stateSnapshot(room).players[1].effectMs, 0);
});

test('power-up cannot be activated twice or by a fallen bird', () => {
  const room = roomWithPlayers();
  const [owner] = room.players;
  owner.heldPowerup = 5;
  owner.alive = false;
  handleMessage(owner.peer, JSON.stringify({ type: 'activate' }));
  assert.equal(owner.heldPowerup, 5);
  assert.equal(room.effects.length, 0);
  owner.alive = true;
  handleMessage(owner.peer, JSON.stringify({ type: 'activate' }));
  handleMessage(owner.peer, JSON.stringify({ type: 'activate' }));
  assert.equal(room.effects.length, 1);
});

test('rematch clears held items and active effects', () => {
  const room = roomWithPlayers();
  room.phase = 'countdown';
  room.powerUps.push({ id: 1, x: 2, y: 0, strength: 3 });
  room.effects.push({ ownerId: room.players[0].id, strength: 5, until: Date.now() + 4000 });
  room.players[0].heldPowerup = 3;
  room.players[1].requiredFlaps = 5;
  room.players[1].flapProgress = 4;
  begin(room);
  clearInterval(room.timer);
  assert.equal(room.powerUps.length, 0);
  assert.equal(room.effects.length, 0);
  assert.equal(room.players[0].heldPowerup, 0);
  assert.equal(room.players[1].requiredFlaps, 1);
  assert.equal(room.players[1].flapProgress, 0);
});
