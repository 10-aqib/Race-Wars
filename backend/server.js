const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

/**
 * Race Wars — multiplayer server.
 * Rooms of up to 3 players race one lap of the Night Circuit. The server keeps
 * its own view of each player's race progress: updates that imply impossible
 * speed are clamped, finishes are only accepted once validated progress
 * reaches the race distance, and finishing times come from the server clock.
 */

const MAX_PLAYERS = 3;
const TRACK_LENGTH_M = 3743;          // must match frontend Track length (checked by tests)
const RACE_LAPS = 1;
const RACE_DISTANCE_M = TRACK_LENGTH_M * RACE_LAPS;
const MAX_SPEED_MS = 115;             // above any car's nitro top speed (≈ 107 m/s)
const PROGRESS_SLACK_M = 25;          // network jitter allowance per update
const RACE_TIMEOUT_MS = 6 * 60 * 1000;
const COLORS = ['red', 'blue', 'green', 'black', 'white', 'yellow'];
const CARS = ['vortex_r', 'apex_gt', 'nova_rs', 'phantom_x', 'titan_xr'];

const app = express();
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.get('/health', (_, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigin, methods: ['GET', 'POST'] }, pingInterval: 20000, pingTimeout: 60000 });

const rooms = Object.create(null);         // code -> room
const playerRoomMap = Object.create(null); // socketId -> code

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return rooms[code] ? generateRoomCode() : code;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, carId: p.carId, isReady: p.isReady, distance: Math.round(p.progress) };
}

function newPlayer(socket, identity) {
  return { id: socket.id, ...identity, isReady: false, progress: 0, lastUpdateAt: 0, finished: false, finishTime: null, rejected: 0 };
}

io.on('connection', socket => {
  const auth = socket.handshake.auth || {};
  const identity = {
    name: typeof auth.playerName === 'string' && auth.playerName.trim() ? auth.playerName.trim().slice(0, 16) : `Driver ${socket.id.slice(0, 4)}`,
    color: COLORS.includes(auth.color) ? auth.color : 'red',
    carId: CARS.includes(auth.carId) ? auth.carId : 'vortex_r',
  };

  socket.on('create_room', () => {
    if (playerRoomMap[socket.id]) handleLeaveRoom(socket);
    const roomCode = generateRoomCode();
    rooms[roomCode] = { hostId: socket.id, isPlaying: false, startedAt: null, players: Object.create(null) };
    rooms[roomCode].players[socket.id] = newPlayer(socket, identity);
    playerRoomMap[socket.id] = roomCode;
    socket.join(roomCode);
    socket.emit('room_joined', { roomCode, players: Object.values(rooms[roomCode].players).map(publicPlayer) });
  });

  socket.on('join_room', roomCode => {
    if (typeof roomCode !== 'string' || !/^[A-Z]{4}$/.test(roomCode)) return socket.emit('error_msg', 'Invalid room code');
    if (playerRoomMap[socket.id] === roomCode) return;
    const room = rooms[roomCode];
    if (!room) return socket.emit('error_msg', 'Room not found');
    if (room.isPlaying) return socket.emit('error_msg', 'Race is already in progress');
    if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error_msg', 'Room is full');
    if (playerRoomMap[socket.id]) handleLeaveRoom(socket);
    const player = newPlayer(socket, identity);
    room.players[socket.id] = player;
    playerRoomMap[socket.id] = roomCode;
    socket.join(roomCode);
    socket.emit('room_joined', { roomCode, players: Object.values(room.players).map(publicPlayer) });
    socket.to(roomCode).emit('player_joined', publicPlayer(player));
  });

  socket.on('leave_room', () => handleLeaveRoom(socket));

  socket.on('set_ready', isReady => {
    if (typeof isReady !== 'boolean') return;
    const room = rooms[playerRoomMap[socket.id]];
    if (!room || room.isPlaying || !room.players[socket.id]) return;
    room.players[socket.id].isReady = isReady;
    io.to(playerRoomMap[socket.id]).emit('player_ready', { id: socket.id, isReady });
    const ids = Object.keys(room.players);
    if (ids.length > 1 && ids.every(id => room.players[id].isReady)) startRaceSequence(playerRoomMap[socket.id]);
  });

  socket.on('player_update', state => {
    if (!state || typeof state !== 'object') return;
    if (!['x', 'z', 'h', 'speed'].every(k => Number.isFinite(state[k]))) return;
    if (Math.abs(state.x) > 5000 || Math.abs(state.z) > 5000 || Math.abs(state.speed) > MAX_SPEED_MS) return;
    const code = playerRoomMap[socket.id];
    const room = rooms[code];
    const player = room && room.players[socket.id];
    if (!room || !room.isPlaying || !room.startedAt || !player || player.finished) return;

    if (Number.isFinite(state.progress)) applyProgress(room, player, state.progress);

    const vx = Number.isFinite(state.vx) ? Math.max(-MAX_SPEED_MS, Math.min(MAX_SPEED_MS, state.vx)) : 0;
    const vz = Number.isFinite(state.vz) ? Math.max(-MAX_SPEED_MS, Math.min(MAX_SPEED_MS, state.vz)) : 0;
    socket.to(code).volatile.emit('player_update', {
      id: socket.id,
      state: { x: state.x, z: state.z, h: state.h, speed: state.speed, vx, vz, progress: player.progress, isCrashed: false },
    });
  });

  socket.on('finish_race', data => {
    const code = playerRoomMap[socket.id];
    const room = rooms[code];
    const player = room && room.players[socket.id];
    if (!room || !room.isPlaying || !room.startedAt || !player || player.finished) return;
    // The claim goes through the same physical bound as position updates (updates are volatile and may be dropped)
    if (data && Number.isFinite(data.progress)) applyProgress(room, player, data.progress);
    if (player.progress < RACE_DISTANCE_M - 30) {
      socket.emit('error_msg', 'Finish rejected: race distance not completed');
      return;
    }
    player.finished = true;
    player.finishTime = (Date.now() - room.startedAt) / 1000;
    if (Object.values(room.players).every(p => p.finished)) endRace(code);
  });

  socket.on('disconnect', () => handleLeaveRoom(socket));
});

