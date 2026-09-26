# Assets e licenças

O PONTO ZERO **não usa nenhum arquivo de mídia externo**. Todo conteúdo é gerado por código na hora em que o jogo abre:

| Tipo | Como é feito | Onde |
|---|---|---|
| Texturas (concreto, madeira, containers, grade metálica, listras de aviso…) | canvas 2D procedural | `src/Render/Materials.js` |
| Modelos 3D (mapa, armas, personagens, granadas, carga) | caixas/cilindros/esferas procedurais | `src/Render/MapRenderer.js`, `WeaponModels.js`, `CharacterView.js` |
| Sons (tiros, recargas, passos, impactos, explosões, bipes, ambiente) | síntese em `AudioBuffer` (ruído filtrado + senoides + envelopes) | `src/Audio/SoundBank.js` |
| Música | pads gerados por osciladores WebAudio em tempo real | `src/Audio/AudioEngine.js` |
| Interface | HTML/CSS próprios; fontes do sistema (Bahnschrift/Segoe UI) | `index.html`, `src/UI/` |
| Mapa "Forja", armas, nomes, textos, regras | criação original deste projeto | `src/World/maps/Forja.js`, `src/Config/` |

Nada foi copiado, extraído ou inspirado em código/arte/áudio/mapas de Counter-Strike/CS2 ou de qualquer outro jogo.
Nomes de armas, do modo e do mapa são originais.

## Dependência de terceiros

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| [three.js](https://threejs.org) | r186 | MIT — ver `LICENSES/three.js-MIT.txt` | renderização WebGL (copiado para `vendor/three/`) |
| [puppeteer-core](https://pptr.dev) | 24.x | Apache-2.0 | **somente testes E2E** (devDependency; não faz parte do jogo) |

Como o jogo usa apenas o que foi listado acima, não há atribuição adicional a cumprir. Se você adicionar assets
externos no futuro, registre aqui: nome, autor, fonte (URL), licença e onde é usado.
