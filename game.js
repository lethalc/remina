(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const W = 520, H = 640, shipY = 560;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const storage = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* Storage is optional. */ } }
  };
  let best = clamp(Number(storage.get('neon-drift-best', 0)) || 0, 0, 999999999);
  let muted = storage.get('neon-drift-muted', 'true') !== 'false';
  let mode = 'idle', time = 0, points = 0, lives = 3, level = 1, invincible = 0;
  let shipX = W / 2, shipTilt = 0, targetX = null, pointerId = null;
  let rocks = [], gems = [], particles = [], floaters = [];
  let rockClock = .8, gemClock = 1.6, visualTime = 0, lastFrame = null, shake = 0;
  let audio = null, hudScore = -1, toastTimer;
  const keys = new Set();
  const stars = Array.from({ length: reducedMotion ? 42 : 75 }, () => ({ x: rand(0, W), y: rand(0, H), size: rand(.5, 1.5), speed: rand(8, 35), alpha: rand(.15, .65) }));
  const score = () => Math.floor(time * 10) + points;
  const format = value => String(Math.floor(value)).padStart(5, '0');
  const announce = text => { $('announcer').textContent = text; };

  function unlockAudio() {
    if (muted) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext && !audio) audio = new AudioContext();
      if (audio?.state === 'suspended') audio.resume().catch(() => {});
    } catch { audio = null; }
  }
  function tone(frequency, duration, type = 'sine', volume = .045, delay = 0) {
    if (muted || !audio || audio.state !== 'running') return;
    const start = audio.currentTime + delay, osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    osc.connect(gain); gain.connect(audio.destination); osc.start(start); osc.stop(start + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  function updateSound() {
    $('sound-button').setAttribute('aria-label', muted ? '开启声音' : '关闭声音');
    $('sound-button').setAttribute('aria-pressed', String(!muted));
    $('sound-button').title = muted ? '开启声音' : '关闭声音';
    $('sound-wave').setAttribute('d', muted ? 'm16 9 6 6m0-6-6 6' : 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14');
  }
  function clearInput() { keys.clear(); targetX = null; pointerId = null; }
  function syncHud() {
    const current = score();
    if (current !== hudScore) { $('score').textContent = format(current); hudScore = current; }
    $('level').textContent = `LEVEL ${String(level).padStart(2, '0')}`;
    $('lives').setAttribute('aria-label', `剩余 ${lives} 格护盾`);
    [...$('lives').children].forEach((el, i) => el.classList.toggle('lost', i >= lives));
    $('best-score').textContent = format(best);
  }
  function showOverlay(kicker, title, description, action, hint) {
    $('overlay-kicker').textContent = kicker;
    $('overlay-title').innerHTML = title;
    $('overlay-description').textContent = description;
    $('action-label').textContent = action;
    $('overlay-hint').textContent = hint;
    $('overlay').hidden = false;
    $('action-button').focus({ preventScroll: true });
  }
  function start() {
    clearInput(); unlockAudio();
    time = 0; points = 0; lives = 3; level = 1; invincible = 0;
    shipX = W / 2; shipTilt = 0; rocks = []; gems = []; particles = []; floaters = [];
    rockClock = .8; gemClock = 1.6; shake = 0; lastFrame = null; hudScore = -1;
    clearTimeout(toastTimer); $('level-toast').classList.remove('show');
    mode = 'playing'; $('overlay').hidden = true; $('results').hidden = true;
    $('pause-button').disabled = false; $('pause-button').setAttribute('aria-label', '暂停游戏');
    $('pause-button').title = '暂停游戏（空格）';
    $('pause-icon').innerHTML = '<path d="M8 5v14M16 5v14"/>';
    $('state-label').textContent = '航行中';
    syncHud(); canvas.focus({ preventScroll: true });
    tone(330, .16); tone(495, .2, 'sine', .04, .1); tone(660, .25, 'sine', .03, .2);
    announce('航行开始。左右移动躲避陨石，收集能量。');
  }
  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused'; clearInput();
    $('state-label').textContent = '航行已暂停';
    $('pause-button').setAttribute('aria-label', '继续游戏'); $('pause-button').title = '继续游戏（空格）';
    $('pause-icon').innerHTML = '<path d="m8 5 11 7-11 7Z"/>';
    showOverlay('TAKE A LITTLE BREATH', '星海等你，<br>慢慢来。', '喝口水，回来再继续。', '继续航行', '也可以按空格继续');
    announce('游戏已暂停。');
  }
  function resume() {
    if (mode !== 'paused' || document.hidden) return;
    clearInput(); unlockAudio(); lastFrame = null; mode = 'playing';
    // A brief grace period makes resuming fair even with a rock nearby.
    invincible = Math.max(invincible, .8);
    $('overlay').hidden = true; $('state-label').textContent = '航行中';
    $('pause-button').setAttribute('aria-label', '暂停游戏'); $('pause-button').title = '暂停游戏（空格）';
    $('pause-icon').innerHTML = '<path d="M8 5v14M16 5v14"/>';
    canvas.focus({ preventScroll: true }); announce('继续航行。');
  }
  function finish() {
    mode = 'over'; clearInput(); $('pause-button').disabled = true;
    const current = score(), newBest = current > best;
    if (newBest) { best = current; storage.set('neon-drift-best', best); }
    syncHud(); $('state-label').textContent = '本次航行结束';
    $('final-score').textContent = current; $('final-time').textContent = `${Math.floor(time)}s`;
    $('results').hidden = false;
    showOverlay(newBest ? 'A NEW PERSONAL BEST!' : 'EVERY FLIGHT COUNTS', newBest ? '漂亮，<br>新纪录！' : '这次很棒，<br>再来一局？', newBest ? '你把自己又甩在了身后。' : '下一片星海，也许能飞得更远。', '再次挑战', '按 Enter，再出发');
    tone(220, .25, 'triangle'); tone(165, .4, 'triangle', .04, .17);
    announce(`挑战结束。得分 ${current}，航行 ${Math.floor(time)} 秒。${newBest ? '创造了新纪录。' : ''}`);
  }
  function makeRock(x, y, radius) {
    return { x, y, r: radius, speed: rand(130, 185) + Math.min(time * 3, 210), rotation: rand(0, 6.28), spin: rand(-.6, .6), shape: Array.from({ length: 9 }, () => rand(.78, 1.12)) };
  }
  function burst(x, y, color, count) {
    for (let i = 0; i < (reducedMotion ? 5 : count); i++) {
      const angle = rand(0, Math.PI * 2), speed = rand(25, 150);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(.3, .7), max: .7, color, size: rand(1, 3) });
    }
  }
  function update(dt) {
    time += dt; invincible = Math.max(0, invincible - dt); shake = Math.max(0, shake - dt * 28);
    const oldX = shipX;
    const direction = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    if (direction) { targetX = null; shipX += direction * 380 * dt; }
    else if (targetX !== null) shipX += clamp(targetX - shipX, -430 * dt, 430 * dt);
    shipX = clamp(shipX, 24, W - 24); shipTilt += ((shipX - oldX) * .045 - shipTilt) * Math.min(1, dt * 12);
    const nextLevel = Math.floor(time / 15) + 1;
    if (nextLevel !== level) {
      level = nextLevel; $('level-toast').textContent = `LEVEL ${String(level).padStart(2, '0')} · 加速前进`;
      $('level-toast').classList.add('show'); clearTimeout(toastTimer);
      toastTimer = setTimeout(() => $('level-toast').classList.remove('show'), 1800);
      tone(550, .15); tone(730, .2, 'sine', .035, .1); announce(`进入第 ${level} 级，陨石速度加快。`);
    }
    rockClock -= dt; gemClock -= dt;
    if (rockClock <= 0) {
      rocks.push(makeRock(rand(30, W - 30), -40, rand(15, 28)));
      // One asteroid per wave and a capped rate preserve navigable gaps.
      rockClock = Math.max(.37, .85 - time * .006) * rand(.85, 1.15);
    }
    if (gemClock <= 0) {
      let gemX = rand(36, W - 36);
      const nearby = rocks.filter(rock => rock.y < 50);
      for (let i = 0; i < 8 && nearby.some(rock => Math.abs(rock.x - gemX) < rock.r + 45); i++) gemX = rand(36, W - 36);
      gems.push({ x: gemX, y: -24, speed: 145 + Math.min(time * 2, 150), phase: rand(0, 6.28) });
      gemClock = rand(1.5, 2.1);
    }
    for (const rock of rocks) {
      rock.y += rock.speed * dt; rock.rotation += rock.spin * dt;
      if (invincible <= 0 && Math.hypot(rock.x - shipX, rock.y - shipY) < rock.r * .8 + 11) {
        rock.y = H + 100; lives--; invincible = 1.5; shake = reducedMotion ? 0 : 5;
        burst(shipX, shipY, '#ef9e79', 22); tone(85, .22, 'sawtooth', .045);
        announce(`受到撞击，剩余 ${lives} 格护盾。`);
        if (lives <= 0) { finish(); return; }
      }
    }
    for (const gem of gems) {
      gem.y += gem.speed * dt;
      if (Math.hypot(gem.x - shipX, gem.y - shipY) < 26) {
        points += 50; burst(gem.x, gem.y, '#bff57a', 16);
        floaters.push({ x: gem.x, y: gem.y - 10, life: .85, text: '+50' });
        gem.y = H + 100; tone(880, .12); tone(1320, .15, 'sine', .03, .065);
      }
    }
    rocks = rocks.filter(rock => rock.y < H + 60); gems = gems.filter(gem => gem.y < H + 40);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    for (const f of floaters) { f.y -= dt * 40; f.life -= dt; }
    floaters = floaters.filter(f => f.life > 0); syncHud();
  }
  function drawShip(x, y, tilt = 0, ghost = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
    if (!ghost && invincible > 0 && Math.floor(visualTime * 14) % 2) ctx.globalAlpha = .35;
    ctx.fillStyle = '#c3f578'; ctx.shadowColor = '#b3f37b'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(0, -23); ctx.lineTo(18, 15); ctx.lineTo(0, 8); ctx.lineTo(-18, 15); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#304936'; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(6, 5); ctx.lineTo(0, 2); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d1ffb0'; ctx.shadowColor = '#a4ed77'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(-4, 13); ctx.lineTo(0, 24 + Math.sin(visualTime * 32) * 5); ctx.lineTo(4, 13); ctx.fill();
    ctx.restore();
    if (!ghost && invincible > 0) { ctx.save(); ctx.strokeStyle = '#c3f57870'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 31, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  }
  function drawRock(rock) {
    ctx.save(); ctx.translate(rock.x, rock.y); ctx.rotate(rock.rotation); ctx.beginPath();
    rock.shape.forEach((size, i) => { const a = i / rock.shape.length * Math.PI * 2, x = Math.cos(a) * rock.r * size, y = Math.sin(a) * rock.r * size; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fillStyle = '#302c2b'; ctx.strokeStyle = '#bf866e'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-rock.r * .2, -rock.r * .15, rock.r * .25, 0, Math.PI * 2); ctx.strokeStyle = '#76584b'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rock.r * .15, rock.r * .25); ctx.lineTo(rock.r * .5, rock.r * .16); ctx.stroke(); ctx.restore();
  }
  function drawGem(gem) {
    ctx.save(); ctx.translate(gem.x, gem.y); ctx.rotate(Math.sin(visualTime * 2 + gem.phase) * .15);
    ctx.shadowColor = '#a3ecc9'; ctx.shadowBlur = 15; ctx.strokeStyle = '#bdf6cc'; ctx.fillStyle = '#274a3c'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 0); ctx.lineTo(0, 11); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#b7efd080'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke(); ctx.restore();
  }
  const demoRocks = [makeRock(76, 130, 23), makeRock(440, 330, 28), makeRock(120, 452, 17), makeRock(390, 60, 15)];
  function draw(dt) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = '#080f13'; ctx.fillRect(0, 0, W, H);
    // A restrained navigational grid and a soft engine-light pool.
    ctx.strokeStyle = '#819e8c08'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 52) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = (visualTime * 15) % 52; y < H; y += 52) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const glow = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, 380); glow.addColorStop(0, '#507e2b13'); glow.addColorStop(1, '#507e2b00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    const backgroundMoving = mode !== 'paused' && mode !== 'over';
    for (const star of stars) {
      if (backgroundMoving && !reducedMotion) { star.y += star.speed * dt * (mode === 'playing' ? 1.8 : .5); if (star.y > H) star.y = 0; }
      ctx.fillStyle = `rgba(195,217,207,${star.alpha})`; ctx.fillRect(star.x, star.y, star.size, star.size * (mode === 'playing' ? 2 : 1));
    }
    ctx.save(); if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    if (mode === 'idle') {
      for (const rock of demoRocks) { const demo = { ...rock, y: (rock.y + visualTime * (reducedMotion ? 0 : 12)) % (H + 80) - 40, rotation: rock.rotation + visualTime * .07 }; drawRock(demo); }
      drawGem({ x: 412, y: 480 + Math.sin(visualTime) * 8, phase: 0 }); drawGem({ x: 110, y: 275, phase: 1 });
      drawShip(W / 2, shipY, 0, true);
    } else {
      rocks.forEach(drawRock); gems.forEach(drawGem);
      for (const p of particles) { ctx.globalAlpha = Math.min(1, p.life / .3); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
      ctx.globalAlpha = 1;
      if (mode !== 'over') drawShip(shipX, shipY, reducedMotion ? 0 : shipTilt);
      for (const f of floaters) { ctx.globalAlpha = Math.min(1, f.life * 2); ctx.fillStyle = '#c3f578'; ctx.font = '16px Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y); }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function frame(timestamp) {
    const dt = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, .04); lastFrame = timestamp;
    if (mode !== 'paused' && mode !== 'over') visualTime += dt;
    if (mode === 'playing') update(dt);
    draw(dt); requestAnimationFrame(frame);
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr);
  }
  $('action-button').addEventListener('click', () => mode === 'paused' ? resume() : start());
  $('pause-button').addEventListener('click', () => mode === 'playing' ? pause() : resume());
  $('sound-button').addEventListener('click', () => { muted = !muted; storage.set('neon-drift-muted', muted); updateSound(); unlockAudio(); tone(660, .14); });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(key)) {
      if (mode === 'playing') { event.preventDefault(); keys.add(key); }
    } else if ((key === ' ' || key === 'Escape' || key === 'p') && !event.repeat) {
      if (key === ' ' && event.target.closest?.('button, a')) return;
      if (mode === 'playing') { event.preventDefault(); pause(); }
      else if (mode === 'paused') { event.preventDefault(); resume(); }
    } else if (key === 'Enter' && !event.repeat && !event.target.closest?.('button, a')) {
      if (mode === 'idle' || mode === 'over') { event.preventDefault(); start(); }
      else if (mode === 'paused') { event.preventDefault(); resume(); }
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
  canvas.addEventListener('pointerdown', event => {
    if (mode !== 'playing' || pointerId !== null) return;
    event.preventDefault(); pointerId = event.pointerId; canvas.setPointerCapture(pointerId);
    const rect = canvas.getBoundingClientRect(); targetX = clamp((event.clientX - rect.left) / rect.width * W, 24, W - 24);
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', event => {
    if (mode !== 'playing' || pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect(); targetX = clamp((event.clientX - rect.left) / rect.width * W, 24, W - 24);
  });
  const releasePointer = event => { if (pointerId === event.pointerId) { pointerId = null; targetX = null; } };
  canvas.addEventListener('pointerup', releasePointer); canvas.addEventListener('pointercancel', releasePointer); canvas.addEventListener('lostpointercapture', releasePointer);
  window.addEventListener('blur', () => { clearInput(); pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); pause(); } });
  new ResizeObserver(resize).observe(canvas); resize(); syncHud(); updateSound(); requestAnimationFrame(frame);
})();
