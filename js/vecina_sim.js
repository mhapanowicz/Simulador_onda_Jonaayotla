const VecinaSimulator = (function() {
    var canvas, ctx;
    var antenna = { x: 400, y: 440, baseTxPower: -19.86, cutoffdBm: -40 };
    var mode = 'person';
    var people = [];
    var shelves = [];
    var wavePhase = 0;
    var selectedElement = null;
    var isDragging = false;
    var isAnimRunning = false;
    var isPaused = false;

    var storeBoundsA = { x: 40, y: 40, width: 440, height: 440, wallThickness: 12 };
    var storeBoundsB = { x: 480, y: 40, width: 440, height: 440, wallThickness: 12 };
    var wallX1 = 460, wallX2 = 475; // Muro de concreto de 15cm (~15px)
    var cashierZoneA = { x: 320, y: 380, width: 120, height: 80 };
    var cashierZoneB = { x: 540, y: 380, width: 120, height: 80 };
    var WALL_ATTEN_DBM = 20;      // Atenuación muro de concreto
    var WINDOW_ATTEN_DBM = 8;     // Atenuación ventana de vidrio (menor que concreto)
    var RAW_DBM = -100;

    // Arquitectura actual
    var currentArchitecture = 'convencional';

    // Definición de arquitecturas
    // Cada arquitectura define: ventanasA, ventanasB, y qué pared es "fachada vitrina" (todo vidrio excepto puerta)
    // Para fachada_vitrina: la pared 'top' es toda vidrio excepto el segmento de la puerta
    var architectures = {
        convencional: {
            name: 'Tienda Convencional',
            // Tienda A: 2 ventanas (una en pared izquierda, una en pared inferior)
            windowsA: [
                { wall: 'left',   start: 120, end: 180 },  // Ventana en pared izquierda de Tienda A
                { wall: 'bottom', start: 200, end: 260 }   // Ventana en pared inferior de Tienda A
            ],
            // Tienda B: 2 ventanas (una en pared derecha, una en pared inferior)
            windowsB: [
                { wall: 'right',  start: 120, end: 180 },  // Ventana en pared derecha de Tienda B
                { wall: 'bottom', start: 200, end: 260 }   // Ventana en pared inferior de Tienda B
            ],
            // La pared superior es concreto con puerta (gap) — comportamiento normal
            topWallMaterial: 'concrete',
            // Puerta (gap en pared superior) — coords relativas al bounds de cada tienda
            doorA: { start: 60, end: 200 },   // gap en pared superior de tienda A
            doorB: { start: 60, end: 200 }    // gap en pared superior de tienda B
        },
        fachada_vitrina: {
            name: 'Fachada Vitrina',
            // La pared superior es toda de vidrio (fachada vitrina) excepto la puerta
            // No hay ventanas adicionales en otras paredes (la fachada vitrina reemplaza las ventanas superiores)
            // Ventanas en paredes laterales/inferiores se mantienen
            windowsA: [
                { wall: 'left',   start: 120, end: 180 },  // Ventana en pared izquierda de Tienda A
                { wall: 'bottom', start: 200, end: 260 }   // Ventana en pared inferior de Tienda A
            ],
            windowsB: [
                { wall: 'right',  start: 120, end: 180 },  // Ventana en pared derecha de Tienda B
                { wall: 'bottom', start: 200, end: 260 }   // Ventana en pared inferior de Tienda B
            ],
            // La pared superior es vidrio (fachada vitrina) excepto la puerta
            topWallMaterial: 'glass',
            // Puerta (gap en pared superior) — la puerta es concreto/opaca
            doorA: { start: 60, end: 200 },
            doorB: { start: 60, end: 200 }
        }
    };

    // Ventanas activas (se actualizan al cambiar arquitectura)
    var windowsA = architectures.convencional.windowsA;
    var windowsB = architectures.convencional.windowsB;

    function setArchitecture(archId) {
        var arch = architectures[archId];
        if (!arch) return;
        currentArchitecture = archId;
        windowsA = arch.windowsA;
        windowsB = arch.windowsB;
    }

    function initSim() {
        canvas = document.getElementById('vecinaCanvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        var slider = document.getElementById('powerSliderVecina');
        if (slider) updatePower(slider.value);
        loadPreset('crowded');
        setupCanvasEvents();
        if (!isAnimRunning) {
            isAnimRunning = true;
            animate();
        }
    }

    function setMode(newMode) {
        mode = newMode;
        var btnP = document.getElementById('btn-add-person-vecina');
        var btnS = document.getElementById('btn-add-shelf-vecina');
        if (btnP) btnP.className = mode === 'person' ? 'btn btn-primary' : 'btn';
        if (btnS) btnS.className = mode === 'shelf' ? 'btn btn-primary' : 'btn';
    }

    function updatePower(val) {
        antenna.cutoffdBm = parseFloat(val);
        var pVal = document.getElementById('power-val-vecina');
        if (pVal) pVal.innerText = antenna.cutoffdBm + " dBm";
        var calRadiusPx = getCoverageRadius();
        var calRadiusM = (calRadiusPx * 0.1).toFixed(1);
        var rawRadiusPx = getRawCoverageRadius();
        var rawRadiusM = (rawRadiusPx * 0.1).toFixed(1);
        var distEl = document.getElementById('vision-distance-vecina');
        if (distEl) distEl.innerText = "Calibración: " + calRadiusM + " m | Raw: " + rawRadiusM + " m";
    }

    function clearElements() {
        people = [];
        shelves = [];
    }

    function loadPreset(type) {
        people = [];
        shelves = [
            { x: 180, y: 120, w: 180, h: 30 },
            { x: 180, y: 220, w: 180, h: 30 },
            { x: 180, y: 320, w: 180, h: 30 }
        ];

        if (type === 'empty') {
            people = [];
        } else if (type === 'medium') {
            // 8 personas en tienda A
            people.push({x: 350, y: 200}); people.push({x: 280, y: 280}); people.push({x: 200, y: 180});
            people.push({x: 150, y: 280}); people.push({x: 100, y: 150}); people.push({x: 80, y: 380});
            people.push({x: 380, y: 150}); people.push({x: 250, y: 380});
            // 5 personas en tienda B
            people.push({x: 550, y: 200}); people.push({x: 650, y: 280}); people.push({x: 750, y: 180});
            people.push({x: 600, y: 380}); people.push({x: 850, y: 250});
        } else if (type === 'crowded') {
            // 20 en tienda A
            for (let i = 0; i < 20; i++) {
                people.push({ x: 60 + Math.random() * 380, y: 60 + Math.random() * 340 });
            }
            // 15 en tienda B
            for (let i = 0; i < 15; i++) {
                people.push({ x: 500 + Math.random() * 380, y: 60 + Math.random() * 340 });
            }
        } else if (type === 'max_capacity') {
            // 50 en tienda A
            for (let i = 0; i < 50; i++) {
                people.push({ x: 60 + Math.random() * 380, y: 60 + Math.random() * 340 });
            }
            // 30 en tienda B
            for (let i = 0; i < 30; i++) {
                people.push({ x: 500 + Math.random() * 380, y: 60 + Math.random() * 340 });
            }
        } else if (type === 'cross_contamination') {
            // 0 en A, 20 en B
            for (let i = 0; i < 20; i++) {
                people.push({ x: 500 + Math.random() * 380, y: 60 + Math.random() * 340 });
            }
        }
    }

    function isInStoreA(x, y) {
        return x >= storeBoundsA.x && x <= storeBoundsA.x + storeBoundsA.width &&
               y >= storeBoundsA.y && y <= storeBoundsA.y + storeBoundsA.height;
    }

    function isInStoreB(x, y) {
        return x >= storeBoundsB.x && x <= storeBoundsB.x + storeBoundsB.width &&
               y >= storeBoundsB.y && y <= storeBoundsB.y + storeBoundsB.height;
    }

    function isInAnyStore(x, y) {
        return isInStoreA(x, y) || isInStoreB(x, y);
    }

    // Detecta si la línea antenna→point atraviesa el muro divisorio (x entre wallX1 y wallX2)
    function lineIntersectsWall(point) {
        if (antenna.x < wallX1 && point.x > wallX2) return true;
        if (antenna.x > wallX2 && point.x < wallX1) return true;
        if (point.x >= wallX1 && point.x <= wallX2) return true;
        return false;
    }

    // Calcula la atenuación total por paredes + ventanas
    // que la línea antenna→point sufre al atravesar obstáculos.
    function calculateWallAtten(point) {
        var totalAtten = 0;
        var ant = { x: antenna.x, y: antenna.y };
        var tgt = { x: point.x, y: point.y };

        var inA_ant = isInStoreA(ant.x, ant.y);
        var inA_pt  = isInStoreA(tgt.x, tgt.y);
        var inB_ant = isInStoreB(ant.x, ant.y);
        var inB_pt  = isInStoreB(tgt.x, tgt.y);
        var crossesDivisor = lineIntersectsWall(point);

        // --- Caso 1: señal cruza el muro divisorio (de A a B o de B a A) ---
        // Solo se aplica UNA vez la atenuación del muro (20dB concreto o ventana si cae en una)
        if (crossesDivisor) {
            totalAtten += WALL_ATTEN_DBM;
        }

        // --- Caso 2: señal sale de una tienda hacia el exterior (no cruza el muro, sale por pared exterior) ---
        // Tienda A → exterior (y no cruza el muro divisorio)
        if (inA_ant && !inA_pt && !crossesDivisor) {
            totalAtten += wallAttenForExit(storeBoundsA, windowsA, ant, tgt);
        }
        // Exterior → Tienda A (y no cruza el muro divisorio)
        if (!inA_ant && inA_pt && !crossesDivisor) {
            totalAtten += wallAttenForExit(storeBoundsA, windowsA, ant, tgt);
        }
        // Tienda B → exterior (y no cruza el muro divisorio)
        if (inB_ant && !inB_pt && !crossesDivisor) {
            totalAtten += wallAttenForExit(storeBoundsB, windowsB, ant, tgt);
        }
        // Exterior → Tienda B (y no cruza el muro divisorio)
        if (!inB_ant && inB_pt && !crossesDivisor) {
            totalAtten += wallAttenForExit(storeBoundsB, windowsB, ant, tgt);
        }

        return totalAtten;
    }

    // Calcula la atenuación al salir/entrar por una pared de una tienda,
    // considerando ventanas (menor atenuación) vs concreto (atenuación completa).
    // Para fachada_vitrina: la pared superior es toda vidrio (8dB) excepto la puerta (concreto 20dB).
    function wallAttenForExit(bounds, windows, ant, tgt) {
        var arch = architectures[currentArchitecture];
        // Determinar por qué pared sale/entra la línea
        // Pared izquierda (x = bounds.x)
        if ((ant.x <= bounds.x && tgt.x >= bounds.x) || (ant.x >= bounds.x && tgt.x <= bounds.x)) {
            // Calcular y donde la línea cruza x = bounds.x
            var t = (bounds.x - ant.x) / (tgt.x - ant.x);
            var crossY = ant.y + t * (tgt.y - ant.y);
            if (crossY >= bounds.y && crossY <= bounds.y + bounds.height) {
                if (passesThroughWindow(windows, 'left', crossY)) return WINDOW_ATTEN_DBM;
                return WALL_ATTEN_DBM;
            }
        }
        // Pared derecha (x = bounds.x + bounds.width)
        if ((ant.x <= bounds.x + bounds.width && tgt.x >= bounds.x + bounds.width) || (ant.x >= bounds.x + bounds.width && tgt.x <= bounds.x + bounds.width)) {
            var t2 = ((bounds.x + bounds.width) - ant.x) / (tgt.x - ant.x);
            var crossY2 = ant.y + t2 * (tgt.y - ant.y);
            if (crossY2 >= bounds.y && crossY2 <= bounds.y + bounds.height) {
                if (passesThroughWindow(windows, 'right', crossY2)) return WINDOW_ATTEN_DBM;
                return WALL_ATTEN_DBM;
            }
        }
        // Pared superior (y = bounds.y)
        if ((ant.y <= bounds.y && tgt.y >= bounds.y) || (ant.y >= bounds.y && tgt.y <= bounds.y)) {
            var t3 = (bounds.y - ant.y) / (tgt.y - ant.y);
            var crossX = ant.x + t3 * (tgt.x - ant.x);
            if (crossX >= bounds.x && crossX <= bounds.x + bounds.width) {
                // Fachada vitrina: pared superior es vidrio excepto la puerta
                if (arch.topWallMaterial === 'glass') {
                    // Determinar si el cruce cae en la puerta (gap) o en el vidrio
                    var door = (bounds === storeBoundsA) ? arch.doorA : arch.doorB;
                    var crossPos = crossX - bounds.x; // posición relativa al bounds
                    if (crossPos >= door.start && crossPos <= door.end) {
                        // Puerta: concreto (opaca)
                        return WALL_ATTEN_DBM;
                    }
                    // Resto de la fachada: vidrio
                    return WINDOW_ATTEN_DBM;
                }
                // Arquitectura convencional: verificar ventanas normales
                if (passesThroughWindow(windows, 'top', crossX)) return WINDOW_ATTEN_DBM;
                return WALL_ATTEN_DBM;
            }
        }
        // Pared inferior (y = bounds.y + bounds.height)
        if ((ant.y <= bounds.y + bounds.height && tgt.y >= bounds.y + bounds.height) || (ant.y >= bounds.y + bounds.height && tgt.y <= bounds.y + bounds.height)) {
            var t4 = ((bounds.y + bounds.height) - ant.y) / (tgt.y - ant.y);
            var crossX2 = ant.x + t4 * (tgt.x - ant.x);
            if (crossX2 >= bounds.x && crossX2 <= bounds.x + bounds.width) {
                if (passesThroughWindow(windows, 'bottom', crossX2)) return WINDOW_ATTEN_DBM;
                return WALL_ATTEN_DBM;
            }
        }
        return 0;
    }

    // Verifica si un punto de cruce en una pared cae dentro de una ventana
    function passesThroughWindow(windows, wall, pos) {
        for (var i = 0; i < windows.length; i++) {
            if (windows[i].wall === wall && pos >= windows[i].start && pos <= windows[i].end) {
                return true;
            }
        }
        return false;
    }

    function getCoverageRadius() {
        var dbm = antenna.cutoffdBm;
        if (dbm >= -60.1) {
            return Math.max(5, Math.pow(10, (-19.86 - dbm) / 14.5));
        } else {
            var t = (-60.1 - dbm) / 29.9;
            return 600 + t * 500;
        }
    }

    function getRawCoverageRadius() {
        return 1100;
    }

    // Señal de VISITAS con atenuación por agua + anaqueles + muro
    function calculateSignalAtVecina(x, y) {
        const dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return -20;

        let pathLoss;
        if (dist <= 600) {
            pathLoss = 10.86 + 14.5 * Math.log10(dist);
        } else {
            var t = (dist - 600) / 500;
            pathLoss = 10.86 + 14.5 * Math.log10(600) + t * 29.9;
        }

        let waterAtten = 0;
        people.forEach(p => {
            const distToLine = pointToSegmentDistance(p, antenna, {x, y});
            if (distToLine < 20) waterAtten += 2.8;
        });

        let shelfAtten = 0;
        shelves.forEach(s => {
            if (lineIntersectsRect(antenna, {x, y}, s)) shelfAtten += 5.0;
        });

        let wallAtten = calculateWallAtten({x, y});

        let rxSignal = -pathLoss - waterAtten - shelfAtten - wallAtten;
        return Math.max(-90, Math.min(-20, rxSignal));
    }

    // Señal RAW con atenuación por muro + paredes exteriores + ventanas
    function calculateRawSignalAtVecina(x, y) {
        const dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return 0;

        let pathLoss;
        if (dist <= 600) {
            pathLoss = 14.5 * Math.log10(dist);
        } else {
            var t = (dist - 600) / 500;
            pathLoss = 14.5 * Math.log10(600) + t * 60;
        }

        let wallAtten = calculateWallAtten({x, y});
        let rxSignal = -pathLoss - wallAtten;
        return Math.max(-100, Math.min(0, rxSignal));
    }

    function pointToSegmentDistance(p, a, b) {
        const l2 = Math.hypot(a.x - b.x, a.y - b.y) ** 2;
        if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
    }

    function lineIntersectsRect(p1, p2, r) {
        const rectLines = [
            [{x: r.x, y: r.y}, {x: r.x + r.w, y: r.y}],
            [{x: r.x + r.w, y: r.y}, {x: r.x + r.w, y: r.y + r.h}],
            [{x: r.x + r.w, y: r.y + r.h}, {x: r.x, y: r.y + r.h}],
            [{x: r.x, y: r.y + r.h}, {x: r.x, y: r.y}]
        ];
        return rectLines.some(line => linesIntersect(p1, p2, line[0], line[1]));
    }

    function linesIntersect(a, b, c, d) {
        const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
        return (ccw(a,c,d) !== ccw(b,c,d)) && (ccw(a,b,c) !== ccw(a,b,d));
    }

    function animate() {
        if (!isPaused) {
            wavePhase = (wavePhase + 0.4) % 40;
        }
        var vecinaTab = document.getElementById('tab-vecina');
        if (vecinaTab && vecinaTab.classList.contains('active')) {
            drawVecinaSimulation();
        }
        requestAnimationFrame(animate);
    }

    function toggleAnimation() {
        isPaused = !isPaused;
        var btn = document.getElementById('btn-toggle-anim-vecina');
        if (btn) {
            if (isPaused) {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> ▶ Reanudar';
                btn.className = 'btn';
            } else {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> ⏸ Pausar';
                btn.className = 'btn';
            }
        }
    }

   function drawStore(storeBounds, label, entranceLabel) {
        // Store Floor (base layer — heatmap goes on top)
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(storeBounds.x, storeBounds.y, storeBounds.width, storeBounds.height);
    }

    function drawStoreWalls(storeBounds, label, entranceLabel, windows, skipWall) {
        var arch = architectures[currentArchitecture];
        // Store Outer Walls — concreto (mismo material que el muro divisorio)
        // skipWall: 'right' u 'left' — para no dibujar la pared compartida (muro divisorio)
        ctx.strokeStyle = "#8B7355";
        ctx.lineWidth = storeBounds.wallThickness;

        // Dibujar paredes individualmente (excepto la que se omite por ser compartida)
        // Pared superior — en fachada_vitrina se dibuja diferente (vidrio + puerta concreto)
        if (skipWall !== 'top') {
            if (arch.topWallMaterial === 'glass') {
                // Fachada Vitrina: pared superior toda de vidrio excepto puerta
                var door = (storeBounds === storeBoundsA) ? arch.doorA : arch.doorB;
                // Segmento izquierdo de la puerta (vidrio)
                ctx.fillStyle = "rgba(135, 206, 235, 0.6)";
                ctx.fillRect(storeBounds.x, storeBounds.y - storeBounds.wallThickness/2, door.start, storeBounds.wallThickness);
                ctx.strokeStyle = "#5DADE2";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(storeBounds.x, storeBounds.y - storeBounds.wallThickness/2, door.start, storeBounds.wallThickness);
                // Segmento derecho de la puerta (vidrio)
                ctx.fillStyle = "rgba(135, 206, 235, 0.6)";
                ctx.fillRect(storeBounds.x + door.end, storeBounds.y - storeBounds.wallThickness/2, storeBounds.width - door.end, storeBounds.wallThickness);
                ctx.strokeStyle = "#5DADE2";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(storeBounds.x + door.end, storeBounds.y - storeBounds.wallThickness/2, storeBounds.width - door.end, storeBounds.wallThickness);
                // Puerta (concreto opaco)
                ctx.strokeStyle = "#8B7355";
                ctx.lineWidth = storeBounds.wallThickness;
                ctx.beginPath();
                ctx.moveTo(storeBounds.x + door.start, storeBounds.y);
                ctx.lineTo(storeBounds.x + door.end, storeBounds.y);
                ctx.stroke();
                // Textura concreto solo en la puerta
                ctx.strokeStyle = "#6B5B45";
                ctx.lineWidth = 1;
                for (var xd = storeBounds.x + door.start; xd < storeBounds.x + door.end; xd += 8) {
                    ctx.beginPath();
                    ctx.moveTo(xd, storeBounds.y - storeBounds.wallThickness/2);
                    ctx.lineTo(xd + 8, storeBounds.y + storeBounds.wallThickness/2);
                    ctx.stroke();
                }
                // Etiqueta FACHADA VITRINA
                ctx.fillStyle = "#2980B9";
                ctx.font = "bold 7px sans-serif";
                ctx.textAlign = "center";
                var vitrinaLabelX = storeBounds.x + (door.start / 2);
                ctx.fillText("FACHADA VITRINA", vitrinaLabelX, storeBounds.y - storeBounds.wallThickness/2 - 6);
                var vitrinaLabelX2 = storeBounds.x + door.end + (storeBounds.width - door.end) / 2;
                ctx.fillText("FACHADA VITRINA", vitrinaLabelX2, storeBounds.y - storeBounds.wallThickness/2 - 6);
                // Reset stroke style para las demá s paredes
                ctx.strokeStyle = "#8B7355";
                ctx.lineWidth = storeBounds.wallThickness;
            } else {
                // Arquitectura convencional: pared superior de concreto normal
                ctx.beginPath();
                ctx.moveTo(storeBounds.x - storeBounds.wallThickness/2, storeBounds.y);
                ctx.lineTo(storeBounds.x + storeBounds.width + storeBounds.wallThickness/2, storeBounds.y);
                ctx.stroke();
            }
        }
        // Reset estilo después de la pared superior
        ctx.strokeStyle = "#8B7355";
        ctx.lineWidth = storeBounds.wallThickness;

        // Pared inferior
        if (skipWall !== 'bottom') {
            ctx.beginPath();
            ctx.moveTo(storeBounds.x - storeBounds.wallThickness/2, storeBounds.y + storeBounds.height);
            ctx.lineTo(storeBounds.x + storeBounds.width + storeBounds.wallThickness/2, storeBounds.y + storeBounds.height);
            ctx.stroke();
        }
        // Pared izquierda
        if (skipWall !== 'left') {
            ctx.beginPath();
            ctx.moveTo(storeBounds.x, storeBounds.y - storeBounds.wallThickness/2);
            ctx.lineTo(storeBounds.x, storeBounds.y + storeBounds.height + storeBounds.wallThickness/2);
            ctx.stroke();
        }
        // Pared derecha
        if (skipWall !== 'right') {
            ctx.beginPath();
            ctx.moveTo(storeBounds.x + storeBounds.width, storeBounds.y - storeBounds.wallThickness/2);
            ctx.lineTo(storeBounds.x + storeBounds.width, storeBounds.y + storeBounds.height + storeBounds.wallThickness/2);
            ctx.stroke();
        }

        // Textura de líneas diagonales en las paredes (concreto)
        ctx.strokeStyle = "#6B5B45";
        ctx.lineWidth = 1;
        // Pared superior — solo textura concreto si NO es fachada vitrina
        if (skipWall !== 'top' && arch.topWallMaterial !== 'glass') {
        for (var x = storeBounds.x; x < storeBounds.x + storeBounds.width; x += 8) {
            ctx.beginPath();
            ctx.moveTo(x, storeBounds.y - storeBounds.wallThickness/2);
            ctx.lineTo(x + 8, storeBounds.y + storeBounds.wallThickness/2);
            ctx.stroke();
        }
        }
        // Pared inferior
        if (skipWall !== 'bottom') {
        for (var x2 = storeBounds.x; x2 < storeBounds.x + storeBounds.width; x2 += 8) {
            ctx.beginPath();
            ctx.moveTo(x2, storeBounds.y + storeBounds.height - storeBounds.wallThickness/2);
            ctx.lineTo(x2 + 8, storeBounds.y + storeBounds.height + storeBounds.wallThickness/2);
            ctx.stroke();
        }
        }
        // Pared izquierda
        if (skipWall !== 'left') {
        for (var y = storeBounds.y; y < storeBounds.y + storeBounds.height; y += 8) {
            ctx.beginPath();
            ctx.moveTo(storeBounds.x - storeBounds.wallThickness/2, y);
            ctx.lineTo(storeBounds.x + storeBounds.wallThickness/2, y + 8);
            ctx.stroke();
        }
        }
        // Pared derecha
        if (skipWall !== 'right') {
        for (var y2 = storeBounds.y; y2 < storeBounds.y + storeBounds.height; y2 += 8) {
            ctx.beginPath();
            ctx.moveTo(storeBounds.x + storeBounds.width - storeBounds.wallThickness/2, y2);
            ctx.lineTo(storeBounds.x + storeBounds.width + storeBounds.wallThickness/2, y2 + 8);
            ctx.stroke();
        }
        }

        // Dibujar ventanas (cortar el concreto y poner vidrio)
        if (windows) {
            windows.forEach(function(win) {
                ctx.save();
                if (win.wall === 'left') {
                    // Limpiar concreto en la zona de la ventana
                    ctx.clearRect(storeBounds.x - storeBounds.wallThickness/2 - 1, win.start, storeBounds.wallThickness + 2, win.end - win.start);
                    // Dibujar vidrio (azul semitransparente)
                    ctx.fillStyle = "rgba(135, 206, 235, 0.6)";
                    ctx.fillRect(storeBounds.x - storeBounds.wallThickness/2, win.start, storeBounds.wallThickness, win.end - win.start);
                    ctx.strokeStyle = "#5DADE2";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(storeBounds.x - storeBounds.wallThickness/2, win.start, storeBounds.wallThickness, win.end - win.start);
                } else if (win.wall === 'right') {
                    ctx.clearRect(storeBounds.x + storeBounds.width - storeBounds.wallThickness/2 - 1, win.start, storeBounds.wallThickness + 2, win.end - win.start);
                    ctx.fillStyle = "rgba(135, 206, 235, 0.6)";
                    ctx.fillRect(storeBounds.x + storeBounds.width - storeBounds.wallThickness/2, win.start, storeBounds.wallThickness, win.end - win.start);
                    ctx.strokeStyle = "#5DADE2";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(storeBounds.x + storeBounds.width - storeBounds.wallThickness/2, win.start, storeBounds.wallThickness, win.end - win.start);
                } else if (win.wall === 'top') {
                    ctx.clearRect(win.start, storeBounds.y - storeBounds.wallThickness/2 - 1, win.end - win.start, storeBounds.wallThickness + 2);
                    ctx.fillStyle = "rgba(135, 206, 235, 0.6)";
                    ctx.fillRect(win.start, storeBounds.y - storeBounds.wallThickness/2, win.end - win.start, storeBounds.wallThickness);
                    ctx.strokeStyle = "#5DADE2";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(win.start, storeBounds.y - storeBounds.wallThickness/2, win.end - win.start, storeBounds.wallThickness);
                } else if (win.wall === 'bottom') {
                    ctx.clearRect(win.start, storeBounds.y + storeBounds.height - storeBounds.wallThickness/2 - 1, win.end - win.start, storeBounds.wallThickness + 2);
                    ctx.fillStyle = "rgba(135, 206, 235, 0.6)";
                    ctx.fillRect(win.start, storeBounds.y + storeBounds.height - storeBounds.wallThickness/2, win.end - win.start, storeBounds.wallThickness);
                    ctx.strokeStyle = "#5DADE2";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(win.start, storeBounds.y + storeBounds.height - storeBounds.wallThickness/2, win.end - win.start, storeBounds.wallThickness);
                }
                // Etiqueta "VENTANA"
                ctx.fillStyle = "#2980B9";
                ctx.font = "bold 7px sans-serif";
                ctx.textAlign = "center";
                if (win.wall === 'left') {
                    ctx.save();
                    ctx.translate(storeBounds.x - storeBounds.wallThickness/2 - 8, (win.start + win.end) / 2);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillText("VENTANA", 0, 0);
                    ctx.restore();
                } else if (win.wall === 'right') {
                    ctx.save();
                    ctx.translate(storeBounds.x + storeBounds.width + storeBounds.wallThickness/2 + 8, (win.start + win.end) / 2);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillText("VENTANA", 0, 0);
                    ctx.restore();
                } else if (win.wall === 'top') {
                    ctx.fillText("VENTANA", (win.start + win.end) / 2, storeBounds.y - storeBounds.wallThickness/2 - 6);
                } else if (win.wall === 'bottom') {
                    ctx.fillText("VENTANA", (win.start + win.end) / 2, storeBounds.y + storeBounds.height + storeBounds.wallThickness/2 + 12);
                }
                ctx.restore();
            });
        }

        // Store label
        ctx.fillStyle = "#2C3E50";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, storeBounds.x + storeBounds.width/2, storeBounds.y - 20);

        // Entrance (gap in the top wall)
        if (arch.topWallMaterial === 'glass') {
            // En fachada vitrina la puerta ya está dibujada como concreto dentro del vidrio
            // Solo dibujar el marco/label de la entrada
            ctx.strokeStyle = "#2CAD78";
            ctx.lineWidth = 2;
            ctx.strokeRect(storeBounds.x + 60, storeBounds.y - 2, 140, 4);
        } else {
            // Arquitectura convencional: limpiar el gap y dibujar marco
            ctx.clearRect(storeBounds.x + 60, storeBounds.y - storeBounds.wallThickness, 140, storeBounds.wallThickness + 2);
            ctx.strokeStyle = "#2CAD78";
            ctx.lineWidth = 2;
            ctx.strokeRect(storeBounds.x + 60, storeBounds.y - 2, 140, 4);
        }
        ctx.fillStyle = "#2CAD78";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(entranceLabel, storeBounds.x + 130, storeBounds.y - 26);
    }

    function drawCashierZone(zone) {
        ctx.fillStyle = "#EAECEE";
        ctx.strokeStyle = "#BDC3C7";
        ctx.lineWidth = 1.5;
        ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
        ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
        ctx.fillStyle = "#7F8C8D";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ÁREA DE CAJAS", zone.x + zone.width/2, zone.y + zone.height/2 + 16);
    }

    function drawWall() {
        // Muro de concreto: rectángulo sólido marrón/gris con textura de líneas diagonales
        ctx.save();
        ctx.fillStyle = "#8B7355";
        ctx.fillRect(wallX1, storeBoundsA.y, wallX2 - wallX1, storeBoundsA.height);

        // Textura de líneas diagonales (concreto)
        ctx.strokeStyle = "#6B5B45";
        ctx.lineWidth = 1;
        for (var y = storeBoundsA.y; y < storeBoundsA.y + storeBoundsA.height; y += 8) {
            ctx.beginPath();
            ctx.moveTo(wallX1, y);
            ctx.lineTo(wallX2, y + 8);
            ctx.stroke();
        }

        // Borde del muro
        ctx.strokeStyle = "#5D4E37";
        ctx.lineWidth = 2;
        ctx.strokeRect(wallX1, storeBoundsA.y, wallX2 - wallX1, storeBoundsA.height);

        // Label del muro
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate((wallX1 + wallX2) / 2, storeBoundsA.y + storeBoundsA.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("MURO CONCRETO 15cm", 0, 3);
        ctx.restore();

        ctx.restore();
    }

    function drawVecinaSimulation() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo general
        ctx.fillStyle = "#F0F0F2";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        var calRadius = getCoverageRadius();
        var rawRadius = getRawCoverageRadius();

        // 1. Draw store floors FIRST (white base layer)
        drawStore(storeBoundsA, "TIENDA A", "ENTRADA");
        drawStore(storeBoundsB, "TIENDA B (VECINA)", "ENTRADA");

        // 2. Draw cashier zones on top of store floor
        drawCashierZone(cashierZoneA);
        drawCashierZone(cashierZoneB);

        // 3. Heatmap ON TOP of store floor (so waves show through)
        const gridSize = 14;
        for (let x = 0; x < canvas.width; x += gridSize) {
            for (let y = 0; y < canvas.height; y += gridSize) {
                const cx = x + gridSize/2;
                const cy = y + gridSize/2;
                const rawSignal = calculateRawSignalAtVecina(cx, cy);
                const visSignal = calculateSignalAtVecina(cx, cy);
                
                if (visSignal >= antenna.cutoffdBm) {
                    ctx.fillStyle = "rgba(44, 173, 120, 0.16)";
                } else if (rawSignal >= RAW_DBM) {
                    ctx.fillStyle = "rgba(52, 152, 219, 0.12)";
                } else {
                    ctx.fillStyle = "rgba(220, 224, 230, 0.25)";
                }
                ctx.fillRect(x, y, gridSize, gridSize);
            }
        }

        // === ONDA RAW (azul) — estilo original ===
        ctx.save();
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, rawRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(41, 128, 185, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        var rawLabelAngle = -Math.PI / 4;
        var rawLabelX = antenna.x + Math.cos(rawLabelAngle) * rawRadius;
        var rawLabelY = antenna.y + Math.sin(rawLabelAngle) * rawRadius;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        var rawLabel = 'Raw -100 dBm';
        var rawLabelW = ctx.measureText(rawLabel).width;
        ctx.fillRect(rawLabelX - rawLabelW/2 - 4, rawLabelY - 16, rawLabelW + 8, 14);
        ctx.fillStyle = 'rgba(41, 128, 185, 0.9)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(rawLabel, rawLabelX, rawLabelY - 6);

        for (var r = wavePhase; r < rawRadius; r += 50) {
            var rawIntensity = Math.max(0, 1 - r / rawRadius);
            ctx.beginPath();
            ctx.arc(antenna.x, antenna.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(52, 152, 219, ' + (rawIntensity * 0.2) + ')';
            ctx.lineWidth = 1;
            ctx.setLineDash([8, 12]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();

        // === ONDA DE CALIBRACIÓN (verde) — estilo original ===
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.clip();
        for (var r = wavePhase; r < calRadius; r += 35) {
            var calIntensity = Math.max(0, 1 - r / calRadius);
            ctx.beginPath();
            ctx.arc(antenna.x, antenna.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(44, 173, 120, ' + (calIntensity * 0.35) + ')';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([10, 8]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();

        // 4. Draw store walls + labels ON TOP of waves (so walls are visible)
        drawStoreWalls(storeBoundsA, "TIENDA A", "ENTRADA", windowsA, 'right');
        drawStoreWalls(storeBoundsB, "TIENDA B (VECINA)", "ENTRADA", windowsB, 'left');

        // Draw wall
        drawWall();

        // Shelves
        ctx.fillStyle = "#34495E";
        shelves.forEach(s => {
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.strokeStyle = "#2C3E50";
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("ANAQUEL", s.x + s.w/2, s.y + s.h/2 + 3);
            ctx.fillStyle = "#34495E";
        });

        // Antenna
        ctx.save();
        ctx.fillStyle = "#8E44AD";
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#9B59B6";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, 16 + Math.sin(Date.now() / 200) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ANTENA", antenna.x, antenna.y + 3);
        ctx.restore();

        // People & metrics
        let rawEntriesA = 0, rawEntriesB = 0;
        let visitasA = 0, visitasB = 0;
        let falsasVisitas = 0;

        people.forEach((p) => {
            const signal = calculateSignalAtVecina(p.x, p.y);
            const rawSignal = calculateRawSignalAtVecina(p.x, p.y);
            const inA = isInStoreA(p.x, p.y);
            const inB = isInStoreB(p.x, p.y);

            // Raw entries
            if (rawSignal >= RAW_DBM) {
                if (inA) rawEntriesA++;
                else if (inB) rawEntriesB++;
            }

            // Visitas (calibración)
            const isVisita = signal >= antenna.cutoffdBm;
            if (isVisita) {
                if (inA) visitasA++;
                else if (inB) {
                    visitasB++;
                    falsasVisitas++; // Persona en B contada como visita = falsa visita
                }
            }

            // Color coding
            var personColor, bgColor, labelIcon, labelColor;
            if (isVisita) {
                if (inB) {
                    // Falsa visita (persona de tienda B detectada como visita en A)
                    personColor = "#E74C3C";
                    bgColor = "rgba(231, 76, 60, 0.30)";
                    labelIcon = "!";
                    labelColor = "#C0392B";
                } else {
                    personColor = "#2CAD78";
                    bgColor = "rgba(44, 173, 120, 0.25)";
                    labelIcon = "✓";
                    labelColor = "#1E8A5C";
                }
            } else if (rawSignal >= RAW_DBM) {
                personColor = "#F39C12";
                bgColor = "rgba(243, 156, 18, 0.25)";
                labelIcon = "👁";
                labelColor = "#B7950B";
            } else {
                personColor = "#E74C3C";
                bgColor = "rgba(231, 76, 60, 0.20)";
                labelIcon = "✗";
                labelColor = "#C0392B";
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = bgColor;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            ctx.fillStyle = personColor;
            ctx.fill();

            ctx.fillStyle = "#FFFFFF";
            ctx.font = "bold 9px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(labelIcon, p.x, p.y + 3);

            ctx.fillStyle = labelColor;
            ctx.font = "9px sans-serif";
            ctx.fillText(Math.round(signal) + " dBm", p.x, p.y - 16);
        });

        // Update metrics
        var totalA = people.filter(p => isInStoreA(p.x, p.y)).length;
        var coverageRatio = totalA > 0 ? Math.round((visitasA / totalA) * 100) : 100;

        var mRawA = document.getElementById('vecina-metric-raw-a');
        var mRawB = document.getElementById('vecina-metric-raw-b');
        var mVisA = document.getElementById('vecina-metric-visitas-a');
        var mVisB = document.getElementById('vecina-metric-visitas-b');
        var mFalsas = document.getElementById('vecina-metric-falsas');
        var mCob = document.getElementById('vecina-metric-cobertura');
        var badge = document.getElementById('vecina-status-badge');

        if (mRawA) mRawA.innerText = rawEntriesA;
        if (mRawB) mRawB.innerText = rawEntriesB;
        if (mVisA) mVisA.innerText = visitasA;
        if (mVisB) mVisB.innerText = visitasB;
        if (mFalsas) mFalsas.innerText = falsasVisitas;
        if (mCob) mCob.innerText = coverageRatio + "%";

        if (badge) {
            if (falsasVisitas === 0 && visitasB === 0) {
                badge.innerText = "SIN CONTAMINACIÓN";
                badge.className = "badge badge-green";
            } else {
                badge.innerText = "CONTAMINACIÓN CRUZADA";
                badge.className = "badge badge-red";
            }
        }
    }

    function setupCanvasEvents() {
        if (!canvas) return;

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        };

        const handleDown = (e) => {
            const pos = getPos(e);
            if (!isInAnyStore(pos.x, pos.y)) return;

            const hitIndex = people.findIndex(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 16);
            if (hitIndex !== -1) {
                selectedElement = { type: 'person', index: hitIndex };
                isDragging = true;
                return;
            }

            if (mode === 'person') {
                people.push({ x: pos.x, y: pos.y });
            } else if (mode === 'shelf') {
                shelves.push({ x: pos.x - 40, y: pos.y - 15, w: 80, h: 30 });
            }
        };

        const handleMove = (e) => {
            if (!isDragging || !selectedElement) return;
            const pos = getPos(e);
            if (isInAnyStore(pos.x, pos.y)) {
                if (selectedElement.type === 'person') {
                    people[selectedElement.index].x = pos.x;
                    people[selectedElement.index].y = pos.y;
                }
            }
        };

        const handleUp = () => {
            isDragging = false;
            selectedElement = null;
        };

        canvas.addEventListener('mousedown', handleDown);
        canvas.addEventListener('mousemove', handleMove);
        canvas.addEventListener('mouseup', handleUp);

        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleDown(e); }, { passive: false });
        canvas.addEventListener('touchmove', (e) => { e.preventDefault(); handleMove(e); }, { passive: false });
        canvas.addEventListener('touchend', handleUp);
    }

    return {
        initSim: initSim,
        setMode: setMode,
        updatePower: updatePower,
        clearElements: clearElements,
        loadPreset: loadPreset,
        toggleAnimation: toggleAnimation,
        setArchitecture: setArchitecture
    };
})();
