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

    // Canvas reducido a 700x500 (~30% menos área) para acercar la vista
    // y alivianar el render. Tienda 200x200 px sigue igual de grande.
    // Escala: 1 px = 0.05 m (20 px = 1 m)
    var PX_PER_METER = 20; // 1 px = 0.05 m
    var antenna = { x: 200, y: 150 };

    // Una sola tienda: 10m x 10m = 100 m² => 200x200 px
    var store = { x: 120, y: 50, width: 160, height: 200, wallThickness: 8 };
    var WALL_ATTEN = 20;
    var WINDOW_ATTEN = 8;

    // Ventanas en la tienda (posiciones absolutas en px)
    var windows = [
        { wall: 'left',   start: 90, end: 130 },  // ventana izquierda (~2m)
        { wall: 'bottom', start: 170, end: 230 }   // ventana abajo (~3m)
    ];

    // Potencias: 0-100 donde 100 = más sensible (ve más lejos)
    // En dBm: valor = -potencia
    var paseantesPotencia = 85;
    var visitasPotencia = 75;
    var lluviaAtten = 0;
    var tempAtten = 0;

    function initSim() {
        canvas = document.getElementById('reduccionCanvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        loadPreset('average');
        setupCanvasEvents();
        drawSim(); // Dibujo único, sin animation loop
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
        if (visitasPotencia < paseantesPotencia) {
            visitasPotencia = paseantesPotencia;
            var vS = document.getElementById('red-visitas-slider');
            var vV = document.getElementById('red-visitas-val');
            if (vS) vS.value = visitasPotencia;
            if (vV) vV.innerText = '-' + visitasPotencia;
        }
        var vS2 = document.getElementById('red-visitas-slider');
        if (vS2) vS2.max = paseantesPotencia;
        drawSim();
    }

    function updateVisitas(val) {
        visitasPotencia = Math.min(parseInt(val), paseantesPotencia);
        var el = document.getElementById('red-visitas-val');
        if (el) el.innerText = '-' + visitasPotencia;
        var vS = document.getElementById('red-visitas-slider');
        if (vS) vS.value = visitasPotencia;
        drawSim();
    }

    function updateClima() {
        var sel = document.getElementById('red-lluvia');
        if (sel) lluviaAtten = parseInt(sel.value);
        drawSim();
    }

    function updateTemperatura(val) {
        var temp = parseInt(val);
        var el = document.getElementById('red-temp-val');
        if (el) el.innerText = temp + '\u00b0C';
        tempAtten = (temp > 40 || temp < 0) ? 1 : 0;
        drawSim();
    }

    function clearElements() { people = []; shelves = []; drawSim(); }

    function loadPreset(type) {
        people = [];
        // Anaqueles dentro de la tienda (160x200, x:120-280, y:50-250)
        shelves = [
            { x: 145, y: 90, w: 36, h: 12 },
            { x: 235, y: 90, w: 36, h: 12 },
            { x: 145, y: 200, w: 36, h: 12 },
            { x: 235, y: 200, w: 36, h: 12 }
        ];
        if (type === 'empty') {
        } else if (type === 'low') {
            for (var i=0;i<4;i++) people.push({x:130+Math.random()*140, y:60+Math.random()*180});
            for (var i2=0;i2<5;i2++) people.push({x:30+Math.random()*340, y:20+Math.random()*30});
            for (var i3=0;i3<4;i3++) people.push({x:30+Math.random()*340, y:260+Math.random()*35});
        } else if (type === 'average') {
            for (var i=0;i<8;i++) people.push({x:130+Math.random()*140, y:60+Math.random()*180});
            for (var i2=0;i2<8;i2++) people.push({x:20+Math.random()*360, y:20+Math.random()*35});
            for (var i3=0;i3<8;i3++) people.push({x:20+Math.random()*360, y:260+Math.random()*35});
        } else if (type === 'high') {
            for (var i=0;i<15;i++) people.push({x:130+Math.random()*140, y:60+Math.random()*180});
            for (var i2=0;i2<15;i2++) people.push({x:15+Math.random()*370, y:20+Math.random()*35});
            for (var i3=0;i3<10;i3++) people.push({x:15+Math.random()*370, y:260+Math.random()*35});
        }
        drawSim();
    }

    function isInStore(x, y) {
        return x >= store.x && x <= store.x + store.width && y >= store.y && y <= store.y + store.height;
    }

    function potenciaToDbm(p) { return -p; }

    // Path loss: Free space ~20*log10(d) + constante
    // Router WiFi típico: ~-90 dBm a 15-20m en espacio libre
    // PL(1m) = 20*log10(1) + 20 = 20 dB => señal a 1m = -20 dBm (asumiendo 0 dBm TX)
    // PL(10m) = 20*log10(10) + 20 = 40 dB => señal a 10m = -40 dBm
    // PL(20m) = 20*log10(20) + 20 = 46 dB => señal a 20m = -46 dBm
    // Raw threshold -100 dBm => cubre hasta ~10^(80/20) = 10^4 = 10000m... demasiado
    // Para que sea realista (router cubre ~tienda y media), ajustamos:
    // PL(d) = 20*log10(d_m) + 40 (constante mayor = router menos potente)
    // A 10m: 60 dB => -60 dBm. A 15m: 63.5 dB. A 20m: 66 dB.
    // Raw -100 dBm => 10^(60/20) = 1000m... sigue siendo mucho.
    // Mejor: PL(d) = 25*log10(d_m) + 45 (modelo indoor ITU)
    // A 5m: 62.4 dB. A 10m: 70 dB. A 15m: 74.3 dB. A 20m: 77 dB.
    // Raw -100 => 10^(55/25) = 10^2.2 = 158m... mucho.
    // Simplificamos: el raw se calibra a -100 dBm y el modelo da el radio correcto
    // PL(d) = 30*log10(d_m) + 40
    // A 1m: 40 dB. A 10m: 70 dB. A 15m: 75.3 dB. A 20m: 79 dB.
    // Raw -100 => 10^(60/30) = 100m => 2000px... sigue grande.
    // Solución práctica: el raw tiene un alcance máximo fijado (no por path loss puro)
    // Router real: ~15m indoors. Raw = -100 dBm con PL que dé ~15m.
    // Modelo indoor ITU simplificado: PL(d) = 20*log10(d) + 40 + 3*floor(d/10)
    // A 1m: 40 dB. A 5m: 54 dB. A 10m: 60 dB. A 12m: 62.4 dB. A 15m: 67.5 dB.
    // Raw -100 dBm: 10^(60/20) = 1000m... demasiado.
    // En cambio, fijamos el raw con un alcance práctico de ~15m (router típico indoor)
    // Usamos: PL(d) = 35*log10(d_m) + 45
    // A 1m: 45. A 5m: 69.4. A 10m: 80. A 15m: 86.3. A 18m: 89.
    // Raw -100 => 10^(55/35) = 10^1.57 = 37m... 
    // OK, más simple: PL(d) = 40*log10(d_m) + 40
    // A 1m: 40. A 5m: 67.9. A 10m: 80. A 12m: 83.2. A 15m: 87.
    // Raw -100: 10^(60/40) = 10^1.5 = 31.6m... razonable para router potente.
    // Queremos ~15m para raw: 10^(55/40) = 10^1.375 = 23.7m. Cerca.
    // PL(d) = 45*log10(d_m) + 45 => A 15m: 98.2 dB. A 18m: 101.5. Raw -100 => ~17m. Perfecto.
    function pathLossAt(distPx) {
        var distM = distPx / PX_PER_METER;
        if (distM < 0.3) return 0;
        return 45 * Math.log10(distM) + 45;
    }

    function calcAtten(x, y) {
        var ant = {x: antenna.x, y: antenna.y};
        var tgt = {x: x, y: y};
        var total = lluviaAtten + tempAtten;

        people.forEach(function(p) {
            var d = pointToSegmentDistance(p, ant, tgt);
            if (d < 18) total += 2.8;
        });
        shelves.forEach(function(s) {
            if (lineIntersectsRect(ant, tgt, s)) total += 5.0;
        });

        var inAnt = isInStore(ant.x, ant.y);
        var inPt = isInStore(tgt.x, tgt.y);
        if (inAnt !== inPt) total += wallAttenForExit(store, windows, ant, tgt);

        return total;
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

    function signalAt(x, y) {
        var dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return 0;
        return -pathLossAt(dist) - calcAtten(x, y);
    }

    // Radio de onda: distancia donde signalAt = threshold (sin atenuación de obstáculos)
    function getWaveRadius(thresholdDbm) {
        // -pathLossAt(dist) = thresholdDbm => pathLossAt(dist) = -thresholdDbm
        // 20*log10(distM) + 20 = -thresholdDbm
        // log10(distM) = (-thresholdDbm - 20) / 20
        // distM = 10^((-thresholdDbm - 20)/20)
        var targetPl = -thresholdDbm;
        if (targetPl <= 20) return 5; // muy cerca
        var distM = Math.pow(10, (targetPl - 20) / 20);
        var distPx = distM * PX_PER_METER;
        return Math.max(5, distPx);
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

    // Sin animation loop — dibujo bajo demanda (redraw() cuando cambia algo)
    function redraw() {
        var tab = document.getElementById('tab-reduccion');
        if (tab) drawSim();
    }

    function animate() {
        // Deprecated — mantenido por compatibilidad pero no hace nada
    }

    function toggleAnimation() {
        // Sin animación que pausar — redibuja una vez
        redraw();
    }

    function drawSim() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo
        ctx.fillStyle = '#F0F0F2';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid de escala (cada 50px = 5m)
        ctx.strokeStyle = 'rgba(0,0,0,0.04)';
        ctx.lineWidth = 1;
        for (var gx = 0; gx <= canvas.width; gx += 50) {
            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
        }
        for (var gy = 0; gy <= canvas.height; gy += 50) {
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
        }

        var rawDbm = -100;
        var paseantesDbm = potenciaToDbm(paseantesPotencia);
        var visitasDbm = potenciaToDbm(visitasPotencia);
        var rawRadius = getWaveRadius(rawDbm);
        var paseantesRadius = getWaveRadius(paseantesDbm);
        var visitasRadius = getWaveRadius(visitasDbm);

        // Piso de tienda
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(store.x, store.y, store.width, store.height);

        // Áreas de cobertura (círculos rellenos — sin cálculo de heatmap)
        // Raw (azul) — el más grande, más transparente
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, rawRadius, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(41,128,185,0.08)'; ctx.fill();
        // Paseantes (rojo) — mediano
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, paseantesRadius, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(231,76,60,0.15)'; ctx.fill();
        // Visitas (verde) — el más chico
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, visitasRadius, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(44,173,120,0.18)'; ctx.fill();

        // 3 círculos de borde
        drawWave(rawRadius, 'rgba(41,128,185,0.5)', 'Raw -100 dBm', -Math.PI/4);
        drawWave(paseantesRadius, 'rgba(231,76,60,0.5)', 'Paseantes '+paseantesDbm+' dBm', Math.PI/4);
        drawWave(visitasRadius, 'rgba(44,173,120,0.5)', 'Visitas '+visitasDbm+' dBm', 0);

        // Paredes de la tienda
        drawWalls(store, 'TIENDA (80 m\u00b2)', windows);

        // Anaqueles
        ctx.fillStyle = '#34495E';
        shelves.forEach(function(s) {
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.strokeStyle = '#2C3E50'; ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = '#FFFFFF'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('ANQ', s.x + s.w/2, s.y + s.h/2 + 2);
            ctx.fillStyle = '#34495E';
        });

        // Antena
        ctx.save();
        ctx.fillStyle = '#9B59B6';
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, 8, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#9B59B6'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, 14, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('ANT', antenna.x, antenna.y + 2);
        ctx.restore();

        // Personas + métricas
        var rawCount=0, paseantesCount=0, visitasCount=0;
        people.forEach(function(p) {
            var sig = signalAt(p.x, p.y);
            var inVis = sig >= visitasDbm;
            var inPas = sig >= paseantesDbm && !inVis;
            var inRaw = sig >= rawDbm && !inPas && !inVis;
            if (inVis) visitasCount++;
            else if (inPas) paseantesCount++;
            else if (inRaw) rawCount++;

            var color, icon;
            if (inVis) { color = '#2CAD78'; icon = 'V'; }
            else if (inPas) { color = '#E74C3C'; icon = 'P'; }
            else if (inRaw) { color = '#F39C12'; icon = 'R'; }
            else { color = '#95A5A6'; icon = '\u2717'; }

            ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI*2);
            ctx.fillStyle = color + '33'; ctx.fill();
            ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2);
            ctx.fillStyle = color; ctx.fill();
            ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(icon, p.x, p.y + 2);
        });

        var mR = document.getElementById('red-metric-raw');
        var mP = document.getElementById('red-metric-paseantes');
        var mV = document.getElementById('red-metric-visitas');
        var badge = document.getElementById('red-status-badge');
        if (mR) mR.innerText = rawCount;
        if (mP) mP.innerText = paseantesCount;
        if (mV) mV.innerText = visitasCount;
        if (badge) {
            if (visitasPotencia > paseantesPotencia) { badge.innerText = 'VISITAS > PASEANTES (INV\u00c1LIDO)'; badge.className = 'badge badge-red'; }
            else { badge.innerText = 'CALIBRACI\u00d3N OK'; badge.className = 'badge badge-green'; }
        }

        // Indicador de escala
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Escala: 1 px = 0.05 m | Tienda: 8m x 10m = 80 m\u00b2', 8, canvas.height - 8);
        // Barra de escala
        ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(canvas.width - 110, canvas.height - 15); ctx.lineTo(canvas.width - 10, canvas.height - 15); ctx.stroke();
        ctx.fillStyle = '#333'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('5 m', canvas.width - 60, canvas.height - 5);
    }

    function drawWave(radius, strokeColor, label, labelAngle) {
        radius = Math.max(5, radius);
        ctx.save();
        ctx.beginPath(); ctx.arc(antenna.x, antenna.y, radius, 0, Math.PI*2);
        ctx.strokeStyle = strokeColor; ctx.lineWidth = 2;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
        var lx = antenna.x + Math.cos(labelAngle) * radius;
        var ly = antenna.y + Math.sin(labelAngle) * radius;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        var lw = ctx.measureText(label).width;
        ctx.fillRect(lx - lw/2 - 4, ly - 16, lw + 8, 14);
        ctx.fillStyle = strokeColor.replace(/[\d\.]+\)$/, '1)');
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label, lx, ly - 6);
        ctx.restore();
    }

    function drawWalls(bounds, label, wins) {
        ctx.strokeStyle = '#8B7355'; ctx.lineWidth = bounds.wallThickness;
        // 4 paredes
        ctx.beginPath(); ctx.moveTo(bounds.x - bounds.wallThickness/2, bounds.y); ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, bounds.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bounds.x - bounds.wallThickness/2, bounds.y + bounds.height); ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, bounds.y + bounds.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bounds.x, bounds.y - bounds.wallThickness/2); ctx.lineTo(bounds.x, bounds.y + bounds.height + bounds.wallThickness/2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bounds.x + bounds.width, bounds.y - bounds.wallThickness/2); ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height + bounds.wallThickness/2); ctx.stroke();

        // Textura concreto
        ctx.strokeStyle = '#6B5B45'; ctx.lineWidth = 1;
        for (var x = bounds.x; x < bounds.x + bounds.width; x += 6) {
            ctx.beginPath(); ctx.moveTo(x, bounds.y - bounds.wallThickness/2); ctx.lineTo(x + 6, bounds.y + bounds.wallThickness/2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, bounds.y + bounds.height - bounds.wallThickness/2); ctx.lineTo(x + 6, bounds.y + bounds.height + bounds.wallThickness/2); ctx.stroke();
        }
        for (var y = bounds.y; y < bounds.y + bounds.height; y += 6) {
            ctx.beginPath(); ctx.moveTo(bounds.x - bounds.wallThickness/2, y); ctx.lineTo(bounds.x + bounds.wallThickness/2, y + 6); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(bounds.x + bounds.width - bounds.wallThickness/2, y); ctx.lineTo(bounds.x + bounds.width + bounds.wallThickness/2, y + 6); ctx.stroke();
        }

        // Ventanas
        if (wins) {
            wins.forEach(function(win) {
                ctx.save();
                if (win.wall === 'left') {
                    ctx.clearRect(bounds.x - bounds.wallThickness/2 - 1, win.start, bounds.wallThickness + 2, win.end - win.start);
                    ctx.fillStyle = 'rgba(135,206,235,0.6)'; ctx.fillRect(bounds.x - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
                    ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5; ctx.strokeRect(bounds.x - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
                } else if (win.wall === 'right') {
                    ctx.clearRect(bounds.x + bounds.width - bounds.wallThickness/2 - 1, win.start, bounds.wallThickness + 2, win.end - win.start);
                    ctx.fillStyle = 'rgba(135,206,235,0.6)'; ctx.fillRect(bounds.x + bounds.width - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
                    ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5; ctx.strokeRect(bounds.x + bounds.width - bounds.wallThickness/2, win.start, bounds.wallThickness, win.end - win.start);
                } else if (win.wall === 'bottom') {
                    ctx.clearRect(win.start, bounds.y + bounds.height - bounds.wallThickness/2 - 1, win.end - win.start, bounds.wallThickness + 2);
                    ctx.fillStyle = 'rgba(135,206,235,0.6)'; ctx.fillRect(win.start, bounds.y + bounds.height - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
                    ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5; ctx.strokeRect(win.start, bounds.y + bounds.height - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
                } else if (win.wall === 'top') {
                    ctx.clearRect(win.start, bounds.y - bounds.wallThickness/2 - 1, win.end - win.start, bounds.wallThickness + 2);
                    ctx.fillStyle = 'rgba(135,206,235,0.6)'; ctx.fillRect(win.start, bounds.y - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
                    ctx.strokeStyle = '#5DADE2'; ctx.lineWidth = 1.5; ctx.strokeRect(win.start, bounds.y - bounds.wallThickness/2, win.end - win.start, bounds.wallThickness);
                }
                ctx.restore();
            });
        }

        // Label
        ctx.fillStyle = '#2C3E50'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label, bounds.x + bounds.width/2, bounds.y - 14);
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
                else { antenna.x = pos.x; antenna.y = pos.y; drawSim(); }
                return;
            }
            var hit = people.findIndex(function(p) { return Math.hypot(p.x - pos.x, p.y - pos.y) < 12; });
            if (hit !== -1) { draggedPerson = hit; isDragging = true; return; }
            if (mode === 'person') people.push({x: pos.x, y: pos.y});
            else if (mode === 'shelf') shelves.push({x: pos.x - 20, y: pos.y - 6, w: 40, h: 12});
            drawSim();
        };
        var handleMove = function(e) {
            var pos = getPos(e);
            if (isDraggingAntenna) { antenna.x = Math.max(10, Math.min(canvas.width-10, pos.x)); antenna.y = Math.max(10, Math.min(canvas.height-10, pos.y)); drawSim(); return; }
            if (isDragging && draggedPerson !== null) { people[draggedPerson].x = pos.x; people[draggedPerson].y = pos.y; drawSim(); }
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
