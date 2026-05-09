"use client";

import React, { useEffect } from 'react';

interface PreGameScreenProps {
  gameMode: 'ai_duel' | 'pass_and_play' | string;
  onStartGame: () => void;
}

const PreGameScreen = ({ gameMode, onStartGame }: PreGameScreenProps) => {
  // Add page title and meta description for SEO
  useEffect(() => {
    // Update document title for SEO
    document.title = gameMode === 'ai_duel' 
      ? 'AI Duel - Super Tic Tac Toe' 
      : 'Pass and Play - Super Tic Tac Toe';
    
    // Add a meta description
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
    <div className="flex flex-col h-screen bg-gray-900 p-4">
      <h2 className="text-2xl text-yellow-400 mb-2 text-center">
        {gameMode === 'ai_duel' ? 'AI Duel Rules' : 'Game Rules'}
      </h2>

      <div className="flex-grow max-w-2xl mx-auto bg-gray-800 rounded-lg p-6 shadow-xl overflow-y-auto border border-gray-700">
        <h3 className="text-2xl text-yellow-400 mb-6 text-center font-bold">How to Play Super Tic Tac Toe</h3>

        <div className="space-y-6 text-gray-300">
          <section>
            <h4 className="text-yellow-400/90 mb-2 font-semibold text-lg underline decoration-yellow-400/30 underline-offset-4">The Basics</h4>
            <p className="text-base leading-relaxed">
              Think of it as nine Tic Tac Toe games within one big game. Your goal? 
              Win three connected games to claim victory on the super board!
            </p>
          </section>

          <section>
            <h4 className="text-yellow-400/90 mb-2 font-semibold text-lg underline decoration-yellow-400/30 underline-offset-4">Getting Started</h4>
            <ul className="list-disc list-inside space-y-2 ml-2 text-base leading-relaxed">
              <li>The first player can place their mark (O/X) anywhere on any board</li>
              <li>Here&apos;s the twist: your move determines where your opponent plays next</li>
              <li>If you play in the top-right square of any game, your opponent must play in the top-right game</li>
            </ul>
          </section>

          <section>
            <h4 className="text-yellow-400/90 mb-2 font-semibold text-lg underline decoration-yellow-400/30 underline-offset-4">Winning Games</h4>
            <ul className="list-disc list-inside space-y-2 ml-2 text-base leading-relaxed">
              <li>Win individual games by connecting three of your marks</li>
              <li>Win the super board by owning three connected games</li>
              <li>Already won games stay won, but you can still play in them to direct your opponent&apos;s next move</li>
            </ul>
          </section>

          <section>
            <h4 className="text-yellow-400/90 mb-2 font-semibold text-lg underline decoration-yellow-400/30 underline-offset-4">Special Rules</h4>
            <p className="text-base leading-relaxed italic text-gray-400">
              If you&apos;re sent to a full game, you are to play in the game in which opponent marked previously.
            </p>
          </section>
        </div>
      </div>

      <div className="flex flex-col items-center mt-6 space-y-4 mb-4">
        <button
          onClick={onStartGame}
          className="px-12 py-4 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold text-lg rounded-xl shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
        >
          I&apos;m Ready to Play!
        </button>
      </div>
    </div>
  );
};

export default PreGameScreen;
