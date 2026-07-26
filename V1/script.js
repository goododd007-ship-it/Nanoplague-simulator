const GRID_SIZE = 40; 
let VACCINATION_RATE = 0.69; 

let kafkaHasPulsed = false;
let kafkaSpreadThisCycle = false;

let infectedHistory = [];
let deathHistory = [];
let uninfectedHistory = [];
let gridData = [];
let simulationInterval = null;
let currentDay = 0;
let isSimulationActive = false;
let isPaused = false;
let DAY_DURATION_MS = 300;
let currentVirus = null;

// Force recording flag used when manually stepping days while paused
let forceRecordThisCycle = false;

// --- Advanced settings (defaults)
let ANIMAL_OWNAGE_RATE = 0.10; 
let SOCIAL_DISTANCING_LEVEL = 0.0; 
let SYMPTOM_AWARENESS = 0.0; 

// --- Virus Parameters ---
let MIN_DAYS_BEFORE_RECOVERY = 10;
let DAILY_RECOVERY_CHANCE = 0.08;  
let COVID_MORTALITY = 0.02;  
let MEASLES_MORTALITY = 0.01; 
let LYSSA_MORTALITY = 0.05;   
let KAFKA_MORTALITY = 0.25;

// --- Automated Lockdown Parameters ---
let LOCKDOWN_TRIGGER_PERCENT = 0.15; 
let isLockdownActive = false;
let LOCKDOWN_EFFECTIVENESS = 0.75;   

// 1. Generate the population
function generatePopulation() {
    gridData = [];
    isLockdownActive = false; 
    for (let r = 0; r < GRID_SIZE; r++) {
        let streetRow = [];
        let streetName = `Street ${r + 1}`;
        
        for (let c = 0; c < GRID_SIZE; c++) {
            let isVaccinated = Math.random() < VACCINATION_RATE;
            
            streetRow.push({
                streetName: streetName,
                isVaccinated: isVaccinated,
                isInfected: false,
                isDead: false,          
                isRecovered: false,     
                daysInfected: 0,        
                hasAnimals: Math.random() < ANIMAL_OWNAGE_RATE,    
                isHighHygiene: Math.random() < 0.15, 
                isElderly: Math.random() < 0.1
            });
        }
        gridData.push(streetRow);
    }
}

