const globalScope = typeof window !== 'undefined' ? window : globalThis;

const SUBURBS = globalScope.SUBURBS || ['Central', 'North', 'South', 'East', 'West'];
const SUBURB_GRID_SIZE = globalScope.SUBURB_GRID_SIZE || 25;

const cityData = (globalScope.cityData = globalScope.cityData || {});
let currentViewedSector = globalScope.currentViewedSector || SUBURBS[0] || 'Central';
globalScope.currentViewedSector = currentViewedSector;

let simulationTimeline = []; // Stores the time steps (0, 1, 2, 3...)
let historyInfected = [];    // Stores infected counts over time
let historyRecovered = [];   // Stores recovered counts over time
let historyDeceased = [];    // Stores dead counts over time

const graphCanvas = document.getElementById('epicenterGraph');
const graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null;

let simulationTimer = null;
let tickSpeedMs = parseInt(globalScope.tickSpeedMs || 800, 10);
let simulationRunning = false;
let simulationEpoch = 0;
let simulationPaused = false;

let nanoPlagueSettings = {
    temperatureMod: 1.0,
    hygieneMod: 0.0,
    lethalityBase: 0.10,
    lethalityBoost: 0.0,
    copyKafkaMutation: false,
    copyCovidStealth: false,
    copyPlagueAnimalBias: false,
    copyMeaslesBurst: false
};

let globalMutationMod = 1.0;
let globalAnimalMod = 1.0;
let globalSanitationMod = 0.0;
// 1. Update your configuration object to include the target occupancy rates
const sectorLayouts = {
    'Central': { rows: 20, cols: 20, occupancy: 1.0 },  // 100% full
    'North':   { rows: 20, cols: 20, occupancy: 0.45 }, // 45% sparse occupancy
    'South':   { rows: 20, cols: 20, occupancy: 0.50 }, 
    'East':    { rows: 20, cols: 20, occupancy: 0.60 },
    'West':    { rows: 20, cols: 20, occupancy: 0.60 }
};

function resetMap(currentSector) {
    // 1. DYNAMIC CHECK: Look at the tabs to see which sector is ACTUALLY active right now
    let sector = currentSector;
    if (!sector) {
        const activeTab = document.querySelector('#sector-nav .nav-tab.active');
        if (activeTab) {
            // Extracts the clean sector name (e.g., "North" from "North" or "Central" from "Central Hub")
            if (activeTab.textContent.includes('Central')) sector = 'Central';
            else if (activeTab.textContent.includes('North')) sector = 'North';
            else if (activeTab.textContent.includes('South')) sector = 'South';
            else if (activeTab.textContent.includes('East')) sector = 'East';
            else if (activeTab.textContent.includes('West')) sector = 'West';
        }
    }
    
    // Fallback just in case
    sector = sector || 'Central';

    const mapContainer = document.getElementById('city-map');
    if (!mapContainer) return;
    
    mapContainer.innerHTML = ''; 
    
    const layout = sectorLayouts[sector] || { rows: 20, cols: 20, occupancy: 1.0 };
    const animalSlider = document.getElementById('slider-animal');
    const animalRatio = animalSlider ? (parseInt(animalSlider.value) / 100) : 0.15;

    for (let r = 0; r < layout.rows; r++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'grid-row';
        
        for (let c = 0; c < layout.cols; c++) {
            const cell = document.createElement('div');
            
            // Apply the occupancy roll to determine visibility
            if (Math.random() < layout.occupancy) {
                cell.className = 'cell'; 
                
                if (Math.random() < animalRatio) {
                    cell.classList.add('animal-node');
                }
            } else {
                // Keep structural placeholders invisible
                cell.className = 'cell cell-empty';
                cell.style.opacity = '0';
                cell.style.pointerEvents = 'none';
            }
            
            rowDiv.appendChild(cell);
        }
        mapContainer.appendChild(rowDiv);
    }
    
    // Clear counts
    if(document.getElementById('count-inf')) document.getElementById('count-inf').innerText = '0';
    if(document.getElementById('count-vax')) document.getElementById('count-vax').innerText = '0';
    if(document.getElementById('count-dead')) document.getElementById('count-dead').innerText = '0';
}
// 3. Make sure your switch sector function triggers the reset cleanly!
function switchSector(sectorName) {
    currentActiveSector = sectorName;
    
    // Update active visual states on UI tabs
    document.querySelectorAll('#sector-nav .nav-tab').forEach(tab => {
        tab.classList.remove('active');
        if(tab.textContent.includes(sectorName)) {
            tab.classList.add('active');
        }
    });
    
    // Re-render the map with the exact bounds of the new sector
    resetMap(sectorName);
}

function stopSimulation() {
    if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
    }
    simulationRunning = false;
    simulationPaused = true;
    simulationEpoch += 1;
}

function startSimulation() {
    if (simulationRunning && !simulationPaused) return;

    stopSimulation();

    simulationRunning = true;
    simulationPaused = false;
    const activeEpoch = ++simulationEpoch;

    simulationTimer = window.setInterval(() => {
        if (!simulationRunning || simulationPaused || activeEpoch !== simulationEpoch) return;
        advanceSimulation(activeEpoch);
    }, tickSpeedMs);
}

