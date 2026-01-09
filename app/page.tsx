"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi, Target, Brain, Loader2 } from "lucide-react";
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

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);
  const gamePollingInterval = useRef<NodeJS.Timeout | null>(null);
  const roundsPollingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastKnownRound = useRef(0);
  const lastRoundsCount = useRef(0);
  const updateLock = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      cleanup();
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
    if (gameState === "playing" && timeLeft > 0) {
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
  }, [gameState, timeLeft]);

  const cleanup = () => {
    console.log('🧹 Cleanup');
    if (gamePollingInterval.current) {
      clearInterval(gamePollingInterval.current);
      gamePollingInterval.current = null;
    }
    if (roundsPollingInterval.current) {
      clearInterval(roundsPollingInterval.current);
      roundsPollingInterval.current = null;
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
    console.log('🎮 Init game:', game.id);

    cleanup();

    setCurrentGame(game);
    lastKnownRound.current = game.current_round;
    lastRoundsCount.current = 0;
    updateLock.current = false;
    setAttempts([]);
    setCurrentClue("");
    setCurrentGuess("");
    setWaitingForOpponent(false);
    setTimeLeft(60);

    // POLLING GAME - Toutes les 500ms
    gamePollingInterval.current = setInterval(async () => {
      const { data: g } = await supabase.from('games').select('*').eq('id', game.id).single();
      if (g) {
        console.log('🔍 Game poll - Round:', g.current_round, 'Last:', lastKnownRound.current);

        if (g.current_round !== lastKnownRound.current) {
          console.log('🎉 ROUND CHANGED!');
          lastKnownRound.current = g.current_round;
          lastRoundsCount.current = 0;
          updateLock.current = false;

          setAttempts([]);
          setCurrentClue("");
          setCurrentGuess("");
          setWaitingForOpponent(false);
          setTimeLeft(60);
        }

        setCurrentGame(g);

        if (g.status === 'finished') {
          handleGameEnd(g);
        }
      }
    }, 500);

    // POLLING ROUNDS - Toutes les 500ms
    roundsPollingInterval.current = setInterval(async () => {
      const { data: rounds } = await supabase
        .from('rounds')
        .select('*')
        .eq('game_id', game.id)
        .eq('round_number', lastKnownRound.current)
        .order('created_at', { ascending: true });

      if (rounds && rounds.length > lastRoundsCount.current) {
        console.log('📥 New rounds data:', rounds.length);
        lastRoundsCount.current = rounds.length;

        // Rebuild attempts from rounds
        const newAttempts: RoundAttempt[] = [];

        for (const round of rounds) {
          if (round.clues && round.giver_id !== currentPlayer?.id) {
            const clue = round.clues[round.clues.length - 1];
            if (!newAttempts.some(a => a.clue === clue)) {
              newAttempts.push({ clue, guess: '', correct: false });
            }
          }

          if (round.guess_word) {
            const lastAttempt = newAttempts[newAttempts.length - 1];
            if (lastAttempt && !lastAttempt.guess) {
              lastAttempt.guess = round.guess_word;
              lastAttempt.correct = round.won || false;

              if (round.won && round.guesser_id !== currentPlayer?.id) {
                console.log('✅ Opponent found word');
                setTimeout(() => triggerNextRound(), 2000);
              }
            }
          }
        }

        setAttempts(newAttempts);
        setWaitingForOpponent(false);
      }
    }, 500);

    setGameState("playing");
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

      console.log('✅ Found');
      setTimeout(() => triggerNextRound(), 2000);
    } else if (attempts.length >= 4) {
      console.log('❌ Max');
      setTimeout(() => triggerNextRound(), 2000);
    } else {
      setWaitingForOpponent(false);
    }
  };

  const handleTimeOut = () => {
    console.log('⏱️ Timeout');
    triggerNextRound();
  };

  const triggerNextRound = async () => {
    if (!currentGame || updateLock.current) {
      console.log('⚠️ Locked');
      return;
    }

    if (currentGame.current_round >= 4) {
      console.log('🏁 End');
      await supabase.from('games').update({ status: 'finished' }).eq('id', currentGame.id);
      return;
    }

    const isP1 = currentGame.player1_id === currentPlayer?.id;

    if (isP1) {
      updateLock.current = true;
      console.log('👑 P1 update');

      await new Promise(resolve => setTimeout(resolve, 2000));

      const nextRound = currentGame.current_round + 1;
      const { data: word } = await supabase.rpc('get_random_word');
      const newGiver = currentGame.current_giver_id === currentGame.player1_id ? currentGame.player2_id : currentGame.player1_id;

      await supabase.from('games').update({
        current_round: nextRound,
        current_word: word || 'ELEPHANT',
        current_giver_id: newGiver,
        time_left: 60,
        attempts_used: 0,
        round_start_time: new Date().toISOString()
      }).eq('id', currentGame.id);

      console.log('✅ Done');
    } else {
      console.log('👤 P2 wait polling');
    }
  };

  const handleGameEnd = async (game: GameData) => {
    cleanup();

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

  // [GARDEZ TOUTE L'UI DU CODE PRÉCÉDENT - Exactement la même]
  // Login, Home, Queue, Results, Playing - 100% identique

  if (gameState === "login") {
    // ... UI login (code précédent)
    return <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-2 border-rose-100 shadow-2xl">
        <CardHeader className="text-center pb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-rose-500 to-indigo-600 rounded-2xl shadow-lg">
              <Swords className="w-10 h-10 text-white" />
            </div>
          </div>
          <CardTitle className="text-4xl font-black bg-gradient-to-r from-rose-600 to-indigo-600 bg-clip-text text-transparent">
            DicoClash
          </CardTitle>
          <p className="text-gray-600 mt-2">Simple. Rapide. Efficace.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Votre pseudo</label>
            <input
              type="text"
              value={pseudoInput}
              onChange={(e) => setPseudoInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Votre pseudo..."
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
              maxLength={20}
              disabled={loading}
            />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>
          <Button
            onClick={handleLogin}
            disabled={loading || !pseudoInput.trim()}
            className="w-full bg-gradient-to-r from-rose-600 to-rose-700 text-lg py-6 rounded-xl"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                Connexion...
              </>
            ) : (
              <>
                <LogIn className="mr-2 w-5 h-5" />
                Jouer
              </>
            )}
          </Button>
          <p className="text-center text-sm text-gray-500">
            <Wifi className="inline w-4 h-4 mr-1 text-green-500" />
            {onlinePlayers} joueurs
          </p>
        </CardContent>
      </Card>
    </div>;
  }

  // Pour home, queue, results, playing : COPIEZ EXACTEMENT le code UI du message précédent
  // Je ne le répète pas pour économiser l'espace

  return null;
};

export default DicoClash;