/**
 * Server-side progress: never more than is physically reachable since the start
 * signal, and never a jump larger than the time since the last accepted claim allows.
 */
function applyProgress(room, player, claimedRaw) {
  const now = Date.now();
  const elapsed = (now - room.startedAt) / 1000;
  const sinceLast = Math.max(0.1, (now - (player.lastUpdateAt || room.startedAt)) / 1000);
  const reachable = Math.min(MAX_SPEED_MS * elapsed + PROGRESS_SLACK_M, player.progress + MAX_SPEED_MS * sinceLast + PROGRESS_SLACK_M);
  const claimed = Math.min(claimedRaw, RACE_DISTANCE_M + 50);
  if (claimed > reachable) { player.progress = Math.max(player.progress, reachable); player.rejected++; }
  else player.progress = Math.max(player.progress - 60, claimed);
  player.lastUpdateAt = now;
}

function handleLeaveRoom(socket) {
  const code = playerRoomMap[socket.id];
  if (!code) return;
  const room = rooms[code];
  if (room) {
    delete room.players[socket.id];
    io.to(code).emit('player_left', socket.id);
    const remaining = Object.keys(room.players);
    if (remaining.length === 0) {
      clearTimeout(room.raceTimer); clearInterval(room.countdownTimer);
      delete rooms[code];
    } else {
      if (room.hostId === socket.id) room.hostId = remaining[0];
      if (room.isPlaying && (remaining.length === 1 || remaining.every(id => room.players[id].finished))) endRace(code);
    }
  }
  delete playerRoomMap[socket.id];
  socket.leave(code);
}

function startRaceSequence(code) {
  const room = rooms[code];
  if (!room) return;
  room.isPlaying = true;
  room.startedAt = null;
  for (const id in room.players) Object.assign(room.players[id], { progress: 0, lastUpdateAt: 0, finished: false, finishTime: null, rejected: 0 });
  let count = 3;
  io.to(code).emit('countdown', count);
  room.countdownTimer = setInterval(() => {
    count--;
    if (count > 0) io.to(code).emit('countdown', count);
    else if (count === 0) io.to(code).emit('countdown', 'GO');
    else {
      clearInterval(room.countdownTimer);
      room.startedAt = Date.now();
      io.to(code).emit('start_race');
      room.raceTimer = setTimeout(() => endRace(code), RACE_TIMEOUT_MS);
    }
  }, 1000);
}

function rankings(room) {
  return Object.values(room.players)
    .sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    })
    .map((p, i) => ({ id: p.id, name: p.name, position: i + 1, finished: p.finished, time: p.finishTime, progress: Math.round(p.progress) }));
}

function endRace(code) {
  const room = rooms[code];
  if (!room || !room.isPlaying) return;
  clearTimeout(room.raceTimer); clearInterval(room.countdownTimer);
  const result = rankings(room);
  room.isPlaying = false;
  room.startedAt = null;
  for (const id in room.players) room.players[id].isReady = false;
  io.to(code).emit('race_finished', result);
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Race Wars server listening on port ${PORT}`));
}

module.exports = { server, io, rooms, TRACK_LENGTH_M, RACE_DISTANCE_M, MAX_SPEED_MS, rankings };