function advanceSimulation(activeEpoch = simulationEpoch) {
    if (!simulationRunning || simulationPaused) return;
    if (activeEpoch !== simulationEpoch) return;

    let changed = false;
    applyDeltaVariantStores();

    SUBURBS.forEach(suburbName => {
        if (activeEpoch !== simulationEpoch) return;
        const matrix = getMatrixForSuburb(suburbName);
        if (!matrix) return;

        const tickActions = [];

        matrix.forEach((row, r) => {
            row.forEach((entity, c) => {
                const pathogenKey = entity.pathogenKey || 'AlphaVariant';
                const isPostMortemNanoPlague = entity.isDead && pathogenKey === 'nanoplague' && nanoPlagueSettings.lethalityBoost > 0;
                if (entity.isInfected || isPostMortemNanoPlague) {
                    const pathogen = PATHOGEN_VAULT[pathogenKey];
                    if (!pathogen) return;
                    if (entity.isDead && pathogenKey !== 'OmegaVariant' && pathogenKey !== 'plague' && !isPostMortemNanoPlague) return;
                    tickActions.push({ entity, r, c, suburbName, matrix, pathogen, pathogenKey });
                }
                if (entity.isVaccinated && !entity.isDead) {
                    processVaccinationSpread(matrix, r, c);
                }
            });
        });

        tickActions.forEach(({ entity, r, c, suburbName, matrix, pathogen, pathogenKey }) => {
            if (activeEpoch !== simulationEpoch) return;
            
            entity.infectionAge = (entity.infectionAge || 0) + 1;
            pathogen.onTick(entity, r, c, suburbName);

            const targets = pathogen.getSpreadTargets(matrix, r, c, entity);
            targets.forEach(({ r: tr, c: tc }) => {
                const target = matrix[tr]?.[tc];
                if (!target) return;
                if (!pathogen.isEligibleTarget(matrix, tr, tc, target, entity)) return;
                if (pathogen.shouldSpread(entity.type, target.type, entity)) {
                    if (infectEntity(target, pathogenKey)) changed = true;
                }
            });

            if (entity.infectionAge >= pathogen.lifespan) {
                const allowPostMortemSpread = entity.isDead && pathogenKey === 'nanoplague' && nanoPlagueSettings.lethalityBoost > 0;

                if (allowPostMortemSpread) {
                    const postMortemChance = Math.min(0.95, 0.15 + nanoPlagueSettings.lethalityBoost * 0.85);
                    if (Math.random() < postMortemChance) {
                        entity.isInfected = true;
                        entity.isInfectiousBody = true;
                        entity.pathogenKey = 'nanoplague';
                        entity.infectionAge = 0;
                        changed = true;
                    } else {
                        entity.isInfected = false;
                        entity.isInfectiousBody = false;
                        entity.isVaccinated = true;
                        changed = true;
                    }
                } else if (entity.isDead && (pathogenKey === 'OmegaVariant' || pathogenKey === 'plague')) {
                    entity.infectionAge = 0; 
                } else {
                    const shouldDie = pathogen.resolveInfection(entity);
                    if (shouldDie) {
                        entity.isDead = true;
                        if (pathogenKey === 'OmegaVariant' && entity.type === 'human') {
                            entity.isInfected = true;
                            entity.isInfectiousBody = true;
                            entity.pathogenKey = 'OmegaVariant';
                        } else {
                            entity.isInfected = false;
                        }
                        changed = true;
                    } else {
                        entity.isInfected = false;
                        entity.isVaccinated = true;
                        changed = true;
                    }
                }
            }
        });
    });

    if (activeEpoch !== simulationEpoch) return;

    simulateCrossSectorCommuting(); 
    checkBotulismSupplyChain();      

    if (changed || simulationRunning) {
        renderCurrentSector();
    }
    updateStatsPanel();

    const nextStep = simulationTimeline.length;
    simulationTimeline.push(nextStep);

    let stepInfected = 0;
    let stepVaccinated = 0;
    let stepDead = 0;

    for (let i = 0; i < SUBURBS.length; i++) {
        const matrix = cityData[SUBURBS[i]];
        if (!matrix) continue;
        matrix.forEach(row => {
            row.forEach(entity => {
                if (entity.isDead) stepDead++;
                else if (entity.isInfected) stepInfected++;
                else if (entity.isVaccinated) stepVaccinated++;
            });
        });
    }

    historyInfected.push(stepInfected);
    historyRecovered.push(stepVaccinated);
    historyDeceased.push(stepDead);

    updateTimelineGraph();
}

function createEmptyMatrix(suburbName) {
    const matrix = [];
    
    let animalChance = 0.15; 
    let densityChance = 1.0;  
    
    // Explicitly map matching density thresholds to match your UI configuration profiles
    if (suburbName === 'Central') {
        animalChance = 0.02;  
        densityChance = 1.0;  
    } else if (suburbName === 'North' || suburbName === 'South') {
        animalChance = 0.40;  
        densityChance = 0.45; // 45% Occupancy
    } else if (suburbName === 'East' || suburbName === 'West') {
        animalChance = 0.15;  
        densityChance = 0.60; // 60% Occupancy
    }

    for (let r = 0; r < SUBURB_GRID_SIZE; r++) {
        const row = [];
        for (let c = 0; c < SUBURB_GRID_SIZE; c++) {
            // Roll against density to see if a node exists structurally
            const isOccupied = Math.random() < densityChance;
            
            row.push({
                type: Math.random() < animalChance ? 'animal' : 'human',
                isInfected: false,
                isDead: false,
                isVaccinated: false,
                infectionAge: 0,
                stealthTicks: 0,
                pathogenKey: null,
                isInfectiousBody: false,
                isEmpty: !isOccupied // Properly marks nodes as empty/invisible
            });
        }
        matrix.push(row);
    }
    cityData[suburbName] = matrix;
    return matrix;
}
function getMatrixForSuburb(suburbName) {
    if (!cityData[suburbName]) {
        return createEmptyMatrix(suburbName);
    }
    return cityData[suburbName];
}

function getCurrentMatrix() {
    const sector = currentViewedSector || SUBURBS[0] || 'Central';
    currentViewedSector = sector;
    globalScope.currentViewedSector = sector;
    return getMatrixForSuburb(sector);
}

function setViewedSector(sector) {
    currentViewedSector = sector;
    globalScope.currentViewedSector = sector;
}

// --- BASE PATHOGEN CLASS ---
class Pathogen {
    constructor(name, transmissionRate, mortalityRate, animalVectorContagion) {
        this.name = name;
        this.transmissionRate = transmissionRate;
        this.mortalityRate = mortalityRate;
        this.animalVectorContagion = animalVectorContagion;
        this.lifespan = 10;
    }

    shouldSpread(sourceType, targetType, host) {
        const isCrossSpecies = sourceType !== targetType;
        const chance = isCrossSpecies ? this.animalVectorContagion : this.transmissionRate;
        return Math.random() < chance;
    }

    resolveInfection(host) {
        return Math.random() < this.mortalityRate;
    }

    collectPositions(matrix, r, c, radius) {
        const positions = [];
        const intRadius = Math.max(1, Math.round(radius)); 
        
        for (let dr = -intRadius; dr <= intRadius; dr++) {
            for (let dc = -intRadius; dc <= intRadius; dc++) {
                if (dr === 0 && dc === 0) continue;
                if (Math.max(Math.abs(dr), Math.abs(dc)) !== intRadius) continue;

                const nr = r + dr;
                const nc = c + dc;

                if (nr < 0 || nc < 0 || nr >= matrix.length || nc >= matrix[0].length) continue;
                positions.push({ r: nr, c: nc });
            }
        }
        return positions;
    }

    getSpreadTargets(matrix, r, c, host) {
        return this.collectPositions(matrix, r, c, 1);
    }

    isEligibleTarget(matrix, r, c, target, host) {
        if (target.isEmpty) return false; 
        if (target.isVaccinated) return false;
        if (target.isDead && host?.pathogenKey !== 'OmegaVariant') return false;
        if (target.isInfected && target.pathogenKey !== 'OmegaVariant') return false;
        return true;
    }

    onTick(host, r, c, suburbName) {}
    onInfection(host) {}
}

function simulateCrossSectorCommuting() {
    if (!simulationRunning || simulationPaused) return;

    SUBURBS.forEach(sourceSuburb => {
        const sourceMatrix = cityData[sourceSuburb];
        if (!sourceMatrix) return;

        const r = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const c = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const commuter = sourceMatrix[r][c];

        if (!commuter || commuter.isDead || commuter.type !== 'human') return;
        if (Math.random() > 0.25) return;

        const destinations = SUBURBS.filter(s => s !== sourceSuburb);
        const targetSuburb = destinations[Math.floor(Math.random() * destinations.length)];
        const targetMatrix = cityData[targetSuburb];
        if (!targetMatrix) return;

        const tr = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const tc = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const targetEntity = targetMatrix[tr][tc];

        if (!targetEntity || targetEntity.isDead) return;

        if (commuter.isInfected) {
            if (infectEntity(targetEntity, commuter.pathogenKey)) {
                console.log(`[COMMUTE] An infected carrier traveled from ${sourceSuburb} to ${targetSuburb} carrying ${commuter.pathogenKey}!`);
            }
        } else if (commuter.isVaccinated && !commuter.isInfected) {
            if (targetEntity.type === 'human' && !targetEntity.isInfected && !targetEntity.isVaccinated) {
                targetEntity.isVaccinated = true;
                console.log(`[VACCINE TRAVEL] A vaccinated citizen commuted from ${sourceSuburb} and immunized a resident in ${targetSuburb}.`);
            }
        }
    });
}

