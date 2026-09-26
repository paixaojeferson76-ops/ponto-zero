// Ponto de entrada: verifica compatibilidade, cria o Game, inicia o carregamento e expõe hooks de teste em window.__pz.
import { Game } from './Game/Game.js';

/** Motivo pelo qual este dispositivo não roda o jogo (ou null se estiver tudo certo). */
function unsupportedReason() {
  const probe = document.createElement('canvas');
  let gl2 = null;
  try { gl2 = probe.getContext('webgl2'); } catch { gl2 = null; }
  if (!gl2) return 'Seu navegador ou placa de vídeo não suporta WebGL 2. Tente o Chrome ou o Edge atualizados (e ative a aceleração de hardware).';
  return null;
}

const reason = unsupportedReason();
if (reason) {
  document.getElementById('loading-bar').style.display = 'none';
  const t = document.getElementById('loading-text');
  t.textContent = reason;
  t.style.cssText = 'max-width:520px;text-align:center;line-height:1.6;letter-spacing:.06em;font-size:15px;color:#e8eef4;padding:0 20px';
} else {
  const query = new URLSearchParams(location.search);
  const game = new Game(query);
  window.__pz = game.api();

  game.boot().catch((err) => {
    const el = document.getElementById('fatal');
    el.classList.remove('hidden');
    el.textContent = `Falha ao iniciar:\n${err && err.stack ? err.stack : err}`;
    console.error(err);
  });
}
