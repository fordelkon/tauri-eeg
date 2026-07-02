import { invoke } from '@tauri-apps/api/core';

export type NeuroMusicHealth = {
  activeSession: boolean;
  demonControlAvailable: boolean;
  error?: string | null;
  modelLoaded: boolean;
  modelVersion: string;
  status: string;
};

export type EegEmotionLabel = {
  arousal: number;
  confidence: number;
  emotion: string;
  modelVersion: string;
  note?: string | null;
  probabilities: Record<string, number>;
  source: string;
  updatedAt: number;
  valence: number;
};

export type PredictEegEmotionInput = {
  channelIds: string[];
  sampleRateHz: number;
  samples: number[][];
  source?: string;
  startedAtMs?: number | null;
  triggerClass?: number | null;
};

export type NeuroMusicSessionStatus = {
  active: boolean;
  demonSessionId?: string | null;
  error?: string | null;
  lastControl?: Record<string, unknown> | null;
  lastEmotion?: string | null;
  mode: 'mock' | 'demon' | string;
  prompt: string;
  sessionId?: string | null;
  startedAt?: number | null;
};

export type StartNeuroMusicInput = {
  mode: 'mock' | 'demon';
  prompt: string;
  userId: string;
  username: string;
};

export type NeuroEmotionControlInput = {
  arousal: number;
  emotion: string;
  playbackPos?: number;
  probabilities: Record<string, number>;
  valence: number;
};

export function getNeuroMusicHealth() {
  return invoke<NeuroMusicHealth>('get_neuro_music_health');
}

export function predictEegEmotion(input: PredictEegEmotionInput) {
  return invoke<EegEmotionLabel>('predict_eeg_emotion', { input });
}

export function getLatestEegEmotion() {
  return invoke<EegEmotionLabel>('get_latest_eeg_emotion');
}

export function startNeuroMusicSession(input: StartNeuroMusicInput) {
  return invoke<NeuroMusicSessionStatus>('start_neuro_music_session', { input });
}

export function stopNeuroMusicSession() {
  return invoke<NeuroMusicSessionStatus>('stop_neuro_music_session');
}

export function getNeuroMusicSessionStatus() {
  return invoke<NeuroMusicSessionStatus>('get_neuro_music_session_status');
}

export function sendNeuroMusicEmotionControl(input: NeuroEmotionControlInput) {
  return invoke<NeuroMusicSessionStatus>('send_neuro_music_emotion_control', { input });
}