function checkBotulismSupplyChain() {
    const currentMatrix = getCurrentMatrix();
    let localBotulismCount = 0;

    currentMatrix.forEach(row => {
        row.forEach(entity => {
            if (entity.isInfected && entity.pathogenKey === 'botulism') {
                localBotulismCount++;
            }
        });
    });

    if (localBotulismCount >= 8) {
        SUBURBS.forEach(suburbName => {
            if (suburbName === currentViewedSector) return; 

            const matrix = cityData[suburbName];
            const stores = DeltaVariant_STORES[suburbName] || [];

            stores.forEach(({ r, c }) => {
                const entity = matrix?.[r]?.[c];
                if (entity && entity.type === 'human' && !entity.isInfected && !entity.isDead && !entity.isVaccinated) {
                    if (infectEntity(entity, 'botulism')) {
                        console.log(`[SUPPLY CHAIN] Botulism contamination stores activated in ${suburbName} due to supply distribution out of ${currentViewedSector}!`);
                    }
                }
            });
        });
    }
}

function initiateOutbreak() {
    if (simulationRunning) return; 
    
    resetGraphData();
    
    const pathogenSelector = document.getElementById('pathogen-select');
    const chosenPathogen = pathogenSelector ? pathogenSelector.value : 'measles';
    currentPathogen = PATHOGEN_VAULT[chosenPathogen] || PATHOGEN_VAULT.measles;

    const currentMatrix = getCurrentMatrix();
    const centerRow = Math.floor(SUBURB_GRID_SIZE / 2);
    const centerCol = Math.floor(SUBURB_GRID_SIZE / 2);
    const patientZero = currentMatrix[centerRow][centerCol];
    
    hidePathogenInfoPanel();
    startSimulation();
    
    infectEntity(patientZero, chosenPathogen);

    simulationTimeline.push(0);
    
    let totalInfected = 0;
    let totalVaccinated = 0;
    let totalDead = 0;

    for (let i = 0; i < SUBURBS.length; i++) {
        const matrix = cityData[SUBURBS[i]];
        if (!matrix) continue;
        matrix.forEach(row => {
            row.forEach(entity => {
                if (entity.isDead) totalDead++;
                else if (entity.isInfected) totalInfected++;
                else if (entity.isVaccinated) totalVaccinated++;
            });
        });
    }

    historyInfected.push(totalInfected);
    historyRecovered.push(totalVaccinated);
    historyDeceased.push(totalDead);

    updateStatsPanel();
    renderCurrentSector();
    updateTimelineGraph();

    console.log(`[ALERT] Patient Zero deployed in ${currentViewedSector} Sector with ${chosenPathogen}.`);
}

// --- SPECIALIZED PATHOGEN VARIATIONS ---
class AlphaVariantPathogen extends Pathogen {
    constructor() {
        super("AlphaVariant", 0.20, 0.04, 0.15);
        this.lifespan = 12;
    }

    getSpreadTargets(matrix, r, c, host) {
        const radius = (host.infectionAge || 0) % 4 === 0 ? 2 : 1;
        return this.collectPositions(matrix, r, c, radius);
    }
}

class BetaVariantPathogen extends Pathogen {
    constructor() {
        super("BetaVariant", 0.30, 0.06, 0.25);
        this.lifespan = 10;
    }

    onInfection(host) {
        host.stealthTicks = 3;
    }

    onTick(host, r, c, suburbName) {
        if (host.stealthTicks > 0) {
            host.stealthTicks = Math.max(0, host.stealthTicks - 1);
        }
    }

    shouldSpread(sourceType, targetType, host) {
        const isCrossSpecies = sourceType !== targetType;
        const baseChance = isCrossSpecies ? this.animalVectorContagion : this.transmissionRate;
        const stealthFactor = host?.stealthTicks > 0 ? 0.85 : 1.0;
        return Math.random() < baseChance * stealthFactor;
    }
}

class LyssavirusPathogen extends Pathogen {
    constructor() {
        super("Lyssavirus", 0.15, 0.12, 0.10);
        this.lifespan = 10;
    }

    shouldSpread(sourceType, targetType, host) {
        const isCrossSpecies = sourceType !== targetType;
        const baseChance = isCrossSpecies ? this.animalVectorContagion : this.transmissionRate;
        const weightedChance = targetType === 'animal'
            ? Math.min(0.65, baseChance + 0.10)
            : Math.max(0.03, baseChance - 0.07);
        return Math.random() < weightedChance;
    }
}

class KafkaVariant extends Pathogen {
    constructor() {
        super("Kafka Variant", 0.15, 0.02, 0.15); 
        this.lifespan = 15;
        this.mutationFactor = 1.1; 
        this.spreadRadius = 1;
    }

    shouldSpread(sourceType, targetType, host) {
        const isCrossSpecies = sourceType !== targetType;
        let chance = isCrossSpecies ? this.animalVectorContagion : this.transmissionRate;
        
        if (isCrossSpecies) chance *= globalAnimalMod; 
        chance *= globalMutationMod;                  
        chance *= (1.0 - globalSanitationMod);         

        return Math.random() < chance;
    }

    getSpreadTargets(matrix, r, c, host) {
        return this.collectPositions(matrix, r, c, this.spreadRadius);
    }

    onInfection(host) {
        this.mutationFactor = Math.min(3.0, this.mutationFactor + 0.05);
        this.transmissionRate = Math.min(0.85, this.transmissionRate + 0.02);
        this.mortalityRate = Math.min(0.65, this.mortalityRate + 0.01);
        if (this.mutationFactor > 2.0) {
            this.spreadRadius = Math.min(3, this.spreadRadius + 1);
        }
    }
}

class GammaVariantPathogen extends Pathogen {
    constructor() {
        // High transmission, high mortality rate
        super("Bubonic GammaVariant", 0.50, 0.65, 0.50);
        this.lifespan = 6; // Quick burnout time for the individual, forcing it to rely on the corpse/rats
    }

    resolveInfection(host) {
        const died = Math.random() < this.mortalityRate;
        if (died && host && host.type === 'human') {
            host.isDead = true;
            host.isInfected = true; // KEEPS IT INFECTIOUS AFTER DEATH (Anthrax style)
            host.pathogenKey = 'plague';
            host.isInfectiousBody = true; 
        }
        return died;
    }

    isEligibleTarget(matrix, r, c, target, host) {
        if (target.isEmpty) return false;
        if (target.isVaccinated) return false;
        if (target.isInfected || target.isDead) return false;
        
        // If the target is a human, they can only catch it if there's a rat next to them
        if (target.type === 'human') {
            return this.hasAnimalNeighbor(matrix, r, c);
        }
        
        // Animals (rats) can always catch it from each other
        return true;
    }
    hasAnimalNeighbor(matrix, r, c) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        return dirs.some(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            return nr >= 0 && nc >= 0 && nr < matrix.length && nc < matrix[0].length && matrix[nr][nc].type === 'animal';
        });
    }
}
class DeltaVariantPathogen extends Pathogen {
    constructor() {
        super("DeltaVariant", 0.05, 0.15, 0.05);
        this.lifespan = 8;
    }
}

