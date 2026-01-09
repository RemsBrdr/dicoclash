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
    console.log('🧹 Cleanup');
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

  const startPolling = (gameId: string) => {
    console.log('🔄 Start polling');

    if (pollingInterval.current) clearInterval(pollingInterval.current);

    pollingInterval.current = setInterval(async () => {
      const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single();

      if (game) {
        console.log('🔍 Poll - Round:', game.current_round, 'Last:', lastKnownRound.current);
        handleGameUpdate(game);
      }
    }, 1000);
  };

  const handleGameUpdate = (newGame: GameData) => {
    console.log('🔄 handleGameUpdate - Round:', newGame.current_round, 'Last:', lastKnownRound.current);

    if (newGame.current_round !== lastKnownRound.current) {
      console.log('🎉 ROUND CHANGE:', lastKnownRound.current, '→', newGame.current_round);
      lastKnownRound.current = newGame.current_round;
      updateLock.current = false;

      setAttempts([]);
      setCurrentClue("");
      setCurrentGuess("");
      setWaitingForOpponent(false);
      setIsTransitioning(false);
      setTimeLeft(60);

      console.log('✅ UI reset');
    }

    setCurrentGame(newGame);

    if (newGame.status === 'finished') {
      console.log('🏁 Finished');
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

      console.log('✅ Found');
      setIsTransitioning(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else if (attempts.length >= 4) {
      console.log('❌ Max');
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
      console.log('⚠️ Locked');
      return;
    }

    console.log('🔄 Trigger next round');

    if (currentGame.current_round >= 4) {
      console.log('🏁 End');
      await supabase.from('games').update({ status: 'finished' }).eq('id', currentGame.id);
      return;
    }

    const isP1 = currentGame.player1_id === currentPlayer?.id;

    if (isP1) {
      updateLock.current = true;
      console.log('👑 P1 update dans 3s');

      await new Promise(resolve => setTimeout(resolve, 3000));

      const nextRound = currentGame.current_round + 1;
      const { data: word } = await supabase.rpc('get_random_word');
      const newGiver = currentGame.current_giver_id === currentGame.player1_id ? currentGame.player2_id : currentGame.player1_id;

      console.log('📝 UPDATE DB:', nextRound);

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
      console.log('👤 P2 force-check dans 5s');

      // FORCE-CHECK après 5 secondes
      setTimeout(async () => {
        console.log('🔍 FORCE CHECK NOW');
        const { data: game } = await supabase
          .from('games')
          .select('*')
          .eq('id', currentGame.id)
          .single();

        if (game) {
          console.log('📊 Fetched:', game.current_round, 'vs', lastKnownRound.current);
          if (game.current_round !== lastKnownRound.current) {
            console.log('🎉 CHANGED! Update UI');
            handleGameUpdate(game);
          }
        }
      }, 5000);
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

  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
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
            <p className="text-gray-600 mt-2">Défiez des joueurs en temps réel</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Votre pseudo</label>
              <input
                type="text"
                value={pseudoInput}
                onChange={(e) => setPseudoInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Choisissez un pseudo..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                maxLength={20}
                disabled={loading}
              />
              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            </div>
            <Button
              onClick={handleLogin}
              disabled={loading || !pseudoInput.trim()}
              className="w-full bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 text-lg py-6 rounded-xl shadow-lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                  Connexion...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 w-5 h-5" />
                  Entrer dans l'arène
                </>
              )}
            </Button>
            <p className="text-center text-sm text-gray-500">
              <Wifi className="inline w-4 h-4 mr-1 text-green-500" />
              {onlinePlayers} joueurs en ligne
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "home") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="text-center py-6">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="p-2 bg-gradient-to-br from-rose-500 to-indigo-600 rounded-xl">
                <Swords className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-black bg-gradient-to-r from-rose-600 to-indigo-600 bg-clip-text text-transparent">
                DicoClash
              </h1>
            </div>
            <Badge variant="outline" className="text-base px-4 py-1">
              <User className="w-4 h-4 mr-2" />
              {currentPlayer?.pseudo}
            </Badge>
          </div>

          <Card className="border-2 border-rose-100 shadow-xl">
            <CardContent className="p-8 text-center space-y-6">
              <div>
                <h2 className="text-3xl font-bold mb-3 bg-gradient-to-r from-rose-600 to-indigo-600 bg-clip-text text-transparent">
                  Prêt pour le clash ?
                </h2>
                <p className="text-gray-600">Affrontez un adversaire en temps réel</p>
              </div>
              <Button
                onClick={joinQueue}
                className="text-xl px-12 py-7 h-auto bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 rounded-xl shadow-lg"
              >
                <Zap className="mr-2 w-6 h-6" />
                Trouver un adversaire
              </Button>
              <p className="text-sm text-gray-500">
                <Wifi className="inline w-4 h-4 mr-1 text-green-500" />
                {onlinePlayers} joueurs en ligne
              </p>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-2 border-indigo-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-600" />
                  Vos statistiques
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Parties</span>
                  <span className="font-bold">{currentPlayer?.total_games || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Victoires</span>
                  <span className="font-bold text-green-600">{currentPlayer?.games_won || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Score Donneur</span>
                  <Badge variant="secondary">{currentPlayer?.score_giver || 1500}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Score Devineur</span>
                  <Badge variant="secondary">{currentPlayer?.score_guesser || 1500}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-rose-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-rose-600" />
                  Comment jouer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>🎯 Matchs 1v1 temps réel</p>
                <p>🔄 4 tentatives maximum</p>
                <p>⏱️ 60 secondes par round</p>
                <p>🏆 4 rounds pour gagner</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-yellow-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-600" />
                Top 10
              </CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-center text-gray-500 py-4">Chargement...</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((p) => (
                    <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg border ${
                      p.id === currentPlayer?.id ? 'bg-rose-50 border-rose-200' : 'bg-gray-50'
                    }`}>
                      <div className="flex items-center gap-3">
                        {getRankBadge(p.rank)}
                        <span className="font-bold">#{p.rank}</span>
                        <span>{p.pseudo}</span>
                      </div>
                      <div className="text-sm">
                        <b>{Math.round(p.score_average)}</b> pts
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="text-center">
            <Button variant="outline" onClick={() => {
              stopHeartbeat();
              setCurrentPlayer(null);
              setGameState("login");
            }}>
              Changer de pseudo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === "queue") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-rose-100 shadow-xl">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-10 h-10 text-rose-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Recherche...</h2>
              <p className="text-gray-600">Connexion en cours</p>
            </div>
            <div className="space-y-2">
              <Progress value={(queueTime % 3) * 33} />
              <p className="text-sm text-gray-500">{queueTime}s</p>
            </div>
            <Button variant="outline" onClick={() => {
              leaveQueue();
              if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
              setGameState("home");
            }}>
              Annuler
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "results") {
    if (!currentGame) return null;
    const isP1 = currentGame.player1_id === currentPlayer?.id;
    const pScore = isP1 ? currentGame.player1_score : currentGame.player2_score;
    const oScore = isP1 ? currentGame.player2_score : currentGame.player1_score;
    const won = pScore > oScore;

    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-2 border-rose-100 shadow-xl">
          <CardContent className="p-8 space-y-6">
            <div className="text-center">
              {won ? (
                <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-12 h-12 text-yellow-600" />
                </div>
              ) : (
                <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star className="w-12 h-12 text-gray-400" />
                </div>
              )}
              <h2 className="text-4xl font-bold mb-2">
                {pScore === oScore ? "Nul !" : won ? "Victoire !" : "Défaite"}
              </h2>
            </div>

            <div className="flex justify-center gap-16 py-8">
              <div className="text-center">
                <p className="text-sm mb-2">{currentPlayer?.pseudo}</p>
                <p className="text-6xl font-bold text-indigo-600">{pScore}</p>
              </div>
              <div className="text-6xl text-gray-300">-</div>
              <div className="text-center">
                <p className="text-sm mb-2">{opponentPseudo}</p>
                <p className="text-6xl font-bold text-rose-600">{oScore}</p>
              </div>
            </div>

            <Button onClick={() => {
              setCurrentGame(null);
              setGameState("home");
            }} className="w-full bg-gradient-to-r from-rose-600 to-rose-700">
              <Zap className="mr-2" /> Nouvelle partie
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "playing" && currentGame) {
    const isGiver = currentGame.current_giver_id === currentPlayer?.id;
    const isP1 = currentGame.player1_id === currentPlayer?.id;
    const pScore = isP1 ? currentGame.player1_score : currentGame.player2_score;
    const oScore = isP1 ? currentGame.player2_score : currentGame.player1_score;
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          <Card className="border-2 border-rose-100">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">Round {currentGame.current_round}/4</h2>
                  <Badge variant={isGiver ? "default" : "secondary"} className={isGiver ? "bg-rose-600 mt-1" : "mt-1"}>
                    {isGiver ? "🎯 Donneur" : "🔍 Devineur"}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">vs {opponentPseudo}</p>
                  <p className="text-2xl font-bold">
                    <span className="text-indigo-600">{pScore}</span>
                    <span className="mx-2">-</span>
                    <span className="text-rose-600">{oScore}</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="border-2 border-rose-100">
              <CardContent className="p-4">
                <div className="flex justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    <span className="font-semibold">Temps</span>
                  </div>
                  <span className={`text-3xl font-bold ${timeLeft > 30 ? 'text-green-600' : timeLeft > 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {timeLeft}s
                  </span>
                </div>
                <Progress value={(timeLeft / 60) * 100} className="h-3" />
              </CardContent>
            </Card>

            <Card className="border-2 border-indigo-100">
              <CardContent className="p-4">
                <div className="flex justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    <span className="font-semibold">Tentatives</span>
                  </div>
                  <span className={`text-3xl font-bold ${attemptsLeft > 2 ? 'text-green-600' : attemptsLeft > 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {attemptsLeft}/4
                  </span>
                </div>
                <Progress value={(attempts.length / 4) * 100} className="h-3" />
              </CardContent>
            </Card>
          </div>

          {isGiver && (
            <Card className="border-2 border-rose-100">
              <CardHeader>
                <CardTitle className="text-center">Votre mot</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <div className="inline-block bg-gradient-to-r from-rose-600 to-indigo-600 text-white px-12 py-6 rounded-2xl text-5xl font-black">
                    {currentGame.current_word}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-2 border-gray-100">
            <CardHeader>
              <CardTitle>Historique</CardTitle>
              <CardDescription>
                {isTransitioning ? "Passage au round suivant..." : `${attemptsLeft} tentative(s) restante(s)`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {attempts.length === 0 && !isTransitioning && (
                <div className="text-center py-8 text-gray-500">
                  {isGiver ? "Donnez le premier indice" : `En attente de ${opponentPseudo}...`}
                </div>
              )}

              {attempts.map((att, i) => (
                <div key={i} className="border-2 rounded-xl p-4 bg-gray-50">
                  <div className="flex gap-3 mb-2">
                    <Badge className={isGiver ? "bg-indigo-600" : "bg-rose-600"}>#{i + 1}</Badge>
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">{isGiver ? "Votre indice :" : `Indice :`}</p>
                      <p className="font-bold text-lg">{att.clue}</p>
                    </div>
                  </div>
                  {att.guess && (
                    <div className="flex gap-3 mt-3 pt-3 border-t">
                      <Badge variant={att.correct ? "default" : "destructive"} className={att.correct ? "bg-green-600" : ""}>
                        {att.correct ? "✓" : "✗"}
                      </Badge>
                      <p><b>{att.guess}</b></p>
                    </div>
                  )}
                  {!att.guess && <p className="text-sm text-gray-500 italic mt-2 pt-2 border-t">En attente...</p>}
                </div>
              ))}

              {isTransitioning && (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-rose-600" />
                  <p className="font-semibold">Passage au round suivant...</p>
                </div>
              )}

              {!isTransitioning && isGiver && attemptsLeft > 0 && !waitingForOpponent && (
                (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
                  <Card className="border-2 border-rose-100 bg-rose-50">
                    <CardContent className="p-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={currentClue}
                          onChange={(e) => setCurrentClue(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendClue()}
                          placeholder="Votre indice..."
                          className="flex-1 px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                          maxLength={50}
                          autoFocus
                        />
                        <Button onClick={sendClue} disabled={!currentClue.trim()} className="bg-rose-600 px-6">
                          <Send className="w-5 h-5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}

              {!isTransitioning && !isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && !waitingForOpponent && (
                <Card className="border-2 border-indigo-100 bg-indigo-50">
                  <CardHeader>
                    <CardTitle>À vous !</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      onKeyPress={(e) => e.key === 'Enter' && submitGuess()}
                      placeholder="VOTRE RÉPONSE..."
                      className="w-full px-4 py-4 border-2 rounded-xl text-center font-black text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      maxLength={30}
                      autoFocus
                    />
                    <Button onClick={submitGuess} disabled={!currentGuess.trim()} className="w-full bg-indigo-600 py-4">
                      <Send className="mr-2" />
                      Valider
                    </Button>
                  </CardContent>
                </Card>
              )}

              {waitingForOpponent && !isTransitioning && (
                <div className="text-center py-6">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  <p className="text-gray-600">En attente de {opponentPseudo}...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default DicoClash;