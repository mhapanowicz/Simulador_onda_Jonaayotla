const ReduccionSimulator = (function() {
    var canvas, ctx;
    var mode = 'person';
    var people = [];
    var shelves = [];
    var wavePhase = 0;
    var isDragging = false;
    var draggedPerson = null;
    var isDraggingAntenna = false;
    var isAnimRunning = false;
    var isPaused = false;

    // === TIENDA IDÉNTICA AL RF SIMULATOR ===
    // Canvas: 900x600. Tienda: 720x440 en (40,40). Antena: (700,440).
    // Escala: 1 px = 0.1 m (10 px = 1 m)
    var PX_PER_METER = 10;
    var antenna = { x: 700, y: 440 };
    var storeBounds = { x: 40, y: 40, width: 720, height: 440, wallThickness: 8 };
    var cashierZone = { x: 620, y: 380, width: 120, height: 80 };

    // Atenuaciones
    var WALL_ATTEN = 20;      // Concreto
    var WINDOW_ATTEN = 8;     // Vidrio
    var lluviaAtten = 0;
    var tempAtten = 0;

    // Ventanas en las paredes (posiciones absolutas en px)
    var windows = [
        { wall: 'left',   start: 120, end: 220 },  // ventana izquierda (~10m)
        { wall: 'bottom', start: 200, end: 340 }   // ventana abajo (~14m)
    ];

    // Potencias: 0-100 donde 100 = más sensible (ve más lejos)
    var paseantesPotencia = 85;
    var visitasPotencia = 75;

    // === MODELO DE PROPAGACIÓN (mismo del RF Simulator) ===
    var RAW_DBM = -100;

    function initSim() {
        canvas = document.getElementById('reduccionCanvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        loadPreset('average');
        setupCanvasEvents();
        if (!isAnimRunning) { isAnimRunning = true; animate(); }
    }

    function setMode(newMode) {
        mode = newMode;
        var btnP = document.getElementById('btn-red-add-person');
        var btnS = document.getElementById('btn-red-add-shelf');
        var btnA = document.getElementById('btn-red-move-antenna');
        if (btnP) btnP.className = mode === 'person' ? 'btn btn-primary' : 'btn';
        if (btnS) btnS.className = mode === 'shelf' ? 'btn btn-primary' : 'btn';
        if (btnA) btnA.className = mode === 'antenna' ? 'btn btn-primary' : 'btn';
    }

    function updatePaseantes(val) {
        paseantesPotencia = parseInt(val);
        var el = document.getElementById('red-paseantes-val');
        if (el) el.innerText = '-' + paseantesPotencia;
        // Si visitas quedó mayor que paseantes, ajustar visitas hacia abajo
        if (visitasPotencia > paseantesPotencia) {
            visitasPotencia = paseantesPotencia;
            var vS = document.getElementById('red-visitas-slider');
            var vV = document.getElementById('red-visitas-val');
            if (vS) vS.value = visitasPotencia;
            if (vV) vV.innerText = '-' + visitasPotencia;
        }
        // El slider de visitas no puede pasar de paseantes
        var vS2 = document.getElementById('red-visitas-slider');
        if (vS2) vS2.max = paseantesPotencia;
    }

    function updateVisitas(val) {
        visitasPotencia = Math.min(parseInt(val), paseantesPotencia);
        var el = document.getElementById('red-visitas-val');
        if (el) el.innerText = '-' + visitasPotencia;
        var vS = document.getElementById('red-visitas-slider');
        if (vS) vS.value = visitasPotencia;
    }

    function updateClima() {
        var sel = document.getElementById('red-lluvia');
        if (sel) lluviaAtten = parseInt(sel.value);
    }

    function updateTemperatura(val) {
        var temp = parseInt(val);
        var el = document.getElementById('red-temp-val');
        if (el) el.innerText = temp + '\u00b0C';
        tempAtten = (temp > 40 || temp < 0) ? 1 : 0;
    }

    function clearElements() { people = []; shelves = []; }

    function isInStore(x, y) {
        return x >= storeBounds.x && x <= storeBounds.x + storeBounds.width &&
               y >= storeBounds.y && y <= storeBounds.y + storeBounds.height;
    }

    function potenciaToDbm(p) { return -p; }

    // Modelo de dos tramos (igual que RF Simulator)
    // Tramo 1 (0-600px): pathLoss = 10.86 + 14.5*log10(dist)
    // Tramo 2 (600-1100px): lineal de -60 a -90 dBm
    function getRawCoverageRadius() {
        return 1100; // Raw siempre cubre toda la tienda
    }

    function getCoverageRadius(dbm) {
        if (dbm >= -60.1) {
            return Math.max(5, Math.pow(10, (-19.86 - dbm) / 14.5));
        } else {
            var t = (-60.1 - dbm) / 29.9;
            return 600 + t * 500;
        }
    }

    // Cálculo de señal RAW (visión natural) — SIN atenuación de obstáculos
    function calculateRawSignalAt(x, y) {
        var dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return 0;
        var pathLoss;
        if (dist <= 600) {
            pathLoss = 14.5 * Math.log10(dist);
        } else {
            var t = (dist - 600) / 500;
            pathLoss = 14.5 * Math.log10(600) + t * 60;
        }
        return Math.max(-100, Math.min(0, -pathLoss));
    }

    // Cálculo de señal con atenuaciones completas:
    // - Path loss (distancia)
    // - Personas (cuerpos de agua: 2.8 dB c/u)
    // - Anaqueles (5.0 dB c/u)
    // - Paredes de concreto (20 dB)
    // - Ventanas de vidrio (8 dB)
    // - Lluvia (0/4/8 dB global)
    // - Temperatura extrema (1 dB drift)
    function calculateSignalAt(x, y) {
        var dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return -20;

        var pathLoss;
        if (dist <= 600) {
            pathLoss = 10.86 + 14.5 * Math.log10(dist);
        } else {
            var t = (dist - 600) / 500;
            pathLoss = 10.86 + 14.5 * Math.log10(600) + t * 29.9;
        }

        // Atenuación por personas (cuerpos de agua)
        var waterAtten = 0;
        var ant = { x: antenna.x, y: antenna.y };
        var tgt = { x: x, y: y };
        people.forEach(function(p) {
            var d = pointToSegmentDistance(p, ant, tgt);
            if (d < 20) waterAtten += 2.8;
        });

        // Atenuación por anaqueles
        var shelfAtten = 0;
        shelves.forEach(function(s) {
            if (lineIntersectsRect(ant, tgt, s)) shelfAtten += 5.0;
        });

        // Atenuación por paredes/ventanas (solo si la señal cruza la pared)
        var wallAtten = 0;
        var inAnt = isInStore(ant.x, ant.y);
        var inPt = isInStore(x, y);
        if (inAnt !== inPt) {
            wallAtten = wallAttenForExit(storeBounds, windows, ant, tgt);
        }

        // Atenuación por clima
        var climateAtten = lluviaAtten + tempAtten;

        var rxSignal = -pathLoss - waterAtten - shelfAtten - wallAtten - climateAtten;
        return Math.max(-100, Math.min(-20, rxSignal));
    }

    // Calcular señal para paseantes (umbral menos estricto que visitas)
    function calculatePaseantesSignalAt(x, y) {
        return calculateSignalAt(x, y);
    }

    function wallAttenForExit(bounds, wins, ant, tgt) {
        // Izquierda
        if ((ant.x <= bounds.x && tgt.x >= bounds.x) || (ant.x >= bounds.x && tgt.x <= bounds.x)) {
            var t = (bounds.x - ant.x) / (tgt.x - ant.x);
            var cy = ant.y + t * (tgt.y - ant.y);
            if (cy >= bounds.y && cy <= bounds.y + bounds.height)
                return passesWindow(wins, 'left', cy) ? WINDOW_ATTEN : WALL_ATTEN;
        }
        // Derecha
        if ((ant.x <= bounds.x + bounds.width && tgt.x >= bounds.x + bounds.width) || (ant.x >= bounds.x + bounds.width && tgt.x <= bounds.x + bounds.width)) {
            var t2 = ((bounds.x + bounds.width) - ant.x) / (tgt.x - ant.x);
            var cy2 = ant.y + t2 * (tgt.y - ant.y);
            if (cy2 >= bounds.y && cy2 <= bounds.y + bounds.height)
                return passesWindow(wins, 'right', cy2) ? WINDOW_ATTEN : WALL_ATTEN;
        }
        // Arriba
        if ((ant.y <= bounds.y && tgt.y >= bounds.y) || (ant.y >= bounds.y && tgt.y <= bounds.y)) {
            var t3 = (bounds.y - ant.y) / (tgt.y - ant.y);
            var cx = ant.x + t3 * (tgt.x - ant.x);
            if (cx >= bounds.x && cx <= bounds.x + bounds.width)
                return passesWindow(wins, 'top', cx) ? WINDOW_ATTEN : WALL_ATTEN;
        }
        // Abajo
        if ((ant.y <= bounds.y + bounds.height && tgt.y >= bounds.y + bounds.height) || (ant.y >= bounds.y + bounds.height && tgt.y <= bounds.y + bounds.height)) {
            var t4 = ((bounds.y + bounds.height) - ant.y) / (tgt.y - ant.y);
            var cx2 = ant.x + t4 * (tgt.x - ant.x);
            if (cx2 >= bounds.x && cx2 <= bounds.x + bounds.width)
                return passesWindow(wins, 'bottom', cx2) ? WINDOW_ATTEN : WALL_ATTEN;
        }
        return 0;
    }

    function passesWindow(wins, wall, pos) {
        for (var i = 0; i < wins.length; i++) {
            if (wins[i].wall === wall && pos >= wins[i].start && pos <= wins[i].end) return true;
        }
        return false;
    }

    function pointToSegmentDistance(p, a, b) {
        var l2 = Math.hypot(a.x - b.x, a.y - b.y);
        if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        var t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l2 * l2);
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
    }

    function lineIntersectsRect(p1, p2, r) {
        var lines = [
            [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y}],
            [{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h}],
            [{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}],
            [{x:r.x,y:r.y+r.h},{x:r.x,y:r.y}]
        ];
        return lines.some(function(l) { return linesIntersect(p1, p2, l[0], l[1]); });
    }

    function linesIntersect(a, b, c, d) {
        var ccw = function(p1, p2, p3) { return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x); };
        return (ccw(a, c, d) !== ccw(b, c, d)) && (ccw(a, b, c) !== ccw(a, b, d));
    }

    function loadPreset(type) {
        people = [];
        shelves = [
            { x: 180, y: 120, w: 220, h: 30 },
            { x: 180, y: 220, w: 220, h: 30 },
            { x: 180, y: 320, w: 220, h: 30 },
            { x: 480, y: 120, w: 160, h: 30 }
        ];
        if (type === 'empty') {
        } else if (type === 'low') {
            for (var i = 0; i < 8; i++) people.push({ x: 80 + Math.random() * 600, y: 70 + Math.random() * 340 });
        } else if (type === 'average') {
            for (var i = 0; i < 20; i++) people.push({ x: 80 + Math.random() * 620, y: 70 + Math.random() * 340 });
        } else if (type === 'high') {
            for (var i = 0; i < 50; i++) people.push({ x: 80 + Math.random() * 620, y: 70 + Math.random() * 340 });
        }
    }

    function animate() {
        if (!isPaused) wavePhase = (wavePhase + 0.4) % 40;
        var tab = document.getElementById('tab-reduccion');
        if (tab && tab.classList.contains('active')) drawSim();
        requestAnimationFrame(animate);
    }

    function toggleAnimation() {
        isPaused = !isPaused;
        var btn = document.getElementById('btn-red-toggle-anim');
        if (btn) {
            if (isPaused) { btn.innerHTML = '\u25b6 Reanudar'; btn.className = 'btn'; }
            else { btn.innerHTML = '\u23f8 Pausar'; btn.className = 'btn'; }
        }
    }

    function drawSim() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo
        ctx.fillStyle = "#F0F0F2";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Piso de tienda
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(storeBounds.x, storeBounds.y, storeBounds.width, storeBounds.height);

        var rawDbm = -100;
        var paseantesDbm = potenciaToDbm(paseantesPotencia);
        var visitasDbm = potenciaToDbm(visitasPotencia);
        var rawRadius = getRawCoverageRadius();
        var paseantesRadius = getCoverageRadius(paseantesDbm);
        var visitasRadius = getCoverageRadius(visitasDbm);

        // === HEATMAP de 4 zonas ===
        // Verde: visitas (dentro de calibración de visitas)
        // Rojo: paseantes (dentro de paseantes pero no visitas)
        // Azul: raw (detectado pero no paseante)
        // Gris: fuera de raw
        var gridSize = 20;
        for (var x = 0; x < canvas.width; x += gridSize) {
            for (var y = 0; y < canvas.height; y += gridSize) {
                var cx = x + gridSize/2, cy = y + gridSize/2;
                var rawSig = calculateRawSignalAt(cx, cy);
                var visSig = calculateSignalAt(cx, cy);
                var pasSig = calculatePaseantesSignalAt(cx, cy);
                if (visSig >= visitasDbm) {
                    ctx.fillStyle = 'rgba(44,173,120,0.16)';
                } else if (pasSig >= paseantesDbm) {
                    ctx.fillStyle = 'rgba(231,76,60,0.13)';
                } else if (rawSig >= rawDbm) {
                    ctx.fillStyle = 'rgba(52,152,219,0.10)';
                } else {
                    ctx.fillStyle = 'rgba(220,224,230,0.20)';
                }
                ctx.fillRect(x, y, gridSize, gridSize);
            }
        }

        // === ONDA RAW (azul) — siempre cubre toda la tienda ===
        ctx.save();
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, rawRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(41,128,185,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);

        // Ondas concéntricas raw
        for (var r = wavePhase; r < rawRadius; r += 50) {
            var rawIntensity = Math.max(0, 1 - r / rawRadius);
            ctx.beginPath();
            ctx.arc(antenna.x, antenna.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(52,152,219,' + (rawIntensity * 0.2) + ')';
            ctx.lineWidth = 1;
            ctx.setLineDash([8,12]); ctx.stroke(); ctx.setLineDash([]);
        }

        // Etiqueta raw
        var rawLabelAngle = -Math.PI / 4;
        var rawLX = antenna.x + Math.cos(rawLabelAngle) * rawRadius;
        var rawLY = antenna.y + Math.sin(rawLabelAngle) * rawRadius;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        var rawLabel = 'Raw -100 dBm';
        var rawLW = ctx.measureText(rawLabel).width;
        ctx.fillRect(rawLX - rawLW/2 - 4, rawLY - 16, rawLW + 8, 14);
        ctx.fillStyle = 'rgba(41,128,185,0.9)';
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(rawLabel, rawLX, rawLY - 6);
        ctx.restore();

        // === ONDA PASEANTES (rojo) ===
        ctx.save();
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, paseantesRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(231,76,60,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);

        for (var r2 = wavePhase; r2 < paseantesRadius; r2 += 35) {
            var pasIntensity = Math.max(0, 1 - r2 / paseantesRadius);
            ctx.beginPath();
            ctx.arc(antenna.x, antenna.y, r2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(231,76,60,' + (pasIntensity * 0.25) + ')';
            ctx.lineWidth = 1;
            ctx.setLineDash([8,8]); ctx.stroke(); ctx.setLineDash([]);
        }

        var pasLabelAngle = Math.PI / 4;
        var pasLX = antenna.x + Math.cos(pasLabelAngle) * paseantesRadius;
        var pasLY = antenna.y + Math.sin(pasLabelAngle) * paseantesRadius;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        var pasLabel = 'Paseantes ' + paseantesDbm + ' dBm';
        var pasLW = ctx.measureText(pasLabel).width;
        ctx.fillRect(pasLX - pasLW/2 - 4, pasLY - 16, pasLW + 8, 14);
        ctx.fillStyle = 'rgba(231,76,60,0.9)';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(pasLabel, pasLX, pasLY - 6);
        ctx.restore();

        // === ONDA VISITAS (verde) — clip a tienda ===
        ctx.save();
        ctx.beginPath();
        ctx.rect(storeBounds.x, storeBounds.y, storeBounds.width, storeBounds.height);
        ctx.clip();

        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, visitasRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(44,173,120,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);

        for (var r3 = wavePhase; r3 < visitasRadius; r3 += 30) {
            var visIntensity = Math.max(0, 1 - r3 / visitasRadius);
            ctx.beginPath();
            ctx.arc(antenna.x, antenna.y, r3, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(44,173,120,' + (visIntensity * 0.35) + ')';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([10,8]); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.restore();

        // Etiqueta visitas
        var visLabelAngle = 0;
        var visLX = antenna.x + Math.cos(visLabelAngle) * visitasRadius;
        var visLY = antenna.y + Math.sin(visLabelAngle) * visitasRadius;
        if (isInStore(visLX, visLY)) {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            var visLabel = 'Visitas ' + visitasDbm + ' dBm';
            var visLW = ctx.measureText(visLabel).width;
            ctx.fillRect(visLX - visLW/2 - 4, visLY - 16, visLW + 8, 14);
            ctx.fillStyle = 'rgba(44,173,120,0.9)';
            ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(visLabel, visLX, visLY - 6);
        }

        // === PAREDES DE CONCRETO con VENTANAS ===
        drawWallsWithWindows(storeBounds, windows);

        // Zona de cajas
        ctx.fillStyle = "#EAECEE";
        ctx.strokeStyle = "#BDC3C7";
        ctx.lineWidth = 1.5;
        ctx.fillRect(cashierZone.x, cashierZone.y, cashierZone.width, cashierZone.height);
        ctx.strokeRect(cashierZone.x, cashierZone.y, cashierZone.width, cashierZone.height);
        ctx.fillStyle = "#7F8C8D";
        ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("ÁREA DE CAJAS", cashierZone.x + cashierZone.width/2, cashierZone.y + cashierZone.height/2 + 16);

        // Anaqueles
        ctx.fillStyle = "#34495E";
        shelves.forEach(function(s) {
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.strokeStyle = "#2C3E50";
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "10px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("ANAQUEL", s.x + s.w/2, s.y + s.h/2 + 3);
            ctx.fillStyle = "#34495E";
        });

        // Antena
        ctx.save();
        ctx.fillStyle = "#8E44AD";
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#9B59B6"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, 16 + Math.sin(Date.now()/200)*3, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("ANTENA", antenna.x, antenna.y + 3);
        ctx.restore();

        // Personas + métricas
        var rawCount = 0, paseantesCount = 0, visitasCount = 0;
        people.forEach(function(p) {
            var visSig = calculateSignalAt(p.x, p.y);
            var pasSig = calculatePaseantesSignalAt(p.x, p.y);
            var rawSig = calculateRawSignalAt(p.x, p.y);

            var inVis = visSig >= visitasDbm;
            var inPas = pasSig >= paseantesDbm; // incluye visitas (toda visita es paseante)
            if (inVis) visitasCount++;
            if (inPas) paseantesCount++; // cuenta visitas + paseantes-only
            if (rawSig >= rawDbm) rawCount++; // total detectado por raw (incluye todo)

            var personColor, bgColor, labelIcon;
            if (inVis) {
                personColor = "#2CAD78"; bgColor = "rgba(44,173,120,0.25)"; labelIcon = "V";
            } else if (inPas) {
                personColor = "#E74C3C"; bgColor = "rgba(231,76,60,0.22)"; labelIcon = "P";
            } else if (rawSig >= rawDbm) {
                personColor = "#F39C12"; bgColor = "rgba(243,156,18,0.20)"; labelIcon = "R";
            } else {
                personColor = "#95A5A6"; bgColor = "rgba(149,165,166,0.15)"; labelIcon = "\u2717";
            }

            ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = bgColor; ctx.fill();
            ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            ctx.fillStyle = personColor; ctx.fill();
            ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
            ctx.fillText(labelIcon, p.x, p.y + 3);

            // Etiqueta de potencia sobre la persona
            var powerLabel;
            if (inVis) {
                powerLabel = Math.round(visSig) + ' dBm';
            } else if (inPas) {
                powerLabel = Math.round(pasSig) + ' dBm';
            } else if (rawSig >= rawDbm) {
                powerLabel = Math.round(rawSig) + ' dBm';
            } else {
                powerLabel = 'N/A';
            }
            ctx.fillStyle = personColor;
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(powerLabel, p.x, p.y - 16);
        });

        // Métricas
        var mR = document.getElementById('red-metric-raw');
        var mP = document.getElementById('red-metric-paseantes');
        var mV = document.getElementById('red-metric-visitas');
        var badge = document.getElementById('red-status-badge');
        if (mR) mR.innerText = rawCount;
        if (mP) mP.innerText = paseantesCount;
        if (mV) mV.innerText = visitasCount;
        if (badge) {
            if (visitasPotencia > paseantesPotencia) {
                badge.innerText = 'VISITAS > PASEANTES (INVÁLIDO)'; badge.className = 'badge badge-red';
            } else {
                badge.innerText = 'CALIBRACIÓN OK'; badge.className = 'badge badge-green';
            }
        }
    }

    function drawWallsWithWindows(bounds, wins) {
        // Paredes de concreto (color marrón)
        ctx.strokeStyle = '#8B7355';
        ctx.lineWidth = bounds.wallThickness;

        // 4 paredes
        ctx.beginPath();
        ctx.moveTo(bounds.x - bounds.wallThickness/2, bounds.y);
        ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, bounds.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bounds.x - bounds.wallThickness/2, bounds.y + bounds.height);
        ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, bounds.y + bounds.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bounds.x, bounds.y - bounds.wallThickness/2);
        ctx.lineTo(bounds.x, bounds.y + bounds.height + bounds.wallThickness/2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bounds.x + bounds.width, bounds.y - bounds.wallThickness/2);
        ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height + bounds.wallThickness/2);
        ctx.stroke();

        // Textura de concreto
        ctx.strokeStyle = '#6B5B45'; ctx.lineWidth = 1;
        for (var x = bounds.x; x < bounds.x + bounds.width; x += 8) {
            ctx.beginPath(); ctx.moveTo(x, bounds.y - bounds.wallThickness/2);
            ctx.lineTo(x + 8, bounds.y + bounds.wallThickness/2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, bounds.y + bounds.height - bounds.wallThickness/2);
            ctx.lineTo(x + 8, bounds.y + bounds.height + bounds.wallThickness/2); ctx.stroke();
        }
        for (var y = bounds.y; y < bounds.y + bounds.height; y += 8) {
            ctx.beginPath(); ctx.moveTo(bounds.x - bounds.wallThickness/2, y);
            ctx.lineTo(bounds.x + bounds.wallThickness/2, y + 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(bounds.x + bounds.width - bounds.wallThickness/2, y);
            ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, y + 8); ctx.stroke();
        }

        // Ventanas (vidrio azul transparente)
        wins.forEach(function(win) {
            ctx.save();
            if (win.wall === 'left') {
                ctx.clearRect(bounds.x - bounds.wallThickness/2 - 1, win.start, bounds.wallThickness + 2, win.end - win.start);
                ctx.fillStyle = 'rgba(135,206,235,0.6)';
                ctx.fillRect(bounds.x - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
                ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5;
                ctx.strokeRect(bounds.x - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
            } else if (win.wall === 'right') {
                ctx.clearRect(bounds.x + bounds.width - bounds.wallThickness/2 - 1, win.start, bounds.wallThickness + 2, win.end - win.start);
                ctx.fillStyle = 'rgba(135,206,235,0.6)';
                ctx.fillRect(bounds.x + bounds.width - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
                ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5;
                ctx.strokeRect(bounds.x + bounds.width - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
            } else if (win.wall === 'bottom') {
                ctx.clearRect(win.start, bounds.y + bounds.height - bounds.wallThickness/2 - 1, win.end - win.start, bounds.wallThickness + 2);
                ctx.fillStyle = 'rgba(135,206,235,0.6)';
                ctx.fillRect(win.start, bounds.y + bounds.height - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
                ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5;
                ctx.strokeRect(win.start, bounds.y + bounds.height - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
            } else if (win.wall === 'top') {
                ctx.clearRect(win.start, bounds.y - bounds.wallThickness/2 - 1, win.end - win.start, bounds.wallThickness + 2);
                ctx.fillStyle = 'rgba(135,206,235,0.6)';
                ctx.fillRect(win.start, bounds.y - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
                ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5;
                ctx.strokeRect(win.start, bounds.y - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
            }
            ctx.restore();
        });

        // Etiqueta de tienda
        ctx.fillStyle = '#2C3E50'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('TIENDA GETIN', bounds.x + bounds.width/2, bounds.y - 14);

        // Puerta (entrada principal) — gap en pared superior
        var doorX = bounds.x + 60;
        var doorW = 140;
        ctx.clearRect(doorX, bounds.y - bounds.wallThickness/2 - 1, doorW, bounds.wallThickness + 2);
        ctx.strokeStyle = '#2CAD78'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(doorX, bounds.y - 2); ctx.lineTo(doorX + doorW, bounds.y - 2); ctx.stroke();
        ctx.fillStyle = '#2CAD78'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('ENTRADA', doorX + doorW/2, bounds.y - 8);

        // Etiqueta de ventanas
        ctx.fillStyle = '#5DADE2'; ctx.font = 'bold 9px sans-serif';
        wins.forEach(function(win) {
            var mid = (win.start + win.end) / 2;
            if (win.wall === 'left') ctx.fillText('VIDRIO', bounds.x - 20, mid);
            else if (win.wall === 'bottom') ctx.fillText('VIDRIO', mid, bounds.y + bounds.height + 18);
        });
    }

    function setupCanvasEvents() {
        if (!canvas) return;
        var getPos = function(e) {
            var rect = canvas.getBoundingClientRect();
            var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
            var cx = e.touches ? e.touches[0].clientX : e.clientX;
            var cy = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
        };
        var handleDown = function(e) {
            var pos = getPos(e);
            if (mode === 'antenna') {
                if (Math.hypot(pos.x - antenna.x, pos.y - antenna.y) < 20) isDraggingAntenna = true;
                else { antenna.x = pos.x; antenna.y = pos.y; }
                return;
            }
            var hit = people.findIndex(function(p) { return Math.hypot(p.x - pos.x, p.y - pos.y) < 16; });
            if (hit !== -1) { draggedPerson = hit; isDragging = true; return; }
            if (mode === 'person') people.push({x: pos.x, y: pos.y});
            else if (mode === 'shelf') shelves.push({x: pos.x - 40, y: pos.y - 15, w: 80, h: 30});
        };
        var handleMove = function(e) {
            var pos = getPos(e);
            if (isDraggingAntenna) { antenna.x = Math.max(10, Math.min(canvas.width-10, pos.x)); antenna.y = Math.max(10, Math.min(canvas.height-10, pos.y)); return; }
            if (isDragging && draggedPerson !== null) { people[draggedPerson].x = pos.x; people[draggedPerson].y = pos.y; }
        };
        var handleUp = function() { isDragging = false; draggedPerson = null; isDraggingAntenna = false; };

        canvas.addEventListener('mousedown', handleDown);
        canvas.addEventListener('mousemove', handleMove);
        canvas.addEventListener('mouseup', handleUp);
        canvas.addEventListener('touchstart', function(e) { e.preventDefault(); handleDown(e); }, {passive:false});
        canvas.addEventListener('touchmove', function(e) { e.preventDefault(); handleMove(e); }, {passive:false});
        canvas.addEventListener('touchend', handleUp);
    }

    return {
        initSim: initSim, setMode: setMode, updatePaseantes: updatePaseantes,
        updateVisitas: updateVisitas, updateClima: updateClima, updateTemperatura: updateTemperatura,
        clearElements: clearElements, loadPreset: loadPreset, toggleAnimation: toggleAnimation
    };
})();