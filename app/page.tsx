'use client';

import { useState } from 'react';
import SetupScreen from '@/components/SetupScreen';
import SessionScreen from '@/components/SessionScreen';
import SummaryScreen from '@/components/SummaryScreen';

type ViewState = 'SETUP' | 'SESSION' | 'SUMMARY';

export default function Home() {
  const [viewState, setViewState] = useState<ViewState>('SETUP');
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const handleStartSession = async (traits: string[]) => {
    try {
      const response = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits }),
      });
      
      if (!response.ok) throw new Error('Failed to start session');
      
      const data = await response.json();
      setSelectedTraits(traits);
      setSessionId(data.sessionId);
      setViewState('SESSION');
    } catch (error) {
      console.error('Error starting session:', error);
      alert('Failed to start session. Please try again.');
    }
  };

  const handleSessionEnd = (summaryText: string) => {
    setSummary(summaryText);
    setViewState('SUMMARY');
  };

  const handleNewSession = () => {
    setSelectedTraits([]);
    setSessionId(null);
    setSummary(null);
    setViewState('SETUP');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {viewState === 'SETUP' && (
        <SetupScreen onStartSession={handleStartSession} />
      )}
      {viewState === 'SESSION' && sessionId && (
        <SessionScreen
          sessionId={sessionId}
          selectedTraits={selectedTraits}
          onSessionEnd={handleSessionEnd}
        />
      )}
      {viewState === 'SUMMARY' && summary && (
        <SummaryScreen summary={summary} onNewSession={handleNewSession} />
      )}
    </main>
  );
}

