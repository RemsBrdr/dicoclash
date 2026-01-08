"use client"

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";

type GameState = "login" | "home" | "searching" | "playing" | "waiting" | "results" | "leaderboard";
type Role = "giver" | "guesser";

interface Player {
  id: string;
  pseudo: string;
  score_giver: number;
  score_guesser: number;
  total_games: number;
  games_won: number;
}

interface GameRound {
  word: string;
  role: Role;
  clues: string[];
  timeLeft: number;
  roundNumber: number;
  opponentGuess: string;
}

interface LeaderboardEntry {
  id: string;
  pseudo: string;
  score_giver: number;
  score_guesser: number;
  score_average: number;
  total_games: number;
  games_won: number;
  win_rate: number;
}

const DicoClash = () => {
  const [mounted, setMounted] = useState(false);
  const [gameState, setGameState] = useState<GameState>("login");
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [pseudoInput, setPseudoInput] = useState("");
  const [opponentName, setOpponentName] = useState("Adversaire");
  const [currentRound, setCurrentRound] = useState<GameRound | null>(null);
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [score, setScore] = useState({ you: 0, opponent: 0 });
  const [totalRounds, setTotalRounds] = useState(0);
  const [searchTimer, setSearchTimer] = useState(0);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [gameHistory, setGameHistory] = useState<Array<{round: number, won: boolean, role: Role}>>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fix hydratation : attendre le montage côté client
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      loadLeaderboard();
      simulateOnlinePlayers();
    }
  }, [mounted]);

  const simulateOnlinePlayers = () => {
    const baseCount = 127;
    const variance = Math.floor(Math.random() * 20) - 10;
    setOnlinePlayers(baseCount + variance);

    const interval = setInterval(() => {
      setOnlinePlayers(prev => {
        const change = Math.floor(Math.random() * 5) - 2;
        return Math.max(50, Math.min(200, prev + change));
      });
    }, 5000);

    return () => clearInterval(interval);
  };

  const loadLeaderboard = async () => {
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('*')
        .limit(10);

      if (error) throw error;
      if (data) setLeaderboard(data);
    } catch (err) {
      console.error('Erreur chargement classement:', err);
    }
  };

  const handleLogin = async () => {
    if (!pseudoInput.trim()) {
      setError("Veuillez entrer un pseudo");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: existingPlayer, error: searchError } = await supabase
        .from('players')
        .select('*')
        .eq('pseudo', pseudoInput.trim())
        .single();

      if (searchError && searchError.code !== 'PGRST116') {
        throw searchError;
      }

      let player: Player;

      if (existingPlayer) {
        const { data: updatedPlayer, error: updateError } = await supabase
          .from('players')
          .update({ last_played: new Date().toISOString() })
          .eq('id', existingPlayer.id)
          .select()
          .single();

        if (updateError) throw updateError;
        player = updatedPlayer;
      } else {
        const { data: newPlayer, error: insertError } = await supabase
          .from('players')
          .insert([{
            pseudo: pseudoInput.trim(),
            email: null
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        player = newPlayer;
      }

      setCurrentPlayer(player);
      setGameState("home");
    } catch (err: any) {
      console.error('Erreur login:', err);
      setError(err.message || "Erreur lors de la connexion");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (gameState === "searching") {
      const interval = setInterval(() => {
        setSearchTimer(prev => prev + 1);
      }, 1000);

      const timeout = setTimeout(() => {
        const opponents = ["Alice", "Bob", "Charlie", "Diana", "Ethan", "Fiona"];
        setOpponentName(opponents[Math.floor(Math.random() * opponents.length)]);
        startNewRound();
      }, 2000 + Math.random() * 2000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    } else {
      setSearchTimer(0);
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === "playing" && currentRound && currentRound.timeLeft > 0) {
      const interval = setInterval(() => {
        setCurrentRound(prev => {
          if (!prev || prev.timeLeft <= 0) return prev;

          const newTimeLeft = prev.timeLeft - 1;

          if (newTimeLeft === 0) {
            setTimeout(() => endRound(false), 500);
          }

          return { ...prev, timeLeft: newTimeLeft };
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [gameState, currentRound?.timeLeft]);

  const startGame = async () => {
    setGameState("searching");
    setScore({ you: 0, opponent: 0 });
    setTotalRounds(0);
    setGameHistory([]);

    try {
      const { data: game, error } = await supabase
        .from('games')
        .insert([{
          player1_id: currentPlayer?.id,
          player2_id: null,
          status: 'playing'
        }])
        .select()
        .single();

      if (error) throw error;
      setCurrentGameId(game.id);
    } catch (err) {
      console.error('Erreur création partie:', err);
    }
  };

  const startNewRound = async () => {
    const newRoundNumber = totalRounds + 1;
    const role: Role = newRoundNumber % 2 === 1 ? "giver" : "guesser";

    try {
      const { data, error } = await supabase
        .rpc('get_random_word');

      if (error) throw error;

      const word = data || "ELEPHANT";

      setCurrentRound({
        word: word,
        role: role,
        clues: [],
        timeLeft: 60,
        roundNumber: newRoundNumber,
        opponentGuess: ""
      });

      setCurrentClue("");
      setCurrentGuess("");
      setGameState("playing");
      setTotalRounds(newRoundNumber);
    } catch (err) {
      console.error('Erreur chargement mot:', err);
      const fallbackWords = ["ELEPHANT", "GUITARE", "MONTAGNE"];
      const word = fallbackWords[Math.floor(Math.random() * fallbackWords.length)];

      setCurrentRound({
        word: word,
        role: role,
        clues: [],
        timeLeft: 60,
        roundNumber: newRoundNumber,
        opponentGuess: ""
      });

      setCurrentClue("");
      setCurrentGuess("");
      setGameState("playing");
      setTotalRounds(newRoundNumber);
    }
  };

  const sendClue = () => {
    if (!currentRound || !currentClue.trim() || currentRound.clues.length >= 4) return;

    const clueUpper = currentClue.trim().toUpperCase();

    if (currentRound.word.substring(0, 3) === clueUpper.substring(0, 3)) {
      alert("⚠️ L'indice ne peut pas commencer par les 3 mêmes lettres que le mot !");
      return;
    }

    const newClues = [...currentRound.clues, currentClue.trim()];
    setCurrentRound({ ...currentRound, clues: newClues });
    setCurrentClue("");

    if (newClues.length >= 2 && Math.random() > 0.4) {
      setTimeout(() => {
        setCurrentRound(prev => prev ? { ...prev, opponentGuess: prev.word } : null);
        setTimeout(() => endRound(false), 1500);
      }, 1000 + Math.random() * 1000);
    }
  };

  const submitGuess = () => {
    if (!currentRound || !currentGuess.trim()) return;

    const guessUpper = currentGuess.trim().toUpperCase();
    const isCorrect = guessUpper === currentRound.word;

    endRound(isCorrect);
  };

  const endRound = async (won: boolean) => {
    if (!currentRound) return;

    if (won) {
      setScore(prev => ({ ...prev, you: prev.you + 1 }));
    } else {
      setScore(prev => ({ ...prev, opponent: prev.opponent + 1 }));
    }

    setGameHistory(prev => [...prev, {
      round: currentRound.roundNumber,
      won: won,
      role: currentRound.role
    }]);

    try {
      await supabase.from('rounds').insert([{
        game_id: currentGameId,
        round_number: currentRound.roundNumber,
        word: currentRound.word,
        giver_id: currentRound.role === 'giver' ? currentPlayer?.id : null,
        guesser_id: currentRound.role === 'guesser' ? currentPlayer?.id : null,
        clues: currentRound.clues,
        won: won,
        duration: 60 - currentRound.timeLeft
      }]);
    } catch (err) {
      console.error('Erreur sauvegarde round:', err);
    }

    if (totalRounds >= 4) {
      await finishGame();
    } else {
      setGameState("waiting");
      setTimeout(() => startNewRound(), 2500);
    }
  };

  const finishGame = async () => {
    const playerWon = score.you > score.opponent;

    try {
      if (currentGameId) {
        await supabase
          .from('games')
          .update({
            player1_score: score.you,
            player2_score: score.opponent,
            winner_id: playerWon ? currentPlayer?.id : null,
            status: 'finished',
            finished_at: new Date().toISOString()
          })
          .eq('id', currentGameId);
      }

      if (currentPlayer) {
        await supabase
          .from('players')
          .update({
            total_games: currentPlayer.total_games + 1,
            games_won: currentPlayer.games_won + (playerWon ? 1 : 0),
            score_giver: currentPlayer.score_giver + (playerWon ? 10 : -5),
            score_guesser: currentPlayer.score_guesser + (playerWon ? 10 : -5)
          })
          .eq('id', currentPlayer.id);
      }

      await loadLeaderboard();
    } catch (err) {
      console.error('Erreur fin de partie:', err);
    }

    setGameState("results");
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
    if (rank === 2) return <Star className="w-4 h-4 text-gray-400" />;
    if (rank === 3) return <Star className="w-4 h-4 text-amber-600" />;
    return null;
  };

  // Fix hydratation : ne rien afficher avant le montage
  if (!mounted) {
    return null;
  }

  // Page de connexion
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
                {error && (
                  <p className="text-sm text-red-600 mt-2">{error}</p>
                )}
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
              <p className="text-xs text-gray-500 text-center">
                Votre pseudo vous permet de garder vos scores et de figurer au classement
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Page d'accueil
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
                      Affrontez des adversaires en temps réel dans des duels de vocabulaire
                    </p>
                  </div>

                  <Button
                    onClick={startGame}
                    className="text-xl px-12 py-6 h-auto bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                  >
                    <Zap className="mr-2 w-6 h-6" />
                    Lancer un Clash
                  </Button>

                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span>{onlinePlayers} joueurs en ligne</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="w-5 h-5 text-red-600" />
                  Comment clasher
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-600 font-bold">
                    1
                  </div>
                  <p className="text-sm text-gray-700">
                    <strong>Faire deviner :</strong> Donnez jusqu'à 4 indices pour faire deviner votre mot
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                    2
                  </div>
                  <p className="text-sm text-gray-700">
                    <strong>Deviner :</strong> Trouvez le mot de votre adversaire avec ses indices
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-600 font-bold">
                    3
                  </div>
                  <p className="text-sm text-gray-700">
                    <strong>Chrono :</strong> 60 secondes maximum par manche
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600 font-bold">
                    4
                  </div>
                  <p className="text-sm text-gray-700">
                    <strong>Victoire :</strong> Remportez le plus de manches sur 4 rounds
                  </p>
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
                  <p className="text-center text-gray-500 py-4">
                    Chargement du classement...
                  </p>
                ) : (
                  leaderboard.map((player, index) => (
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
                          {getRankBadge(index + 1)}
                          <span className="font-bold text-gray-700">#{index + 1}</span>
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
                          <p className="text-xs text-gray-500">Score moy.</p>
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

  // Recherche d'adversaire
  if (gameState === "searching") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-red-100">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <User className="w-8 h-8 text-red-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Recherche d'adversaire...</h2>
              <p className="text-gray-600">Préparation du clash</p>
            </div>
            <div className="space-y-2">
              <Progress value={(searchTimer % 3) * 33} className="h-2" />
              <p className="text-sm text-gray-500">{searchTimer}s écoulées</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // En attente entre les rounds
  if (gameState === "waiting") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-red-100">
          <CardContent className="p-8 text-center space-y-6">
            <h2 className="text-2xl font-bold">Prochain round...</h2>
            <div className="text-4xl font-bold text-red-600">
              Round {totalRounds + 1}/4
            </div>
            <div className="flex justify-center gap-8">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">{currentPlayer?.pseudo}</p>
                <p className="text-3xl font-bold text-blue-600">{score.you}</p>
              </div>
              <div className="text-4xl text-gray-300">-</div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">{opponentName}</p>
                <p className="text-3xl font-bold text-red-600">{score.opponent}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Résultats finaux
  if (gameState === "results") {
    const winner = score.you > score.opponent ? currentPlayer?.pseudo : score.opponent > score.you ? opponentName : "Égalité";
    const isWinner = score.you > score.opponent;

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
                {winner === "Égalité" ? "Match nul !" : `${winner} remporte le clash !`}
              </h2>
              <p className="text-gray-600">Partie terminée</p>
            </div>

            <div className="flex justify-center gap-12 py-6">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">{currentPlayer?.pseudo}</p>
                <p className="text-5xl font-bold text-blue-600">{score.you}</p>
              </div>
              <div className="text-5xl text-gray-300 self-center">-</div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">{opponentName}</p>
                <p className="text-5xl font-bold text-red-600">{score.opponent}</p>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-center mb-3">Récapitulatif du clash</h3>
              {gameHistory.map((item) => (
                <div
                  key={item.round}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    item.won ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <span className="font-medium">
                    Round {item.round} - {item.role === "giver" ? "Donneur" : "Devineur"}
                  </span>
                  <Badge variant={item.won ? "default" : "secondary"}>
                    {item.won ? "✓ Gagné" : "✗ Perdu"}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={startGame}
                className="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
              >
                <Zap className="mr-2 w-4 h-4" />
                Nouveau Clash
              </Button>
              <Button
                onClick={() => {
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

  // Interface de jeu
  if (gameState === "playing" && currentRound) {
    const isGiver = currentRound.role === "giver";
    const timePercent = (currentRound.timeLeft / 60) * 100;

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Round {currentRound.roundNumber}/4</h2>
              <p className="text-sm text-gray-600">
                Vous êtes : <Badge variant={isGiver ? "default" : "secondary"} className={isGiver ? "bg-red-600" : ""}>
                  {isGiver ? "Donneur" : "Devineur"}
                </Badge>
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span>vs {opponentName}</span>
              </div>
              <div className="text-xl font-bold">
                <span className="text-blue-600">{score.you}</span>
                <span className="text-gray-400 mx-2">-</span>
                <span className="text-red-600">{score.opponent}</span>
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
                  currentRound.timeLeft > 30 ? 'text-green-600' :
                  currentRound.timeLeft > 10 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {currentRound.timeLeft}s
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
                      {currentRound.word}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Vos indices ({currentRound.clues.length}/4)</CardTitle>
                  <CardDescription>
                    Attention : les indices ne peuvent pas commencer par les 3 premières lettres du mot
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentRound.clues.map((clue, index) => (
                    <div key={index} className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <Badge className="bg-blue-600">{index + 1}</Badge>
                      <span className="font-medium">{clue}</span>
                    </div>
                  ))}

                  {currentRound.clues.length < 4 && (
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

                  {currentRound.clues.length >= 4 && (
                    <p className="text-center text-sm text-gray-500">
                      Vous avez utilisé tous vos indices
                    </p>
                  )}
                </CardContent>
              </Card>

              {currentRound.opponentGuess && (
                <Card className="border-2 border-green-200 bg-green-50">
                  <CardContent className="p-4 text-center">
                    <p className="text-green-700 font-semibold">
                      🎉 {opponentName} a trouvé le mot : {currentRound.opponentGuess} !
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Indices de {opponentName}</CardTitle>
                  <CardDescription>
                    Utilisez ces indices pour deviner le mot
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {currentRound.clues.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">
                      En attente du premier indice...
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {currentRound.clues.map((clue, index) => (
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
                      disabled={currentRound.clues.length === 0}
                    />
                    <Button
                      onClick={submitGuess}
                      disabled={!currentGuess.trim() || currentRound.clues.length === 0}
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