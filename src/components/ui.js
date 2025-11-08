export function createUI() {
    const infoPanel = document.getElementById('info-panel');
    const rightPanel = document.getElementById('right-panel');

    // Populate the main left panel
    infoPanel.innerHTML = `
        <div class="config-group-header">Comprehensive Benchmark</div>
        <div id="benchmark-status">Ready for standard test.</div>
        <button id="benchmark-btn">Run Benchmark</button>
        <button id="download-log-btn" disabled>Download Log</button>
        <button id="submit-score-btn" disabled>Submit Score</button>

        <div class="config-group-header">Top 3 Scores</div>
        <div id="top-scores-panel">
            <!-- Top scores will be injected here -->
            <div class="top-score-loading">Loading...</div>
        </div>
        <button id="leaderboard-btn">View Full Leaderboard</button>

        <div class="config-group-header">Sandbox Controls</div>
        <div class="config-item">
            <label title="Load a pre-defined set of simulation parameters.">Scenario:</label>
            <select id="scenario-preset">
                <option value="">— Select Scenario —</option>
                <option value="quiet">Quiet Solitude</option>
                <option value="active">Active Accretion</option>
                <option value="complex">Complex Dance</option>
                <option value="extreme">Extreme Collision</option>
            </select>
        </div>
        <div class="config-item">
            <label title="Manually set the number of physics-based particles.">Particles:</label>
            <div>
                <input type="range" id="sandbox-particles" value="10000" min="0" max="150000" step="1000">
                <strong id="particle-count-label">10000</strong>
            </div>
        </div>
        <div class="config-item">
            <label title="Simple: BH only. Complex: Particle interaction. Extreme: Adds particle collisions.">Physics Quality:</label>
            <select id="physics-quality">
                <option value="simple">Simple (BH Only)</option>
                <option value="complex">Complex (N-Body)</option>
                <option value="extreme">Extreme (Collisions)</option>
            </select>
        </div>
        <div class="config-item">
            <label title="The gravitational mass of the black hole.">BH Mass:</label>
            <input type="range" id="bh-mass" value="400000" min="50000" max="1000000" step="10000">
        </div>
        <button id="reset-camera-btn">Reset Camera</button>
        
        <details>
            <summary style="cursor:pointer; font-size: 13px; margin-top: 15px;">Info / Help</summary>
            <div class="info-box">
                <strong>Welcome to the Nebula AUSP!</strong><br>
                This tool runs a series of tests to profile your system's performance.<br><br>
                - Use the <strong>Sandbox Controls</strong> to experiment freely.<br>
                - Run the <strong>Comprehensive Benchmark</strong> for a standardized score.<br>
                - View the <strong>Full Leaderboard</strong> to see how your system compares.<br>
                - After a benchmark, you can <strong>Submit Score</strong> to the public leaderboard.<br>
                - Download detailed logs using the <strong>Download Log</strong> button.
            </div>
        </details>
        <div id="version-info"></div>
    `;

    // Populate the new right panel
    rightPanel.innerHTML = `
        <div class="config-group-header">System Info</div>
        <div id="system-info-panel">
            <div id="system-summary-line" class="system-info-summary"></div>
        </div>

        <div class="config-group-header">Live Metrics</div>
        <div id="metrics-panel">
            <div class="metric-row">
                <span class="metric-label">FPS:</span>
                <span class="metric-value" id="metric-fps">...</span>
            </div>
            <div class="metric-row">
                <span class="metric-label">Live Particles:</span>
                <span class="metric-value" id="metric-particles">...</span>
            </div>
            <div class="metric-row">
                <span class="metric-label">Consumed:</span>
                <span class="metric-value" id="metric-consumed">0</span>
            </div>
            <hr>
            <div class="metric-row">
                <span class="metric-label">Physics CPU:</span>
                <span class="metric-value" id="metric-physics-cpu">...</span>
                <span class="metric-unit">ms</span>
            </div>
            <canvas id="cpu-graph" class="perf-graph" width="200" height="60"></canvas>
            <div class="metric-row">
                <span class="metric-label">GPU Render:</span>
                <span class="metric-value" id="metric-render-time">...</span>
                <span class="metric-unit">ms</span>
            </div>
            <canvas id="gpu-graph" class="perf-graph" width="200" height="60"></canvas>
            <div class="metric-row">
                <span class="metric-label">Memory:</span>
                <span class="metric-value" id="metric-memory">...</span>
                <span class="metric-unit">MB</span>
            </div>
        </div>

        <button id="toggle-controls-btn">Toggle Post-FX Controls</button>
    `;

    return {
        logPanel: document.getElementById('log-panel-container'),
        versionInfo: document.getElementById('version-info'),
        benchmarkStatusEl: document.getElementById('benchmark-status'),
        benchmarkBtn: document.getElementById('benchmark-btn'),
        downloadLogBtn: document.getElementById('download-log-btn'),
        submitScoreBtn: document.getElementById('submit-score-btn'),
        leaderboardBtn: document.getElementById('leaderboard-btn'),
        toggleControlsBtn: document.getElementById('toggle-controls-btn'),
        topScoresPanel: document.getElementById('top-scores-panel'),
        metrics: {
            fps: document.getElementById('metric-fps'),
            physicsCpu: document.getElementById('metric-physics-cpu'),
            renderTime: document.getElementById('metric-render-time'),
            particles: document.getElementById('metric-particles'),
            consumed: document.getElementById('metric-consumed'),
            memory: document.getElementById('metric-memory'),
            cpuGraph: document.getElementById('cpu-graph'),
            gpuGraph: document.getElementById('gpu-graph'),
        },
        systemInfo: {
            // Optional single-line summary; detailed rows are rendered by renderSystemInfo
            summary: document.getElementById('system-summary-line'),
            // Legacy/structured fields populated by renderSystemInfo when present
            cpu: document.getElementById('spec-cpu'),
            gpu: document.getElementById('spec-gpu'),
        },
        sandboxControls: {
            particles: document.getElementById('sandbox-particles'),
            particleCountLabel: document.getElementById('particle-count-label'),
            bhMass: document.getElementById('bh-mass'),
            physicsQuality: document.getElementById('physics-quality'),
            scenario: document.getElementById('scenario-preset'),
            resetCameraBtn: document.getElementById('reset-camera-btn'),
        },
        submissionModal: {
            backdrop: document.getElementById('submission-modal-backdrop'),
            scoreSummary: document.getElementById('modal-score-summary'),
            systemSummary: document.getElementById('modal-system-summary'),
            cancelBtn: document.getElementById('modal-cancel-btn'),
            submitBtn: document.getElementById('modal-submit-btn'),
        }
    };
}