// 2. Render the dots
function drawGrid() {
    const gridContainer = document.getElementById('grid');
    if (!gridContainer) return;
    gridContainer.innerHTML = ''; 
    
    // Structure & Layout
    gridContainer.style.display = "flex";
    gridContainer.style.flexDirection = "column";
    gridContainer.style.gap = "4px";
    gridContainer.style.borderRadius = "8px";

    // --- ENHANCED ANIMATED LOCKDOWN RIM LOGIC ---
    if (isLockdownActive) {
        gridContainer.style.padding = "24px"; 
        
        // Stacks the solid inner background over the striped background
        gridContainer.style.backgroundImage = "linear-gradient(#111111, #111111), repeating-linear-gradient(-45deg, #f1c40f, #f1c40f 15px, #111111 15px, #111111 30px)";
        gridContainer.style.backgroundOrigin = "content-box, padding-box";
        gridContainer.style.backgroundClip = "content-box, padding-box";

        gridContainer.style.backgroundSize = "auto, 42px 42px"; 
        gridContainer.style.animation = "hazardPan 1s linear infinite";
        
        gridContainer.style.boxShadow = "0 0 25px rgba(241, 196, 15, 0.4)";

        // Inject the CSS keyframes directly into the document if they aren't already there
        if (!document.getElementById('hazard-animation-styles')) {
            const styleStyle = document.createElement('style');
            styleStyle.id = 'hazard-animation-styles';
            styleStyle.innerHTML = `
                @keyframes hazardPan {
                    from { background-position: 0 0, 0 0; }
                    to { background-position: 0 0, 42px 0; }
                }
            `;
            document.head.appendChild(styleStyle);
        }
    } else {
        // NORMAL MODE: Turn off animation and return to clean original setup
        gridContainer.style.padding = "16px";
        gridContainer.style.backgroundColor = "#111111"; 
        gridContainer.style.backgroundImage = "none";
        gridContainer.style.animation = "none";
        gridContainer.style.boxShadow = "none";
    }

    // --- RENDER POPULATION SPHERES & COUNT CASES ---
    let totalInfected = 0;
    let totalVaccinated = 0;
    let totalDead = 0;
    let totalNeverInfected = 0;

    for (let r = 0; r < GRID_SIZE; r++) {
        let rowDiv = document.createElement('div');
        rowDiv.style.display = "flex";
        rowDiv.style.gap = "4px";
        
        for (let c = 0; c < GRID_SIZE; c++) {
            let houseData = gridData[r][c];
            let dot = document.createElement('div');
            
            dot.style.width = "16px";
            dot.style.height = "16px";
            dot.style.borderRadius = "50%";
            
            if (houseData.isDead) {
                dot.style.backgroundColor = "#2d2d2d"; 
                totalDead++;
            } else if (houseData.isInfected) {
                dot.style.backgroundColor = "#e74c3c"; 
                totalInfected++; // Count active infections
            } else if (houseData.isRecovered) {
                dot.style.backgroundColor = "#2ecc71"; 
                totalNeverInfected++;
            } else if (houseData.isVaccinated) {
                dot.style.backgroundColor = "#3498db"; 
                totalVaccinated++;
                totalNeverInfected++;
            } else {
                dot.style.backgroundColor = "#ffffff"; 
                totalNeverInfected++;
            }
            
            rowDiv.appendChild(dot);
        }
        gridContainer.appendChild(rowDiv);
    }

    // Update Counter Text Boxes
    document.getElementById("statDay").innerText = currentDay;
    document.getElementById("statCases").innerText = totalInfected;
    document.getElementById("statVax").innerText = totalVaccinated;

    if ((isSimulationActive && !isPaused) || forceRecordThisCycle) {
        infectedHistory.push(totalInfected);
        deathHistory.push(totalDead);
        uninfectedHistory.push(totalNeverInfected);
        forceRecordThisCycle = false;
    }

    const canvas = document.getElementById('epicurveGraph');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const totalPop = GRID_SIZE * GRID_SIZE;

        const maxDataPoints = Math.max(infectedHistory.length, deathHistory.length, uninfectedHistory.length, 60);
        
        const graphMaxDayLabel = document.getElementById("graphMaxDay");
        if (graphMaxDayLabel) graphMaxDayLabel.innerText = `Day ${maxDataPoints}`;


        ctx.strokeStyle = "#2d2d2d";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); // 50% marker
        

        let lockdownY = h - (LOCKDOWN_TRIGGER_PERCENT * h);
        ctx.moveTo(0, lockdownY); ctx.lineTo(w, lockdownY); 
        ctx.stroke();

        ctx.fillStyle = "#555";
        ctx.font = "9px monospace";
        ctx.fillText("LOCKDOWN TRIGGER LEVEL", 5, lockdownY - 4);

        // --- MULTI-LINE EPICURVE ---
        function drawLineFromHistory(arr, color, width) {
            if (!arr || arr.length === 0) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (let i = 0; i < arr.length; i++) {
                let x = (i / (maxDataPoints - 1)) * w;
                let val = arr[i] || 0;
                let y = h - ((val / totalPop) * h);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Draw uninfected (remaining) in blue
        drawLineFromHistory(uninfectedHistory, "#3498db", 2);
        // Draw deaths in dark gray
        drawLineFromHistory(deathHistory, "#7f8c8d", 2);
        // Draw infected in red (thicker)
        drawLineFromHistory(infectedHistory, "#e74c3c", 3);

        // Legend
        const legendX = w - 110;
        const legendY = 10;
        ctx.font = "10px monospace";
        // Uninfected
        ctx.fillStyle = "#3498db";
        ctx.fillRect(legendX, legendY, 10, 6);
        ctx.fillStyle = "#fff";
        ctx.fillText("Remaining uninfected", legendX + 14, legendY + 6);
        // Deaths
        ctx.fillStyle = "#7f8c8d";
        ctx.fillRect(legendX, legendY + 14, 10, 6);
        ctx.fillStyle = "#fff";
        ctx.fillText("Deaths", legendX + 14, legendY + 20);
        // Infected
        ctx.fillStyle = "#e74c3c";
        ctx.fillRect(legendX, legendY + 28, 10, 6);
        ctx.fillStyle = "#fff";
        ctx.fillText("Active infected", legendX + 14, legendY + 34);
    }
}
function kafkaVisualPulse() {
    const overlay = document.getElementById("kafkaOverlay");
    overlay.classList.remove("kafkaPulse"); 
    void overlay.offsetWidth; 
    overlay.classList.add("kafkaPulse");
}

