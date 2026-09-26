// Materiais de superfície: penetração de tiros, som/efeito de impacto e passos.
// penetrationDepth = espessura máxima (m) atravessada por uma bala com penetration = 1.0.

export const SURFACES = {
  concrete: { penetrationDepth: 0.12, impact: 'concrete', step: 'concrete', dust: 0xb8b3a8 },
  metal:    { penetrationDepth: 0.05, impact: 'metal',    step: 'metal',    dust: 0xd8c9a0 },
  wood:     { penetrationDepth: 0.55, impact: 'wood',     step: 'wood',     dust: 0xa88a5a },
  thin:     { penetrationDepth: 0.9,  impact: 'wood',     step: 'wood',     dust: 0xa88a5a }, // divisórias finas
  floor:    { penetrationDepth: 0.0,  impact: 'concrete', step: 'concrete', dust: 0x8f8b82 },
};

export function surfaceOf(name) {
  return SURFACES[name] || SURFACES.concrete;
}
