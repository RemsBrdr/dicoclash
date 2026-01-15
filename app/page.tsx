"use client"

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Swords, LogIn, Users, Send, Loader2, Trophy, Star, Play, TrendingUp, Target, Shield, Crown, AlertCircle, Zap, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Attempt {
  clue: string;
  guess: string;
  correct: boolean;
}

interface LeaderboardEntry {
  id: string;
  pseudo: string;
  score_giver: number;
  total_games: number;
  games_won: number;
}

const normalizeString = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
};

const DicoClash = () => {
  const [gameState, setGameState] = useState<"welcome" | "home" | "queue" | "playing" | "results">("welcome");
  const [pseudo, setPseudo] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [playerScore, setPlayerScore] = useState(1000);
  const [totalGames, setTotalGames] = useState(0);
  const [gamesWon, setGamesWon] = useState(0);
  const [gameId, setGameId] = useState("");
  const [partnerPseudo, setPartnerPseudo] = useState("");
  const [isGiver, setIsGiver] = useState(false);
  const [word, setWord] = useState("");
  const [round, setRound] = useState(1);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [timeLeft, setTimeLeft] = useState(60);
  const [teamScore, setTeamScore] = useState(0);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [activeGames, setActiveGames] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [clueError, setClueError] = useState("");

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('✅ WebSocket connected');
      setWs(socket);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('📩 Received:', data.type, data);

      switch (data.type) {
        case 'stats_update':
          setActiveGames(data.activeGames);
          setOnlinePlayers(data.onlinePlayers);
          break;

        case 'queue_update':
          setQueueSize(data.queueSize);
          break;

        case 'game_start':
          setGameId(data.gameId);
          setPartnerPseudo(data.partnerPseudo);
          setIsGiver(data.isGiver);
          setWord(data.word || '');
          setRound(data.round);
          setAttempts([]);
          setTimeLeft(60);
          setTeamScore(0);
          setGameState('playing');
          break;

        case 'new_clue':
          setAttempts(data.attempts);
          setWaitingForPartner(false);
          break;

        case 'clue_sent':
          setAttempts(data.attempts);
          setWaitingForPartner(true);
          break;

        case 'new_guess':
          setAttempts(data.attempts);
          setWaitingForPartner(false);
          if (data.correct) {
            setTeamScore(prev => prev + 1);
          }
          break;

        case 'new_round':
          setRound(data.round);
          setIsGiver(data.isGiver);
          setWord(data.word || '');
          setAttempts([]);
          setTimeLeft(60);
          setWaitingForPartner(false);
          break;

        case 'timer_update':
          setTimeLeft(data.timeLeft);
          break;

        case 'game_end':
          setTeamScore(data.teamScore);
          updatePlayerStats(data.teamScore);
          setGameState('results');
          break;

        case 'partner_disconnected':
          alert('Votre complice s\'est déconnecté');
          reloadPlayerData();
          setGameState('home');
          break;
      }
    };

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('🔌 WebSocket closed');
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    const { data: topPlayers } = await supabase
      .from('players')
      .select('id, pseudo, score_giver, total_games, games_won')
      .order('score_giver', { ascending: false })
      .limit(10);

    if (topPlayers) setLeaderboard(topPlayers);
  };

  const reloadPlayerData = async () => {
    if (!playerId) return;

    console.log('🔄 Reloading player data for:', playerId);

    const { data: player, error } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (error) {
      console.error('❌ Error reloading player:', error);
    } else if (player) {
      console.log('✅ Player reloaded:', player);
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);
    }
  };

  const updatePlayerStats = async (finalScore: number) => {
    if (!playerId) {
      console.error('❌ No playerId!');
      return;
    }

    const wordsFound = finalScore;
    const wordsMissed = 4 - finalScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);
    const isPerfect = finalScore === 4;

    console.log('📊 Updating stats:', { playerId, wordsFound, wordsMissed, pointsGained, isPerfect });

    // Récupérer les données actuelles
    const { data: currentPlayer, error: fetchError } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching player:', fetchError);
      return;
    }

    if (currentPlayer) {
      const newScore = currentPlayer.score_giver + pointsGained;
      const newTotalGames = currentPlayer.total_games + 1;
      const newGamesWon = currentPlayer.games_won + (isPerfect ? 1 : 0);

      console.log('💾 Updating to:', {
        oldScore: currentPlayer.score_giver,
        newScore,
        oldGames: currentPlayer.total_games,
        newTotalGames,
        oldWon: currentPlayer.games_won,
        newGamesWon
      });

      // Mettre à jour dans Supabase
      const { error: updateError } = await supabase
        .from('players')
        .update({
          score_giver: newScore,
          total_games: newTotalGames,
          games_won: newGamesWon
        })
        .eq('id', playerId);

      if (updateError) {
        console.error('❌ Update error:', updateError);
      } else {
        console.log('✅ Stats updated successfully in DB');

        // Mettre à jour l'état local immédiatement
        setPlayerScore(newScore);
        setTotalGames(newTotalGames);
        setGamesWon(newGamesWon);

        console.log('✅ Local state updated');

        // Recharger le classement
        await loadStats();
      }
    }
  };

  const handleLogin = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pseudo.trim()) return;

    setLoading(true);

    try {
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('pseudo', pseudo.trim())
        .single();

      let player;

      if (existingPlayer) {
        player = existingPlayer;
        await supabase.from('players').update({ last_played: new Date().toISOString() }).eq('id', player.id);
      } else {
        const { data: newPlayer, error } = await supabase
          .from('players')
          .insert([{ pseudo: pseudo.trim() }])
          .select()
          .single();

        if (error || !newPlayer) {
          alert('Erreur lors de la création du joueur');
          setLoading(false);
          return;
        }

        player = newPlayer;
      }

      setPlayerId(player.id);
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);

      console.log('✅ Player logged in:', player);

      ws.send(JSON.stringify({ type: 'player_online', playerId: player.id }));

      setGameState('home');
    } catch (err) {
      console.error('❌ Error:', err);
      alert('Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !playerId) return;

    ws.send(JSON.stringify({
      type: 'join_queue',
      playerId,
      pseudo
    }));

    setGameState('queue');
  };

  const validateClue = (clue: string) => {
    const normalizedClue = normalizeString(clue);
    const normalizedWord = normalizeString(word);

    if (normalizedClue === normalizedWord) {
      return "Vous ne pouvez pas donner le mot lui-même !";
    }

    if (normalizedWord.includes(normalizedClue) && normalizedClue.length > 2) {
      return "L'indice est contenu dans le mot !";
    }

    if (normalizedClue.includes(normalizedWord) && normalizedWord.length > 2) {
      return "L'indice contient le mot !";
    }

    if (normalizedWord.substring(0, 3) === normalizedClue.substring(0, 3)) {
      return "Premiers caractères identiques";
    }

    if (normalizedWord.slice(-3) === normalizedClue.slice(-3) && normalizedClue.length > 3) {
      return "Derniers caractères identiques";
    }

    return "";
  };

  const sendClue = () => {
    if (!ws || !currentClue.trim()) return;

    const error = validateClue(currentClue.trim());
    if (error) {
      setClueError(error);
      setTimeout(() => setClueError(""), 3000);
      return;
    }

    setClueError("");

    ws.send(JSON.stringify({
      type: 'send_clue',
      gameId,
      clue: currentClue.trim()
    }));
    setCurrentClue('');
  };

  const sendGuess = () => {
    if (!ws || !currentGuess.trim()) return;

    ws.send(JSON.stringify({
      type: 'send_guess',
      gameId,
      guess: currentGuess.trim()
    }));
    setCurrentGuess('');
  };

  // PAGE WELCOME
  if (gameState === 'welcome') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/bg.svg)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-black/50 backdrop-blur-sm">
          <div className="bg-black/30 border-b border-white/10 backdrop-blur-md py-2 text-center text-xs text-gray-300">
            Publicité - 728x90
          </div>

          <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
            <div className="text-center py-12 space-y-6">
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-pink-600 rounded-3xl blur-2xl opacity-60 animate-pulse"></div>
                  <div className="relative p-6 bg-gradient-to-br from-cyan-500 via-blue-600 to-pink-600 rounded-3xl shadow-2xl">
                    <Swords className="w-16 h-16 text-white" strokeWidth={2.5} />
                  </div>
                </div>
              </div>

              <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-pink-500 drop-shadow-2xl">
                DicoClash
              </h1>
              <p className="text-xl md:text-2xl text-white font-bold drop-shadow-lg">
                Jeu de mots coopératif multijoueur
              </p>

              <div className="flex justify-center gap-8 md:gap-16 py-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-3xl md:text-4xl font-black text-green-400 drop-shadow-lg">
                    <Users className="w-8 h-8" strokeWidth={3} />
                    {onlinePlayers}
                  </div>
                  <p className="text-sm text-gray-200 font-bold mt-1 drop-shadow">en ligne</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-3xl md:text-4xl font-black text-blue-400 drop-shadow-lg">
                    <Zap className="w-8 h-8" strokeWidth={3} />
                    {activeGames}
                  </div>
                  <p className="text-sm text-gray-200 font-bold mt-1 drop-shadow">parties</p>
                </div>
              </div>

              <Card className="max-w-md mx-auto border-2 border-cyan-400/30 shadow-2xl bg-black/40 backdrop-blur-md">
                <CardContent className="p-8 space-y-4">
                  <input
                    type="text"
                    value={pseudo}
                    onChange={(e) => setPseudo(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="Votre pseudo..."
                    className="w-full px-5 py-4 text-lg font-bold border-2 border-cyan-400/50 bg-white/90 text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
                    maxLength={20}
                    disabled={loading}
                  />
                  <Button
                    onClick={handleLogin}
                    disabled={!pseudo.trim() || !ws || ws.readyState !== WebSocket.OPEN || loading}
                    className="group relative w-full bg-gradient-to-r from-cyan-500 via-blue-600 to-pink-600 hover:from-cyan-600 hover:via-blue-700 hover:to-pink-700 text-white text-xl font-black py-6 rounded-xl shadow-2xl transition-all transform hover:scale-105 border-2 border-white/20"
                  >
                    <div className="absolute inset-0 bg-white/20 rounded-xl blur group-hover:blur-lg transition-all"></div>
                    <div className="relative flex items-center justify-center gap-2">
                      {loading ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          Connexion...
                        </>
                      ) : (
                        <>
                          <Play className="w-6 h-6" fill="white" strokeWidth={0} />
                          JOUER MAINTENANT
                        </>
                      )}
                    </div>
                  </Button>
                  {(!ws || ws.readyState !== WebSocket.OPEN) && (
                    <p className="text-sm text-orange-400 text-center font-bold">Connexion au serveur...</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-2 border-blue-400/30 bg-black/40 backdrop-blur-md shadow-xl">
              <CardHeader className="bg-white/5 border-b border-white/10">
                <CardTitle className="text-2xl font-black flex items-center gap-2 text-white">
                  <Target className="w-6 h-6 text-cyan-400" />
                  Comment jouer ?
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-full flex items-center justify-center font-black shadow-md">1</div>
                      <div>
                        <h3 className="font-bold text-lg text-white">Trouvez un complice</h3>
                        <p className="text-sm text-gray-300">Matchmaking automatique et rapide</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-indigo-500 to-pink-600 text-white rounded-full flex items-center justify-center font-black shadow-md">2</div>
                      <div>
                        <h3 className="font-bold text-lg text-white">Donnez des indices</h3>
                        <p className="text-sm text-gray-300">Alternez les rôles à chaque manche</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-full flex items-center justify-center font-black shadow-md">3</div>
                      <div>
                        <h3 className="font-bold text-lg text-white">Trouvez ensemble</h3>
                        <p className="text-sm text-gray-300">4 mots, 4 tentatives, 60 secondes</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-yellow-500 to-orange-600 text-white rounded-full flex items-center justify-center font-black shadow-md">4</div>
                      <div>
                        <h3 className="font-bold text-lg text-white">Marquez des points</h3>
                        <p className="text-sm text-gray-300">+25 pts par mot, -10 si raté</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-cyan-500/20 rounded-xl border-2 border-cyan-400/30 backdrop-blur-sm">
                  <p className="text-sm text-white font-bold">
                    <Shield className="inline w-5 h-5 mr-2 text-cyan-400" />
                    <strong>Règle :</strong> Vos indices ne doivent pas être trop similaires au mot à deviner !
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-yellow-400/30 bg-black/40 backdrop-blur-md shadow-xl">
              <CardHeader className="bg-white/5 border-b border-white/10">
                <CardTitle className="text-2xl font-black flex items-center gap-2 text-white">
                  <Trophy className="w-6 h-6 text-yellow-400" />
                  Classement
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-400">Chargement...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((player, index) => (
                      <div key={player.id} className={`flex justify-between items-center p-4 rounded-xl border-2 transition-all ${
                        index === 0 ? 'bg-yellow-500/20 border-yellow-400/30' :
                        index === 1 ? 'bg-gray-400/20 border-gray-400/30' :
                        index === 2 ? 'bg-amber-600/20 border-amber-400/30' :
                        'bg-white/5 border-white/10'
                      }`}>
                        <div className="flex items-center gap-4">
                          {index === 0 && <Crown className="w-6 h-6 text-yellow-400" />}
                          {index === 1 && <Star className="w-6 h-6 text-gray-400" />}
                          {index === 2 && <Star className="w-6 h-6 text-amber-600" />}
                          <span className="font-black text-gray-400 text-lg w-8">#{index + 1}</span>
                          <span className="font-bold text-lg text-white">{player.pseudo}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-cyan-400">{player.score_giver}</div>
                          <div className="text-xs text-gray-400 font-medium">{player.total_games} parties • {player.games_won} parfaites</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-black/40 backdrop-blur-md border-2 border-white/10 rounded-xl p-12 text-center text-xs text-gray-400 shadow">
                Publicité - 300x250
              </div>
              <div className="bg-black/40 backdrop-blur-md border-2 border-white/10 rounded-xl p-12 text-center text-xs text-gray-400 shadow">
                Publicité - 300x250
              </div>
            </div>
          </div>

          <div className="bg-black/30 border-t border-white/10 backdrop-blur-md py-2 text-center text-xs text-gray-300 mt-12">
            Publicité - 728x90
          </div>
        </div>
      </div>
    );
  }

  // PAGE HOME
  if (gameState === 'home') {
    const myRank = leaderboard.findIndex(p => p.id === playerId) + 1;

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/bg.svg)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-black/50 backdrop-blur-sm">
          <div className="bg-black/30 border-b border-white/10 backdrop-blur-md py-2 text-center text-xs text-gray-300">
            Publicité - 728x90
          </div>

          <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-black text-white drop-shadow-2xl mb-3">
                {pseudo}
              </h1>
              <div className="flex justify-center gap-4 flex-wrap">
                <Badge className="text-lg px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-2 border-cyan-400/30 shadow-lg">
                  <Crown className="w-5 h-5 mr-2" />
                  {playerScore} points
                </Badge>
                {myRank > 0 && (
                  <Badge className="text-lg px-6 py-2 border-2 bg-black/40 backdrop-blur-md text-white border-pink-400/30 shadow-lg">
                    #{myRank} au classement
                  </Badge>
                )}
              </div>
            </div>

            <Card className="border-2 border-cyan-400/30 shadow-2xl bg-black/40 backdrop-blur-md">
              <CardContent className="p-8 text-center space-y-6">
                <h2 className="text-3xl font-black text-white">Prêt pour l'aventure ?</h2>
                <Button
                  onClick={joinQueue}
                  className="group relative text-2xl px-20 py-10 h-auto bg-gradient-to-r from-cyan-500 via-blue-600 to-pink-600 hover:from-cyan-600 hover:via-blue-700 hover:to-pink-700 rounded-2xl shadow-2xl font-black transform hover:scale-105 transition-all duration-300 border-4 border-white/20"
                >
                  <div className="absolute inset-0 bg-white/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all"></div>
                  <div className="relative flex items-center justify-center gap-4">
                    <div className="w-12 h-12 bg-white/30 rounded-full flex items-center justify-center">
                      <Play className="w-8 h-8" fill="white" strokeWidth={0} />
                    </div>
                    <span className="text-white drop-shadow-lg">JOUER</span>
                  </div>
                </Button>
                <div className="flex justify-center gap-12 mt-6">
                  <div className="text-center">
                    <div className="text-green-400 text-3xl font-black drop-shadow-lg">{onlinePlayers}</div>
                    <p className="text-xs text-gray-300 font-bold">En ligne</p>
                  </div>
                  <div className="text-center">
                    <div className="text-blue-400 text-3xl font-black drop-shadow-lg">{activeGames}</div>
                    <p className="text-xs text-gray-300 font-bold">Parties</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-black/40 backdrop-blur-md border-2 border-yellow-400/30 shadow">
                <CardContent className="p-6 text-center">
                  <Trophy className="w-12 h-12 mx-auto mb-3 text-yellow-400" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-white drop-shadow">{totalGames}</p>
                  <p className="text-sm text-gray-200 font-bold mt-1">Parties</p>
                </CardContent>
              </Card>
              <Card className="bg-black/40 backdrop-blur-md border-2 border-green-400/30 shadow">
                <CardContent className="p-6 text-center">
                  <Star className="w-12 h-12 mx-auto mb-3 text-green-400" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-white drop-shadow">{gamesWon}</p>
                  <p className="text-sm text-gray-200 font-bold mt-1">Parfaites</p>
                </CardContent>
              </Card>
              <Card className="bg-black/40 backdrop-blur-md border-2 border-cyan-400/30 shadow">
                <CardContent className="p-6 text-center">
                  <Zap className="w-12 h-12 mx-auto mb-3 text-cyan-400" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-white drop-shadow">{playerScore}</p>
                  <p className="text-sm text-gray-200 font-bold mt-1">Score</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-2 border-blue-400/30 bg-black/40 backdrop-blur-md shadow">
                <CardHeader className="bg-white/5 border-b border-white/10 pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-white">
                    <Target className="w-5 h-5 text-cyan-400" />
                    Règles du jeu
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2 text-sm">
                  <p className="font-bold text-white">🎯 4 mots à deviner en équipe</p>
                  <p className="font-bold text-white">🔄 4 tentatives par mot maximum</p>
                  <p className="font-bold text-white">⏱️ 60 secondes chrono</p>
                  <p className="font-bold text-green-400">✅ +25 pts si trouvé</p>
                  <p className="font-bold text-red-400">❌ -10 pts si raté</p>
                </CardContent>
              </Card>

              <Card className="border-2 border-yellow-400/30 bg-black/40 backdrop-blur-md shadow">
                <CardHeader className="bg-white/5 border-b border-white/10 pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-white">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                    Top 5
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {leaderboard.length === 0 ? (
                    <p className="text-center text-gray-400 py-4 text-sm">Chargement...</p>
                  ) : (
                    <div className="space-y-2">
                      {leaderboard.slice(0, 5).map((player, index) => (
                        <div key={player.id} className={`flex justify-between items-center p-2 rounded-lg ${player.id === playerId ? 'bg-cyan-500/30 border-2 border-cyan-400' : 'bg-white/10 border border-white/10'}`}>
                          <div className="flex items-center gap-2">
                            {index === 0 && <Crown className="w-4 h-4 text-yellow-400" />}
                            <span className="font-black text-gray-400 text-sm">#{index + 1}</span>
                            <span className="font-bold text-sm text-white">{player.pseudo}</span>
                          </div>
                          <div className="text-cyan-400 font-black text-lg">{player.score_giver}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-black/40 backdrop-blur-md border-2 border-white/10 rounded-xl p-12 text-center text-xs text-gray-400 shadow">
                Publicité - 300x250
              </div>
              <div className="bg-black/40 backdrop-blur-md border-2 border-white/10 rounded-xl p-12 text-center text-xs text-gray-400 shadow">
                Publicité - 300x250
              </div>
            </div>

            <div className="text-center">
              <Button variant="outline" className="border-2 border-white/20 bg-black/40 backdrop-blur-md text-white hover:bg-white/10" onClick={() => {
                if (ws) ws.send(JSON.stringify({ type: 'player_offline', playerId }));
                setGameState('welcome');
                setPseudo('');
              }}>
                <X className="w-4 h-4 mr-2" />
                Déconnexion
              </Button>
            </div>
          </div>

          <div className="bg-black/30 border-t border-white/10 backdrop-blur-md py-2 text-center text-xs text-gray-300 mt-12">
            Publicité - 728x90
          </div>
        </div>
      </div>
    );
  }

  // PAGE QUEUE
  if (gameState === 'queue') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/bg.svg)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-2 border-cyan-400/30 shadow-2xl bg-black/40 backdrop-blur-md">
            <CardContent className="p-10 text-center space-y-6">
              <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto shadow-lg">
                <Users className="w-12 h-12 text-cyan-400 animate-pulse" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-3xl font-black text-white mb-2 drop-shadow-lg">Recherche...</h2>
                <p className="text-white font-medium text-lg mt-3">
                  <span className="text-3xl font-black text-cyan-400">{queueSize}</span> joueur{queueSize > 1 ? 's' : ''} en attente
                </p>
                <p className="text-sm text-gray-300 font-medium mt-2">
                  {activeGames} parties en cours
                </p>
              </div>
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-cyan-400" strokeWidth={3} />
              <Button variant="outline" className="border-2 border-white/20 bg-white/10 text-white w-full py-6 hover:bg-white/20" onClick={() => {
                if (ws) ws.send(JSON.stringify({ type: 'leave_queue', playerId }));
                setGameState('home');
              }}>
                Annuler
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // PAGE PLAYING
  if (gameState === 'playing') {
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/bg.svg)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-black/50 backdrop-blur-sm p-2 md:p-4">
          <div className="max-w-5xl mx-auto space-y-3">
            <div className={`${isGiver ? 'bg-gradient-to-r from-cyan-600 to-blue-700' : 'bg-gradient-to-r from-indigo-600 to-purple-700'} text-white p-4 md:p-5 rounded-xl border-2 ${isGiver ? 'border-cyan-400/30' : 'border-indigo-400/30'} shadow-lg`}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-xl md:text-2xl font-black mb-1">MANCHE {round}/4</div>
                  <Badge className={`${isGiver ? 'bg-white text-cyan-700' : 'bg-white text-indigo-700'} border-0 font-bold text-sm`}>
                    {isGiver ? "🎯 VOUS FAITES DEVINER" : "🔍 VOUS DEVINEZ"}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold mb-1">avec {partnerPseudo}</div>
                  <div className="text-4xl md:text-5xl font-black mb-1">
                    {teamScore}/4
                  </div>
                  <div className={`text-2xl font-black ${timeLeft > 30 ? 'text-green-300' : timeLeft > 10 ? 'text-yellow-300' : 'text-red-300 animate-pulse'}`}>
                    {timeLeft}s
                  </div>
                </div>
              </div>
            </div>

            {isGiver && (
              <Card className="border-2 border-cyan-400/30 bg-black/40 backdrop-blur-md shadow-lg">
                <CardHeader className="pb-3 border-b border-white/10 bg-white/5">
                  <CardTitle className="text-center text-xl font-black text-white">MOT À FAIRE DEVINER</CardTitle>
                </CardHeader>
                <CardContent className="p-6 md:p-10">
                  <div className="text-center">
                    <div className="inline-block bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-10 md:px-16 py-6 md:py-8 rounded-2xl text-4xl md:text-6xl font-black shadow-xl">
                      {word}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              <Card className="border-2 border-blue-400/30 bg-black/40 backdrop-blur-md shadow-lg">
                <CardHeader className="pb-3 bg-white/5 border-b border-white/10">
                  <CardTitle className="text-base font-black flex items-center gap-2 text-white">
                    {!isGiver && <span className="text-cyan-400">→</span>}
                    INDICES
                    {!isGiver && <span className="text-cyan-400">←</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {attempts.map((att, i) => (
                    <div key={i} className={`p-3 rounded-lg ${i % 2 === 0 ? 'bg-blue-500/20 border border-blue-400/30' : 'bg-white/10 border border-white/10'} shadow-sm`}>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-cyan-500 text-white font-bold">#{i + 1}</Badge>
                        <p className="font-bold text-lg text-white">{att.clue}</p>
                      </div>
                    </div>
                  ))}
                  {attempts.length === 0 && <p className="text-center text-gray-400 py-8 text-sm font-medium">Aucun indice</p>}
                </CardContent>
              </Card>

              <Card className="border-2 border-indigo-400/30 bg-black/40 backdrop-blur-md shadow-lg">
                <CardHeader className="pb-3 bg-white/5 border-b border-white/10">
                  <CardTitle className="text-base font-black flex items-center gap-2 text-white">
                    {isGiver && <span className="text-indigo-400">→</span>}
                    RÉPONSES
                    {isGiver && <span className="text-indigo-400">←</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {attempts.map((att, i) => (
                    <div key={i} className={`p-3 rounded-lg ${att.correct ? 'bg-green-500/30 border-2 border-green-400' : att.guess ? 'bg-red-500/20 border border-red-400/50' : 'bg-white/5 border border-white/10'} shadow-sm`}>
                      <div className="flex items-center gap-2">
                        {att.guess && (
                          <Badge className={`${att.correct ? 'bg-green-600' : 'bg-red-600'} text-white font-bold`}>
                            {att.correct ? '✓' : '✗'}
                          </Badge>
                        )}
                        <p className="font-bold text-lg text-white">{att.guess || '...'}</p>
                      </div>
                    </div>
                  ))}
                  {attempts.length === 0 && <p className="text-center text-gray-400 py-8 text-sm font-medium">Aucune réponse</p>}
                </CardContent>
              </Card>
            </div>

            {clueError && (
              <div className="p-4 bg-red-500/30 border-2 border-red-400 rounded-xl flex items-center gap-3 shadow-lg backdrop-blur-md">
                <AlertCircle className="w-6 h-6 text-red-300" strokeWidth={3} />
                <p className="text-sm font-bold text-white">{clueError}</p>
              </div>
            )}

            {isGiver && attemptsLeft > 0 && !waitingForPartner && (
              (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
                <Card className="border-2 border-cyan-400/30 bg-black/40 backdrop-blur-md shadow-lg">
                  <CardContent className="p-4">
                    <form onSubmit={(e) => { e.preventDefault(); sendClue(); }} className="flex gap-3">
                      <input
                        type="text"
                        value={currentClue}
                        onChange={(e) => setCurrentClue(e.target.value)}
                        placeholder="Donnez votre indice..."
                        className="flex-1 px-5 py-4 text-lg font-medium border-2 border-cyan-400/50 bg-white/90 text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        maxLength={50}
                        autoFocus
                        required
                      />
                      <Button type="submit" disabled={!currentClue.trim()} className="bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-4 font-bold text-lg">
                        <Send className="w-6 h-6" strokeWidth={3} />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )
            )}

            {!isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && !waitingForPartner && (
              <Card className="border-2 border-indigo-400/30 bg-black/40 backdrop-blur-md shadow-lg">
                <CardHeader className="pb-3 bg-white/5 border-b border-white/10">
                  <CardTitle className="text-xl font-black text-white">VOTRE RÉPONSE</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <form onSubmit={(e) => { e.preventDefault(); sendGuess(); }}>
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      placeholder="VOTRE RÉPONSE..."
                      className="w-full px-5 py-5 border-2 border-indigo-400/50 bg-white/90 text-gray-900 rounded-xl text-center font-black text-3xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      maxLength={30}
                      autoFocus
                      required
                    />
                    <Button type="submit" disabled={!currentGuess.trim()} className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 py-5 mt-4 font-black text-xl">
                      <Send className="mr-2 w-6 h-6" />
                      VALIDER
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {waitingForPartner && (
              <div className="text-center py-8 bg-black/40 rounded-xl border-2 border-white/10 shadow backdrop-blur-md">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-cyan-400" strokeWidth={3} />
                <p className="text-white font-bold text-lg">En attente de {partnerPseudo}...</p>
              </div>
            )}

            <div className="bg-black/40 backdrop-blur-md border-2 border-white/10 rounded-xl p-6 text-center text-xs text-gray-400 shadow">
              Publicité - 728x90
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PAGE RESULTS
  if (gameState === 'results') {
    const isPerfect = teamScore === 4;
    const wordsFound = teamScore;
    const wordsMissed = 4 - teamScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/bg.svg)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl border-2 border-cyan-400/30 shadow-2xl bg-black/40 backdrop-blur-md">
            <CardContent className="p-8 md:p-12 space-y-8">
              <div className="text-center">
                {isPerfect ? (
                  <div className="w-28 h-28 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Crown className="w-16 h-16 text-white" strokeWidth={3} />
                  </div>
                ) : teamScore >= 2 ? (
                  <div className="w-28 h-28 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Trophy className="w-16 h-16 text-white" strokeWidth={3} />
                  </div>
                ) : (
                  <div className="w-28 h-28 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Star className="w-16 h-16 text-white" strokeWidth={3} />
                  </div>
                )}
                <h2 className="text-5xl font-black text-white mb-2 drop-shadow-2xl">
                  {isPerfect ? "PARFAIT !" : teamScore >= 2 ? "BIEN JOUÉ !" : "PERDU..."}
                </h2>
                <p className="text-gray-300 text-lg font-medium">avec {partnerPseudo}</p>
              </div>

              <div className="text-center py-8 bg-white/10 rounded-2xl border-2 border-cyan-400/30">
                <div className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500">
                  {teamScore}/4
                </div>
                <p className="text-white font-bold text-xl mt-2">Mots trouvés</p>
              </div>

              <div className="bg-white/10 rounded-2xl p-6 border-2 border-white/10">
                <h3 className="font-black text-xl mb-4 text-white">RÉCAPITULATIF</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-medium text-gray-200">Mots trouvés :</span>
                    <span className="font-black text-green-400 text-2xl">+{wordsFound * 25}</span>
                  </div>
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-medium text-gray-200">Mots manqués :</span>
                    <span className="font-black text-red-400 text-2xl">-{wordsMissed * 10}</span>
                  </div>
                  <div className="border-t-2 border-white/20 pt-3 mt-3">
                    <div className="flex justify-between items-center text-xl">
                      <span className="font-bold text-white">Total :</span>
                      <span className={`font-black text-3xl ${pointsGained >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pointsGained >= 0 ? '+' : ''}{pointsGained}
                      </span>
                    </div>
                  </div>
                  <div className="border-t-2 border-white/20 pt-3 mt-3 bg-cyan-500/20 -mx-6 px-6 py-4 rounded-xl">
                    <div className="flex justify-between items-center text-2xl">
                      <span className="font-black text-white">Nouveau score :</span>
                      <span className="font-black text-cyan-400">{playerScore}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={() => {
                reloadPlayerData();
                setGameState('home');
              }} className="w-full bg-gradient-to-r from-cyan-500 via-blue-600 to-pink-600 hover:from-cyan-600 hover:via-blue-700 hover:to-pink-700 text-2xl font-black py-8 rounded-xl shadow-lg transform hover:scale-105 transition-all">
                <Play className="mr-3 w-8 h-8" strokeWidth={3} fill="white" />
                RETOUR
              </Button>

              <div className="bg-white/10 border-2 border-white/10 rounded-xl p-10 text-center text-xs text-gray-400">
                Publicité - 468x60
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default DicoClash;