import { supabase } from './supabase';

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

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('accounts')
    .insert([{ pseudo, password_hash: passwordHash }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Ce pseudo est déjà pris');
    }
    throw error;
  }

  return data;
};

// Se connecter
export const login = async (pseudo: string, password: string) => {
  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('pseudo', pseudo)
    .eq('password_hash', passwordHash)
    .single();

  if (error || !data) {
    throw new Error('Pseudo ou mot de passe incorrect');
  }

  return data;
};

// Vérifier si un pseudo est disponible pour un invité
export const isPseudoAvailableForGuest = async (pseudo: string): Promise<boolean> => {
  const { data } = await supabase
    .from('accounts')
    .select('pseudo')
    .eq('pseudo', pseudo)
    .single();

  return !data; // Disponible si pas de compte avec ce pseudo
};

// Créer ou récupérer un joueur
export const getOrCreatePlayer = async (pseudo: string, accountId?: string) => {
  const isGuest = !accountId;

  // Si invité, vérifier que le pseudo n'est pas pris
  if (isGuest) {
    const available = await isPseudoAvailableForGuest(pseudo);
    if (!available) {
      throw new Error('Ce pseudo est réservé. Créez un compte ou choisissez un autre pseudo.');
    }
  }

  // Chercher joueur existant
  let query = supabase.from('players').select('*').eq('pseudo', pseudo);

  if (accountId) {
    query = query.eq('account_id', accountId);
  }

  const { data: existingPlayer } = await query.single();

  if (existingPlayer) {
    return existingPlayer;
  }

  // Créer nouveau joueur
  const { data: newPlayer, error } = await supabase
    .from('players')
    .insert([{
      pseudo,
      account_id: accountId || null,
      is_guest: isGuest
    }])
    .select()
    .single();

  if (error) throw error;

  return newPlayer;
};