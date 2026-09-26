// Monta uma partida completa: mapa, navegação, sessão, jogador, bots, comandantes e regras.
import { Bot } from '../AI/Bot.js';
import { TeamCommander } from '../AI/TeamCommander.js';
import { MATCH_RULES, TEAM } from '../Config/MatchRules.js';
import { PlayerController } from '../Player/PlayerController.js';
import { buildMap } from '../World/MapBuilder.js';
import { FORJA } from '../World/maps/Forja.js';
import { NavGrid } from '../World/NavGrid.js';
import { GameSession } from './GameSession.js';
import { Match } from './Match.js';

const CALLSIGNS = [
  'Falcão', 'Bruma', 'Cobalto', 'Lince', 'Tundra', 'Vórtice', 'Sombra', 'Ferrolho', 'Raio', 'Corvo',
  'Aurora', 'Trovão', 'Ônix', 'Faísca', 'Zênite', 'Coral',
];

/**
 * @param {{mapDef?:object, seed?:number, difficulty?:string, teamSize?:number, roundsToWin?:number,
 *          playerSide?:'attack'|'defend'|null, primary?:string, prebuiltMap?:object}} [opts]
 *        playerSide = null → sem jogador humano (simulação bot × bot, usada em testes)
 */
export function createGame(opts = {}) {
  const mapDef = opts.mapDef || FORJA;
  const built = opts.prebuiltMap || buildMap(mapDef);
  const seeds = [...mapDef.spawns.attack, ...mapDef.spawns.defend, ...Object.values(mapDef.sites)];
  const nav = opts.prebuiltNav || new NavGrid(built.world, mapDef.bounds).build(seeds);

  const session = new GameSession({ world: built.world, seed: opts.seed ?? 20240607 });
  session.nav = nav;
  session.map = mapDef;
  session.mapData = built;

  const teamSize = opts.teamSize ?? MATCH_RULES.TEAM_SIZE;
  const playerSide = opts.playerSide === undefined ? TEAM.ATTACK : opts.playerSide;
  const difficulty = opts.difficulty || 'NORMAL';
  const names = session.rng.shuffle(CALLSIGNS.slice());
  let nextId = 1;

  let player = null;
  if (playerSide) {
    player = new PlayerController(session, { id: 0, name: 'VOCÊ', team: playerSide });
    session.add(player);
  }
  for (const team of [TEAM.ATTACK, TEAM.DEFEND]) {
    const count = team === playerSide ? teamSize - 1 : teamSize;
    for (let i = 0; i < count; i++) {
      session.add(new Bot(session, { id: nextId++, name: names.pop() || `Bot ${nextId}`, team, difficulty }));
    }
  }

  const commanders = {
    [TEAM.ATTACK]: new TeamCommander(session, TEAM.ATTACK),
    [TEAM.DEFEND]: new TeamCommander(session, TEAM.DEFEND),
  };
  session.commanders = commanders;
  session.thinkers.push(commanders[TEAM.ATTACK], commanders[TEAM.DEFEND]);

  const rng = session.rng;
  const loadoutFor = (c) => {
    if (c.isPlayer) {
      return {
        primary: opts.primary || 'ar30', secondary: 'p9', melee: 'knife',
        grenades: { frag: 1, flash: 1, smoke: 1 },
      };
    }
    const roll = rng.next();
    return {
      primary: roll < 0.6 ? 'ar30' : roll < 0.82 ? 'smg9' : 'ps12',
      secondary: 'p9', melee: 'knife',
      grenades: { frag: rng.chance(0.5) ? 1 : 0, flash: rng.chance(0.3) ? 1 : 0, smoke: rng.chance(0.25) ? 1 : 0 },
    };
  };

  const match = new Match(session, {
    map: mapDef,
    roundsToWin: opts.roundsToWin ?? MATCH_RULES.ROUNDS_TO_WIN,
    loadoutFor,
    onRoundSetup: () => {
      session.intel.clear();
      commanders[TEAM.ATTACK].planRound();
      commanders[TEAM.DEFEND].planRound();
    },
  });

  return { session, match, player, nav, built, commanders };
}