function kafkaFinalDetonation() {
    const overlay = document.getElementById("kafkaOverlay");
    overlay.style.animation = "kafkaFinalFlash 1.2s ease-out";
    setTimeout(() => {
        overlay.style.animation = "";
    }, 1500);
}


// 3. UI Interaction Controls
function triggerOutbreak() {
    if (isSimulationActive) return; 
    
    isSimulationActive = true;
    currentDay = 0;
    infectedHistory = [];
    deathHistory = [];
    uninfectedHistory = [];
    kafkaHasPulsed = false;
    kafkaSpreadThisCycle = false;
    
    const vaxSlider = document.getElementById('vaxSlider');
    if (vaxSlider) vaxSlider.disabled = true;
    
    const selectedVirus = document.getElementById("virusSelect").value;
    currentVirus = selectedVirus;
    isPaused = false;

    if (currentVirus === "Kafka") {
        kafkaVisualPulse();
    }

    let centerRow = Math.floor(GRID_SIZE / 2);
    let centerCol = Math.floor(GRID_SIZE / 2);

    gridData[centerRow][centerCol].isInfected = true;
    gridData[centerRow][centerCol].daysInfected = 1; 

    drawGrid();
    startSimulationInterval();
}

function resetSimulation() {
    kafkaHasPulsed = false;
    clearInterval(simulationInterval);
    isSimulationActive = false;
    currentDay = 0;
    generatePopulation();
    drawGrid();
    infectedHistory = [];
    deathHistory = [];
    uninfectedHistory = [];
    const vaxSlider = document.getElementById('vaxSlider');
    if (vaxSlider) vaxSlider.disabled = false;
    
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerText = 'Pause';
    isPaused = false;
    currentVirus = null;
}

