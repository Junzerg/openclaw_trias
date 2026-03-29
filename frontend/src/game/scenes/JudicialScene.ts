import { BaseScene } from './BaseScene';
import Phaser from 'phaser';
import { soundManager } from '../SoundManager';

export class JudicialScene extends BaseScene {
  private bill!: Phaser.GameObjects.Sprite;
  private redOverlay!: Phaser.GameObjects.Rectangle;
  private redParticleEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('JudicialScene');
  }

  create() {
    super.create();
    this.cameras.main.fadeIn(600, 0, 0, 0);
    const { width, height } = this.scale;
    
    // Background - black canvas with court bg
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000);
    const bg = this.add.image(width / 2, height / 2, 'bg_court');
    bg.setDisplaySize(width, height);
    bg.setAlpha(0.5); // Dim background

    this.add.text(width / 2, height * 0.08, '[ 最高法院 ]', {
      fontSize: '24px',
      color: '#ff00ff',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5);
    
    // Bill prop glowing
    this.bill = this.add.sprite(width / 2, height * 0.6, 'prop_bill').setOrigin(0.5);
    const billSize = Math.max(120 * (width/800), 80);
    this.bill.setDisplaySize(billSize, billSize);

    // Spotlight Graphic over Bill
    const spotlight = this.add.graphics();
    spotlight.fillStyle(0xffffff, 0.1);
    spotlight.fillTriangle(width / 2, 0, width * 0.35, height * 0.8, width * 0.65, height * 0.8);

    // Red Overlay for unconstitutional strobe
    this.redOverlay = this.add.rectangle(width / 2, height / 2, width, height, 0xff0000).setAlpha(0).setDepth(10);

    // Particles setup (1px particles)
    const gp = this.add.graphics();
    gp.fillStyle(0xffffff, 1);
    gp.fillRect(0, 0, 4, 4);
    gp.generateTexture('tiny_particle', 4, 4);
    gp.destroy();
  }

  public triggerConstitutional(): Promise<void> {
    const { width, height } = this.scale;
    return new Promise(resolve => {
      this.resetSceneState();
      this.showNotification(`审查完毕：合宪`);
      
      soundManager.play('gavel');
      this.cameras.main.shake(150, 0.01);
      
      const stampScale = Math.max(width/800, 1.0);
      const stamp = this.add.text(width / 2, height * 0.6, ' [ 合 宪 ] ', {
        fontSize: '64px', color: '#00ff00', fontStyle: 'bold', stroke: '#000000', strokeThickness: 8
      }).setOrigin(0.5).setAlpha(0).setScale(stampScale * 4).setDepth(20);
      
      this.tweens.add({
        targets: stamp,
        alpha: 1,
        scale: stampScale,
        duration: 300,
        ease: 'Bounce.easeOut',
        onComplete: () => {
          this.time.delayedCall(1500, () => stamp.destroy());
        }
      });

      this.time.delayedCall(2000, () => {
        resolve();
      });
    });
  }

  public triggerUnconstitutional(): Promise<void> {
    const { width, height } = this.scale;
    return new Promise(resolve => {
      this.resetSceneState();
      this.showNotification(`审查完毕：违宪！`);
      
      soundManager.play('gavel');
      this.time.delayedCall(500, () => soundManager.play('alert'));
      this.cameras.main.shake(600, 0.015);

      const stampScale = Math.max(width/800, 1.0);
      const stamp = this.add.text(width / 2, height * 0.6, ' [ 违 宪 ] ', {
        fontSize: '72px', color: '#ff0000', fontStyle: 'bold', stroke: '#000000', strokeThickness: 10
      }).setOrigin(0.5).setAlpha(0).setScale(stampScale * 5).setDepth(20);

      this.tweens.add({
        targets: stamp,
        alpha: 1,
        scale: stampScale,
        duration: 300,
        ease: 'Bounce.easeOut',
        onComplete: () => {
          this.time.delayedCall(2500, () => stamp.destroy());
        }
      });

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
        this.redParticleEmitter = this.add.particles(width / 2, 0, 'tiny_particle', {
          tint: 0xff0000,
          speedY: { min: 200 * height/600, max: 400 * height/600 },
          // random spread across width
          speedX: { min: -100, max: 100 },
          // @ts-expect-error - Phaser types are misaligned for emitZone source
          emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-width/2, -50, width, 50) },
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
          resolve();
      });

      // 3. Bill Fire and Ash
      this.time.delayedCall(300, () => {
        this.bill.setTint(0x550000);
        if (!this.fireEmitter) {
          this.fireEmitter = this.add.particles(this.bill.x, this.bill.y, 'tiny_particle', {
            tint: [0xff4400, 0xff0000, 0x555555],
            speed: { min: 50 * height/600, max: 150 * height/600 },
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
    const { width } = this.scale;
    this.redOverlay.setAlpha(0);
    this.bill.clearTint();
    this.bill.setAlpha(1);
    const billSize = Math.max(120 * (width/800), 80);
    this.bill.setDisplaySize(billSize, billSize);
    this.bill.setScale(1);  // Reset scale explicitly just in case display size uses it
    this.tweens.killTweensOf(this.redOverlay);
    this.tweens.killTweensOf(this.bill);
    if(this.redParticleEmitter) this.redParticleEmitter.stop();
    if(this.fireEmitter) this.fireEmitter.stop();
  }
}