class OmegaVariantPathogen extends Pathogen {
    constructor() {
        super("OmegaVariant", 0.02, 0.85, 0.40);
        this.lifespan = 5;
    }

    resolveInfection(host) {
        const died = Math.random() < this.mortalityRate;
        if (died && host && host.type === 'human') {
            host.isDead = true;
            host.isInfected = true;
            host.pathogenKey = 'OmegaVariant';
            host.isInfectiousBody = true;
        }
        return died;
    }
}

class CustomNanoPlague extends Pathogen {
    constructor() {
        super("Custom Nano Plague", 0.25, 0.10, 0.20);
        this.lifespan = 10;
    }

    getLethality() {
        let lethality = nanoPlagueSettings.lethalityBase;
        lethality += nanoPlagueSettings.lethalityBoost * 0.5;

        if (nanoPlagueSettings.temperatureMod > 1.0) {
            lethality += (nanoPlagueSettings.temperatureMod - 1.0) * 0.08;
        }

        if (nanoPlagueSettings.copyKafkaMutation) {
            lethality += 0.03;
        }

        return Math.min(0.95, lethality);
    }

    shouldSpread(sourceType, targetType, host) {
        const isCrossSpecies = sourceType !== targetType;
        let chance = isCrossSpecies ? this.animalVectorContagion : this.transmissionRate;

        chance *= nanoPlagueSettings.temperatureMod;
        chance *= (1.0 - nanoPlagueSettings.hygieneMod);

        if (nanoPlagueSettings.copyKafkaMutation) {
            chance *= 1.0 + Math.min(0.35, globalMutationMod * 0.08);
        }

        if (nanoPlagueSettings.copyMeaslesBurst) {
            chance *= 1.04;
        }

        if (nanoPlagueSettings.copyPlagueAnimalBias) {
            chance *= 1.02;
        }

        if (nanoPlagueSettings.copyCovidStealth && host?.stealthTicks > 0) {
            chance *= 0.85;
        }

        return Math.random() < Math.min(0.95, chance);
    }

    resolveInfection(host) {
        return Math.random() < this.getLethality();
    }

    getSpreadTargets(matrix, r, c, host) {
        if (nanoPlagueSettings.copyMeaslesBurst) {
            return this.collectPositions(matrix, r, c, 2);
        }
        return super.getSpreadTargets(matrix, r, c, host);
    }

    isEligibleTarget(matrix, r, c, target, host) {
        if (!super.isEligibleTarget(matrix, r, c, target, host)) return false;

        if (nanoPlagueSettings.copyPlagueAnimalBias && target.type === 'human') {
            return this.hasAnimalNeighbor(matrix, r, c);
        }

        return true;
    }

    hasAnimalNeighbor(matrix, r, c) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        return dirs.some(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            return nr >= 0 && nc >= 0 && nr < matrix.length && nc < matrix[0].length && matrix[nr][nc].type === 'animal';
        });
    }

    onInfection(host) {
        if (nanoPlagueSettings.copyCovidStealth) {
            host.stealthTicks = 2;
        }
    }

    onTick(host, r, c, suburbName) {
        if (host?.stealthTicks > 0) {
            host.stealthTicks = Math.max(0, host.stealthTicks - 1);
        }

        if (nanoPlagueSettings.copyKafkaMutation && globalMutationMod > 1.0) {
            const mutationChance = (globalMutationMod - 1.0) * 0.05;
            if (Math.random() < mutationChance) {
                this.transmissionRate = Math.min(0.90, this.transmissionRate + 0.01);
                this.mortalityRate = Math.min(0.95, this.mortalityRate + 0.01);
            }
        }

        if (nanoPlagueSettings.copyCovidStealth && Math.random() < 0.15) {
            host.stealthTicks = 2;
        }
    }
}
const PATHOGEN_VAULT = {
    measles: new AlphaVariantPathogen(),     
    covid: new BetaVariantPathogen(),        
    lyssavirus: new LyssavirusPathogen(),   
    plague: new GammaVariantPathogen(),      
    botulism: new DeltaVariantPathogen(),    
    anthrax: new OmegaVariantPathogen(),     
    kafka: new KafkaVariant(),
    nanoplague: new CustomNanoPlague() // <--- Add this line
};

PATHOGEN_VAULT.measles.name = "Measles";
PATHOGEN_VAULT.covid.name = "COVID-19";
PATHOGEN_VAULT.plague.name = "Bubonic Plague";
PATHOGEN_VAULT.botulism.name = "Botulism";
PATHOGEN_VAULT.anthrax.name = "Anthrax";
PATHOGEN_VAULT.nanoplague.name = "Nano Plague";

function showPathogenInfoPanel() {
    const panel = document.getElementById('pathogen-info-panel');
    const content = document.getElementById('pathogen-info-content');
    if (!panel) return;

    const pathogenSelector = document.getElementById('pathogen-select');
    const chosenPathogen = pathogenSelector ? pathogenSelector.value : 'measles';
    const pathogen = PATHOGEN_VAULT[chosenPathogen] || PATHOGEN_VAULT.measles;

    const targetOutput = content || panel;

    targetOutput.innerHTML = `
        <div style="padding: 2px; border-radius: 4px;">
            <div><strong>Profile: ${pathogen.name}</strong></div>
            <div style="font-size: 13px; margin-top: 4px; color: #d8dee9;">
                ${getPathogenSummary(chosenPathogen)}
            </div>
        </div>
    `;

    panel.style.display = 'block';
}

function getPathogenSummary(pathogenKey) {
    switch (pathogenKey) {
        case 'measles':
            return 'Wider radius over time; spreads outward in bursts.';
        case 'covid':
            return 'Stealthy spread with a brief hidden phase before normal transmission.';
        case 'lyssavirus':
            return 'Strong animal-bias; prefers spreading to animals over humans.';
        case 'kafka':
            return 'Mutating strain that grows more aggressive and wider-reaching as it spreads.';
        case 'plague':
            return 'Needs an animal neighbor to infect humans, so it spreads in clustered conditions.';
        case 'botulism':
            return 'Slow and low-probability transmission from contaminated stores.';
        case 'anthrax':
            return 'Turns dead humans into infectious bodies that continue the threat.';
        case 'nanoplague':
            return 'A highly adaptable synthetic strain. Responds directly to environmental temperature parameters and sanitation modifiers.';
        default:
            return 'Standard transmission behavior profile.';
            return 'Standard transmission behavior profile.';
    }
}

function updateStatsPanel() {
    let totalInfected = 0;
    let totalVaccinated = 0;
    let totalDead = 0;

    for (let i = 0; i < SUBURBS.length; i++) {
        const matrix = cityData[SUBURBS[i]];
        if (!matrix) continue;
        
        matrix.forEach(row => {
            row.forEach(entity => {
                if (entity.isDead) totalDead++;
                else if (entity.isInfected) totalInfected++;
                else if (entity.isVaccinated) totalVaccinated++;
            });
        });
    }

    const infEl = document.getElementById('count-inf');
    const vaxEl = document.getElementById('count-vax');
    const deadEl = document.getElementById('count-dead');

    if (infEl) infEl.textContent = totalInfected;
    if (vaxEl) vaxEl.textContent = totalVaccinated;
    if (deadEl) deadEl.textContent = totalDead;
}