function runDayCycle(virusType) {
    currentDay++;

    // --- PHASE 1: AUTOMATED LOCKDOWN MONITORING ---
    let totalPopulation = GRID_SIZE * GRID_SIZE;
    let currentActiveCount = 0;
    
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (gridData[r][c].isInfected && !gridData[r][c].isDead) currentActiveCount++;
        }
    }

    let infectionRate = currentActiveCount / totalPopulation;
    if (infectionRate >= LOCKDOWN_TRIGGER_PERCENT && !isLockdownActive) {
        isLockdownActive = true;
        console.log(`[ALERT] Automated Lockdown triggered.`);
    } else if (infectionRate < 0.03 && isLockdownActive) {
        isLockdownActive = false; 
        console.log(`[INFO] Lockdown lifted.`);
    }

    // --- PHASE 2: LIFECYCLE & MUTATION MATRIX ---
    let nextGridState = JSON.parse(JSON.stringify(gridData));
    let exposedHousesThisCycle = new Set();

    let transmissionModifier = isLockdownActive ? (1 - LOCKDOWN_EFFECTIVENESS) : 1.0;

    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            let currentHouse = gridData[r][c];

            if (!currentHouse.isInfected || currentHouse.isDead) continue;

            let activeHouseNextState = nextGridState[r][c];
            activeHouseNextState.daysInfected++;

            // Evaluate Mortality Chance
            let dailyMortalityChance = 0;
            if (virusType === "covid") dailyMortalityChance = COVID_MORTALITY;
            if (virusType === "measles") dailyMortalityChance = MEASLES_MORTALITY;
            if (virusType === "lyssavirus") dailyMortalityChance = LYSSA_MORTALITY;
            if (virusType === "Kafka") dailyMortalityChance = KAFKA_MORTALITY;
            // Kafka should not cause deaths until an infected house has been infected for at least 2 days
            if (virusType === "Kafka" && activeHouseNextState.daysInfected < 2) {
                dailyMortalityChance = 0;
            }
            if (Math.random() < dailyMortalityChance) {
                activeHouseNextState.isInfected = false;
                activeHouseNextState.isDead = true;
                continue; 
            } 
            // --- NEW NOVEL VIRUS PROBABILISTIC RECOVERY ---
            else if (activeHouseNextState.daysInfected >= MIN_DAYS_BEFORE_RECOVERY) {

                if (virusType !== "Kafka") {
                    const effectiveRecovery = DAILY_RECOVERY_CHANCE * (1 + SYMPTOM_AWARENESS);
                    if (Math.random() < effectiveRecovery) {
                        activeHouseNextState.isInfected = false;
                        activeHouseNextState.isRecovered = true;
                        continue; 
                    }
                }
            }

            // --- TRANSMISSION LOGIC ---
            
            // --- Lyssavirus LOGIC ---
            if (virusType === "lyssavirus") {
                if (currentHouse.hasAnimals) {
                    const maxRadius = 3;
                    const baseProb = 0.9; 
                    const decay = 0.5; 
                    let attempts = 0;
                    const maxAttemptsPerSource = 6; 

                    for (let dr = -maxRadius; dr <= maxRadius; dr++) {
                        for (let dc = -maxRadius; dc <= maxRadius; dc++) {
                            if (dr === 0 && dc === 0) continue;
                            let tr = r + dr;
                            let tc = c + dc;
                            if (tr < 0 || tr >= GRID_SIZE || tc < 0 || tc >= GRID_SIZE) continue;

                            const distance = Math.max(Math.abs(dr), Math.abs(dc));
                            let prob = baseProb * Math.pow(decay, distance - 1) * transmissionModifier;

                            let target = nextGridState[tr][tc];
                            const key = `${tr},${tc}`;
                            if (target.isInfected || target.isDead || target.isRecovered || exposedHousesThisCycle.has(key)) continue;
                            exposedHousesThisCycle.add(key);

                            if (target.isVaccinated) prob *= 0.02; 
                            if (target.isHighHygiene) prob *= 0.6;
                            if (target.isElderly) prob *= 1.2;

                            if (Math.random() < prob) {
                                target.isInfected = true;
                                target.daysInfected = 1;
                                attempts++;
                            }
                            if (attempts >= maxAttemptsPerSource) break;
                        }
                        if (attempts >= maxAttemptsPerSource) break;
                    }
                } else {
                    let directions = [[-1,0], [1,0], [0,-1], [0,1]];
                    directions.forEach(([dr, dc]) => {
                        let tr = r + dr;
                        let tc = c + dc;
                        if (tr >= 0 && tr < GRID_SIZE && tc >= 0 && tc < GRID_SIZE) {
                            let targetHouse = nextGridState[tr][tc];
                            if (!targetHouse.isVaccinated && !targetHouse.isInfected && !targetHouse.isDead && !targetHouse.isRecovered) {
                                if (Math.random() < (0.35 * transmissionModifier)) { 
                                    targetHouse.isInfected = true;
                                    targetHouse.daysInfected = 1;
                                }
                            }
                        }
                    });
                }
            }

            // --- COVID-19 LOGIC ---
            if (virusType === "covid") {
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        let tr = r + dr;
                        let tc = c + dc;
                        
                        if (tr >= 0 && tr < GRID_SIZE && tc >= 0 && tc < GRID_SIZE) {
                            let targetHouse = nextGridState[tr][tc];
                            let coordinateKey = `${tr},${tc}`;
                            
                            if (targetHouse.isInfected || targetHouse.isDead || targetHouse.isRecovered || exposedHousesThisCycle.has(coordinateKey)) continue;
                            exposedHousesThisCycle.add(coordinateKey);
                            
                            let socialModifier = 1 - SOCIAL_DISTANCING_LEVEL;
                            let attackRate = targetHouse.isVaccinated ? 0.001 : 0.70;
                            if (Math.random() < (attackRate * transmissionModifier * socialModifier)) {
                                targetHouse.isInfected = true;
                                targetHouse.daysInfected = 1;
                            }
                        }
                    }
                }
                
                if (Math.random() < (isLockdownActive ? 0.01 : 0.05)) { 
                    let moveRow = Math.floor(Math.random() * 3) - 1;
                    let moveCol = Math.floor(Math.random() * 3) - 1;
                    if (!(moveRow === 0 && moveCol === 0)) {
                        let distance = Math.floor(Math.random() * 2) + 3;
                        for (let step = 1; step <= distance; step++) {
                            let jetR = r + (moveRow * step);
                            let jetC = c + (moveCol * step);
                            
                            if (jetR >= 0 && jetR < GRID_SIZE && jetC >= 0 && jetC < GRID_SIZE) {
                                let jetHouse = nextGridState[jetR][jetC];
                                let jetKey = `${jetR},${jetC}`;
                                
                                if (jetHouse.isInfected || jetHouse.isDead || jetHouse.isRecovered || exposedHousesThisCycle.has(jetKey)) continue;
                                exposedHousesThisCycle.add(jetKey);
                                
                                let socialModifier = 1 - SOCIAL_DISTANCING_LEVEL;
                                let attackRate = jetHouse.isVaccinated ? 0.05 : 0.70;
                                if (Math.random() < (attackRate * transmissionModifier * socialModifier)) {
                                    jetHouse.isInfected = true;
                                    jetHouse.daysInfected = 1;
                                }
                            }
                        }
                    }
                }
            }
            
            // --- Measles LOGIC ---
            if (virusType === "measles") {
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        let tr = r + dr;
                        let tc = c + dc;
                        
                        if (tr >= 0 && tr < GRID_SIZE && tc >= 0 && tc < GRID_SIZE) {
                            let targetHouse = nextGridState[tr][tc];
                            let coordinateKey = `${tr},${tc}`;
                            
                            if (targetHouse.isInfected || targetHouse.isDead || targetHouse.isRecovered || exposedHousesThisCycle.has(coordinateKey)) continue;
                            
                            if (targetHouse.isElderly && !targetHouse.isDead) {
                                targetHouse.isInfected = true;
                                targetHouse.daysInfected = 1;
                                continue;
                            }
                            
                            exposedHousesThisCycle.add(coordinateKey);

                            let socialModifier = 1 - SOCIAL_DISTANCING_LEVEL;
                            let attackRate = targetHouse.isVaccinated ? 0.001 : 0.90;
                            if (Math.random() < (attackRate * transmissionModifier * socialModifier)) {
                                targetHouse.isInfected = true;
                                targetHouse.daysInfected = 1;
                            }
                        }
                    }
                }
            }

