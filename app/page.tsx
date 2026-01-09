"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi, Target, Brain, Sparkles, Timer, MessageSquare, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type GameState = "login" | "home" | "queue" | "playing" | "waiting" | "results";

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
  const gameSubscription = useRef<any>(null);
  const roundsSubscription = useRef<any>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedRound = useRef(0);

  useEffect(() => {
    setMounted(true);
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
      const interval = setInterval(() => {
        setQueueTime(prev => prev + 1);
      }, 1000);
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
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }
    if (currentPlayer) {
      await supabase.from('presence').update({
        status: 'offline'
      }).eq('player_id', currentPlayer.id);
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
        await supabase
          .from('players')
          .update({ last_played: new Date().toISOString() })
          .eq('id', existingPlayer.id);
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
          if (matchmakingInterval.current) {
            clearInterval(matchmakingInterval.current);
          }

          const opponentId = existingGame.player1_id === currentPlayer.id
            ? existingGame.player2_id
            : existingGame.player1_id;

          const { data: opponent } = await supabase
            .from('players')
            .select('pseudo')
            .eq('id', opponentId)
            .single();

          if (opponent) setOpponentPseudo(opponent.pseudo);

          setCurrentGame(existingGame);
          setTimeLeft(60);
          setAttempts([]);
          setWaitingForOpponent(false);
          setIsTransitioning(false);
          lastProcessedRound.current = existingGame.current_round;

          setTimeout(() => {
            subscribeToGame(existingGame.id);
            setGameState("playing");
          }, 500);

          return;
        }

        const { data } = await supabase.rpc('match_players');

        if (data && data.length > 0) {
          const match = data[0];

          if (match.player1_id === currentPlayer.id || match.player2_id === currentPlayer.id) {
            if (matchmakingInterval.current) {
              clearInterval(matchmakingInterval.current);
            }

            const opponentId = match.player1_id === currentPlayer.id ? match.player2_id : match.player1_id;
            const { data: opponent } = await supabase
              .from('players')
              .select('pseudo')
              .eq('id', opponentId)
              .single();

            if (opponent) setOpponentPseudo(opponent.pseudo);

            const { data: game } = await supabase
              .from('games')
              .select('*')
              .eq('id', match.game_id)
              .single();

            if (game) {
              setCurrentGame(game);
              setTimeLeft(60);
              setAttempts([]);
              setWaitingForOpponent(false);
              setIsTransitioning(false);
              lastProcessedRound.current = game.current_round;

              setTimeout(() => {
                subscribeToGame(match.game_id);
                setGameState("playing");
              }, 500);
            }
          }
        }
      }, 2000);

      setTimeout(() => {
        if (matchmakingInterval.current) {
          clearInterval(matchmakingInterval.current);
        }
        if (gameState === "queue") {
          leaveQueue();
          setError("Aucun adversaire trouvé. Réessayez.");
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

  const subscribeToGame = (gameId: string) => {
    console.log('🔗 Abonnement au jeu:', gameId);

    gameSubscription.current = supabase
      .channel(`game:${gameId}:${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`
      }, (payload: any) => {
        console.log('🎮 UPDATE reçu:', payload);
        if (payload.new) {
          const gameData = payload.new as GameData;

          // Si le round a changé ET qu'on ne l'a pas encore traité
          if (gameData.current_round !== lastProcessedRound.current) {
            console.log('🔄 NOUVEAU ROUND:', gameData.current_round, 'Ancien:', lastProcessedRound.current, 'État:', gameState);
            lastProcessedRound.current = gameData.current_round;

            // Reset complet
            setAttempts([]);
            setCurrentClue("");
            setCurrentGuess("");
            setWaitingForOpponent(false);
            setTimeLeft(60);
            setIsTransitioning(false);

            // FORCER le passage à "playing" peu importe l'état actuel
            console.log('✅ FORCER gameState = playing');
            setGameState("playing");
          }

          setCurrentGame(gameData);

          if (gameData.status === 'finished') {
            console.log('🏁 Partie terminée');
            handleGameEnd(gameData);
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Statut subscription game:', status);
      });

    roundsSubscription.current = supabase
      .channel(`rounds:${gameId}:${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rounds',
        filter: `game_id=eq.${gameId}`
      }, async (payload: any) => {
        console.log('📥 Nouveau round reçu:', payload);

        if (payload.new) {
          const newRound = payload.new;

          if (newRound.clues && newRound.clues.length > 0 && newRound.giver_id) {
            if (newRound.giver_id !== currentPlayer?.id) {
              const lastClue = newRound.clues[newRound.clues.length - 1];

              setAttempts(prev => {
                const exists = prev.some(a => a.clue === lastClue);
                if (exists) return prev;
                console.log('➕ Ajout indice:', lastClue);
                return [...prev, { clue: lastClue, guess: '', correct: false }];
              });

              setWaitingForOpponent(false);
            }
          }

          if (newRound.guess_word && newRound.guesser_id) {
            console.log('🎯 Réponse:', newRound.guess_word, 'Won:', newRound.won);

            if (newRound.guesser_id !== currentPlayer?.id) {
              setAttempts(prev => {
                const newAttempts = [...prev];
                const lastAttempt = newAttempts[newAttempts.length - 1];

                if (lastAttempt && !lastAttempt.guess) {
                  lastAttempt.guess = newRound.guess_word;
                  lastAttempt.correct = newRound.won || false;
                }

                return newAttempts;
              });

              if (newRound.won) {
                console.log('✅ Mot trouvé, transition');
                setIsTransitioning(true);
                setTimeout(() => handleNextRound(), 2000);
              } else {
                setWaitingForOpponent(false);
              }
            }
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Statut subscription rounds:', status);
      });
  };

  const unsubscribeFromGame = () => {
    if (gameSubscription.current) {
      supabase.removeChannel(gameSubscription.current);
    }
    if (roundsSubscription.current) {
      supabase.removeChannel(roundsSubscription.current);
    }
  };

  const sendClue = async () => {
    if (!currentGame || !currentClue.trim() || attempts.length >= 4 || waitingForOpponent) return;

    const clueUpper = currentClue.trim().toUpperCase();

    if (currentGame.current_word.substring(0, 3) === clueUpper.substring(0, 3)) {
      alert("⚠️ L'indice ne peut pas commencer par les 3 mêmes lettres que le mot !");
      return;
    }

    console.log('📤 Envoi indice:', currentClue.trim());

    setAttempts(prev => [...prev, { clue: currentClue.trim(), guess: '', correct: false }]);
    setCurrentClue("");
    setWaitingForOpponent(true);

    const allClues = [...attempts.map(a => a.clue), currentClue.trim()];

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      giver_id: currentPlayer?.id,
      clues: allClues
    });

    await supabase.from('games').update({
      attempts_used: allClues.length
    }).eq('id', currentGame.id);
  };

  const submitGuess = async () => {
    if (!currentGame || !currentGuess.trim() || waitingForOpponent) return;

    const guessUpper = currentGuess.trim().toUpperCase();
    const isCorrect = guessUpper === currentGame.current_word;

    console.log('🎯 Envoi réponse:', guessUpper, 'Correct:', isCorrect);

    setAttempts(prev => {
      const newAttempts = [...prev];
      const lastAttempt = newAttempts[newAttempts.length - 1];
      if (lastAttempt) {
        lastAttempt.guess = guessUpper;
        lastAttempt.correct = isCorrect;
      }
      return newAttempts;
    });

    setCurrentGuess("");
    setWaitingForOpponent(true);

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      guesser_id: currentPlayer?.id,
      guess_word: guessUpper,
      won: isCorrect,
      time_taken: 60 - timeLeft
    });

    if (isCorrect) {
      const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
      await supabase.from('games').update({
        [isPlayer1 ? 'player1_score' : 'player2_score']: isPlayer1 ? currentGame.player1_score + 1 : currentGame.player2_score + 1
      }).eq('id', currentGame.id);

      console.log('✅ Mot trouvé par moi, transition');
      setIsTransitioning(true);
      setTimeout(() => handleNextRound(), 2000);
    } else if (attempts.length >= 4) {
      console.log('❌ 4 tentatives, next round');
      setIsTransitioning(true);
      setTimeout(() => handleNextRound(), 2000);
    } else {
      setWaitingForOpponent(false);
    }
  };

  const handleTimeOut = () => {
    console.log('⏱️ Timeout');
    setIsTransitioning(true);
    handleNextRound();
  };

  const handleNextRound = async () => {
    if (!currentGame) {
      console.log('⚠️ Pas de currentGame');
      return;
    }

    console.log('🔄 handleNextRound - Round:', currentGame.current_round);

    if (currentGame.current_round >= 4) {
      console.log('🏁 Fin partie');
      await supabase.from('games').update({
        status: 'finished'
      }).eq('id', currentGame.id);
      return;
    }

    // NE PAS changer gameState ici, laisser la subscription gérer
    console.log('⏳ Attente 3s avant update BDD');

    // UNIQUEMENT Player1 update la BDD
    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;

    if (isPlayer1) {
      console.log('👑 Player1 update BDD');

      setTimeout(async () => {
        const nextRound = currentGame.current_round + 1;
        const { data: word } = await supabase.rpc('get_random_word');
        const newGiverId = currentGame.current_giver_id === currentGame.player1_id
          ? currentGame.player2_id
          : currentGame.player1_id;

        console.log('📝 UPDATE BDD Round:', nextRound);

        await supabase.from('games').update({
          current_round: nextRound,
          current_word: word || 'ELEPHANT',
          current_giver_id: newGiverId,
          time_left: 60,
          attempts_used: 0,
          round_start_time: new Date().toISOString()
        }).eq('id', currentGame.id);

        console.log('✅ UPDATE BDD OK');
      }, 3000);
    } else {
      console.log('👤 Player2 attend subscription');
    }
  };

  const handleGameEnd = async (game: GameData) => {
    unsubscribeFromGame();

    const isPlayer1 = game.player1_id === currentPlayer?.id;
    const playerWon = isPlayer1
      ? game.player1_score > game.player2_score
      : game.player2_score > game.player1_score;

    if (currentPlayer) {
      await supabase.from('players').update({
        total_games: currentPlayer.total_games + 1,
        games_won: currentPlayer.games_won + (playerWon ? 1 : 0),
        score_giver: currentPlayer.score_giver + (playerWon ? 10 : -5),
        score_guesser: currentPlayer.score_guesser + (playerWon ? 10 : -5)
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

  // [ÉTATS UI - Login, Home, Queue - identiques, je saute à Waiting et Playing]

  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50">
        <div className="border-b bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-red-500 to-blue-600 rounded-xl">
                  <Swords className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <h1 className="text-2xl sm:text-4xl font-bold bg-gradient-to-r from-red-600 to-blue-600 bg-clip-text text-transparent">
                  DicoClash
                </h1>
              </div>
              <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
                <Wifi className="w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                <span className="hidden sm:inline">{onlinePlayers} joueurs en ligne</span>
                <span className="sm:hidden">{onlinePlayers}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6 sm:py-12">
          <div className="text-center mb-8 sm:mb-12">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-500" />
              <Badge variant="outline" className="text-xs sm:text-sm">
                Jeu multijoueur en temps réel
              </Badge>
            </div>
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6">
              <span className="bg-gradient-to-r from-red-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
                60 secondes.
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-red-600 bg-clip-text text-transparent">
                4 tentatives. 1 champion.
              </span>
            </h2>
            <p className="text-base sm:text-xl text-gray-600 mb-8 max-w-2xl mx-auto px-4">
              Affrontez des adversaires du monde entier dans des duels de vocabulaire explosifs !
            </p>

            <Card className="max-w-md mx-auto border-2 border-red-100 shadow-lg">
              <CardContent className="p-4 sm:p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-left">
                      Choisissez votre pseudo
                    </label>
                    <input
                      type="text"
                      value={pseudoInput}
                      onChange={(e) => setPseudoInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                      placeholder="Votre pseudo..."
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-base"
                      maxLength={20}
                      disabled={loading}
                    />
                    {error && <p className="text-sm text-red-600 mt-2 text-left">{error}</p>}
                  </div>

                  <Button
                    onClick={handleLogin}
                    disabled={loading || !pseudoInput.trim()}
                    className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-base sm:text-lg py-5 sm:py-6"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Connexion...
                      </>
                    ) : (
                      <>
                        <LogIn className="mr-2 w-5 h-5" />
                        Entrer dans l'arène
                      </>
                    )}
                  </Button>

                  <p className="text-xs sm:text-sm text-gray-500 text-center">
                    <Users className="inline w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                    Aucun compte requis, juste un pseudo !
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sections Comment jouer, Règles, Leaderboard - identiques au code précédent */}
          <div className="mt-8 sm:mt-12 text-center text-xs sm:text-sm text-gray-500">
            <p>DicoClash - Le jeu de vocabulaire multijoueur ultra-rapide</p>
            <p className="mt-2">
              <Wifi className="inline w-3 h-3 mr-1" />
              {onlinePlayers} joueurs connectés en ce moment
            </p>
          </div>
        </div>
      </div>
    );
  }

  // États home, queue - gardez le code précédent tel quel

  if (gameState === "waiting") {
    if (!currentGame) return null;

    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
    const playerScore = isPlayer1 ? currentGame.player1_score : currentGame.player2_score;
    const opponentScore = isPlayer1 ? currentGame.player2_score : currentGame.player1_score;

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-red-100">
          <CardContent className="p-8 text-center space-y-6">
            <h2 className="text-2xl font-bold">Prochain round...</h2>
            <div className="text-4xl font-bold text-red-600">
              Round {currentGame.current_round + 1}/4
            </div>
            <div className="flex justify-center gap-8">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">{currentPlayer?.pseudo}</p>
                <p className="text-3xl font-bold text-blue-600">{playerScore}</p>
              </div>
              <div className="text-4xl text-gray-300">-</div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">{opponentPseudo}</p>
                <p className="text-3xl font-bold text-red-600">{opponentScore}</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 italic">
              En attente de la synchronisation...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // États results, playing - gardez le code précédent tel quel

  return null;
};

export default DicoClash;