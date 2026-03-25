import Phaser from 'phaser';

export class SceneManager {
  private game: Phaser.Game;

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
    const normalizedStatus = status ? status.toUpperCase() : '';
    const targetScene = SceneManager.SCENE_MAP[normalizedStatus] ?? 
                        SceneManager.SCENE_MAP[status] ?? 
                        'ParliamentScene';

    const currentScene = this.getActiveScene();
    if (!currentScene) return;

    const isDifferentTask = taskId && taskId !== this.currentTaskId;

    if (currentScene.scene.key !== targetScene) {
      console.log(`[SceneManager] Switching from ${currentScene.scene.key} to ${targetScene}`);
      currentScene.scene.start(targetScene);
      if (taskId) this.currentTaskId = taskId;
    } else if (isDifferentTask) {
      console.log(`[SceneManager] Restarting ${targetScene} for new task ${taskId}`);
      currentScene.scene.restart();
      if (taskId) this.currentTaskId = taskId;
    }
  }
}