// --- Kafka ---
            if (virusType === "Kafka") {

                // Kafka spreads FIRST
                const maxRadius = 50; 
                for (let dr = -maxRadius; dr <= maxRadius; dr++) {
                    for (let dc = -maxRadius; dc <= maxRadius; dc++) {

                        if (dr === 0 && dc === 0) continue;

                        let tr = r + dr;
                        let tc = c + dc;

                        if (tr >= 0 && tr < GRID_SIZE && tc >= 0 && tc < GRID_SIZE) {

                            let targetHouse = nextGridState[tr][tc];
                            let coordinateKey = `${tr},${tc}`;

                            if (targetHouse.isInfected || targetHouse.isDead || targetHouse.isRecovered || exposedHousesThisCycle.has(coordinateKey)) continue;

                            exposedHousesThisCycle.add(coordinateKey);

                            // Infect new house
                            targetHouse.isInfected = true;
                            targetHouse.daysInfected = 1;

                            kafkaSpreadThisCycle = true;
                        }
                    }
                }


                            // Kafka mortality AFTER spreading (only after at least 2 days infected)
                            if (activeHouseNextState.daysInfected >= 2 && Math.random() < KAFKA_MORTALITY) {
                                activeHouseNextState.isInfected = false;
                                activeHouseNextState.isDead = true;
                                continue;
                            }
                        }
                    }
                }


    
    let finalActiveCount = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (nextGridState[r][c].isInfected && !nextGridState[r][c].isDead) finalActiveCount++;
        }
    }

    gridData = nextGridState;
    drawGrid();

    if (finalActiveCount === 0) {
        clearInterval(simulationInterval);
        isSimulationActive = false;
        isPaused = false;
        isLockdownActive = false;
        const pauseBtn = document.getElementById('pauseBtn');
        if (pauseBtn) pauseBtn.innerText = 'Pause';
        const vaxSlider = document.getElementById('vaxSlider');
        if (vaxSlider) vaxSlider.disabled = false;
        currentVirus = null;
        alert(`Outbreak Settled! Transmission stopped entirely by Day ${currentDay}.`);
    }
}

