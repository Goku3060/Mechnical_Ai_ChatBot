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
import { GeminiService } from './services/geminiService';

class MechanicalApp {
    private streamConnected = false;
    private streamRequested = false;
    private usdClient: UsdSceneClient;
    private geminiService: GeminiService;

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

    constructor() {
        this.usdClient = new UsdSceneClient();
        this.geminiService = new GeminiService(this.usdClient);
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
            this.geminiService.clearHistory();
            this.chatMessages.innerHTML = `
                <div class="message-card assistant">
                    <div class="bubble">
                        <p><strong>Chat history cleared.</strong></p>
                        <p>Ask any question about the mechanical model to query the live USD stage.</p>
                    </div>
                </div>
            `;
        });

        // API Key Modal
        const testStatusBox = document.getElementById('test-status-box')!;
        const testKeyBtn = document.getElementById('test-key-btn') as HTMLButtonElement;

        document.getElementById('open-key-modal')?.addEventListener('click', () => {
            this.keyInput.value = this.geminiService.getApiKey();
            testStatusBox.style.display = 'none';
            this.modal.classList.add('open');
        });

        document.getElementById('close-modal-btn')?.addEventListener('click', () => {
            this.modal.classList.remove('open');
        });

        testKeyBtn?.addEventListener('click', async () => {
            const key = this.keyInput.value.trim();
            if (!key) {
                testStatusBox.style.display = 'flex';
                testStatusBox.className = 'test-status-box error';
                testStatusBox.textContent = '❌ Please enter an API key first.';
                return;
            }

            testKeyBtn.disabled = true;
            testStatusBox.style.display = 'flex';
            testStatusBox.className = 'test-status-box testing';
            testStatusBox.textContent = '⏳ Verifying API Key with Google AI...';

            try {
                // 1. Query model catalog for this key with a 5s timeout
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
                const valid = rawModels.filter(m => m.supportedGenerationMethods?.includes('generateContent'));

                if (valid.length === 0) {
                    throw new Error('Key is valid, but no models supporting generateContent were found.');
                }

                const flash = valid
                    .filter(m => m.name.toLowerCase().includes('flash'))
                    .map(m => m.name.replace(/^models\//, ''));
                const others = valid
                    .filter(m => !m.name.toLowerCase().includes('flash'))
                    .map(m => m.name.replace(/^models\//, ''));

                const candidateNames = Array.from(
                    new Set(['gemini-3.8-flash', ...flash, ...others])
                ).filter(m => !m.includes('gemini-2.0')).slice(0, 5);

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

                this.geminiService.setApiKey(key);
                localStorage.setItem('gemini_active_model', verifiedModel);
                testStatusBox.className = 'test-status-box success';
                testStatusBox.textContent = `✅ Verified! Connected to: ${verifiedModel}`;

                const keyBtn = document.getElementById('open-key-modal');
                if (keyBtn) {
                    keyBtn.innerHTML = `🔑 <span>${verifiedModel}</span>`;
                }
            } catch (err: any) {
                testStatusBox.className = 'test-status-box error';
                testStatusBox.textContent = `❌ Failed: ${err.message || 'Invalid API Key'}`;
            } finally {
                testKeyBtn.disabled = false;
            }
        });

        document.getElementById('save-key-btn')?.addEventListener('click', () => {
            const key = this.keyInput.value.trim();
            if (key) {
                this.geminiService.setApiKey(key);
                this.modal.classList.remove('open');
                const activeModel = this.geminiService.getActiveModel();
                const keyBtn = document.getElementById('open-key-modal');
                if (keyBtn) {
                    keyBtn.innerHTML = `🔑 <span>${activeModel}</span>`;
                }
                this.appendAssistantMessage(`✅ Gemini API Key saved (Active Model: **${activeModel}**). You can now ask questions about the assembly!`);
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
            } catch (err) {
                console.warn('Explode note:', err);
            }
        });

        this.btnAssemble?.addEventListener('click', async () => {
            this.animateSliderTo(0, 800);
            try {
                await this.usdClient.setExplodedView(0.0, true, 0.8);
                document.querySelectorAll('.hud-step-btn').forEach(b => b.classList.remove('active'));
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

    private checkApiKeyPrompt() {
        if (!this.geminiService.hasApiKey()) {
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

        if (!this.geminiService.hasApiKey()) {
            this.modal.classList.add('open');
            return;
        }

        // Render user message bubble
        this.appendUserMessage(text);
        this.userInput.value = '';
        this.sendBtn.disabled = true;

        // Show AI status spinner
        this.aiStatus.classList.add('visible');
        this.aiStatusText.textContent = 'Analyzing question...';

        try {
            const { text: replyText, executedTools } = await this.geminiService.chat(
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
}

// Start Application
const app = new MechanicalApp();
void app.initialize();
