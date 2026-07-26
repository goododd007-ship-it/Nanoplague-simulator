const globalScope = typeof window !== 'undefined' ? window : globalThis;

const SUBURBS = globalScope.SUBURBS || ['Central', 'North', 'South', 'East', 'West'];
const SUBURB_GRID_SIZE = globalScope.SUBURB_GRID_SIZE || 25;

const cityData = (globalScope.cityData = globalScope.cityData || {});
let currentViewedSector = globalScope.currentViewedSector || SUBURBS[0] || 'Central';
globalScope.currentViewedSector = currentViewedSector;

let simulationTimer = null;
let tickSpeedMs = parseInt(globalScope.tickSpeedMs || 800, 10);
let simulationRunning = false;
let simulationEpoch = 0;
let simulationPaused = false;

// --- GLOBAL ENVIRONMENT INFLUENCE VARIABLES ---
let globalMutationMod = 1.0;
let globalAnimalMod = 1.0;
let globalSanitationMod = 0.0;

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
                if (entity.isInfected) {
                    const pathogenKey = entity.pathogenKey || 'AlphaVariant';
                    const pathogen = PATHOGEN_VAULT[pathogenKey];
                    if (!pathogen) return;
                    if (entity.isDead && pathogenKey !== 'OmegaVariant') return;
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
        });
    });

if (activeEpoch !== simulationEpoch) return;

    // Track if a cross-sector event changes the state of the city
    let crossSectorChanged = false;

    // 1. Run commuting logic
    simulateCrossSectorCommuting(); 
    
    // 2. Run supply chain logic
    checkBotulismSupplyChain();      

    // 3. Force a UI refresh if a local change occurred, or if background ticks happen
    // To be perfectly safe, we can re-render whenever the simulation is actively running changes
    if (changed || simulationRunning) {
        renderCurrentSector();
    }
    
    // Always keep global dashboards accurately matching hidden matrices
    updateStatsPanel();
}


