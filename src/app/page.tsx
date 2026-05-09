"use client";

import { useState } from "react";
import MainMenu, { BackToMenuButton } from "@/components/main-menu";
import PreGameScreen from "@/components/pre-game-screen";
import SuperTicTacToe from "@/components/super-tic-tac-toe";
import AIDuelWrapper from "@/components/ai-duel-wrapper";

type AppState = "MENU" | "PRE_GAME" | "PLAYING";

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
    <main>
      {appState === "MENU" && (
        <MainMenu onModeSelect={handleModeSelect} />
      )}

      {appState === "PRE_GAME" && gameMode && (
        <div className="relative">
          <BackToMenuButton onClick={handleBackToMenu} />
          <PreGameScreen 
            gameMode={gameMode} 
            onStartGame={handleStartGame} 
          />
        </div>
      )}

      {appState === "PLAYING" && gameMode && (
        <div className="relative">
          <BackToMenuButton onClick={handleBackToMenu} />
          {gameMode === 'ai_duel' ? (
            <AIDuelWrapper 
              mode={gameMode}
              onNewGameRequest={handleBackToMenu}
            />
          ) : (
            <SuperTicTacToe 
              mode={gameMode}
              isAIGame={false}
              onNewGameRequest={handleBackToMenu}
            />
          )}
        </div>
      )}
    </main>
  );
}
