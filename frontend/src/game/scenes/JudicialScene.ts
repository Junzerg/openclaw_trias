import { BaseScene } from './BaseScene';
import Phaser from 'phaser';
import { soundManager } from '../SoundManager';

export class JudicialScene extends BaseScene {
  private justice!: Phaser.GameObjects.Sprite;
  private bill!: Phaser.GameObjects.Sprite;
  private redOverlay!: Phaser.GameObjects.Rectangle;
  private redParticleEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('JudicialScene');
  }

  create() {
    super.create();
    this.cameras.main.fadeIn(300, 0, 0, 0);
    
    // Background - black canvas with court bg
    this.add.rectangle(400, 300, 800, 600, 0x000000);
    const bg = this.add.image(400, 300, 'bg_court');
    bg.setAlpha(0.5); // Dim background

    this.add.text(400, 50, '[ 最高法院 ]', {
      fontSize: '24px',
      color: '#ff00ff',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5);
    
    // Justice sprite sheet is 439x286
    this.justice = this.add.sprite(400, 200, 'mp_chief_justice').setOrigin(0.5);
    this.justice.play('justice_idle');

    // Bill prop glowing
    this.bill = this.add.sprite(400, 450, 'prop_bill').setOrigin(0.5).setDisplaySize(64, 64);

    // Spotlight Graphic over Justice and Bill
    const spotlight = this.add.graphics();
    spotlight.fillStyle(0xffffff, 0.1);
    spotlight.fillTriangle(400, 50, 200, 500, 600, 500);

    // Red Overlay for unconstitutional strobe
    this.redOverlay = this.add.rectangle(400, 300, 800, 600, 0xff0000).setAlpha(0).setDepth(10);

    // Particles setup (1px particles)
    const gp = this.add.graphics();
    gp.fillStyle(0xffffff, 1);
    gp.fillRect(0, 0, 4, 4);
    gp.generateTexture('tiny_particle', 4, 4);
    gp.destroy();
  }

  public triggerConstitutional(): Promise<void> {
    return new Promise(resolve => {
      this.resetSceneState();
      this.showNotification(`审查完毕：合宪`);
      
      this.justice.play('justice_hammer');
      
      this.time.delayedCall(200, () => {
        soundManager.play('gavel');
        this.cameras.main.shake(150, 0.01);
        
        const stamp = this.add.text(400, 450, '合宪', {
          fontSize: '48px', color: '#00ff00', fontStyle: 'bold', backgroundColor: '#003300'
        }).setOrigin(0.5).setAlpha(0).setScale(3).setDepth(20);
        
        this.tweens.add({
          targets: stamp,
          alpha: 1,
          scale: 1,
          duration: 300,
          ease: 'Bounce.easeOut',
          onComplete: () => {
            this.time.delayedCall(1500, () => stamp.destroy());
          }
        });
      });

      this.time.delayedCall(2000, () => {
        this.justice.play('justice_idle');
        resolve();
      });
    });
  }

  public triggerUnconstitutional(): Promise<void> {
    return new Promise(resolve => {
      this.resetSceneState();
      this.showNotification(`审查完毕：违宪！`);
      
      this.justice.play('justice_hammer');
      
      this.time.delayedCall(100, () => soundManager.play('gavel'));
      this.time.delayedCall(500, () => soundManager.play('alert'));
      this.cameras.main.shake(600, 0.015);

      // 1. Red Strobe Light Overlay (Smooth down the flashes)
      this.tweens.add({
          targets: this.redOverlay,
          alpha: 0.35,
          duration: 150,
          yoyo: true,
          repeat: 5,
          onComplete: () => {
            this.redOverlay.setAlpha(0);
          }
      });

      // 2. Traceback Waterfall
      if (!this.redParticleEmitter) {
        this.redParticleEmitter = this.add.particles(400, 0, 'tiny_particle', {
          tint: 0xff0000,
          speedY: { min: 200, max: 400 },
          speedX: { min: -50, max: 50 },
          emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-400, -50, 800, 50) as any },
          scale: { start: 1, end: 0.5 },
          lifespan: 2000,
          frequency: 5,
          blendMode: 'ADD',
        }).setDepth(5);
      } else {
        this.redParticleEmitter.start();
      }
      
      // Auto stop waterfall after 3 seconds
      this.time.delayedCall(3000, () => {
          if(this.redParticleEmitter) this.redParticleEmitter.stop();
          this.redOverlay.setAlpha(0);
          this.justice.play('justice_idle');
          resolve();
      });

      // 3. Bill Fire and Ash
      this.time.delayedCall(300, () => {
        this.bill.setTint(0x550000);
        if (!this.fireEmitter) {
          this.fireEmitter = this.add.particles(this.bill.x, this.bill.y, 'tiny_particle', {
            tint: [0xff4400, 0xff0000, 0x555555],
            speed: { min: 50, max: 150 },
            angle: { min: 250, max: 290 },
            scale: { start: 2, end: 0.1 },
            alpha: { start: 1, end: 0 },
            lifespan: 1000,
            frequency: 20,
            blendMode: 'ADD'
          }).setDepth(6);
        } else {
          this.fireEmitter.start();
        }

        this.tweens.killTweensOf(this.bill);
        this.tweens.add({
          targets: this.bill,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 2000,
          onComplete: () => {
            if(this.fireEmitter) this.fireEmitter.stop();
          }
        });
      });
    });
  }

  // Override to reset state easily if needed
  private resetSceneState() {
    this.redOverlay.setAlpha(0);
    this.bill.clearTint();
    this.bill.setScale(1);  // This will override setDisplaySize unfortunately, wait, no, we should preserve display size by not using setScale or resetting DisplaySize.
    this.bill.setDisplaySize(64, 64);
    this.bill.setAlpha(1);
    this.tweens.killTweensOf(this.redOverlay);
    this.tweens.killTweensOf(this.bill);
    if(this.redParticleEmitter) this.redParticleEmitter.stop();
    if(this.fireEmitter) this.fireEmitter.stop();
  }
}
