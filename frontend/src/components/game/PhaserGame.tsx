import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Phaser from 'phaser';
import { GameConfig as phaserConfig } from '../../game/config';
import { SceneManager } from '../../game/SceneManager';

export interface PhaserGameRef {
  game: Phaser.Game | null;
  sceneManager: SceneManager | null;
}

const PhaserGame = forwardRef<PhaserGameRef, Record<string, never>>((_props, ref) => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);

  useImperativeHandle(ref, () => ({
    game: gameRef.current,
    sceneManager: sceneManagerRef.current
  }));

  useEffect(() => {
    // Only init if no existing game instance
    if (!gameRef.current) {
      const game = new Phaser.Game({ ...phaserConfig, parent: 'phaser-container' });
      gameRef.current = game;
      sceneManagerRef.current = new SceneManager(game);
    }

    return () => {
      // Cleanup to prevent React StrictMode double rendering memory leaks
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneManagerRef.current = null;
      }
    };
  }, []);

  return (
    <div 
      id="phaser-container" 
      className="w-full h-full overflow-hidden bg-(--color-bg-primary)"
    />
  );
});

export default PhaserGame;
