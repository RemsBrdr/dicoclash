"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi, Target, Brain, Sparkles, Timer, MessageSquare, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type GameState = "login" | "home" | "queue" | "playing" | "results";

interface Player {
  id: string;
  pseudo: string;
  score_giver: number;
  score_guesser: number;
  total_games: number;
  games_won: number;
}

interface GameData {
  id: string;
  player1_id: string;
  player2_id: string;
  player1_score: number;
  player2_score: number;
  current_round: number;
  current_word: string;
  current_giver_id: string;
  status: string;
  time_left: number;
  round_start_time: string;
  attempts_used?: number;
}

interface LeaderboardEntry {
  id: string;
  pseudo: string;
  score_average: number;
  total_games: number;
  games_won: number;
  rank: number;
}

interface RoundAttempt {
  clue: string;
  guess: string;
  correct: boolean;
}

const DicoClash = () => {
  const [mounted, setMounted] = useState(false);
  const [gameState, setGameState] = useState<GameState>("login");
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [pseudoInput, setPseudoInput] = useState("");
  const [currentGame, setCurrentGame] = useState<GameData | null>(null);
  const [opponentPseudo, setOpponentPseudo] = useState("");
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [attempts, setAttempts] = useState<RoundAttempt[]>([]);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueTime, setQueueTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const gameChannel = useRef<any>(null);
  const roundsChannel = useRef<any>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastKnownRound = useRef(0);
  const updateLock = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      cleanupAll();
    };
  }, []);

  useEffect(() => {
    if (mounted) {
      loadLeaderboard();
      updateOnlineCount();

      if (currentPlayer) {
        startHeartbeat();
        const interval = setInterval(updateOnlineCount, 10000);
        return () => {
          clearInterval(interval);
          stopHeartbeat();
        };
      } else {
        const interval = setInterval(updateOnlineCount, 10000);
        return () => clearInterval(interval);
      }
    }
  }, [mounted, currentPlayer]);

  useEffect(() => {
    if (gameState === "queue") {
      const interval = setInterval(() => setQueueTime(prev => prev + 1), 1000);
      return () => clearInterval(interval);
    } else {
      setQueueTime(0);
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === "playing" && timeLeft > 0 && !isTransitioning) {
      const interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            handleTimeOut();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState, timeLeft, isTransitioning]);

  const cleanupAll = () => {
    if (gameChannel.current) {
      supabase.removeChannel(gameChannel.current);
      gameChannel.current = null;
    }
    if (roundsChannel.current) {
      supabase.removeChannel(roundsChannel.current);
      roundsChannel.current = null;
    }
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
  };

  const startHeartbeat = async () => {
    if (!currentPlayer) return;
    await supabase.from('presence').upsert({
      player_id: currentPlayer.id,
      last_heartbeat: new Date().toISOString(),
      status: 'online'
    });
    heartbeatInterval.current = setInterval(async () => {
      await supabase.from('presence').upsert({
        player_id: currentPlayer.id,
        last_heartbeat: new Date().toISOString(),
        status: gameState === 'playing' ? 'in_game' : 'online'
      });
    }, 15000);
  };

  const stopHeartbeat = async () => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
    if (currentPlayer) {
      await supabase.from('presence').update({ status: 'offline' }).eq('player_id', currentPlayer.id);
    }
  };

  const updateOnlineCount = async () => {
    const { data } = await supabase.from('online_count').select('count').single();
    if (data) setOnlinePlayers(data.count);
  };

  const loadLeaderboard = async () => {
    const { data } = await supabase.from('leaderboard_top').select('*').limit(10);
    if (data) setLeaderboard(data);
  };

  const handleLogin = async () => {
    if (!pseudoInput.trim()) {
      setError("Veuillez entrer un pseudo");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('pseudo', pseudoInput.trim())
        .single();

      let player: Player;

      if (existingPlayer) {
        await supabase.from('players').update({ last_played: new Date().toISOString() }).eq('id', existingPlayer.id);
        player = existingPlayer;
      } else {
        const { data: newPlayer, error } = await supabase
          .from('players')
          .insert([{ pseudo: pseudoInput.trim() }])
          .select()
          .single();
        if (error) throw error;
        player = newPlayer;
      }

      setCurrentPlayer(player);
      setGameState("home");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la connexion");
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = async () => {
    if (!currentPlayer) return;

    try {
      await supabase.from('queue').insert({
        player_id: currentPlayer.id,
        elo_score: Math.round((currentPlayer.score_giver + currentPlayer.score_guesser) / 2)
      });

      setGameState("queue");

      matchmakingInterval.current = setInterval(async () => {
        const { data: existingGame } = await supabase
          .from('games')
          .select('*')
          .or(`player1_id.eq.${currentPlayer.id},player2_id.eq.${currentPlayer.id}`)
          .eq('status', 'playing')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existingGame) {
          if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
          const opponentId = existingGame.player1_id === currentPlayer.id ? existingGame.player2_id : existingGame.player1_id;
          const { data: opponent } = await supabase.from('players').select('pseudo').eq('id', opponentId).single();
          if (opponent) setOpponentPseudo(opponent.pseudo);
          await initGame(existingGame);
          return;
        }

        const { data } = await supabase.rpc('match_players');

        if (data && data.length > 0) {
          const match = data[0];
          if (match.player1_id === currentPlayer.id || match.player2_id === currentPlayer.id) {
            if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
            const opponentId = match.player1_id === currentPlayer.id ? match.player2_id : match.player1_id;
            const { data: opponent } = await supabase.from('players').select('pseudo').eq('id', opponentId).single();
            if (opponent) setOpponentPseudo(opponent.pseudo);
            const { data: game } = await supabase.from('games').select('*').eq('id', match.game_id).single();
            if (game) await initGame(game);
          }
        }
      }, 2000);

      setTimeout(() => {
        if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
        if (gameState === "queue") {
          leaveQueue();
          setError("Aucun adversaire trouvé");
          setGameState("home");
        }
      }, 60000);
    } catch (err: any) {
      setError(err.message);
      setGameState("home");
    }
  };

  const leaveQueue = async () => {
    if (!currentPlayer) return;
    await supabase.from('queue').delete().eq('player_id', currentPlayer.id);
  };

  const initGame = async (game: GameData) => {
    console.log('🎮 Init game:', game.id, 'Round:', game.current_round);

    cleanupAll();

    setCurrentGame(game);
    lastKnownRound.current = game.current_round;
    updateLock.current = false;
    setAttempts([]);
    setCurrentClue("");
    setCurrentGuess("");
    setWaitingForOpponent(false);
    setIsTransitioning(false);
    setTimeLeft(60);

    await setupRealtimeChannels(game.id);
    startPolling(game.id);

    setGameState("playing");
  };

  const setupRealtimeChannels = async (gameId: string) => {
    console.log('🔗 Setup channels:', gameId);

    gameChannel.current = supabase
      .channel(`game_${gameId}_${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`
      }, (payload) => {
        console.log('📩 Realtime UPDATE:', payload.new);
        handleGameUpdate(payload.new as GameData);
      })
      .subscribe((status) => {
        console.log('📡 Game channel:', status);
      });

    roundsChannel.current = supabase
      .channel(`rounds_${gameId}_${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rounds',
        filter: `game_id=eq.${gameId}`
      }, (payload) => {
        console.log('📩 Round INSERT:', payload.new);
        const round = payload.new;

        if (round.clues && round.giver_id !== currentPlayer?.id) {
          const lastClue = round.clues[round.clues.length - 1];
          console.log('💬 Clue:', lastClue);
          setAttempts(prev => {
            if (prev.some(a => a.clue === lastClue)) return prev;
            return [...prev, { clue: lastClue, guess: '', correct: false }];
          });
          setWaitingForOpponent(false);
        }

        if (round.guess_word && round.guesser_id !== currentPlayer?.id) {
          console.log('🎯 Guess:', round.guess_word, 'Won:', round.won);
          setAttempts(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && !last.guess) {
              last.guess = round.guess_word;
              last.correct = round.won;
            }
            return updated;
          });

          if (round.won) {
            console.log('✅ Word found');
            setIsTransitioning(true);
            setTimeout(() => triggerNextRound(), 2000);
          } else {
            setWaitingForOpponent(false);
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Rounds channel:', status);
      });
  };

  // POLLING DE SECOURS - vérifie la BDD toutes les secondes pendant transition
  const startPolling = (gameId: string) => {
    console.log('🔄 Start polling for game:', gameId);

    if (pollingInterval.current) clearInterval(pollingInterval.current);

    pollingInterval.current = setInterval(async () => {
      if (!isTransitioning) return; // Seulement pendant transition

      const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single();

      if (game) {
        console.log('🔍 Polling check - Round:', game.current_round, 'Last known:', lastKnownRound.current);
        handleGameUpdate(game);
      }
    }, 1000);
  };

  const handleGameUpdate = (newGame: GameData) => {
    if (newGame.current_round !== lastKnownRound.current) {
      console.log('🔄 ROUND CHANGE DETECTED:', lastKnownRound.current, '→', newGame.current_round);
      lastKnownRound.current = newGame.current_round;
      updateLock.current = false;

      setAttempts([]);
      setCurrentClue("");
      setCurrentGuess("");
      setWaitingForOpponent(false);
      setIsTransitioning(false);
      setTimeLeft(60);

      console.log('✅ UI reset complete for round', newGame.current_round);
    }

    setCurrentGame(newGame);

    if (newGame.status === 'finished') {
      console.log('🏁 Game finished');
      handleGameEnd(newGame);
    }
  };

  const sendClue = async () => {
    if (!currentGame || !currentClue.trim() || attempts.length >= 4 || waitingForOpponent) return;

    const clueText = currentClue.trim().toUpperCase();
    if (currentGame.current_word.substring(0, 3) === clueText.substring(0, 3)) {
      alert("⚠️ L'indice ne peut pas commencer par les 3 mêmes lettres !");
      return;
    }

    console.log('📤 Send clue:', clueText);

    setAttempts(prev => [...prev, { clue: clueText, guess: '', correct: false }]);
    setCurrentClue("");
    setWaitingForOpponent(true);

    const allClues = [...attempts.map(a => a.clue), clueText];

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      giver_id: currentPlayer?.id,
      clues: allClues
    });
  };

  const submitGuess = async () => {
    if (!currentGame || !currentGuess.trim() || waitingForOpponent) return;

    const guessText = currentGuess.trim().toUpperCase();
    const isCorrect = guessText === currentGame.current_word;

    console.log('📤 Send guess:', guessText, 'Correct:', isCorrect);

    setAttempts(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last) {
        last.guess = guessText;
        last.correct = isCorrect;
      }
      return updated;
    });

    setCurrentGuess("");
    setWaitingForOpponent(true);

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      guesser_id: currentPlayer?.id,
      guess_word: guessText,
      won: isCorrect,
      time_taken: 60 - timeLeft
    });

    if (isCorrect) {
      const isP1 = currentGame.player1_id === currentPlayer?.id;
      await supabase.from('games').update({
        [isP1 ? 'player1_score' : 'player2_score']: isP1 ? currentGame.player1_score + 1 : currentGame.player2_score + 1
      }).eq('id', currentGame.id);

      console.log('✅ I found it');
      setIsTransitioning(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else if (attempts.length >= 4) {
      console.log('❌ Max attempts');
      setIsTransitioning(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else {
      setWaitingForOpponent(false);
    }
  };

  const handleTimeOut = () => {
    console.log('⏱️ Timeout');
    setIsTransitioning(true);
    triggerNextRound();
  };

  const triggerNextRound = async () => {
    if (!currentGame || updateLock.current) {
      console.log('⚠️ Locked or no game');
      return;
    }

    console.log('🔄 Trigger next round, current:', currentGame.current_round);

    if (currentGame.current_round >= 4) {
      console.log('🏁 End game');
      await supabase.from('games').update({ status: 'finished' }).eq('id', currentGame.id);
      return;
    }

    const isP1 = currentGame.player1_id === currentPlayer?.id;

    if (isP1) {
      updateLock.current = true;
      console.log('👑 Player1 updating...');

      await new Promise(resolve => setTimeout(resolve, 3000)); // Attendre 3s

      const nextRound = currentGame.current_round + 1;
      const { data: word } = await supabase.rpc('get_random_word');
      const newGiver = currentGame.current_giver_id === currentGame.player1_id ? currentGame.player2_id : currentGame.player1_id;

      console.log('📝 UPDATE DB: round', nextRound, 'word:', word);

      await supabase.from('games').update({
        current_round: nextRound,
        current_word: word || 'ELEPHANT',
        current_giver_id: newGiver,
        time_left: 60,
        attempts_used: 0,
        round_start_time: new Date().toISOString()
      }).eq('id', currentGame.id);

      console.log('✅ DB updated');
    } else {
      console.log('👤 Player2 waiting for realtime/polling...');
    }
  };

  const handleGameEnd = async (game: GameData) => {
    cleanupAll();

    const isP1 = game.player1_id === currentPlayer?.id;
    const won = isP1 ? game.player1_score > game.player2_score : game.player2_score > game.player1_score;

    if (currentPlayer) {
      await supabase.from('players').update({
        total_games: currentPlayer.total_games + 1,
        games_won: currentPlayer.games_won + (won ? 1 : 0),
        score_giver: currentPlayer.score_giver + (won ? 10 : -5),
        score_guesser: currentPlayer.score_guesser + (won ? 10 : -5)
      }).eq('id', currentPlayer.id);
    }

    await loadLeaderboard();
    setGameState("results");
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
    if (rank === 2) return <Star className="w-4 h-4 text-gray-400" />;
    if (rank === 3) return <Star className="w-4 h-4 text-amber-600" />;
    return null;
  };

  if (!mounted) return null;

  // [TOUT LE CODE UI RESTE IDENTIQUE - Je ne le répète pas]
  // Gardez exactement les mêmes composants login, home, queue, results, playing que dans le message précédent

  // Pour simplifier, je montre juste la structure :
  if (gameState === "login") {
    // ... code UI login identique ...
    return <div>LOGIN UI (gardez le code précédent)</div>;
  }

  if (gameState === "home") {
    // ... code UI home identique ...
    return <div>HOME UI (gardez le code précédent)</div>;
  }

  if (gameState === "queue") {
    // ... code UI queue identique ...
    return <div>QUEUE UI (gardez le code précédent)</div>;
  }

  if (gameState === "results") {
    // ... code UI results identique ...
    return <div>RESULTS UI (gardez le code précédent)</div>;
  }

  if (gameState === "playing" && currentGame) {
    // ... code UI playing identique ...
    return <div>PLAYING UI (gardez le code précédent)</div>;
  }

  return null;
};

export default DicoClash;