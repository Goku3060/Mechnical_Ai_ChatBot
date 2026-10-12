import { UsdSceneClient } from './usdSceneClient';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolCalls?: Array<{ name: string; args: any }>;
    timestamp: Date;
}

export const GEMINI_USD_TOOLS = [
    {
        name: 'get_scene_summary',
        description: 'Retrieves high-level OpenUSD stage summary including default prim, CAD units, up axis, total prim counts, root mechanical assemblies, and root component list. Call this when the user asks what the scene or assembly is about.',
        parameters: {
            type: 'OBJECT',
            properties: {}
        }
    },
    {
        name: 'get_assembly_hierarchy',
        description: 'Traverses the mechanical CAD assembly hierarchy to retrieve the structured tree of sub-assemblies, mechanical parts, meshes, and bound materials.',
        parameters: {
            type: 'OBJECT',
            properties: {
                root_path: {
                    type: 'STRING',
                    description: 'The root prim path to start from, e.g. /World/Disc_Brake_Assembly'
                },
                max_depth: {
                    type: 'INTEGER',
                    description: 'Maximum hierarchy depth to traverse (default 4)'
                }
            }
        }
    },
    {
        name: 'inspect_prim',
        description: 'Retrieves detailed CAD engineering properties for a specific prim path, including 3D translation/rotation, mesh vertex and face counts, active schemas, and bound material.',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'Exact prim path, e.g. /World/Disc_Brake_Assembly/occurrence_of_Brake_Caliper/Brake_Caliper'
                }
            },
            required: ['prim_path']
        }
    },
    {
        name: 'list_materials',
        description: 'Lists all MDL/PBR materials defined in the stage (under /World/Looks) and which mechanical parts are bound to each material.',
        parameters: {
            type: 'OBJECT',
            properties: {}
        }
    },
    {
        name: 'highlight_part',
        description: 'Visually selects and highlights a mechanical component or part in the live 3D Omniverse viewport so the user can locate it.',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'Full USD prim path to highlight in the viewport, e.g. /World/Disc_Brake_Assembly/occurrence_of_rotor_disc'
                }
            },
            required: ['prim_path']
        }
    },
    {
        name: 'search_parts',
        description: 'Searches for CAD components, parts, or meshes across the OpenUSD stage by keyword or part name (e.g. "rotor", "caliper", "bolt", "pad"). Returns matching prim paths and materials.',
        parameters: {
            type: 'OBJECT',
            properties: {
                query: {
                    type: 'STRING',
                    description: 'Search keyword or part name, e.g. "caliper", "pad", "bolt", "rotor"'
                },
                prim_type: {
                    type: 'STRING',
                    description: 'Optional filter by USD prim type, e.g. "Mesh" or "Xform"'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'get_part_dimensions',
        description: 'Computes authoritative physical bounding box and dimensional measurements (width, height, depth in millimeters mm) for a specific mechanical part or prim using UsdGeom.BBoxCache.',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'Full USD prim path to measure, e.g. /World/Disc_Brake_Assembly/occurrence_of_rotor_disc/rotor_disc'
                }
            },
            required: ['prim_path']
        }
    },
    {
        name: 'set_part_visibility',
        description: 'Controls the 3D visibility (show or hide) of a specific mechanical component or subassembly in the live viewport. Use this when the user asks to hide parts (e.g. to inspect internal components like brake pads inside the caliper) or show them again.',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'Full USD prim path to show or hide'
                },
                visible: {
                    type: 'BOOLEAN',
                    description: 'True to make the part visible, false to hide it'
                }
            },
            required: ['prim_path', 'visible']
        }
    },
    {
        name: 'focus_camera_on_part',
        description: 'Smoothly frames and focuses the live 3D viewport camera directly on a specific mechanical component. Call this when the user asks to look at, focus on, or zoom into a specific part.',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'Full USD prim path to frame the camera on'
                },
                zoom: {
                    type: 'NUMBER',
                    description: 'Optional zoom factor (default 1.0; 0.85 = closer, 1.2 = wider)'
                }
            },
            required: ['prim_path']
        }
    },
    {
        name: 'reset_camera',
        description: 'Resets the 3D viewport camera to the original overview framing of the complete mechanical assembly.',
        parameters: {
            type: 'OBJECT',
            properties: {}
        }
    },
    {
        name: 'set_material_color',
        description: 'Modifies the live diffuse/base color of an OpenUSD MDL/PBR material in real-time. Use this when the user asks to change the color of a material or component (e.g. change Metal_Yellow_Paint or the Caliper to racing red [1.0, 0.0, 0.0], electric blue [0.0, 0.3, 1.0], gloss black [0.05, 0.05, 0.05], gold [1.0, 0.84, 0.0], etc.).',
        parameters: {
            type: 'OBJECT',
            properties: {
                material_name: {
                    type: 'STRING',
                    description: 'The name or path of the material to change, e.g. "Metal_Yellow_Paint", "Aluminum_Anodized", or "/World/Looks/Metal_Yellow_Paint"'
                },
                color_rgb: {
                    type: 'ARRAY',
                    description: 'Float RGB array with values from 0.0 to 1.0, e.g. [1.0, 0.0, 0.0] for racing red, [0.0, 0.4, 0.9] for blue, [0.08, 0.08, 0.08] for black, [1.0, 0.84, 0.0] for gold.',
                    items: {
                        type: 'NUMBER'
                    }
                }
            },
            required: ['material_name', 'color_rgb']
        }
    },
    {
        name: 'bind_material',
        description: 'Binds/assigns an existing USD material to any specific mechanical prim or mesh (e.g. bind "Metal_Silver_Paint" or "Aluminum_Anodized" to "/World/Disc_Brake_Assembly/occurrence_of_Brake_Caliper/Brake_Caliper/mesh67_mesh").',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'The target prim path to bind the material to, e.g. /World/Disc_Brake_Assembly/occurrence_of_Brake_Caliper/Brake_Caliper/mesh67_mesh'
                },
                material_name: {
                    type: 'STRING',
                    description: 'Name or full path of the material to bind, e.g. "Metal_Silver_Paint", "Aluminum_Anodized", or "/World/Looks/Metal_Silver_Paint"'
                }
            },
            required: ['prim_path', 'material_name']
        }
    },
    {
        name: 'set_prim_display_color',
        description: 'Directly modifies the viewport display color (primvars:displayColor) on any mesh prim in the assembly (e.g. [1.0, 0.0, 0.0] for red).',
        parameters: {
            type: 'OBJECT',
            properties: {
                prim_path: {
                    type: 'STRING',
                    description: 'Full USD prim path of the mesh'
                },
                color_rgb: {
                    type: 'ARRAY',
                    description: 'RGB array with values from 0.0 to 1.0',
                    items: {
                        type: 'NUMBER'
                    }
                }
            },
            required: ['prim_path', 'color_rgb']
        }
    },
    {
        name: 'execute_usd_code',
        description: 'Executes live Python OpenUSD code directly on the active Omniverse stage. Has full write access to omni, stage, Usd, UsdGeom, UsdShade, Gf, Sdf, Vt. Use this for complex custom modifications requested by the user.',
        parameters: {
            type: 'OBJECT',
            properties: {
                code: {
                    type: 'STRING',
                    description: 'Python script string to execute against the active stage'
                }
            },
            required: ['code']
        }
    },
    {
        name: 'set_exploded_view',
        description: 'Explodes or reassembles the mechanical Disc Brake Assembly in real-time. Factor ranges from 0.0 (completely assembled) to 1.0 (fully exploded view) or intermediate values (e.g. 0.5). Call this when the user asks to explode the view, separate parts, see internal assembly structure, or reassemble the brake.',
        parameters: {
            type: 'OBJECT',
            properties: {
                factor: {
                    type: 'NUMBER',
                    description: 'Explosion factor between 0.0 (assembled) and 1.0 (fully exploded). 0.0 brings all parts back together.'
                }
            },
            required: ['factor']
        }
    },
    {
        name: 'set_rotor_kinematics',
        description: 'Starts or stops continuous rotation/spinning of the ventilated brake rotor disc to demonstrate mechanical kinematics, testing rotation, or simulating vehicle motion.',
        parameters: {
            type: 'OBJECT',
            properties: {
                enabled: {
                    type: 'BOOLEAN',
                    description: 'True to spin the rotor disc continuously, false to stop rotation.'
                },
                rpm: {
                    type: 'NUMBER',
                    description: 'Optional rotational speed in revolutions per minute (default 120 RPM).'
                }
            },
            required: ['enabled']
        }
    },
    {
        name: 'disassemble_component',
        description: 'Performs targeted mechanical disassembly or assembly of specific component groups (e.g. removing/installing caliper bolts, extracting/mounting the caliper, removing/installing friction brake pads, or detaching/assembling the wheel hub). Can also assemble or explode components one by one sequentially.',
        parameters: {
            type: 'OBJECT',
            properties: {
                step: {
                    type: 'STRING',
                    description: "Component group or sequential action: 'bolts', 'caliper', 'pads', 'hub', 'step_explode' (explode next part in order), 'step_assemble' (assemble next part back in order), 'all', or 'reset' (assemble everything back in place)"
                },
                action: {
                    type: 'STRING',
                    description: "Action to perform: 'disassemble' (explodes the part outward) or 'assemble' (brings the part back into assembled position in place)."
                },
                progress: {
                    type: 'NUMBER',
                    description: 'Progress from 0.0 (fully assembled in place) to 1.0 (fully disassembled / exploded). Default is 1.0 for disassembly, 0.0 for assembly.'
                }
            },
            required: ['step']
        }
    },
    {
        name: 'get_bill_of_materials',
        description: 'Retrieves the complete authoritative Bill of Materials (BOM) for the Disc Brake Assembly, including item numbers, part numbers, engineering categories, alloys/materials, ASTM/SAE specs, torque specifications (N·m), unit prices, quantities, stock status, weights (kg), physical bounding dimensions (mm), and assembly totals (total weight 21.19 kg, total price $552.00, 8 parts). Call this whenever the user asks about the bill of materials, parts list, specs, alloys, bolt torque ratings, part costs, weight, or inventory status.',
        parameters: {
            type: 'OBJECT',
            properties: {}
        }
    }
];

