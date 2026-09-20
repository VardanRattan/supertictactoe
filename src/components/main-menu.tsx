"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Users, Bot, UserPlus, Globe, ArrowLeftCircle, Smile } from 'lucide-react';

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

const GameMode = ({ title, icon: Icon, disabled, onClick }: GameModeProps) => (
  <motion.button
    onClick={onClick}
    disabled={disabled}
    whileHover={disabled ? {} : { scale: 1.05, y: -4 }}
    whileTap={disabled ? {} : { scale: 0.98 }}
    transition={{ type: "spring", stiffness: 400, damping: 20 }}
    className={`
      relative w-full max-w-[280px] sm:max-w-[240px] aspect-square
      md:aspect-auto md:w-[280px] md:h-[100px] md:max-w-none
      glass-card rounded-2xl p-4 sm:p-6
      flex flex-col md:flex-row items-center md:items-center justify-center md:justify-start gap-3 sm:gap-4
      border border-white/5
      ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
    `}
  >
    <Icon 
      size={36} 
      className={`transition-colors duration-300 shrink-0 ${
        disabled 
          ? 'text-gray-500' 
          : 'text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.4)] group-hover:text-yellow-300'
      }`} 
    />
    <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-100 tracking-wide">{title}</h2>
    {disabled && (
      <div className="absolute top-2 right-2 bg-gray-950/70 border border-white/5 px-2 py-0.5 rounded-full text-[10px] text-gray-400">
        Coming Soon
      </div>
    )}
  </motion.button>
);

interface MainMenuProps {
  onModeSelect: (mode: string) => void;
}

const MainMenu = ({ onModeSelect }: MainMenuProps) => {
  const [randomMessage, setRandomMessage] = useState("");

  const modes = useMemo(() => [
    { id: 'pass_and_play', title: 'Pass & Play', icon: Users, disabled: false },
    { id: 'ai_duel', title: 'AI Duel', icon: Bot, disabled: false },
    { id: 'friend_battle', title: 'Friend Battle', icon: UserPlus, disabled: false },
    { id: 'online_arena', title: 'Online Arena', icon: Globe, disabled: true }
  ], []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * HUMOROUS_MESSAGES.length);
      setRandomMessage(HUMOROUS_MESSAGES[randomIndex]);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden bg-transparent text-gray-100 flex flex-col p-4 justify-center">
      <div className="container mx-auto flex-grow flex flex-col items-center justify-center gap-6 md:gap-8 py-4">
        <div className="text-center">
          <motion.h1 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="text-4xl md:text-6xl font-extrabold text-yellow-400 text-center glow-accent tracking-wider uppercase"
          >
            Super Tic Tac Toe
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ delay: 0.2 }}
            className="text-sm md:text-base text-gray-400 mt-2 tracking-wide font-medium"
          >
            A Strategic Multi-Layered Chess-like Duel
          </motion.p>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="grid grid-cols-2 gap-6 sm:gap-8 w-full max-w-3xl justify-items-center mt-4"
        >
          {modes.map((mode) => (
            <GameMode
              key={mode.id}
              title={mode.title}
              icon={mode.icon}
              disabled={mode.disabled}
              onClick={() => !mode.disabled && onModeSelect(mode.id)}
            />
          ))}
        </motion.div>


        {randomMessage && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.3 }}
            className="flex md:hidden flex-col items-center gap-3 mt-8 glass-panel px-6 py-4 rounded-2xl border border-white/5 max-w-2xl shadow-lg"
          >
            <Smile size={32} className="text-yellow-400 animate-bounce" />
            <p className="text-base sm:text-lg text-gray-200 text-center font-medium leading-relaxed italic">
              &ldquo;{randomMessage}&rdquo;
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

interface BackToMenuButtonProps {
  onClick: () => void;
}

const BackToMenuButton = ({ onClick }: BackToMenuButtonProps) => (
  <button
    onClick={onClick}
    className="absolute top-4 left-4 p-2 text-gray-400 hover:text-yellow-400 transition-colors duration-200 z-50 cursor-pointer"
  >
    <ArrowLeftCircle size={28} className="drop-shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
  </button>
);

export default MainMenu;
export { BackToMenuButton };
