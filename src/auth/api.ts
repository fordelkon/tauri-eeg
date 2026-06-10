import { invoke } from '@tauri-apps/api/core';
import type { UserProfile } from './types';

export async function loginUser(username: string, password: string): Promise<UserProfile> {
  return invoke<UserProfile>('login_user', { username, password });
}

export async function registerUser(username: string, password: string): Promise<UserProfile> {
  return invoke<UserProfile>('register_user', { username, password });
}

export async function resetUserPassword(
  username: string,
  resetCode: string,
  newPassword: string,
): Promise<UserProfile> {
  return invoke<UserProfile>('reset_user_password', { username, resetCode, newPassword });
}
