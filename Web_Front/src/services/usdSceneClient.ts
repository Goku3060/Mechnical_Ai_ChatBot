import { AppStreamer, ApplicationMessage } from '@nvidia/ov-web-rtc';

export interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeout: number;
}

export class UsdSceneClient {
    private pendingRequests = new Map<string, PendingRequest>();

    /**
     * Handles incoming custom WebRTC events from the streaming Kit application.
     */
    public handleCustomEvent(message: any) {
        if (!message) return;
        const eventType = message.event_type;
        const payload = message.payload;

        if (this.pendingRequests.has(eventType)) {
            const req = this.pendingRequests.get(eventType)!;
            clearTimeout(req.timeout);
            this.pendingRequests.delete(eventType);
            req.resolve(payload);
        }
    }

    /**
     * Sends a request to Kit and waits for the corresponding response event.
     */
    public async request(requestType: string, responseType: string, payload: Record<string, unknown> = {}, timeoutMs = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                this.pendingRequests.delete(responseType);
                reject(new Error(`Timeout waiting for '${responseType}' after ${timeoutMs}ms. Ensure Kit streaming is running with the messaging extension.`));
            }, timeoutMs);

            this.pendingRequests.set(responseType, { resolve, reject, timeout });

            const msg: ApplicationMessage = {
                event_type: requestType,
                payload
            };

            AppStreamer.sendMessage(msg).catch((err) => {
                clearTimeout(timeout);
                this.pendingRequests.delete(responseType);
                reject(err);
            });
        });
    }

    /**
     * Queries high-level stage metadata, units, assemblies, and total component counts.
     */
    public async getSceneSummary() {
        return this.request('getSceneSummaryRequest', 'getSceneSummaryResponse');
    }

    /**
     * Queries the mechanical part hierarchy starting from root_path.
     */
    public async getAssemblyHierarchy(rootPath?: string, maxDepth = 4) {
        return this.request('getAssemblyHierarchyRequest', 'getAssemblyHierarchyResponse', {
            root_path: rootPath || '/World/Disc_Brake_Assembly',
            max_depth: maxDepth
        });
    }

    /**
     * Inspects a specific prim path for transforms, mesh details, and bound materials.
     */
    public async inspectPrim(primPath: string) {
        return this.request('inspectPrimRequest', 'inspectPrimResponse', {
            prim_path: primPath
        });
    }

    /**
     * Lists all materials defined in /World/Looks and the prims bound to them.
     */
    public async listMaterials() {
        return this.request('listMaterialsRequest', 'listMaterialsResponse');
    }

    /**
     * Searches prims across the stage by keyword or type.
     */
    public async searchPrims(query: string, primType?: string) {
        return this.request('searchPrimsRequest', 'searchPrimsResponse', {
            query,
            prim_type: primType
        });
    }

    /**
     * Computes physical bounding box and millimeter dimensions for a prim.
     */
    public async getPartDimensions(primPath: string) {
        return this.request('getPartDimensionsRequest', 'getPartDimensionsResponse', {
            prim_path: primPath
        });
    }

    /**
     * Sets visibility (show/hide) for a prim or subassembly.
     */
    public async setPartVisibility(primPath: string, visible: boolean) {
        return this.request('setPartVisibilityRequest', 'setPartVisibilityResponse', {
            prim_path: primPath,
            visible
        });
    }

    /**
     * Frames/focuses the active viewport camera directly on a prim.
     */
    public async focusPrim(primPath: string, zoom = 1.0) {
        return this.request('focusPrimRequest', 'focusPrimResponse', {
            prim_path: primPath,
            zoom
        });
    }

    /**
     * Resets the stage camera back to the initial viewpoint.
     */
    public async resetCamera() {
        return this.request('resetStage', 'resetStageResponse');
    }

    /**
     * Binds an existing material to a prim or mesh on the live USD stage.
     */
    public async bindMaterial(primPath: string, materialPath: string) {
        return this.request('bindMaterialRequest', 'bindMaterialResponse', {
            prim_path: primPath,
            material_path: materialPath
        });
    }

    /**
     * Sets the diffuse/base color on an MDL/PBR material in real-time.
     * @param materialPathOrName e.g. "Metal_Yellow_Paint" or "/World/Looks/Metal_Yellow_Paint"
     * @param colorRgb Array of 3 numbers between 0 and 1, e.g. [1.0, 0.0, 0.0] for red
     */
    public async setMaterialColor(materialPathOrName: string, colorRgb: [number, number, number]) {
        return this.request('setMaterialColorRequest', 'setMaterialColorResponse', {
            material_path: materialPathOrName,
            color_rgb: colorRgb
        });
    }

    /**
     * Directly sets the viewport displayColor on a mesh prim (e.g. mesh67_mesh).
     */
    public async setPrimDisplayColor(primPath: string, colorRgb: [number, number, number]) {
        return this.request('setPrimDisplayColorRequest', 'setPrimDisplayColorResponse', {
            prim_path: primPath,
            color_rgb: colorRgb
        });
    }

    /**
     * Executes arbitrary Python OpenUSD code on the live stage (matches Chat USD USDCodeInteractive).
     */
    public async executeUsdCode(code: string) {
        return this.request('executeUsdCodeRequest', 'executeUsdCodeResponse', {
            code
        });
    }

    /**
     * Selects / highlights prims in the active Omniverse viewport.
     */
    public async selectPart(paths: string[]): Promise<void> {
        const msg: ApplicationMessage = {
            event_type: 'selectPrimsRequest',
            payload: { paths }
        };
        await AppStreamer.sendMessage(msg);
    }

    /**
     * Sets the exploded view interpolation factor across the Disc Brake Assembly (0.0 = assembled, 1.0 = fully exploded).
     * @param factor Float between 0.0 and 1.0
     * @param animate If true, Kit server performs 60 FPS smooth cubic easing
     * @param duration Duration in seconds (default 0.8s)
     */
    public async setExplodedView(factor: number, animate = true, duration = 0.8): Promise<any> {
        return this.request('setExplodedViewRequest', 'setExplodedViewResponse', {
            factor: Math.max(0, Math.min(1, factor)),
            animate,
            duration
        });
    }

    /**
     * Queries the current exploded view factor, step progress, and rotor kinematics state.
     */
    public async getExplodedViewState(): Promise<any> {
        return this.request('getExplodedViewStateRequest', 'getExplodedViewStateResponse');
    }

    /**
     * Toggles continuous mechanical rotation of the brake rotor disc at a given RPM.
     */
    public async setRotorKinematics(enabled: boolean, rpm = 120): Promise<any> {
        return this.request('setRotorKinematicsRequest', 'setRotorKinematicsResponse', {
            enabled,
            rpm
        });
    }

    /**
     * Applies selective mechanical disassembly or assembly to a specific component group:
     * 'bolts' | 'caliper' | 'pads' | 'hub' | 'step_explode' | 'step_assemble' | 'all' | 'reset'.
     * @param step Target component group or sequence action
     * @param progress 1.0 for exploded, 0.0 for assembled in place
     * @param animate If true, smoothly eases at 60 FPS on the server
     * @param duration Animation duration in seconds (default 0.8s)
     * @param action Optional explicit 'assemble' or 'disassemble'
     */
    public async disassembleStep(step: string, progress = 1.0, animate = true, duration = 0.8, action?: string): Promise<any> {
        return this.request('disassembleStepRequest', 'disassembleStepResponse', {
            step,
            progress: Math.max(0, Math.min(1, progress)),
            animate,
            duration,
            action: action || (progress <= 0.0 ? 'assemble' : 'disassemble')
        });
    }

    /**
     * Assembles a specific component back into place with smooth 60 FPS animation.
     */
    public async assembleStep(step: string, animate = true, duration = 0.8): Promise<any> {
        return this.disassembleStep(step, 0.0, animate, duration, 'assemble');
    }

    /**
     * Explodes a specific component outwards with smooth 60 FPS animation.
     */
    public async explodeStep(step: string, animate = true, duration = 0.8): Promise<any> {
        return this.disassembleStep(step, 1.0, animate, duration, 'disassemble');
    }

    /**
     * Explodes the next component in sequential mechanical order ('bolts' -> 'caliper' -> 'pads' -> 'hub').
     */
    public async stepExplodeNext(animate = true): Promise<any> {
        return this.disassembleStep('step_explode', 1.0, animate);
    }

    /**
     * Assembles the next component back into place in reverse mechanical order ('hub' -> 'pads' -> 'caliper' -> 'bolts').
     */
    public async stepAssembleNext(animate = true): Promise<any> {
        return this.disassembleStep('step_assemble', 0.0, animate);
    }

    /**
     * Resets and smoothly reassembles all components back into resting assembled state.
     */
    public async resetAssembly(animate = true, duration = 0.8): Promise<any> {
        return this.setExplodedView(0.0, animate, duration);
    }

    /**
     * Retrieves the authoritative engineering Bill of Materials (BOM) including live dimensions, materials, and pricing.
     */
    public async getBillOfMaterials(): Promise<any> {
        return this.request('getBillOfMaterialsRequest', 'getBillOfMaterialsResponse');
    }

    /**
     * Computes real-time 3D bounding centers of components projected into screen percentage coordinates (0% to 100%).
     */
    public async getSpatialCallouts(): Promise<any> {
        return this.request('getSpatialCalloutsRequest', 'getSpatialCalloutsResponse');
    }
}
