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
  Bodies.rectangle(W / 2, H - 20, W, 40, { isStatic: true, label: 'ground' }), // suelo
  Bodies.rectangle(-20, H / 2, 40, H, { isStatic: true }),                     // pared izq
  Bodies.rectangle(W + 20, H / 2, 40, H, { isStatic: true }),                  // pared der
];
World.add(engine.world, walls);

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
      friction: 0.1,
      frictionAir: 0.02,
      inertia: Infinity, // no rota
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

// ¿Está el jugador apoyado sobre algo? (suelo u otro jugador)
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

// ---------- LOOP (30 veces por segundo) ----------
const SPEED = 4;
setInterval(() => {
  for (const p of Object.values(players)) {
    p.onGround = checkGround(p);

    let vx = 0;
    if (p.left) vx -= SPEED;
    if (p.right) vx += SPEED;
    Body.setVelocity(p.body, { x: vx, y: p.body.velocity.y });

    if (p.jump && p.onGround) {
      Body.setVelocity(p.body, { x: vx, y: -13 });
    }
  }

  Engine.update(engine, 1000 / 30);

  // Solo mandamos lo necesario a la pantalla
  const state = {};
  for (const [id, p] of Object.entries(players)) {
    state[id] = { x: p.body.position.x, y: p.body.position.y, color: p.color };
  }
  io.to('viewers').emit('state', state);
}, 1000 / 30);

function getLocalIP() {
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets)
      if (n.family === 'IPv4' && !n.internal) return n.address;
}

server.listen(3000, '0.0.0.0', () => {
  console.log(`Servidor en http://${getLocalIP()}:3000`);
});