// Shared by the game and victory.html. The combat engine remains the source of truth.
export function createVictoryScreen(onReplay, perspectiveTeam = null) {
  // The arena loads these scoped styles without changing its HTML.
  if (!document.querySelector('link[href="/victory.css"]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/victory.css';
    document.head.append(stylesheet);
  }
  const screen = document.createElement('dialog');
  screen.className = 'victory';
  screen.setAttribute('aria-labelledby', 'victory-title');
  screen.setAttribute('aria-describedby', 'victory-message');
  screen.innerHTML = `
    <div class="victory-content">
      <a class="victory-brand" href="/">out-mathed</a>
      <p class="victory-kicker">ROUND COMPLETE</p>
      <div class="victory-medal" aria-hidden="true">
        <svg viewBox="0 0 120 120" fill="none">
          <path d="M35 26H17v12c0 18 12 25 28 25m40-37h18v12c0 18-12 25-28 25" stroke="#173e59" stroke-width="12"/>
          <path d="M35 26H17v12c0 18 12 25 28 25m40-37h18v12c0 18-12 25-28 25" stroke="#ffc74e" stroke-width="6"/>
          <path d="M34 16h52v29c0 17-11 29-26 29S34 62 34 45Z" fill="#ffce59" stroke="#173e59" stroke-width="5"/>
          <path d="M43 24v20c0 12 6 20 13 22" stroke="#fff4b7" stroke-width="6" stroke-linecap="round"/>
          <path d="M60 75v18m-21 11h42l-5-11H44Z" fill="#ffce59" stroke="#173e59" stroke-width="5" stroke-linejoin="round"/>
          <path d="m60 31 4 8 9 1-7 6 2 9-8-4-8 4 2-9-7-6 9-1Z" fill="#fff8e8"/>
        </svg>
      </div>
      <div class="victory-loss-mark" aria-hidden="true">f(x)</div>
      <h2 id="victory-title">Victory!</h2>
      <p class="victory-team"></p>
      <p id="victory-message"></p>
      <dl class="victory-stats">
        <div><dt>Round time</dt><dd data-stat="time"></dd></div>
        <div><dt>Shots fired</dt><dd data-stat="shots"></dd></div>
        <div><dt>Survivors</dt><dd data-stat="survivors"></dd></div>
      </dl>
      <button class="victory-replay" type="button" autofocus>Play again <span aria-hidden="true">↗</span></button>
      <a class="victory-home" href="/">Main menu</a>
      <p class="victory-note">A little maths. A mighty comeback.</p>
    </div>`;
  document.body.append(screen);
  const replay = screen.querySelector('button');
  replay.addEventListener('click', () => { screen.close(); onReplay(); });
  // Keep the finished round behind the modal until the player chooses an action.
  screen.addEventListener('cancel', (event) => event.preventDefault());
  return {
    show(round) {
      if (!round.result || screen.open) return;
      const winner = round.result.winner;
      const draw = winner === 'Draw';
      const viewingTeam = typeof perspectiveTeam === 'function' ? perspectiveTeam() : perspectiveTeam;
      const lost = !draw && viewingTeam && viewingTeam !== winner;
      const displayTeam = lost ? viewingTeam : winner;
      const team = displayTeam === 'Blue' ? 0 : 1;
      const survivors = round.players.filter((player) => !player.eliminated && player.team === team).length;
      const seconds = Math.floor(round.time);
      screen.dataset.team = displayTeam.toLowerCase();
      screen.dataset.outcome = draw ? 'draw' : lost ? 'loss' : 'win';
      screen.querySelector('h2').textContent = draw ? 'What a match!' : lost ? 'Good try!' : 'Victory!';
      screen.querySelector('.victory-team').textContent = draw ? 'A draw. An even match.' : lost ? viewingTeam + ' team is out' : winner + ' team wins';
      screen.querySelector('#victory-message').textContent = draw
        ? 'Both teams are out. Settle the score in a rematch!'
        : lost ? 'A new equation could turn the next round around.'
        : 'Brilliant angles. Beautiful win.';
      screen.querySelector('[data-stat="time"]').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      screen.querySelector('[data-stat="shots"]').textContent = round.castCount;
      screen.querySelector('[data-stat="survivors"]').textContent = (draw ? 0 : survivors) + ' / 3';
      replay.firstChild.textContent = lost ? 'Try again ' : 'Play again ';
      screen.querySelector('.victory-note').textContent = lost
        ? 'Every comeback starts with another attempt.' : 'A little maths. A mighty comeback.';
      screen.showModal();
      replay.focus();
      screen.querySelectorAll('.victory-spark').forEach((spark) => spark.remove());
      if (!lost && !draw && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (let i = 0; i < 9; i += 1) {
          const spark = document.createElement('span');
          spark.className = 'victory-spark';
          spark.style.setProperty('--x', (18 + i * 8) + '%');
          spark.style.setProperty('--delay', (i % 3) * 0.12 + 's');
          spark.style.setProperty('--drift', (i % 2 ? 1 : -1) * (24 + i * 7) + 'px');
          spark.addEventListener('animationend', () => spark.remove(), { once: true });
          screen.append(spark);
        }
      }
    },
    hide() { screen.close(); },
  };
}
