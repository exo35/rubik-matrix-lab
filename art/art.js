/* Artwork renderer for the static PNG exports. */
(function () {
  'use strict';
  var RM = window.RubikMatrix;
  var SCRAMBLE = "R U R' U' F2 L D2 B' R2 U2 L' B2 D' F' L2 U B2 D2 R'";
  var SOLUTION = ['R', 'L2', 'U', 'D2', "R'", "D'", 'B2', "L'", "F'", "U'", 'L2', 'F2', 'R2', 'B2', "D'", 'B2', 'L2', "U'", 'F2', 'D2', 'B2', 'R2'];
  var PHASE1 = 9;
  var STATE = RM.applyMoves(RM.solvedState(), RM.parseMoves(SCRAMBLE));
  var SOLVED = RM.solvedState();

  var STICKERS = RM.CELLS.map(function (cell) {
    var rp = cell.pos.slice();
    var n = cell.normal;
    if (n[0] !== 0) { rp[1] *= 2 / 3; rp[2] *= 2 / 3; }
    else if (n[1] !== 0) { rp[0] *= 2 / 3; rp[2] *= 2 / 3; }
    else { rp[0] *= 2 / 3; rp[1] *= 2 / 3; }
    return { index: cell.index, pos: rp, normal: n };
  });

  function shade(hex, factor) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(clamp(r * factor, 0, 255)) + ',' + Math.round(clamp(g * factor, 0, 255)) + ',' + Math.round(clamp(b * factor, 0, 255)) + ')';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function viewPoint(p, yaw, pitch, out) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x1 = p[0] * cy + p[2] * sy;
    var z1 = -p[0] * sy + p[2] * cy;
    out[0] = x1;
    out[1] = p[1] * cp - z1 * sp;
    out[2] = p[1] * sp + z1 * cp;
    return out;
  }
  function roundedPolygon(ctx, pts, radius) {
    var n = pts.length;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var p0 = pts[i], p1 = pts[(i + 1) % n], p2 = pts[(i + 2) % n];
      var dx1 = p1[0] - p0[0], dy1 = p1[1] - p0[1];
      var dx2 = p2[0] - p1[0], dy2 = p2[1] - p1[1];
      var l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
      if (!l1 || !l2) continue;
      var r = Math.min(radius, l1 / 2, l2 / 2);
      var a = [p1[0] - dx1 / l1 * r, p1[1] - dy1 / l1 * r];
      var b = [p1[0] + dx2 / l2 * r, p1[1] + dy2 / l2 * r];
      if (i === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
      ctx.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
    }
    ctx.closePath();
  }
  function baseQuad(pos, normal, inset) {
    var a, b;
    if (normal[0] !== 0) { a = [0, 1, 0]; b = [0, 0, 1]; }
    else if (normal[1] !== 0) { a = [1, 0, 0]; b = [0, 0, 1]; }
    else { a = [1, 0, 0]; b = [0, 1, 0]; }
    var off = 0.008;
    var cx = pos[0] + normal[0] * off, cy = pos[1] + normal[1] * off, cz = pos[2] + normal[2] * off;
    return [
      [cx - a[0] * inset - b[0] * inset, cy - a[1] * inset - b[1] * inset, cz - a[2] * inset - b[2] * inset],
      [cx + a[0] * inset - b[0] * inset, cy + a[1] * inset - b[1] * inset, cz + a[2] * inset - b[2] * inset],
      [cx + a[0] * inset + b[0] * inset, cy + a[1] * inset + b[1] * inset, cz + a[2] * inset + b[2] * inset],
      [cx - a[0] * inset + b[0] * inset, cy - a[1] * inset + b[1] * inset, cz - a[2] * inset + b[2] * inset]
    ];
  }

  function drawCube(canvas, state, opts) {
    opts = opts || {};
    var rect = canvas.getBoundingClientRect();
    var w = Math.round(rect.width || 500), h = Math.round(rect.height || 500);
    var dpr = 2;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var yaw = opts.yaw == null ? -0.62 : opts.yaw;
    var pitch = opts.pitch == null ? 0.36 : opts.pitch;
    var zoom = opts.zoom || 1;
    var cx = w / 2, cy = h * (opts.cy || 0.5);
    var scale = Math.min(w, h) * (opts.scale || 0.255) * zoom;
    var f = 6.4;
    var tmp = [0, 0, 0];
    var light = [0.38, 0.72, 0.58];
    var ll = Math.hypot(light[0], light[1], light[2]);
    light[0] /= ll; light[1] /= ll; light[2] /= ll;

    if (opts.shadow !== false) {
      var g = ctx.createRadialGradient(cx, cy + scale * 2.15, 2, cx, cy + scale * 2.15, scale * 1.9);
      g.addColorStop(0, 'rgba(0,0,0,.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy + scale * 2.15, scale * 1.9, scale * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // core
    ['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (face) {
      var n = RM.NORMALS[face], corners;
      if (n[0] !== 0) corners = [[n[0] * 0.982, -1, -1], [n[0] * 0.982, -1, 1], [n[0] * 0.982, 1, 1], [n[0] * 0.982, 1, -1]];
      else if (n[1] !== 0) corners = [[-1, n[1] * 0.982, -1], [1, n[1] * 0.982, -1], [1, n[1] * 0.982, 1], [-1, n[1] * 0.982, 1]];
      else corners = [[-1, -1, n[2] * 0.982], [1, -1, n[2] * 0.982], [1, 1, n[2] * 0.982], [-1, 1, n[2] * 0.982]];
      var projected = corners.map(function (p) {
        viewPoint(p, yaw, pitch, tmp);
        var persp = f / (f - tmp[2]);
        return [cx + tmp[0] * scale * persp, cy - tmp[1] * scale * persp];
      });
      roundedPolygon(ctx, projected, 5);
      ctx.fillStyle = '#05080d';
      ctx.fill();
    });

    var items = [];
    STICKERS.forEach(function (st) {
      var corners = baseQuad(st.pos, st.normal, 0.302);
      var normal = st.normal;
      var depth = 0, nz = 0;
      var projected = corners.map(function (p) {
        viewPoint(p, yaw, pitch, tmp);
        var persp = f / (f - tmp[2]);
        depth += tmp[2];
        return [cx + tmp[0] * scale * persp, cy - tmp[1] * scale * persp];
      });
      viewPoint(normal, yaw, pitch, tmp);
      nz = tmp[2];
      if (nz < 0.02) return;
      var lightValue = Math.max(0, tmp[0] * light[0] + tmp[1] * light[1] + tmp[2] * light[2]);
      items.push({ projected: projected, depth: depth / 4, color: RM.COLORS[state[st.index]], light: lightValue });
    });
    items.sort(function (a, b) { return a.depth - b.depth; });
    ctx.lineJoin = 'round';
    items.forEach(function (item) {
      roundedPolygon(ctx, item.projected, 5.5);
      ctx.fillStyle = shade(item.color, 0.72 + 0.34 * item.light);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(item.projected[0][0], item.projected[0][1]);
      ctx.lineTo(item.projected[3][0], item.projected[3][1]);
      ctx.strokeStyle = 'rgba(255,255,255,.13)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function drawPerm(canvas, move) {
    var rect = canvas.getBoundingClientRect();
    var w = Math.round(rect.width || 400), h = Math.round(rect.height || 400);
    var dpr = 2;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var pad = 10, size = Math.min(w, h) - pad * 2, cell = size / 54;
    var ox = (w - size) / 2, oy = (h - size) / 2;
    ctx.fillStyle = '#06090e';
    ctx.fillRect(0, 0, w, h);
    for (var f = 0; f < 6; f++) {
      ctx.fillStyle = f % 2 === 0 ? 'rgba(255,255,255,.022)' : 'rgba(255,255,255,.008)';
      ctx.fillRect(ox + f * 9 * cell, oy, 9 * cell, size);
      ctx.fillRect(ox, oy + f * 9 * cell, size, 9 * cell);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (var i = 0; i <= 54; i++) {
      var x = Math.round(ox + i * cell) + 0.5, y = Math.round(oy + i * cell) + 0.5;
      ctx.moveTo(x, oy); ctx.lineTo(x, oy + size);
      ctx.moveTo(ox, y); ctx.lineTo(ox + size, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (var g = 0; g <= 6; g++) {
      var gx = Math.round(ox + g * 9 * cell) + 0.5, gy = Math.round(oy + g * 9 * cell) + 0.5;
      ctx.moveTo(gx, oy); ctx.lineTo(gx, oy + size);
      ctx.moveTo(ox, gy); ctx.lineTo(ox + size, gy);
    }
    ctx.stroke();
    var perm = RM.PERMUTATIONS[move];
    var dot = Math.max(2.4, cell * 0.64);
    for (var col = 0; col < 54; col++) {
      var row = perm[col];
      var color = RM.COLORS[RM.FACES[Math.floor(col / 9)]];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.94;
      ctx.fillRect(ox + col * cell + (cell - dot) / 2, oy + row * cell + (cell - dot) / 2, dot, dot);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, size, size);
  }

  function buildVector(el, state) {
    var html = '';
    RM.FACES.forEach(function (face) {
      html += '<div class="v-row"><span class="v-label">' + face + '</span>';
      for (var i = 0; i < 9; i++) {
        var idx = RM.FACE_INDEX[face] * 9 + i;
        var color = state[idx];
        html += '<span class="v-cell" style="background:' + RM.COLORS[color] + ';color:' + (color === 'U' || color === 'D' ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.85)') + '">' + color + '</span>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  function buildChips(el, moves, startIndex, phase) {
    var html = '';
    moves.forEach(function (move, i) {
      html += '<span class="chip" data-phase="' + phase + '">' + move + '</span>';
    });
    el.innerHTML = html;
  }

  function buildSlices(el, state) {
    var html = '';
    RM.FACES.forEach(function (face) {
      html += '<div class="slice"><div class="slice-label">M<sub>' + face + '</sub></div><div class="slice-face">';
      for (var i = 0; i < 9; i++) {
        var color = state[RM.FACE_INDEX[face] * 9 + i];
        html += '<span style="background:' + RM.COLORS[color] + '"></span>';
      }
      html += '</div></div>';
    });
    el.innerHTML = html;
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-cube]').forEach(function (canvas) {
      var state = canvas.getAttribute('data-state') === 'solved' ? SOLVED : STATE;
      drawCube(canvas, state, {
        yaw: parseFloat(canvas.getAttribute('data-yaw') || '-0.62'),
        pitch: parseFloat(canvas.getAttribute('data-pitch') || '0.36'),
        scale: parseFloat(canvas.getAttribute('data-scale') || '0.255'),
        shadow: canvas.getAttribute('data-shadow') !== 'false'
      });
    });
    document.querySelectorAll('[data-perm]').forEach(function (canvas) {
      drawPerm(canvas, canvas.getAttribute('data-perm'));
    });
    document.querySelectorAll('[data-vector]').forEach(function (el) {
      buildVector(el, STATE);
    });
    document.querySelectorAll('[data-slices]').forEach(function (el) {
      buildSlices(el, STATE);
    });
    var p1 = document.querySelector('[data-chips="1"]');
    var p2 = document.querySelector('[data-chips="2"]');
    if (p1) buildChips(p1, SOLUTION.slice(0, PHASE1), 0, 1);
    if (p2) buildChips(p2, SOLUTION.slice(PHASE1), PHASE1, 2);
  });

  window.ART = { SCRAMBLE: SCRAMBLE, SOLUTION: SOLUTION, PHASE1: PHASE1, STATE: STATE, SOLVED: SOLVED };
})();
