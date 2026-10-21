import './index.css';
import {
    AppStreamer,
    DirectConfig,
    StreamEvent,
    StreamProps,
    LogLevel,
    StreamType,
    EventAction,
    EventStatus
} from '@nvidia/ov-web-rtc';
import { UsdSceneClient } from './services/usdSceneClient';
import { AiCoordinator } from './services/aiCoordinator';

class MechanicalApp {
    private streamConnected = false;
    private streamRequested = false;
    private usdClient: UsdSceneClient;
    private aiService: AiCoordinator;

    // DOM Elements
    private statusDot!: HTMLElement;
    private statusText!: HTMLElement;
    private loadingMessage!: HTMLElement;
    private errorMessage!: HTMLElement;
    private errorMessageText!: HTMLElement;
    private chatMessages!: HTMLElement;
    private userInput!: HTMLInputElement;
    private sendBtn!: HTMLButtonElement;
    private aiStatus!: HTMLElement;
    private aiStatusText!: HTMLElement;
    private modal!: HTMLElement;
    private keyInput!: HTMLInputElement;

    // Kinematics & Exploded View HUD Elements
    private explodeSlider!: HTMLInputElement;
    private explodeValue!: HTMLElement;
    private btnExplode!: HTMLButtonElement;
    private btnAssemble!: HTMLButtonElement;
    private btnToggleRotor!: HTMLButtonElement;
    private rotorStatusText!: HTMLElement;
    private rotorRpmSelect!: HTMLSelectElement;

    // Kinematics & Exploded View State
    private isRotorRotating = false;
    private currentExplosionFactor = 0.0;
    private animatingExplosion = false;

    // Spatial Callouts DOM Elements & State
    private spatialCalloutsOverlay!: HTMLElement;
    private calloutLeaderLines!: SVGSVGElement;
    private calloutPinsContainer!: HTMLElement;
    private btnToggleCallouts!: HTMLButtonElement;
    private calloutsStatusText!: HTMLElement;
    private showCallouts = true;
    private calloutsTimer: any = null;
    private cachedCallouts: any[] = [];

    // Bill of Materials (BOM) Drawer DOM Elements & State
    private bomModal!: HTMLElement;
    private openBomBtn!: HTMLElement;
    private closeBomModalBtn!: HTMLElement;
    private exportBomCsvBtn!: HTMLElement;
    private exportBomJsonBtn!: HTMLElement;
    private bomSearchInput!: HTMLInputElement;
    private bomTableBody!: HTMLElement;
    private bomMetricItems!: HTMLElement;
    private bomMetricWeight!: HTMLElement;
    private bomMetricCost!: HTMLElement;
    private cachedBomData: any = null;
    private activeBomCategory = 'all';
    private bomSearchTerm = '';

    constructor() {
        this.usdClient = new UsdSceneClient();
        this.aiService = new AiCoordinator(this.usdClient);
    }

    public async initialize() {
        this.bindDOMElements();
        this.bindEvents();
        this.checkApiKeyPrompt();
        await this.initializeStream();
    }

    private bindDOMElements() {
        this.statusDot = document.getElementById('status-dot')!;
        this.statusText = document.getElementById('status-text')!;
        this.loadingMessage = document.getElementById('loading-stream-message')!;
        this.errorMessage = document.getElementById('error-message')!;
        this.errorMessageText = document.getElementById('error-message-text')!;
        this.chatMessages = document.getElementById('chat-messages')!;
        this.userInput = document.getElementById('user-input') as HTMLInputElement;
        this.sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
        this.aiStatus = document.getElementById('ai-status')!;
        this.aiStatusText = document.getElementById('ai-status-text')!;
        this.modal = document.getElementById('api-key-modal')!;
        this.keyInput = document.getElementById('gemini-key-input') as HTMLInputElement;

        // Kinematics HUD
        this.explodeSlider = document.getElementById('explode-slider') as HTMLInputElement;
        this.explodeValue = document.getElementById('explode-value')!;
        this.btnExplode = document.getElementById('btn-explode') as HTMLButtonElement;
        this.btnAssemble = document.getElementById('btn-assemble') as HTMLButtonElement;
        this.btnToggleRotor = document.getElementById('btn-toggle-rotor') as HTMLButtonElement;
        this.rotorStatusText = document.getElementById('rotor-status-text')!;
        this.rotorRpmSelect = document.getElementById('rotor-rpm-select') as HTMLSelectElement;

        // Spatial Callouts Layer
        this.spatialCalloutsOverlay = document.getElementById('spatial-callouts-overlay')!;
        this.calloutLeaderLines = document.getElementById('callout-leader-lines') as unknown as SVGSVGElement;
        this.calloutPinsContainer = document.getElementById('callout-pins-container')!;
        this.btnToggleCallouts = document.getElementById('btn-toggle-callouts') as HTMLButtonElement;
        this.calloutsStatusText = document.getElementById('callouts-status-text')!;

        // Bill of Materials (BOM) Drawer
        this.bomModal = document.getElementById('bom-modal')!;
        this.openBomBtn = document.getElementById('open-bom-btn')!;
        this.closeBomModalBtn = document.getElementById('close-bom-modal-btn')!;
        this.exportBomCsvBtn = document.getElementById('export-bom-csv-btn')!;
        this.exportBomJsonBtn = document.getElementById('export-bom-json-btn')!;
        this.bomSearchInput = document.getElementById('bom-search-input') as HTMLInputElement;
        this.bomTableBody = document.getElementById('bom-table-body')!;
        this.bomMetricItems = document.getElementById('bom-metric-items')!;
        this.bomMetricWeight = document.getElementById('bom-metric-weight')!;
        this.bomMetricCost = document.getElementById('bom-metric-cost')!;
    }

