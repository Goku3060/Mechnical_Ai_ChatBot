import { UsdSceneClient } from './usdSceneClient';
import { GEMINI_USD_TOOLS, executeCadTool } from './geminiService';

export interface OpenAiToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface OpenAiChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: OpenAiToolCall[];
    reasoning_content?: string;
}

/**
 * Converts Gemini function declarations into standard OpenAI / JSON Schema tool definitions.
 */
export function convertToOpenAiTools(geminiTools: any[]): any[] {
    return geminiTools.map((t) => {
        const clonedParams = JSON.parse(JSON.stringify(t.parameters || { type: 'OBJECT', properties: {} }));

        // Recursively convert UPPERCASE types ('STRING', 'OBJECT', etc.) to JSON Schema lowercase ('string', 'object')
        const lowercaseTypes = (obj: any) => {
            if (!obj || typeof obj !== 'object') return;
            if (typeof obj.type === 'string') {
                obj.type = obj.type.toLowerCase();
            }
            if (obj.properties) {
                for (const key of Object.keys(obj.properties)) {
                    lowercaseTypes(obj.properties[key]);
                }
            }
            if (obj.items) {
                lowercaseTypes(obj.items);
            }
        };
        lowercaseTypes(clonedParams);

        return {
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: clonedParams
            }
        };
    });
}

export class LocalAiService {
    private baseUrl: string;
    private model: string;
    private usdClient: UsdSceneClient;
    private conversationHistory: OpenAiChatMessage[] = [];
    private tools: any[];

    private systemPrompt = `You are the Mechanical AI Copilot for NVIDIA Omniverse OpenUSD digital twin scenes.
You assist mechanical engineers and operators in inspecting, analyzing, measuring, modifying, and explaining 3D assemblies (such as the automotive Disc Brake Assembly).

YOU HAVE FULL READ AND WRITE ACCESS TO THE LIVE USD STAGE:
1. Always base answers on authoritative live OpenUSD data queried through your tools.
2. SceneInfo First: When the user asks about parts without specifying an exact prim path, call search_parts or get_scene_summary first to locate the exact prims.
3. Interactive Write & Material Modification:
   - When the user asks to change the color of a part or material (e.g., "Change the caliper to red", "Make the yellow paint blue"), you HAVE DIRECT WRITE ACCESS! Call 'set_material_color' with the material name (e.g., "Metal_Yellow_Paint") and the RGB float array (e.g., [1.0, 0.0, 0.0] for racing red, [0.0, 0.3, 1.0] for electric blue, [0.08, 0.08, 0.08] for gloss black, [1.0, 0.84, 0.0] for gold).
   - When the user asks to assign or bind a material to a part (e.g. "Assign aluminum to the caliper mesh"), call 'bind_material'.
   - When the user asks for direct display color overrides on geometry, call 'set_prim_display_color'.
   - For complex custom scene manipulations, call 'execute_usd_code'.
   - NEVER tell the user that you only have inspection mode or that you lack write access! You have full interactive write access.
4. Exploded View & Kinematics:
   - When the user asks to explode the view, separate parts, or inspect internal components, call 'set_exploded_view' with factor 1.0.
   - When the user asks to assemble, reassemble, or reset the assembly, call 'set_exploded_view' with factor 0.0 (or 'disassemble_component' with step='reset').
   - When the user asks to explode part by part or explode the next part, call 'disassemble_component' with step='step_explode'.
   - When the user asks to assemble part by part or assemble the next part, call 'disassemble_component' with step='step_assemble'.
   - When the user asks to remove, unbolt, or disassemble specific parts, call 'disassemble_component' with step ('bolts', 'caliper', 'pads', 'hub') and action='disassemble' (or progress=1.0).
   - When the user asks to assemble or install specific parts (e.g. "Assemble the caliper", "Put the brake pads back", "Assemble the hub"), call 'disassemble_component' with step ('bolts', 'caliper', 'pads', 'hub') and action='assemble' (or progress=0.0).
   - When the user asks to spin, rotate, or simulate rotation of the brake rotor disc, call 'set_rotor_kinematics' with enabled=true and rpm (default 120).
5. Physical Dimensions: Call get_part_dimensions for authoritative millimeter (mm) measurements.
6. Bill of Materials (BOM) & Specifications:
   - When the user asks about the parts list, specs, alloys, fastener torque ratings, pricing, weights, or total assembly mass, call 'get_bill_of_materials'.
   - Ground your answers in the authoritative engineering BOM: 8 components total, 21.19 kg assembly mass, $552.00 assembly cost.
   - List key specifications cleanly: Item #, Part Number, Material Alloy, Torque Spec (e.g. 115 N·m for Caliper Mounting Bolts, 35 N·m for Caliper Slide Pins, 140 N·m for Wheel Lug Nuts), and Unit Price.
7. Component Isolation: Call set_part_visibility with visible=false to hide occluding parts, or call focus_camera_on_part to frame the camera.
8. Present technical answers with clean markdown: bold part names, bulleted dimensions in mm, and confirmation of applied material or kinematic changes.`;

    constructor(usdClient: UsdSceneClient) {
        this.usdClient = usdClient;
        this.baseUrl = localStorage.getItem('local_ai_base_url') || 'http://localhost:1235/v1';
        this.model = localStorage.getItem('local_ai_model') || 'nvidia/nemotron-3-nano-4b';
        this.tools = convertToOpenAiTools(GEMINI_USD_TOOLS);
    }

    public setBaseUrl(url: string) {
        let clean = url.trim().replace(/\/+$/, '');
        if (!clean.endsWith('/v1')) {
            clean += '/v1';
        }
        this.baseUrl = clean;
        localStorage.setItem('local_ai_base_url', this.baseUrl);
    }