function updateCellVisualState(entity, cellDOMElement) {
    cellDOMElement.style.backgroundColor = '';
    cellDOMElement.style.boxShadow = '';
    cellDOMElement.style.border = '';
    cellDOMElement.innerHTML = ''; 

    cellDOMElement.classList.remove(
        'infected-node', 'recovered-node', 'dead-node',
        'dead-measles', 'dead-covid', 'dead-lyssavirus', 
        'dead-plague', 'dead-botulism', 'dead-anthrax', 'dead-kafka'
    );

    if (entity.isDead) {
        cellDOMElement.classList.add('dead-node');
        const key = entity.pathogenKey || document.getElementById('pathogen-select').value;
        cellDOMElement.classList.add(`dead-${key}`);
        
        // SPECIAL RAT GRAPHIC OVERRIDE FOR PLAGUE CASUALTIES
        if (key === 'plague') {
            cellDOMElement.innerHTML = '🐀';
            cellDOMElement.style.fontSize = '14px';
            cellDOMElement.style.display = 'flex';
            cellDOMElement.style.alignItems = 'center';
            cellDOMElement.style.justifyContent = 'center';
            cellDOMElement.style.backgroundColor = '#2e3440'; 
            cellDOMElement.style.border = '1px dashed #bf616a';
        }
    } else if (entity.isInfected) {
        if (entity.pathogenKey === 'covid' && entity.stealthTicks > 0) {
            cellDOMElement.style.backgroundColor = '#4c566a'; 
        } else {
            cellDOMElement.classList.add('infected-node');
        }
    } else if (entity.isVaccinated || entity.isImmune || entity.hasRecovered) {
        cellDOMElement.classList.add('recovered-node');
    }
}

let currentPathogen = PATHOGEN_VAULT.measles;
let DeltaVariant_STORES = {};

function ensureDeltaVariantStores() {
    SUBURBS.forEach(suburbName => {
        if (DeltaVariant_STORES[suburbName]) return;

        const stores = [];
        while (stores.length < 3) {
            const r = Math.floor(Math.random() * SUBURB_GRID_SIZE);
            const c = Math.floor(Math.random() * SUBURB_GRID_SIZE);
            const exists = stores.some(pos => pos.r === r && pos.c === c);
            if (!exists) stores.push({ r, c });
        }
        DeltaVariant_STORES[suburbName] = stores;
    });
}

function infectEntity(entity, pathogenKey) {
    if (!entity) return false;
    if (entity.isVaccinated) return false;
    if (entity.isDead && pathogenKey !== 'OmegaVariant' && pathogenKey !== 'plague') return false;
    if (entity.isInfected && entity.pathogenKey === pathogenKey) return false;

    const pathogen = PATHOGEN_VAULT[pathogenKey];
    if (!pathogen) return false;

    entity.isInfected = true;
    entity.pathogenKey = pathogenKey;
    entity.infectionAge = 0;
    entity.stealthTicks = 0;
    entity.isInfectiousBody = false;

    if (pathogenKey === 'BetaVariant') {
        entity.stealthTicks = 3;
    }

    pathogen.onInfection(entity);
    return true;
}
function applyDeltaVariantStores() {
    if (!simulationRunning || simulationPaused) return;

    const selector = document.getElementById('pathogen-select');
    const activeKey = selector ? selector.value : 'measles';
    if (activeKey !== 'botulism') return; 

    ensureDeltaVariantStores();

    SUBURBS.forEach(suburbName => {
        const matrix = getMatrixForSuburb(suburbName);
        const stores = DeltaVariant_STORES[suburbName] || [];

        stores.forEach(({ r, c }) => {
            const entity = matrix?.[r]?.[c];
            if (!entity) return;
            if (entity.type !== 'human') return;
            if (entity.isVaccinated || entity.isDead) return;
            injectCustomStoreInfection(entity);
        });
    });
}

function injectCustomStoreInfection(entity) {
    const selector = document.getElementById('pathogen-select');
    const key = selector ? selector.value : 'botulism';
    infectEntity(entity, key);
}

function initCityMap() {
    SUBURBS.forEach(suburbName => {
        if (!cityData[suburbName]) {
            createEmptyMatrix(suburbName);
        }
    });

    ensureDeltaVariantStores();
    renderCurrentSector();
    updateStatsPanel();
}

function triggerVaccinationCampaign(primarySuburb, percentage) {
    const rate = Math.min(100, Math.max(1, percentage)) / 100;

    console.log(`[HEALTH DEPT] Initiating a city-wide vaccination campaign at ${percentage}% coverage...`);

    SUBURBS.forEach(suburbName => {
        const matrix = cityData[suburbName];
        if (!matrix) return;

        let livingHumansCount = 0;
        matrix.forEach(row => {
            row.forEach(entity => {
                if (entity && entity.type === 'human' && !entity.isDead) {
                    livingHumansCount++;
                }
            });
        });

        const targetQuota = Math.round(livingHumansCount * rate);
        if (targetQuota <= 0) return;

        let vaccinatedThisBatch = 0;
        let attempts = 0;
        const maxAttempts = SUBURB_GRID_SIZE * SUBURB_GRID_SIZE * 2;

        while (vaccinatedThisBatch < targetQuota && attempts < maxAttempts) {
            attempts++;
            const r = Math.floor(Math.random() * SUBURB_GRID_SIZE);
            const c = Math.floor(Math.random() * SUBURB_GRID_SIZE);
            const entity = matrix[r][c];

            if (entity && entity.type === 'human' && !entity.isInfected && !entity.isDead && !entity.isVaccinated) {
                entity.isVaccinated = true;
                vaccinatedThisBatch++;
            }
        }

        console.log(` -> ${suburbName} Sector: Immunized ${vaccinatedThisBatch}/${livingHumansCount} residents.`);
    });

    renderCurrentSector();
    updateStatsPanel();
}

function processVaccinationSpread(matrix, r, c) {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    
    directions.forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;

        if (nr >= 0 && nc >= 0 && nr < matrix.length && nc < matrix[0].length) {
            const neighbor = matrix[nr][nc];
            if (neighbor && neighbor.type === 'human' && !neighbor.isInfected && !neighbor.isDead && !neighbor.isVaccinated) {
                if (Math.random() < 0.02) {
                    neighbor.isVaccinated = true;
                }
            }
        }
    });
}

function renderCurrentSector() {
    const mapContainer = document.getElementById('city-map');
    if (!mapContainer) return;

    mapContainer.innerHTML = '';

    const currentMatrix = getCurrentMatrix();
    if (!currentMatrix) {
        console.error(`Matrix not found for sector: ${currentViewedSector}`);
        return;
    }

    currentMatrix.forEach((rowData) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'grid-row';
        rowDiv.style.display = 'flex';
        rowDiv.style.gap = '4px';
        rowDiv.style.marginBottom = '4px';

        rowData.forEach((entity) => {
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            cell.style.width = '20px';
            cell.style.height = '20px';

            if (entity.isEmpty) {
                cell.style.backgroundColor = 'transparent';
                cell.style.border = 'none';
            } else if (entity.type === 'animal') {
                cell.classList.add('animal-node');
                cell.style.borderRadius = '6px';
                cell.style.backgroundColor = '#4c566a';
            } else {
                cell.style.borderRadius = '50%';
                cell.style.backgroundColor = '#434c5e';
            }

            if (!entity.isEmpty) {
                updateCellVisualState(entity, cell);
            }
            rowDiv.appendChild(cell);
        });

        mapContainer.appendChild(rowDiv);
    });
}