    private bindEvents() {
        // Send button and Enter key
        this.sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        // Quick prompt chips
        document.querySelectorAll('.chip-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    this.userInput.value = prompt;
                    this.handleSendMessage();
                }
            });
        });

        // Clear chat button
        document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
            this.aiService.clearHistory();
            this.chatMessages.innerHTML = `
                <div class="message-card assistant">
                    <div class="bubble">
                        <p><strong>Chat history cleared.</strong></p>
                        <p>Ask any question about the mechanical model to query the live USD stage.</p>
                    </div>
                </div>
            `;
        });

        // AI Copilot Provider Modal (Local LM Studio + Google Gemini)
        const testStatusBox = document.getElementById('test-status-box')!;
        const testKeyBtn = document.getElementById('test-key-btn') as HTMLButtonElement;
        const tabBtnLocal = document.getElementById('tab-btn-local');
        const tabBtnGemini = document.getElementById('tab-btn-gemini');
        const panelLocal = document.getElementById('panel-local');
        const panelGemini = document.getElementById('panel-gemini');
        const localBaseUrlInput = document.getElementById('local-base-url-input') as HTMLInputElement;
        const localModelInput = document.getElementById('local-model-input') as HTMLInputElement;

        let activeTab: 'local' | 'gemini' = this.aiService.getProvider();

        const setModalTab = (provider: 'local' | 'gemini') => {
            activeTab = provider;
            if (provider === 'local') {
                tabBtnLocal?.classList.add('active');
                tabBtnGemini?.classList.remove('active');
                panelLocal?.classList.add('active');
                panelGemini?.classList.remove('active');
            } else {
                tabBtnGemini?.classList.add('active');
                tabBtnLocal?.classList.remove('active');
                panelGemini?.classList.add('active');
                panelLocal?.classList.remove('active');
            }
            testStatusBox.style.display = 'none';
        };

        tabBtnLocal?.addEventListener('click', () => setModalTab('local'));
        tabBtnGemini?.addEventListener('click', () => setModalTab('gemini'));

        document.getElementById('open-key-modal')?.addEventListener('click', () => {
            setModalTab(this.aiService.getProvider());
            if (localBaseUrlInput) localBaseUrlInput.value = this.aiService.local.getBaseUrl();
            if (localModelInput) localModelInput.value = this.aiService.local.getModel();
            if (this.keyInput) this.keyInput.value = this.aiService.gemini.getApiKey();
            testStatusBox.style.display = 'none';
            this.modal.classList.add('open');
        });

        document.getElementById('close-modal-btn')?.addEventListener('click', () => {
            this.modal.classList.remove('open');
        });

        testKeyBtn?.addEventListener('click', async () => {
            testKeyBtn.disabled = true;
            testStatusBox.style.display = 'flex';

            if (activeTab === 'local') {
                testStatusBox.className = 'test-status-box testing';
                const url = localBaseUrlInput?.value.trim() || 'http://localhost:1235/v1';
                testStatusBox.textContent = `⏳ Connecting to LM Studio at ${url}...`;

                try {
                    const res = await this.aiService.local.testConnection(url);
                    testStatusBox.className = 'test-status-box success';
                    testStatusBox.textContent = `✅ Connected! Model: ${res.activeModel} (${res.models.length} loaded in LM Studio)`;
                    if (localModelInput) {
                        localModelInput.value = res.activeModel;
                    }
                    const badge = document.getElementById('detected-models-count');
                    if (badge) {
                        badge.textContent = `${res.models.length} model(s) online`;
                    }
                } catch (err: any) {
                    testStatusBox.className = 'test-status-box error';
                    testStatusBox.textContent = `❌ LM Studio connection failed: ${err.message || 'Make sure LM Studio local server is started on port 1235'}`;
                } finally {
                    testKeyBtn.disabled = false;
                }
            } else {
                // Gemini validation
                const key = this.keyInput.value.trim();
                if (!key) {
                    testStatusBox.className = 'test-status-box error';
                    testStatusBox.textContent = '❌ Please enter a Gemini API key first.';
                    testKeyBtn.disabled = false;
                    return;
                }

                testStatusBox.className = 'test-status-box testing';
                testStatusBox.textContent = '⏳ Verifying API Key with Google AI...';

                try {
                    const catalogRes = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
                        { signal: AbortSignal.timeout(5000) }
                    );

                    if (!catalogRes.ok) {
                        const errText = await catalogRes.text();
                        throw new Error(errText);
                    }

                    const data = await catalogRes.json();
                    const rawModels: Array<{ name: string; supportedGenerationMethods?: string[] }> = data.models || [];
                    const valid = rawModels.filter((m) => m.supportedGenerationMethods?.includes('generateContent'));

                    if (valid.length === 0) {
                        throw new Error('Key is valid, but no models supporting generateContent were found.');
                    }

                    const flash = valid
                        .filter((m) => m.name.toLowerCase().includes('flash'))
                        .map((m) => m.name.replace(/^models\//, ''));
                    const others = valid
                        .filter((m) => !m.name.toLowerCase().includes('flash'))
                        .map((m) => m.name.replace(/^models\//, ''));

                    const candidateNames = Array.from(
                        new Set(['gemini-3.8-flash', ...flash, ...others])
                    ).filter((m) => !m.includes('gemini-2.0')).slice(0, 5);

                    let verifiedModel = '';
                    let lastErrText = '';

                    for (const modelName of candidateNames) {
                        testStatusBox.textContent = `⏳ Testing model: ${modelName}...`;
                        try {
                            const testRes = await fetch(
                                `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`,
                                {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }],
                                    }),
                                    signal: AbortSignal.timeout(3500),
                                }
                            );

                            if (testRes.ok) {
                                verifiedModel = modelName;
                                break;
                            } else {
                                const err = await testRes.text();
                                lastErrText = err;
                                if (err.includes('API_KEY_INVALID') || testRes.status === 403) {
                                    break;
                                }
                            }
                        } catch (e: any) {
                            lastErrText = e.message || String(e);
                        }
                    }

                    if (!verifiedModel) {
                        throw new Error(lastErrText || 'Could not find an active model on your account');
                    }

                    this.aiService.gemini.setApiKey(key);
                    localStorage.setItem('gemini_active_model', verifiedModel);
                    testStatusBox.className = 'test-status-box success';
                    testStatusBox.textContent = `✅ Verified! Connected to: ${verifiedModel}`;
                } catch (err: any) {
                    testStatusBox.className = 'test-status-box error';
                    testStatusBox.textContent = `❌ Failed: ${err.message || 'Invalid API Key'}`;
                } finally {
                    testKeyBtn.disabled = false;
                }
            }
        });

        document.getElementById('save-key-btn')?.addEventListener('click', () => {
            if (activeTab === 'local') {
                const url = localBaseUrlInput?.value.trim() || 'http://localhost:1235/v1';
                const model = localModelInput?.value.trim() || 'nvidia/nemotron-3-nano-4b';
                this.aiService.local.setBaseUrl(url);
                this.aiService.local.setModel(model);
                this.aiService.setProvider('local');
                this.updateProviderUI();
                this.modal.classList.remove('open');
                this.appendAssistantMessage(`✅ **Local AI Activated!** Connected to LM Studio with **${model}** at \`${url}\`. Offline CAD digital twin copilot is active!`);
            } else {
                const key = this.keyInput.value.trim();
                if (key) {
                    this.aiService.gemini.setApiKey(key);
                    this.aiService.setProvider('gemini');
                    this.updateProviderUI();
                    this.modal.classList.remove('open');
                    const activeModel = this.aiService.getActiveModel();
                    this.appendAssistantMessage(`✅ **Gemini Cloud AI Activated!** (Active Model: **${activeModel}**). You can now ask questions about the assembly!`);
                }
            }
        });

        // Retry connection
        document.getElementById('retry-stream')?.addEventListener('click', () => {
            this.streamRequested = false;
            this.initializeStream();
        });

        // Delegate clicks on interactive part chips in chat
        this.chatMessages.addEventListener('click', async (e) => {
            const target = (e.target as HTMLElement).closest('.part-tag') as HTMLElement;
            if (target) {
                const primPath = target.getAttribute('data-prim');
                if (primPath) {
                    console.log('User clicked part badge to highlight & frame:', primPath);
                    await this.usdClient.selectPart([primPath]);
                    try {
                        await this.usdClient.focusPrim(primPath, 1.0);
                    } catch (err) {
                        console.warn('focusPrim note:', err);
                    }
                    target.style.outline = '2px solid var(--nvidia-green)';
                    setTimeout(() => { target.style.outline = ''; }, 1500);
                }
            }
        });

        // Bind Kinematics & Exploded View HUD
        this.bindKinematicsEvents();

        // Bind Callouts Toggle
        this.btnToggleCallouts?.addEventListener('click', () => {
            this.showCallouts = !this.showCallouts;
            if (this.showCallouts) {
                this.spatialCalloutsOverlay?.classList.remove('hidden');
                this.btnToggleCallouts?.classList.add('active');
                if (this.calloutsStatusText) this.calloutsStatusText.textContent = 'Callouts';
                this.fetchAndRenderCallouts();
            } else {
                this.spatialCalloutsOverlay?.classList.add('hidden');
                this.btnToggleCallouts?.classList.remove('active');
                if (this.calloutsStatusText) this.calloutsStatusText.textContent = 'Callouts Off';
            }
        });

        // Bind Bill of Materials (BOM) Drawer
        this.openBomBtn?.addEventListener('click', () => {
            this.bomModal?.classList.add('open');
            this.fetchAndRenderBOM();
        });

        this.closeBomModalBtn?.addEventListener('click', () => {
            this.bomModal?.classList.remove('open');
        });

        this.bomModal?.addEventListener('click', (e) => {
            if (e.target === this.bomModal) {
                this.bomModal.classList.remove('open');
            }
        });

        this.exportBomCsvBtn?.addEventListener('click', () => this.exportBomAsCsv());
        this.exportBomJsonBtn?.addEventListener('click', () => this.exportBomAsJson());

        this.bomSearchInput?.addEventListener('input', () => {
            this.bomSearchTerm = this.bomSearchInput.value.trim().toLowerCase();
            this.renderBOMTable();
        });

        document.querySelectorAll('.bom-filter-tag').forEach((tag) => {
            tag.addEventListener('click', () => {
                document.querySelectorAll('.bom-filter-tag').forEach((t) => t.classList.remove('active'));
                tag.classList.add('active');
                this.activeBomCategory = tag.getAttribute('data-cat') || 'all';
                this.renderBOMTable();
            });
        });

        this.bomTableBody?.addEventListener('click', async (e) => {
            const btn = (e.target as HTMLElement).closest('.btn-bom-focus') as HTMLElement;
            if (btn) {
                const prim = btn.getAttribute('data-prim');
                if (prim) {
                    await this.usdClient.selectPart([prim]);
                    try {
                        await this.usdClient.focusPrim(prim, 1.0);
                    } catch (_) {}
                    btn.textContent = 'Focused!';
                    setTimeout(() => { btn.textContent = 'Focus 3D'; }, 1500);
                }
            }
        });
    }

    private bindKinematicsEvents() {
        if (!this.explodeSlider) return;

        // Interactive exploded view slider (debounced live scrubbing)
        let sliderThrottleTimeout: any = null;
        this.explodeSlider.addEventListener('input', () => {
            const val = parseInt(this.explodeSlider.value, 10);
            const factor = val / 100.0;
            this.currentExplosionFactor = factor;
            this.explodeValue.textContent = `${val}%`;

            if (!sliderThrottleTimeout) {
                sliderThrottleTimeout = setTimeout(() => {
                    sliderThrottleTimeout = null;
                    this.usdClient.setExplodedView(factor, false).catch(() => {});
                }, 40);
            }
        });

        this.explodeSlider.addEventListener('change', () => {
            const val = parseInt(this.explodeSlider.value, 10);
            const factor = val / 100.0;
            this.usdClient.setExplodedView(factor, false).catch(() => {});
        });

        // Explode / Assemble quick animate buttons (Native 60 FPS smooth server easing)
        this.btnExplode?.addEventListener('click', async () => {
            this.animateSliderTo(100, 800);
            try {
                await this.usdClient.setExplodedView(1.0, true, 0.8);
                document.querySelectorAll('.hud-step-btn').forEach(b => b.classList.add('active'));
                setTimeout(() => this.fetchAndRenderCallouts(), 850);
            } catch (err) {
                console.warn('Explode note:', err);
            }
        });

        this.btnAssemble?.addEventListener('click', async () => {
            this.animateSliderTo(0, 800);
            try {
                await this.usdClient.setExplodedView(0.0, true, 0.8);
                document.querySelectorAll('.hud-step-btn').forEach(b => b.classList.remove('active'));
                setTimeout(() => this.fetchAndRenderCallouts(), 850);
            } catch (err) {
                console.warn('Assemble note:', err);
            }
        });

        // Toggle rotor rotation
        this.btnToggleRotor?.addEventListener('click', async () => {
            this.isRotorRotating = !this.isRotorRotating;
            const rpm = parseFloat(this.rotorRpmSelect?.value || '120') || 120;

            if (this.isRotorRotating) {
                this.btnToggleRotor.classList.add('active');
                this.rotorStatusText.textContent = `Spinning (${rpm} RPM)`;
            } else {
                this.btnToggleRotor.classList.remove('active');
                this.rotorStatusText.textContent = 'Spin Rotor';
            }

            try {
                await this.usdClient.setRotorKinematics(this.isRotorRotating, rpm);
            } catch (err) {
                console.warn('Rotor kinematics update note:', err);
            }
        });

        // Rotor RPM change
        this.rotorRpmSelect?.addEventListener('change', async () => {
            if (this.isRotorRotating) {
                const rpm = parseFloat(this.rotorRpmSelect.value) || 120;
                this.rotorStatusText.textContent = `Spinning (${rpm} RPM)`;
                try {
                    await this.usdClient.setRotorKinematics(true, rpm);
                } catch (err) {
                    console.warn('Rotor RPM update note:', err);
                }
            }
        });

        // Step Assemble button (Assembles next component: Hub → Pads → Caliper → Bolts)
        document.getElementById('btn-step-assemble')?.addEventListener('click', async () => {
            try {
                const res = await this.usdClient.stepAssembleNext(true);
                if (res?.data?.step) {
                    const stepBtn = document.querySelector(`.hud-step-btn[data-step="${res.data.step}"]`);
                    stepBtn?.classList.remove('active');
                }
                this.syncExplodeState();
            } catch (err) {
                console.warn('Step assemble note:', err);
            }
        });

        // Step Explode button (Explodes next component: Bolts → Caliper → Pads → Hub)
        document.getElementById('btn-step-explode')?.addEventListener('click', async () => {
            try {
                const res = await this.usdClient.stepExplodeNext(true);
                if (res?.data?.step) {
                    const stepBtn = document.querySelector(`.hud-step-btn[data-step="${res.data.step}"]`);
                    stepBtn?.classList.add('active');
                }
                this.syncExplodeState();
            } catch (err) {
                console.warn('Step explode note:', err);
            }
        });

        // Individual component toggle buttons (Bolts, Caliper, Pads, Hub)
        document.querySelectorAll('.hud-step-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const step = btn.getAttribute('data-step');
                if (!step) return;

                const isCurrentlyExploded = btn.classList.contains('active');
                const targetProgress = isCurrentlyExploded ? 0.0 : 1.0;

                try {
                    await this.usdClient.disassembleStep(step, targetProgress, true, 0.8);
                    if (targetProgress > 0.5) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                    this.syncExplodeState();
                } catch (err) {
                    console.warn(`Toggle step ${step} note:`, err);
                }
            });
        });
    }

    /**
     * Synchronizes UI HUD state with Kit server exploded view state.
     */
    private async syncExplodeState() {
        try {
            const state = await this.usdClient.getExplodedViewState();
            if (state?.data) {
                const stepProg = state.data.target_step_progress || state.data.step_progress || {};
                document.querySelectorAll('.hud-step-btn').forEach((btn) => {
                    const s = btn.getAttribute('data-step');
                    if (s && stepProg[s] !== undefined) {
                        if (stepProg[s] > 0.5) {
                            btn.classList.add('active');
                        } else {
                            btn.classList.remove('active');
                        }
                    }
                });
                const factor = state.data.target_exploded_factor ?? state.data.exploded_factor ?? 0;
                this.currentExplosionFactor = factor;
                if (this.explodeSlider) {
                    this.explodeSlider.value = String(Math.round(factor * 100));
                }
                if (this.explodeValue) {
                    this.explodeValue.textContent = `${Math.round(factor * 100)}%`;
                }
            }
        } catch (_) {}
    }

    /**
     * Smoothly eases the UI HUD slider position to match the 60 FPS animation.
     */
    private animateSliderTo(targetVal: number, durationMs = 800) {
        if (!this.explodeSlider || !this.explodeValue) return;
        const startVal = parseInt(this.explodeSlider.value, 10);
        const startTime = performance.now();

        const step = (now: number) => {
            const elapsed = now - startTime;
            const t = Math.min(1.0, elapsed / durationMs);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const current = Math.round(startVal + (targetVal - startVal) * ease);

            this.explodeSlider.value = String(current);
            this.explodeValue.textContent = `${current}%`;
            this.currentExplosionFactor = current / 100.0;

            if (t < 1.0) {
                requestAnimationFrame(step);
            }
        };
        requestAnimationFrame(step);
    }

    private updateProviderUI() {
        const provider = this.aiService.getProvider();
        const activeModel = this.aiService.getActiveModel();
        const label = document.getElementById('active-provider-label');
        if (label) {
            if (provider === 'local') {
                label.textContent = `Local: Nemotron-4B`;
            } else {
                label.textContent = `Gemini: ${activeModel}`;
            }
        }

        const subtitle = document.querySelector('.chat-subtitle');
        if (subtitle) {
            if (provider === 'local') {
                subtitle.textContent = `USD Scene API Grounded • Local Nemotron-4B`;
            } else {
                subtitle.textContent = `USD Scene API Grounded • Gemini Flash`;
            }
        }
    }

    private checkApiKeyPrompt() {
        this.updateProviderUI();
        if (!this.aiService.hasCredentials()) {
            setTimeout(() => {
                this.modal.classList.add('open');
            }, 800);
        }
    }

    private updateStreamStatus(state: 'connected' | 'connecting' | 'error', text: string) {
        this.statusDot.className = `status-dot ${state}`;
        this.statusText.textContent = text;

        if (state === 'connected') {
            this.loadingMessage.style.display = 'none';
            this.errorMessage.style.display = 'none';
        } else if (state === 'connecting') {
            this.loadingMessage.style.display = 'flex';
            this.errorMessage.style.display = 'none';
        } else if (state === 'error') {
            this.loadingMessage.style.display = 'none';
            this.errorMessage.style.display = 'flex';
            this.errorMessageText.textContent = text;
        }
    }

    private async initializeStream() {
        if (this.streamConnected || this.streamRequested) return;
        this.streamRequested = true;

        this.updateStreamStatus('connecting', 'Connecting to Kit (127.0.0.1)...');

        const streamConfig: DirectConfig = {
            videoElementId: 'remote-video',
            signalingServer: '127.0.0.1',
            width: 1920,
            height: 1080,
            fps: 60,
            onStart: (message: StreamEvent) => {
                if (message.action === EventAction.START) {
                    if (message.status === EventStatus.SUCCESS) {
                        this.streamConnected = true;
                        this.updateStreamStatus('connected', 'Live 3D Stream Active');
                        this.startCalloutsLoop();
                    } else if (message.status === EventStatus.ERROR) {
                        this.streamConnected = false;
                        this.updateStreamStatus('error', message.info || 'Connection refused. Is Kit running?');
                    }
                }
            },
            onCustomEvent: (message: any) => {
                // Route custom messages to UsdSceneClient
                this.usdClient.handleCustomEvent(message);
            },
            onStop: () => {
                this.streamConnected = false;
                this.streamRequested = false;
                this.updateStreamStatus('connecting', 'Stream Disconnected. Reconnecting...');
            }
        };

        const streamProps: StreamProps = {
            streamSource: StreamType.DIRECT,
            logLevel: LogLevel.INFO,
            streamConfig
        };

        try {
            await AppStreamer.connect(streamProps);
        } catch (error: any) {
            console.error('Failed to connect to stream:', error);
            this.streamRequested = false;
            this.updateStreamStatus('error', error?.message || 'Connection failed.');
        }
    }

    private async handleSendMessage() {
        const text = this.userInput.value.trim();
        if (!text) return;

        if (!this.aiService.hasCredentials()) {
            this.modal.classList.add('open');
            return;
        }

        // Render user message bubble
        this.appendUserMessage(text);
        this.userInput.value = '';
        this.sendBtn.disabled = true;

        // Show AI status spinner
        this.aiStatus.classList.add('visible');
        this.aiStatusText.textContent = this.aiService.getProvider() === 'local'
            ? 'Analyzing with Nemotron-4B...'
            : 'Analyzing question...';

        try {
            const { text: replyText, executedTools } = await this.aiService.chat(
                text,
                (statusUpdate) => {
                    this.aiStatusText.textContent = statusUpdate;
                }
            );

            this.appendAssistantMessage(replyText, executedTools);
        } catch (error: any) {
            console.error('Chat error:', error);
            this.appendAssistantMessage(`⚠️ **Error**: ${error?.message || String(error)}`);
        } finally {
            this.aiStatus.classList.remove('visible');
            this.sendBtn.disabled = false;
            this.userInput.focus();
        }
    }

    private appendUserMessage(text: string) {
        const div = document.createElement('div');
        div.className = 'message-card user';
        div.innerHTML = `<div class="bubble">${this.escapeHTML(text)}</div>`;
        this.chatMessages.appendChild(div);
        this.scrollToBottom();
    }

    private appendAssistantMessage(markdown: string, executedTools?: Array<{ name: string; args: any; result: any }>) {
        const div = document.createElement('div');
        div.className = 'message-card assistant';

        let toolsHTML = '';
        if (executedTools && executedTools.length > 0) {
            toolsHTML = executedTools
                .map((t) => `<div class="tool-pill">⚡ Query: ${t.name}</div>`)
                .join('');
        }

        const parsedHTML = this.formatMarkdown(markdown);

        div.innerHTML = `
            ${toolsHTML}
            <div class="bubble">${parsedHTML}</div>
        `;
        this.chatMessages.appendChild(div);
        this.scrollToBottom();
    }

    private scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    private escapeHTML(str: string): string {
        return str.replace(/[&<>'"]/g, (tag) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    }

    /**
     * Lightweight markdown formatter that also automatically turns USD prim paths
     * into interactive clickable badges to highlight parts in 3D!
     */
    private formatMarkdown(md: string): string {
        let html = md;

        // Headers
        html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 8px 0 4px; color: var(--text-primary); font-size: 13.5px;">$1</h4>');
        html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 10px 0 6px; color: var(--text-primary); font-size: 14px;">$1</h3>');

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

        // Inline Code
        html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');

        // Bullet lists
        html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');

        // Line breaks to paragraphs
        const paragraphs = html.split(/\n\n+/);
        html = paragraphs.map((p) => {
            if (p.startsWith('<ul>') || p.startsWith('<h4>') || p.startsWith('<h3>')) {
                return p;
            }
            return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        }).join('');

        // Detect prim paths (e.g. /World/... or `occurrence_of_...`) and make them interactive
        html = html.replace(/(\/World\/[a-zA-Z0-9_\/]+)/g, (match) => {
            const shortName = match.split('/').pop() || match;
            return `<span class="part-tag" data-prim="${match}" title="Click to highlight in 3D">🎯 ${shortName}</span>`;
        });

        return html;
    }

    /**
     * Starts background polling for spatial callout positions to track viewport camera movement.
     */
    private startCalloutsLoop() {
        if (this.calloutsTimer) clearInterval(this.calloutsTimer);
        // Initial fetch
        setTimeout(() => this.fetchAndRenderCallouts(), 600);
        // Periodic sync every 2.5 seconds
        this.calloutsTimer = setInterval(() => {
            if (this.showCallouts && this.streamConnected && !this.animatingExplosion) {
                this.fetchAndRenderCallouts();
            }
        }, 2500);
    }

    /**
     * Queries Kit server for 3D bounding centers projected to screen coordinates.
     */
    public async fetchAndRenderCallouts() {
        if (!this.showCallouts || !this.streamConnected) return;
        try {
            const res = await this.usdClient.getSpatialCallouts();
            if (res?.data?.callouts) {
                this.cachedCallouts = res.data.callouts;
                this.renderSpatialCallouts(this.cachedCallouts);
            }
        } catch (err) {
            console.warn('Callouts fetch note:', err);
        }
    }

    /**
     * Renders floating numbered pins and leader lines over the 3D viewport.
     */
    private renderSpatialCallouts(callouts: any[]) {
        if (!this.calloutPinsContainer || !this.calloutLeaderLines) return;

        // Clear existing callout elements
        this.calloutPinsContainer.innerHTML = '';
        this.calloutLeaderLines.innerHTML = '';

        callouts.forEach((c) => {
            if (c.visible === false || c.screen_x_pct < 0 || c.screen_x_pct > 100) return;

            const x = c.screen_x_pct;
            const y = c.screen_y_pct;

            // Pin element
            const pin = document.createElement('div');
            pin.className = 'spatial-callout-pin';
            pin.setAttribute('data-prim', c.prim_path);
            pin.style.left = `${x}%`;
            pin.style.top = `${y}%`;

            pin.innerHTML = `
                <div class="pin-marker">${c.item_no}</div>
                <div class="pin-tag">
                    <span class="pin-name">${c.name}</span>
                    <span class="pin-sub">${c.part_number} • $${c.unit_price?.toFixed(2)}</span>
                </div>
                <div class="pin-tooltip-card">
                    <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">Item #${c.item_no}: ${c.name}</div>
                    <div class="tooltip-spec-row"><span class="tooltip-spec-label">Part No:</span><span class="tooltip-spec-val" style="color: var(--cyan-accent);">${c.part_number}</span></div>
                    <div class="tooltip-spec-row"><span class="tooltip-spec-label">Category:</span><span class="tooltip-spec-val">${c.category}</span></div>
                    <div class="tooltip-spec-row"><span class="tooltip-spec-label">Material:</span><span class="tooltip-spec-val">${c.material}</span></div>
                    <div class="tooltip-spec-row"><span class="tooltip-spec-label">Torque:</span><span class="tooltip-spec-val" style="color: #fbbf24;">${c.torque_nm}</span></div>
                    <div class="tooltip-spec-row"><span class="tooltip-spec-label">Weight:</span><span class="tooltip-spec-val">${c.weight_kg} kg</span></div>
                    <div class="tooltip-spec-row"><span class="tooltip-spec-label">Unit Cost:</span><span class="tooltip-spec-val" style="color: #34d399;">$${c.unit_price?.toFixed(2)}</span></div>
                </div>
            `;

            // Clicking pin selects the component in 3D and highlights it
            pin.addEventListener('click', async (e) => {
                e.stopPropagation();
                console.log(`Pin #${c.item_no} clicked: ${c.name} (${c.prim_path})`);
                await this.usdClient.selectPart([c.prim_path]);
                try {
                    await this.usdClient.focusPrim(c.prim_path, 1.0);
                } catch (_) {}
                pin.classList.add('active');
                setTimeout(() => pin.classList.remove('active'), 1600);
            });

            this.calloutPinsContainer.appendChild(pin);
        });
    }

    /**
     * Fetches authoritative Bill of Materials (BOM) from the Kit server.
     */
    public async fetchAndRenderBOM() {
        try {
            const res = await this.usdClient.getBillOfMaterials();
            if (res?.data) {
                this.cachedBomData = res.data;
                if (this.bomMetricItems) this.bomMetricItems.textContent = `${res.data.total_items} Parts`;
                if (this.bomMetricWeight) this.bomMetricWeight.textContent = `${res.data.total_weight_kg} kg`;
                if (this.bomMetricCost) this.bomMetricCost.textContent = `$${res.data.total_cost_usd?.toFixed(2)}`;
                this.renderBOMTable();
            }
        } catch (err) {
            console.warn('BOM fetch note:', err);
        }
    }

    /**
     * Renders filtered rows in the BOM data table.
     */
    private renderBOMTable() {
        if (!this.bomTableBody || !this.cachedBomData?.items) return;

        const items: any[] = this.cachedBomData.items;
        const filtered = items.filter((it) => {
            // Category filter
            if (this.activeBomCategory !== 'all' && it.category !== this.activeBomCategory) {
                return false;
            }
            // Search query filter
            if (this.bomSearchTerm) {
                const q = this.bomSearchTerm;
                const matchName = it.name?.toLowerCase().includes(q);
                const matchNum = it.part_number?.toLowerCase().includes(q);
                const matchMat = it.material?.toLowerCase().includes(q);
                const matchCat = it.category?.toLowerCase().includes(q);
                if (!matchName && !matchNum && !matchMat && !matchCat) return false;
            }
            return true;
        });

        this.bomTableBody.innerHTML = filtered.map((it) => {
            const dimStr = it.dimensions_mm?.formatted || '180 x 180 x 28 mm';
            return `
                <tr>
                    <td style="text-align: center;"><span class="bom-item-badge">${it.item_no}</span></td>
                    <td>
                        <div class="bom-part-name">
                            <span>${it.name}</span>
                        </div>
                    </td>
                    <td><span class="bom-part-num">${it.part_number}</span></td>
                    <td><span class="bom-cat-pill">${it.category}</span></td>
                    <td>
                        <div class="bom-material-text">${it.material}</div>
                        <div class="bom-material-spec">${it.material_spec}</div>
                    </td>
                    <td><span class="bom-dim-text">${dimStr}</span></td>
                    <td><span class="bom-torque-pill">${it.torque_nm}</span></td>
                    <td style="text-align: right; font-weight: 600;">${it.weight_kg} kg</td>
                    <td style="text-align: right;"><span class="bom-price-text">$${it.unit_price?.toFixed(2)}</span></td>
                    <td style="text-align: center;">
                        <button class="btn-bom-focus" data-prim="${it.prim_path}">Focus 3D</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Exports the authoritative BOM data as a CSV spreadsheet.
     */
    private exportBomAsCsv() {
        if (!this.cachedBomData?.items) return;
        const headers = ['Item No', 'Component Name', 'Part Number', 'Category', 'Material', 'Material Spec', 'CAD Dimensions (mm)', 'Torque Spec', 'Weight (kg)', 'Unit Price (USD)', 'Stock Status'];
        const rows = this.cachedBomData.items.map((it: any) => [
            it.item_no,
            `"${it.name}"`,
            `"${it.part_number}"`,
            `"${it.category}"`,
            `"${it.material}"`,
            `"${it.material_spec}"`,
            `"${it.dimensions_mm?.formatted || ''}"`,
            `"${it.torque_nm}"`,
            it.weight_kg,
            it.unit_price,
            `"${it.stock_status}"`
        ]);
        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', 'Disc_Brake_Assembly_BOM.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Exports the authoritative BOM data as formatted JSON.
     */
    private exportBomAsJson() {
        if (!this.cachedBomData) return;
        const jsonStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.cachedBomData, null, 2));
        const link = document.createElement('a');
        link.setAttribute('href', jsonStr);
        link.setAttribute('download', 'Disc_Brake_Assembly_BOM.json');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Start Application
const app = new MechanicalApp();
void app.initialize();