function resetSimulation() {
    // 1. Completely halt the clock and clear the active epoch
    if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
    }
    simulationRunning = false;
    simulationPaused = false;
    simulationEpoch = 0;

    // 2. Clear out existing city grid matrices for all suburbs
    SUBURBS.forEach(suburbName => {
        createEmptyMatrix(suburbName);
    });

    // 3. Re-initialize baseline dynamic features (like Botulism stores)
    DeltaVariant_STORES = {};
    ensureDeltaVariantStores();

    // 4. Update interface layouts back to fresh state metrics
    renderCurrentSector();
    updateStatsPanel();
    
    console.log("[SYSTEM] Simulation reset. Map cleared and ready for new exposure.");
} // <-- Closes resetSimulation
function createEmptyMatrix(suburbName) {
    const matrix = [];
    for (let r = 0; r < SUBURB_GRID_SIZE; r++) {
        const row = [];
        for (let c = 0; c < SUBURB_GRID_SIZE; c++) {
            row.push({
                type: Math.random() < 0.15 ? 'animal' : 'human',
                isInfected: false,
                isDead: false,
                isVaccinated: false,
                infectionAge: 0,
                stealthTicks: 0,
                pathogenKey: null,
                isInfectiousBody: false
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

            // Strict boundary constraint—no magical air drifting to other sectors
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

        // Bumping the travel chance from 5% to 25% so cross-border spread is active and observable
        if (Math.random() > 0.25) return;

        // Pick a random destination sector
        const destinations = SUBURBS.filter(s => s !== sourceSuburb);
        const targetSuburb = destinations[Math.floor(Math.random() * destinations.length)];
        const targetMatrix = cityData[targetSuburb];
        if (!targetMatrix) return;

        const tr = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const tc = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const targetEntity = targetMatrix[tr][tc];

        if (!targetEntity || targetEntity.isDead) return;

        // --- FIXED VECTOR 1: Allow ALL infected variants to commute seamlessly ---
        if (commuter.isInfected) {
            if (infectEntity(targetEntity, commuter.pathogenKey)) {
                console.log(`[COMMUTE] An infected carrier traveled from ${sourceSuburb} to ${targetSuburb} carrying ${commuter.pathogenKey}!`);
            }
        }
        
        // --- VECTOR 2: Vaccinated Human Commutes ---
        else if (commuter.isVaccinated && !commuter.isInfected) {
            if (targetEntity.type === 'human' && !targetEntity.isInfected && !targetEntity.isVaccinated) {
                targetEntity.isVaccinated = true;
                console.log(`[VACCINE TRAVEL] A vaccinated citizen commuted from ${sourceSuburb} and immunized a resident in ${targetSuburb}.`);
            }
        }
    });
}

function checkBotulismSupplyChain() {
    // Count infections in the current active sector
    const currentMatrix = getCurrentMatrix();
    let localBotulismCount = 0;

    currentMatrix.forEach(row => {
        row.forEach(entity => {
            if (entity.isInfected && entity.pathogenKey === 'botulism') {
                localBotulismCount++;
            }
        });
    });

    // Condition: If local infections cross a threshold (e.g., 8 cases), activate national supply chains
    if (localBotulismCount >= 8) {
        SUBURBS.forEach(suburbName => {
            // Skip the source sector where it's already running naturally
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
    // 1. Get the current active sector matrix array
    const matrix = cityData[currentViewedSector];
    if (!matrix) return;

    // 2. Determine what pathogen is selected in the dropdown menu
    const pathogenSelect = document.getElementById('pathogen-select');
    const pathogenKey = pathogenSelect ? pathogenSelect.value : 'measles';

    let patientZeroFound = false;
    let attempts = 0;
    const maxAttempts = 500;

    // 3. Scan the grid to find a living, non-vaccinated human host
    while (!patientZeroFound && attempts < maxAttempts) {
        attempts++;
        const r = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const c = Math.floor(Math.random() * SUBURB_GRID_SIZE);
        const entity = matrix[r][c];

        if (entity && entity.type === 'human' && !entity.isDead && !entity.isVaccinated) {
            entity.isInfected = true;
            entity.pathogenKey = pathogenKey;
            entity.infectionEpoch = 0; // Initialize tracking timer
            
            patientZeroFound = true;
            console.log(`[OUTBREAK] Patient Zero exposed in ${currentViewedSector} at [${r}, ${c}] with ${pathogenKey}.`);
        }
    }

    if (patientZeroFound) {
        // 4. Force UI updates so the node instantly turns red
        renderCurrentSector();
        updateStatsPanel();

        // 5. Fire up the background simulation loop engine
        startSimulation();
    } else {
        console.warn("[SYSTEM] Could not find a valid human host to infect.");
    }
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
        super("Bubonic GammaVariant", 0.45, 0.60, 0.90);
        this.lifespan = 7;
    }

    isEligibleTarget(matrix, r, c, target, host) {
        if (!super.isEligibleTarget(matrix, r, c, target, host)) return false;
        if (target.type !== 'human') return false;
        return this.hasAnimalNeighbor(matrix, r, c);
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

const PATHOGEN_VAULT = {
    measles: new AlphaVariantPathogen(),     
    covid: new BetaVariantPathogen(),        
    lyssavirus: new LyssavirusPathogen(),   
    plague: new GammaVariantPathogen(),      
    botulism: new DeltaVariantPathogen(),    
    anthrax: new OmegaVariantPathogen(),     
    kafka: new KafkaVariant()                
};

PATHOGEN_VAULT.measles.name = "Measles";
PATHOGEN_VAULT.covid.name = "COVID-19";
PATHOGEN_VAULT.plague.name = "Bubonic Plague";
PATHOGEN_VAULT.botulism.name = "Botulism";
PATHOGEN_VAULT.anthrax.name = "Anthrax";

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
        default:
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
    if (entity.isDead && pathogenKey !== 'OmegaVariant') return false;
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

    // Fix: Only apply automatic store contamination if Botulism is the active pathogen
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
    // Clamp percentage between 1% and 100%
    const rate = Math.min(100, Math.max(1, percentage)) / 100;

    console.log(`[HEALTH DEPT] Initiating a city-wide vaccination campaign at ${percentage}% coverage...`);

    // Loop through EVERY suburb sector in the simulation
    SUBURBS.forEach(suburbName => {
        const matrix = cityData[suburbName];
        if (!matrix) return;

        // 1. Count total living humans in this specific sector
        let livingHumansCount = 0;
        matrix.forEach(row => {
            row.forEach(entity => {
                if (entity && entity.type === 'human' && !entity.isDead) {
                    livingHumansCount++;
                }
            });
        });

        // 2. Calculate dynamic target quota based on this sector's population density
        const targetQuota = Math.round(livingHumansCount * rate);
        if (targetQuota <= 0) return;

        let vaccinatedThisBatch = 0;
        let attempts = 0;
        const maxAttempts = SUBURB_GRID_SIZE * SUBURB_GRID_SIZE * 2;

        // 3. Inject vaccines randomly until quota is satisfied
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

    // Refresh UI elements
    renderCurrentSector();
    updateStatsPanel();
}

function processVaccinationSpread(matrix, r, c) {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    
    directions.forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;

        // Ensure target boundary is safe
        if (nr >= 0 && nc >= 0 && nr < matrix.length && nc < matrix[0].length) {
            const neighbor = matrix[nr][nc];
            // 2% chance to convince a healthy neighbor to get vaccinated per tick
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
            
            // Layout standards
            cell.style.width = '20px';
            cell.style.height = '20px';

            if (entity.type === 'animal') {
                cell.classList.add('animal-node');
                cell.style.borderRadius = '6px';
                cell.style.backgroundColor = '#4c566a';
            } else {
                cell.style.borderRadius = '50%';
                cell.style.backgroundColor = '#434c5e';
            }

            updateCellVisualState(entity, cell);
            rowDiv.appendChild(cell);
        });

        mapContainer.appendChild(rowDiv);
    });
}

function switchSector(targetSector) {
    setViewedSector(targetSector);

    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        const text = tab.innerText.toLowerCase();
        if (text.includes(targetSector.toLowerCase()) ||
            (targetSector === 'Central' && text.includes('central'))) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    renderCurrentSector();
}

function hidePathogenInfoPanel() {
    const panel = document.getElementById('pathogen-info-panel');
    if (panel) {
        panel.style.display = 'none';
    }
}

function initiateExposure() {
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
    
    // If the controls are already injected, don't build them again
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
    // 1. Completely halt the clock and clear the active epoch
    stopSimulation();
    simulationPaused = false; // Reset pause state flags

    // 2. Wipe the existing grid data structures
    Object.keys(cityData).forEach(key => delete cityData[key]);
    globalScope.cityData = cityData;

    DeltaVariant_STORES = {};
    
    // 3. Re-verify the current dropdown selection baseline
    const pathogenSelect = document.getElementById('pathogen-select');
    const chosenKey = pathogenSelect ? pathogenSelect.value : 'measles';
    currentPathogen = PATHOGEN_VAULT[chosenKey] || PATHOGEN_VAULT.measles;

    // 4. Regenerate a fresh, uninfected population grid
    setViewedSector(SUBURBS?.[0] || 'Central');
    initCityMap();
    renderCurrentSector();
    updateStatsPanel();
    showPathogenInfoPanel();
    
    console.log("[SYSTEM] Simulation reset. Grid cleared. Awaiting Patient Zero exposure.");
}

function bindControlEvents() {

const vaxButton = document.getElementById('vaccine-campaign-button');
const vaxInput = document.getElementById('vaccine-percent-input'); // Updated ID lookup

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

if (vaxButton && !vaxButton.dataset.bound) {
    vaxButton.addEventListener('click', () => {
        triggerVaccinationCampaign(currentViewedSector, 10); // Immunize 10 humans per click
    });
    vaxButton.dataset.bound = 'true';
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
// --- CONFIG MODIFIERS ---
function setupConfigModifiers() {
    const sMut = document.getElementById('slider-mutation');
    const sAni = document.getElementById('slider-animal');
    const sSan = document.getElementById('slider-sanitation');

    sMut?.addEventListener('input', (e) => {
        globalMutationMod = parseFloat(e.target.value);
        const lbl = document.getElementById('val-mutation');
        if (lbl) lbl.textContent = `${globalMutationMod.toFixed(1)}x`;
    });

    sAni?.addEventListener('input', (e) => {
        globalAnimalMod = parseInt(e.target.value, 10) / 100;
        const lbl = document.getElementById('val-animal');
        if (lbl) lbl.textContent = `${e.target.value}%`;
    });

    sSan?.addEventListener('input', (e) => {
        globalSanitationMod = parseInt(e.target.value, 10) / 100;
        const lbl = document.getElementById('val-sanitation');
        if (lbl) lbl.textContent = `${e.target.value}%`;
    });
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

// Fire application initialization
window.addEventListener('load', initializeSimulationApp);
