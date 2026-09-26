# PONTO ZERO

FPS tático **original**, single-player local, feito para testes. Ataque × Defesa 5×5 contra bots, com movimentação
de FPS competitivo, armas com recoil de verdade, IA com estados/navegação e mapa próprio.
Roda 100 % no seu navegador (local ou pelo link online) — sem servidor de jogo e sem multiplayer: os bots e toda a lógica rodam na sua própria máquina.

> Inspirado na *sensação* de FPS táticos clássicos. Nenhum código, mapa, modelo, som, textura, interface ou nome
> de Counter-Strike/CS2 foi usado. Tudo (inclusive áudio e texturas) é gerado por código — ver [`Assets/README.md`](Assets/README.md).

## Jogar online

**https://paixaojeferson76-ops.github.io/ponto-zero/** — abre direto no navegador, sem instalar nada.
Funciona no **PC (teclado e mouse)** e no **celular (toque)** — Chrome ou Edge atuais recomendados.
O site é publicado automaticamente pelo GitHub Pages a cada `git push` na branch `main` — só depois de os testes da simulação passarem
(veja [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). As configurações de cada pessoa ficam salvas no próprio navegador dela.

## Jogar no celular

Abra o mesmo link no celular e toque em **JOGAR** (gire para o modo **paisagem**; o jogo pausa sozinho se ficar em pé).
Os controles de toque seguem o estilo dos FPS mobile:

| Toque | Ação |
|---|---|
| **Joystick** (metade esquerda, aparece onde você toca) | mover — empurre até o fim para **correr** |
| **Arrastar** (metade direita) | olhar |
| **TIRO** | atirar (arraste o dedo sobre ele para mirar e atirar ao mesmo tempo) |
| **MIRAR** | zoom/ADS (segurar) |
| **PULAR** · **AGACHAR** | tocar (agachar liga/desliga) |
| **RECAR.** · **ARMA** · **GRANADA** | recarregar · trocar de arma · arremessar a granada escolhida |
| Ícones **1 2 3** e **FRAG CEGA FUMA** (embaixo) | tocar para escolher arma/granada |
| **USAR** (aparece perto do sítio/da carga) | segurar para plantar/desarmar |
| **PLACAR** · **EQUIP.** · **⏸** | placar (segurar) · arma primária na preparação · pausa |

Na primeira vez no celular o jogo já vem com qualidade **baixa** e bots **fáceis** (mudam em Configurações). A aba **Toque** ajusta
sensibilidade, **assistência de mira** (puxa a mira de leve para o inimigo enquanto você atira) e tamanho dos botões. Se ficar pesado,
reduza a **resolução de renderização** em Vídeo. No Android o jogo pede tela cheia e paisagem; no iPhone não existe tela cheia no Safari —
use *Compartilhar → Adicionar à Tela de Início* para abrir sem as barras.

## Como executar (local)

**Windows (mais fácil):** dê duplo clique em [`start.bat`](start.bat). Ele sobe o servidor local e abre o jogo em uma janela do
Chrome/Edge (modo app). Fechou a janela → o servidor encerra sozinho.

Ou pelo terminal, dentro da pasta do projeto:

```bash
npm start          # servidor + abre a janela do jogo
npm run serve      # só o servidor (abra http://127.0.0.1:5173 no Chrome/Edge)
```

Requisitos: **Node.js ≥ 20** e **Chrome ou Edge** atuais. Não é preciso instalar dependências para jogar
(o Three.js já está em `vendor/`). `npm install` só é necessário para rodar os testes E2E.

Na primeira vez: **JOGAR → clique** (o navegador só libera o mouse com um clique). `ESC` pausa; **CONTINUAR** volta.

## Controles

| Ação | Tecla / botão |
|---|---|
| Mover | `W` `A` `S` `D` |
| Correr | `Shift` (segurar) — andar é a velocidade base |
| Agachar | `Ctrl` ou `C` *(Ctrl+W fecha a aba do navegador; `C` é a alternativa segura)* |
| Pular | `Espaço` |
| Atirar | Botão esquerdo |
| Mirar / ação secundária | Botão direito (ADS · faca: golpe forte · granada: arremesso curto) |
| Recarregar | `R` |
| Armas | `1` primária · `2` pistola · `3` faca · roda do mouse alterna · `Q` última |
| Granadas | `4` explosiva · `5` cegante · `6` fumaça · `G` arremessa a selecionada |
| Plantar / desarmar | `E` (segurar) |
| Equipamento (só na preparação) | `B` |
| Placar | `Tab` (segurar) |
| Menu / pausa | `Esc` |
| Debug | `F3` liga/desliga · `F4` troca o nível de detalhe |

Os atalhos ficam numa tabela de **ações** ([`src/Config/Controls.js`](src/Config/Controls.js)), pronta para remapeamento.

## A partida

Modo **Sabotagem** (Ataque × Defesa), primeiro a **5 rounds**:

* **Atacantes** plantam a carga no **sítio A ou B** (segurar `E` por 3,2 s parado, dentro do círculo) e a protegem por 35 s.
* **Defensores** impedem a plantação, eliminam os atacantes ou **desarmam** a carga (segurar `E` por 6 s).
* O round acaba por detonação, desarme, eliminação total ou tempo (115 s). Preparação de 6 s (movimento travado; `B` troca a arma primária).
* Você escolhe o lado, a dificuldade dos bots (Fácil/Normal/Difícil) e o tamanho dos times (2 a 5) no menu.
* Morreu? Você espectra os aliados até o próximo round.

### Armas

| Arma | Papel | Destaques |
|---|---|---|
| **P9 Sentinela** | pistola | semiautomática, muito precisa, pente 13 |
| **AR-30 Vanguarda** | rifle | automático, pente 30, recoil progressivo com padrão, longo alcance |
| **SM-9 Tempestade** | SMG | cadência altíssima, dano menor, mais móvel |
| **PS-12 Marreta** | espingarda | 8 projéteis, curto alcance, recarga por cartucho (interrompível) |
| **Faca tática** | corpo a corpo | golpe rápido / golpe forte (botão direito), *backstab* |
| Granadas | fragmentação · cegante · fumaça | física com ricochete; fumaça bloqueia a visão (jogador e bots) |

Dano por região (cabeça ×4, tronco ×1, braços ×0,8, pernas ×0,75), armadura, queda de dano por distância e **penetração
por material** (divisórias finas/madeira sim; concreto não).

**Recoil em 3 camadas independentes:** (1) *precisão* — padrão determinístico que muda a direção real das balas e que você
compensa puxando o mouse; (2) *câmera* — coice visual que não afeta a mira; (3) *arma* — mola do modelo em primeira pessoa.

## Ajustando o jogo

Tudo que mexe na sensação está centralizado (nada de números espalhados no código):

| O quê | Onde |
|---|---|
| Velocidades, aceleração, atrito, gravidade, pulo, câmera, FOV, dano de queda | [`src/Config/Tuning.js`](src/Config/Tuning.js) |
| Cada arma (dano, cadência, recoil, spread, penetração, sons…) | [`src/Config/WeaponDefs.js`](src/Config/WeaponDefs.js) |
| Regras da partida (tempos, plantar, desarmar, rounds) | [`src/Config/MatchRules.js`](src/Config/MatchRules.js) |
| Dificuldade e percepção dos bots | [`src/AI/AIConfig.js`](src/AI/AIConfig.js) |
| Qualidade LOW/MEDIUM/HIGH | [`src/Config/Quality.js`](src/Config/Quality.js) |
| Preferências do usuário (salvas no navegador) | menu **Configurações** → [`src/Config/Settings.js`](src/Config/Settings.js) |

O menu de configurações cobre **Vídeo** (resolução de renderização, tela cheia, qualidade, sombras, FOV, FPS), **Mouse**
(sensibilidade, inversão vertical, multiplicador ao mirar, entrada bruta), **Áudio** (geral/efeitos/música),
**Jogabilidade** (head bob, efeitos de câmera, dificuldade) e **Crosshair** (tamanho, espessura, abertura, cor, opacidade,
contorno, ponto, abertura ao mover/atirar) com prévia ao vivo.

## Debug (F3)

`F3` abre o painel: FPS, tempo de frame/CPU/simulação, draw calls e triângulos, memória, posição/velocidade/estado do jogador,
recoil e spread, estado da partida e **estado de cada bot** (alvo, plano, caminho, travamentos).
`F4` alterna o nível: **1** info · **2** + hitboxes e raycasts (tiros, visão dos bots) · **3** + malha de navegação e caminhos ·
**4** + colliders.

## Testes

```bash
npm test               # ~130 testes da simulação (Node, sem navegador): física, armas, recoil, mapa, IA, partida
npm install            # 1× — só para os testes E2E (puppeteer-core)
npm run test:e2e       # abre o jogo no Chrome (headless) e joga: movimento, tiro, recarga, bots, plantar, morte, menus, qualidade…
npm run test:touch     # emula um celular (844×390, multitoque): joystick, arrastar, botões, plantar, pausa, retrato
npm run test:lock      # abre uma janela REAL do Chrome: pointer lock, mouse look, pausa por ESC e FPS medido
```

O que a suíte cobre: andar contra parede, contornar quinas, degraus/escadas/rampas, pular, cair, agachar (e teto baixo),
troca rápida de direção, parar de correr, controle aéreo e anti-bhop · cadência, munição, recarga (e interrupção), troca de
arma, spread, recoil determinístico/controlável, hitboxes, armadura, penetração, faca, granadas · percepção (parede, FOV,
fumaça, som), todos os estados dos bots, cobertura, anti-travamento, rotas alternativas, bot × bot completo · rounds,
plantar/desarmar, vitória/derrota, placar, reinício · custo por tick e memória.

Medido nesta máquina (Xeon E5-2650 v4 + RX 580, Chrome, 1280×720): **≈ 500 FPS (baixa) · 410 (média) · 340 (alta) sem vsync**, com 5×5 em
combate; simulação ≈ 0,1 ms por tick (120 Hz); CPU ≈ 1,5–3 ms/frame; heap ≈ 30 MB. Um round 5×5 de bots simula ~200× mais rápido que o tempo real.

## Tecnologia (e por quê)

Nenhuma engine (Godot/Unity/Unreal) estava instalada, e o objetivo era rodar **local, gratuito e leve**. Escolha:
**Three.js (WebGL) + JavaScript ES Modules + um servidor estático em Node sem dependências**, abrindo no Chrome/Edge do
próprio PC (pointer lock e mouse bruto nativos).

* Zero download de engine, zero licença paga, projeto pequeno e legível.
* A **simulação é separada da renderização**: física, armas, IA e regras não importam DOM nem WebGL — rodam no Node (por
  isso são testáveis de verdade) e servem de base para um futuro servidor/multiplayer.
* Um comando (`UserCmd`) alimenta jogador **e** bots pelo mesmo caminho de código.

## Estrutura

```
src/
  Config/    parâmetros centralizados (Tuning, WeaponDefs, MatchRules, Settings, Controls, Quality, Surfaces)
  Physics/   colliders (caixa/rampa), grid espacial + raycast, CharacterBody (colisão), MovementModel
  Systems/   EventBus, Rng, MathUtil, ObjectPool, Damage (Health/Armor/DamageReceiver), Hitbox, Input (navegador)
  Player/    Combatant (base humano/bot), PlayerController, PlayerCamera
  Weapons/   WeaponSystem (máquina de estados), RecoilSystem, Accuracy, Ballistics, Grenades
  AI/        Bot, BotBrain (11 estados), Perception, BotNavigator (anti-travamento), BotAim, CoverFinder, TeamCommander
  World/     NavGrid + A*, MapBuilder, maps/Forja.js (dados do mapa)
  Game/      GameSession (passo fixo), Match (rounds/objetivo), MatchSetup, Game (controlador do navegador)
  Render/    SceneManager, MapRenderer, Materials, CharacterView, ViewModel, Effects, DebugDraw, WeaponModels
  Audio/     AudioEngine (posicional), SoundBank (síntese procedural)
  UI/        HUD, Crosshair, Scoreboard, Menus, DebugOverlay, styles.css
Tests/       *.test.js (simulação) e e2e/ (navegador)      Assets/   licenças     server/  servidor local
docs/        especificação de design                        dev/      visualizador de mapa
```

Fluxo: `UserCmd` → `Combatant.update` (movimento 120 Hz, armas, hitboxes) → eventos no `EventBus` → Render/Áudio/HUD.
O mouse é aplicado **por frame** (sem input lag) e a câmera interpola entre passos físicos.

### Como estender

* **Nova arma:** adicione um objeto em `WeaponDefs.js` (o teste `Tests/config.test.js` valida os campos) e um modelo em `WeaponModels.js`.
* **Novo mapa:** crie `src/World/maps/SeuMapa.js` no mesmo formato de `Forja.js` (retângulos abertos + props + spawns/sítios/rotas) e passe em `createGame({ mapDef })`. Os testes de `Tests/map.test.js` mostram o que validar (alcance, rotas alternativas, física real).
* **Novo modo:** implemente outra classe no estilo de `Game/Match.js` (o comandante e os bots só dependem de `match.bomb`, fases e sítios).
* **Multiplayer (futuro):** a simulação já é determinística por semente e comandada por `UserCmd`; falta transporte, predição e reconciliação.

## Limitações conhecidas

* O antialiasing só muda ao recarregar a página (limitação do WebGL); demais opções de vídeo valem na hora.
* Bots usam granada de fragmentação, mas não cegante/fumaça. Sem economia/compra (só escolha de arma primária), sem troca de lados.
* Áudio 100 % sintetizado (soa "arcade"); para som de estúdio, troque os `AudioBuffer` do `SoundBank` por arquivos livres e registre a licença em `Assets/`.
* Sem gamepad. O remapeamento de teclas ainda não tem interface (a estrutura existe).
* Celular: validado por **emulação** (Android/Chrome, multitoque) — o desempenho em cada aparelho depende da GPU dele; iPhone/Safari não foi testado em aparelho real.

Licenças de terceiros: [`Assets/README.md`](Assets/README.md) (three.js, MIT).
