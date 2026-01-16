'use client';

import { useState } from 'react';

const PERSONALITY_TRAITS = [
  // Tone & Emotional Style
  { id: 'empathetic', label: 'Empathetic', category: 'Tone & Emotional Style' },
  { id: 'encouraging', label: 'Encouraging', category: 'Tone & Emotional Style' },
  { id: 'calm', label: 'Calm', category: 'Tone & Emotional Style' },
  { id: 'challenging', label: 'Challenging', category: 'Tone & Emotional Style' },
  // Cognitive Style
  { id: 'reflective', label: 'Reflective', category: 'Cognitive Style' },
  { id: 'analytical', label: 'Analytical', category: 'Cognitive Style' },
  { id: 'big-picture', label: 'Big Picture', category: 'Cognitive Style' },
  { id: 'tactical', label: 'Tactical', category: 'Cognitive Style' },
  // Structure & Direction
  { id: 'structured', label: 'Structured', category: 'Structure & Direction' },
  { id: 'exploratory', label: 'Exploratory', category: 'Structure & Direction' },
  { id: 'goal-driven', label: 'Goal-Driven', category: 'Structure & Direction' },
  { id: 'action-oriented', label: 'Action-Oriented', category: 'Structure & Direction' },
  // Intervention Style
  { id: 'directive', label: 'Directive', category: 'Intervention Style' },
  { id: 'question-led', label: 'Question-Led', category: 'Intervention Style' },
  { id: 'framework-based', label: 'Framework-Based', category: 'Intervention Style' },
  { id: 'intuition-based', label: 'Intuition-Based', category: 'Intervention Style' },
];

interface SetupScreenProps {
  onStartSession: (traits: string[]) => void;
}

export default function SetupScreen({ onStartSession }: SetupScreenProps) {
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);

  const toggleTrait = (traitId: string) => {
    if (selectedTraits.includes(traitId)) {
      setSelectedTraits(selectedTraits.filter(id => id !== traitId));
    } else if (selectedTraits.length < 3) {
      setSelectedTraits([...selectedTraits, traitId]);
    }
  };

  const handleStart = () => {
    if (selectedTraits.length > 0) {
      onStartSession(selectedTraits);
    }
  };

  return (
    <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8">
      <h1 className="text-4xl font-bold text-gray-900 mb-2 text-center">
        Voice AI Coach
      </h1>
      <p className="text-gray-600 text-center mb-8">
        A voice-based AI coach for career and academic goals
      </p>

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Select up to 3 personality traits
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Selected: {selectedTraits.length} / 3
        </p>

        <div className="space-y-6">
          {['Tone & Emotional Style', 'Cognitive Style', 'Structure & Direction', 'Intervention Style'].map(category => (
            <div key={category}>
              <h3 className="text-sm font-medium text-gray-700 mb-3">{category}</h3>
              <div className="flex flex-wrap gap-2">
                {PERSONALITY_TRAITS.filter(trait => trait.category === category).map(trait => {
                  const isSelected = selectedTraits.includes(trait.id);
                  const isDisabled = !isSelected && selectedTraits.length >= 3;
                  
                  return (
                    <button
                      key={trait.id}
                      onClick={() => toggleTrait(trait.id)}
                      disabled={isDisabled}
                      className={`
                        px-4 py-2 rounded-full text-sm font-medium transition-all
                        ${isSelected
                          ? 'bg-indigo-600 text-white shadow-md'
                          : isDisabled
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }
                      `}
                    >
                      {trait.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={selectedTraits.length === 0}
        className={`
          w-full py-4 rounded-lg text-lg font-semibold transition-all
          ${selectedTraits.length > 0
            ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }
        `}
      >
        Start Session
      </button>
    </div>
  );
}

