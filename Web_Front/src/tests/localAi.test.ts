import { strictEqual, ok } from 'node:assert';
import { convertToOpenAiTools } from '../services/localAiService';
import { GEMINI_USD_TOOLS } from '../services/geminiService';

describe('Local AI & Nemotron Tool Calling Integration', () => {
    it('converts all 18 Gemini CAD tools to OpenAI JSON Schema specification', () => {
        const openAiTools = convertToOpenAiTools(GEMINI_USD_TOOLS);
        strictEqual(openAiTools.length, 18);

        for (const tool of openAiTools) {
            strictEqual(tool.type, 'function');
            ok(tool.function.name, 'Function must have a name');
            ok(tool.function.description, 'Function must have a description');
            strictEqual(typeof tool.function.parameters, 'object');
            strictEqual(tool.function.parameters.type, 'object', 'Parameter type must be lowercase object');
        }
    });

    it('verifies essential CAD functions exist in the converted tool definitions', () => {
        const openAiTools = convertToOpenAiTools(GEMINI_USD_TOOLS);
        const names = openAiTools.map((t) => t.function.name);

        ok(names.includes('get_scene_summary'));
        ok(names.includes('search_parts'));
        ok(names.includes('get_part_dimensions'));
        ok(names.includes('set_material_color'));
        ok(names.includes('set_exploded_view'));
        ok(names.includes('set_rotor_kinematics'));
        ok(names.includes('disassemble_component'));
        ok(names.includes('get_bill_of_materials'));
    });
});
