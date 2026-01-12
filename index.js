// -----------------------------------------------------------------------------
// |                     THE ABYSS WAR - PROJECT BLUEPRINT                     |
// |              BACKEND SERVER (v3.0) - DYNAMIC DECK LOADING                 |
// |      Players now upload their own decks. The server is a true platform.   |
// -----------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Increase the max payload size for Socket.IO to handle Base64 image data
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e8 // 100 MB - A generous limit for deck images
});

const gameRooms = {};
const PORT = process.env.PORT || 3001;

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // --- Room Management (Simplified for the new flow) ---
  socket.on('createRoom', (playerName, callback) => {
    const roomId = `R${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    socket.join(roomId);
    
    const newPlayer = { id: socket.id, name: playerName, life: 4000, isReady: false };

    gameRooms[roomId] = {
      id: roomId,
      players: [newPlayer],
      cards: [], // Starts completely empty
      status: 'setup' // New status: 'setup', 'playing'
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
      
      console.log(`${playerName} joined room: ${roomId}`);
      io.to(roomId).emit('notification', `${playerName} has joined the setup!`);
      io.to(roomId).emit('gameStateUpdate', room);
      callback({ success: true });
    } else {
      callback({ success: false, message: "Room not found." });
    }
  });

  // --- NEW CORE LOGIC: Deck Submission ---
  socket.on('submitDeck', ({ roomId, deck }) => {
    const room = gameRooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Remove any previous cards this player might have submitted
    room.cards = room.cards.filter(card => card.ownerId !== socket.id);

    // Create new card objects from the submitted deck
    const newCards = deck.map((cardData, index) => ({
      id: `${socket.id.slice(0, 4)}-${cardData.name.replace(/\s/g, '')}-${index}`,
      name: cardData.name,
      imageData: cardData.imageData, // Storing Base64 data
      ownerId: socket.id,
      zone: 'deck',
      x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0
    }));

    room.cards.push(...newCards);
    player.isReady = true;
    console.log(`${player.name} submitted a deck of ${newCards.length} cards.`);

    // Check if all players are ready
    const allReady = room.players.every(p => p.isReady);
    if (room.players.length > 1 && allReady) {
      room.status = 'playing';
      io.to(roomId).emit('notification', `All players are ready! The duel begins!`);
    }

    io.to(roomId).emit('gameStateUpdate', room);
  });


  // --- Game Logic (remains mostly the same, but relies on existing cards) ---
  
  socket.on('drawCard', ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const playerDeck = room.cards.filter(c => c.ownerId === socket.id && c.zone === 'deck');
    if (playerDeck.length > 0) {
      const cardToDraw = playerDeck[Math.floor(Math.random() * playerDeck.length)]; // Draw a random card from deck
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

  // All other handlers (flipCard, rotateCard, updateLife, triggerEffect) are still valid
  // and do not need changes. They are included here for completeness.
  
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

  // --- Disconnect Handling ---
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // (Disconnect logic remains the same as v2.1)
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
                room.status = 'setup'; // Reset to setup if a player leaves
                io.to(roomId).emit('notification', `${playerName} has left the battle.`);
                io.to(roomId).emit('gameStateUpdate', room);
            }
            break;
        }
    }
  });
});

app.get('/', (req, res) => {
  res.send('Abyss War Server v3.0 (Dynamic Decks) is running! 🚀');
});

server.listen(PORT, () => {
  console.log(`Server v3.0 with Dynamic Deck Loading is ALIVE on port: ${PORT}`);
});