function switchSector(targetSector) {
    setViewedSector(targetSector);

    // Update active tab styles
    const tabs = document.querySelectorAll('.nav-tab');
    for (let tab of tabs) {
        const text = tab.innerText.toLowerCase();
        if (text.includes(targetSector.toLowerCase())) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    }

    // Dynamic Regional Identity Descriptions
    const mapContainer = document.getElementById('city-map');
    let regionIntelHeader = document.getElementById('region-intel-header');
    
    if (!regionIntelHeader) {
        regionIntelHeader = document.createElement('div');
        regionIntelHeader.id = 'region-intel-header';
        regionIntelHeader.style.cssText = "margin-bottom: 12px; padding: 10px; background: #3b4252; border-left: 4px solid #88c0d0; font-size: 13px; color: #e5e9f0;";
        mapContainer.parentNode.insertBefore(regionIntelHeader, mapContainer);
    }

    // Explicitly tell the tester what makes this grid unique
    if (targetSector === 'Central') {
        regionIntelHeader.innerHTML = `<strong>📍 Central Hub Sector</strong><br>⚠️ High Density Urban Grid (100% Occupancy). Animal presence minimal (2%). Pathogens spread rapidly via human-to-human contact.`;
        mapContainer.style.borderColor = "#88c0d0"; // High-tech cyan border
    } else if (targetSector === 'North' || targetSector === 'South') {
        regionIntelHeader.innerHTML = `<strong>🚜 ${targetSector} Rural Sector</strong><br>🌾 Sparse Agricultural Grid (45% Occupancy). High Animal Vector Ratio (40%). Ideal breeding ground for Zoonotic strains like Lyssavirus and Bubonic Plague.`;
        mapContainer.style.borderColor = "#a3be8c"; // Agricultural green border
    } else {
        regionIntelHeader.innerHTML = `<strong>🏡 ${targetSector} Suburban Sector</strong><br>🏠 Moderate Density Residential Grid (75% Occupancy). Balanced demographics (15% Animals). Standard transmission rates apply.`;
        mapContainer.style.borderColor = "#d8dee9"; // Suburban grey border
    }

    renderCurrentSector();
}

function hidePathogenInfoPanel() {
    const panel = document.getElementById('pathogen-info-panel');
    if (panel) {
        panel.style.display = 'none';
    }
}

function initiateExposure() {
    resetGraphData();
    const pathogenSelector = document.getElementById('pathogen-select');
    const chosenPathogen = pathogenSelector ? pathogenSelector.value : 'measles';
    currentPathogen = PATHOGEN_VAULT[chosenPathogen] || PATHOGEN_VAULT.measles;

    const currentMatrix = getCurrentMatrix();
    const centerRow = Math.floor(SUBURB_GRID_SIZE / 2);
    const centerCol = Math.floor(SUBURB_GRID_SIZE / 2);

    const patientZero = currentMatrix[centerRow][centerCol];
    
    hidePathogenInfoPanel();
    startSimulation();
    infectEntity(patientZero, chosenPathogen);
    updateStatsPanel();
    renderCurrentSector();

    console.log(`[ALERT] Patient Zero deployed in ${currentViewedSector} Sector with ${chosenPathogen}.`);
}

function addControlUI() {
    const controlDeck = document.getElementById('control-deck');
    if (!controlDeck) return;
    
    if (document.getElementById('reset-map-button')) return;

    const controls = document.createElement('div');
    controls.id = 'sim-ui-controls';
    controls.style.marginTop = '12px';
    controls.style.display = 'flex';
    controls.style.flexDirection = 'column';
    controls.style.gap = '8px';

    controls.innerHTML = `
        <button id="reset-map-button" type="button" style="padding: 6px 10px; cursor: pointer; background-color: #3b4252; color: #eceff4; border: 1px solid #4c566a; border-radius: 4px;">Reset Map</button>
        
        <div style="display: flex; gap: 6px; align-items: center;">
            <button id="vaccine-campaign-button" type="button" style="flex: 1; padding: 6px 10px; cursor: pointer; background-color: #a3be8c; color: #2e3440; font-weight: bold; border: none; border-radius: 4px;">Deploy Vaccines</button>
            <div style="display: flex; align-items: center; background: #3b4252; border: 1px solid #4c566a; border-radius: 4px; padding-right: 6px;">
                <input id="vaccine-percent-input" type="number" min="1" max="100" value="5" style="width: 45px; padding: 5px; border: none; background: transparent; color: #eceff4; text-align: center; outline: none;">
                <span style="color: #8fbcbb; font-size: 13px; font-weight: bold;">%</span>
            </div>
        </div>

        <div style="margin-top: 4px;">
            <label for="tick-speed-slider" style="font-size: 12px; display: block; margin-bottom: 4px; color: #d8dee9;">
                Tick Speed: <span id="tick-speed-value">${tickSpeedMs} ms</span>
            </label>
            <input id="tick-speed-slider" type="range" min="100" max="2000" step="100" value="${tickSpeedMs}" style="width: 100%;">
        </div>
    `;
    
    controlDeck.appendChild(controls);
}

function updateTickSpeedLabel() {
    const label = document.getElementById('tick-speed-value');
    if (label) {
        label.textContent = `${tickSpeedMs} ms`;
    }
}

function setTickSpeed(ms) {
    tickSpeedMs = Math.max(100, Math.min(2000, ms));
    globalScope.tickSpeedMs = tickSpeedMs;
    updateTickSpeedLabel();

    if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
    }

    if (simulationRunning && !simulationPaused) {
        const activeEpoch = ++simulationEpoch;
        simulationTimer = window.setInterval(() => {
            if (!simulationRunning || simulationPaused || activeEpoch !== simulationEpoch) return;
            advanceSimulation(activeEpoch);
        }, tickSpeedMs);
    }
}

function resetSimulation() {
    stopSimulation();
    simulationPaused = false; 

    Object.keys(cityData).forEach(key => delete cityData[key]);
    globalScope.cityData = cityData;

    DeltaVariant_STORES = {};
    
    const pathogenSelect = document.getElementById('pathogen-select');
    const chosenKey = pathogenSelect ? pathogenSelect.value : 'measles';
    currentPathogen = PATHOGEN_VAULT[chosenKey] || PATHOGEN_VAULT.measles;

  const activeTab = document.querySelector('#sector-nav .nav-tab.active');
    let activeSector = 'Central';
    if (activeTab) {
        if (activeTab.textContent.includes('North')) activeSector = 'North';
        else if (activeTab.textContent.includes('South')) activeSector = 'South';
        else if (activeTab.textContent.includes('East')) activeSector = 'East';
        else if (activeTab.textContent.includes('West')) activeSector = 'West';
    }
    setViewedSector(activeSector); 
    initCityMap();
    renderCurrentSector();
    
    updateStatsPanel();
    
    console.log("[SYSTEM] Simulation reset. Grid cleared. Awaiting Patient Zero exposure.");
}