    public getBaseUrl(): string {
        return this.baseUrl || 'http://localhost:1235/v1';
    }

    public setModel(model: string) {
        this.model = model.trim();
        localStorage.setItem('local_ai_model', this.model);
    }

    public getModel(): string {
        return this.model || 'nvidia/nemotron-3-nano-4b';
    }

    public clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Tests connectivity to the local LM Studio server and queries loaded models.
     */
    public async testConnection(customUrl?: string): Promise<{ success: boolean; models: string[]; activeModel: string }> {
        const targetBase = (customUrl || this.baseUrl).replace(/\/+$/, '');
        const endpointsToTry = [
            `${targetBase}/models`,
            // Fallback via Vite dev proxy if direct browser fetch has CORS
            '/api/local-llm/v1/models'
        ];

        let lastError: any = null;
        for (const endpoint of endpointsToTry) {
            try {
                const res = await fetch(endpoint);
                if (res.ok) {
                    const data = await res.json();
                    const models: string[] = (data.data || []).map((m: any) => m.id);
                    let activeModel = this.model;
                    if (!models.includes(activeModel) && models.length > 0) {
                        const nemotron = models.find((m) => m.toLowerCase().includes('nemotron'));
                        activeModel = nemotron || models[0];
                    }
                    return { success: true, models, activeModel };
                }
            } catch (err: any) {
                lastError = err;
            }
        }

        throw new Error(
            lastError?.message ||
                `Could not connect to LM Studio at ${targetBase}. Please ensure LM Studio Local Server is started.`
        );
    }

    /**
     * Executes multi-turn OpenAI Chat Completions loop with CAD tools.
     */
    public async chat(
        userPrompt: string,
        onStatusUpdate?: (status: string) => void
    ): Promise<{ text: string; executedTools: Array<{ name: string; args: any; result: any }> }> {
        const executedTools: Array<{ name: string; args: any; result: any }> = [];

        // Append user prompt
        this.conversationHistory.push({
            role: 'user',
            content: userPrompt
        });

        const maxTurns = 6;
        let currentTurn = 0;

        while (currentTurn < maxTurns) {
            currentTurn++;

            const messagesPayload: OpenAiChatMessage[] = [
                { role: 'system', content: this.systemPrompt },
                ...this.conversationHistory
            ];

            const requestBody = {
                model: this.model,
                messages: messagesPayload,
                tools: this.tools,
                temperature: 0.2,
                max_tokens: 2048
            };

            const endpointsToTry = [
                `${this.baseUrl}/chat/completions`,
                '/api/local-llm/v1/chat/completions'
            ];

            let response: Response | null = null;
            let lastErr: any = null;

            for (const endpoint of endpointsToTry) {
                try {
                    response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                    if (response.ok) break;
                } catch (e: any) {
                    lastErr = e;
                }
            }

            if (!response || !response.ok) {
                const errorText = response ? await response.text() : (lastErr?.message || 'Network error');
                throw new Error(`LM Studio API Error (${response?.status || 'Network'}): ${errorText}`);
            }

            const data = await response.json();
            const choice = data.choices?.[0];
            if (!choice || !choice.message) {
                throw new Error('No message choice returned from local model.');
            }

            const message = choice.message;

            // Surface Nemotron thinking/reasoning status to operator
            if (message.reasoning_content && onStatusUpdate) {
                const preview = message.reasoning_content.trim().slice(0, 70);
                if (preview) {
                    onStatusUpdate(`Nemotron reasoning: ${preview}...`);
                }
            }

            // Check if model called CAD tools
            const toolCalls: OpenAiToolCall[] = message.tool_calls || [];

            if (toolCalls.length === 0) {
                // Final response received!
                const finalText = message.content || 'Action executed successfully.';
                this.conversationHistory.push({
                    role: 'assistant',
                    content: finalText
                });
                return {
                    text: finalText,
                    executedTools
                };
            }

            // Record the assistant message requesting tool calls
            this.conversationHistory.push({
                role: 'assistant',
                content: message.content || '',
                tool_calls: toolCalls
            });

            // Execute each CAD tool via UsdSceneClient
            for (const toolCall of toolCalls) {
                const toolName = toolCall.function?.name || '';
                let rawArgs = toolCall.function?.arguments || '{}';
                let parsedArgs: any = {};

                if (typeof rawArgs === 'string') {
                    try {
                        parsedArgs = JSON.parse(rawArgs);
                    } catch {
                        // Resilient fallback regex for small 4B models that might emit markdown blocks or loose JSON
                        const match = rawArgs.match(/\{[\s\S]*\}/);
                        if (match) {
                            try {
                                parsedArgs = JSON.parse(match[0]);
                            } catch {}
                        }
                    }
                } else if (typeof rawArgs === 'object' && rawArgs !== null) {
                    parsedArgs = rawArgs;
                }

                if (onStatusUpdate) {
                    onStatusUpdate(`Querying USD API: ${toolName}...`);
                }

                let toolResult: any;
                try {
                    toolResult = await executeCadTool(this.usdClient, toolName, parsedArgs);
                    executedTools.push({ name: toolName, args: parsedArgs, result: toolResult });
                } catch (toolError: any) {
                    console.error(`Local AI tool execution error (${toolName}):`, toolError);
                    toolResult = { error: toolError?.message || String(toolError) };
                }

                // Append tool response
                this.conversationHistory.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                });
            }

            if (onStatusUpdate) {
                onStatusUpdate('Synthesizing mechanical analysis with Nemotron-4B...');
            }
        }

        return {
            text: 'Completed CAD tool executions.',
            executedTools
        };
    }
}
