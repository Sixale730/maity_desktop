'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ConversationsList, ConversationDetail, OmiConversation } from '@/features/conversations';
import { useUserRole } from '@/hooks/useUserRole';

export default function ConversationsPage() {
  const { isRegularUser } = useUserRole();
  const router = useRouter();
  const [selectedConversation, setSelectedConversation] = useState<OmiConversation | null>(null);

  useEffect(() => {
    if (isRegularUser) {
      router.replace('/');
    }
  }, [isRegularUser, router]);

  if (isRegularUser) return null;

  if (selectedConversation) {
    return (
      <div className="h-full bg-background">
        <ConversationDetail
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full bg-muted">
      <ConversationsList
        onSelect={setSelectedConversation}
        selectedId={null}
      />
    </div>
  );
}
