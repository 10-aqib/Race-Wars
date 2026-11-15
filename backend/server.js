const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// State
// rooms[code] = { hostId, players: { socketId: { id, name, color, isReady, distance, finished } }, isPlaying }
const rooms = Object.create(null);
const playerRoomMap = Object.create(null); // socketId -> roomCode
app.get('/health', (_, res) => res.json({ status: 'ok' }));

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms[result] ? generateRoomCode() : result;
}

function broadcastRoomUpdate(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  // This could be optimized, but for simple lobbies it's fine to broadcast state
}

io.on('connection', (socket) => {
  const { playerName, color } = socket.handshake.auth || {};
  const name = typeof playerName === 'string' && playerName.trim() ? playerName.trim().slice(0, 32) : `Driver ${socket.id.substring(0, 4)}`;
  const pColor = ['red', 'blue', 'green', 'black', 'white', 'yellow'].includes(color) ? color : 'red';
  
  console.log(`User connected: ${socket.id} (${name})`);

  // ---- CREATE ROOM ----
  socket.on('create_room', () => {
    // Leave existing room
    if (playerRoomMap[socket.id]) {
      handleLeaveRoom(socket);
    }

    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      hostId: socket.id,
      isPlaying: false,
      players: {}
    };

    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      name,
      color: pColor,
      isReady: false,
      distance: 0,
      finished: false
    };

    playerRoomMap[socket.id] = roomCode;
    socket.join(roomCode);
    console.log(`Room ${roomCode} created by ${socket.id}`);
    
    socket.emit('room_joined', {
      roomCode,
      players: Object.values(rooms[roomCode].players)
    });
  });

  // ---- JOIN ROOM ----
  socket.on('join_room', (roomCode) => {
    if (typeof roomCode !== 'string' || !/^[A-Z]{4}$/.test(roomCode)) return socket.emit('error_msg', 'Invalid room code');
    if (playerRoomMap[socket.id] === roomCode) return;
    const room = rooms[roomCode];

    if (!room) {
      return socket.emit('error_msg', 'Room not found');
    }
    if (room.isPlaying) {
      return socket.emit('error_msg', 'Race is already in progress');
    }
    if (Object.keys(room.players).length >= 3) {
      return socket.emit('error_msg', 'Room is full');
    }

    if (playerRoomMap[socket.id]) {
      handleLeaveRoom(socket);
    }

    const newPlayer = {
      id: socket.id,
      name,
      color: pColor,
      isReady: false,
      distance: 0,
      finished: false
    };

    room.players[socket.id] = newPlayer;
    playerRoomMap[socket.id] = roomCode;
    socket.join(roomCode);
    
    // Tell the new player who is already here
    socket.emit('room_joined', {
      roomCode,
      players: Object.values(room.players)
    });

    // Tell everyone else the new player joined
    socket.to(roomCode).emit('player_joined', newPlayer);
  });

  // ---- LEAVE ROOM ----
  socket.on('leave_room', () => {
    handleLeaveRoom(socket);
  });

  // ---- SET READY ----
  socket.on('set_ready', (isReady) => {
    if (typeof isReady !== 'boolean') return;
    const roomCode = playerRoomMap[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room || room.isPlaying || !room.players[socket.id]) return;

    room.players[socket.id].isReady = isReady;
    io.to(roomCode).emit('player_ready', { id: socket.id, isReady });

    // Check if everyone is ready to start
    const playerIds = Object.keys(room.players);
    if (playerIds.length > 1 && !room.isPlaying) {
      const allReady = playerIds.every(id => room.players[id].isReady);
      if (allReady) {
        startRaceSequence(roomCode);
      }
    }
  });

  // ---- PLAYER UPDATE (Volatile/Gameplay) ----
  socket.on('player_update', (state) => {
    if (!state || !['x', 'z', 'h', 'speed'].every(k => Number.isFinite(state[k]))) return;
    if (Math.abs(state.x) > 25 || Math.abs(state.z) > 100000 || Math.abs(state.speed) > 100) return;
    const roomCode = playerRoomMap[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room || !room.isPlaying || !room.startedAt || room.players[socket.id]?.finished) return;

    // Track distance for finish line / scoring
    if (room.players[socket.id]) {
       // Z goes negative in our game
      room.players[socket.id].distance = Math.max(0, Math.floor(-state.z));
    }

    // Broadcast position to others
    socket.to(roomCode).volatile.emit('player_update', {
      id: socket.id,
      state: { x: state.x, z: state.z, h: state.h, speed: state.speed, isCrashed: state.isCrashed === true }
    });
  });

  // ---- FINISH RACE ----
  socket.on('finish_race', (data) => {
    const roomCode = playerRoomMap[socket.id];
    if (!roomCode) return;
    const room = rooms[roomCode];
    if (!room || !room.isPlaying || !room.startedAt) return;

    const player = room.players[socket.id];
    if (player) {
      player.finished = true;
      // Ranking uses validated movement updates, never a supplied finish distance.
    }

    // Check if everyone finished
    const allFinished = Object.values(room.players).every(p => p.finished);
    if (allFinished) {
      endRace(roomCode);
    }
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', () => {
    handleLeaveRoom(socket);
    console.log(`User disconnected: ${socket.id}`);
  });
});

function handleLeaveRoom(socket) {
  const roomCode = playerRoomMap[socket.id];
  if (!roomCode) return;

  const room = rooms[roomCode];
  if (room) {
    delete room.players[socket.id];
    
    // Broadcast leave
    io.to(roomCode).emit('player_left', socket.id);

    const remainingPlayers = Object.keys(room.players);
    if (remainingPlayers.length === 0) {
      // Clean up empty room
      if (room.raceTimer) clearTimeout(room.raceTimer);
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      delete rooms[roomCode];
    } else {
      // Reassign host if needed
      if (room.hostId === socket.id) {
        room.hostId = remainingPlayers[0];
      }
      
      // If race was playing and only one person left, end it
      if (room.isPlaying && remainingPlayers.length === 1) {
        endRace(roomCode);
      }
    }
  }

  delete playerRoomMap[socket.id];
  socket.leave(roomCode);
}

function startRaceSequence(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.isPlaying = true;
  room.startedAt = null;
  
  // Reset distances/finished flags
  for (const pid in room.players) {
    room.players[pid].distance = 0;
    room.players[pid].finished = false;
  }

  let count = 3;
  io.to(roomCode).emit('countdown', count);
  
  room.countdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      io.to(roomCode).emit('countdown', count);
    } else if (count === 0) {
      io.to(roomCode).emit('countdown', 'GO');
    } else {
      clearInterval(room.countdownTimer);
      room.startedAt = Date.now();
      io.to(roomCode).emit('start_race');
      
      // Start 60 second timer (end race if not everyone finishes by then)
      room.raceTimer = setTimeout(() => {
        endRace(roomCode);
      }, 60000);
    }
  }, 1000);
}

function endRace(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.raceTimer) clearTimeout(room.raceTimer);
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  room.isPlaying = false;
  room.startedAt = null;

  // Unready players
  for (const pid in room.players) {
    room.players[pid].isReady = false;
  }

  // Calculate rankings based on distance
  const rankings = Object.values(room.players)
    .sort((a, b) => b.distance - a.distance)
    .map(p => ({
      id: p.id,
      name: p.name,
      distance: p.distance
    }));

  io.to(roomCode).emit('race_finished', rankings);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Multiplayer server listening on port ${PORT}`);
});
