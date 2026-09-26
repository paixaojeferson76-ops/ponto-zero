// Ações do jogo e seus atalhos padrão. Cada ação aceita várias teclas (KeyboardEvent.code) ou
// botões do mouse ("Mouse0" = esquerdo, "Mouse1" = meio, "Mouse2" = direito).
// O jogo consulta ações — nunca teclas — então o remapeamento futuro só mexe neste mapa.

export const ACTIONS = [
  'moveForward', 'moveBack', 'moveLeft', 'moveRight',
  'run', 'crouch', 'jump',
  'fire', 'altFire', 'reload',
  'slotPrimary', 'slotSecondary', 'slotMelee',
  'grenadeFrag', 'grenadeFlash', 'grenadeSmoke', 'throwGrenade',
  'use', 'scoreboard', 'loadout', 'debug', 'debugMode',
];

export const DEFAULT_BINDINGS = {
  moveForward: ['KeyW'],
  moveBack: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],   // KeyC: alternativa segura (Ctrl+W fecha abas)
  jump: ['Space'],
  fire: ['Mouse0'],
  altFire: ['Mouse2'],
  reload: ['KeyR'],
  slotPrimary: ['Digit1'],
  slotSecondary: ['Digit2'],
  slotMelee: ['Digit3'],
  grenadeFrag: ['Digit4'],
  grenadeFlash: ['Digit5'],
  grenadeSmoke: ['Digit6'],
  throwGrenade: ['KeyG'],
  use: ['KeyE'],
  scoreboard: ['Tab'],
  loadout: ['KeyB'],
  debug: ['F3'],
  debugMode: ['F4'],
};

// Rótulos amigáveis para a tela de controles.
export const ACTION_LABELS = {
  moveForward: 'Frente', moveBack: 'Trás', moveLeft: 'Esquerda', moveRight: 'Direita',
  run: 'Correr', crouch: 'Agachar', jump: 'Pular',
  fire: 'Atirar', altFire: 'Mira / ação secundária', reload: 'Recarregar',
  slotPrimary: 'Arma primária', slotSecondary: 'Pistola', slotMelee: 'Faca',
  grenadeFrag: 'Granada explosiva', grenadeFlash: 'Granada cegante', grenadeSmoke: 'Granada de fumaça',
  throwGrenade: 'Arremessar granada', use: 'Interagir (plantar/desarmar)',
  scoreboard: 'Placar', loadout: 'Equipamento', debug: 'Debug', debugMode: 'Modo de debug',
};

export function prettyKey(code) {
  if (code.startsWith('Mouse')) return ['Mouse esq.', 'Mouse meio', 'Mouse dir.'][Number(code.slice(5))] || code;
  return code
    .replace('Key', '')
    .replace('Digit', '')
    .replace('ShiftLeft', 'Shift')
    .replace('ShiftRight', 'Shift')
    .replace('ControlLeft', 'Ctrl')
    .replace('ControlRight', 'Ctrl')
    .replace('Space', 'Espaço');
}
