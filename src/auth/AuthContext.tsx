import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';
import { loginUser, registerUser, resetUserPassword } from './api';
import type { UserProfile } from './types';

type AuthContextValue = {
  currentUser: UserProfile | null;
  resetPassword: (username: string, resetCode: string, newPassword: string) => Promise<UserProfile>;
  signIn: (username: string, password: string) => Promise<UserProfile>;
  signOut: () => void;
  signUp: (username: string, password: string) => Promise<UserProfile>;
};

const STORAGE_KEY = 'tauri-eeg.currentUser';

const AuthContext = createContext<AuthContextValue | null>(null);

const loadStoredUser = (): UserProfile | null => {
  const value = window.localStorage.getItem(STORAGE_KEY);

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as UserProfile;

    if (typeof parsed.id === 'string' && typeof parsed.username === 'string') {
      return parsed;
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return null;
};

const storeUser = (user: UserProfile) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => loadStoredUser());

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    resetPassword: (username, resetCode, newPassword) => (
      resetUserPassword(username, resetCode, newPassword)
    ),
    signIn: async (username, password) => {
      const user = await loginUser(username, password);

      setCurrentUser(user);
      storeUser(user);

      return user;
    },
    signOut: () => {
      setCurrentUser(null);
      window.localStorage.removeItem(STORAGE_KEY);
    },
    signUp: async (username, password) => {
      const user = await registerUser(username, password);

      setCurrentUser(user);
      storeUser(user);

      return user;
    },
  }), [currentUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return value;
}
