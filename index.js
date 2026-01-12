// -----------------------------------------------------------------------------
// |                     THE ABYSS WAR - PROJECT BLUEPRINT                     |
// |         BACKEND SERVER (v3.2) - SMART LOADING & FULL ZONES SUPPORT        |
// |      Receives thumbnails, understands full game zones. Final version.     |
// -----------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e8 // 100 MB
});

const gameRooms = {};
const PORT = process.env.PORT || 3001;

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // --- Room Management ---
  socket.on('createRoom', (playerName, callback) => {
    const roomId = `R${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    socket.join(roomId);
    
    const newPlayer = { id: socket.id, name: playerName, life: 4000, isReady: false };

    gameRooms[roomId] = {
      id: roomId,
      players: [newPlayer],
      cards: [],
      status: 'setup'
    };

    console.log(`Room created: ${roomId} by ${playerName}`);
    callback({ success: true, roomId });
    io.to(roomId).emit('gameStateUpdate', gameRooms[roomId]);
  });

  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    const room = gameRooms[roomId];
    if (room) {
      if (room.players.length >= 2) {
        return callback({ success: false, message: "Room is full." });
      }
      socket.join(roomId);
      const newPlayer = { id: socket.id, name: playerName, life: 4000, isReady: false };
      room.players.push(newPlayer);
      
      io.to(roomId).emit('notification', `${playerName} has joined the setup!`);
      io.to(roomId).emit('gameStateUpdate', room);
      callback({ success: true });
    } else {
      callback({ success: false, message: "Room not found." });
    }
  });

  // --- Deck Submission (Updated to expect thumbnailData) ---
  socket.on('submitDeck', ({ roomId, deck }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    room.cards = room.cards.filter(card => card.ownerId !== socket.id);

    const newCards = deck.map((cardData, index) => ({
      id: `${socket.id.slice(0, 4)}-${cardData.name.replace(/\s/g, '')}-${index}`,
      name: cardData.name,
      thumbnailData: cardData.thumbnailData, // <-- THE CRITICAL CHANGE
      ownerId: socket.id,
      zone: 'deck',
      x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0
    }));

    room.cards.push(...newCards);
    player.isReady = true;
    console.log(`${player.name} submitted a deck of ${newCards.length} cards.`);

    const allReady = room.players.every(p => p.isReady);
    if (room.players.length > 1 && allReady) {
      room.status = 'playing';
      io.to(roomId).emit('notification', `All players are ready! The duel begins!`);
    }

    io.to(roomId).emit('gameStateUpdate', room);
  });

  // --- NEW: Event to move a card to a specific zone ---
  socket.on('moveCardToZone', ({ roomId, cardId, zone }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card && (zone === 'graveyard' || zone === 'banished' || zone === 'deck')) {
      card.zone = zone;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  // --- Other game logic handlers (drawCard, moveCard, etc.) ---
  // These remain largely the same.
  socket.on('drawCard', ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const playerDeck = room.cards.filter(c => c.ownerId === socket.id && c.zone === 'deck');
    if (playerDeck.length > 0) {
      const cardToDraw = playerDeck[Math.floor(Math.random() * playerDeck.length)];
      cardToDraw.zone = 'hand';
      io.to(roomId).emit('gameStateUpdate', room);
      io.to(socket.id).emit('notification', `You drew: ${cardToDraw.name}`);
    } else {
      io.to(socket.id).emit('notification', 'Deck is empty!');
    }
  });

  socket.on('moveCard', ({ roomId, cardId, x, y, zone }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    let card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.x = x;
      card.y = y;
      card.zone = zone || 'board';
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  // ... (flipCard, rotateCard, updateLife, triggerEffect, disconnect handlers are unchanged)
  socket.on('flipCard', ({ roomId, cardId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.isFlipped = !card.isFlipped;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('rotateCard', ({ roomId, cardId, newRotation }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.rotation = newRotation;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('updateLife', ({ roomId, playerId, newLife }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.life = newLife;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('triggerEffect', ({ roomId, effectName }) => {
    console.log(`Effect triggered: ${effectName}`);
    io.to(roomId).emit('playEffect', { effectName });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomId in gameRooms) {
        const room = gameRooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            const playerName = room.players[playerIndex].name;
            room.players.splice(playerIndex, 1);
            room.cards = room.cards.filter(c => c.ownerId !== socket.id);
            if (room.players.length === 0) {
                delete gameRooms[roomId];
                console.log(`Room ${roomId} is empty and has been deleted.`);
            } else {
                room.status = 'setup';
                io.to(roomId).emit('notification', `${playerName} has left the battle.`);
                io.to(roomId).emit('gameStateUpdate', room);
            }
            break;
        }
    }
  });
});

app.get('/', (req, res) => {
  res.send('Abyss War Server v3.2 (Smart Loading) is running! 🚀');
});

server.listen(PORT, () => {
  console.log(`Server v3.2 with Smart Loading is ALIVE on port: ${PORT}`);
});
