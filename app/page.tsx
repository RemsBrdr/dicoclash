"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi } from "lucide-react";
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
}

interface LeaderboardEntry {
  id: string;
  pseudo: string;
  score_average: number;
  total_games: number;
  games_won: number;
  rank: number;
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
  const [clues, setClues] = useState<string[]>([]);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueTime, setQueueTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const gameSubscription = useRef<any>(null);
  const roundsSubscription = useRef<any>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && currentPlayer) {
      loadLeaderboard();
      updateOnlineCount();
      startHeartbeat();

      const interval = setInterval(updateOnlineCount, 10000);
      return () => {
        clearInterval(interval);
        stopHeartbeat();
      };
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
      console.log('🎯 Rejoindre la queue pour', currentPlayer.pseudo);

      await supabase.from('queue').insert({
        player_id: currentPlayer.id,
        elo_score: Math.round((currentPlayer.score_giver + currentPlayer.score_guesser) / 2)
      });

      setGameState("queue");

      matchmakingInterval.current = setInterval(async () => {
        console.log('🔍 Polling matchmaking pour', currentPlayer.pseudo);

        // D'abord vérifier si on est déjà dans une partie
        const { data: existingGame } = await supabase
          .from('games')
          .select('*')
          .or(`player1_id.eq.${currentPlayer.id},player2_id.eq.${currentPlayer.id}`)
          .eq('status', 'playing')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existingGame) {
          console.log('✅ Partie existante trouvée !', existingGame);

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
          setClues([]);
          subscribeToGame(existingGame.id);
          setGameState("playing");
          return;
        }

        // Sinon, essayer de matcher
        console.log('🎲 Tentative de match...');
        const { data, error } = await supabase.rpc('match_players');
        console.log('📊 Résultat match_players:', data, error);

        if (data && data.length > 0) {
          const match = data[0];
          console.log('✅ Match créé !', match);

          if (match.player1_id === currentPlayer.id || match.player2_id === currentPlayer.id) {
            console.log('🎮 C\'est notre match !');

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
              setClues([]);
              subscribeToGame(match.game_id);
              setGameState("playing");
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
      console.error('❌ Erreur joinQueue:', err);
      setError(err.message);
      setGameState("home");
    }
  };

  const leaveQueue = async () => {
    if (!currentPlayer) return;
    await supabase.from('queue').delete().eq('player_id', currentPlayer.id);
  };

  const subscribeToGame = (gameId: string) => {
    gameSubscription.current = supabase
      .channel(`game:${gameId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`
      }, (payload: any) => {
        if (payload.new) {
          const gameData = payload.new as GameData;
          setCurrentGame(gameData);

          if (gameData.status === 'finished') {
            handleGameEnd(gameData);
          }
        }
      })
      .subscribe();

    roundsSubscription.current = supabase
      .channel(`rounds:${gameId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rounds',
        filter: `game_id=eq.${gameId}`
      }, (payload: any) => {
        if (payload.new && payload.new.clues) {
          setClues(payload.new.clues as string[]);
        }
      })
      .subscribe();
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
    if (!currentGame || !currentClue.trim() || clues.length >= 4) return;

    const clueUpper = currentClue.trim().toUpperCase();

    if (currentGame.current_word.substring(0, 3) === clueUpper.substring(0, 3)) {
      alert("⚠️ L'indice ne peut pas commencer par les 3 mêmes lettres que le mot !");
      return;
    }

    const newClues = [...clues, currentClue.trim()];
    setClues(newClues);
    setCurrentClue("");

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      giver_id: currentPlayer?.id,
      clues: newClues
    });
  };

  const submitGuess = async () => {
    if (!currentGame || !currentGuess.trim()) return;

    const guessUpper = currentGuess.trim().toUpperCase();
    const isCorrect = guessUpper === currentGame.current_word;

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
    }

    handleNextRound();
  };

  const handleTimeOut = () => {
    handleNextRound();
  };

  const handleNextRound = async () => {
    if (!currentGame) return;

    if (currentGame.current_round >= 4) {
      await supabase.from('games').update({
        status: 'finished'
      }).eq('id', currentGame.id);
    } else {
      setGameState("waiting");
      setClues([]);
      setCurrentGuess("");

      setTimeout(async () => {
        const nextRound = currentGame.current_round + 1;
        const { data: word } = await supabase.rpc('get_random_word');
        const newGiverId = currentGame.current_giver_id === currentGame.player1_id
          ? currentGame.player2_id
          : currentGame.player1_id;

        await supabase.from('games').update({
          current_round: nextRound,
          current_word: word || 'ELEPHANT',
          current_giver_id: newGiverId,
          time_left: 60,
          round_start_time: new Date().toISOString()
        }).eq('id', currentGame.id);

        setTimeLeft(60);
        setGameState("playing");
      }, 3000);
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

  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-red-100">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Swords className="w-10 h-10 text-red-600" />
              <CardTitle className="text-4xl font-bold bg-gradient-to-r from-red-600 to-blue-600 bg-clip-text text-transparent">
                DicoClash
              </CardTitle>
            </div>
            <CardDescription className="text-lg">
              60 secondes. 4 indices. 1 champion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Choisissez votre pseudo
                </label>
                <input
                  type="text"
                  value={pseudoInput}
                  onChange={(e) => setPseudoInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Votre pseudo..."
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  maxLength={20}
                  disabled={loading}
                />
                {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
              </div>

              <Button
                onClick={handleLogin}
                disabled={loading || !pseudoInput.trim()}
                className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                size="lg"
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
            </div>

            <div className="border-t pt-4">
              <p className="text-sm text-gray-600 text-center mb-3">
                <Users className="inline w-4 h-4 mr-1" />
                Pas besoin de compte, juste un pseudo !
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "home") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Swords className="w-12 h-12 text-red-600" />
              <h1 className="text-5xl font-bold bg-gradient-to-r from-red-600 to-blue-600 bg-clip-text text-transparent">
                DicoClash
              </h1>
            </div>
            <p className="text-gray-700 text-xl font-semibold mb-2">
              60 secondes. 4 indices. 1 champion.
            </p>
            <Badge variant="outline" className="text-base">
              <User className="w-4 h-4 mr-2" />
              {currentPlayer?.pseudo}
            </Badge>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <Card className="md:col-span-2 border-2 border-red-100">
              <CardContent className="p-8">
                <div className="text-center space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-3">Prêt pour le clash ?</h2>
                    <p className="text-gray-600 mb-6">
                      Affrontez des adversaires réels en temps réel
                    </p>
                  </div>

                  <Button
                    onClick={joinQueue}
                    className="text-xl px-12 py-6 h-auto bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                  >
                    <Zap className="mr-2 w-6 h-6" />
                    Trouver un adversaire
                  </Button>

                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <Wifi className="w-4 h-4 text-green-500" />
                    <span>{onlinePlayers} joueurs en ligne</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-600" />
                  Vos statistiques
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Parties jouées</span>
                  <span className="font-bold">{currentPlayer?.total_games || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Victoires</span>
                  <span className="font-bold text-green-600">{currentPlayer?.games_won || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Score Donneur</span>
                  <Badge variant="secondary">{currentPlayer?.score_giver || 1500}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Score Devineur</span>
                  <Badge variant="secondary">{currentPlayer?.score_guesser || 1500}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="w-5 h-5 text-red-600" />
                  Comment jouer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-700">
                <p>⚔️ Matchs en 1 vs 1 contre de vrais joueurs</p>
                <p>🎯 4 rounds par partie (alternance donneur/devineur)</p>
                <p>⏱️ 60 secondes et 4 indices maximum</p>
                <p>🏆 Gagnez des points ELO à chaque victoire</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-600" />
                Classement des Champions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {leaderboard.length === 0 ? (
                  <p className="text-center text-gray-500 py-4">Chargement...</p>
                ) : (
                  leaderboard.map((player) => (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        player.id === currentPlayer?.id
                          ? 'bg-red-50 border-red-200'
                          : 'bg-gradient-to-r from-gray-50 to-transparent border-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          {getRankBadge(player.rank)}
                          <span className="font-bold text-gray-700">#{player.rank}</span>
                        </div>
                        <span className="font-medium">
                          {player.pseudo}
                          {player.id === currentPlayer?.id && (
                            <Badge variant="outline" className="ml-2 text-xs">Vous</Badge>
                          )}
                        </span>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Score</p>
                          <p className="font-bold">{Math.round(player.score_average)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Victoires</p>
                          <p className="font-bold text-green-600">{player.games_won}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 text-center">
            <Button
              variant="outline"
              onClick={() => {
                stopHeartbeat();
                setCurrentPlayer(null);
                setGameState("login");
              }}
            >
              Changer de pseudo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === "queue") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-red-100">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-8 h-8 text-red-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Recherche d'adversaire...</h2>
              <p className="text-gray-600">Un vrai joueur va vous rejoindre</p>
            </div>
            <div className="space-y-2">
              <Progress value={(queueTime % 3) * 33} className="h-2" />
              <p className="text-sm text-gray-500">{queueTime}s écoulées</p>
              <p className="text-xs text-gray-400">
                <Wifi className="inline w-3 h-3 mr-1" />
                {onlinePlayers} joueurs en ligne
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                leaveQueue();
                if (matchmakingInterval.current) {
                  clearInterval(matchmakingInterval.current);
                }
                setGameState("home");
              }}
            >
              Annuler
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "results") {
    if (!currentGame) return null;

    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
    const playerScore = isPlayer1 ? currentGame.player1_score : currentGame.player2_score;
    const opponentScore = isPlayer1 ? currentGame.player2_score : currentGame.player1_score;
    const isWinner = playerScore > opponentScore;

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-2 border-red-100">
          <CardContent className="p-8 space-y-6">
            <div className="text-center">
              {isWinner ? (
                <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-10 h-10 text-yellow-600" />
                </div>
              ) : (
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star className="w-10 h-10 text-gray-400" />
                </div>
              )}
              <h2 className="text-3xl font-bold mb-2">
                {playerScore === opponentScore ? "Match nul !" : isWinner ? "Victoire !" : "Défaite"}
              </h2>
              <p className="text-gray-600">Partie terminée</p>
            </div>

            <div className="flex justify-center gap-12 py-6">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">{currentPlayer?.pseudo}</p>
                <p className="text-5xl font-bold text-blue-600">{playerScore}</p>
              </div>
              <div className="text-5xl text-gray-300 self-center">-</div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">{opponentPseudo}</p>
                <p className="text-5xl font-bold text-red-600">{opponentScore}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setCurrentGame(null);
                  setGameState("home");
                  loadLeaderboard();
                }}
                className="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
              >
                <Zap className="mr-2 w-4 h-4" />
                Nouveau Match
              </Button>
              <Button
                onClick={() => {
                  setCurrentGame(null);
                  setGameState("home");
                  loadLeaderboard();
                }}
                variant="outline"
                className="flex-1"
              >
                Accueil
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "playing" && currentGame) {
    const isGiver = currentGame.current_giver_id === currentPlayer?.id;
    const timePercent = (timeLeft / 60) * 100;
    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
    const playerScore = isPlayer1 ? currentGame.player1_score : currentGame.player2_score;
    const opponentScore = isPlayer1 ? currentGame.player2_score : currentGame.player1_score;

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Round {currentGame.current_round}/4</h2>
              <p className="text-sm text-gray-600">
                Vous êtes : <Badge variant={isGiver ? "default" : "secondary"} className={isGiver ? "bg-red-600" : ""}>
                  {isGiver ? "Donneur" : "Devineur"}
                </Badge>
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span>vs {opponentPseudo}</span>
              </div>
              <div className="text-xl font-bold">
                <span className="text-blue-600">{playerScore}</span>
                <span className="text-gray-400 mx-2">-</span>
                <span className="text-red-600">{opponentScore}</span>
              </div>
            </div>
          </div>

          <Card className="border-2 border-red-100">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-gray-600" />
                  <span className="font-semibold">Temps restant</span>
                </div>
                <span className={`text-2xl font-bold ${
                  timeLeft > 30 ? 'text-green-600' :
                  timeLeft > 10 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {timeLeft}s
                </span>
              </div>
              <Progress value={timePercent} className="h-3" />
            </CardContent>
          </Card>

          {isGiver ? (
            <>
              <Card className="border-2 border-red-100">
                <CardHeader>
                  <CardTitle>Votre mot à faire deviner</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8">
                    <div className="inline-block bg-gradient-to-r from-red-600 to-blue-600 text-white px-8 py-4 rounded-xl text-4xl font-bold tracking-wider shadow-lg">
                      {currentGame.current_word}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Vos indices ({clues.length}/4)</CardTitle>
                  <CardDescription>
                    Les indices ne peuvent pas commencer par les 3 premières lettres du mot
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {clues.map((clue, index) => (
                    <div key={index} className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <Badge className="bg-blue-600">{index + 1}</Badge>
                      <span className="font-medium">{clue}</span>
                    </div>
                  ))}

                  {clues.length < 4 && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={currentClue}
                        onChange={(e) => setCurrentClue(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendClue()}
                        placeholder="Tapez un indice..."
                        className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        maxLength={50}
                      />
                      <Button
                        onClick={sendClue}
                        disabled={!currentClue.trim()}
                        className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Envoyer
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Indices de {opponentPseudo}</CardTitle>
                </CardHeader>
                <CardContent>
                  {clues.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">
                      En attente du premier indice...
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {clues.map((clue, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200"
                        >
                          <div className="flex-shrink-0 w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center font-bold">
                            {index + 1}
                          </div>
                          <span className="text-lg font-medium">{clue}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-2 border-red-100">
                <CardHeader>
                  <CardTitle>Votre réponse</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      onKeyPress={(e) => e.key === 'Enter' && submitGuess()}
                      placeholder="VOTRE RÉPONSE..."
                      className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-bold uppercase"
                      maxLength={30}
                      disabled={clues.length === 0}
                    />
                    <Button
                      onClick={submitGuess}
                      disabled={!currentGuess.trim() || clues.length === 0}
                      className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                      size="lg"
                    >
                      <Send className="w-5 h-5 mr-2" />
                      Valider ma réponse
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default DicoClash;