# PONTO ZERO — Design (FPS tático local)

Data: 2026-09-25 · Caminho: arquitetural · Status: aprovado por autorização de autonomia do usuário
(o usuário pediu para construir sem esperar aprovações intermediárias).

## 1. Entendimento (o que foi dito × o que foi assumido)

**Dito pelo usuário**
- FPS tático competitivo, ORIGINAL (sem assets/nomes/mapas de CS2), single-player local, só para testes.
- Prioridades: jogabilidade > física/controle > armas > IA > performance > mapa > áudio > HUD > visual.
- Parâmetros de movimento centralizados; recoil em 3 camadas; hitboxes por região; bots com estados
  IDLE…DEAD e navegação; modo Ataque × Defesa com rounds; HUD, crosshair, áudio, configurações,
  F3 debug, testes sistemáticos, README com licenças; multiplayer NÃO agora, mas arquitetura preparada.

**Assumido (corrija se errado)**
- Idioma da interface: português (BR). Código/identificadores: inglês.
- Sem assets externos: gráficos e áudio 100 % procedurais → nenhuma licença de asset a cumprir.
- O jogador é atacante por padrão (configurável). 5×5 (jogador + 4 bots vs 5 bots).
- Shift = correr (maior velocidade, mais ruído, mais dispersão); andar é a velocidade base.
- O projeto vive na raiz deste repositório (durante o desenvolvimento a pasta original era somente leitura).

**Sucesso** = abrir com `start.bat`, jogar uma partida completa 5×5 com mouse+teclado, sem erros
no console, ≥ 60 FPS em PC comum, `npm test` verde, README claro.

## 2. Tecnologia

Three.js (r186, MIT) + JS ES Modules nativos + servidor estático Node sem dependências.
Sem bundler: o navegador carrega os módulos direto (import map → `vendor/three`).
Janela do jogo: Chrome/Edge em modo `--app`. Testes: `node --test` + smoke E2E com puppeteer-core.

Alternativas descartadas: Godot/Unity/Unreal (não instalados; download pesado/licenças),
Electron (peso desnecessário), Python/pygame (sem 3D competitivo decente).

## 3. Arquitetura

Duas camadas com fronteira rígida:

**Simulação (pura, sem DOM/Three; roda no Node → testável e reaproveitável em servidor futuro)**
`Config` · `Physics` · `Systems` · `Player` · `Weapons` · `AI` · `World` · `Game`

**Apresentação (só navegador)** `Render` · `UI` · `Audio` · `main.js`

Fluxo: `UserCmd` (mesmo formato para humano e bot) → `Combatant.applyCmd` → física fixa 120 Hz →
eventos no `EventBus` → Render/Áudio/HUD consomem eventos. Câmera interpola entre passos físicos;
olhar (mouse) é aplicado por frame (sem input lag).

### Módulos-chave
| Módulo | Responsabilidade |
|---|---|
| `Config/Tuning.js` | TODOS os parâmetros de movimento/câmera/armas-globais (WALK_SPEED, …) |
| `Config/WeaponDefs.js` | dados de cada arma (dano, recoil pattern, spread, sons…) |
| `Physics/CharacterMotor.js` | colisão AABB-hull com step-up, rampas, ceilings, ground snap |
| `Physics/MovementModel.js` | aceleração/atrito/ar estilo Source, controle aéreo, limite de bhop |
| `Physics/PhysicsWorld.js` | colliders (caixa/rampa), grid espacial, raycast com penetração |
| `Systems/Damage.js` | Health · Armor · DamageReceiver · Hitbox (cabeça/tronco/braços/pernas) |
| `Weapons/*` | máquina de estados da arma, recoil (precisão · câmera · viewmodel), balística, granadas |
| `World/NavGrid.js` + `Pathfinder.js` | navmesh-equivalente gerado do mapa (grid 0,5 m, A*, string-pulling) |
| `AI/*` | percepção (visão/audição), cobertura, estados do bot, comandante de time |
| `Game/Match.js` | rounds: FREEZE → LIVE → POST, plant/defuse, placar, fim de partida |

## 4. Decisões de física

- Hull AABB (0,8 m × 1,8 m; agachado 1,35 m), passo máx. 0,46 m, rampa máx. ≈ 40°.
- Movimento estilo Source: `accelerate`/`friction` com stopspeed → parada curta e tração firme (sem "deslizar").
- Ar: aceleração com teto de wish-speed (air-strafe leve) + AIR_CONTROL; teto de velocidade no pulo (anti-bhop).
- Ground snap ao descer rampas/escadas; câmera suaviza degraus (não a física).
- Passo físico fixo 120 Hz; sub-passos para nunca atravessar paredes.

## 5. Armas / tiro / recoil

Hitscan com penetração por material (madeira/vidro sim; concreto não), falloff por distância,
multiplicadores por hitbox, armadura CS-like. Recoil: (1) *precisão* — padrão determinístico + jitter
pequeno soma ao ângulo real de disparo e recupera; (2) *câmera* — coice visual que não afeta a mira;
(3) *viewmodel* — mola da arma. Spread = base + movimento + ar + agachar + ADS + bloom por tiro.

## 6. IA

Bot produz `UserCmd` como um humano. Estados: IDLE, PATROL, INVESTIGATE, SEARCH, COMBAT, TAKE_COVER,
RELOAD, RETREAT, ATTACK_OBJECTIVE, DEFEND_OBJECTIVE, DEAD. Percepção: FOV + distância + raycast +
fumaça + acumulador de consciência; audição por eventos com atenuação por oclusão. Navegação: A* no
NavGrid + rotas por lane (sem corredor único obrigatório). Anti-travamento: detectar → repath →
rota alternativa penalizada → novo objetivo. Dificuldades: FÁCIL/NORMAL/DIFÍCIL.

## 7. Mapa "Forja" (original)

Complexo industrial 96×72 m: Doca (spawn atacante) → 3 lanes (Norte / Meio / Sul), Praça central com
passarela elevada, Sítio A (NE, plataforma/rampa), Sítio B (SE, mezanino/escada), salas laterais,
conectores, containers e caixas como cobertura. Gerado por rasterização de retângulos "abertos" +
props explícitos → colliders + malhas em lote (chunks 16 m para culling).

## 8. Partida

Atacantes plantam a carga (segurar E, 3,2 s) num sítio; detona em 35 s; defensores desarmam (6 s).
Vitória: detonação, eliminação total, tempo esgotado (defensores), desarme. Primeiro a 5 rounds.
FREEZE 6 s (menu de equipamento), LIVE 115 s, POST 5 s.

## 9. Qualidade e testes

`Tests/*.test.js` (node --test): movimento, colisão, armas, recoil, balística, dano, nav, IA, partida,
performance da simulação. `Tests/e2e/smoke.mjs`: abre o jogo em Chrome headless, verifica console limpo,
movimento, tiro, bots, FPS. Revisão final com o checklist de qualidade do usuário.

## 10. Riscos

- Pointer lock do Chrome recusa relock imediato após ESC → retry no clique + overlay claro.
- WebGL headless (SwiftShader) é lento → FPS real medido só no Chrome com GPU.
- Escopo grande → fases 1–14 do usuário, validação (testes + screenshots) ao final de cada fase.
