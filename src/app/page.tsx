"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MainMenu, { BackToMenuButton } from "@/components/main-menu";
import PreGameScreen from "@/components/pre-game-screen";
import PassAndPlay from "@/components/pass-and-play";
import AIDuel from "@/components/ai-duel";
import FriendBattle from "@/components/friend-battle";

type AppState = "MENU" | "PRE_GAME" | "PLAYING";

const pageVariants = {
  initial: { opacity: 0, y: 15, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.35, ease: "easeOut" } },
  exit: { opacity: 0, y: -15, filter: "blur(4px)", transition: { duration: 0.25, ease: "easeIn" } }
} as const;

export default function Home() {
  const [appState, setAppState] = useState<AppState>("MENU");
  const [gameMode, setGameMode] = useState<string | null>(null);

  const handleModeSelect = (mode: string) => {
    setGameMode(mode);
    setAppState("PRE_GAME");
  };

  const handleStartGame = () => {
    setAppState("PLAYING");
  };

  const handleBackToMenu = () => {
    setAppState("MENU");
    setGameMode(null);
  };

  return (
    <main className="min-h-screen md:h-screen md:overflow-hidden bg-space-grid text-gray-100 flex flex-col justify-between relative overflow-x-hidden">
      <AnimatePresence mode="wait">
        {appState === "MENU" && (
          <motion.div
            key="menu"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex-1 w-full h-full flex flex-col"
          >
            <MainMenu onModeSelect={handleModeSelect} />
          </motion.div>
        )}

        {appState === "PRE_GAME" && gameMode && (
          <motion.div
            key="pre_game"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative flex-1 w-full h-full flex flex-col"
          >
            <BackToMenuButton onClick={handleBackToMenu} />
            <PreGameScreen 
              gameMode={gameMode} 
              onStartGame={handleStartGame} 
            />
          </motion.div>
        )}

        {appState === "PLAYING" && gameMode && (
          <motion.div
            key="playing"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative flex-1 w-full h-full flex flex-col"
          >
            <BackToMenuButton onClick={handleBackToMenu} />
            {gameMode === 'ai_duel' ? (
              <AIDuel 
                mode={gameMode}
                onNewGameRequest={handleBackToMenu}
              />
            ) : gameMode === 'friend_battle' ? (
              <FriendBattle 
                mode={gameMode}
                onNewGameRequest={handleBackToMenu}
              />
            ) : (
              <PassAndPlay 
                mode={gameMode}
                onNewGameRequest={handleBackToMenu}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