function bindControlEvents() {
    const vaxButton = document.getElementById('vaccine-campaign-button');
    const vaxInput = document.getElementById('vaccine-percent-input');

    if (vaxButton && !vaxButton.dataset.bound) {
        vaxButton.addEventListener('click', () => {
            const dynamicPercent = vaxInput ? parseInt(vaxInput.value, 10) || 5 : 5;
            triggerVaccinationCampaign(currentViewedSector, dynamicPercent);
        });
        vaxButton.dataset.bound = 'true';
    }

 const resetButton = document.getElementById('reset-map-button');
    if (resetButton && !resetButton.dataset.bound) {
        resetButton.addEventListener('click', resetSimulation);
        resetButton.dataset.bound = 'true';
    }

    const buttons = document.getElementsByTagName('button');
    let exposureButton = null;

    for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent.trim() === 'Initiate Exposure') {
            exposureButton = buttons[i];
            break;
        }
    }

    if (exposureButton && !exposureButton.dataset.bound) {
        exposureButton.addEventListener('click', () => {
            initiateOutbreak();
        });
        exposureButton.dataset.bound = 'true';
    }

    const tickSlider = document.getElementById('tick-speed-slider');
    if (tickSlider && !tickSlider.dataset.bound) {
        tickSlider.addEventListener('input', (e) => {
            setTickSpeed(parseInt(e.target.value, 10));
        });
        tickSlider.dataset.bound = 'true';
    }
}

function initializeSimulationApp() {
    addControlUI();
    bindControlEvents();
    initCityMap();
    setupConfigModifiers();

    const pathogenSelect = document.getElementById('pathogen-select');
    if (pathogenSelect) {
        pathogenSelect.addEventListener('change', (e) => {
            currentPathogen = PATHOGEN_VAULT[e.target.value] || PATHOGEN_VAULT.measles;
            showPathogenInfoPanel();

            // Dynamic view handling for the top area
            const nanoPanel = document.getElementById('nano-plague-controls');
            if (nanoPanel) {
                nanoPanel.style.display = (e.target.value === 'nanoplague') ? 'block' : 'none';
            }
        });
    }
    
    const initiateBtn = document.querySelector('button[onclick="initiateExposure()"]') 
        || document.getElementById('initiate-exposure');
    if (initiateBtn) {
        initiateBtn.removeAttribute('onclick');
        initiateBtn.addEventListener('click', initiateExposure);
    }

    showPathogenInfoPanel();
}

function setupConfigModifiers() {
    const sMut = document.getElementById('slider-mutation');
    const sAni = document.getElementById('slider-animal');
    const sSan = document.getElementById('slider-sanitation');

    // 🧬 Reworked Mutation Info Panel Logic
    sMut?.addEventListener('input', (e) => {
        globalMutationMod = parseFloat(e.target.value);
        const lbl = document.getElementById('val-mutation');
        if (lbl) lbl.textContent = `${globalMutationMod.toFixed(1)}x`;

        const info = document.getElementById('info-mutation');
        if (info) {
            if (globalMutationMod === 1.0) {
                info.textContent = " Status: Baseline evolution rate. Standard pathogen profiles active.";
                info.style.color = "#88c0d0";
            } else if (globalMutationMod > 1.0) {
                info.textContent = ` Status: Hyper-mutation environment. Nano Plague will continuously drift stats and potentially allow pathogens to bypass barriers depending on mutation type.`;
                info.style.color = "#bf616a"; 
            } else {
                info.textContent = " Status: Genetic stabilization. Pathogen attributes locked below spec limits.";
                info.style.color = "#81a1c1";
            }
        }
    });

    sAni?.addEventListener('input', (e) => {
        const rawVal = parseInt(e.target.value, 10);
        globalAnimalMod = rawVal / 100;
        const lbl = document.getElementById('val-animal');
        if (lbl) lbl.textContent = `${rawVal}%`;

        const info = document.getElementById('info-animal');
        if (info) {
            if (rawVal === 0) {
                info.textContent = " Status: Eradication protocols active. Zoonotic transmission fully halted.";
            } else if (rawVal > 40) {
                info.textContent = ` Status: Critical infestation. Rural zones will completely saturate with animal carriers.`;
            } else {
                info.textContent = ` Status: Stable reservoir matrix. ${rawVal}% of newly generated grid maps allocated to animals.`;
            }
        }
    });

    sSan?.addEventListener('input', (e) => {
        const rawVal = parseInt(e.target.value, 10);
        globalSanitationMod = rawVal / 100;
        const lbl = document.getElementById('val-sanitation');
        if (lbl) lbl.textContent = `${rawVal}%`;

        const info = document.getElementById('info-sanitation');
        if (info) {
            if (rawVal === 0) {
                info.textContent = " Status: Public compliance at zero. Pathogen surface lifespan unimpeded.";
                info.style.color = "#ebcb8b";
            } else if (rawVal >= 75) {
                info.textContent = ` Status: Lockdown compliance. Airborne vectors reduced by ${rawVal}%.`;
                info.style.color = "#a3be8c";
            } else {
                info.textContent = ` Status: Handwashing campaigns active. Spreading capability dampening globally.`;
                info.style.color = "#d8dee9";
            }
        }
    });


    document.getElementById('slider-nano-temp')?.addEventListener('input', (e) => {
        const tempVal = parseFloat(e.target.value);
        nanoPlagueSettings.temperatureMod = tempVal;
        document.getElementById('val-nano-temp').textContent = `${tempVal.toFixed(1)}x`;
        
        const info = document.getElementById('info-nano-temp');
        if (info) {
            if (tempVal === 1.0) {
                info.textContent = " Status: Optimal thermal operating parameters. Kinetic nanite replication stable.";
                info.style.color = "#88c0d0";
            } else if (tempVal > 1.0) {
                info.textContent = " Status: Thermal acceleration. Extreme heat significantly amplifies pathogen transmission and toxicity.";
                info.style.color = "#bf616a"; 
            } else {
                info.textContent = " Status: Cryo-retardation. Low temperatures restrict mechanical articulation of cores to reduce mutation rate.";
                info.style.color = "#81a1c1"; 
            }
        }
    });


    document.getElementById('slider-nano-hygiene')?.addEventListener('input', (e) => {
        const rawVal = parseInt(e.target.value, 10);
        nanoPlagueSettings.hygieneMod = rawVal / 100;
        document.getElementById('val-nano-hygiene').textContent = `${rawVal}%`;
        
        const info = document.getElementById('info-nano-hygiene');
        if (info) {
            if (rawVal === 0) {
                info.textContent = " Status: Vulnerable matrix. Nanite outer casings completely dissolve upon contact with standard surfactants.";
                info.style.color = "#a3be8c";
            } else if (rawVal >= 70) {
                info.textContent = ` Status: Corrosive shielding. Nanites actively neutralize and bypass ${rawVal}% of medical-grade chemical barriers.`;
                info.style.color = "#bf616a";
            } else {
                info.textContent = " Status: Hydrophobic adaptation. Micro-cores alter surface tension to resist localized fluid washouts.";
                info.style.color = "#d8dee9";
            }
        }
    });

    document.getElementById('slider-nano-lethality')?.addEventListener('input', (e) => {
        const rawVal = parseInt(e.target.value, 10);
        nanoPlagueSettings.lethalityBase = rawVal / 100;
        document.getElementById('val-nano-lethality').textContent = `${rawVal}%`;

        const info = document.getElementById('info-nano-lethality');
        if (info) {
            if (rawVal >= 70) {
                info.textContent = " ☠️ Status: Lethality baseline is severe and highly destructive.";
                info.style.color = "#bf616a";
            } else if (rawVal >= 40) {
                info.textContent = " ☠️ Status: Moderate lethality. Fatality rates climb quickly under stress.";
                info.style.color = "#d08770";
            } else {
                info.textContent = " ☠️ Status: Lethality baseline set to low severity.";
                info.style.color = "#88c0d0";
            }
        }
    });

    document.getElementById('slider-nano-lethality-boost')?.addEventListener('input', (e) => {
        const rawVal = parseInt(e.target.value, 10);
        nanoPlagueSettings.lethalityBoost = rawVal / 100;
        document.getElementById('val-nano-lethality-boost').textContent = `${rawVal}%`;

        const info = document.getElementById('info-nano-lethality-boost');
        if (info) {
            if (rawVal >= 70) {
                info.textContent = " ⚡ Status: Corpse-to-corpse transmission is strongly amplified. Dead bodies stay infectious and spread aggressively.";
                info.style.color = "#bf616a";
            } else if (rawVal > 0) {
                info.textContent = " ⚡ Status: Dead bodies retain infectivity and can trigger new outbreaks after death.";
                info.style.color = "#d08770";
            } else {
                info.textContent = " ⚡ Status: Dead bodies do not remain infectious.";
                info.style.color = "#d8dee9";
            }
        }
    });

    const updateNanoSpecialtyInfo = () => {
        const active = [];
        if (nanoPlagueSettings.copyKafkaMutation) active.push('Kafka mutation drift');
        if (nanoPlagueSettings.copyCovidStealth) active.push('COVID stealth phase');
        if (nanoPlagueSettings.copyPlagueAnimalBias) active.push('plague animal bias');
        if (nanoPlagueSettings.copyMeaslesBurst) active.push('measles burst spread');

        const info = document.getElementById('info-nano-specialties');
        if (info) {
            if (active.length) {
                info.textContent = ` 🧬 Specialty mimicry: ${active.join(', ')} enabled.`;
                info.style.color = "#a3be8c";
            } else {
                info.textContent = " 🧬 Specialty mimicry: Off. Nano Plague remains fully autonomous.";
                info.style.color = "#88c0d0";
            }
        }
    };

    document.getElementById('check-nano-kafka')?.addEventListener('change', (e) => {
        nanoPlagueSettings.copyKafkaMutation = e.target.checked;
        updateNanoSpecialtyInfo();
    });

    document.getElementById('check-nano-covid')?.addEventListener('change', (e) => {
        nanoPlagueSettings.copyCovidStealth = e.target.checked;
        updateNanoSpecialtyInfo();
    });

    document.getElementById('check-nano-plague')?.addEventListener('change', (e) => {
        nanoPlagueSettings.copyPlagueAnimalBias = e.target.checked;
        updateNanoSpecialtyInfo();
    });

    document.getElementById('check-nano-measles')?.addEventListener('change', (e) => {
        nanoPlagueSettings.copyMeaslesBurst = e.target.checked;
        updateNanoSpecialtyInfo();
    });

    updateNanoSpecialtyInfo();
}
function toggleControlTab(tabName) {
    const monitorPanel = document.getElementById('panel-monitor');
    const configPanel = document.getElementById('panel-config');
    const tabMonBtn = document.getElementById('tab-monitor');
    const tabCfgBtn = document.getElementById('tab-config');

    if (tabName === 'config') {
        if (monitorPanel) monitorPanel.style.display = 'none';
        if (configPanel) configPanel.style.display = 'block';
        if (tabCfgBtn) tabCfgBtn.classList.add('active');
        if (tabMonBtn) tabMonBtn.classList.remove('active');
    } else {
        if (monitorPanel) monitorPanel.style.display = 'block';
        if (configPanel) configPanel.style.display = 'none';
        if (tabMonBtn) tabMonBtn.classList.add('active');
        if (tabCfgBtn) tabCfgBtn.classList.remove('active');
    }
}

