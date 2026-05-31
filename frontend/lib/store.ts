"use client";

import { create } from "zustand";
import type { Conversation } from "./types";

interface AppState {
  conversations: Conversation[];
  setConversations: (c: Conversation[]) => void;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  conversations: [],
  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (conv) =>
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conv.id);
      if (idx === -1) return { conversations: [conv, ...state.conversations] };
      const next = state.conversations.slice();
      next[idx] = conv;
      // bubble updated to top
      next.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { conversations: next };
    }),
  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    })),
}));
