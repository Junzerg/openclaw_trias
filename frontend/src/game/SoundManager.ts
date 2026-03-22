import Phaser from 'phaser';

export class SoundManager {
    private static instance: SoundManager;
    private game: Phaser.Game | null = null;
    private enabled: boolean = true;

    private constructor() {}

    public static getInstance(): SoundManager {
        if (!SoundManager.instance) {
            SoundManager.instance = new SoundManager();
        }
        return SoundManager.instance;
    }

    public init(game: Phaser.Game) {
        this.game = game;
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    public play(key: string, config?: Phaser.Types.Sound.SoundConfig) {
        if (!this.enabled) return;
        if (!this.game) {
            console.warn('[SoundManager] Game instance not initialized. Cannot play sound:', key);
            return;
        }
        
        try {
            this.game.sound.play(key, config);
        } catch (e) {
            console.warn(`[SoundManager] Failed to play sound ${key}:`, e);
        }
    }

    public stopAll() {
        if (this.game) {
            this.game.sound.stopAll();
        }
    }
}

export const soundManager = SoundManager.getInstance();
