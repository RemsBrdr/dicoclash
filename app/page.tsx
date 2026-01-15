"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Swords, LogIn, Users, Send, Loader2, Trophy, Star, Play, TrendingUp, Target, Shield, Crown, AlertCircle, Zap, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ========== COMPOSANT PUBLICITÉ ==========
const AdBanner = ({
  slot,
  format = "auto",
  style = { display: 'block' },
  className = ""
}: {
  slot: string;
  format?: string;
  style?: React.CSSProperties;
  className?: string;
}) => {
  useEffect(() => {
    try {
      // @ts-ignore
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, []);

  return (
    <div className={className}>
      <ins
        className="adsbygoogle"
        style={style}
        data-ad-client="ca-pub-6353514227988642"
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
};
// ==========================================

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
  const playerIdRef = useRef("");
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
      console.log('📩 WS Message received:', data.type, data);

      switch (data.type) {
        case 'stats_update':
          console.log('📊 Stats update - Games:', data.activeGames, 'Players:', data.onlinePlayers);
          setActiveGames(data.activeGames);
          setOnlinePlayers(data.onlinePlayers);
          break;

        case 'queue_update':
          console.log('👥 Queue update - Size:', data.queueSize);
          setQueueSize(data.queueSize);
          break;

        case 'game_start':
          console.log('🎮 GAME START:', data);
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
          console.log('💬 New clue received');
          setAttempts(data.attempts);
          setWaitingForPartner(false);
          break;

        case 'clue_sent':
          console.log('✅ Clue sent confirmation');
          setAttempts(data.attempts);
          setWaitingForPartner(true);
          break;

        case 'new_guess':
          console.log('🎯 New guess - Correct:', data.correct);
          setAttempts(data.attempts);
          setWaitingForPartner(false);
          if (data.correct) {
            setTeamScore(prev => {
              const newScore = prev + 1;
              console.log('✅ Team score incremented:', newScore);
              return newScore;
            });
          }
          break;

        case 'new_round':
          console.log('🔄 New round:', data.round);
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
          console.log('🏁 GAME END - teamScore received:', data.teamScore);
          console.log('🔍 playerIdRef.current:', playerIdRef.current);
          setTeamScore(data.teamScore);
          updatePlayerStats(data.teamScore, playerIdRef.current);
          setGameState('results');
          break;

        case 'partner_disconnected':
          console.log('👋 Partner disconnected');
          alert('Votre complice s\'est déconnecté');
          reloadPlayerData(playerIdRef.current);
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
    const { data: topPlayers, error } = await supabase
      .from('players')
      .select('id, pseudo, score_giver, total_games, games_won')
      .order('score_giver', { ascending: false })
      .limit(10);

    if (error) {
      console.error('❌ Error loading leaderboard:', error);
    } else if (topPlayers) {
      console.log('📊 Leaderboard loaded:', topPlayers.length, 'players');
      setLeaderboard(topPlayers);
    }
  };

  const reloadPlayerData = async (pId: string) => {
    if (!pId) {
      console.warn('⚠️ No playerId to reload');
      return;
    }

    console.log('🔄 Reloading player data for:', pId);

    const { data: player, error } = await supabase
      .from('players')
      .select('*')
      .eq('id', pId)
      .single();

    if (error) {
      console.error('❌ Error reloading player:', error);
    } else if (player) {
      console.log('✅ Player data reloaded:', player);
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);
    }
  };

  const updatePlayerStats = async (finalScore: number, pId: string) => {
    console.log('═══════════════════════════════════════');
    console.log('📊 DÉBUT updatePlayerStats');
    console.log('playerId reçu:', pId);
    console.log('finalScore (teamScore):', finalScore);

    if (!pId) {
      console.error('❌ ERREUR : Pas de playerId !');
      alert('Erreur : Impossible de mettre à jour le score (pas de playerId)');
      return;
    }

    const wordsFound = finalScore;
    const wordsMissed = 4 - finalScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);
    const isPerfect = finalScore === 4;

    console.log('Calculs :');
    console.log('  - Mots trouvés:', wordsFound);
    console.log('  - Mots manqués:', wordsMissed);
    console.log('  - Points gagnés:', pointsGained);
    console.log('  - Partie parfaite ?', isPerfect);

    console.log('🔍 Récupération du joueur actuel...');
    const { data: currentPlayer, error: fetchError } = await supabase
      .from('players')
      .select('*')
      .eq('id', pId)
      .single();

    if (fetchError) {
      console.error('❌ ERREUR fetch player:', fetchError);
      alert('Erreur fetch : ' + fetchError.message);
      return;
    }

    if (!currentPlayer) {
      console.error('❌ ERREUR : Joueur non trouvé !');
      alert('Erreur : Joueur non trouvé dans la base de données');
      return;
    }

    console.log('✅ Joueur actuel récupéré:', currentPlayer);

    const newScore = currentPlayer.score_giver + pointsGained;
    const newTotalGames = currentPlayer.total_games + 1;
    const newGamesWon = currentPlayer.games_won + (isPerfect ? 1 : 0);

    console.log('💾 MISE À JOUR vers :');
    console.log('  - Ancien score:', currentPlayer.score_giver, '→ Nouveau:', newScore);
    console.log('  - Anciennes parties:', currentPlayer.total_games, '→ Nouvelles:', newTotalGames);
    console.log('  - Anciennes victoires:', currentPlayer.games_won, '→ Nouvelles:', newGamesWon);

    const { data: updatedData, error: updateError } = await supabase
      .from('players')
      .update({
        score_giver: newScore,
        total_games: newTotalGames,
        games_won: newGamesWon
      })
      .eq('id', pId)
      .select();

    if (updateError) {
      console.error('❌ ERREUR UPDATE:', updateError);
      alert('Erreur de mise à jour : ' + updateError.message + '\n\nVérifie les RLS (Row Level Security) dans Supabase !');
      return;
    }

    console.log('✅ UPDATE réussi dans Supabase !');
    console.log('Données mises à jour:', updatedData);

    setPlayerScore(newScore);
    setTotalGames(newTotalGames);
    setGamesWon(newGamesWon);

    console.log('✅ État local React mis à jour');
    console.log('═══════════════════════════════════════');

    await loadStats();
    console.log('✅ Classement rechargé');
  };

  const handleLogin = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pseudo.trim()) return;

    setLoading(true);
    console.log('🔐 Login attempt for pseudo:', pseudo.trim());

    try {
      const { data: existingPlayer, error: searchError } = await supabase
        .from('players')
        .select('*')
        .eq('pseudo', pseudo.trim())
        .single();

      if (searchError && searchError.code !== 'PGRST116') {
        console.error('❌ Search error:', searchError);
        throw searchError;
      }

      let player;

      if (existingPlayer) {
        console.log('✅ Joueur existant trouvé:', existingPlayer);
        player = existingPlayer;
        await supabase.from('players').update({ last_played: new Date().toISOString() }).eq('id', player.id);
      } else {
        console.log('➕ Création d\'un nouveau joueur');
        const { data: newPlayer, error } = await supabase
          .from('players')
          .insert([{ pseudo: pseudo.trim() }])
          .select()
          .single();

        if (error || !newPlayer) {
          console.error('❌ Erreur création joueur:', error);
          alert('Erreur lors de la création du joueur');
          setLoading(false);
          return;
        }

        player = newPlayer;
        console.log('✅ Nouveau joueur créé:', player);
      }

      setPlayerId(player.id);
      playerIdRef.current = player.id;
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);

      console.log('✅ État local initialisé:', {
        id: player.id,
        score: player.score_giver,
        games: player.total_games,
        won: player.games_won
      });
      console.log('✅ playerIdRef.current:', playerIdRef.current);

      ws.send(JSON.stringify({ type: 'player_online', playerId: player.id }));

      setGameState('home');
    } catch (err) {
      console.error('❌ Login error:', err);
      alert('Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !playerId) return;

    console.log('🎮 Joining queue - playerId:', playerId, 'pseudo:', pseudo);

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

    console.log('💬 Sending clue:', currentClue.trim());

    ws.send(JSON.stringify({
      type: 'send_clue',
      gameId,
      clue: currentClue.trim()
    }));
    setCurrentClue('');
  };

  const sendGuess = () => {
    if (!ws || !currentGuess.trim()) return;

    console.log('🎯 Sending guess:', currentGuess.trim());

    ws.send(JSON.stringify({
      type: 'send_guess',
      gameId,
      guess: currentGuess.trim()
    }));
    setCurrentGuess('');
  };

  // ========== PAGE WELCOME ==========
  if (gameState === 'welcome') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm">
          <AdBanner
            slot="4176823157"
            format="auto"
            style={{ display: 'block', minHeight: '90px' }}
            className="bg-gradient-to-r from-cyan-100 to-blue-100 border-b border-cyan-200 py-2"
          />

          <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
            <div className="text-center py-12 space-y-6">
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-pink-500 rounded-3xl blur-2xl opacity-40 animate-pulse"></div>
                  <div className="relative p-6 bg-gradient-to-br from-cyan-500 via-blue-500 to-pink-500 rounded-3xl shadow-2xl">
                    <Swords className="w-16 h-16 text-white" strokeWidth={2.5} />
                  </div>
                </div>
              </div>

              <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 via-blue-600 to-pink-600">
                DicoClash
              </h1>
              <p className="text-xl md:text-2xl text-gray-800 font-bold">
                Jeu de mots coopératif multijoueur
              </p>

              <div className="flex justify-center gap-8 md:gap-16 py-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-3xl md:text-4xl font-black text-green-600">
                    <Users className="w-8 h-8" strokeWidth={3} />
                    {onlinePlayers}
                  </div>
                  <p className="text-sm text-gray-700 font-bold mt-1">en ligne</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-3xl md:text-4xl font-black text-blue-600">
                    <Zap className="w-8 h-8" strokeWidth={3} />
                    {activeGames}
                  </div>
                  <p className="text-sm text-gray-700 font-bold mt-1">parties</p>
                </div>
              </div>

              <Card className="max-w-md mx-auto border-2 border-cyan-300 shadow-2xl bg-white">
                <CardContent className="p-8 space-y-4">
                  <input
                    type="text"
                    value={pseudo}
                    onChange={(e) => setPseudo(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="Votre pseudo..."
                    className="w-full px-5 py-4 text-lg font-bold border-2 border-cyan-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
                    maxLength={20}
                    disabled={loading}
                  />
                  <Button
                    onClick={handleLogin}
                    disabled={!pseudo.trim() || !ws || ws.readyState !== WebSocket.OPEN || loading}
                    className="group relative w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-pink-500 hover:from-cyan-600 hover:via-blue-600 hover:to-pink-600 text-white text-xl font-black py-6 rounded-xl shadow-xl transition-all transform hover:scale-105"
                  >
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
                    <p className="text-sm text-orange-600 text-center font-bold">Connexion au serveur...</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-2 border-blue-300 bg-white shadow-xl">
              <CardHeader className="bg-gradient-to-r from-blue-100 to-cyan-100 border-b">
                <CardTitle className="text-2xl font-black flex items-center gap-2 text-gray-900">
                  <Target className="w-6 h-6 text-cyan-600" />
                  Comment jouer ?
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-full flex items-center justify-center font-black shadow-md">1</div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">Trouvez un complice</h3>
                        <p className="text-sm text-gray-600">Matchmaking automatique et rapide</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-indigo-500 to-pink-500 text-white rounded-full flex items-center justify-center font-black shadow-md">2</div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">Donnez des indices</h3>
                        <p className="text-sm text-gray-600">Alternez les rôles à chaque manche</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-500 text-white rounded-full flex items-center justify-center font-black shadow-md">3</div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">Trouvez ensemble</h3>
                        <p className="text-sm text-gray-600">4 mots, 4 tentatives, 60 secondes</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-yellow-500 to-orange-500 text-white rounded-full flex items-center justify-center font-black shadow-md">4</div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">Marquez des points</h3>
                        <p className="text-sm text-gray-600">+25 pts par mot, -10 si raté</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-cyan-100 rounded-xl border-2 border-cyan-300">
                  <p className="text-sm text-gray-900 font-bold">
                    <Shield className="inline w-5 h-5 mr-2 text-cyan-600" />
                    <strong>Règle :</strong> Vos indices ne doivent pas être trop similaires au mot à deviner !
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-yellow-300 bg-white shadow-xl">
              <CardHeader className="bg-gradient-to-r from-yellow-100 to-orange-100 border-b">
                <CardTitle className="text-2xl font-black flex items-center gap-2 text-gray-900">
                  <Trophy className="w-6 h-6 text-yellow-600" />
                  Classement
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-600">Chargement...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((player, index) => (
                      <div key={player.id} className={`flex justify-between items-center p-4 rounded-xl border-2 transition-all ${
                        index === 0 ? 'bg-yellow-100 border-yellow-300' :
                        index === 1 ? 'bg-gray-100 border-gray-300' :
                        index === 2 ? 'bg-orange-100 border-orange-300' :
                        'bg-white border-gray-200'
                      }`}>
                        <div className="flex items-center gap-4">
                          {index === 0 && <Crown className="w-6 h-6 text-yellow-600" />}
                          {index === 1 && <Star className="w-6 h-6 text-gray-500" />}
                          {index === 2 && <Star className="w-6 h-6 text-orange-600" />}
                          <span className="font-black text-gray-600 text-lg w-8">#{index + 1}</span>
                          <span className="font-bold text-lg text-gray-900">{player.pseudo}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-cyan-600">{player.score_giver}</div>
                          <div className="text-xs text-gray-600 font-medium">{player.total_games} parties • {player.games_won} parfaites</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <AdBanner
                slot="2847445522"
                format="auto"
                style={{ display: 'block', minHeight: '250px' }}
                className="bg-gradient-to-br from-blue-100 to-cyan-100 border-2 border-blue-200 rounded-xl p-4 shadow"
              />
              <AdBanner
                slot="6580652886"
                format="auto"
                style={{ display: 'block', minHeight: '250px' }}
                className="bg-gradient-to-br from-pink-100 to-purple-100 border-2 border-pink-200 rounded-xl p-4 shadow"
              />
            </div>
          </div>

          <AdBanner
            slot="4176823157"
            format="auto"
            style={{ display: 'block', minHeight: '90px' }}
            className="bg-gradient-to-r from-cyan-100 to-blue-100 border-t border-cyan-200 py-2 mt-12"
          />
        </div>
      </div>
    );
  }

  // ========== PAGE HOME ==========
  if (gameState === 'home') {
    const myRank = leaderboard.findIndex(p => p.id === playerId) + 1;

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm">
          <AdBanner
            slot="4176823157"
            format="auto"
            style={{ display: 'block', minHeight: '90px' }}
            className="bg-gradient-to-r from-cyan-100 to-blue-100 border-b border-cyan-200 py-2"
          />

          <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-black text-gray-900 mb-3">
                {pseudo}
              </h1>
              <div className="flex justify-center gap-4 flex-wrap">
                <Badge className="text-lg px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-0 shadow-lg">
                  <Crown className="w-5 h-5 mr-2" />
                  {playerScore} points
                </Badge>
                {myRank > 0 && (
                  <Badge className="text-lg px-6 py-2 border-2 bg-white text-gray-900 border-pink-400 shadow-lg">
                    #{myRank} au classement
                  </Badge>
                )}
              </div>
            </div>

            <Card className="border-2 border-cyan-300 shadow-2xl bg-white">
              <CardContent className="p-8 text-center space-y-6">
                <h2 className="text-3xl font-black text-gray-900">Prêt pour l'aventure ?</h2>
                <Button
                  onClick={joinQueue}
                  className="group relative text-2xl px-20 py-10 h-auto bg-gradient-to-r from-cyan-500 via-blue-500 to-pink-500 hover:from-cyan-600 hover:via-blue-600 hover:to-pink-600 rounded-2xl shadow-2xl font-black transform hover:scale-105 transition-all duration-300"
                >
                  <div className="relative flex items-center justify-center gap-4">
                    <div className="w-12 h-12 bg-white/30 rounded-full flex items-center justify-center">
                      <Play className="w-8 h-8 text-white" fill="white" strokeWidth={0} />
                    </div>
                    <span className="text-white">JOUER</span>
                  </div>
                </Button>
                <div className="flex justify-center gap-12 mt-6">
                  <div className="text-center">
                    <div className="text-green-600 text-3xl font-black">{onlinePlayers}</div>
                    <p className="text-xs text-gray-700 font-bold">En ligne</p>
                  </div>
                  <div className="text-center">
                    <div className="text-blue-600 text-3xl font-black">{activeGames}</div>
                    <p className="text-xs text-gray-700 font-bold">Parties</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-yellow-100 to-orange-100 border-2 border-yellow-300 shadow">
                <CardContent className="p-6 text-center">
                  <Trophy className="w-12 h-12 mx-auto mb-3 text-yellow-600" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-gray-900">{totalGames}</p>
                  <p className="text-sm text-gray-700 font-bold mt-1">Parties</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-100 to-emerald-100 border-2 border-green-300 shadow">
                <CardContent className="p-6 text-center">
                  <Star className="w-12 h-12 mx-auto mb-3 text-green-600" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-gray-900">{gamesWon}</p>
                  <p className="text-sm text-gray-700 font-bold mt-1">Parfaites</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-cyan-100 to-blue-100 border-2 border-cyan-300 shadow">
                <CardContent className="p-6 text-center">
                  <Zap className="w-12 h-12 mx-auto mb-3 text-cyan-600" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-gray-900">{playerScore}</p>
                  <p className="text-sm text-gray-700 font-bold mt-1">Score</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-2 border-blue-300 bg-white shadow">
                <CardHeader className="bg-gradient-to-r from-blue-100 to-cyan-100 border-b pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
                    <Target className="w-5 h-5 text-cyan-600" />
                    Règles du jeu
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2 text-sm">
                  <p className="font-bold text-gray-900">🎯 4 mots à deviner en équipe</p>
                  <p className="font-bold text-gray-900">🔄 4 tentatives par mot maximum</p>
                  <p className="font-bold text-gray-900">⏱️ 60 secondes chrono</p>
                  <p className="font-bold text-green-600">✅ +25 pts si trouvé</p>
                  <p className="font-bold text-red-600">❌ -10 pts si raté</p>
                </CardContent>
              </Card>

              <Card className="border-2 border-yellow-300 bg-white shadow">
                <CardHeader className="bg-gradient-to-r from-yellow-100 to-orange-100 border-b pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
                    <Trophy className="w-5 h-5 text-yellow-600" />
                    Top 5
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {leaderboard.length === 0 ? (
                    <p className="text-center text-gray-600 py-4 text-sm">Chargement...</p>
                  ) : (
                    <div className="space-y-2">
                      {leaderboard.slice(0, 5).map((player, index) => (
                        <div key={player.id} className={`flex justify-between items-center p-2 rounded-lg ${player.id === playerId ? 'bg-cyan-200 border-2 border-cyan-400' : 'bg-gray-100 border border-gray-200'}`}>
                          <div className="flex items-center gap-2">
                            {index === 0 && <Crown className="w-4 h-4 text-yellow-600" />}
                            <span className="font-black text-gray-600 text-sm">#{index + 1}</span>
                            <span className="font-bold text-sm text-gray-900">{player.pseudo}</span>
                          </div>
                          <div className="text-cyan-600 font-black text-lg">{player.score_giver}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <AdBanner
                slot="2847445522"
                format="auto"
                style={{ display: 'block', minHeight: '250px' }}
                className="bg-gradient-to-br from-blue-100 to-cyan-100 border-2 border-blue-200 rounded-xl p-4 shadow"
              />
              <AdBanner
                slot="6580652886"
                format="auto"
                style={{ display: 'block', minHeight: '250px' }}
                className="bg-gradient-to-br from-pink-100 to-purple-100 border-2 border-pink-200 rounded-xl p-4 shadow"
              />
            </div>

            <div className="text-center">
              <Button variant="outline" className="border-2 border-gray-300 bg-white text-gray-900 hover:bg-gray-100" onClick={() => {
                if (ws) ws.send(JSON.stringify({ type: 'player_offline', playerId }));
                setGameState('welcome');
                setPseudo('');
              }}>
                <X className="w-4 h-4 mr-2" />
                Déconnexion
              </Button>
            </div>
          </div>

          <AdBanner
            slot="4176823157"
            format="auto"
            style={{ display: 'block', minHeight: '90px' }}
            className="bg-gradient-to-r from-cyan-100 to-blue-100 border-t border-cyan-200 py-2 mt-12"
          />
        </div>
      </div>
    );
  }

  // ========== PAGE QUEUE ==========
  if (gameState === 'queue') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-2 border-cyan-300 shadow-2xl bg-white">
            <CardContent className="p-10 text-center space-y-6">
              <div className="w-24 h-24 bg-gradient-to-br from-cyan-100 to-blue-100 rounded-full flex items-center justify-center mx-auto shadow-lg border-4 border-cyan-300">
                <Users className="w-12 h-12 text-cyan-600 animate-pulse" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-3xl font-black text-gray-900 mb-2">Recherche...</h2>
                <p className="text-gray-700 font-medium text-lg mt-3">
                  <span className="text-3xl font-black text-cyan-600">{queueSize}</span> joueur{queueSize > 1 ? 's' : ''} en attente
                </p>
                <p className="text-sm text-gray-600 font-medium mt-2">
                  {activeGames} parties en cours
                </p>
              </div>
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-cyan-600" strokeWidth={3} />
              <Button variant="outline" className="border-2 border-gray-300 bg-white text-gray-900 w-full py-6 hover:bg-gray-100" onClick={() => {
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

  // ========== PAGE PLAYING ==========
  if (gameState === 'playing') {
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm p-2 md:p-4">
          <div className="max-w-5xl mx-auto space-y-3">
            <div className={`${isGiver ? 'bg-gradient-to-r from-cyan-500 to-blue-600' : 'bg-gradient-to-r from-indigo-500 to-purple-600'} text-white p-4 md:p-5 rounded-xl shadow-lg`}>
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
              <Card className="border-2 border-cyan-300 bg-white shadow-lg">
                <CardHeader className="pb-3 border-b bg-gradient-to-r from-cyan-100 to-blue-100">
                  <CardTitle className="text-center text-xl font-black text-gray-900">MOT À FAIRE DEVINER</CardTitle>
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
              <Card className="border-2 border-blue-300 bg-white shadow-lg">
                <CardHeader className="pb-3 bg-gradient-to-r from-blue-100 to-cyan-100 border-b">
                  <CardTitle className="text-base font-black flex items-center gap-2 text-gray-900">
                    {!isGiver && <span className="text-cyan-600">→</span>}
                    INDICES
                    {!isGiver && <span className="text-cyan-600">←</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {attempts.map((att, i) => (
                    <div key={i} className={`p-3 rounded-lg ${i % 2 === 0 ? 'bg-blue-100 border border-blue-300' : 'bg-white border border-gray-200'} shadow-sm`}>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-cyan-500 text-white font-bold">#{i + 1}</Badge>
                        <p className="font-bold text-lg text-gray-900">{att.clue}</p>
                      </div>
                    </div>
                  ))}
                  {attempts.length === 0 && <p className="text-center text-gray-500 py-8 text-sm font-medium">Aucun indice</p>}
                </CardContent>
              </Card>

              <Card className="border-2 border-indigo-300 bg-white shadow-lg">
                <CardHeader className="pb-3 bg-gradient-to-r from-indigo-100 to-purple-100 border-b">
                  <CardTitle className="text-base font-black flex items-center gap-2 text-gray-900">
                    {isGiver && <span className="text-indigo-600">→</span>}
                    RÉPONSES
                    {isGiver && <span className="text-indigo-600">←</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {attempts.map((att, i) => (
                    <div key={i} className={`p-3 rounded-lg ${att.correct ? 'bg-green-100 border-2 border-green-400' : att.guess ? 'bg-red-100 border border-red-300' : 'bg-gray-100 border border-gray-200'} shadow-sm`}>
                      <div className="flex items-center gap-2">
                        {att.guess && (
                          <Badge className={`${att.correct ? 'bg-green-600' : 'bg-red-600'} text-white font-bold`}>
                            {att.correct ? '✓' : '✗'}
                          </Badge>
                        )}
                        <p className="font-bold text-lg text-gray-900">{att.guess || '...'}</p>
                      </div>
                    </div>
                  ))}
                  {attempts.length === 0 && <p className="text-center text-gray-500 py-8 text-sm font-medium">Aucune réponse</p>}
                </CardContent>
              </Card>
            </div>

            {clueError && (
              <div className="p-4 bg-red-100 border-2 border-red-400 rounded-xl flex items-center gap-3 shadow-lg">
                <AlertCircle className="w-6 h-6 text-red-600" strokeWidth={3} />
                <p className="text-sm font-bold text-red-900">{clueError}</p>
              </div>
            )}

            {isGiver && attemptsLeft > 0 && !waitingForPartner && (
              (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
                <Card className="border-2 border-cyan-300 bg-white shadow-lg">
                  <CardContent className="p-4">
                    <form onSubmit={(e) => { e.preventDefault(); sendClue(); }} className="flex gap-3">
                      <input
                        type="text"
                        value={currentClue}
                        onChange={(e) => setCurrentClue(e.target.value)}
                        placeholder="Donnez votre indice..."
                        className="flex-1 px-5 py-4 text-lg font-medium border-2 border-cyan-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
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
              <Card className="border-2 border-indigo-300 bg-white shadow-lg">
                <CardHeader className="pb-3 bg-gradient-to-r from-indigo-100 to-purple-100 border-b">
                  <CardTitle className="text-xl font-black text-gray-900">VOTRE RÉPONSE</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <form onSubmit={(e) => { e.preventDefault(); sendGuess(); }}>
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      placeholder="VOTRE RÉPONSE..."
                      className="w-full px-5 py-5 border-2 border-indigo-300 bg-white text-gray-900 rounded-xl text-center font-black text-3xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      maxLength={30}
                      autoFocus
                      required
                    />
                    <Button type="submit" disabled={!currentGuess.trim()} className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 py-5 mt-4 font-black text-xl">
                      <Send className="mr-2 w-6 h-6" />
                      VALIDER
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {waitingForPartner && (
              <div className="text-center py-8 bg-white rounded-xl border-2 border-gray-200 shadow">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-cyan-600" strokeWidth={3} />
                <p className="text-gray-900 font-bold text-lg">En attente de {partnerPseudo}...</p>
              </div>
            )}

            <AdBanner
              slot="4176823157"
              format="auto"
              style={{ display: 'block', minHeight: '90px' }}
              className="bg-gradient-to-r from-blue-100 to-cyan-100 border-2 border-blue-200 rounded-xl p-2 shadow"
            />
          </div>
        </div>
      </div>
    );
  }

  // ========== PAGE RESULTS ==========
  if (gameState === 'results') {
    const isPerfect = teamScore === 4;
    const wordsFound = teamScore;
    const wordsMissed = 4 - teamScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl border-2 border-cyan-300 shadow-2xl bg-white">
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
                <h2 className="text-5xl font-black text-gray-900 mb-2">
                  {isPerfect ? "PARFAIT !" : teamScore >= 2 ? "BIEN JOUÉ !" : "PERDU..."}
                </h2>
                <p className="text-gray-700 text-lg font-medium">avec {partnerPseudo}</p>
              </div>

              <div className="text-center py-8 bg-gradient-to-r from-cyan-100 to-blue-100 rounded-2xl border-2 border-cyan-300">
                <div className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-pink-600">
                  {teamScore}/4
                </div>
                <p className="text-gray-900 font-bold text-xl mt-2">Mots trouvés</p>
              </div>

              <div className="bg-gray-100 rounded-2xl p-6 border-2 border-gray-200">
                <h3 className="font-black text-xl mb-4 text-gray-900">RÉCAPITULATIF</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-medium text-gray-700">Mots trouvés :</span>
                    <span className="font-black text-green-600 text-2xl">+{wordsFound * 25}</span>
                  </div>
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-medium text-gray-700">Mots manqués :</span>
                    <span className="font-black text-red-600 text-2xl">-{wordsMissed * 10}</span>
                  </div>
                  <div className="border-t-2 border-gray-300 pt-3 mt-3">
                    <div className="flex justify-between items-center text-xl">
                      <span className="font-bold text-gray-900">Total :</span>
                      <span className={`font-black text-3xl ${pointsGained >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {pointsGained >= 0 ? '+' : ''}{pointsGained}
                      </span>
                    </div>
                  </div>
                  <div className="border-t-2 border-gray-300 pt-3 mt-3 bg-cyan-100 -mx-6 px-6 py-4 rounded-xl">
                    <div className="flex justify-between items-center text-2xl">
                      <span className="font-black text-gray-900">Nouveau score :</span>
                      <span className="font-black text-cyan-600">{playerScore}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={() => {
                console.log('🔄 Retour à l\'accueil - Rechargement des données...');
                console.log('playerIdRef.current:', playerIdRef.current);
                reloadPlayerData(playerIdRef.current);
                setGameState('home');
              }} className="w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-pink-500 hover:from-cyan-600 hover:via-blue-600 hover:to-pink-600 text-2xl font-black py-8 rounded-xl shadow-lg transform hover:scale-105 transition-all">
                <Play className="mr-3 w-8 h-8" strokeWidth={3} fill="white" />
                RETOUR
              </Button>

              <AdBanner
                slot="2847445522"
                format="auto"
                style={{ display: 'block', minHeight: '200px' }}
                className="bg-gradient-to-r from-blue-100 to-pink-100 border-2 border-blue-200 rounded-xl p-4"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default DicoClash;