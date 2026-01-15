if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('DicoClash WebSocket Server is running!');
});

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ server });

const rooms = new Map();
const queue = [];
const onlinePlayers = new Set();

console.log('🚀 Server starting on port', PORT);

const normalizeString = (str) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
};

function broadcastStats() {
  const stats = {
    type: 'stats_update',
    activeGames: rooms.size,
    onlinePlayers: onlinePlayers.size
  };

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(stats));
    }
  });
}

function broadcastQueueSize() {
  queue.forEach(player => {
    if (player.ws.readyState === 1) {
      player.ws.send(JSON.stringify({
        type: 'queue_update',
        queueSize: queue.length
      }));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('🔌 New connection');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('📩 Received:', msg.type);

      switch (msg.type) {
        case 'player_online':
          onlinePlayers.add(msg.playerId);
          ws.playerId = msg.playerId;
          console.log('👤 Player online:', msg.playerId, '- Total:', onlinePlayers.size);
          broadcastStats();
          break;

        case 'player_offline':
          onlinePlayers.delete(msg.playerId);
          console.log('👋 Player offline:', msg.playerId, '- Total:', onlinePlayers.size);
          broadcastStats();
          break;

        case 'join_queue':
          await handleJoinQueue(ws, msg);
          break;

        case 'leave_queue':
          handleLeaveQueue(ws);
          break;

        case 'send_clue':
          handleSendClue(msg);
          break;

        case 'send_guess':
          await handleSendGuess(msg);
          break;
      }
    } catch (err) {
      console.error('❌ Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Connection closed');
    handleDisconnect(ws);
  });

  broadcastStats();
});

function handleLeaveQueue(ws) {
  const idx = queue.findIndex(p => p.ws === ws);
  if (idx !== -1) {
    queue.splice(idx, 1);
    console.log('🚪 Player left queue - Size:', queue.length);
    broadcastQueueSize();
  }
}

async function handleJoinQueue(ws, msg) {
  const { playerId, pseudo } = msg;

  queue.push({ ws, playerId, pseudo });
  console.log('👥 Queue size:', queue.length);
  broadcastQueueSize();

  if (queue.length >= 2) {
    console.log('🎮 Creating match...');
    const p1 = queue.shift();
    const p2 = queue.shift();
    broadcastQueueSize();

    const { data: word } = await supabase.rpc('get_random_word');
    console.log('📝 Word selected:', word);

    const { data: game, error: gameError } = await supabase
      .from('games')
      .insert({
        player1_id: p1.playerId,
        player2_id: p2.playerId,
        current_word: word || 'ELEPHANT',
        current_giver_id: p1.playerId,
        current_round: 1,
        player1_score: 0,
        player2_score: 0,
        status: 'playing'
      })
      .select()
      .single();

    if (gameError || !game) {
      console.error('❌ Game creation error:', gameError);
      return;
    }

    console.log('✅ Game created:', game.id);

    const room = {
      id: game.id,
      player1: { ws: p1.ws, id: p1.playerId, pseudo: p1.pseudo },
      player2: { ws: p2.ws, id: p2.playerId, pseudo: p2.pseudo },
      currentRound: 1,
      currentWord: game.current_word,
      currentGiverId: p1.playerId,
      teamScore: 0,
      attempts: [],
      timeLeft: 60
    };

    rooms.set(game.id, room);
    broadcastStats();

    console.log('📤 Sending game_start to', p1.pseudo, 'and', p2.pseudo);

    p1.ws.send(JSON.stringify({
      type: 'game_start',
      gameId: game.id,
      partnerPseudo: p2.pseudo,
      isGiver: true,
      word: game.current_word,
      round: 1
    }));

    p2.ws.send(JSON.stringify({
      type: 'game_start',
      gameId: game.id,
      partnerPseudo: p1.pseudo,
      isGiver: false,
      round: 1
    }));

    startTimer(game.id);
  }
}

function handleSendClue(msg) {
  const { gameId, clue } = msg;
  const room = rooms.get(gameId);
  if (!room) return;

  console.log('💬 Clue sent in game', gameId, ':', clue);

  room.attempts.push({ clue, guess: '', correct: false });

  const guesser = room.currentGiverId === room.player1.id ? room.player2 : room.player1;
  if (guesser.ws.readyState === 1) {
    guesser.ws.send(JSON.stringify({
      type: 'new_clue',
      clue,
      attempts: room.attempts
    }));
  }

  const giver = room.currentGiverId === room.player1.id ? room.player1 : room.player2;
  if (giver.ws.readyState === 1) {
    giver.ws.send(JSON.stringify({
      type: 'clue_sent',
      attempts: room.attempts
    }));
  }
}

