/* Rubik Matrix Lab — UI, canvas renderer, solver worker bridge */
(function () {
  'use strict';

  var RM = window.RubikMatrix;
  if (!RM) return;

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var INITIAL_SCRAMBLE = "R U R' U' F2 L D2 B' R2 U2 L' B2 D' F' L2 U B2 D2 R'";

  var state = {
    cube: RM.solvedState(),
    base: RM.solvedState(),
    solution: [],
    phase1Length: 0,
    step: 0,
    prefixes: [],
    scramble: INITIAL_SCRAMBLE,
    lastMove: null,
    selectedMove: 'U',
    tab: 'faces',
    anim: null,
    playing: false,
    playToken: 0,
    solverReady: false,
    solverInitMs: 0,
    solving: false,
    currentRequestId: null,
    pendingFacelets: null,
    pendingSolveAfterReady: false,
    solveSeq: 0,
    userInteracted: false,
    hoverPerm: null,
    hoverFace: null,
    autoSolveTimer: null,
    initTimer: null,
    cubeStats: { solvedFaces: 6 }
  };

  var solver = {
    worker: null,
    ready: false,
    initStarted: 0,
    blobUrl: null
  };

  var cubeCanvas, cubeCtx, cubeStage, cubeWrapRect = null;
  var permCanvas, permCtx, permWrap;
  var view = { yaw: -0.62, pitch: 0.36, zoom: 1 };
  var drag = null;
  var cubeDpr = 1;
  var paint = { cells: RM.solvedState(), color: 'U', dragging: false, open: false, lastFocus: null, mode: '3d' };
  var paint3dCanvas, paint3dCtx, paint3dWrap;
  var paint3dDpr = 1, paint3dGeom = null, paintHitAreas = [], paintHoverIndex = -1, paint3dDrag = null;
  var paintView = { yaw: -0.62, pitch: 0.36, zoom: 1 };
  var paintTmp = [0, 0, 0];

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  function init() {
    cubeCanvas = $('cubeCanvas');
    cubeCtx = cubeCanvas.getContext('2d');
    cubeStage = $('cubeStage');
    permCanvas = $('permCanvas');
    permCtx = permCanvas.getContext('2d');
    permWrap = permCanvas.parentElement;
    paint3dCanvas = $('paint3dCanvas');
    paint3dCtx = paint3dCanvas.getContext('2d');
    paint3dWrap = $('paint3dWrap');

    buildMoveGrid();
    buildSliceGrid();
    buildFaceNet();
    buildFaceLegend();
    buildVectorGrid();
    buildMoveSelect();
    buildMiniVector();
    buildPaintPalette();
    buildPaintNet();
    bindUI();
    bindPaintUI();
    bindCubeInteraction();
    bindCanvasObservers();
    bindPermHover();
    resizeCubeCanvas();

    var scrambled = RM.applyMoves(RM.solvedState(), RM.parseMoves(INITIAL_SCRAMBLE));
    state.cube = scrambled;
    state.base = scrambled.slice();
    state.prefixes = [scrambled.slice()];
    $('scrambleInput').value = INITIAL_SCRAMBLE;

    renderAll();
    setTab('faces');
    initSolver();

    // Auto-solve the initial example once the worker is ready.
    state.autoSolveTimer = setTimeout(function () {
      if (!state.userInteracted) requestSolve(true);
    }, 500);
  }

  /* ---------------------------------------------------------------- */
  /* DOM construction                                                  */
  /* ---------------------------------------------------------------- */

  function buildMoveGrid() {
    var grid = $('moveGrid');
    var rows = [
      { suffix: '', label: 'CW' },
      { suffix: "'", label: 'CCW' },
      { suffix: '2', label: '180' }
    ];
    var html = '';
    rows.forEach(function (row) {
      ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (face) {
        var move = face + row.suffix;
        html += '<button type="button" class="move-btn f-' + face + '" data-move="' + move + '" title="' + RM.describeMove(move) + '">' +
          '<span>' + move + '</span><small>' + row.label + '</small></button>';
      });
    });
    grid.innerHTML = html;
  }

  function buildSliceGrid() {
    var grid = $('sliceMoveGrid');
    var rows = [
      { suffix: '', label: 'CW' },
      { suffix: "'", label: 'CCW' },
      { suffix: '2', label: '180' }
    ];
    var html = '';
    rows.forEach(function (row) {
      ['M', 'E', 'S'].forEach(function (face) {
        var move = face + row.suffix;
        html += '<button type="button" class="move-btn f-' + face + '" data-move="' + move + '" title="' + RM.describeMove(move) + '">' +
          '<span>' + move + '</span><small>' + row.label + '</small></button>';
      });
    });
    grid.innerHTML = html;
  }

  function buildFaceNet() {
    var net = $('faceNet');
    var order = ['U', 'L', 'F', 'R', 'B', 'D'];
    var html = '';
    order.forEach(function (face) {
      html += '<div class="face-tile" data-face="' + face + '">' +
        '<div class="face-tile-label"><b>M<sub>' + face + '</sub></b><span>' + RM.COLOR_NAMES[face] + '</span></div>' +
        '<div class="face-grid">';
      for (var i = 0; i < 9; i++) {
        var index = RM.FACE_INDEX[face] * 9 + i;
        html += '<div class="face-cell" data-index="' + index + '" data-face="' + face + '"></div>';
      }
      html += '</div></div>';
    });
    net.innerHTML = html;
  }

  function buildFaceLegend() {
    var el = $('faceLegend');
    var html = '';
    RM.FACES.forEach(function (face) {
      html += '<span class="legend-chip"><i style="background:' + RM.COLORS[face] + '"></i>' + face + ' · ' + RM.COLOR_NAMES[face] + '</span>';
    });
    el.innerHTML = html;
  }

  function buildVectorGrid() {
    var grid = $('vectorGrid');
    var html = '';
    RM.FACES.forEach(function (face) {
      html += '<div class="vector-row"><span class="vector-row-label">' + face + '</span>';
      for (var i = 0; i < 9; i++) {
        var index = RM.FACE_INDEX[face] * 9 + i;
        html += '<div class="vector-cell" data-index="' + index + '" title="x[' + index + ']"></div>';
      }
      html += '</div>';
    });
    grid.innerHTML = html;
  }

  function buildMoveSelect() {
    var select = $('moveSelect');
    var html = '';
    RM.ALL_MOVES.forEach(function (move) {
      html += '<option value="' + move + '">' + matrixLabel(move) + '</option>';
    });
    select.innerHTML = html;
    select.value = state.selectedMove;
  }

  function buildMiniVector() {
    var el = $('miniVector');
    var html = '';
    for (var i = 0; i < 54; i++) html += '<i></i>';
    el.innerHTML = html;
  }

  function buildPaintPalette() {
    var html = '';
    RM.FACES.forEach(function (face) {
      html += '<button type="button" class="paint-swatch" data-color="' + face + '" ' +
        'style="--c:' + RM.COLORS[face] + '" aria-pressed="false" title="选择 ' + RM.COLOR_NAMES[face] + ' 色">' +
        '<i></i><span>' + face + '</span><small>' + RM.COLOR_NAMES[face] + '</small></button>';
    });
    $('paintPalette').innerHTML = html;
  }

  function buildPaintNet() {
    var order = ['U', 'L', 'F', 'R', 'B', 'D'];
    var html = '';
    order.forEach(function (face) {
      html += '<div class="paint-face" data-face="' + face + '">' +
        '<div class="paint-face-label"><b>' + face + '</b><span>' + RM.COLOR_NAMES[face] + '</span></div>' +
        '<div class="paint-grid">';
      for (var i = 0; i < 9; i++) {
        var index = RM.FACE_INDEX[face] * 9 + i;
        html += '<div class="paint-cell" data-index="' + index + '" data-face="' + face + '"></div>';
      }
      html += '</div></div>';
    });
    $('paintNet').innerHTML = html;
  }

  function matrixLabel(move) {
    return 'P(' + move + ')';
  }

  /* ---------------------------------------------------------------- */
  /* UI events                                                         */
  /* ---------------------------------------------------------------- */

  function bindUI() {
    $('moveGrid').addEventListener('click', function (event) {
      var btn = event.target.closest('.move-btn');
      if (!btn || state.anim) return;
      manualMove(btn.getAttribute('data-move'));
    });

    $('sliceMoveGrid').addEventListener('click', function (event) {
      var btn = event.target.closest('.move-btn');
      if (!btn || state.anim) return;
      manualMove(btn.getAttribute('data-move'));
    });

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setTab(tab.getAttribute('data-tab')); });
    });

    $('btnResetView').addEventListener('click', function () {
      view.yaw = -0.62;
      view.pitch = 0.36;
      view.zoom = 1;
      renderCube();
      toast('视角已重置');
    });

    $('btnApply').addEventListener('click', applyScrambleInput);
    $('scrambleInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); applyScrambleInput(); }
    });

    $('btnRandom').addEventListener('click', function () {
      var moves = RM.randomScramble(20);
      setScramble(moves, true);
    });

    $('btnSolved').addEventListener('click', function () {
      if (state.anim) { toast('等待当前转动完成'); return; }
      cancelPendingSolve();
      state.userInteracted = true;
      state.cube = RM.solvedState();
      state.base = state.cube.slice();
      state.solution = [];
      state.phase1Length = 0;
      state.step = 0;
      state.prefixes = [state.cube.slice()];
      state.lastMove = null;
      state.scramble = '';
      $('scrambleInput').value = '';
      syncSelectedMove('U');
      renderSolution();
      renderAll();
      setReadyBadge();
      toast('已回到复原状态');
    });

    $('btnSolve').addEventListener('click', function () {
      state.userInteracted = true;
      requestSolve(false);
    });

    $('btnPrev').addEventListener('click', function () {
      if (state.anim) return;
      stopPlayback();
      if (state.solution.length) jumpToStep(state.step - 1);
    });
    $('btnNext').addEventListener('click', function () {
      if (state.anim) return;
      stopPlayback();
      if (state.solution.length) jumpToStep(state.step + 1);
    });
    $('btnPlay').addEventListener('click', togglePlayback);

    $('stepSlider').addEventListener('input', function (event) {
      if (state.anim) return;
      stopPlayback();
      jumpToStep(parseInt(event.target.value, 10), true);
    });

    $('solutionBody').addEventListener('click', function (event) {
      var chip = event.target.closest('.move-chip');
      if (!chip) return;
      stopPlayback();
      jumpToStep(parseInt(chip.getAttribute('data-target'), 10), true);
    });

    $('btnCopy').addEventListener('click', copySolution);
    $('moveSelect').addEventListener('change', function (event) {
      state.selectedMove = event.target.value;
      state.hoverPerm = null;
      renderPermutation();
      updateCaption();
    });
    $('btnCycleMove').addEventListener('click', function () {
      var i = RM.ALL_MOVES.indexOf(state.selectedMove);
      syncSelectedMove(RM.ALL_MOVES[(i + 1) % RM.ALL_MOVES.length]);
      toast('当前矩阵：' + matrixLabel(state.selectedMove));
    });

    $('faceNet').addEventListener('pointerover', function (event) {
      var cell = event.target.closest('.face-cell');
      if (!cell) return;
      var index = parseInt(cell.getAttribute('data-index'), 10);
      var info = RM.CELLS[index];
      var matrix = 'M_' + info.face;
      $('matrixCaption').innerHTML = '<b>' + matrix + '[' + (info.r + 1) + '][' + (info.c + 1) + ']</b> · 索引 x[' + index + '] = ' + state.cube[index] + '（' + RM.COLOR_NAMES[state.cube[index]] + '）';
    });
    $('faceNet').addEventListener('pointerout', function (event) {
      if (!event.relatedTarget || !event.relatedTarget.closest || !event.relatedTarget.closest('.face-cell')) updateCaption();
    });

    $('vectorGrid').addEventListener('pointerover', function (event) {
      var cell = event.target.closest('.vector-cell');
      if (!cell) return;
      var index = parseInt(cell.getAttribute('data-index'), 10);
      $('matrixCaption').innerHTML = '<b>x[' + index + ']</b> = ' + state.cube[index] + '（' + RM.COLOR_NAMES[state.cube[index]] + '） · ' + RM.CELLS[index].face + ' 面第 ' + (RM.CELLS[index].r + 1) + ' 行';
    });
    $('vectorGrid').addEventListener('pointerout', function () {
      updateCaption();
    });

    document.addEventListener('keydown', function (event) {
      if (event.target && /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stopPlayback();
        if (state.solution.length) jumpToStep(state.step - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stopPlayback();
        if (state.solution.length) jumpToStep(state.step + 1);
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Paint mode                                                        */
  /* ---------------------------------------------------------------- */

  function bindPaintUI() {
    $('btnPaint').addEventListener('click', openPaint);
    $('btnPaintClose').addEventListener('click', closePaint);
    $('btnPaintCancel').addEventListener('click', closePaint);
    $('paintOverlay').addEventListener('pointerdown', function (event) {
      if (event.target === $('paintOverlay')) closePaint();
    });

    $('paintPalette').addEventListener('click', function (event) {
      var swatch = event.target.closest('.paint-swatch');
      if (!swatch) return;
      paint.color = swatch.getAttribute('data-color');
      updatePaintPalette();
    });

    $('paintNet').addEventListener('pointerdown', function (event) {
      var cell = event.target.closest('.paint-cell');
      if (!cell) return;
      event.preventDefault();
      if (cell.classList.contains('is-center')) {
        toast('中心块固定，不能上色');
        return;
      }
      paint.dragging = true;
      try { $('paintNet').setPointerCapture(event.pointerId); } catch (err) {}
      paintCell(cell);
    });

    $('paintNet').addEventListener('pointermove', function (event) {
      if (!paint.dragging) return;
      var hit = document.elementFromPoint(event.clientX, event.clientY);
      var cell = hit && hit.closest ? hit.closest('.paint-cell') : null;
      if (cell) paintCell(cell);
    });

    var endPaintDrag = function (event) {
      if (!paint.dragging) return;
      paint.dragging = false;
      try { $('paintNet').releasePointerCapture(event.pointerId); } catch (err) {}
    };
    $('paintNet').addEventListener('pointerup', endPaintDrag);
    $('paintNet').addEventListener('pointercancel', function () { paint.dragging = false; });

    $('btnPaintRead').addEventListener('click', function () {
      var normalized = RM.normalizeCenters(state.cube);
      paint.cells = normalized.state;
      updatePaintUI();
      toast(normalized.applied ? '已读取当前魔方，并转到标准朝向' : '已读取当前魔方');
    });
    $('btnPaintSolved').addEventListener('click', function () {
      paint.cells = RM.solvedState();
      updatePaintUI();
      toast('已填入复原色');
    });
    $('btnPaintApply').addEventListener('click', function () { applyPaint(false); });
    $('btnPaintSolve').addEventListener('click', function () { applyPaint(true); });

    document.querySelectorAll('.paint-view-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        setPaintView(button.getAttribute('data-paint-view'));
      });
    });
    $('btnPaint3dReset').addEventListener('click', function () {
      paintView.yaw = -0.62;
      paintView.pitch = 0.36;
      paintView.zoom = 1;
      renderPaintCube();
    });
    bindPaint3d();

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && paint.open) {
        event.preventDefault();
        closePaint();
      }
    });
  }

  function openPaint() {
    if (state.anim) { toast('等待当前转动完成'); return; }
    cancelPendingSolve();
    stopPlayback();
    var normalized = RM.normalizeCenters(state.cube);
    paint.cells = normalized.state;
    paint.color = 'U';
    paint.dragging = false;
    paintHoverIndex = -1;
    paint3dDrag = null;
    paint.open = true;
    paint.lastFocus = document.activeElement;
    $('paintOverlay').hidden = false;
    document.body.classList.add('paint-open');
    updatePaintPalette();
    setPaintView(paint.mode);
    updatePaintUI();
    if (normalized.applied) toast('已把魔方转到标准朝向以上色');
    requestAnimationFrame(function () {
      $('btnPaintClose').focus();
      if (paint.mode === '3d') {
        resizePaint3dCanvas();
        renderPaintCube();
      }
    });
  }

  function closePaint() {
    if (!paint.open) return;
    paint.open = false;
    paint.dragging = false;
    paint3dDrag = null;
    paintHoverIndex = -1;
    $('paintOverlay').hidden = true;
    document.body.classList.remove('paint-open');
    if (paint.lastFocus && typeof paint.lastFocus.focus === 'function') {
      paint.lastFocus.focus();
    }
  }

  function updatePaintPalette() {
    document.querySelectorAll('.paint-swatch').forEach(function (swatch) {
      var active = swatch.getAttribute('data-color') === paint.color;
      swatch.classList.toggle('active', active);
      swatch.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setPaintView(mode) {
    paint.mode = mode === 'net' ? 'net' : '3d';
    document.querySelectorAll('.paint-view-btn').forEach(function (button) {
      var active = button.getAttribute('data-paint-view') === paint.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var is3d = paint.mode === '3d';
    $('paint3dWrap').hidden = !is3d;
    $('paintNet').hidden = is3d;
    $('paintViewHint').textContent = is3d ? '拖动旋转 · 点击色块上色' : '点击格子 · 拖动连续上色';
    paintHoverIndex = -1;
    if (is3d) {
      requestAnimationFrame(function () {
        resizePaint3dCanvas();
        renderPaintCube();
      });
    }
  }

  function paintCell(cell) {
    var index = parseInt(cell.getAttribute('data-index'), 10);
    if (isNaN(index) || index % 9 === 4) return;
    if (paint.cells[index] === paint.color) return;
    paint.cells[index] = paint.color;
    updatePaintUI();
  }

  function updatePaintUI() {
    document.querySelectorAll('.paint-cell').forEach(function (el) {
      var index = parseInt(el.getAttribute('data-index'), 10);
      var color = paint.cells[index];
      var center = index % 9 === 4;
      el.textContent = color;
      el.style.background = RM.COLORS[color];
      el.classList.toggle('light-text', color === 'U' || color === 'D');
      el.classList.toggle('is-center', center);
      el.title = center ? (RM.CELLS[index].face + ' 面中心块 · 固定') : ('点击涂成 ' + RM.COLOR_NAMES[paint.color]);
    });

    var counts = RM.colorCounts(paint.cells) || { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
    var countHtml = '';
    RM.FACES.forEach(function (face) {
      countHtml += '<span class="paint-count' + (counts[face] !== 9 ? ' bad' : '') + '">' +
        '<i style="background:' + RM.COLORS[face] + '"></i>' + face + '<b>' + counts[face] + '</b></span>';
    });
    $('paintCounts').innerHTML = countHtml;

    var validation = RM.validateState(paint.cells);
    var status = $('paintStatus');
    var badCounts = RM.FACES.filter(function (face) { return counts[face] !== 9; });
    if (badCounts.length) {
      status.className = 'paint-status bad';
      status.textContent = '颜色数量不对：' + badCounts.map(function (face) {
        return face + ' 色 ' + counts[face] + ' 格';
      }).join('，') + '。每种颜色必须正好 9 格。';
    } else if (!validation.valid) {
      status.className = 'paint-status bad';
      status.textContent = '这个布局不能由转动得到：' + validation.reasons.join('；') + '。';
    } else {
      status.className = 'paint-status ok';
      status.textContent = '合法状态 · 54 个色块 · 每种颜色 9 格 · 可以应用。';
    }
    $('btnPaintApply').disabled = !validation.valid;
    $('btnPaintSolve').disabled = !validation.valid;
    if (paint.open && paint.mode === '3d') renderPaintCube();
  }

  function applyPaint(wantSolve) {
    if (state.anim) { toast('等待当前转动完成'); return; }
    var validation = RM.validateState(paint.cells);
    if (!validation.valid) {
      updatePaintUI();
      toast('布局不合法：' + validation.reasons[0], true);
      return;
    }
    cancelPendingSolve();
    state.userInteracted = true;
    var cells = paint.cells.slice();
    state.cube = cells;
    state.base = cells.slice();
    state.solution = [];
    state.phase1Length = 0;
    state.step = 0;
    state.prefixes = [cells.slice()];
    state.lastMove = null;
    state.scramble = '';
    $('scrambleInput').value = '';
    syncSelectedMove('U');
    renderSolution();
    renderAll();
    setReadyBadge();
    closePaint();
    if (wantSolve) {
      requestSolve(false);
      toast(solver.ready ? '已应用上色，开始求解…' : '已应用上色，求解器就绪后自动求解');
    } else {
      toast('已应用 54 个色块');
    }
  }

  function resizePaint3dCanvas() {
    if (!paint3dWrap) return;
    var rect = paint3dWrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    paint3dDpr = Math.min(window.devicePixelRatio || 1, 2);
    paint3dCanvas.width = Math.round(rect.width * paint3dDpr);
    paint3dCanvas.height = Math.round(rect.height * paint3dDpr);
    paint3dGeom = { w: rect.width, h: rect.height };
  }

  function renderPaintCube() {
    if (!paint3dCtx) return;
    if (!paint3dGeom) resizePaint3dCanvas();
    if (!paint3dGeom) return;
    var w = paint3dGeom.w, h = paint3dGeom.h;
    var ctx = paint3dCtx;
    ctx.setTransform(paint3dDpr, 0, 0, paint3dDpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var cx = w / 2;
    var cy = h * 0.49;
    var scale = Math.min(w, h) * 0.255 * paintView.zoom;
    var f = 6.4;
    var tmp = paintTmp;
    var light = [0.38, 0.72, 0.58];
    var ll = Math.hypot(light[0], light[1], light[2]);
    light[0] /= ll; light[1] /= ll; light[2] /= ll;

    // shadow
    var shadow = ctx.createRadialGradient(cx, cy + scale * 2.1, 2, cx, cy + scale * 2.1, scale * 1.8);
    shadow.addColorStop(0, 'rgba(0,0,0,.5)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(cx, cy + scale * 2.1, scale * 1.8, scale * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // dark core
    CORE_FACES.forEach(function (face) {
      var n = face.normal;
      var corners;
      if (n[0] !== 0) corners = [[n[0] * 0.982, -1, -1], [n[0] * 0.982, -1, 1], [n[0] * 0.982, 1, 1], [n[0] * 0.982, 1, -1]];
      else if (n[1] !== 0) corners = [[-1, n[1] * 0.982, -1], [1, n[1] * 0.982, -1], [1, n[1] * 0.982, 1], [-1, n[1] * 0.982, 1]];
      else corners = [[-1, -1, n[2] * 0.982], [1, -1, n[2] * 0.982], [1, 1, n[2] * 0.982], [-1, 1, n[2] * 0.982]];
      var projected = corners.map(function (p) {
        projectPoint(p, paintView.yaw, paintView.pitch, tmp);
        var persp = f / (f - tmp[2]);
        return [cx + tmp[0] * scale * persp, cy - tmp[1] * scale * persp];
      });
      roundedPolygon(ctx, projected, 5);
      ctx.fillStyle = '#05080d';
      ctx.fill();
    });

    var items = [];
    STICKERS.forEach(function (sticker) {
      var corners = baseQuad(sticker.renderPos, sticker.normal, 0.302);
      var projected = [];
      var depth = 0;
      corners.forEach(function (p) {
        projectPoint(p, paintView.yaw, paintView.pitch, tmp);
        var persp = f / (f - tmp[2]);
        projected.push([cx + tmp[0] * scale * persp, cy - tmp[1] * scale * persp]);
        depth += tmp[2];
      });
      projectPoint(sticker.normal, paintView.yaw, paintView.pitch, tmp);
      if (tmp[2] < 0.02) return;
      var lightValue = Math.max(0, tmp[0] * light[0] + tmp[1] * light[1] + tmp[2] * light[2]);
      items.push({
        index: sticker.index,
        projected: projected,
        depth: depth / 4,
        color: paint.cells[sticker.index],
        light: lightValue,
        center: sticker.index % 9 === 4
      });
    });
    items.sort(function (a, b) { return a.depth - b.depth; });
    paintHitAreas = items.slice().reverse();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    items.forEach(function (item) {
      roundedPolygon(ctx, item.projected, 5.5);
      ctx.fillStyle = shade(RM.COLORS[item.color], 0.72 + 0.34 * item.light);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // bevel
      ctx.beginPath();
      ctx.moveTo(item.projected[0][0], item.projected[0][1]);
      ctx.lineTo(item.projected[3][0], item.projected[3][1]);
      ctx.strokeStyle = 'rgba(255,255,255,.13)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (item.center) {
        var mx = (item.projected[0][0] + item.projected[1][0] + item.projected[2][0] + item.projected[3][0]) / 4;
        var my = (item.projected[0][1] + item.projected[1][1] + item.projected[2][1] + item.projected[3][1]) / 4;
        ctx.beginPath();
        ctx.arc(mx, my, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.fill();
      }

      if (item.index === paintHoverIndex) {
        ctx.save();
        roundedPolygon(ctx, item.projected, 5.5);
        ctx.strokeStyle = 'rgba(234,255,247,.95)';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#7cf5c8';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();
      }
    });

    var cursor = paintHoverIndex >= 0 ? 'pointer' : 'grab';
    paint3dCanvas.style.cursor = cursor;
  }

  function pointInPolygon(x, y, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i][0], yi = polygon[i][1];
      var xj = polygon[j][0], yj = polygon[j][1];
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function paintHitTest(x, y) {
    for (var i = 0; i < paintHitAreas.length; i++) {
      if (pointInPolygon(x, y, paintHitAreas[i].projected)) return paintHitAreas[i];
    }
    return null;
  }

  function paintCanvasPoint(event) {
    if (!paint3dGeom) return null;
    var rect = paint3dCanvas.getBoundingClientRect();
    if (!rect.width) return null;
    return {
      x: (event.clientX - rect.left) * (paint3dGeom.w / rect.width),
      y: (event.clientY - rect.top) * (paint3dGeom.h / rect.height)
    };
  }

  function paintStickerIndex(index) {
    if (index % 9 === 4) {
      toast('中心块固定，不能上色');
      return;
    }
    if (paint.cells[index] === paint.color) return;
    paint.cells[index] = paint.color;
    updatePaintUI();
  }

  function bindPaint3d() {
    var canvas = paint3dCanvas;
    if (!canvas) return;

    canvas.addEventListener('pointerdown', function (event) {
      if (!paint.open || paint.mode !== '3d') return;
      event.preventDefault();
      paint3dDrag = {
        x: event.clientX,
        y: event.clientY,
        yaw: paintView.yaw,
        pitch: paintView.pitch,
        moved: false,
        pointerId: event.pointerId
      };
      try { canvas.setPointerCapture(event.pointerId); } catch (err) {}
    });

    canvas.addEventListener('pointermove', function (event) {
      if (paint3dDrag) {
        var dx = event.clientX - paint3dDrag.x;
        var dy = event.clientY - paint3dDrag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) paint3dDrag.moved = true;
        if (paint3dDrag.moved) {
          paintView.yaw = paint3dDrag.yaw + dx * 0.0075;
          paintView.pitch = clamp(paint3dDrag.pitch + dy * 0.006, -1.12, 1.12);
          paintHoverIndex = -1;
          renderPaintCube();
        }
        return;
      }
      if (!paint.open || paint.mode !== '3d' || !paint3dGeom) return;
      var pt = paintCanvasPoint(event);
      if (!pt) return;
      var hit = paintHitTest(pt.x, pt.y);
      var next = hit ? hit.index : -1;
      if (next !== paintHoverIndex) {
        paintHoverIndex = next;
        renderPaintCube();
      }
    });

    canvas.addEventListener('pointerup', function (event) {
      if (!paint3dDrag) return;
      var drag = paint3dDrag;
      paint3dDrag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) {}
      if (drag.moved) return;
      var pt = paintCanvasPoint(event);
      if (!pt) return;
      var hit = paintHitTest(pt.x, pt.y);
      if (hit) paintStickerIndex(hit.index);
    });

    canvas.addEventListener('pointercancel', function () {
      paint3dDrag = null;
    });

    canvas.addEventListener('pointerleave', function () {
      if (!paint3dDrag && paintHoverIndex >= 0) {
        paintHoverIndex = -1;
        renderPaintCube();
      }
    });

    canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      paintView.zoom = clamp(paintView.zoom * (1 - event.deltaY * 0.0009), 0.72, 1.5);
      renderPaintCube();
    }, { passive: false });

  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
    });
    if (tab === 'perm') {
      requestAnimationFrame(function () {
        resizePermCanvas();
        renderPermutation();
      });
    }
    updateCaption();
  }

  /* ---------------------------------------------------------------- */
  /* Cube state and solution                                           */
  /* ---------------------------------------------------------------- */

  function setScramble(moves, animate) {
    if (state.anim) { toast('等待当前转动完成'); return; }
    cancelPendingSolve();
    state.userInteracted = true;
    var text = RM.movesToString(moves);
    state.scramble = text;
    $('scrambleInput').value = text;
    state.base = RM.applyMoves(RM.solvedState(), moves);
    state.cube = state.base.slice();
    state.solution = [];
    state.phase1Length = 0;
    state.step = 0;
    state.prefixes = [state.base.slice()];
    state.lastMove = null;
    renderSolution();
    renderAll();
    setReadyBadge();
    if (!animate && moves.length) toast('已应用打乱 · ' + moves.length + ' 步');
    else if (moves.length) toast('已随机打乱 · ' + moves.length + ' 步');
  }

  function applyScrambleInput() {
    var raw = $('scrambleInput').value.trim();
    if (!raw) {
      setScramble([], false);
      return;
    }
    var moves;
    try {
      moves = RM.parseMoves(raw);
    } catch (err) {
      toast(err.message, true);
      return;
    }
    if (!moves.length) {
      toast('请输入有效的转动序列', true);
      return;
    }
    setScramble(moves, false);
  }

  function manualMove(move) {
    if (state.anim) return;
    cancelPendingSolve();
    state.userInteracted = true;
    stopPlayback();
    if (state.solution.length) {
      state.solution = [];
      state.phase1Length = 0;
      state.step = 0;
      state.prefixes = [state.cube.slice()];
      state.base = state.cube.slice();
      renderSolution();
      setReadyBadge();
    }
    syncSelectedMove(move);
    animateMove(move).then(function () {
      state.base = state.cube.slice();
      state.prefixes = [state.cube.slice()];
      state.solution = [];
      state.step = 0;
      state.phase1Length = 0;
      renderAll();
    });
  }

  function jumpToStep(step, syncMove) {
    if (!state.solution.length || state.anim) return;
    if (state.solving) cancelPendingSolve();
    step = clamp(step, 0, state.solution.length);
    state.step = step;
    state.cube = state.prefixes[step].slice();
    state.lastMove = step > 0 ? state.solution[step - 1] : null;
    if (syncMove && state.lastMove) syncSelectedMove(state.lastMove);
    renderAll();
  }

  function syncSelectedMove(move) {
    state.selectedMove = move;
    var select = $('moveSelect');
    if (select) select.value = move;
    if (state.tab === 'perm') {
      state.hoverPerm = null;
      renderPermutation();
    }
    updateCaption();
  }

  function togglePlayback() {
    if (!state.solution.length) {
      if (state.solving) toast('正在搜索解法…');
      else toast('先点击「矩阵求解」生成解法');
      return;
    }
    if (state.playing) {
      stopPlayback();
      return;
    }
    if (state.anim) { toast('等待当前转动完成'); return; }
    if (state.step >= state.solution.length) jumpToStep(0);
    playSolution();
  }

  function playSolution() {
    if (state.solving) cancelPendingSolve();
    if (state.anim) return;
    var token = ++state.playToken;
    state.playing = true;
    state.userInteracted = true;
    updateTransport();
    (function loop() {
      if (!state.playing || token !== state.playToken) return;
      if (state.step >= state.solution.length) {
        state.playing = false;
        updateTransport();
        return;
      }
      var move = state.solution[state.step];
      syncSelectedMove(move);
      animateMove(move).then(function () {
        // Always consume the completed turn, even if the user paused during
        // the animation, so the logical step never lags behind the cube.
        if (state.step < state.solution.length) {
          state.step += 1;
          state.cube = state.prefixes[state.step].slice();
          state.lastMove = move;
        }
        updateTransport();
        updateSolutionChips();
        renderStats();
        renderHUD();
        if (!state.playing || token !== state.playToken) return;
        setTimeout(loop, 80);
      });
    })();
  }

  function stopPlayback() {
    if (state.playing) {
      state.playing = false;
      state.playToken++;
      updateTransport();
    }
  }

  function cancelPendingSolve() {
    var hadPending = state.solving || state.pendingSolveAfterReady;
    state.pendingSolveAfterReady = false;
    if (state.solving) {
      state.currentRequestId = null;
      state.pendingFacelets = null;
      state.solving = false;
      updateSolveButton();
      setReadyBadge();
    } else if (hadPending) {
      updateSolveButton();
      setReadyBadge();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Solver worker                                                     */
  /* ---------------------------------------------------------------- */

  function initSolver() {
    setSolverBadge('求解器初始化', 'loading');
    updateSolveButton();
    if (state.initTimer) clearInterval(state.initTimer);
    solver.initStarted = performance.now();
    state.initTimer = setInterval(function () {
      if (solver.ready) return;
      var s = (performance.now() - solver.initStarted) / 1000;
      setSolverBadge('构建剪枝表 ' + s.toFixed(1) + 's', 'loading');
    }, 140);

    try {
      var source = window.SOLVER_WORKER_SOURCE;
      if (!source) throw new Error('Worker source missing');
      var blob = new Blob([source], { type: 'text/javascript' });
      solver.blobUrl = URL.createObjectURL(blob);
      solver.worker = new Worker(solver.blobUrl);
      solver.worker.onmessage = onWorkerMessage;
      solver.worker.onerror = function (event) {
        clearInterval(state.initTimer);
        setSolverBadge('求解器不可用', 'error');
        toast('求解器加载失败：' + (event.message || 'Worker error'), true);
        state.solving = false;
        updateSolveButton();
      };
      solver.worker.postMessage({ type: 'init' });
    } catch (err) {
      clearInterval(state.initTimer);
      setSolverBadge('求解器不可用', 'error');
      toast('无法启动求解器：' + err.message, true);
    }
  }

  function onWorkerMessage(event) {
    var msg = event.data || {};
    if (msg.type === 'ready') {
      solver.ready = true;
      state.solverReady = true;
      state.solverInitMs = msg.initMs || 0;
      clearInterval(state.initTimer);
      setSolverBadge('求解器就绪 · ' + (state.solverInitMs / 1000).toFixed(1) + 's', 'ok');
      updateSolveButton();
      if (state.pendingSolveAfterReady) {
        state.pendingSolveAfterReady = false;
        requestSolve(false);
      } else if (!state.userInteracted) {
        requestSolve(true);
      }
      return;
    }
    if (msg.type === 'error') {
      state.solving = false;
      state.pendingSolveAfterReady = false;
      if (state.currentRequestId === msg.requestId) state.currentRequestId = null;
      state.pendingFacelets = null;
      updateSolveButton();
      setSolverBadge('求解失败', 'error');
      toast(msg.message || '求解失败', true);
      return;
    }
    if (msg.type === 'solution') {
      if (msg.requestId !== state.currentRequestId) return;
      state.currentRequestId = null;
      state.solving = false;
      updateSolveButton();
      if (!msg.error && state.pendingFacelets && RM.toFaceletString(state.cube) !== state.pendingFacelets) {
        // The cube changed while the worker was searching; discard the result.
        state.pendingFacelets = null;
        setReadyBadge();
        return;
      }
      state.pendingFacelets = null;
      if (msg.error) {
        setSolverBadge('求解失败', 'error');
        toast(msg.error, true);
        return;
      }
      applySolution(msg);
    }
  }

  function requestSolve(auto) {
    if (state.anim) {
      if (!auto) toast('等待当前转动完成');
      return;
    }
    if (!solver.ready) {
      state.pendingSolveAfterReady = true;
      if (!state.solving) {
        setSolverBadge('等待求解器', 'loading');
        updateSolveButton();
      }
      return;
    }
    if (state.solving) return;
    if (RM.isSolved(state.cube)) {
      toast('当前已经是复原状态');
      return;
    }
    var requestId = ++state.solveSeq;
    state.pendingSolveAfterReady = false;
    state.currentRequestId = requestId;
    state.pendingFacelets = RM.toFaceletString(state.cube);
    state.solving = true;
    state.userInteracted = true;
    updateSolveButton();
    setSolverBadge(auto ? '示例求解中…' : '搜索置换中…', 'loading');
    solver.worker.postMessage({
      type: 'solve',
      requestId: requestId,
      facelets: state.pendingFacelets
    });
  }

  function applySolution(msg) {
    var base = state.cube.slice();
    var moves = msg.solution || [];
    state.solution = moves;
    state.phase1Length = clamp(msg.phase1Length || 0, 0, moves.length);
    state.step = 0;
    state.base = base;
    state.prefixes = [base];
    for (var i = 0; i < moves.length; i++) {
      state.prefixes.push(RM.applyMove(state.prefixes[i], moves[i]));
    }
    if (!RM.isSolved(state.prefixes[state.prefixes.length - 1])) {
      state.solving = false;
      updateSolveButton();
      setSolverBadge('矩阵验证失败', 'error');
      toast('解法未通过矩阵验证，请重试', true);
      return;
    }
    state.cube = base.slice();
    state.lastMove = null;
    if (moves.length) syncSelectedMove(moves[0]);
    renderSolution();
    renderAll();
    $('statTime').textContent = formatMs(msg.solveMs || 0);
    setSolverBadge('Kociemba · ' + moves.length + ' 步', 'ok');
    if (moves.length === 0) {
      toast('状态已复原，无需转动');
    } else {
      var split = (msg.phase1Length || 0) > 0 && (msg.phase1Length || 0) < moves.length;
      $('solutionMeta').textContent = split
        ? 'KOCIEMBA · ' + moves.length + ' 步 · ' + msg.phase1Length + ' + ' + (moves.length - msg.phase1Length)
        : 'KOCIEMBA · ' + moves.length + ' 步';
      toast('解法已生成：' + moves.length + ' 步，矩阵验证通过');
    }
  }

  function formatMs(ms) {
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function updateSolveButton() {
    var btn = $('btnSolve');
    var text = $('btnSolveText');
    if (!state.solverReady) {
      btn.disabled = true;
      btn.classList.remove('solving');
      text.textContent = '构建求解表…';
      return;
    }
    if (state.solving) {
      btn.disabled = true;
      btn.classList.add('solving');
      text.textContent = '搜索置换…';
      return;
    }
    btn.disabled = false;
    btn.classList.remove('solving');
    text.textContent = '矩阵求解';
  }

  function setSolverBadge(text, kind) {
    $('solverBadgeText').textContent = text;
    var dot = $('solverBadge').querySelector('.status-dot');
    dot.className = 'status-dot ' + (kind === 'error' ? 'error' : kind === 'loading' ? 'loading' : '');
  }

  function setReadyBadge() {
    if (!solver.ready) { setSolverBadge('求解器初始化', 'loading'); return; }
    setSolverBadge('求解器就绪 · ' + (state.solverInitMs / 1000).toFixed(1) + 's', 'ok');
  }

  /* ---------------------------------------------------------------- */
  /* Move animation                                                    */
  /* ---------------------------------------------------------------- */

  function animateMove(move) {
    return new Promise(function (resolve) {
      if (state.anim) { resolve(false); return; }
      var def = RM.MOVE_DEFS[move[0]];
      var prime = move.indexOf("'") >= 0;
      var double = move.indexOf('2') >= 0;
      var turns = double ? 2 : 1;
      var target = def.sign * (prime ? -1 : 1) * turns * Math.PI / 2;
      var start = performance.now();
      state.anim = {
        move: move,
        axis: def.axis,
        layer: def.layer,
        angle: 0,
        target: target,
        start: start,
        duration: double ? 390 : 300,
        resolve: resolve
      };
      renderHUD();
      updateTransport();
      requestAnimationFrame(animationTick);
    });
  }

  function animationTick(now) {
    var anim = state.anim;
    if (!anim) return;
    var t = clamp((now - anim.start) / anim.duration, 0, 1);
    anim.angle = anim.target * easeInOutCubic(t);
    renderCube();
    if (t < 1) {
      requestAnimationFrame(animationTick);
      return;
    }
    var move = anim.move;
    state.anim = null;
    state.cube = RM.applyMove(state.cube, move);
    state.lastMove = move;
    renderCube();
    renderHUD();
    updateFaceCount();
    renderFaceNet();
    renderVector();
    renderMiniVector();
    renderStats();
    updateTransport();
    if (typeof anim.resolve === 'function') anim.resolve(true);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering: state, faces, vector, solution                         */
  /* ---------------------------------------------------------------- */

  function renderAll() {
    renderCube();
    renderHUD();
    renderFaceNet();
    renderVector();
    renderMiniVector();
    renderStats();
    updateFaceCount();
    updateSolutionChips();
    updateTransport();
    updateCaption();
    if (state.tab === 'perm') renderPermutation();
  }

  function renderHUD() {
    var move = state.anim ? state.anim.move : (state.lastMove || '—');
    $('hudMove').textContent = move;
    $('hudFormula').textContent = 'm = ' + (state.anim ? state.anim.move : (state.lastMove || state.selectedMove));
    $('hudStatus').textContent = state.anim ? '应用置换中…' : (state.playing ? '播放解法中' : '拖动旋转');
    $('liveDot').style.background = state.anim ? '#ffd43b' : 'var(--accent)';
    $('liveDot').style.boxShadow = state.anim ? '0 0 9px #ffd43b' : '0 0 9px var(--accent)';
  }

  function updateFaceCount() {
    var count = RM.countSolvedFaces(state.cube);
    state.cubeStats.solvedFaces = count;
    var pill = $('faceCount');
    pill.textContent = count + ' / 6 面复原';
    pill.classList.toggle('done', count === 6);
  }

  function renderFaceNet() {
    document.querySelectorAll('.face-cell').forEach(function (el) {
      var index = parseInt(el.getAttribute('data-index'), 10);
      var color = state.cube[index];
      el.textContent = color;
      el.style.background = RM.COLORS[color];
      el.classList.toggle('light-text', color === 'U' || color === 'D');
      el.classList.toggle('is-center', index % 9 === 4);
      el.title = color + ' · x[' + index + ']';
    });
  }

  function renderVector() {
    document.querySelectorAll('.vector-cell').forEach(function (el) {
      var index = parseInt(el.getAttribute('data-index'), 10);
      var color = state.cube[index];
      el.textContent = color;
      el.style.background = RM.COLORS[color];
      el.classList.toggle('light-text', color === 'U' || color === 'D');
      el.title = 'x[' + index + '] = ' + color;
    });
  }

  function renderMiniVector() {
    var nodes = $('miniVector').children;
    for (var i = 0; i < nodes.length && i < 54; i++) {
      nodes[i].style.background = RM.COLORS[state.cube[i]];
    }
  }

  function renderStats() {
    $('statMoves').textContent = state.solution.length || 0;
    if (!state.solution.length) $('statTime').textContent = '—';
  }

  function renderSolution() {
    var body = $('solutionBody');
    var moves = state.solution;
    if (!moves.length) {
      if (RM.isSolved(state.cube)) {
        body.innerHTML = '<div class="solution-empty"><span class="empty-glyph solved">✓</span><p>当前状态已复原<br>输入打乱，或点击「随机打乱」开始</p></div>';
        $('solutionMeta').textContent = 'SOLVED · 已复原';
      } else {
        body.innerHTML = '<div class="solution-empty"><span class="empty-glyph">P</span><p>输入打乱或点击「矩阵求解」<br>生成一条经过矩阵验证的解法</p></div>';
        $('solutionMeta').textContent = '等待求解 · SOLUTION';
      }
      $('statMoves').textContent = '0';
      $('statTime').textContent = '—';
      updateSolutionChips();
      updateTransport();
      return;
    }
    var boundary = state.phase1Length;
    if (!(boundary >= 0 && boundary <= moves.length)) boundary = 0;
    var canSplit = boundary > 0 && boundary < moves.length;
    var html = '';
    if (canSplit) {
      html += '<div class="phase-group phase1"><div class="phase-head"><span>阶段 1 · 进入 G1</span><span class="phase-tag">' + boundary + ' 步</span></div><div class="move-chips">';
      for (var i = 0; i < boundary; i++) html += chipHTML(moves[i], i);
      html += '</div></div>';
      html += '<div class="phase-group phase2"><div class="phase-head"><span>阶段 2 · G1 内归位</span><span class="phase-tag">' + (moves.length - boundary) + ' 步</span></div><div class="move-chips">';
      for (var j = boundary; j < moves.length; j++) html += chipHTML(moves[j], j);
      html += '</div></div>';
    } else {
      html += '<div class="phase-group"><div class="phase-head"><span>KOCIEMBA · 解法序列</span><span class="phase-tag">' + moves.length + ' 步</span></div><div class="move-chips">';
      for (var k = 0; k < moves.length; k++) html += chipHTML(moves[k], k);
      html += '</div></div>';
    }
    body.innerHTML = html;
    $('solutionMeta').textContent = canSplit
      ? 'KOCIEMBA · ' + moves.length + ' 步 · ' + boundary + ' + ' + (moves.length - boundary)
      : 'KOCIEMBA · ' + moves.length + ' 步';
    $('statMoves').textContent = moves.length;
    updateSolutionChips();
    updateTransport();
  }

  function chipHTML(move, index) {
    return '<button type="button" class="move-chip" data-target="' + (index + 1) + '" title="跳到第 ' + (index + 1) + ' 步 · ' + RM.describeMove(move) + '">' + move + '</button>';
  }

  function updateSolutionChips() {
    var chips = document.querySelectorAll('.move-chip');
    chips.forEach(function (chip) {
      var index = parseInt(chip.getAttribute('data-target'), 10) - 1;
      chip.classList.toggle('done', index < state.step - 1);
      chip.classList.toggle('current', index === state.step - 1);
      if (index === state.step - 1) chip.setAttribute('aria-current', 'step');
      else chip.removeAttribute('aria-current');
    });
  }

  function updateTransport() {
    var n = state.solution.length;
    var slider = $('stepSlider');
    slider.max = n;
    slider.value = state.step;
    slider.disabled = n === 0 || !!state.anim;
    slider.style.setProperty('--p', n ? (state.step / n * 100) + '%' : '0%');
    $('stepLabel').textContent = state.step + ' / ' + n;
    $('btnPrev').disabled = n === 0 || state.step <= 0 || !!state.anim;
    $('btnNext').disabled = n === 0 || state.step >= n || !!state.anim;
    $('btnPlay').disabled = n === 0;
    $('btnPlay').classList.toggle('playing', state.playing);
    $('btnPlay').title = state.playing ? '暂停' : '播放解法';
    $('btnPlay').setAttribute('aria-label', state.playing ? '暂停' : '播放解法');
    $('btnCopy').disabled = n === 0;
  }

  function updateCaption() {
    var el = $('matrixCaption');
    if (state.tab === 'faces') {
      el.innerHTML = '<b>M<sub>U</sub> … M<sub>B</sub></b> · 每个面是状态向量的一个 3×3 切片';
    } else if (state.tab === 'perm') {
      el.innerHTML = '<b>' + matrixLabel(state.selectedMove) + '</b> · 54 个非零元 · 每行每列恰有一个 1';
    } else {
      el.innerHTML = '<b>x</b> = [U1 … B9]<sup>T</sup> · 54 维状态向量';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Copy / toast                                                      */
  /* ---------------------------------------------------------------- */

  function copySolution() {
    if (!state.solution.length) { toast('当前没有可复制的解法'); return; }
    var text = RM.movesToString(state.solution);
    var done = function () { toast('解法已复制 · ' + state.solution.length + ' 步'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast('复制失败', true); }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(message, error) {
    var el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', !!error);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------------------------------------------------------------- */
  /* 3D cube renderer                                                  */
  /* ---------------------------------------------------------------- */

  var STICKERS = RM.CELLS.map(function (cell) {
    // Facelet indices (0,1,2) are not spatial coordinates. A 3x3 face spans
    // -1..1, so its nine centers sit at -2/3, 0 and +2/3 *in the face plane*.
    // The coordinate along the normal stays at +/-1.
    var rp = cell.pos.slice();
    var n = cell.normal;
    if (n[0] !== 0) { rp[1] *= 2 / 3; rp[2] *= 2 / 3; }
    else if (n[1] !== 0) { rp[0] *= 2 / 3; rp[2] *= 2 / 3; }
    else { rp[0] *= 2 / 3; rp[1] *= 2 / 3; }
    return {
      index: cell.index,
      pos: cell.pos,
      renderPos: rp,
      normal: n,
      colorFace: cell.face
    };
  });
  var CORE_FACES = RM.FACES.map(function (face) {
    return { normal: RM.NORMALS[face] };
  });

  function resizeCubeCanvas() {
    if (!cubeStage) return;
    var rect = cubeStage.getBoundingClientRect();
    cubeDpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    cubeCanvas.width = Math.round(w * cubeDpr);
    cubeCanvas.height = Math.round(h * cubeDpr);
    cubeWrapRect = { w: w, h: h };
    renderCube();
  }

  function projectPoint(p, yaw, pitch, out) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x1 = p[0] * cy + p[2] * sy;
    var z1 = -p[0] * sy + p[2] * cy;
    var y2 = p[1] * cp - z1 * sp;
    var z2 = p[1] * sp + z1 * cp;
    out[0] = x1; out[1] = y2; out[2] = z2;
    return out;
  }

  function viewPoint(p, out) {
    return projectPoint(p, view.yaw, view.pitch, out);
  }

  var tmpPoint = [0, 0, 0];

  function rotateAxis(p, axis, angle) {
    var x = p[0], y = p[1], z = p[2];
    var c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
    if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  }

  function baseQuad(pos, normal, inset) {
    var a, b;
    if (normal[0] !== 0) { a = [0, 1, 0]; b = [0, 0, 1]; }
    else if (normal[1] !== 0) { a = [1, 0, 0]; b = [0, 0, 1]; }
    else { a = [1, 0, 0]; b = [0, 1, 0]; }
    var off = 0.012;
    var cx = pos[0] + normal[0] * off;
    var cy = pos[1] + normal[1] * off;
    var cz = pos[2] + normal[2] * off;
    return [
      [cx - a[0] * inset - b[0] * inset, cy - a[1] * inset - b[1] * inset, cz - a[2] * inset - b[2] * inset],
      [cx + a[0] * inset - b[0] * inset, cy + a[1] * inset - b[1] * inset, cz + a[2] * inset - b[2] * inset],
      [cx + a[0] * inset + b[0] * inset, cy + a[1] * inset + b[1] * inset, cz + a[2] * inset + b[2] * inset],
      [cx - a[0] * inset + b[0] * inset, cy - a[1] * inset + b[1] * inset, cz - a[2] * inset + b[2] * inset]
    ];
  }

  function shade(hex, factor) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var rr = Math.round(clamp(r * factor, 0, 255));
    var gg = Math.round(clamp(g * factor, 0, 255));
    var bb = Math.round(clamp(b * factor, 0, 255));
    return 'rgb(' + rr + ',' + gg + ',' + bb + ')';
  }

  function roundedPolygon(ctx, pts, radius) {
    var n = pts.length;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var p0 = pts[i];
      var p1 = pts[(i + 1) % n];
      var p2 = pts[(i + 2) % n];
      var dx1 = p1[0] - p0[0], dy1 = p1[1] - p0[1];
      var dx2 = p2[0] - p1[0], dy2 = p2[1] - p1[1];
      var l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
      if (!l1 || !l2) continue;
      var r = Math.min(radius, l1 / 2, l2 / 2);
      var a = [p1[0] - dx1 / l1 * r, p1[1] - dy1 / l1 * r];
      var b = [p1[0] + dx2 / l2 * r, p1[1] + dy2 / l2 * r];
      if (i === 0) ctx.moveTo(a[0], a[1]);
      else ctx.lineTo(a[0], a[1]);
      ctx.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
    }
    ctx.closePath();
  }

  function renderCube() {
    if (!cubeCtx || !cubeWrapRect) return;
    var w = cubeWrapRect.w, h = cubeWrapRect.h;
    var dpr = cubeDpr;
    cubeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cubeCtx.clearRect(0, 0, w, h);

    var cx = w / 2;
    var cy = h * 0.485;
    var scale = Math.min(w, h) * 0.253 * view.zoom;

    // floating shadow
    var shadow = cubeCtx.createRadialGradient(cx, cy + scale * 2.28, 2, cx, cy + scale * 2.28, scale * 2.1);
    shadow.addColorStop(0, 'rgba(0,0,0,.55)');
    shadow.addColorStop(0.55, 'rgba(0,0,0,.18)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    cubeCtx.fillStyle = shadow;
    cubeCtx.beginPath();
    cubeCtx.ellipse(cx, cy + scale * 2.28, scale * 2.1, scale * 0.38, 0, 0, Math.PI * 2);
    cubeCtx.fill();

    var anim = state.anim;
    var light = [0.38, 0.72, 0.58];
    var lightLen = Math.hypot(light[0], light[1], light[2]);
    light[0] /= lightLen; light[1] /= lightLen; light[2] /= lightLen;
    var f = 6.4;
    var items = [];

    // Dark core cube: draw all six planes first. They are the same color, so
    // their internal ordering is irrelevant; stickers are painted on top.
    CORE_FACES.forEach(function (face) {
      var n = face.normal;
      var corners;
      if (n[0] !== 0) {
        corners = [[n[0] * 0.982, -1, -1], [n[0] * 0.982, -1, 1], [n[0] * 0.982, 1, 1], [n[0] * 0.982, 1, -1]];
      } else if (n[1] !== 0) {
        corners = [[-1, n[1] * 0.982, -1], [1, n[1] * 0.982, -1], [1, n[1] * 0.982, 1], [-1, n[1] * 0.982, 1]];
      } else {
        corners = [[-1, -1, n[2] * 0.982], [1, -1, n[2] * 0.982], [1, 1, n[2] * 0.982], [-1, 1, n[2] * 0.982]];
      }
      var projected = corners.map(function (p) {
        viewPoint(p, tmpPoint);
        var persp = f / (f - tmpPoint[2]);
        return [cx + tmpPoint[0] * scale * persp, cy - tmpPoint[1] * scale * persp, tmpPoint[2]];
      });
      roundedPolygon(cubeCtx, projected, 5);
      cubeCtx.fillStyle = '#05080d';
      cubeCtx.fill();
    });

    // Stickers on visible faces only. For a convex cube, a face is visible when
    // its outward normal points toward the camera (positive z in view space).
    var faceCull = 0.02;
    STICKERS.forEach(function (sticker) {
      var corners = baseQuad(sticker.renderPos, sticker.normal, 0.302);
      var normal = sticker.normal;
      var moving = false;
      if (anim) {
        var ai = anim.axis === 'x' ? 0 : anim.axis === 'y' ? 1 : 2;
        if (sticker.pos[ai] === anim.layer) {
          moving = true;
          corners = corners.map(function (p) { return rotateAxis(p, anim.axis, anim.angle); });
          normal = rotateAxis(normal, anim.axis, anim.angle);
        }
      }
      items.push({
        type: 'sticker',
        corners: corners,
        normal: normal,
        depth: 0,
        color: RM.COLORS[state.cube[sticker.index]],
        moving: moving
      });
    });

    // project + sort
    items.forEach(function (item) {
      var sumZ = 0;
      item.projected = item.corners.map(function (p) {
        viewPoint(p, tmpPoint);
        var x = tmpPoint[0], y = tmpPoint[1], z = tmpPoint[2];
        var persp = f / (f - z);
        sumZ += z;
        return [cx + x * scale * persp, cy - y * scale * persp, z];
      });
      item.depth = sumZ / 4;
      viewPoint(item.normal, tmpPoint);
      item.normalZ = tmpPoint[2];
      item.light = Math.max(0, tmpPoint[0] * light[0] + tmpPoint[1] * light[1] + tmpPoint[2] * light[2]);
      item.visible = item.normalZ >= faceCull;
    });
    items = items.filter(function (item) { return item.visible; });
    items.sort(function (a, b) { return a.depth - b.depth; });

    cubeCtx.lineJoin = 'round';
    cubeCtx.lineCap = 'round';

    items.forEach(function (item) {
      var factor = 0.72 + 0.34 * item.light;
      var color = shade(item.color, factor);
      roundedPolygon(cubeCtx, item.projected, 5.5);
      cubeCtx.fillStyle = color;
      if (item.moving) {
        cubeCtx.shadowColor = item.color;
        cubeCtx.shadowBlur = 10;
      }
      cubeCtx.fill();
      cubeCtx.shadowBlur = 0;
      cubeCtx.shadowColor = 'transparent';
      cubeCtx.strokeStyle = 'rgba(0,0,0,.55)';
      cubeCtx.lineWidth = 1.1;
      cubeCtx.stroke();
      // subtle top bevel
      cubeCtx.beginPath();
      cubeCtx.moveTo(item.projected[0][0], item.projected[0][1]);
      cubeCtx.lineTo(item.projected[3][0], item.projected[3][1]);
      cubeCtx.strokeStyle = 'rgba(255,255,255,.13)';
      cubeCtx.lineWidth = 1;
      cubeCtx.stroke();
    });

    drawAxisGizmo(w, h, scale);
  }

  function drawAxisGizmo(w, h, scale) {
    var ox = 42, oy = h - 38, len = 19;
    var axes = [
      { v: [1, 0, 0], color: '#ff6b76', label: 'x' },
      { v: [0, 1, 0], color: '#7cf5c8', label: 'y' },
      { v: [0, 0, 1], color: '#67d8ff', label: 'z' }
    ];
    cubeCtx.save();
    cubeCtx.font = '8px "Cascadia Code", Consolas, monospace';
    cubeCtx.textAlign = 'center';
    cubeCtx.textBaseline = 'middle';
    axes.forEach(function (axis) {
      viewPoint(axis.v, tmpPoint);
      var x = ox + tmpPoint[0] * len;
      var y = oy - tmpPoint[1] * len;
      cubeCtx.beginPath();
      cubeCtx.moveTo(ox, oy);
      cubeCtx.lineTo(x, y);
      cubeCtx.strokeStyle = axis.color;
      cubeCtx.globalAlpha = 0.75;
      cubeCtx.lineWidth = 1.2;
      cubeCtx.stroke();
      cubeCtx.globalAlpha = 1;
      cubeCtx.fillStyle = axis.color;
      cubeCtx.fillText(axis.label, x + (x - ox) * 0.28, y + (y - oy) * 0.28);
    });
    cubeCtx.restore();
  }

  function bindCubeInteraction() {
    cubeStage.addEventListener('pointerdown', function (event) {
      if (event.target.closest('button')) return;
      drag = { x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch };
      cubeStage.setPointerCapture(event.pointerId);
    });
    cubeStage.addEventListener('pointermove', function (event) {
      if (!drag) return;
      view.yaw = drag.yaw + (event.clientX - drag.x) * 0.0075;
      view.pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.006, -1.12, 1.12);
      renderCube();
    });
    cubeStage.addEventListener('pointerup', function (event) {
      if (!drag) return;
      drag = null;
      try { cubeStage.releasePointerCapture(event.pointerId); } catch (err) {}
    });
    cubeStage.addEventListener('pointercancel', function () { drag = null; });
    cubeStage.addEventListener('wheel', function (event) {
      event.preventDefault();
      view.zoom = clamp(view.zoom * (1 - event.deltaY * 0.0009), 0.72, 1.5);
      renderCube();
    }, { passive: false });
    cubeStage.addEventListener('dblclick', function (event) {
      if (event.target.closest('button')) return;
      view.yaw = -0.62;
      view.pitch = 0.36;
      view.zoom = 1;
      renderCube();
    });
  }

  function bindCanvasObservers() {
    var ro = new ResizeObserver(function () {
      resizeCubeCanvas();
      if (state.tab === 'perm') {
        resizePermCanvas();
        renderPermutation();
      }
      if (paint.open && paint.mode === '3d') {
        resizePaint3dCanvas();
        renderPaintCube();
      }
    });
    ro.observe(cubeStage);
    ro.observe(permWrap);
    ro.observe(paint3dWrap);
    window.addEventListener('resize', function () {
      resizeCubeCanvas();
      if (state.tab === 'perm') { resizePermCanvas(); renderPermutation(); }
      if (paint.open && paint.mode === '3d') {
        resizePaint3dCanvas();
        renderPaintCube();
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Permutation matrix canvas                                         */
  /* ---------------------------------------------------------------- */

  var permDpr = 1;
  var permGeom = null;

  function resizePermCanvas() {
    if (!permWrap) return;
    var rect = permWrap.getBoundingClientRect();
    if (!rect.width) return;
    permDpr = Math.min(window.devicePixelRatio || 1, 2);
    permCanvas.width = Math.round(rect.width * permDpr);
    permCanvas.height = Math.round(rect.height * permDpr);
    permGeom = { w: rect.width, h: rect.height };
  }

  function cellName(index) {
    var c = RM.CELLS[index];
    return c.face + (c.r * 3 + c.c + 1);
  }

  function renderPermutation() {
    if (!permCtx) return;
    if (!permGeom) resizePermCanvas();
    if (!permGeom) return;
    var w = permGeom.w, h = permGeom.h;
    permCtx.setTransform(permDpr, 0, 0, permDpr, 0, 0);
    permCtx.clearRect(0, 0, w, h);
    permCtx.fillStyle = '#06090e';
    permCtx.fillRect(0, 0, w, h);

    var pad = Math.max(8, Math.min(w, h) * 0.025);
    var size = Math.min(w, h) - pad * 2;
    var cell = size / 54;
    var ox = (w - size) / 2;
    var oy = (h - size) / 2;

    // face group bands
    for (var f = 0; f < 6; f++) {
      permCtx.fillStyle = f % 2 === 0 ? 'rgba(255,255,255,.018)' : 'rgba(255,255,255,.006)';
      permCtx.fillRect(ox + f * 9 * cell, oy, cell * 9, size);
      permCtx.fillRect(ox, oy + f * 9 * cell, size, cell * 9);
    }

    // fine grid
    permCtx.strokeStyle = 'rgba(255,255,255,.045)';
    permCtx.lineWidth = 0.5;
    permCtx.beginPath();
    for (var i = 0; i <= 54; i++) {
      var x = Math.round(ox + i * cell) + 0.5;
      var y = Math.round(oy + i * cell) + 0.5;
      permCtx.moveTo(x, oy);
      permCtx.lineTo(x, oy + size);
      permCtx.moveTo(ox, y);
      permCtx.lineTo(ox + size, y);
    }
    permCtx.stroke();

    // face separators
    permCtx.strokeStyle = 'rgba(255,255,255,.1)';
    permCtx.lineWidth = 0.8;
    permCtx.beginPath();
    for (var g = 0; g <= 6; g++) {
      var gx = Math.round(ox + g * 9 * cell) + 0.5;
      var gy = Math.round(oy + g * 9 * cell) + 0.5;
      permCtx.moveTo(gx, oy);
      permCtx.lineTo(gx, oy + size);
      permCtx.moveTo(ox, gy);
      permCtx.lineTo(ox + size, gy);
    }
    permCtx.stroke();

    var move = state.selectedMove;
    var perm = RM.PERMUTATIONS[move];
    if (!perm) return;
    var dot = Math.max(2.2, cell * 0.62);
    for (var col = 0; col < 54; col++) {
      var row = perm[col];
      var color = RM.COLORS[RM.FACES[Math.floor(col / 9)]];
      var px = ox + col * cell + (cell - dot) / 2;
      var py = oy + row * cell + (cell - dot) / 2;
      permCtx.fillStyle = color;
      permCtx.globalAlpha = 0.92;
      roundedRect(permCtx, px, py, dot, dot, Math.min(1.6, dot * 0.28));
      permCtx.fill();
    }
    permCtx.globalAlpha = 1;

    // hover cross
    if (state.hoverPerm) {
      var hr = state.hoverPerm.row;
      var hc = state.hoverPerm.col;
      if (hr >= 0 && hr < 54 && hc >= 0 && hc < 54) {
        permCtx.fillStyle = 'rgba(124,245,200,.055)';
        permCtx.fillRect(ox, oy + hr * cell, size, cell);
        permCtx.fillRect(ox + hc * cell, oy, cell, size);
        permCtx.strokeStyle = 'rgba(124,245,200,.75)';
        permCtx.lineWidth = 1;
        permCtx.strokeRect(ox + hc * cell + 0.5, oy + hr * cell + 0.5, cell, cell);
      }
    }

    // border
    permCtx.strokeStyle = 'rgba(255,255,255,.1)';
    permCtx.lineWidth = 1;
    permCtx.strokeRect(ox + 0.5, oy + 0.5, size, size);
    updatePermReadout();
  }

  function roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function bindPermHover() {
    if (!permCanvas) return;
    permCanvas.addEventListener('pointermove', function (event) {
      if (!permGeom) return;
      var rect = permCanvas.getBoundingClientRect();
      var w = permGeom.w, h = permGeom.h;
      var pad = Math.max(8, Math.min(w, h) * 0.025);
      var size = Math.min(w, h) - pad * 2;
      var cell = size / 54;
      var ox = (w - size) / 2;
      var oy = (h - size) / 2;
      var col = Math.floor((event.clientX - rect.left - ox) / cell);
      var row = Math.floor((event.clientY - rect.top - oy) / cell);
      if (row < 0 || row >= 54 || col < 0 || col >= 54) {
        state.hoverPerm = null;
        renderPermutation();
        updatePermReadout();
        return;
      }
      if (!state.hoverPerm || state.hoverPerm.row !== row || state.hoverPerm.col !== col) {
        state.hoverPerm = { row: row, col: col };
        renderPermutation();
        updatePermReadout();
      }
    });
    permCanvas.addEventListener('pointerleave', function () {
      state.hoverPerm = null;
      renderPermutation();
      updatePermReadout();
    });
  }

  function updatePermReadout() {
    var el = $('permReadout');
    if (!el) return;
    var move = state.selectedMove;
    if (!state.hoverPerm) {
      el.innerHTML = '<b>' + matrixLabel(move) + '</b><span class="dotsep">·</span>54 个非零元<span class="dotsep">·</span>每行/列和 = 1';
      return;
    }
    var matrix = RM.permutationMatrix(move);
    var value = matrix[state.hoverPerm.row][state.hoverPerm.col];
    var rowName = cellName(state.hoverPerm.row);
    var colName = cellName(state.hoverPerm.col);
    if (value === 1) {
      el.innerHTML = '<b>P[' + state.hoverPerm.row + '][' + state.hoverPerm.col + '] = 1</b><span class="dotsep">·</span>' + colName + ' → ' + rowName + ' （色块移动到目标位置）';
    } else {
      el.innerHTML = '<b>P[' + state.hoverPerm.row + '][' + state.hoverPerm.col + '] = 0</b><span class="dotsep">·</span>' + rowName + ' 与 ' + colName + ' 无置换关系';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Start                                                             */
  /* ---------------------------------------------------------------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
