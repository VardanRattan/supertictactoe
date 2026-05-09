"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Users, Bot, UserPlus, Globe, ArrowLeftCircle, Smile } from 'lucide-react';

// Humorous messages
const HUMOROUS_MESSAGES = [
  "Warning: Highly addictive gameplay ahead!",
  "You can beat the AI... if you try really hard.",
  "Get ready to outsmart your friends... or just have fun trying!",
  "Your moves will be legendary... or not.",
  "Are you ready to make some questionable moves?",
  "Even your cat is rooting for you!",
  "Quick, make a move before the AI gets impatient!",
  "Let's see if you can outwit a computer... no pressure.",
  "Embrace the chaos! (But try not to lose your mind.)",
  "This game is 100% less likely to involve interdimensional travel than you think.",
  "May awaken your inner Loki (but hopefully not your inner Thanos).",
  "Pro Tip: Summon a spirit animal. It might help... or haunt you.",
  "Warning: May cause unexpected existential dread about the nature of reality.",
  "This game is 99% skill, 1% pure luck (and maybe a dash of cosmic intervention).",
  "Embrace the absurdity! It's the only way to win.",
  "Use the power of the Sharingan to predict your opponent's moves!",
  "This game is like a Ghibli movie: deceptively simple, but surprisingly profound.",
  "Warning: May cause uncontrollable urges to yell 'ORA ORA ORA!' during gameplay.",
  "This game is so intense, it might summon a Stand."
];

interface GameModeProps {
  title: string;
  icon: React.ElementType;
  disabled?: boolean;
  onClick: () => void;
}

// GameMode component for individual tiles
const GameMode = ({ title, icon: Icon, disabled, onClick }: GameModeProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`
      relative w-full max-w-[300px] sm:max-w-[250px] aspect-square
      bg-gray-800 rounded-xl p-6
      flex flex-col items-center justify-center gap-4
      transition-all duration-200
      border border-gray-700
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700 hover:scale-105 shadow-xl'}
    `}
  >
    <Icon size={48} className={disabled ? 'text-gray-400' : 'text-yellow-400'} />
    <h2 className="text-lg sm:text-xl font-bold text-gray-100">{title}</h2>
    {disabled && (
      <div className="absolute top-2 right-2 bg-gray-900 px-2 py-1 rounded text-sm text-gray-400">
        Coming Soon
      </div>
    )}
  </button>
);

interface MainMenuProps {
  onModeSelect: (mode: string) => void;
}

// Main Menu component
const MainMenu = ({ onModeSelect }: MainMenuProps) => {
  const [randomMessage, setRandomMessage] = useState("");

  const modes = useMemo(() => [
    { id: 'pass_and_play', title: 'Pass & Play', icon: Users, disabled: false },
    { id: 'ai_duel', title: 'AI Duel', icon: Bot, disabled: false },
    { id: 'friend_battle', title: 'Friend Battle', icon: UserPlus, disabled: true },
    { id: 'online_arena', title: 'Online Arena', icon: Globe, disabled: true }
  ], []);

  // Set random message on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * HUMOROUS_MESSAGES.length);
      setRandomMessage(HUMOROUS_MESSAGES[randomIndex]);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col p-4">
      <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col p-4" style={{ paddingTop: 0 }}>
        <h1 className="text-4xl md:text-5xl font-bold text-yellow-400 text-center mt-8 md:mt-12">
          Super Tic Tac Toe
        </h1>
        <div className="container mx-auto flex-1 flex flex-col items-center gap-6 sm:gap-8 mt-10 sm:mt-12">
          <div className="grid grid-cols-2 gap-6 sm:gap-8 w-full max-w-3xl justify-items-center">
            {modes.map((mode) => (
              <GameMode
                key={mode.id}
                title={mode.title}
                icon={mode.icon}
                disabled={mode.disabled}
                onClick={() => !mode.disabled && onModeSelect(mode.id)}
              />
            ))}
          </div>

          {/* Display Random Message and Icon */}
          <div className="flex flex-col items-center gap-4 mt-12">
            <Smile size={48} className="text-yellow-400" />
            {randomMessage && (
              <p className="text-xl sm:text-2xl text-gray-200 text-center font-semibold max-w-2xl">
                {randomMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface BackToMenuButtonProps {
  onClick: () => void;
}

// Back to Menu Button component
const BackToMenuButton = ({ onClick }: BackToMenuButtonProps) => (
  <button
    onClick={onClick}
    className="absolute top-4 left-4 p-2 text-gray-400 hover:text-yellow-400 transition-colors duration-200"
  >
    <ArrowLeftCircle size={24} />
  </button>
);

export default MainMenu;
export { BackToMenuButton };
