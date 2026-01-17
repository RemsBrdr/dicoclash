import { supabase } from './supabase';

// Normaliser les pseudos (minuscules, pas d'accents)
const normalizePseudo = (pseudo: string): string => {
  return pseudo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
};

// Hash simple avec SHA-256 (crypto natif)
export const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

// Créer un compte
export const createAccount = async (pseudo: string, password: string) => {
  if (password.length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères');
  }

  const normalizedPseudo = normalizePseudo(pseudo);

  // Vérifier si le pseudo normalisé existe déjà
  const { data: existing } = await supabase
    .from('accounts')
    .select('pseudo')
    .ilike('pseudo', normalizedPseudo);

  if (existing && existing.length > 0) {
    throw new Error('Ce pseudo est déjà pris (insensible à la casse)');
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('accounts')
    .insert([{ pseudo: pseudo.trim(), password_hash: passwordHash }])
    .select()
    .single();

  if (error) {
    throw new Error('Erreur lors de la création du compte');
  }

  return data;
};

// Se connecter (insensible à la casse)
export const login = async (pseudo: string, password: string) => {
  const passwordHash = await hashPassword(password);
  const normalizedPseudo = normalizePseudo(pseudo);

  // Chercher avec ILIKE (insensible à la casse)
  const { data: accounts } = await supabase
    .from('accounts')
    .select('*')
    .ilike('pseudo', normalizedPseudo);

  if (!accounts || accounts.length === 0) {
    throw new Error('Pseudo ou mot de passe incorrect');
  }

  // Vérifier le mot de passe
  const account = accounts.find(a => a.password_hash === passwordHash);

  if (!account) {
    throw new Error('Pseudo ou mot de passe incorrect');
  }

  return account;
};

// Vérifier si un pseudo est disponible pour un invité
export const isPseudoAvailableForGuest = async (pseudo: string): Promise<boolean> => {
  const normalizedPseudo = normalizePseudo(pseudo);

  const { data } = await supabase
    .from('accounts')
    .select('pseudo')
    .ilike('pseudo', normalizedPseudo);

  return !data || data.length === 0;
};

// Créer ou récupérer un joueur
// Créer ou récupérer un joueur
export const getOrCreatePlayer = async (pseudo: string, accountId?: string) => {
  const isGuest = !accountId;

  // Si invité, vérifier que le pseudo n'est pas pris (insensible casse)
  if (isGuest) {
    const available = await isPseudoAvailableForGuest(pseudo);
    if (!available) {
      throw new Error('Ce pseudo est réservé (même avec majuscules différentes). Créez un compte ou choisissez un autre pseudo.');
    }
  }

  // Si compte : chercher par account_id
  if (accountId) {
    const { data: existingPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (existingPlayer) {
      // Mettre à jour le pseudo si changé
      if (existingPlayer.pseudo !== pseudo.trim()) {
        await supabase
          .from('players')
          .update({ pseudo: pseudo.trim() })
          .eq('id', existingPlayer.id);

        return { ...existingPlayer, pseudo: pseudo.trim() };
      }
      return existingPlayer;
    }
  }

  // Si invité : chercher par pseudo
  if (isGuest) {
    const { data: existingPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('pseudo', pseudo.trim())
      .eq('is_guest', true)
      .single();

    if (existingPlayer) {
      return existingPlayer;
    }
  }

  // Créer nouveau joueur
  const { data: newPlayer, error } = await supabase
    .from('players')
    .insert([{
      pseudo: pseudo.trim(),
      account_id: accountId || null,
      is_guest: isGuest
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating player:', error);
    throw new Error('Erreur lors de la création du joueur');
  }

  return newPlayer;
};