"use client";

/**
 * Module-level registry of in-flight chat streams. Lives outside React so that
 * navigating away from a chat does NOT abort the request — when the user comes
 * back, they re-subscribe and see the live token feed.
 *
 * One conversation can have at most one active stream at a time.
 */

import { chatApi } from "./api";
import type { ImageAttachment, SourceCitation } from "./types";

export interface StreamState {
  conversationId: string;
  /** Final user message that produced this stream (already persisted server-side). */
  question: string;
  /** Accumulated assistant content from token events. */
  content: string;
  sources: SourceCitation[];
  isStreaming: boolean;
  error: string | null;
  /** True if this was a regenerate (the user message did NOT just get added). */
  regenerate: boolean;
}

type Listener = (state: StreamState) => void;

class StreamRegistry {
  private streams = new Map<string, StreamState>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Map<string, Set<Listener>>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  getState(conversationId: string): StreamState | null {
    return this.streams.get(conversationId) ?? null;
  }

  isStreaming(conversationId: string): boolean {
    return this.streams.get(conversationId)?.isStreaming ?? false;
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    let set = this.listeners.get(conversationId);
    if (!set) {
      set = new Set();
      this.listeners.set(conversationId, set);
    }
    set.add(listener);
    const current = this.streams.get(conversationId);
    if (current) listener(current);
    return () => {
      const inner = this.listeners.get(conversationId);
      if (!inner) return;
      inner.delete(listener);
      if (inner.size === 0) this.listeners.delete(conversationId);
    };
  }

  private notify(conversationId: string) {
    const state = this.streams.get(conversationId);
    if (!state) return;
    this.listeners.get(conversationId)?.forEach((l) => l(state));
  }

  abort(conversationId: string) {
    const controller = this.controllers.get(conversationId);
    if (controller) {
      controller.abort();
      this.controllers.delete(conversationId);
    }
  }

  async start(opts: {
    conversationId: string;
    question: string;
    style: string;
    regenerate?: boolean;
    inlineContext?: string;
    attachmentNames?: string[];
    images?: ImageAttachment[];
    onComplete?: () => void;
  }) {
    const {
      conversationId,
      question,
      style,
      regenerate = false,
      inlineContext,
      attachmentNames,
      images,
    } = opts;
    // Replace any existing stream for this conversation.
    this.abort(conversationId);
    const existingTimer = this.cleanupTimers.get(conversationId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.cleanupTimers.delete(conversationId);
    }

    const state: StreamState = {
      conversationId,
      question,
      content: "",
      sources: [],
      isStreaming: true,
      error: null,
      regenerate,
    };
    this.streams.set(conversationId, state);
    const controller = new AbortController();
    this.controllers.set(conversationId, controller);
    this.notify(conversationId);

    try {
      await chatApi.stream(conversationId, question, style, {
        signal: controller.signal,
        regenerate,
        inlineContext,
        attachmentNames,
        images,
        onSources: (sources) => {
          const s = this.streams.get(conversationId);
          if (!s) return;
          s.sources = sources;
          this.notify(conversationId);
        },
        onToken: (text) => {
          const s = this.streams.get(conversationId);
          if (!s) return;
          s.content += text;
          this.notify(conversationId);
        },
        onError: (msg) => {
          const s = this.streams.get(conversationId);
          if (!s) return;
          s.error = msg;
          this.notify(conversationId);
        },
      });
    } catch (err) {
      const s = this.streams.get(conversationId);
      const isAbort = (err as Error)?.name === "AbortError";
      if (s && !isAbort) {
        s.error = String(err);
        this.notify(conversationId);
      }
    } finally {
      const s = this.streams.get(conversationId);
      if (s) {
        s.isStreaming = false;
        this.notify(conversationId);
      }
      this.controllers.delete(conversationId);
      opts.onComplete?.();
      // Keep the final state around briefly so a late subscriber can read it,
      // then drop it (the assistant message is already persisted server-side).
      const t = setTimeout(() => {
        const cur = this.streams.get(conversationId);
        if (cur && !cur.isStreaming) this.streams.delete(conversationId);
        this.cleanupTimers.delete(conversationId);
      }, 8000);
      this.cleanupTimers.set(conversationId, t);
    }
  }
}

export const chatStreams = new StreamRegistry();