export class GeminiService {
    private apiKey: string;
    private selectedModel: string = 'gemini-3.8-flash';
    private usdClient: UsdSceneClient;
    private conversationHistory: any[] = [];
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
        this.apiKey = localStorage.getItem('gemini_api_key') || '';
    }

    public setApiKey(key: string) {
        this.apiKey = key.trim();
        localStorage.setItem('gemini_api_key', this.apiKey);
    }

    public getApiKey(): string {
        return this.apiKey;
    }

    public hasApiKey(): boolean {
        return !!this.apiKey && this.apiKey.length > 5;
    }

    public clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Executes tool call using UsdSceneClient.
     */
    private async executeTool(name: string, args: any): Promise<any> {
        console.log(`[Gemini Tool Exec] Calling ${name}`, args);
        switch (name) {
            case 'get_scene_summary':
                return await this.usdClient.getSceneSummary();

            case 'get_assembly_hierarchy':
                return await this.usdClient.getAssemblyHierarchy(args?.root_path, args?.max_depth);

            case 'inspect_prim':
                return await this.usdClient.inspectPrim(args?.prim_path);

            case 'list_materials':
                return await this.usdClient.listMaterials();

            case 'search_parts':
                return await this.usdClient.searchPrims(args?.query, args?.prim_type);

            case 'get_part_dimensions':
                return await this.usdClient.getPartDimensions(args?.prim_path);

            case 'set_part_visibility':
                return await this.usdClient.setPartVisibility(args?.prim_path, args?.visible !== false);

            case 'focus_camera_on_part':
                return await this.usdClient.focusPrim(args?.prim_path, args?.zoom || 1.0);

            case 'reset_camera':
                return await this.usdClient.resetCamera();

            case 'set_material_color': {
                const color = args?.color_rgb || [1.0, 0.0, 0.0];
                const mat = args?.material_name || args?.material_path || 'Metal_Yellow_Paint';
                return await this.usdClient.setMaterialColor(mat, color);
            }

            case 'bind_material':
                return await this.usdClient.bindMaterial(args?.prim_path, args?.material_name || args?.material_path);

            case 'set_prim_display_color':
                return await this.usdClient.setPrimDisplayColor(args?.prim_path, args?.color_rgb || [1.0, 0.0, 0.0]);

            case 'execute_usd_code':
                return await this.usdClient.executeUsdCode(args?.code);

            case 'highlight_part':
                if (args?.prim_path) {
                    await this.usdClient.selectPart([args.prim_path]);
                    return { status: 'success', highlighted_path: args.prim_path };
                }
                return { status: 'error', message: 'prim_path is required' };

            case 'set_exploded_view':
                return await this.usdClient.setExplodedView(args?.factor ?? 1.0, true, 0.8);

            case 'set_rotor_kinematics':
                return await this.usdClient.setRotorKinematics(args?.enabled !== false, args?.rpm || 120);

            case 'disassemble_component': {
                const action = args?.action;
                let progress = args?.progress;
                if (action === 'assemble') progress = 0.0;
                else if (action === 'disassemble' || action === 'explode') progress = 1.0;
                else if (progress === undefined) progress = 1.0;
                return await this.usdClient.disassembleStep(args?.step || 'all', progress, true, 0.8, action);
            }

            case 'get_bill_of_materials':
                return await this.usdClient.getBillOfMaterials();

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    private cachedCandidateModels: string[] | null = null;

    public getActiveModel(): string {
        return this.selectedModel || localStorage.getItem('gemini_active_model') || 'gemini-3.8-flash';
    }

    /**
     * Dynamically queries the Google Gemini models catalog for this API key,
     * filtering for models that support generateContent and prioritizing flash models.
     */
    public async getCandidateModels(): Promise<string[]> {
        const saved = localStorage.getItem('gemini_active_model');
        let models: string[] = [];

        if (this.cachedCandidateModels && this.cachedCandidateModels.length > 0) {
            models = [...this.cachedCandidateModels];
        } else {
            try {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey.trim()}`
                );

                if (res.ok) {
                    const data = await res.json();
                    const rawModels: Array<{ name: string; supportedGenerationMethods?: string[] }> = data.models || [];

                    const valid = rawModels.filter((m) =>
                        m.supportedGenerationMethods?.includes('generateContent')
                    );

                    const flash = valid
                        .filter((m) => m.name.toLowerCase().includes('flash'))
                        .map((m) => m.name.replace(/^models\//, ''));

                    const others = valid
                        .filter((m) => !m.name.toLowerCase().includes('flash'))
                        .map((m) => m.name.replace(/^models\//, ''));

                    models = Array.from(
                        new Set(['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', ...flash, ...others])
                    ).filter((m) => !m.includes('gemini-2.0'));

                    this.cachedCandidateModels = models;
                }
            } catch (e) {
                console.warn('Could not query model catalog via API key:', e);
            }
        }

        if (models.length === 0) {
            models = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
        }

        // If saved model exists and is still valid, prioritize it first but keep alternatives
        if (saved && !saved.includes('gemini-2.0') && models.includes(saved)) {
            return [saved, ...models.filter((m) => m !== saved)];
        }

        return models;
    }

    /**
     * Sends user message to Gemini and handles function calling loop.
     */
    public async chat(
        userPrompt: string,
        onStatusUpdate?: (status: string) => void
    ): Promise<{ text: string; executedTools: Array<{ name: string; args: any; result: any }> }> {
        if (!this.hasApiKey()) {
            throw new Error('Please configure your Google Gemini API Key first.');
        }

        const executedTools: Array<{ name: string; args: any; result: any }> = [];

        // Append user prompt to internal history
        this.conversationHistory.push({
            role: 'user',
            parts: [{ text: userPrompt }]
        });

        const candidateModels = await this.getCandidateModels();
        let currentTurn = 0;
        const maxTurns = 5;

        while (currentTurn < maxTurns) {
            currentTurn++;

            const payload: any = {
                system_instruction: {
                    parts: [{ text: this.systemPrompt }]
                },
                contents: this.conversationHistory,
                tools: [
                    {
                        function_declarations: GEMINI_USD_TOOLS
                    }
                ],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 2048
                }
            };

            let response: Response | null = null;
            let lastErrorText = '';

            // Try candidate models in order until one succeeds
            for (const modelCandidate of candidateModels) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelCandidate}:generateContent?key=${this.apiKey}`;

                try {
                    response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } catch (fetchErr: any) {
                    lastErrorText = fetchErr?.message || String(fetchErr);
                    continue;
                }

                if (response.ok) {
                    this.selectedModel = modelCandidate;
                    localStorage.setItem('gemini_active_model', modelCandidate);
                    break;
                }

                lastErrorText = await response.text();

                // If 503 (High Demand / Spikes), 429 (Rate limit), 500, or 404 (Retired model), fall back seamlessly!
                if (response.status === 503 || response.status === 429 || response.status === 500 || response.status === 404) {
                    console.warn(`Model ${modelCandidate} returned HTTP ${response.status}, switching to next candidate model...`);
                    if (onStatusUpdate) {
                        onStatusUpdate(`Model ${modelCandidate} is experiencing high demand. Switching to alternative model...`);
                    }
                    if (localStorage.getItem('gemini_active_model') === modelCandidate) {
                        localStorage.removeItem('gemini_active_model');
                    }
                    continue;
                } else {
                    // For client auth errors (400, 401, 403 API key invalid), fail immediately
                    throw new Error(`Gemini API Error (${response.status}): ${lastErrorText}`);
                }
            }

            // If temporary capacity spike affected all models, do 1 short delay and retry
            if (!response || !response.ok) {
                if (onStatusUpdate) {
                    onStatusUpdate('Retrying with alternative model...');
                }
                await new Promise((r) => setTimeout(r, 1200));

                for (const fallbackModel of ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-3.8-flash']) {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${this.apiKey}`;
                    try {
                        response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        if (response.ok) {
                            this.selectedModel = fallbackModel;
                            localStorage.setItem('gemini_active_model', fallbackModel);
                            break;
                        }
                    } catch {
                        // ignore and try next
                    }
                }
            }

            if (!response || !response.ok) {
                throw new Error(`Gemini API Error: Models are temporarily unavailable due to high demand. Please try again in a few moments.`);
            }

            const data = await response.json();
            const candidate = data.candidates?.[0];
            if (!candidate || !candidate.content) {
                throw new Error('No candidate content received from Gemini.');
            }

            const modelParts = candidate.content.parts || [];
            this.conversationHistory.push({
                role: 'model',
                parts: modelParts
            });

            // Check if model called functions
            const functionCalls = modelParts.filter((p: any) => p.functionCall);

            if (functionCalls.length === 0) {
                // Final text response received
                const textPart = modelParts.find((p: any) => p.text);
                return {
                    text: textPart?.text || 'No text output returned.',
                    executedTools
                };
            }

            // Execute each function call and feed back to Gemini
            const toolResponseParts: any[] = [];
            for (const callPart of functionCalls) {
                const call = callPart.functionCall;
                const toolName = call.name;
                const toolArgs = call.args || {};

                if (onStatusUpdate) {
                    onStatusUpdate(`Querying USD API: ${toolName}...`);
                }

                try {
                    const result = await this.executeTool(toolName, toolArgs);
                    executedTools.push({ name: toolName, args: toolArgs, result });
                    toolResponseParts.push({
                        functionResponse: {
                            name: toolName,
                            response: { output: result }
                        }
                    });
                } catch (toolError: any) {
                    console.error(`Tool execution error for ${toolName}:`, toolError);
                    toolResponseParts.push({
                        functionResponse: {
                            name: toolName,
                            response: { error: toolError?.message || String(toolError) }
                        }
                    });
                }
            }

            // Append function execution results to conversation history
            this.conversationHistory.push({
                role: 'user',
                parts: toolResponseParts
            });

            if (onStatusUpdate) {
                onStatusUpdate('Synthesizing mechanical analysis...');
            }
        }

        return {
            text: 'Completed tool queries.',
            executedTools
        };
    }
}
