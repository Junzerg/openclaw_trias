import Phaser from 'phaser';
import { soundManager } from '../SoundManager';

export class ParliamentScene extends Phaser.Scene {
    private conservativeMP!: Phaser.GameObjects.Sprite;
    private radicalMP!: Phaser.GameObjects.Sprite;
    private speakerMP!: Phaser.GameObjects.Sprite;
    constructor() {
        super('ParliamentScene');
    }

    create() {
        const { width, height } = this.scale;

        // 1. Background (stretched to fill)
        const bg = this.add.image(width / 2, height / 2, 'bg_parliament');
        bg.setDisplaySize(width, height);

        // 2. Speaker (upper center)
        this.speakerMP = this.add.sprite(width * 0.5, height * 0.3, 'mp_speaker');
        this.speakerMP.setScale(0.4);
        this.speakerMP.play('speaker_idle');

        // 3. Radical MP (left side — "red/radical" faction)
        this.radicalMP = this.add.sprite(width * 0.25, height * 0.75, 'mp_radical');
        this.radicalMP.setScale(0.5);
        this.radicalMP.play('radical_idle');

        // 4. Conservative MP (right side — "blue/conservative" faction)
        this.conservativeMP = this.add.sprite(width * 0.75, height * 0.75, 'mp_conservative');
        this.conservativeMP.setScale(0.25);
        this.conservativeMP.setFlipX(true);
        this.conservativeMP.play('conservative_idle');

        // 5. Spacebar debug trigger
        if (this.input?.keyboard) {
            this.input.keyboard.on('keydown-SPACE', () => {
                soundManager.play('gavel');
                this.speakerMP.play('speaker_hammer');
                this.speakerMP.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
                    this.speakerMP.play('speaker_idle');
                });
            });
        }
    }

    // ──────────────────────────────────────────────
    //  Helper: get MP sprite by faction string
    // ──────────────────────────────────────────────
    private getMPByFaction(faction?: string): Phaser.GameObjects.Sprite | null {
        if (!faction) return this.conservativeMP;
        if (faction.toLowerCase().includes('radical')) return this.radicalMP;
        if (faction.toLowerCase().includes('conservative')) return this.conservativeMP;
        return this.conservativeMP;
    }

    // ──────────────────────────────────────────────
    //  Typewriter text bubble
    // ──────────────────────────────────────────────
    private showTextBubble(
        sourceSprite: Phaser.GameObjects.Sprite,
        text: string,
        type: 'propose' | 'debate',
        charDelay: number = 40
    ): Promise<void> {
        return new Promise((resolve) => {
            const x = sourceSprite.x;
            const y = sourceSprite.y - (sourceSprite.displayHeight / 2) - 40;

            const textObj = this.add.text(x, y, '', {
                fontSize: '18px',
                color: '#000000',
                backgroundColor: type === 'propose' ? '#ffffff' : '#e0f7fa',
                padding: { x: 10, y: 10 },
                wordWrap: { width: 250, useAdvancedWrap: true }
            }).setOrigin(0.5, 1).setDepth(100);

            const textLength = text.length;
            let i = 0;
            this.time.addEvent({
                callback: () => {
                    textObj.text += text[i];
                    if (i % 2 === 0) soundManager.play('typewriter', { volume: 1.0 });
                    i++;
                },
                repeat: textLength - 1,
                delay: charDelay
            });

            this.time.delayedCall(4000 + (textLength * charDelay), () => {
                this.tweens.add({
                    targets: textObj,
                    alpha: 0,
                    duration: 500,
                    onComplete: () => textObj.destroy()
                });
            });

            this.time.delayedCall(textLength * charDelay + 300, resolve);
        });
    }

    // ──────────────────────────────────────────────
    //  Projectile system (shoe / coffee cup)
    // ──────────────────────────────────────────────
    private launchProjectile(fromSprite: Phaser.GameObjects.Sprite, toSprite: Phaser.GameObjects.Sprite) {
        // Pick random projectile type: frame 0 = shoe, frame 1 = coffee cup
        const frame = Phaser.Math.Between(0, 1);
        const projectile = this.physics.add.sprite(fromSprite.x, fromSprite.y - 30, 'prop_projectiles', frame);
        projectile.setScale(0.12);
        projectile.setDepth(90);

        // Calculate velocity for parabolic arc (gravity is y:300 from config)
        const dx = toSprite.x - fromSprite.x;
        const vx = dx * 1.2;  // horizontal speed
        const vy = -250;      // upward launch

        projectile.setVelocity(vx, vy);

        // Spin while flying
        this.tweens.add({
            targets: projectile,
            angle: 360 * (dx > 0 ? 1 : -1),
            duration: 800,
            repeat: -1
        });

        // Overlap detection with target
        this.physics.add.overlap(projectile, toSprite, () => {
            // Guard: only trigger once
            if (!projectile.body) return;
            projectile.body.enable = false;

            soundManager.play('hit', { volume: 0.6 });
            // Hit flash on target
            toSprite.setTint(0xffffff);
            this.time.delayedCall(150, () => toSprite.clearTint());

            // Destroy projectile with a quick pop
            this.tweens.add({
                targets: projectile,
                scale: 0,
                alpha: 0,
                duration: 150,
                onComplete: () => projectile.destroy()
            });
        });

        // Auto-destroy if it falls off screen
        this.time.delayedCall(3000, () => {
            if (projectile.active) projectile.destroy();
        });
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerPropose
    // ──────────────────────────────────────────────
    public async triggerPropose(faction: string, text: string): Promise<void> {
        console.log(`[ParliamentScene] Propose from ${faction}: ${text}`);
        const mp = this.getMPByFaction(faction);
        if (mp) {
            const animKey = faction.toLowerCase().includes('conservative') ? 'conservative_talk' : 'radical_talk';
            mp.play(animKey);
            await this.showTextBubble(mp, text, 'propose');

            this.time.delayedCall(2000, () => {
                const idleKey = faction.toLowerCase().includes('conservative') ? 'conservative_idle' : 'radical_idle';
                mp.play(idleKey);
            });
        }
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerDebate
    // ──────────────────────────────────────────────
    public async triggerDebate(faction: string, text: string): Promise<void> {
        console.log(`[ParliamentScene] Debate from ${faction}: ${text}`);
        const mp = this.getMPByFaction(faction);
        if (mp) {
            const animKey = faction.toLowerCase().includes('conservative') ? 'conservative_talk' : 'radical_talk';
            mp.play(animKey);
            await this.showTextBubble(mp, text, 'debate');

            this.time.delayedCall(2000, () => {
                const idleKey = faction.toLowerCase().includes('conservative') ? 'conservative_idle' : 'radical_idle';
                mp.play(idleKey);
            });
        }
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerBrawl with intensity grading
    // ──────────────────────────────────────────────
    public async triggerBrawl(intensity: number): Promise<void> {
        console.log(`[ParliamentScene] BRAWL! Intensity: ${intensity}`);

        if (intensity < 5) {
            // ── Mild conflict (Lv1): rapid overlapping dialogue ──
            await this.triggerMildConflict();
        } else {
            // ── Physical conflict (Lv2-3): tint + projectiles + shake ──
            await this.triggerPhysicalConflict(intensity);
        }
    }

    private async triggerMildConflict(): Promise<void> {
        soundManager.play('murmur');
        // Rapid overlapping speech bubbles with faster typewriter
        const insults = ['不像话！', '荒谬！', '反对！', '胡说八道！'];
        const radicalInsults = ['守旧！', '阻碍进步！', '老古板！'];

        // Conservative fires rapid text
        const cText = insults[Phaser.Math.Between(0, insults.length - 1)];
        this.showTextBubble(this.conservativeMP, cText, 'debate', 15);
        this.conservativeMP.play('conservative_talk');

        // Radical fires back after short delay
        this.time.delayedCall(300, () => {
            const rText = radicalInsults[Phaser.Math.Between(0, radicalInsults.length - 1)];
            this.showTextBubble(this.radicalMP, rText, 'debate', 15);
            this.radicalMP.play('radical_talk');
        });

        // Back to idle
        this.time.delayedCall(2000, () => {
            this.conservativeMP.play('conservative_idle');
            this.radicalMP.play('radical_idle');
        });

        // Mild shake
        this.cameras.main.shake(150, 0.003);

        await new Promise(res => this.time.delayedCall(2500, res));
    }

    private async triggerPhysicalConflict(intensity: number): Promise<void> {
        soundManager.play('murmur');
        // Red tint on both MPs
        this.conservativeMP.setTint(0xff4444);
        this.radicalMP.setTint(0xff4444);

        // Strong camera shake
        const shakeIntensity = Math.min(intensity * 0.005, 0.04);
        this.cameras.main.shake(500, shakeIntensity);

        // Launch 1-3 projectiles based on intensity
        const numProjectiles = Math.min(Math.ceil(intensity / 4), 3);
        for (let i = 0; i < numProjectiles; i++) {
            this.time.delayedCall(i * 400, () => {
                // Alternate direction
                if (i % 2 === 0) {
                    this.launchProjectile(this.radicalMP, this.conservativeMP);
                } else {
                    this.launchProjectile(this.conservativeMP, this.radicalMP);
                }
            });
        }

        // Play animations
        this.conservativeMP.play('conservative_hammer');
        this.conservativeMP.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            this.conservativeMP.play('conservative_idle');
        });

        // Clear tint after the action
        this.time.delayedCall(2500, () => {
            this.conservativeMP.clearTint();
            this.radicalMP.clearTint();
        });

        await new Promise(resolve => this.time.delayedCall(2500, resolve));
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerOrder (Speaker intervenes)
    // ──────────────────────────────────────────────
    public triggerOrder(): Promise<void> {
        return new Promise(resolve => {
            console.log(`[ParliamentScene] 肃静！`);
            
            soundManager.play('gavel');

            // Speaker slams hammer
            this.speakerMP.play('speaker_hammer');
            this.speakerMP.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
                this.speakerMP.play('speaker_idle');
            });

            // Big camera shake
            this.cameras.main.shake(400, 0.025);

            // Giant "肃静！" text overlay
            const orderText = this.add.text(this.scale.width / 2, this.scale.height / 2, '肃静！', {
                fontSize: '72px',
                color: '#ff0000',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 8
            }).setOrigin(0.5).setDepth(200).setAlpha(0);

            this.tweens.add({
                targets: orderText,
                alpha: 1,
                scale: { from: 0.3, to: 1.5 },
                duration: 250,
                yoyo: true,
                hold: 1200,
                onComplete: () => orderText.destroy()
            });

            // Gavel impact flash effect
            const flash = this.add.rectangle(
                this.scale.width / 2, this.scale.height / 2,
                this.scale.width, this.scale.height,
                0xffffff, 0.4
            ).setDepth(199);

            this.tweens.add({
                targets: flash,
                alpha: 0,
                duration: 300,
                onComplete: () => flash.destroy()
            });

            // Force all MPs back to calm
            this.conservativeMP.clearTint();
            this.radicalMP.clearTint();
            this.conservativeMP.play('conservative_idle');
            this.radicalMP.play('radical_idle');
            
            this.time.delayedCall(1500, resolve);
        });
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerVotePassed
    // ──────────────────────────────────────────────
    public triggerVotePassed(): Promise<void> {
        return new Promise(resolve => {
            console.log(`[ParliamentScene] 表决通过！`);
            
            soundManager.play('gavel');

            // All characters glow green
            this.conservativeMP.setTint(0x00ff00);
            this.radicalMP.setTint(0x00ff00);
            this.speakerMP.setTint(0x00ff00);

            // Green overlay
            const overlay = this.add.rectangle(
                0, 0, this.scale.width, this.scale.height, 0x00ff00, 0.15
            ).setOrigin(0).setDepth(150);

            // "表决通过！" text
            const passedText = this.add.text(
                this.scale.width / 2, this.scale.height / 2 - 60, '表决通过！',
                {
                    fontSize: '56px',
                    color: '#00ff00',
                    fontStyle: 'bold',
                    stroke: '#000000',
                    strokeThickness: 6
                }
            ).setOrigin(0.5).setDepth(200).setScale(2).setAlpha(0);

            this.tweens.add({
                targets: passedText,
                alpha: 1,
                scale: 1,
                duration: 500,
                ease: 'Bounce'
            });

            // Speaker hammer (ceremonial)
            this.speakerMP.play('speaker_hammer');

            // Stamp image (centered, bounce in) — frame 0=VETO, frame 1=APPROVED
            const stamp = this.add.sprite(
                this.scale.width / 2, this.scale.height / 2 + 60, 'ui_stamps', 1
            ).setScale(0).setDepth(201).setAlpha(0);

            this.time.delayedCall(800, () => {
                this.tweens.add({
                    targets: stamp,
                    scale: 0.2,
                    alpha: 1,
                    duration: 300,
                    ease: 'Back.easeOut'
                });
            });

            // Transition to Executive Scene after celebration
            this.time.delayedCall(3500, () => {
                this.cameras.main.fadeOut(600, 0, 0, 0);
                this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
                    overlay.destroy();
                    passedText.destroy();
                    stamp.destroy();
                    this.conservativeMP.clearTint();
                    this.radicalMP.clearTint();
                    this.speakerMP.clearTint();
                    this.scene.start('ExecutiveScene');
                });
                resolve();
            });
        });
    }
}
