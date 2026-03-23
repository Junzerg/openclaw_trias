import Phaser from 'phaser';
import { soundManager } from '../SoundManager';

export class PreloaderScene extends Phaser.Scene {
    constructor() {
        super('PreloaderScene');
    }

    preload() {
        // Core Config
        this.load.setBaseURL('/assets/');

        // 1. Load Backgrounds
        this.load.image('bg_parliament', 'tiles/bg_parliament.png');
        this.load.image('bg_executive', 'tiles/bg_executive_office.png');
        this.load.image('bg_court', 'tiles/bg_federal_court.png');

        // 2. Load Character Spritesheets
        this.load.spritesheet('mp_radical', 'sprites/mp_radical_sheet.png', {
            frameWidth: 130,
            frameHeight: 292 
        });
        this.load.spritesheet('mp_conservative', 'sprites/mp_conservative_sheet.png', {
            frameWidth: 225,
            frameHeight: 298 
        });
        this.load.spritesheet('mp_speaker', 'sprites/mp_speaker_sheet.png', {
            frameWidth: 199,
            frameHeight: 267
        });
        
        this.load.spritesheet('mp_president', 'sprites/mp_president_sheet.png', {
            frameWidth: 205,
            frameHeight: 380
        });
        this.load.spritesheet('mp_secretary', 'sprites/mp_secretary_sheet.png', {
            frameWidth: 147,
            frameHeight: 192
        });
        this.load.spritesheet('mp_chief_justice', 'sprites/mp_chief_justice_sheet.png', {
            frameWidth: 439,
            frameHeight: 286
        });

        // 3. Load Props and UI
        this.load.image('prop_bill', 'props/prop_bill.png');
        this.load.spritesheet('prop_projectiles', 'props/prop_projectiles_sheet.png', {
            frameWidth: 224,
            frameHeight: 222
        });
        this.load.spritesheet('ui_stamps', 'props/ui_stamps_sheet.png', {
            frameWidth: 300,
            frameHeight: 357
        });

        // 4. Load Audio
        this.load.audio('alert', 'audio/alert.wav');
        this.load.audio('gavel', 'audio/gavel.wav');
        this.load.audio('hit', 'audio/hit.wav');
        this.load.audio('murmur', 'audio/murmur.wav');
        this.load.audio('typewriter', 'audio/typewriter.wav');
    }

    create() {
        soundManager.init(this.game);
        this.registerAnimations();
        // Load the parliament scene after preloading assets and defining animations
        this.scene.start('ParliamentScene');
    }

    private registerAnimations() {
        // Radical MP Animations (extracted frames: 0=idle, 1=talk, 2=throw)
        this.anims.create({
            key: 'radical_idle',
            frames: [{ key: 'mp_radical', frame: 0 }],
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'radical_talk',
            frames: [{ key: 'mp_radical', frame: 1 }],
            frameRate: 6,
            repeat: -1
        });
        this.anims.create({
            key: 'radical_throw',
            frames: [{ key: 'mp_radical', frame: 2 }],
            frameRate: 12,
            repeat: 0
        });

        // Conservative MP Animations (sheet frames: 0=hammer, 1=talk, 2=idle)
        this.anims.create({
            key: 'conservative_idle',
            frames: [{ key: 'mp_conservative', frame: 2 }],
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'conservative_talk',
            frames: [{ key: 'mp_conservative', frame: 1 }],
            frameRate: 6,
            repeat: -1
        });
        this.anims.create({
            key: 'conservative_hammer',
            frames: [{ key: 'mp_conservative', frame: 0 }],
            frameRate: 12,
            repeat: 0
        });

        // Speaker MP Animations (sheet frames: 0=idle, 1=point, 2=hammer)
        this.anims.create({
            key: 'speaker_idle',
            frames: [{ key: 'mp_speaker', frame: 0 }],
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'speaker_point',
            frames: [{ key: 'mp_speaker', frame: 1 }],
            frameRate: 6,
            repeat: 0
        });
        this.anims.create({
            key: 'speaker_hammer',
            frames: [{ key: 'mp_speaker', frame: 2 }],
            frameRate: 12,
            repeat: 0
        });

        // President Animations (0: idle, 1: sign, 2: look)
        this.anims.create({
            key: 'president_idle',
            frames: [{ key: 'mp_president', frame: 0 }],
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'president_sign',
            frames: [{ key: 'mp_president', frame: 1 }],
            frameRate: 6,
            repeat: 0
        });

        // Secretary Animations (0: idle, 1: type, 2: burn)
        this.anims.create({
            key: 'secretary_idle',
            frames: [{ key: 'mp_secretary', frame: 0 }],
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'secretary_type',
            frames: [{ key: 'mp_secretary', frame: 1 }],
            frameRate: 12,
            repeat: -1
        });
        this.anims.create({
            key: 'secretary_burn',
            frames: [{ key: 'mp_secretary', frame: 2 }],
            frameRate: 8,
            repeat: -1
        });

        // Chief Justice Animations (0: idle, 1: point, 2: hammer)
        this.anims.create({
            key: 'justice_idle',
            frames: [{ key: 'mp_chief_justice', frame: 0 }],
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'justice_hammer',
            frames: [{ key: 'mp_chief_justice', frame: 2 }],
            frameRate: 12,
            repeat: 0
        });
        
        console.log("Preloader: All assets loaded and animations registered.");
    }
}
