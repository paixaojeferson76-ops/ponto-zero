// Regras do modo Ataque × Defesa ("Sabotagem").
export const MATCH_RULES = {
  ROUNDS_TO_WIN: 5,
  FREEZE_TIME: 6,          // s — preparação (movimento travado, equipamento livre)
  ROUND_TIME: 115,         // s — tempo de round (atacantes precisam plantar antes)
  POST_ROUND_TIME: 5,      // s — exibição do resultado
  PLANT_TIME: 3.2,         // s segurando E dentro do sítio
  DEFUSE_TIME: 6,          // s segurando E perto da carga
  BOMB_TIMER: 35,          // s da plantada até a detonação
  USE_RADIUS: 2.4,         // m — alcance para desarmar
  SITE_RADIUS: 4.5,        // m — raio de plantio
  TEAM_SIZE: 5,
  STARTING_ARMOR: 100,
  BOMB_BLAST_RADIUS: 20,   // m — dano da detonação (apenas efeito; jogadores próximos morrem)
  BOMB_BLAST_DAMAGE: 200,
  ANNOUNCE_TIME: 2.8,      // s de mensagens centrais
  MATCH_END_TIME: 8,
};

export const TEAM = { ATTACK: 'attack', DEFEND: 'defend' };

export const TEAM_LABEL = { attack: 'ATACANTES', defend: 'DEFENSORES' };