window.addEventListener('load', initializeSimulationApp);

function updateTimelineGraph() {
    const canvas = document.getElementById('epicenterGraph');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const totalPoints = simulationTimeline.length;
    const totalPopulation = SUBURBS.length * (SUBURB_GRID_SIZE * SUBURB_GRID_SIZE);

    const paddingLeft = 40;
    const paddingTop = 25; 
    const paddingRight = 15;
    const paddingBottom = 15;

    const chartWidth = canvas.width - paddingLeft - paddingRight;
    const chartHeight = canvas.height - paddingTop - paddingBottom;

    const gridLines = 4; 
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= gridLines; i++) {
        const ratio = i / gridLines;
        const val = Math.round(totalPopulation * ratio);
        const y = paddingTop + chartHeight - (ratio * chartHeight);

        ctx.strokeStyle = '#3b4252'; 
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(paddingLeft + chartWidth, y);
        ctx.stroke();

        ctx.fillStyle = '#d8dee9';
        ctx.fillText(val, paddingLeft - 6, y);
    }

    ctx.strokeStyle = '#4c566a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop);
    ctx.lineTo(paddingLeft, paddingTop + chartHeight);
    ctx.lineTo(paddingLeft + chartWidth, paddingTop + chartHeight);
    ctx.stroke();

    if (totalPoints === 0) return;

    function getX(index) {
        if (totalPoints === 1) return paddingLeft + chartWidth / 2;
        return paddingLeft + (index / (totalPoints - 1)) * chartWidth;
    }
    
    function getY(value) {
        return paddingTop + chartHeight - (value / totalPopulation) * chartHeight;
    }

    function drawLine(dataArray, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        
        if (totalPoints === 1) {
            ctx.arc(getX(0), getY(dataArray[0]), 3, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
        } else {
            ctx.moveTo(getX(0), getY(dataArray[0]));
            for (let i = 1; i < totalPoints; i++) {
                ctx.lineTo(getX(i), getY(dataArray[i]));
            }
            ctx.stroke();
        }
    }

    drawLine(historyInfected, '#bf616a');  
    drawLine(historyRecovered, '#a3be8c'); 
    drawLine(historyDeceased, '#4c566a');  

    const legendItems = [
        { label: 'Infected', color: '#bf616a' },
        { label: 'Immune/Vax', color: '#a3be8c' },
        { label: 'Deceased', color: '#4c566a' }
    ];

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let currentX = paddingLeft;

    legendItems.forEach(item => {
        ctx.fillStyle = item.color;
        ctx.fillRect(currentX, 6, 12, 8);

        ctx.fillStyle = '#d8dee9';
        ctx.fillText(item.label, currentX + 16, 4);

        currentX += 80; 
    });
}

function resetGraphData() {
    simulationTimeline = [];
    historyInfected = [];
    historyRecovered = [];
    historyDeceased = [];
    if (graphCanvas && graphCtx) {
        graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    }
}