function startSimulationInterval() {
    clearInterval(simulationInterval);
    if (!currentVirus) return;
    simulationInterval = setInterval(() => {
        runDayCycle(currentVirus);
    }, DAY_DURATION_MS);
}

function pauseResumeSimulation() {
    const pauseBtn = document.getElementById('pauseBtn');
    if (!isSimulationActive) return;
    if (!isPaused) {
        clearInterval(simulationInterval);
        isPaused = true;
        if (pauseBtn) pauseBtn.innerText = 'Resume';
    } else {
        isPaused = false;
        if (pauseBtn) pauseBtn.innerText = 'Pause';
        startSimulationInterval();
    }
}

function stepOneDay() {
    if (!isSimulationActive) {
        runDayCycle(currentVirus || document.getElementById('virusSelect').value);
        return;
    }
    // If simulation is active but paused, a manual step should still record graph history
    if (isPaused) {
        forceRecordThisCycle = true;
    }
    runDayCycle(currentVirus);
}

function setupVaxSlider() {
    const slider = document.getElementById('vaxSlider');
    const pct = document.getElementById('vaxPercent');
    if (!slider || !pct) return;

    slider.addEventListener('input', (e) => {
        const value = Number(e.target.value);
        pct.innerText = `${value}%`;
    });

    slider.addEventListener('change', (e) => {
        const value = Number(e.target.value);
        VACCINATION_RATE = value / 100;
        generatePopulation();
        drawGrid();
    });

    pct.innerText = `${Math.round(VACCINATION_RATE * 100)}%`;
}

function setupDayControls() {
    const slider = document.getElementById('daySpeedSlider');
    const display = document.getElementById('daySpeedDisplay');
    const pauseBtn = document.getElementById('pauseBtn');
    const stepBtn = document.getElementById('stepDayBtn');

    if (display) display.innerText = `${DAY_DURATION_MS} ms/day`;

    if (slider) {
        slider.addEventListener('input', (e) => {
            DAY_DURATION_MS = Number(e.target.value);
            if (display) display.innerText = `${DAY_DURATION_MS} ms/day`;
        });

        slider.addEventListener('change', (e) => {
            DAY_DURATION_MS = Number(e.target.value);
            if (isSimulationActive && !isPaused) {
                startSimulationInterval();
            }
        });
    }
    
    if (pauseBtn) pauseBtn.addEventListener('click', pauseResumeSimulation);
    if (stepBtn) stepBtn.addEventListener('click', stepOneDay);
}

