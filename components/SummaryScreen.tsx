'use client';

interface SummaryScreenProps {
  summary: string;
  onNewSession: () => void;
}

export default function SummaryScreen({ summary, onNewSession }: SummaryScreenProps) {
  return (
    <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-3xl font-bold text-gray-900 mb-6 text-center">
        Session Summary
      </h2>
      
      <div className="bg-gray-50 rounded-lg p-6 mb-6">
        <div className="prose prose-sm max-w-none">
          <pre className="whitespace-pre-wrap text-gray-700 font-sans">
            {summary}
          </pre>
        </div>
      </div>

      <button
        onClick={onNewSession}
        className="w-full py-4 rounded-lg text-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg transition-all"
      >
        Start New Session
      </button>
    </div>
  );
}

