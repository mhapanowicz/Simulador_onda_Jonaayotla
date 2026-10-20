const RFSimulator = (function() {
    var canvas, ctx;
    // Modelo de propagacion calibrado por Jonathan:
    // RAW: 0 a -100 dBm — atenúa por cuerpos, anaqueles, paredes y clima
    // VISITAS: -20 a -90 dBm — depende de distancia + atenuación por cuerpos de agua y anaqueles
    // Tramo 1 (0-600px): logaritmico, signal = -19.86 - 14.5*log10(dist)
    // Tramo 2 (600-1100px): lineal, de -60 a -100 dBm
    var antenna = { x: 700, y: 440, baseTxPower: -19.86, cutoffdBm: -40 };
    var mode = 'person';
    var people = [];
    var shelves = [];
    var wavePhase = 0;
    var selectedElement = null;
    var isDragging = false;
    var isAnimRunning = false;
    var isPaused = false;

    var storeBounds = { x: 40, y: 40, width: 720, height: 440, wallThickness: 8 };
    var cashierZone = { x: 620, y: 380, width: 120, height: 80 };

    function initSim() {
        canvas = document.getElementById('wavesCanvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        // Inicializar display de dBm y distancia
        var slider = document.getElementById('powerSlider');
        if (slider) updatePower(slider.value);
        loadPreset('max_capacity');
        setupCanvasEvents();
        if (!isAnimRunning) {
            isAnimRunning = true;
            animate();
        }
    }

    function setMode(newMode) {
        mode = newMode;
        var btnP = document.getElementById('btn-add-person');
        var btnS = document.getElementById('btn-add-shelf');
        if (btnP) btnP.className = mode === 'person' ? 'btn btn-primary' : 'btn';
        if (btnS) btnS.className = mode === 'shelf' ? 'btn btn-primary' : 'btn';
    }

    // dBm de visión natural (raw) — varía con atenuación de cuerpos, anaqueles, paredes y clima.
    var RAW_DBM = -100;

    function updatePower(val) {
        antenna.cutoffdBm = parseFloat(val);
        
        var pVal = document.getElementById('power-val');
        if (pVal) pVal.innerText = antenna.cutoffdBm + " dBm";
        
        // Distancia de calibración (umbral de visitas)
        var calRadiusPx = getCoverageRadius();
        var calRadiusM = (calRadiusPx * 0.1).toFixed(1);
        
        // Distancia de visión natural (raw, -100 dBm) — alcance máximo teórico, atenúa con obstáculos
        var rawRadiusPx = getRawCoverageRadius();
        var rawRadiusM = (rawRadiusPx * 0.1).toFixed(1);
        
        var distEl = document.getElementById('vision-distance');
        if (distEl) distEl.innerText = "Calibración: " + calRadiusM + " m | Raw: " + rawRadiusM + " m";
    }

    function clearElements() {
        people = [];
        shelves = [];
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
            people = [];
        } else if (type === 'medium') {
            people = [
                { x: 650, y: 200 }, { x: 550, y: 280 }, { x: 450, y: 180 },
                { x: 380, y: 280 }, { x: 280, y: 180 }, { x: 200, y: 280 },
                { x: 120, y: 150 }, { x: 100, y: 380 }
            ];
        } else if (type === 'crowded') {
            for (let i = 0; i < 20; i++) {
                people.push({ x: 80 + Math.random() * 600, y: 70 + Math.random() * 340 });
            }
        } else if (type === 'max_capacity') {
            for (let i = 0; i < 50; i++) {
                people.push({ x: 80 + Math.random() * 620, y: 70 + Math.random() * 340 });
            }
        } else if (type === 'shelves') {
            shelves.push({ x: 480, y: 220, w: 160, h: 30 });
            shelves.push({ x: 480, y: 320, w: 160, h: 30 });
            for (let i = 0; i < 15; i++) {
                people.push({ x: 80 + Math.random() * 600, y: 80 + Math.random() * 320 });
            }
        }
    }

    function isInStore(x, y) {
        return x >= storeBounds.x && 
               x <= storeBounds.x + storeBounds.width &&
               y >= storeBounds.y && 
               y <= storeBounds.y + storeBounds.height;
    }

    // Radio de calibracion (donde la senal = cutoffdBm) sin atenuacion
    // Visitas pueden ir de -20 a -90 dBm segun distancia + atenuacion
    function getCoverageRadius() {
        var dbm = antenna.cutoffdBm;
        if (dbm >= -60.1) {
            // Tramo 1: signal = -19.86 - 14.5*log10(r) = dbm
            return Math.max(5, Math.pow(10, (-19.86 - dbm) / 14.5));
        } else {
            // Tramo 2: lineal de -60.1 (600px) a -90 (1100px max para visitas)
            var t = (-60.1 - dbm) / 29.9;
            return 600 + t * 500;
        }
    }

    // Radio de visión natural (raw, -100 dBm) — alcance máximo teórico sin obstáculos
    // El heatmap calcula la atenuación real punto por punto; este radio es solo el límite visual.
    function getRawCoverageRadius() {
        return 1100; // 110m, -100 dBm — siempre mayor que la tienda
    }

    // Cálculo de señal para VISITAS (con atenuación por cuerpos de agua y anaqueles)
    // Rango de visitas: -20 a -90 dBm
    function calculateSignalAt(x, y) {
        const dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return -20; // Literalmente al lado de la antena = -20 dBm

        // Path loss con modelo de dos tramos
        let pathLoss;
        if (dist <= 600) {
            // Tramo 1: logaritmico calibrado (-20 a 5px, -60 a 600px)
            pathLoss = 10.86 + 14.5 * Math.log10(dist);
        } else {
            // Tramo 2: lineal de -60.1 (600px) a -90 (1100px)
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

        let rxSignal = -pathLoss - waterAtten - shelfAtten;
        // Clamp de visitas: maximo -20 dBm (al lado de antena), minimo -90 dBm (maximo atenuado)
        return Math.max(-90, Math.min(-20, rxSignal));
    }

    // Cálculo de señal RAW (visión natural) — CON atenuación por cuerpos, anaqueles, paredes y clima
    function calculateRawSignalAt(x, y) {
        const dist = Math.hypot(x - antenna.x, y - antenna.y);
        if (dist < 5) return 0; // Literalmente al lado = 0 dBm

        // Path loss (modelo raw de 0 a -100 dBm)
        let pathLoss;
        if (dist <= 600) {
            pathLoss = 14.5 * Math.log10(dist); // 0 dBm a ~-40 dBm
        } else {
            var t = (dist - 600) / 500;
            pathLoss = 14.5 * Math.log10(600) + t * 60; // de -40 a -100 dBm
        }

        // Atenuación por cuerpos de agua (personas)
        let waterAtten = 0;
        people.forEach(p => {
            const distToLine = pointToSegmentDistance(p, antenna, {x, y});
            if (distToLine < 20) waterAtten += 2.8;
        });

        // Atenuación por anaqueles
        let shelfAtten = 0;
        shelves.forEach(s => {
            if (lineIntersectsRect(antenna, {x, y}, s)) shelfAtten += 5.0;
        });

        // Atenuación por clima (lluvia + temperatura)
        let climateAtten = (typeof lluviaAtten !== 'undefined' ? lluviaAtten : 0) + (typeof tempAtten !== 'undefined' ? tempAtten : 0);

        let rxSignal = -pathLoss - waterAtten - shelfAtten - climateAtten;
        // Clamp raw: 0 a -100 dBm
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
        var rfTab = document.getElementById('tab-rf');
        if (rfTab && rfTab.classList.contains('active')) {
            drawWavesSimulation();
        }
        requestAnimationFrame(animate);
    }

    function toggleAnimation() {
        isPaused = !isPaused;
        var btn = document.getElementById('btn-toggle-anim');
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

    function drawWavesSimulation() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo general (área fuera de tienda)
        ctx.fillStyle = "#F0F0F2";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Store Floor
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(storeBounds.x, storeBounds.y, storeBounds.width, storeBounds.height);

        var calRadius = getCoverageRadius();      // Radio de calibración (visitas)
        var rawRadius = getRawCoverageRadius();    // Radio de visión natural (-100 dBm)

        // === Heatmap de 3 zonas ===
        // Verde: dentro de calibración (visitas)
        // Azul tenue: entre calibración y raw (detectado pero no visita)
        // El raw cubre la tienda pero puede reducirse por atenuación de obstáculos
        const gridSize = 14;
        for (let x = 0; x < canvas.width; x += gridSize) {
            for (let y = 0; y < canvas.height; y += gridSize) {
                const cx = x + gridSize/2;
                const cy = y + gridSize/2;
                const rawSignal = calculateRawSignalAt(cx, cy);
                const visSignal = calculateSignalAt(cx, cy);
                
                if (visSignal >= antenna.cutoffdBm) {
                    // Dentro de calibración = visitas (verde) — intensidad proporcional
                    var visAlpha = 0.08 + 0.12 * Math.max(0, (visSignal - antenna.cutoffdBm) / (-20 - antenna.cutoffdBm));
                    ctx.fillStyle = "rgba(44, 173, 120, " + visAlpha + ")";
                } else if (rawSignal >= RAW_DBM) {
                    // Detectado por raw pero no es visita (azul tenue) — intensidad proporcional a señal raw
                    var rawAlpha = 0.04 + 0.16 * Math.max(0, (rawSignal - RAW_DBM) / (0 - RAW_DBM));
                    ctx.fillStyle = "rgba(52, 152, 219, " + rawAlpha + ")";
                } else {
                    // Fuera de raw = no detectado (gris)
                    ctx.fillStyle = "rgba(220, 224, 230, 0.25)";
                }
                ctx.fillRect(x, y, gridSize, gridSize);
            }
        }

        // === ONDA DE VISIÓN NATURAL (Raw, azul) — cubre tienda + exterior, atenúa con obstáculos ===
        // Se dibuja fuera y dentro de la tienda
        ctx.save();
        // No clip a tienda: la onda raw puede extender fuera

        // Círculo límite raw
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, rawRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(41, 128, 185, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Etiqueta raw
        var rawLabelAngle = -Math.PI / 4;
        var rawLabelX = antenna.x + Math.cos(rawLabelAngle) * rawRadius;
        var rawLabelY = antenna.y + Math.sin(rawLabelAngle) * rawRadius;
        ctx.fillStyle = 'rgba(41, 128, 185, 0.9)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        var rawDistM = (rawRadius * 0.1).toFixed(1);
        // Fondo para legibilidad
        var rawLabel = 'Raw -100 dBm · ' + rawDistM + ' m';
        var rawLabelW = ctx.measureText(rawLabel).width;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(rawLabelX - rawLabelW/2 - 4, rawLabelY - 16, rawLabelW + 8, 14);
        ctx.fillStyle = 'rgba(41, 128, 185, 0.9)';
        ctx.fillText(rawLabel, rawLabelX, rawLabelY - 6);

        // Ondas concéntricas raw (azul, tenues)
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

        // === ONDA DE CALIBRACIÓN (Visitas, verde) — SIN línea punteada ===
        ctx.save();
        ctx.beginPath();
        ctx.rect(storeBounds.x, storeBounds.y, storeBounds.width, storeBounds.height);
        ctx.clip();

        // Ondas concéntricas de calibración (verde) — sin círculo límite punteado
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

        // Cashier Zone
        ctx.fillStyle = "#EAECEE";
        ctx.strokeStyle = "#BDC3C7";
        ctx.lineWidth = 1.5;
        ctx.fillRect(cashierZone.x, cashierZone.y, cashierZone.width, cashierZone.height);
        ctx.strokeRect(cashierZone.x, cashierZone.y, cashierZone.width, cashierZone.height);
        
        ctx.fillStyle = "#7F8C8D";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ÁREA DE CAJAS", cashierZone.x + cashierZone.width/2, cashierZone.y + cashierZone.height/2 + 16);

        // Shelves
        ctx.fillStyle = "#34495E";
        shelves.forEach(s => {
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.strokeStyle = "#2C3E50";
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "10px sans-serif";
            ctx.fillText("ANAQUEL", s.x + s.w/2, s.y + s.h/2 + 3);
            ctx.fillStyle = "#34495E";
        });

        // Store Outer Walls & Doors
        ctx.strokeStyle = "#2C3E50";
        ctx.lineWidth = storeBounds.wallThickness;
        ctx.strokeRect(
            storeBounds.x - storeBounds.wallThickness/2, 
            storeBounds.y - storeBounds.wallThickness/2, 
            storeBounds.width + storeBounds.wallThickness, 
            storeBounds.height + storeBounds.wallThickness
        );

        ctx.fillStyle = "#2C3E50";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText("ENTRADA PRINCIPAL TIENDA", storeBounds.x + 140, storeBounds.y - 12);

        ctx.clearRect(storeBounds.x + 60, storeBounds.y - storeBounds.wallThickness, 140, storeBounds.wallThickness + 2);
        ctx.strokeStyle = "#2CAD78";
        ctx.lineWidth = 2;
        ctx.strokeRect(storeBounds.x + 60, storeBounds.y - 2, 140, 4);

        // Antenna node
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
        ctx.fillText("ANTENA", antenna.x, antenna.y + 3);
        ctx.restore();

        // People & Attenuation Detections
        let detectedInStoreCount = 0;  // dentro de calibración (visitas)
        let rawEntriesCount = 0;       // dentro de raw (detectado pero puede no ser visita)

        people.forEach((p) => {
            const signal = calculateSignalAt(p.x, p.y);
            const rawSignal = calculateRawSignalAt(p.x, p.y);
            if (rawSignal >= RAW_DBM) rawEntriesCount++;

            const isInsideCalibration = signal >= antenna.cutoffdBm;
            const isInsideRaw = rawSignal >= RAW_DBM; // raw puede reducirse por atenuación
            if (isInsideCalibration) detectedInStoreCount++;

            // Color: verde = visita, naranja = raw pero fuera de calibración, rojo = fuera de raw
            var personColor, bgColor, labelIcon, labelColor;
            if (isInsideCalibration) {
                personColor = "#2CAD78";
                bgColor = "rgba(44, 173, 120, 0.25)";
                labelIcon = "✓";
                labelColor = "#1E8A5C";
            } else if (isInsideRaw) {
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
            ctx.font = "10px sans-serif";
            ctx.fillText(`${Math.round(signal)} dBm (visitas)`, p.x, p.y - 16);
        });

        // Dashboard Metrics Update
        const total = people.length;
        const coverageRatio = total > 0 ? Math.round((detectedInStoreCount / total) * 100) : 100;

        const mTotal = document.getElementById('metric-total');
        const mDetected = document.getElementById('metric-detected');
        const mCoverage = document.getElementById('metric-coverage');
        const badge = document.getElementById('status-badge');

        if (mTotal) mTotal.innerText = rawEntriesCount;
        if (mDetected) mDetected.innerText = detectedInStoreCount;
        if (mCoverage) mCoverage.innerText = coverageRatio + "%";

        if (badge) {
            if (coverageRatio >= 95) {
                badge.innerText = "CALIBRACIÓN ÓPTIMA (100% VISIBLE)";
                badge.className = "badge badge-green";
            } else if (coverageRatio >= 60) {
                badge.innerText = "VISIÓN PARCIAL (AMPLIAR CAMPO DE VISIÓN)";
                badge.className = "badge badge-orange";
            } else {
                badge.innerText = "ENTRADA FUERA DEL CAMPO (AMPLIAR RSSI)";
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
            if (!isInStore(pos.x, pos.y)) return;

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
            if (isInStore(pos.x, pos.y)) {
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
        toggleAnimation: toggleAnimation
    };
})();
