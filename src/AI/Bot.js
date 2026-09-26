// Bot: um Combatant cujo UserCmd vem de um cérebro (BotBrain) em vez do teclado/mouse.
import { Combatant } from '../Player/Combatant.js';
import { getDifficulty } from './AIConfig.js';
import { BotAim } from './BotAim.js';
import { BotBrain } from './BotBrain.js';
import { BotNavigator } from './BotNavigator.js';
import { Perception } from './Perception.js';

export class Bot extends Combatant {
  constructor(session, { id, name, team, difficulty = 'NORMAL' }) {
    super(session, { id, name, team, isPlayer: false });
    this.isBot = true;
    this.difficultyName = difficulty;
    this.difficulty = getDifficulty(difficulty);
    this.perception = new Perception(this);
    this.navigator = new BotNavigator(this);
    this.aim = new BotAim(this);
    this.brain = new BotBrain(this);
    this.plan = null;
    session.events.on('sound', (e) => this.perception.onSound(e));
    session.events.on('damage', (e) => {
      if (e.victim === this && e.attacker) this.perception.onDamaged(e.attacker);
    });
  }

  spawn(x, y, z, yaw) {
    super.spawn(x, y, z, yaw);
    this.perception.reset();
    this.navigator.reset();
    this.aim.reset();
    this.brain.reset();
    this.plan = null;
  }

  setDifficulty(name) {
    this.difficultyName = name;
    this.difficulty = getDifficulty(name);
  }

  get aiState() {
    return this.alive ? this.brain.state : 'DEAD';
  }

  think(dt) {
    this.brain.update(dt);
  }

  onEnemySpotted(rec) {
    this.brain.onEnemySpotted(rec);
  }
}
