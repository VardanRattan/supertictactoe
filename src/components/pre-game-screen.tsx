"use client";

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';

interface PreGameScreenProps {
  gameMode: 'ai_duel' | 'pass_and_play' | string;
  onStartGame: () => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12
    }
  }
} as const;

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 100 } }
} as const;

const PreGameScreen = ({ gameMode, onStartGame }: PreGameScreenProps) => {
  // Add page title and meta description for SEO
  useEffect(() => {
    document.title = gameMode === 'ai_duel' 
      ? 'AI Duel - Super Tic Tac Toe' 
      : 'Pass and Play - Super Tic Tac Toe';
    
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', 
        gameMode === 'ai_duel'
          ? 'Challenge our AI in Super Tic Tac Toe! Learn the rules and strategies for AI Duel mode.'
          : 'Play Super Tic Tac Toe with a friend in Pass and Play mode. Learn the rules before you start.'
      );
    }
  }, [gameMode]);

  return (
    <div className="flex flex-col min-h-screen bg-transparent p-4 md:p-8 justify-center items-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl flex flex-col justify-between glass-panel rounded-3xl p-6 md:p-8 shadow-2xl border border-white/5"
      >
        <div className="text-center mb-6">
          <motion.h2 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl md:text-3xl font-extrabold text-yellow-400 glow-accent uppercase tracking-wider"
          >
            {gameMode === 'ai_duel' ? 'AI Duel Rules' : 'Pass & Play Rules'}
          </motion.h2>
          <div className="w-24 h-1 bg-yellow-500/40 rounded-full mx-auto mt-2"></div>
        </div>

        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="space-y-6 text-gray-300 overflow-y-auto max-h-[60vh] pr-2"
        >
          <motion.section variants={itemVariants} className="space-y-2">
            <h4 className="text-yellow-400 font-bold text-lg underline decoration-yellow-400/20 underline-offset-4 tracking-wide">
              The Basics
            </h4>
            <p className="text-sm md:text-base leading-relaxed">
              Think of it as **nine individual Tic Tac Toe games** within one big Super Board. Your goal? 
              Win three connected games in a row (horizontal, vertical, or diagonal) to claim ultimate victory!
            </p>
          </motion.section>

          <motion.section variants={itemVariants} className="space-y-2">
            <h4 className="text-yellow-400 font-bold text-lg underline decoration-yellow-400/20 underline-offset-4 tracking-wide">
              Getting Started
            </h4>
            <ul className="list-disc list-inside space-y-2 ml-1 text-sm md:text-base leading-relaxed">
              <li>The first player can place their mark (**X** or **O**) anywhere on any sub-board.</li>
              <li>**The Twist:** Your move determines where your opponent *must* play next!</li>
              <li>If you play in the *top-right* square of a sub-board, your opponent is forced to play their next turn inside the *top-right* sub-board of the Super Board.</li>
            </ul>
          </motion.section>

          <motion.section variants={itemVariants} className="space-y-2">
            <h4 className="text-yellow-400 font-bold text-lg underline decoration-yellow-400/20 underline-offset-4 tracking-wide">
              Winning Sub-Boards
            </h4>
            <ul className="list-disc list-inside space-y-2 ml-1 text-sm md:text-base leading-relaxed">
              <li>Win individual sub-boards by connecting three of your marks within that sub-board.</li>
              <li>Once a sub-board is won, it belongs to that player permanently.</li>
              <li>*Note:* You can still be sent to an already won sub-board; playing inside it still directs your opponent's next move.</li>
            </ul>
          </motion.section>

          <motion.section variants={itemVariants} className="space-y-2">
            <h4 className="text-yellow-400 font-bold text-lg underline decoration-yellow-400/20 underline-offset-4 tracking-wide">
              Special Rules
            </h4>
            <p className="text-sm md:text-base leading-relaxed italic text-gray-400 bg-gray-950/40 p-3 rounded-xl border border-white/5">
              If you are directed to a sub-board that is already completely full, you are allowed to play in the sub-board where your opponent previously marked.
            </p>
          </motion.section>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col items-center mt-8"
        >
          <motion.button
            onClick={onStartGame}
            whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(234, 179, 8, 0.4)" }}
            whileTap={{ scale: 0.95 }}
            className="px-12 py-4 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-extrabold text-lg rounded-2xl shadow-lg transition-all duration-200 cursor-pointer"
          >
            I&apos;m Ready to Play!
          </motion.button>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default PreGameScreen;
