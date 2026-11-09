'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type SessionUser = { id: string; name: string; handle: string; avatar: string; online: boolean; color: string };
type SessionState = {
  accessToken: string;
  refreshToken: string;
  user: SessionUser | null;
  saveSession: (accessToken: string, refreshToken: string, user: SessionUser) => void;
  clearSession: () => void;
};
export const useSessionStore = create<SessionState>()(persist((set) => ({
  accessToken: '', refreshToken: '', user: null,
  saveSession: (accessToken, refreshToken, user) => set({ accessToken, refreshToken, user }),
  clearSession: () => set({ accessToken: '', refreshToken: '', user: null }),
}), { name: 'nexus-session-state', storage: createJSONStorage(() => localStorage), partialize: state => ({ accessToken: state.accessToken, refreshToken: state.refreshToken, user: state.user }) as SessionState }));