async function handleSendGuess(msg) {
  const { gameId, guess } = msg;
  const room = rooms.get(gameId);
  if (!room) return;

  const normalizedGuess = normalizeString(guess);
  const normalizedWord = normalizeString(room.currentWord);
  const isCorrect = normalizedGuess === normalizedWord;

  console.log('🎯 Guess in game', gameId, ':', guess, '- Correct:', isCorrect);

  const lastAttempt = room.attempts[room.attempts.length - 1];
  if (lastAttempt) {
    lastAttempt.guess = guess;
    lastAttempt.correct = isCorrect;
  }

  broadcast(room, {
    type: 'new_guess',
    guess,
    correct: isCorrect,
    attempts: room.attempts
  });

  if (isCorrect) {
    room.teamScore++;
    console.log('✅ Word found! Team score:', room.teamScore);

    await supabase.from('games').update({
      player1_score: room.teamScore,
      player2_score: room.teamScore
    }).eq('id', gameId);

    setTimeout(() => nextRound(gameId), 2000);
  } else if (room.attempts.length >= 4) {
    console.log('❌ Max attempts reached. Moving to next round.');
    setTimeout(() => nextRound(gameId), 2000);
  }
}

async function nextRound(gameId) {
  const room = rooms.get(gameId);
  if (!room) return;

  if (room.timer) clearInterval(room.timer);

  if (room.currentRound >= 4) {
    console.log('🏁 Game', gameId, 'finished! Team score:', room.teamScore);

    await supabase.from('games').update({
      status: 'finished',
      player1_score: room.teamScore,
      player2_score: room.teamScore
    }).eq('id', gameId);

    console.log('📤 Sending game_end to', room.player1.pseudo, '- teamScore:', room.teamScore);
    if (room.player1.ws.readyState === 1) {
      room.player1.ws.send(JSON.stringify({
        type: 'game_end',
        teamScore: room.teamScore
      }));
    }

    console.log('📤 Sending game_end to', room.player2.pseudo, '- teamScore:', room.teamScore);
    if (room.player2.ws.readyState === 1) {
      room.player2.ws.send(JSON.stringify({
        type: 'game_end',
        teamScore: room.teamScore
      }));
    }

    rooms.delete(gameId);
    broadcastStats();
    return;
  }

  room.currentRound++;
  room.currentGiverId = room.currentGiverId === room.player1.id ? room.player2.id : room.player1.id;
  room.attempts = [];
  room.timeLeft = 60;

  const { data: word } = await supabase.rpc('get_random_word');
  room.currentWord = word || 'ELEPHANT';

  console.log('🔄 Round', room.currentRound, 'starting - Word:', room.currentWord);

  await supabase.from('games').update({
    current_round: room.currentRound,
    current_word: room.currentWord,
    current_giver_id: room.currentGiverId
  }).eq('id', gameId);

  if (room.player1.ws.readyState === 1) {
    room.player1.ws.send(JSON.stringify({
      type: 'new_round',
      round: room.currentRound,
      isGiver: room.currentGiverId === room.player1.id,
      word: room.currentGiverId === room.player1.id ? room.currentWord : undefined
    }));
  }

  if (room.player2.ws.readyState === 1) {
    room.player2.ws.send(JSON.stringify({
      type: 'new_round',
      round: room.currentRound,
      isGiver: room.currentGiverId === room.player2.id,
      word: room.currentGiverId === room.player2.id ? room.currentWord : undefined
    }));
  }

  startTimer(gameId);
}

function startTimer(gameId) {
  const room = rooms.get(gameId);
  if (!room) return;

  room.timer = setInterval(() => {
    room.timeLeft--;

    broadcast(room, {
      type: 'timer_update',
      timeLeft: room.timeLeft
    });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      console.log('⏰ Time out for game', gameId);
      nextRound(gameId);
    }
  }, 1000);
}

function broadcast(room, data) {
  if (room.player1.ws.readyState === 1) {
    room.player1.ws.send(JSON.stringify(data));
  }
  if (room.player2.ws.readyState === 1) {
    room.player2.ws.send(JSON.stringify(data));
  }
}

function handleDisconnect(ws) {
  if (ws.playerId) {
    onlinePlayers.delete(ws.playerId);
    console.log('👋 Disconnect - Player:', ws.playerId);
  }

  const idx = queue.findIndex(p => p.ws === ws);
  if (idx !== -1) {
    queue.splice(idx, 1);
    broadcastQueueSize();
  }

  for (const [gameId, room] of rooms.entries()) {
    if (room.player1.ws === ws || room.player2.ws === ws) {
      if (room.timer) clearInterval(room.timer);

      const other = room.player1.ws === ws ? room.player2 : room.player1;
      if (other.ws.readyState === 1) {
        other.ws.send(JSON.stringify({ type: 'partner_disconnected' }));
      }

      console.log('🗑️ Game', gameId, 'deleted due to disconnect');
      rooms.delete(gameId);
      break;
    }
  }

  broadcastStats();
}

server.listen(PORT, () => {
  console.log('🚀 WebSocket server running on port', PORT);
});