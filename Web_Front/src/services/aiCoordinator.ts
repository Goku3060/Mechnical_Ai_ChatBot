import { UsdSceneClient } from './usdSceneClient';
import { GeminiService } from './geminiService';
import { LocalAiService } from './localAiService';

export type AiProvider = 'local' | 'gemini';

export class AiCoordinator {
    private provider: AiProvider;
    public gemini: GeminiService;
    public local: LocalAiService;

    constructor(usdClient: UsdSceneClient) {
        this.gemini = new GeminiService(usdClient);
        this.local = new LocalAiService(usdClient);

        // Default to local if stored, otherwise 'local' is preferred since user configured LM Studio
        const savedProvider = localStorage.getItem('ai_provider') as AiProvider;
        this.provider = savedProvider === 'gemini' ? 'gemini' : 'local';
    }

    public getProvider(): AiProvider {
        return this.provider;
    }

    public setProvider(provider: AiProvider) {
        this.provider = provider;
        localStorage.setItem('ai_provider', provider);
    }

    public hasCredentials(): boolean {
        if (this.provider === 'local') {
            return true; // LM Studio runs locally without API key
        }
        return this.gemini.hasApiKey();
    }

    public getActiveModel(): string {
        if (this.provider === 'local') {
            return this.local.getModel();
        }
        return this.gemini.getActiveModel();
    }

    public clearHistory() {
        this.local.clearHistory();
        this.gemini.clearHistory();
    }

    public async chat(
        userPrompt: string,
        onStatusUpdate?: (status: string) => void
    ): Promise<{ text: string; executedTools: Array<{ name: string; args: any; result: any }> }> {
        if (this.provider === 'local') {
            return await this.local.chat(userPrompt, onStatusUpdate);
        } else {
            return await this.gemini.chat(userPrompt, onStatusUpdate);
        }
    }
}
