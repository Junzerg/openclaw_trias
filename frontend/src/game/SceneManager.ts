import Phaser from 'phaser';
import { soundManager } from './SoundManager';

export class SceneManager {
  private game: Phaser.Game;
  private isTransitioning: boolean = false;

  constructor(game: Phaser.Game) {
    this.game = game;
  }

  public getActiveScene(): Phaser.Scene | null {
    // getScenes(true) returns all active (running) scenes
    const activeScenes = this.game.scene.getScenes(true);
    return activeScenes.length > 0 ? activeScenes[0] : null;
  }

  private static readonly SCENE_MAP: Record<string, string> = {
    'Parliament': 'ParliamentScene',
    'Executive': 'ExecutiveScene',
    'Judicial': 'JudicialScene',
    'Debating': 'ParliamentScene',
    'Voting': 'ParliamentScene',
    'Executing': 'ExecutiveScene',
    'Reviewing': 'JudicialScene',
    // Upper-case backend BillState real mappings
    'PETITION': 'ParliamentScene',
    'DEBATING': 'ParliamentScene',
    'DEBATE_PROPOSE': 'ParliamentScene',
    'DEBATE_REBUTTAL': 'ParliamentScene',
    'VOTED': 'ParliamentScene',
    'VETOED': 'ParliamentScene',
    'EXECUTING': 'ExecutiveScene',
    'PENDING_EXECUTION': 'ExecutiveScene',
    'JUDICIAL_REVIEW': 'JudicialScene',
    'CONSTITUTIONAL': 'JudicialScene',
    'UNCONSTITUTIONAL': 'JudicialScene',
    'DELIVERED': 'ExecutiveScene',
  };

  private currentTaskId: string | null = null;

  public switchTo(status: string, taskId?: string) {
    if (this.isTransitioning) {
        console.log(`[SceneManager] Ignoring switch to ${status} because a transition is already in progress.`);
        return;
    }

    const normalizedStatus = status ? status.toUpperCase() : '';
    const targetScene = SceneManager.SCENE_MAP[normalizedStatus] ?? 
                        SceneManager.SCENE_MAP[status] ?? 
                        'ParliamentScene';

    const currentScene = this.getActiveScene();
    if (!currentScene) return;

    const isDifferentTask = taskId && taskId !== this.currentTaskId;

    if (currentScene.scene.key !== targetScene) {
      console.log(`[SceneManager] Switching from ${currentScene.scene.key} to ${targetScene}`);
      this.isTransitioning = true;
      
      // Stop ongoing transitions/tweens globally before fading if we want, but fadeOut is enough
      currentScene.cameras.main.fadeOut(600, 0, 0, 0);
      currentScene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          soundManager.stopAll();
          currentScene.scene.start(targetScene);
          if (taskId) this.currentTaskId = taskId;
          
          const newScene = this.game.scene.getScene(targetScene);
          if (newScene) {
             // Will trigger after start
             this.game.events.once('step', () => {
                 this.isTransitioning = false;
             });
          } else {
             this.isTransitioning = false;
          }
      });
    } else if (isDifferentTask) {
      console.log(`[SceneManager] Restarting ${targetScene} for new task ${taskId}`);
      this.isTransitioning = true;
      currentScene.cameras.main.fadeOut(600, 0, 0, 0);
      currentScene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          soundManager.stopAll();
          currentScene.scene.restart();
          if (taskId) this.currentTaskId = taskId;
          
          this.game.events.once('step', () => {
             this.isTransitioning = false;
          });
      });
    }
  }
}
