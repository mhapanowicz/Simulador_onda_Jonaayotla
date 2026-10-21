const ReduccionSimulator = (function() {
    var canvas, ctx;
    var mode = 'person';
    var people = [];
    var shelves = [];
    var wavePhase = 0;
    var isDragging = false;
    var draggedPerson = null;
    var isDraggingAntenna = false;
    var isDraggingCashier = false;
    var cashierDragOffset = { x: 0, y: 0 };
    var isAnimRunning = false;
    var isPaused = false;
    var zoomLevel = 1; // 1 = normal, 0.5 = vista amplia
    var ZOOM_NORMAL = 1;
    var ZOOM_WIDE = 0.5;
    var ZOOM_MIN = 0.3;
    var ZOOM_MAX = 1.5;
    // Pan: desplazamiento del zoom (para centrar donde se hizo zoom)
    var panX = 0;
    var panY = 0;

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
    var DOOR_ATTEN = 0;       // Puerta abierta (sin material)
    var CASHIER_ATTEN = 7;   // Área de cajas (mobiliario + equipos)
    var lluviaAtten = 0;
    var tempAtten = 0;

    // Ventanas en las paredes (posiciones absolutas en px)
    var windows = [
        { wall: 'left',   start: 120, end: 220 },  // ventana izquierda (~10m)
        { wall: 'bottom', start: 200, end: 340 }   // ventana abajo (~14m)
    ];

    // Puertas abiertas (entrada sin material — 0 dB atenuación)
    var doors = [
        { wall: 'top', start: 100, end: 240 }   // entrada principal (pared superior, 140px = 14m)
    ];

    // === SISTEMA DE ARQUITECTURAS ===
    var currentArchitecture = 'convencional';
    var architectures = {
        convencional: {
            name: 'Tienda Convencional',
            topWallMaterial: 'concrete', // pared superior de concreto con puerta abierta
            windows: [
                { wall: 'left',   start: 120, end: 220 },
                { wall: 'bottom', start: 200, end: 340 }
            ],
            doors: [
                { wall: 'top', start: 100, end: 240 }
            ]
        },
        fachada_vitrina: {
            name: 'Fachada Vitrina',
            topWallMaterial: 'glass', // pared superior toda de vidrio (8 dB) excepto puerta (gap, 0 dB)
            windows: [
                { wall: 'left',   start: 120, end: 220 },
                { wall: 'bottom', start: 200, end: 340 }
            ],
            doors: [
                { wall: 'top', start: 100, end: 240 }
            ]
        },
        fachada_abierta: {
            name: 'Fachada Abierta',
            topWallMaterial: 'open', // pared superior toda abierta (0 dB)
            windows: [
                { wall: 'left',   start: 120, end: 220 },
                { wall: 'bottom', start: 200, end: 340 }
            ],
            doors: [
                { wall: 'top', start: 40, end: 760 } // entrada abarca toda la fachada
            ]
        }
    };

    function setArchitecture(archId) {
        var arch = architectures[archId];
        if (!arch) return;
        currentArchitecture = archId;
        windows = arch.windows;
        doors = arch.doors;
    }

    // Potencias: 0-100 donde 100 = más sensible (ve más lejos)
    var paseantesPotencia = 85;
    var visitasPotencia = 75;

    // === MODELO DE PROPAGACIÓN (mismo del RF Simulator) ===
    var RAW_DBM = -100;

    function toggleZoom() {
        zoomLevel = (zoomLevel === ZOOM_NORMAL) ? ZOOM_WIDE : ZOOM_NORMAL;
        // Reset pan al cambiar de modo
        panX = 0;
        panY = 0;
        var btn = document.getElementById('btn-red-zoom');
        if (btn) {
            btn.innerHTML = (zoomLevel === ZOOM_WIDE) ? '\ud83d\udd0d Vista Normal' : '\ud83d\udd0d Vista Amplia';
        }
    }

    function setZoom(newZoom, centerX, centerY) {
        newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
        zoomLevel = newZoom;
        var btn = document.getElementById('btn-red-zoom');
        if (btn) {
            btn.innerHTML = (Math.abs(zoomLevel - 1) < 0.01) ? '\ud83d\udd0d Vista Amplia' : '\ud83d\udd0d Vista Normal';
        }
    }

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
        var btnC = document.getElementById('btn-red-move-cashier');
        if (btnP) btnP.className = mode === 'person' ? 'btn btn-primary' : 'btn';
        if (btnS) btnS.className = mode === 'shelf' ? 'btn btn-primary' : 'btn';
        if (btnA) btnA.className = mode === 'antenna' ? 'btn btn-primary' : 'btn';
        if (btnC) btnC.className = mode === 'cashier' ? 'btn btn-primary' : 'btn';
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

    function isInCashierZone(x, y) {
        return x >= cashierZone.x && x <= cashierZone.x + cashierZone.width &&
               y >= cashierZone.y && y <= cashierZone.y + cashierZone.height;
    }

    // Atenuación por área de cajas:
    // - Si la antena está dentro del área: +7 dB a toda la señal (penalización global)
    // - Si la línea antena→punto atraviesa el área: +7 dB adicionales
    function calculateCashierAtten(ant, tgt) {
        var atten = 0;
        // Caso 1: antena dentro del área de cajas
        if (isInCashierZone(ant.x, ant.y)) atten += CASHIER_ATTEN;
        // Caso 2: la señal atraviesa el área de cajas
        if (lineIntersectsRect(ant, tgt, cashierZone)) atten += CASHIER_ATTEN;
        return atten;
    }

    function potenciaToDbm(p) { return -p; }

    // Modelo de dos tramos (igual que RF Simulator)
    // Tramo 1 (0-600px): pathLoss = 10.86 + 14.5*log10(dist)
    // Tramo 2 (600-1100px): lineal de -60 a -90 dBm
    function getRawCoverageRadius() {
        return 616; // Raw reducido 30% adicional (880 * 0.7)
    }

    function getCoverageRadius(dbm) {
        if (dbm >= -60.1) {
            return Math.max(5, Math.pow(10, (-19.86 - dbm) / 14.5));
        } else {
            var t = (-60.1 - dbm) / 29.9;
            return 420 + t * 196; // tramo 2: 420 a 616 (reducido 30% adicional)
        }
    }

    // Cálculo de señal RAW (visión natural) — SIN atenuación de obstáculos
    // Cálculo de señal RAW (visión natural) — ahora CON atenuaciones reales
    // Raw usa rango 0 a -100 dBm y también se atenúa por obstáculos
    // La diferencia con visitas es el rango (0 a -100 vs -20 a -90) y el modelo de path loss
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

        // Atenuaciones (igual que visitas pero en rango raw 0 a -100 dBm)
        var ant = { x: antenna.x, y: antenna.y };
        var tgt = { x: x, y: y };
        var waterAtten = 0;
        people.forEach(function(p) {
            var d = pointToSegmentDistance(p, ant, tgt);
            if (d < 20) waterAtten += 2.8;
        });
        var shelfAtten = 0;
        shelves.forEach(function(s) {
            if (lineIntersectsRect(ant, tgt, s)) shelfAtten += 5.0;
        });
        var wallAtten = 0;
        var inAnt = isInStore(ant.x, ant.y);
        var inPt = isInStore(x, y);
        if (inAnt !== inPt) {
            wallAtten = wallAttenForExit(storeBounds, windows, doors, ant, tgt);
        }
        var climateAtten = lluviaAtten + tempAtten;
        var cashierAtten = calculateCashierAtten(ant, tgt);

        var rxSignal = -pathLoss - waterAtten - shelfAtten - wallAtten - climateAtten - cashierAtten;
        return Math.min(0, rxSignal); // sin clamp inferior — si baja de -100 está fuera de rango
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
            wallAtten = wallAttenForExit(storeBounds, windows, doors, ant, tgt);
        }

        // Atenuación por clima
        var climateAtten = lluviaAtten + tempAtten;
        var cashierAtten = calculateCashierAtten(ant, tgt);

        var rxSignal = -pathLoss - waterAtten - shelfAtten - wallAtten - climateAtten - cashierAtten;
        return Math.min(-20, rxSignal); // sin clamp inferior — si baja de -100 está fuera de rango
    }

    // Calcular señal para paseantes (umbral menos estricto que visitas)
    function calculatePaseantesSignalAt(x, y) {
        return calculateSignalAt(x, y);
    }

    function wallAttenForExit(bounds, wins, doors, ant, tgt) {
        // Izquierda
        if ((ant.x <= bounds.x && tgt.x >= bounds.x) || (ant.x >= bounds.x && tgt.x <= bounds.x)) {
            var t = (bounds.x - ant.x) / (tgt.x - ant.x);
            var cy = ant.y + t * (tgt.y - ant.y);
            if (cy >= bounds.y && cy <= bounds.y + bounds.height) {
                if (passesDoor(doors, 'left', cy)) return DOOR_ATTEN;
                return passesWindow(wins, 'left', cy) ? WINDOW_ATTEN : WALL_ATTEN;
            }
        }
        // Derecha
        if ((ant.x <= bounds.x + bounds.width && tgt.x >= bounds.x + bounds.width) || (ant.x >= bounds.x + bounds.width && tgt.x <= bounds.x + bounds.width)) {
            var t2 = ((bounds.x + bounds.width) - ant.x) / (tgt.x - ant.x);
            var cy2 = ant.y + t2 * (tgt.y - ant.y);
            if (cy2 >= bounds.y && cy2 <= bounds.y + bounds.height) {
                if (passesDoor(doors, 'right', cy2)) return DOOR_ATTEN;
                return passesWindow(wins, 'right', cy2) ? WINDOW_ATTEN : WALL_ATTEN;
            }
        }
        // Arriba
        if ((ant.y <= bounds.y && tgt.y >= bounds.y) || (ant.y >= bounds.y && tgt.y <= bounds.y)) {
            var t3 = (bounds.y - ant.y) / (tgt.y - ant.y);
            var cx = ant.x + t3 * (tgt.x - ant.x);
            if (cx >= bounds.x && cx <= bounds.x + bounds.width) {
                if (passesDoor(doors, 'top', cx)) return DOOR_ATTEN;
                // Fachada Vitrina: vidrio (8 dB). Fachada Abierta: todo abierto (0 dB)
                var topMat = architectures[currentArchitecture].topWallMaterial;
                if (topMat === 'glass') return WINDOW_ATTEN;
                if (topMat === 'open') return 0;
                return passesWindow(wins, 'top', cx) ? WINDOW_ATTEN : WALL_ATTEN;
            }
        }
        // Abajo
        if ((ant.y <= bounds.y + bounds.height && tgt.y >= bounds.y + bounds.height) || (ant.y >= bounds.y + bounds.height && tgt.y <= bounds.y + bounds.height)) {
            var t4 = ((bounds.y + bounds.height) - ant.y) / (tgt.y - ant.y);
            var cx2 = ant.x + t4 * (tgt.x - ant.x);
            if (cx2 >= bounds.x && cx2 <= bounds.x + bounds.width) {
                if (passesDoor(doors, 'bottom', cx2)) return DOOR_ATTEN;
                return passesWindow(wins, 'bottom', cx2) ? WINDOW_ATTEN : WALL_ATTEN;
            }
        }
        return 0;
    }

    function passesDoor(doors, wall, pos) {
        for (var i = 0; i < doors.length; i++) {
            if (doors[i].wall === wall && pos >= doors[i].start && pos <= doors[i].end) return true;
        }
        return false;
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


    // Dibujar onda deformada: contorno donde signalAt() = umbral
    // Muestrea N direcciones, búsqueda binaria de la distancia exacta
    function drawDeformedWave(thresholdDbm, maxRadius, strokeColor, waveColorPrefix, label, labelAngle, clipToStore, signalFn) {
        // signalFn: qué función de señal usar (calculateSignalAt para visitas/paseantes, calculateRawSignalAt para raw)
        var sigAt = signalFn || calculateSignalAt;
        var N = 72; // cada 5°
        var points = [];

        for (var i = 0; i <= N; i++) {
            var angle = (i / N) * Math.PI * 2;
            var cosA = Math.cos(angle), sinA = Math.sin(angle);

            // Búsqueda binaria: encontrar distancia donde signalAt = threshold
            var lo = 5, hi = maxRadius, mid, sig;
            for (var iter = 0; iter < 12; iter++) {
                mid = (lo + hi) / 2;
                var px = antenna.x + cosA * mid;
                var py = antenna.y + sinA * mid;
                sig = sigAt(px, py);
                if (sig >= thresholdDbm) {
                    lo = mid; // la señal aún llega, buscar más lejos
                } else {
                    hi = mid; // la señal no llega, buscar más cerca
                }
            }
            var r = lo;
            points.push({
                x: antenna.x + cosA * r,
                y: antenna.y + sinA * r
            });
        }

        ctx.save();
        if (clipToStore) {
            ctx.beginPath();
            ctx.rect(storeBounds.x, storeBounds.y, storeBounds.width, storeBounds.height);
            ctx.clip();
        }

        // Contorno principal (línea punteada)
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (var p = 1; p < points.length; p++) {
            ctx.lineTo(points[p].x, points[p].y);
        }
        ctx.closePath();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);

        // Ondas concéntricas animadas (proporción del contorno)
        for (var frac = (wavePhase / 40) * 0.2; frac < 1; frac += 0.2) {
            ctx.beginPath();
            for (var p2 = 0; p2 < points.length; p2++) {
                // Interpolar entre antena y el punto del contorno
                var ix = antenna.x + (points[p2].x - antenna.x) * frac;
                var iy = antenna.y + (points[p2].y - antenna.y) * frac;
                if (p2 === 0) ctx.moveTo(ix, iy);
                else ctx.lineTo(ix, iy);
            }
            ctx.closePath();
            var intensity = Math.max(0, 1 - frac);
            ctx.strokeStyle = waveColorPrefix + (intensity * 0.25) + ')';
            ctx.lineWidth = 1;
            ctx.setLineDash([8,12]); ctx.stroke(); ctx.setLineDash([]);
        }

        // Etiqueta
        var lx = antenna.x + Math.cos(labelAngle) * lo;
        var ly = antenna.y + Math.sin(labelAngle) * lo;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        var lw = ctx.measureText(label).width;
        ctx.fillRect(lx - lw/2 - 4, ly - 16, lw + 8, 14);
        ctx.fillStyle = strokeColor.replace(/0\.5\)/, '0.9)');
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label, lx, ly - 6);
        ctx.restore();
    }

    function drawSim() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo
        ctx.fillStyle = "#F0F0F2";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Aplicar zoom: centrar en la tienda, escalar
        ctx.save();
        if (zoomLevel < 1) {
            var cx = storeBounds.x + storeBounds.width / 2;
            var cy = storeBounds.y + storeBounds.height / 2;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(zoomLevel, zoomLevel);
            ctx.translate(-cx, -cy);
        }

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
        // En vista amplia, calcular el area visible segun zoom
        var heatW = canvas.width / zoomLevel;
        var heatH = canvas.height / zoomLevel;
        var heatOffsetX = zoomLevel < 1 ? (storeBounds.x + storeBounds.width/2) - heatW/2 : 0;
        var heatOffsetY = zoomLevel < 1 ? (storeBounds.y + storeBounds.height/2) - heatH/2 : 0;
        var gridSize = 20;
        for (var x = heatOffsetX; x < heatOffsetX + heatW; x += gridSize) {
            for (var y = heatOffsetY; y < heatOffsetY + heatH; y += gridSize) {
                var cx = x + gridSize/2, cy = y + gridSize/2;
                var rawSig = calculateRawSignalAt(cx, cy);
                var visSig = calculateSignalAt(cx, cy);
                var pasSig = calculatePaseantesSignalAt(cx, cy);
                if (visSig >= visitasDbm) {
                    // Verde visitas: intensidad proporcional a señal
                    var visAlpha = 0.10 + 0.10 * Math.max(0, (visSig - visitasDbm) / (0 - visitasDbm));
                    ctx.fillStyle = 'rgba(44,173,120,' + visAlpha + ')';
                } else if (pasSig >= paseantesDbm) {
                    // Rojo paseantes: intensidad proporcional
                    var pasAlpha = 0.08 + 0.08 * Math.max(0, (pasSig - paseantesDbm) / (visitasDbm - paseantesDbm));
                    ctx.fillStyle = 'rgba(231,76,60,' + pasAlpha + ')';
                } else if (rawSig >= rawDbm) {
                    // Azul raw: intensidad proporcional a señal raw (más fuerte = más intenso)
                    var rawAlpha = 0.05 + 0.15 * Math.max(0, (rawSig - rawDbm) / (0 - rawDbm));
                    ctx.fillStyle = 'rgba(52,152,219,' + rawAlpha + ')';
                } else {
                    ctx.fillStyle = 'rgba(220,224,230,0.20)';
                }
                ctx.fillRect(x, y, gridSize, gridSize);
            }
        }

        // === ONDAS DEFORMADAS POR ATENUACIÓN ===
        // Dibujar contorno real: para cada ángulo, buscar dónde signalAt = umbral
        // Esto hace que las ondas se deformen por personas, anaqueles, paredes, etc.

        // --- CÍRCULO MÁXIMO TEÓRICO RAW (área máxima sin obstáculos) ---
        ctx.save();
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, rawRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(41,128,185,0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3,6]); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();

        // --- CÍRCULO MÁXIMO TEÓRICO PASEANTES ---
        ctx.save();
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, paseantesRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(231,76,60,0.20)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3,6]); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();

        // --- CÍRCULO MÁXIMO TEÓRICO VISITAS ---
        ctx.save();
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, visitasRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(44,173,120,0.20)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3,6]); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();

        // --- ONDA RAW (azul) ---
        drawDeformedWave(rawDbm, rawRadius, 'rgba(41,128,185,0.5)', 'rgba(52,152,219,', 'Raw ' + rawDbm + ' dBm', -Math.PI/4, false, calculateRawSignalAt);

        // --- ONDA PASEANTES (rojo) ---
        drawDeformedWave(paseantesDbm, paseantesRadius, 'rgba(231,76,60,0.5)', 'rgba(231,76,60,', 'Paseantes ' + paseantesDbm + ' dBm', Math.PI/4, false, calculateSignalAt);

        // --- ONDA VISITAS (verde) — clip a tienda ---
        drawDeformedWave(visitasDbm, visitasRadius, 'rgba(44,173,120,0.5)', 'rgba(44,173,120,', 'Visitas ' + visitasDbm + ' dBm', 0, true, calculateSignalAt);

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
        ctx.fillStyle = mode === 'cashier' ? 'rgba(149,165,166,0.35)' : '#EAECEE';
        ctx.strokeStyle = mode === 'cashier' ? '#27AE60' : '#BDC3C7';
        ctx.lineWidth = mode === 'cashier' ? 2.5 : 1.5;
        if (mode === 'cashier') ctx.setLineDash([6,4]);
        ctx.fillRect(cashierZone.x, cashierZone.y, cashierZone.width, cashierZone.height);
        ctx.strokeRect(cashierZone.x, cashierZone.y, cashierZone.width, cashierZone.height);
        ctx.setLineDash([]);
        ctx.fillStyle = mode === 'cashier' ? '#27AE60' : '#7F8C8D';
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('ÁREA DE CAJAS', cashierZone.x + cashierZone.width/2, cashierZone.y + cashierZone.height/2 + 16);
        if (mode === 'cashier') {
            ctx.font = '9px sans-serif';
            ctx.fillText('arrastrar para mover', cashierZone.x + cashierZone.width/2, cashierZone.y + cashierZone.height/2 + 30);
        }

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

        ctx.restore(); // fin zoom

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
        var arch = architectures[currentArchitecture];
        // Paredes de concreto (color marrón)
        ctx.strokeStyle = '#8B7355';
        ctx.lineWidth = bounds.wallThickness;

        // --- PARED SUPERIOR ---
        if (arch.topWallMaterial === 'glass') {
            // Fachada Vitrina: toda la pared superior es vidrio excepto la puerta (gap)
            var topDoors = doors.filter(function(d) { return d.wall === 'top'; });
            var segments = [];
            var lastX = bounds.x;
            topDoors.forEach(function(d) {
                if (d.start > lastX) segments.push({ start: lastX, end: d.start });
                lastX = d.end;
            });
            if (lastX < bounds.x + bounds.width) segments.push({ start: lastX, end: bounds.x + bounds.width });
            segments.forEach(function(seg) {
                ctx.fillStyle = 'rgba(135,206,235,0.6)';
                ctx.fillRect(seg.start, bounds.y - bounds.wallThickness/2, seg.end - seg.start, bounds.wallThickness);
                ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5;
                ctx.strokeRect(seg.start, bounds.y - bounds.wallThickness/2, seg.end - seg.start, bounds.wallThickness);
            });
            ctx.fillStyle = '#2980B9'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
            segments.forEach(function(seg) {
                if (seg.end - seg.start > 50) {
                    ctx.fillText('FACHADA VITRINA', (seg.start + seg.end) / 2, bounds.y - bounds.wallThickness/2 - 6);
                }
            });
        } else if (arch.topWallMaterial === 'open') {
            // Fachada Abierta: toda la pared superior es entrada (gap) — no dibujar pared
            ctx.strokeStyle = '#2CAD78'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(bounds.x, bounds.y - 2); ctx.lineTo(bounds.x + bounds.width, bounds.y - 2); ctx.stroke();
            ctx.fillStyle = '#2CAD78'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('ENTRADA ABIERTA', bounds.x + bounds.width/2, bounds.y - 8);
        } else {
            // Concreto normal
            ctx.beginPath();
            ctx.moveTo(bounds.x - bounds.wallThickness/2, bounds.y);
            ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, bounds.y);
            ctx.stroke();
        }

        // --- PARED INFERIOR ---
        ctx.strokeStyle = '#8B7355'; ctx.lineWidth = bounds.wallThickness;
        ctx.beginPath();
        ctx.moveTo(bounds.x - bounds.wallThickness/2, bounds.y + bounds.height);
        ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, bounds.y + bounds.height);
        ctx.stroke();
        // --- PARED IZQUIERDA ---
        ctx.beginPath();
        ctx.moveTo(bounds.x, bounds.y - bounds.wallThickness/2);
        ctx.lineTo(bounds.x, bounds.y + bounds.height + bounds.wallThickness/2);
        ctx.stroke();
        // --- PARED DERECHA ---
        ctx.beginPath();
        ctx.moveTo(bounds.x + bounds.width, bounds.y - bounds.wallThickness/2);
        ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height + bounds.wallThickness/2);
        ctx.stroke();

        // Textura de concreto
        ctx.strokeStyle = '#6B5B45'; ctx.lineWidth = 1;
        // Pared superior — solo textura si es concreto
        if (arch.topWallMaterial === 'concrete') {
        for (var x = bounds.x; x < bounds.x + bounds.width; x += 8) {
            ctx.beginPath(); ctx.moveTo(x, bounds.y - bounds.wallThickness/2);
            ctx.lineTo(x + 8, bounds.y + bounds.wallThickness/2); ctx.stroke();
        }
        }
        // Pared inferior
        for (var x2 = bounds.x; x2 < bounds.x + bounds.width; x2 += 8) {
            ctx.beginPath(); ctx.moveTo(x2, bounds.y + bounds.height - bounds.wallThickness/2);
            ctx.lineTo(x2 + 8, bounds.y + bounds.height + bounds.wallThickness/2); ctx.stroke();
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

        // Puertas abiertas (entrada sin material — 0 dB atenuación)
        doors.forEach(function(door) {
            ctx.save();
            if (door.wall === 'top') {
                // En fachada_abierta la pared superior ya se dibujó como entrada abierta
                if (architectures[currentArchitecture].topWallMaterial === 'open') { ctx.restore(); return; }
                ctx.clearRect(door.start, bounds.y - bounds.wallThickness/2 - 1, door.end - door.start, bounds.wallThickness + 2);
                ctx.strokeStyle = '#2CAD78'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(door.start, bounds.y - 2); ctx.lineTo(door.end, bounds.y - 2); ctx.stroke();
                ctx.fillStyle = '#2CAD78'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('ENTRADA', (door.start + door.end) / 2, bounds.y - 8);
            } else if (door.wall === 'bottom') {
                ctx.clearRect(door.start, bounds.y + bounds.height - bounds.wallThickness/2 - 1, door.end - door.start, bounds.wallThickness + 2);
                ctx.strokeStyle = '#2CAD78'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(door.start, bounds.y + bounds.height + 2); ctx.lineTo(door.end, bounds.y + bounds.height + 2); ctx.stroke();
                ctx.fillStyle = '#2CAD78'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('ENTRADA', (door.start + door.end) / 2, bounds.y + bounds.height + 18);
            } else if (door.wall === 'left') {
                ctx.clearRect(bounds.x - bounds.wallThickness/2 - 1, door.start, bounds.wallThickness + 2, door.end - door.start);
                ctx.strokeStyle = '#2CAD78'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(bounds.x - 2, door.start); ctx.lineTo(bounds.x - 2, door.end); ctx.stroke();
                ctx.save(); ctx.translate(bounds.x - 14, (door.start + door.end) / 2); ctx.rotate(-Math.PI/2);
                ctx.fillStyle = '#2CAD78'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('ENTRADA', 0, 0); ctx.restore();
            } else if (door.wall === 'right') {
                ctx.clearRect(bounds.x + bounds.width - bounds.wallThickness/2 - 1, door.start, bounds.wallThickness + 2, door.end - door.start);
                ctx.strokeStyle = '#2CAD78'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(bounds.x + bounds.width + 2, door.start); ctx.lineTo(bounds.x + bounds.width + 2, door.end); ctx.stroke();
                ctx.save(); ctx.translate(bounds.x + bounds.width + 14, (door.start + door.end) / 2); ctx.rotate(Math.PI/2);
                ctx.fillStyle = '#2CAD78'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('ENTRADA', 0, 0); ctx.restore();
            }
            ctx.restore();
        });

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
            // Coordenada en el canvas sin transformación
            var rawX = (cx - rect.left) * sx;
            var rawY = (cy - rect.top) * sy;
            // Deshacer la transformación de zoom (igual que en drawSim)
            if (zoomLevel !== 1) {
                var storeCx = storeBounds.x + storeBounds.width / 2;
                var storeCy = storeBounds.y + storeBounds.height / 2;
                // Inverso de: translate(w/2,h/2) -> scale(z) -> translate(-cx,-cy)
                rawX = (rawX - canvas.width / 2) / zoomLevel + storeCx;
                rawY = (rawY - canvas.height / 2) / zoomLevel + storeCy;
            }
            return { x: rawX, y: rawY };
        };
        var handleDown = function(e) {
            var pos = getPos(e);
            if (mode === 'antenna') {
                if (Math.hypot(pos.x - antenna.x, pos.y - antenna.y) < 20) isDraggingAntenna = true;
                else { antenna.x = pos.x; antenna.y = pos.y; }
                return;
            }
            if (mode === 'cashier') {
                // Click dentro del área de cajas → iniciar arrastre
                if (isInCashierZone(pos.x, pos.y)) {
                    isDraggingCashier = true;
                    // Calcular offset para que no salte
                    cashierDragOffset = { x: pos.x - cashierZone.x, y: pos.y - cashierZone.y };
                } else {
                    // Click fuera → mover el centro del área de cajas al punto clickeado
                    cashierZone.x = Math.max(storeBounds.x, Math.min(storeBounds.x + storeBounds.width - cashierZone.width, pos.x - cashierZone.width/2));
                    cashierZone.y = Math.max(storeBounds.y, Math.min(storeBounds.y + storeBounds.height - cashierZone.height, pos.y - cashierZone.height/2));
                }
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
            if (isDraggingCashier) {
                // Mantener el área de cajas dentro de la tienda
                cashierZone.x = Math.max(storeBounds.x, Math.min(storeBounds.x + storeBounds.width - cashierZone.width, pos.x - cashierDragOffset.x));
                cashierZone.y = Math.max(storeBounds.y, Math.min(storeBounds.y + storeBounds.height - cashierZone.height, pos.y - cashierDragOffset.y));
                return;
            }
            if (isDragging && draggedPerson !== null) { people[draggedPerson].x = pos.x; people[draggedPerson].y = pos.y; }
        };
        var handleUp = function() { isDragging = false; draggedPerson = null; isDraggingAntenna = false; isDraggingCashier = false; };

        canvas.addEventListener('mousedown', handleDown);
        canvas.addEventListener('mousemove', handleMove);
        canvas.addEventListener('mouseup', handleUp);
        canvas.addEventListener('touchstart', function(e) { e.preventDefault(); handleDown(e); }, {passive:false});
        canvas.addEventListener('touchmove', function(e) { e.preventDefault(); handleMove(e); }, {passive:false});
        canvas.addEventListener('touchend', handleUp);

        // Zoom con rueda del mouse
        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(zoomLevel * delta);
        }, { passive: false });

        // Cursor del canvas según zoom
        canvas.style.cursor = zoomLevel !== 1 ? 'zoom-out' : 'zoom-in';
        // Actualizar cursor dinamicamente
        canvas.addEventListener('mouseenter', function() {
            canvas.style.cursor = Math.abs(zoomLevel - 1) < 0.01 ? 'zoom-in' : 'zoom-out';
        });
    }

    return {
        initSim: initSim, setMode: setMode, updatePaseantes: updatePaseantes,
        updateVisitas: updateVisitas, updateClima: updateClima, updateTemperatura: updateTemperatura,
        clearElements: clearElements, loadPreset: loadPreset, toggleAnimation: toggleAnimation,
        toggleZoom: toggleZoom, setArchitecture: setArchitecture
    };
})();