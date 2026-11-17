const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const Matter = require('matter-js');

const { Engine, World, Bodies, Body } = Matter;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static('public'));

// ---------- FÍSICA ----------
const engine = Engine.create();
engine.gravity.y = 1.2;

const W = 960, H = 540;
const walls = [
  // suelo en 3 partes (con huecos)
  Bodies.rectangle(150, H - 20, 300, 40, { isStatic: true, friction: 0 }),
  Bodies.rectangle(480, H - 20, 220, 40, { isStatic: true, friction: 0 }),
  Bodies.rectangle(810, H - 20, 300, 40, { isStatic: true, friction: 0 }),
  // plataforma de la llave
  Bodies.rectangle(480, 420, 160, 20, { isStatic: true, friction: 0 }),
  // paredes laterales
  Bodies.rectangle(-20, H / 2, 40, H, { isStatic: true, friction: 0 }),
  Bodies.rectangle(W + 20, H / 2, 40, H, { isStatic: true, friction: 0 }),
];
World.add(engine.world, walls);

// ---------- NIVEL ----------
const REQUIRED_PLAYERS = 4; // cámbialo a 1 para probar solo
const KEY_SPAWN = { x: 480, y: 375 };
const DOOR = { x: 880, y: 460, w: 50, h: 80 };
const level = { key: { ...KEY_SPAWN }, keyHolder: null, doorOpen: false, won: false };

// ---------- JUGADORES ----------
const MAX_PLAYERS = 4;
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
const players = {};
const SIZE = 40;

io.on('connection', (socket) => {
  socket.on('viewer', () => socket.join('viewers'));

  socket.on('join', () => {
    if (players[socket.id]) return;
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit('error_msg', 'Sala llena');
      socket.disconnect();
      return;
    }
    const slot = COLORS.findIndex(c => !Object.values(players).some(p => p.color === c));
    const body = Bodies.rectangle(100 + slot * 60, 400, SIZE, SIZE, {
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0,
      inertia: Infinity,
    });
    World.add(engine.world, body);

    players[socket.id] = {
      body, color: COLORS[slot], slot,
      left: false, right: false, jump: false,
      onGround: false,
    };
    socket.emit('welcome', { color: COLORS[slot], slot });
    console.log('Jugador conectado:', socket.id, COLORS[slot]);
  });

  socket.on('keydown', (key) => { if (players[socket.id]) players[socket.id][key] = true; });
  socket.on('keyup', (key) => { if (players[socket.id]) players[socket.id][key] = false; });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) World.remove(engine.world, p.body);
    delete players[socket.id];
    console.log('Desconectado:', socket.id);
  });
});

// ¿Está el jugador apoyado sobre algo?
function checkGround(p) {
  const others = Matter.Composite.allBodies(engine.world).filter(b => b !== p.body);
  const feet = {
    min: { x: p.body.position.x - SIZE / 2 + 2, y: p.body.position.y + SIZE / 2 },
    max: { x: p.body.position.x + SIZE / 2 - 2, y: p.body.position.y + SIZE / 2 + 4 },
  };
  return others.some(b =>
    b.bounds.min.x < feet.max.x && b.bounds.max.x > feet.min.x &&
    b.bounds.min.y < feet.max.y && b.bounds.max.y > feet.min.y
  );
}

// ---------- LÓGICA DEL NIVEL ----------
function updateLevel() {
  const list = Object.entries(players);

  // Respawn de la llave si quien la cargaba cae o se desconecta
  if (level.keyHolder) {
    const holder = players[level.keyHolder];
    if (!holder || holder.body.position.y > H + 50) {
      level.keyHolder = null;
      level.key = { ...KEY_SPAWN };
    }
  }

  // Respawn de jugadores que caen al vacío
  for (const p of Object.values(players)) {
    if (p.body.position.y > H + 50) {
      Body.setPosition(p.body, { x: 100 + p.slot * 60, y: 400 });
      Body.setVelocity(p.body, { x: 0, y: 0 });
    }
  }

  // Recoger la llave (solo si nadie la tiene)
  if (!level.keyHolder) {
    for (const [id, p] of list) {
      const dx = Math.abs(p.body.position.x - level.key.x);
      const dy = Math.abs(p.body.position.y - level.key.y);
      if (dx < 30 && dy < 30) { level.keyHolder = id; break; }
    }
  }

  // La llave sigue al jugador que la carga
  if (level.keyHolder && players[level.keyHolder]) {
    const b = players[level.keyHolder].body;
    level.key = { x: b.position.x, y: b.position.y - 35 };
  }

  // Puerta y victoria
  const inDoor = (p) =>
    Math.abs(p.body.position.x - DOOR.x) < DOOR.w / 2 + 10 &&
    Math.abs(p.body.position.y - DOOR.y) < DOOR.h / 2 + 10;

  if (level.keyHolder && inDoor(players[level.keyHolder])) level.doorOpen = true;

  level.won = list.length >= REQUIRED_PLAYERS &&
    list.every(([, p]) => inDoor(p)) &&
    level.doorOpen;
}

// ---------- LOOP: física a 60 Hz, envío a 30 Hz ----------
const SPEED = 3;
const JUMP = -10;
let tick = 0;

setInterval(() => {
  for (const p of Object.values(players)) {
    p.onGround = checkGround(p);

    let vx = 0;
    if (p.left) vx -= SPEED;
    if (p.right) vx += SPEED;
    Body.setVelocity(p.body, { x: vx, y: p.body.velocity.y });

    if (p.jump && p.onGround) {
      Body.setVelocity(p.body, { x: vx, y: JUMP });
    }
  }

  Engine.update(engine, 1000 / 60);
  updateLevel();

  if (++tick % 2 === 0) {
    const state = {};
    for (const [id, p] of Object.entries(players)) {
      state[id] = { x: p.body.position.x, y: p.body.position.y, color: p.color };
    }
    io.to('viewers').volatile.emit('state', { players: state, level, door: DOOR });
  }
}, 1000 / 60);

function getLocalIP() {
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets)
      if (n.family === 'IPv4' && !n.internal) return n.address;
}

server.listen(3000, '0.0.0.0', () => {
  console.log(`Servidor en http://${getLocalIP()}:3000`);
});