function setupAdvancedSettings() {
    const advToggle = document.getElementById('advToggle');
    const advPanel = document.getElementById('advancedSettings');
    const advArrow = document.getElementById('advArrow');

    const animalSlider = document.getElementById('animalRateSlider');
    const animalPct = document.getElementById('animalRatePct');
    const socialSlider = document.getElementById('socialDistSlider');
    const socialPct = document.getElementById('socialDistPct');
    const symptomSlider = document.getElementById('symptomAwarenessSlider');
    const symptomPct = document.getElementById('symptomAwarenessPct');

    if (advToggle && advPanel && advArrow) {
        advToggle.addEventListener('click', () => {
            if (advPanel.style.display === 'none' || advPanel.style.display === '') {
                advPanel.style.display = 'block';
                advArrow.style.transform = 'rotate(180deg)';
            } else {
                advPanel.style.display = 'none';
                advArrow.style.transform = 'rotate(0deg)';
            }
        });
    }

    if (animalSlider && animalPct) {
        animalPct.innerText = `${Math.round(ANIMAL_OWNAGE_RATE * 100)}%`;
        animalSlider.addEventListener('input', (e) => {
            const v = Number(e.target.value);
            animalPct.innerText = `${v}%`;
        });
        animalSlider.addEventListener('change', (e) => {
            ANIMAL_OWNAGE_RATE = Number(e.target.value) / 100;
            generatePopulation();
            drawGrid();
        });
    }

    if (socialSlider && socialPct) {
        socialPct.innerText = `${Math.round(SOCIAL_DISTANCING_LEVEL * 100)}%`;
        socialSlider.addEventListener('input', (e) => {
            const v = Number(e.target.value);
            socialPct.innerText = `${v}%`;
        });
        socialSlider.addEventListener('change', (e) => {
            SOCIAL_DISTANCING_LEVEL = Number(e.target.value) / 100;
        });
    }

    if (symptomSlider && symptomPct) {
        symptomPct.innerText = `${Math.round(SYMPTOM_AWARENESS * 100)}%`;
        symptomSlider.addEventListener('input', (e) => {
            const v = Number(e.target.value);
            symptomPct.innerText = `${v}%`;
        });
        symptomSlider.addEventListener('change', (e) => {
            SYMPTOM_AWARENESS = Number(e.target.value) / 100;
        });
    }
}

generatePopulation();
drawGrid();

window.addEventListener('load', () => { 
    setupVaxSlider(); 
    setupDayControls(); 
    setupAdvancedSettings();

    // --- AUTOMATED SIDEBAR INJECTION ---
    const grid = document.getElementById('grid');
    if (grid && grid.parentElement) {

        const wrapper = document.createElement('div');
        wrapper.style.display = "flex";
        wrapper.style.gap = "30px";
        wrapper.style.alignItems = "flex-start";
        wrapper.style.justifyContent = "center";
        wrapper.style.marginTop = "20px";


        grid.parentElement.insertBefore(wrapper, grid);
        wrapper.appendChild(grid);


        const sidebar = document.createElement('div');
        sidebar.id = "sidebar";
        sidebar.style.width = "320px";
        sidebar.style.display = "flex";
        sidebar.style.flexDirection = "column";
        sidebar.style.gap = "20px";


        sidebar.innerHTML = `
            <div id="lockdownAlert" style="
                min-height: 50px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                border-radius: 6px; 
                font-weight: bold; 
                font-family: monospace; 
                font-size: 1.1rem;
                transition: all 0.3s ease;">
            </div>

            <div style="background-color: #111111; padding: 15px; border-radius: 8px; border: 1px solid #333;">
                <h3 style="margin: 0 0 10px 0; font-family: monospace; color: #fff; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Epidemic Curve</h3>
                <canvas id="epicurveGraph" width="290" height="180" style="background-color: #1a1a1a; border-radius: 4px;"></canvas>
                <div style="display: flex; justify-content: space-between; margin-top: 5px; font-family: monospace; font-size: 0.75rem; color: #888;">
                    <span>Day 0</span>
                    <span id="graphMaxDay">End</span>
                </div>
            </div>
        `;


        wrapper.appendChild(sidebar);
    }
});
