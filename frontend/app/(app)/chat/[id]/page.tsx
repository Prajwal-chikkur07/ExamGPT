"use client";

import { useParams } from "next/navigation";
import { ChatPanel } from "@/components/chat-panel";

export default function ChatRoute() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;
  return <ChatPanel conversationId={id} />;
}
