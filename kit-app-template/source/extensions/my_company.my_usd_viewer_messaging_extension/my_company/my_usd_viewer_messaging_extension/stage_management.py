# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

import time
import traceback

from pxr import UsdGeom, Usd, UsdShade, Gf, Sdf, Vt

import carb
import carb.dictionary
import carb.events
import omni.usd
import omni.kit.app
import omni.kit.commands
import omni.kit.livestream.messaging as messaging

try:
    from omni.kit.livestream.messaging.large._extension import register_observed_event_type
except Exception:
    register_observed_event_type = None

from carb.eventdispatcher import get_eventdispatcher
from omni.kit.viewport.utility import get_active_viewport_camera_string


def _safe_get_payload(event):
    if not hasattr(event, "payload") or event.payload is None:
        return {}
    if isinstance(event.payload, carb.dictionary.Item):
        return event.payload.get_dict()
    if hasattr(event.payload, "items"):
        return dict(event.payload)
    return {}


def _get_prim_material_name(prim):
    try:
        binding = UsdShade.MaterialBindingAPI(prim)
        mat = binding.GetDirectBinding().GetMaterial()
        if mat and mat.GetPrim().IsValid():
            return mat.GetPrim().GetName()
    except Exception:
        pass
    return None


def _get_prim_transform(prim):
    try:
        xformable = UsdGeom.Xformable(prim)
        if xformable:
            local_xform = xformable.GetLocalTransformation()
            translate = local_xform.ExtractTranslation()
            return {
                "translate": [round(translate[0], 3), round(translate[1], 3), round(translate[2], 3)],
            }
    except Exception:
        pass
    return {}


DISASSEMBLY_OFFSETS = {
    # Mounting Bolts: Retract vertically upward (+12 cm world) and follow caliper radially (+16 X, +26 Z world)
    "/World/Disc_Brake_Assembly/occurrence_of_Mounting_Bolt": {
        "delta_t": [0.16, -0.26, 0.12],
        "step": "bolts",
    },
    "/World/Disc_Brake_Assembly/occurrence_of_Mounting_Bolt_001": {
        "delta_t": [0.16, -0.26, 0.12],
        "step": "bolts",
    },
    # Brake Caliper: Slides horizontally out to the left (+16 X, +26 Z world) and lifts above the table (+6 cm Y world)
    "/World/Disc_Brake_Assembly/occurrence_of_Brake_Caliper": {
        "delta_t": [0.16, -0.26, 0.06],
        "step": "caliper",
    },
    # Caliper Mount: Sits between caliper and rotor disc, elevated above the table (+5 cm Y world)
    "/World/Disc_Brake_Assembly/occurrence_of_Caliper_Mount": {
        "delta_t": [0.10, -0.16, 0.05],
        "step": "caliper",
    },
    # Inboard Brake Pad: Lifts up (+8 cm Y world) and floats over the caliper mount
    "/World/Disc_Brake_Assembly/occurrence_of_brake_pads": {
        "delta_t": [0.10, -0.16, 0.08],
        "step": "pads",
    },
    # Outboard Brake Pad: Separates cleanly above table level (+3 cm Y world)
    "/World/Disc_Brake_Assembly/occurrence_of_brake_pads_001": {
        "delta_t": [0.08, -0.13, 0.03],
        "step": "pads",
    },
    # Rotor Disc: Remains seated flat on top of the table (0 cm world delta)
    "/World/Disc_Brake_Assembly/occurrence_of_rotor_disc": {
        "delta_t": [0.0, 0.0, 0.0],
        "step": "rotor",
    },
    # Wheel Hub & Studs: Centered in rotor disc, elevates clearly upwards (+16 cm Y world, +7 cm clearance above rotor top)
    "/World/Disc_Brake_Assembly/occurrence_of_hub_and_studs": {
        "delta_t": [0.0, 0.0, 0.16],
        "step": "hub",
    },
}


BILL_OF_MATERIALS_SPEC = {
    "/World/Disc_Brake_Assembly/occurrence_of_Brake_Caliper": {
        "item_no": 1,
        "name": "Twin-Piston Brake Caliper",
        "part_number": "OEM-BRK-CAL-4092",
        "category": "Hydraulics",
        "material": "6061-T6 Billet Aluminum",
        "material_spec": "ASTM B221 / High-Temp Lacquer",
        "torque_nm": "35 N·m (Slide Pins)",
        "qty": 1,
        "unit_price": 185.00,
        "stock_status": "In Stock",
        "weight_kg": 4.85,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_Caliper_Mount": {
        "item_no": 2,
        "name": "Caliper Mounting Bracket",
        "part_number": "OEM-BRK-MNT-1084",
        "category": "Structural",
        "material": "Ductile Cast Iron",
        "material_spec": "ASTM A536 65-45-12 / Anodized",
        "torque_nm": "115 N·m (Knuckle Mount)",
        "qty": 1,
        "unit_price": 65.00,
        "stock_status": "In Stock",
        "weight_kg": 2.90,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_brake_pads": {
        "item_no": 3,
        "name": "Inboard Brake Pad",
        "part_number": "OEM-BRK-PAD-8812-IN",
        "category": "Friction",
        "material": "Ceramic Composite Compound",
        "material_spec": "SAE J661 / Powder Coated Steel Backing",
        "torque_nm": "N/A (Floating in Bracket)",
        "qty": 1,
        "unit_price": 42.50,
        "stock_status": "In Stock",
        "weight_kg": 0.85,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_brake_pads_001": {
        "item_no": 4,
        "name": "Outboard Brake Pad",
        "part_number": "OEM-BRK-PAD-8812-OUT",
        "category": "Friction",
        "material": "Ceramic Composite Compound",
        "material_spec": "SAE J661 / Powder Coated Steel Backing",
        "torque_nm": "N/A (Floating in Bracket)",
        "qty": 1,
        "unit_price": 42.50,
        "stock_status": "In Stock",
        "weight_kg": 0.85,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_rotor_disc": {
        "item_no": 5,
        "name": "Ventilated Rotor Disc",
        "part_number": "OEM-BRK-ROT-3120",
        "category": "Rotational Heat Sink",
        "material": "Class 30 Gray Cast Iron",
        "material_spec": "SAE J431 G3000 / Dynamic Balanced",
        "torque_nm": "N/A (Axle Hub Centered)",
        "qty": 1,
        "unit_price": 110.00,
        "stock_status": "In Stock",
        "weight_kg": 7.40,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_hub_and_studs": {
        "item_no": 6,
        "name": "Wheel Hub & Studs Assembly",
        "part_number": "OEM-WHL-HUB-5011",
        "category": "Drive Interface",
        "material": "Forged 4140 Chromoly Steel",
        "material_spec": "AISI 4140 Quenched & Tempered",
        "torque_nm": "140 N·m (Lug Nuts)",
        "qty": 1,
        "unit_price": 95.00,
        "stock_status": "In Stock",
        "weight_kg": 4.10,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_Mounting_Bolt": {
        "item_no": 7,
        "name": "Mounting Bolt (Upper)",
        "part_number": "OEM-FST-BLT-M12-01",
        "category": "Fastener",
        "material": "Grade 10.9 High-Tensile Steel",
        "material_spec": "ISO 898-1 / Zinc Flake Coated",
        "torque_nm": "115 N·m",
        "qty": 1,
        "unit_price": 6.00,
        "stock_status": "In Stock",
        "weight_kg": 0.12,
    },
    "/World/Disc_Brake_Assembly/occurrence_of_Mounting_Bolt_001": {
        "item_no": 8,
        "name": "Mounting Bolt (Lower)",
        "part_number": "OEM-FST-BLT-M12-02",
        "category": "Fastener",
        "material": "Grade 10.9 High-Tensile Steel",
        "material_spec": "ISO 898-1 / Zinc Flake Coated",
        "torque_nm": "115 N·m",
        "qty": 1,
        "unit_price": 6.00,
        "stock_status": "In Stock",
        "weight_kg": 0.12,
    },
}



class StageManager:
    """This class manages the stage and its related events."""
    def __init__(self):
        # Internal messaging state
        self._is_external_update: bool = False
        self._camera_attrs = {}
        self._subscriptions = []

        # Kinematics & Exploded View state
        self._rotor_kinematics_enabled: bool = False
        self._rotor_rpm: float = 120.0
        self._rotor_current_angle: float = 6.8072
        self._rotor_base_angle: float = 6.8072
        self._kinematics_sub = None
        self._exploded_factor: float = 0.0
        self._base_transforms: dict = {}
        self._step_progress: dict = {"bolts": 0.0, "caliper": 0.0, "pads": 0.0, "rotor": 0.0, "hub": 0.0}
        self._start_step_progress: dict = {"bolts": 0.0, "caliper": 0.0, "pads": 0.0, "rotor": 0.0, "hub": 0.0}
        self._target_step_progress: dict = {"bolts": 0.0, "caliper": 0.0, "pads": 0.0, "rotor": 0.0, "hub": 0.0}

        # 60 FPS Native smooth animation state
        self._is_animating: bool = False
        self._anim_start_time: float = 0.0
        self._anim_duration: float = 0.8
        self._anim_start_factor: float = 0.0
        self._anim_target_factor: float = 0.0

        # -- register outgoing events/messages
        outgoing = [
            # notify when user selects something in the viewport.
            "stageSelectionChanged",
            # response to request for children of a prim
            "getChildrenResponse",
            # response to request for primitive being pickable.
            "makePrimsPickableResponse",
            # response to the request to reset camera attributes
            "resetStageResponse",
            # SceneInfo USD Scene API responses for AI Chatbot
            "getSceneSummaryResponse",
            "getAssemblyHierarchyResponse",
            "inspectPrimResponse",
            "listMaterialsResponse",
            "searchPrimsResponse",
            "getPartDimensionsResponse",
            "setPartVisibilityResponse",
            "focusPrimResponse",
            # Write access responses for materials and stage modifications
            "bindMaterialResponse",
            "setMaterialColorResponse",
            "setPrimDisplayColorResponse",
            "executeUsdCodeResponse",
            # Exploded View and Kinematics responses
            "setExplodedViewResponse",
            "getExplodedViewStateResponse",
            "setRotorKinematicsResponse",
            "disassembleStepResponse",
            # Spatial Callouts & BOM responses
            "getBillOfMaterialsResponse",
            "getSpatialCalloutsResponse",
        ]

        for o in outgoing:
            messaging.register_event_type_to_send(o)
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(o),
                o,
            )

        # -- register incoming events/messages
        incoming = {
            # request to get children of a prim
            'getChildrenRequest': self._on_get_children,
            # request to select a prim
            'selectPrimsRequest': self._on_select_prims,
            # request to make primitives pickable
            'makePrimsPickable': self._on_make_pickable,
            # request to make primitives pickable
            'resetStage': self._on_reset_camera,
            # SceneInfo USD Scene API requests for AI Chatbot
            'getSceneSummaryRequest': self._on_get_scene_summary,
            'getAssemblyHierarchyRequest': self._on_get_assembly_hierarchy,
            'inspectPrimRequest': self._on_inspect_prim,
            'listMaterialsRequest': self._on_list_materials,
            'searchPrimsRequest': self._on_search_prims,
            'getPartDimensionsRequest': self._on_get_part_dimensions,
            'setPartVisibilityRequest': self._on_set_part_visibility,
            'focusPrimRequest': self._on_focus_prim,
            # Write access requests for materials and stage modifications
            'bindMaterialRequest': self._on_bind_material,
            'setMaterialColorRequest': self._on_set_material_color,
            'setPrimDisplayColorRequest': self._on_set_prim_display_color,
            'executeUsdCodeRequest': self._on_execute_usd_code,
            # Exploded View and Kinematics requests
            'setExplodedViewRequest': self._on_set_exploded_view,
            'getExplodedViewStateRequest': self._on_get_exploded_view_state,
            'setRotorKinematicsRequest': self._on_set_rotor_kinematics,
            'disassembleStepRequest': self._on_disassemble_step,
            # Spatial Callouts & BOM requests
            'getBillOfMaterialsRequest': self._on_get_bill_of_materials,
            'getSpatialCalloutsRequest': self._on_get_spatial_callouts,
        }

        ed = get_eventdispatcher()
        for event_type, handler in incoming.items():
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(event_type),
                event_type,
            )
            if register_observed_event_type:
                try:
                    register_observed_event_type(event_type)
                except Exception:
                    pass
            self._subscriptions.append(
                ed.observe_event(
                    observer_name=f"StageManager:{event_type}",
                    event_name=event_type,
                    on_event=handler,
                )
            )

        # -- subscribe to stage events
        usd_context = omni.usd.get_context()
        self._subscriptions.append(
            ed.observe_event(
                observer_name="StageManager:StageOpened",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.ASSETS_LOADED),
                on_event=self._on_stage_event_opened,
            )
        )
        self._subscriptions.append(
            ed.observe_event(
                observer_name="StageManager:SelectionChanged",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.SELECTION_CHANGED),
                on_event=self._on_stage_event_selection_changed,
            )
        )

    def get_children(self, prim_path, filters=None):
        """
        Collect any children of the given `prim_path`, potentially filtered by `filters`
        """
        stage = omni.usd.get_context().get_stage()
        prim = stage.GetPrimAtPath(prim_path)
        if not prim:
            return []

        filter_types = {
            "USDGeom": UsdGeom.Mesh,
            "mesh": UsdGeom.Mesh,
            "xform": UsdGeom.Xform,
            "scope": UsdGeom.Scope,
        }

        children = []
        for child in prim.GetChildren():
            # If a child doesn't pass any filter, we skip it.
            if filters is not None:
                if isinstance(filters, carb.dictionary.Item):
                    filters = filters.get_dict()
                if not any(child.IsA(filter_types[filt]) for filt in filters if filt in filter_types):
                    continue

            child_name = child.GetName()
            child_path = str(prim.GetPath())
            # Skipping over cameras
            if child_name.startswith('OmniverseKit_'):
                continue
            # Also skipping rendering primitives.
            if prim_path == '/' and child_name == 'Render':
                continue
            child_path = child_path if child_path != '/' else ''
            carb.log_info(f'child_path: {child_path}')
            info = {"name": child_name, "path": f'{child_path}/{child_name}'}

            # We return an empty list here to indicate that children are
            # available, but the current app does not support pagination,
            # so we use this to lazy load the stage tree.
            if child.GetChildren():
                info["children"] = []

            children.append(info)

        return children

    def _on_get_children(self, event: carb.events.IEvent) -> None:
        """
        Handler for the `getChildrenRequest` event
        Collects a filtered collection of a given primitives children.
        """

        carb.log_info(
            "Received message to return list of a prim\'s children"
        )
        children = self.get_children(
            prim_path=event.payload["prim_path"],
            filters=event.payload["filters"]
        )
        payload = {
            "prim_path": event.payload["prim_path"],
            "children": children
        }


        get_eventdispatcher().dispatch_event("getChildrenResponse", payload=payload)

    def _on_select_prims(self, event: carb.events.IEvent) -> None:
        """
        Handler for `selectPrimsRequest` event.

        Selects the given primitives.
        """
        new_selection = []
        if "paths" in event.payload:
            if isinstance(event.payload["paths"], carb.dictionary.Item):
                new_selection = list(event.payload["paths"].get_dict())
            else:
                new_selection = list(event.payload["paths"])
            carb.log_info(f"Received message to select '{new_selection}'")
        # Flagging this as an external event because it
        # was initiated by the client.
        self._is_external_update = True
        sel = omni.usd.get_context().get_selection()
        sel.clear_selected_prim_paths()
        sel.set_selected_prim_paths(new_selection, True)

    def _on_stage_event_opened(self, event):
        stage = omni.usd.get_context().get_stage()
        stage_url = stage.GetRootLayer().identifier if stage else ''

        if stage_url:
            # Clear before using, so that we're sure the data is only
            # from the new stage.
            self._camera_attrs.clear()
            # Capture the active camera's camera data, used to reset
            # the scene to a known good state.
            ctx = omni.usd.get_context()
            if (prim := ctx.get_stage().GetPrimAtPath(get_active_viewport_camera_string())):
                for attr in prim.GetAttributes():
                    self._camera_attrs[attr.GetName()] = attr.Get()

    def _on_stage_event_selection_changed(self, event):
        # If the selection changed came from an external event,
        # we don't need to let the streaming client know because it
        # initiated the change and is already aware.
        if self._is_external_update:
            self._is_external_update = False
        else:
            payload = {"prims": omni.usd.get_context().get_selection().
                        get_selected_prim_paths()}

            get_eventdispatcher().dispatch_event("stageSelectionChanged", payload=payload)
            carb.log_info(f"Selection changed: Path to USD prims currently selected = {omni.usd.get_context().get_selection().get_selected_prim_paths()}")

    def _on_reset_camera(self, event: carb.events.IEvent):
        """
        Handler for `resetStage` event.

        Resets the camera back to values collected when the stage was opened.
        A success message is sent if all attributes are succesfully reset, and error message is set otherwise.
        """
        ctx = omni.usd.get_context()
        stage = ctx.get_stage()
        try:
            # Reset the camera.
            # The camera lives on the session layer, which has a higher
            # opinion than the root stage. So we need to explicitly target
            # the session layer when resetting the camera's attributes.
            camera_prim = ctx.get_stage().GetPrimAtPath(
                get_active_viewport_camera_string()
            )
            edit_context = Usd.EditContext(
                stage, Usd.EditTarget(stage.GetSessionLayer())
            )
            with edit_context:
                for name, value in self._camera_attrs.items():
                    attr = camera_prim.GetAttribute(name)
                    attr.Set(value)
        except Exception as e:
            payload = {"result": "error", "error": str(e)}
        else:
            payload = {"result": "success", "error": ""}

        get_eventdispatcher().dispatch_event("resetStageResponse", payload=payload)

    def _on_make_pickable(self, event: carb.events.IEvent):
        """
        Handler for `makePrimsPickable` event.

        Adds the provided primitives to the set of selectable objects in the viewport.
        Sends 'makePrimsPickableResponse' back to streamer with
        current success status.

        An empty or missing "paths" key is treated as a clean no-op so a client
        sending `{"type": "makePrimsPickable", "payload": {}}` cannot cause an
        UnboundLocalError. Any unexpected exception is logged server-side with
        its full traceback and reported to the client only as a generic message
        so internal details (file paths, variable names, stack frames) are not
        leaked to the streaming client.
        """
        # Add the provided paths to the set of pickable prims.
        ctx = omni.usd.get_context()
        # Initialize `paths` BEFORE the try/conditional so a missing or empty
        # "paths" key falls through as a no-op instead of raising
        # UnboundLocalError when the `for path in paths:` loop is reached.
        paths = []
        try:
            if "paths" in event.payload:
                if isinstance(event.payload["paths"], carb.dictionary.Item):
                    paths = list(event.payload["paths"].get_dict())
                else:
                    paths = list(event.payload["paths"])

            for path in paths:
                ctx.set_pickable(path, True)
        except Exception:
            # Log full server-side detail, but return a generic message to the
            # client to avoid leaking internal variable names, file paths or
            # stack frames over the streaming WebSocket.
            carb.log_error(
                f"makePrimsPickable handler failed: {traceback.format_exc()}"
            )
            payload = {"result": "error", "error": "Failed to update pickable prims"}
        else:
            payload = {"result": "success", "error": ""}

        get_eventdispatcher().dispatch_event("makePrimsPickableResponse", payload=payload)

    # -------------------------------------------------------------------------
    # SceneInfo USD Scene API Methods (Mechanical AI Chatbot)
    # -------------------------------------------------------------------------
    def get_scene_summary(self):
        """Returns overall stage metadata, assembly names, and prim counts."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        root_layer = stage.GetRootLayer()
        stage_id = root_layer.identifier if root_layer else ""
        stage_name = stage_id.replace("\\", "/").split("/")[-1] if stage_id else "Unknown"

        up_axis = UsdGeom.GetStageUpAxis(stage)
        meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage)
        default_prim = stage.GetDefaultPrim().GetPath().pathString if stage.GetDefaultPrim() else "/World"

        total_prims = 0
        mesh_count = 0
        xform_count = 0
        material_count = 0
        assemblies = []
        root_components = []

        for prim in stage.Traverse():
            total_prims += 1
            type_name = prim.GetTypeName()
            if type_name == "Mesh":
                mesh_count += 1
            elif type_name == "Xform":
                xform_count += 1
            elif type_name == "Material":
                material_count += 1

        def_prim = stage.GetDefaultPrim()
        if def_prim:
            for child in def_prim.GetChildren():
                child_name = child.GetName()
                if child_name in ["Looks", "Camera", "Environment", "Render"] or child_name.startswith("OmniverseKit_"):
                    continue
                assemblies.append({
                    "name": child_name,
                    "path": str(child.GetPath()),
                    "type": child.GetTypeName()
                })
                for sub in child.GetChildren():
                    sub_name = sub.GetName()
                    if not sub_name.startswith("OmniverseKit_"):
                        root_components.append({
                            "name": sub_name,
                            "path": str(sub.GetPath()),
                            "type": sub.GetTypeName()
                        })

        return {
            "stage_name": stage_name,
            "stage_identifier": stage_id,
            "up_axis": up_axis,
            "meters_per_unit": meters_per_unit,
            "default_prim": default_prim,
            "total_prims": total_prims,
            "mesh_count": mesh_count,
            "xform_count": xform_count,
            "material_count": material_count,
            "assemblies": assemblies,
            "root_components": root_components,
        }

    def get_assembly_hierarchy(self, root_path=None, max_depth=4):
        """Returns the hierarchical mechanical tree starting from root_path."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        if not root_path:
            def_prim = stage.GetDefaultPrim()
            if def_prim:
                for child in def_prim.GetChildren():
                    if child.GetName() not in ["Looks", "Camera", "Environment", "Render"] and not child.GetName().startswith("OmniverseKit_"):
                        root_path = str(child.GetPath())
                        break
            if not root_path:
                root_path = "/World"

        root_prim = stage.GetPrimAtPath(root_path)
        if not root_prim or not root_prim.IsValid():
            return {"error": f"Prim not found at {root_path}"}

        def build_node(prim, current_depth):
            name = prim.GetName()
            path_str = str(prim.GetPath())
            type_name = prim.GetTypeName()
            mat_name = _get_prim_material_name(prim)

            node = {
                "name": name,
                "path": path_str,
                "type": type_name,
            }
            if mat_name:
                node["material"] = mat_name

            if current_depth < max_depth:
                children = []
                for child in prim.GetChildren():
                    c_name = child.GetName()
                    if c_name.startswith("OmniverseKit_") or c_name in ["Render"]:
                        continue
                    children.append(build_node(child, current_depth + 1))
                if children:
                    node["children"] = children
            else:
                child_count = len(prim.GetChildren())
                if child_count > 0:
                    node["has_more_children"] = child_count

            return node

        tree = build_node(root_prim, 1)
        return {"root_path": root_path, "hierarchy": tree}

    def inspect_prim(self, prim_path):
        """Returns detailed properties, mesh counts, and material bindings for a prim."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        if not prim_path:
            return {"error": "prim_path cannot be empty"}

        prim = stage.GetPrimAtPath(prim_path)
        if not prim or not prim.IsValid():
            return {"error": f"Prim not found at path: {prim_path}"}

        mat_name = _get_prim_material_name(prim)
        transform = _get_prim_transform(prim)
        applied_schemas = [str(s) for s in prim.GetAppliedSchemas()]

        details = {
            "name": prim.GetName(),
            "path": str(prim.GetPath()),
            "type": prim.GetTypeName(),
            "is_active": prim.IsActive(),
            "is_defined": prim.IsDefined(),
            "applied_schemas": applied_schemas,
            "material": mat_name,
            "transform": transform,
        }

        if prim.IsA(UsdGeom.Mesh):
            mesh = UsdGeom.Mesh(prim)
            pts_attr = mesh.GetPointsAttr()
            faces_attr = mesh.GetFaceVertexCountsAttr()
            details["mesh_info"] = {
                "vertex_count": len(pts_attr.Get()) if pts_attr.HasValue() else 0,
                "face_count": len(faces_attr.Get()) if faces_attr.HasValue() else 0,
            }

        children = [c.GetName() for c in prim.GetChildren() if not c.GetName().startswith("OmniverseKit_")]
        details["child_count"] = len(children)
        details["children"] = children[:20]

        return details

    def list_materials(self):
        """Returns all materials on the stage and which prims are bound to them."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        materials = []
        for prim in stage.Traverse():
            if prim.GetTypeName() == "Material":
                mat_name = prim.GetName()
                mat_path = str(prim.GetPath())

                bound_prims = []
                for other_prim in stage.Traverse():
                    if _get_prim_material_name(other_prim) == mat_name:
                        bound_prims.append(str(other_prim.GetPath()))

                materials.append({
                    "name": mat_name,
                    "path": mat_path,
                    "bound_prims_count": len(bound_prims),
                    "bound_prims": bound_prims[:10]
                })

        return {"count": len(materials), "materials": materials}

    def _on_get_scene_summary(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received getSceneSummaryRequest")
        try:
            summary = self.get_scene_summary()
            payload = {"result": "success", "summary": summary}
        except Exception as e:
            carb.log_error(f"getSceneSummary handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("getSceneSummaryResponse", payload=payload)

    def _on_get_assembly_hierarchy(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received getAssemblyHierarchyRequest")
        try:
            p = _safe_get_payload(event)
            root_path = p.get("root_path", None)
            max_depth = int(p.get("max_depth", 4)) if p.get("max_depth") else 4
            hierarchy = self.get_assembly_hierarchy(root_path=root_path, max_depth=max_depth)
            payload = {"result": "success", "data": hierarchy}
        except Exception as e:
            carb.log_error(f"getAssemblyHierarchy handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("getAssemblyHierarchyResponse", payload=payload)

    def _on_inspect_prim(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received inspectPrimRequest")
        try:
            p = _safe_get_payload(event)
            prim_path = p.get("prim_path", "")
            details = self.inspect_prim(prim_path)
            payload = {"result": "success", "details": details}
        except Exception as e:
            carb.log_error(f"inspectPrim handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("inspectPrimResponse", payload=payload)

    def _on_list_materials(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received listMaterialsRequest")
        try:
            mats = self.list_materials()
            payload = {"result": "success", "data": mats}
        except Exception as e:
            carb.log_error(f"listMaterials handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("listMaterialsResponse", payload=payload)

    def search_prims(self, query, prim_type=None):
        """Searches prims by keyword and type across the stage (inspired by kit-usd-agents)."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        if not query:
            return {"error": "Query cannot be empty"}

        q_terms = [t.lower() for t in str(query).strip().split() if t.strip()]
        matches = []

        for prim in stage.Traverse():
            name_lower = prim.GetName().lower()
            path_lower = str(prim.GetPath()).lower()
            type_name = prim.GetTypeName()

            if prim_type and type_name.lower() != prim_type.lower():
                continue

            if any(term in name_lower or term in path_lower for term in q_terms):
                if name_lower in ["looks", "camera", "render"] or name_lower.startswith("omniversekit_"):
                    continue

                mat_name = _get_prim_material_name(prim)
                matches.append({
                    "name": prim.GetName(),
                    "path": str(prim.GetPath()),
                    "type": type_name,
                    "material": mat_name
                })

        return {"query": query, "count": len(matches), "matches": matches[:15]}

    def get_part_dimensions(self, prim_path):
        """Computes physical bounding box and dimensions in mm using UsdGeom.BBoxCache."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        prim = stage.GetPrimAtPath(prim_path)
        if not prim or not prim.IsValid():
            return {"error": f"Prim not found at path: {prim_path}"}

        try:
            meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage)
            scale_to_mm = meters_per_unit * 1000.0

            bbox_cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])
            bbox = bbox_cache.ComputeWorldBound(prim)
            range_aligned = bbox.ComputeAlignedRange()

            min_pt = range_aligned.GetMin()
            max_pt = range_aligned.GetMax()
            size = range_aligned.GetSize()

            dim_x_mm = round(size[0] * scale_to_mm, 2)
            dim_y_mm = round(size[1] * scale_to_mm, 2)
            dim_z_mm = round(size[2] * scale_to_mm, 2)

            return {
                "prim_path": prim_path,
                "name": prim.GetName(),
                "unit": "mm",
                "dimensions": {
                    "width_x": dim_x_mm,
                    "height_y": dim_y_mm,
                    "depth_z": dim_z_mm,
                    "formatted": f"{dim_x_mm} x {dim_y_mm} x {dim_z_mm} mm"
                },
                "bounds_min": [round(min_pt[0] * scale_to_mm, 2), round(min_pt[1] * scale_to_mm, 2), round(min_pt[2] * scale_to_mm, 2)],
                "bounds_max": [round(max_pt[0] * scale_to_mm, 2), round(max_pt[1] * scale_to_mm, 2), round(max_pt[2] * scale_to_mm, 2)],
            }
        except Exception as e:
            return {"error": f"Failed to compute bounding box: {str(e)}"}

    def set_part_visibility(self, prim_path, visible=True):
        """Shows or hides a prim using UsdGeom.Imageable."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        prim = stage.GetPrimAtPath(prim_path)
        if not prim or not prim.IsValid():
            return {"error": f"Prim not found at: {prim_path}"}

        try:
            imageable = UsdGeom.Imageable(prim)
            if visible:
                imageable.MakeVisible()
            else:
                imageable.MakeInvisible()
            return {"status": "success", "prim_path": prim_path, "visible": visible}
        except Exception as e:
            return {"error": f"Failed to set visibility: {str(e)}"}

    def _on_search_prims(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received searchPrimsRequest")
        try:
            p = _safe_get_payload(event)
            query = str(p.get("query", ""))
            prim_type = p.get("prim_type", None)
            res = self.search_prims(query, prim_type)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"searchPrims handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("searchPrimsResponse", payload=payload)

    def _on_get_part_dimensions(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received getPartDimensionsRequest")
        try:
            p = _safe_get_payload(event)
            prim_path = str(p.get("prim_path", ""))
            res = self.get_part_dimensions(prim_path)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"getPartDimensions handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("getPartDimensionsResponse", payload=payload)

    def _on_set_part_visibility(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received setPartVisibilityRequest")
        try:
            p = _safe_get_payload(event)
            prim_path = str(p.get("prim_path", ""))
            visible = bool(p.get("visible", True))
            res = self.set_part_visibility(prim_path, visible)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"setPartVisibility handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("setPartVisibilityResponse", payload=payload)

    def focus_prim(self, prim_path, zoom=1.0):
        """Focuses and frames the viewport camera on a prim (inspired by kit-usd-agents navigation)."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        prim = stage.GetPrimAtPath(prim_path)
        if not prim or not prim.IsValid():
            return {"error": f"Prim not found at {prim_path}"}

        # 1. Update selection in Kit
        self._is_external_update = True
        sel = omni.usd.get_context().get_selection()
        sel.clear_selected_prim_paths()
        sel.set_selected_prim_paths([prim_path], True)

        # 2. Frame prim using Kit command if viewport camera is available
        cam_str = get_active_viewport_camera_string()
        framed = False
        try:
            omni.kit.commands.execute(
                "FramePrimsCommand",
                prim_to_move=cam_str,
                prims_to_frame=[prim_path],
                zoom=float(zoom)
            )
            framed = True
        except Exception as e:
            carb.log_warn(f"FramePrimsCommand note: {e}")

        return {
            "status": "success",
            "prim_path": prim_path,
            "name": prim.GetName(),
            "camera": cam_str,
            "framed": framed,
            "selected": True
        }

    def _on_focus_prim(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received focusPrimRequest")
        try:
            p = _safe_get_payload(event)
            prim_path = str(p.get("prim_path", ""))
            zoom = float(p.get("zoom", 1.0)) if p.get("zoom") is not None else 1.0
            res = self.focus_prim(prim_path, zoom)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"focusPrim handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("focusPrimResponse", payload=payload)

    def bind_material(self, prim_path, material_path_or_name):
        """Binds an existing material to a prim/mesh on the live stage."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        prim = stage.GetPrimAtPath(prim_path)
        if not prim or not prim.IsValid():
            return {"error": f"Target prim not found: {prim_path}"}

        mat_path = material_path_or_name
        mat_prim = None
        if not mat_path.startswith("/"):
            cand = stage.GetPrimAtPath(f"/World/Looks/{mat_path}")
            if cand and cand.IsValid() and cand.GetTypeName() == "Material":
                mat_prim = cand
                mat_path = str(cand.GetPath())
            else:
                for p in stage.Traverse():
                    if p.GetTypeName() == "Material" and p.GetName().lower() == material_path_or_name.lower():
                        mat_prim = p
                        mat_path = str(p.GetPath())
                        break
        else:
            mat_prim = stage.GetPrimAtPath(mat_path)

        if not mat_prim or not mat_prim.IsValid():
            return {"error": f"Material not found: {material_path_or_name}"}

        try:
            material = UsdShade.Material(mat_prim)
            binding_api = UsdShade.MaterialBindingAPI.Apply(prim)
            binding_api.Bind(material, bindingStrength=UsdShade.Tokens.strongerThanDescendants)
            return {
                "status": "success",
                "prim_path": prim_path,
                "bound_material": mat_path,
                "material_name": mat_prim.GetName()
            }
        except Exception as e:
            return {"error": f"Failed to bind material: {str(e)}"}

    def set_material_color(self, material_path_or_name, color_rgb):
        """Sets diffuse/base color on a material or shader (RGB list [r, g, b] 0.0-1.0)."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        mat_path = material_path_or_name
        mat_prim = None
        if not mat_path.startswith("/"):
            cand = stage.GetPrimAtPath(f"/World/Looks/{mat_path}")
            if cand and cand.IsValid() and cand.GetTypeName() == "Material":
                mat_prim = cand
                mat_path = str(cand.GetPath())
            else:
                for p in stage.Traverse():
                    if p.GetTypeName() == "Material" and p.GetName().lower() == material_path_or_name.lower():
                        mat_prim = p
                        mat_path = str(p.GetPath())
                        break
        else:
            mat_prim = stage.GetPrimAtPath(mat_path)

        if not mat_prim or not mat_prim.IsValid():
            return {"error": f"Material not found: {material_path_or_name}"}

        try:
            r, g, b = float(color_rgb[0]), float(color_rgb[1]), float(color_rgb[2])
            vec3_color = Gf.Vec3f(r, g, b)

            target_prims = [mat_prim]
            for child in mat_prim.GetChildren():
                if child.GetTypeName() == "Shader" or child.GetName() in ["Shader", "PreviewSurface"]:
                    target_prims.append(child)

            updated_attrs = []
            color_param_names = [
                "inputs:diffuse_color_constant",
                "inputs:diffuse_color",
                "inputs:base_color",
                "inputs:color",
                "inputs:diffuse_tint",
            ]

            for prim in target_prims:
                found_existing = False
                for param in color_param_names:
                    attr = prim.GetAttribute(param)
                    if attr and attr.IsValid():
                        attr.Set(vec3_color)
                        updated_attrs.append(f"{prim.GetName()}.{param}")
                        found_existing = True
                if not found_existing and prim.GetTypeName() == "Shader":
                    attr = prim.CreateAttribute("inputs:diffuse_color_constant", Sdf.ValueTypeNames.Color3f)
                    if attr:
                        attr.Set(vec3_color)
                        updated_attrs.append(f"{prim.GetName()}.inputs:diffuse_color_constant")

            bound_count = 0
            for prim in stage.Traverse():
                if _get_prim_material_name(prim) == mat_prim.GetName():
                    gprim = UsdGeom.Gprim(prim)
                    if gprim:
                        gprim.GetDisplayColorAttr().Set(Vt.Vec3fArray([vec3_color]))
                        bound_count += 1

            return {
                "status": "success",
                "material": mat_path,
                "color_rgb": [r, g, b],
                "updated_attributes": updated_attrs,
                "updated_bound_meshes": bound_count
            }
        except Exception as e:
            return {"error": f"Failed to set material color: {str(e)}"}

    def set_prim_display_color(self, prim_path, color_rgb):
        """Directly sets viewport displayColor on a mesh prim (RGB [r, g, b] 0.0-1.0)."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        prim = stage.GetPrimAtPath(prim_path)
        if not prim or not prim.IsValid():
            return {"error": f"Prim not found: {prim_path}"}

        try:
            r, g, b = float(color_rgb[0]), float(color_rgb[1]), float(color_rgb[2])
            vec3_color = Gf.Vec3f(r, g, b)
            gprim = UsdGeom.Gprim(prim)
            if gprim:
                gprim.GetDisplayColorAttr().Set(Vt.Vec3fArray([vec3_color]))
                return {"status": "success", "prim_path": prim_path, "display_color": [r, g, b]}
            else:
                return {"error": f"Prim at {prim_path} is not a UsdGeom.Gprim"}
        except Exception as e:
            return {"error": f"Failed to set display color: {str(e)}"}

    def execute_usd_code(self, code):
        """Executes custom Python OpenUSD code on the live stage."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        try:
            exec_globals = {
                "omni": omni,
                "stage": stage,
                "Usd": Usd,
                "UsdGeom": UsdGeom,
                "UsdShade": UsdShade,
                "Gf": Gf,
                "Sdf": Sdf,
                "Vt": Vt,
                "result": None,
            }
            exec_locals = {}
            exec(code, exec_globals, exec_locals)
            res = exec_locals.get("result", exec_globals.get("result", "Code executed successfully"))
            return {"status": "success", "result": str(res)}
        except Exception as e:
            return {"error": f"USD execution failed: {traceback.format_exc()}"}

    def _on_bind_material(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received bindMaterialRequest")
        try:
            p = _safe_get_payload(event)
            prim_path = str(p.get("prim_path", ""))
            material_path = str(p.get("material_path", ""))
            res = self.bind_material(prim_path, material_path)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"bindMaterial handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("bindMaterialResponse", payload=payload)

    def _on_set_material_color(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received setMaterialColorRequest")
        try:
            p = _safe_get_payload(event)
            mat = str(p.get("material_path", p.get("material_name", "")))
            color = p.get("color_rgb", [1.0, 1.0, 1.0])
            res = self.set_material_color(mat, color)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"setMaterialColor handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("setMaterialColorResponse", payload=payload)

    def _on_set_prim_display_color(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received setPrimDisplayColorRequest")
        try:
            p = _safe_get_payload(event)
            prim_path = str(p.get("prim_path", ""))
            color = p.get("color_rgb", [1.0, 1.0, 1.0])
            res = self.set_prim_display_color(prim_path, color)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"setPrimDisplayColor handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("setPrimDisplayColorResponse", payload=payload)

    def _on_execute_usd_code(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received executeUsdCodeRequest")
        try:
            p = _safe_get_payload(event)
            code = str(p.get("code", ""))
            res = self.execute_usd_code(code)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"executeUsdCode handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("executeUsdCodeResponse", payload=payload)

    def _ensure_base_transforms(self):
        """Caches resting local translation and rotation for all assembly components."""
        if self._base_transforms:
            return
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return

        for prim_path in DISASSEMBLY_OFFSETS.keys():
            prim = stage.GetPrimAtPath(prim_path)
            if not prim or not prim.IsValid():
                continue
            xformable = UsdGeom.Xformable(prim)
            if not xformable:
                continue

            trans_op = None
            rot_op = None
            for op in xformable.GetOrderedXformOps():
                if op.GetOpType() == UsdGeom.XformOp.TypeTranslate:
                    trans_op = op
                elif op.GetOpType() == UsdGeom.XformOp.TypeRotateXYZ:
                    rot_op = op

            if not trans_op:
                trans_op = xformable.AddTranslateOp()
            if not rot_op:
                rot_op = xformable.AddRotateXYZOp()

            t_val = trans_op.Get() or Gf.Vec3d(0.0, 0.0, 0.0)
            r_val = rot_op.Get() or Gf.Vec3f(0.0, 0.0, 0.0)

            self._base_transforms[prim_path] = {
                "trans_op": trans_op,
                "rot_op": rot_op,
                "base_translate": Gf.Vec3d(t_val[0], t_val[1], t_val[2]),
                "base_rotate": Gf.Vec3f(r_val[0], r_val[1], r_val[2]),
            }

        rotor_path = "/World/Disc_Brake_Assembly/occurrence_of_rotor_disc"
        if rotor_path in self._base_transforms:
            r_val = self._base_transforms[rotor_path]["base_rotate"]
            self._rotor_base_angle = float(r_val[2])
            self._rotor_current_angle = self._rotor_base_angle

    DISASSEMBLY_ORDER = ["bolts", "caliper", "pads", "hub"]
    ASSEMBLY_ORDER = ["hub", "pads", "caliper", "bolts"]

    def _ensure_update_subscription(self):
        """Ensures the frame update stream subscription is active for 60 FPS rotor spinning and smooth easing."""
        if not self._kinematics_sub:
            self._kinematics_sub = omni.kit.app.get_app().get_update_event_stream().create_subscription_to_pop(
                self._on_update_stream,
                name="StageManager:UpdateStream",
            )

    def _apply_step_transforms(self):
        """Applies current _step_progress to all cached prim transforms in USD."""
        if not self._base_transforms:
            return
        for prim_path, info in DISASSEMBLY_OFFSETS.items():
            if prim_path not in self._base_transforms:
                continue
            item = self._base_transforms[prim_path]
            base_t = item["base_translate"]
            delta_t = info["delta_t"]
            part_step = info.get("step", "")
            part_progress = self._step_progress.get(part_step, self._exploded_factor)

            new_t = Gf.Vec3d(
                base_t[0] + delta_t[0] * part_progress,
                base_t[1] + delta_t[1] * part_progress,
                base_t[2] + delta_t[2] * part_progress,
            )
            item["trans_op"].Set(new_t)

    def _on_update_stream(self, event: carb.events.IEvent):
        """Per-frame update callback for both continuous rotor spinning and smooth exploded view easing."""
        if not self._rotor_kinematics_enabled and not self._is_animating:
            return

        dt = 1.0 / 60.0
        if hasattr(event, "payload") and event.payload:
            if isinstance(event.payload, carb.dictionary.Item):
                dt = float(event.payload.get_dict().get("dt", dt))
            elif hasattr(event.payload, "get"):
                dt = float(event.payload.get("dt", dt))

        # 1. Rotor spinning kinematics
        if self._rotor_kinematics_enabled:
            rotor_path = "/World/Disc_Brake_Assembly/occurrence_of_rotor_disc"
            if rotor_path in self._base_transforms:
                delta_deg = (self._rotor_rpm * 6.0) * dt
                self._rotor_current_angle = (self._rotor_current_angle + delta_deg) % 360.0
                item = self._base_transforms[rotor_path]
                base_rot = item["base_rotate"]
                new_rot = Gf.Vec3f(base_rot[0], base_rot[1], float(self._rotor_current_angle))
                item["rot_op"].Set(new_rot)

        # 2. Smooth exploded view and step assembly interpolation (60 FPS cubic smoothstep)
        if self._is_animating:
            now = time.time()
            elapsed = now - self._anim_start_time
            t = min(1.0, elapsed / self._anim_duration) if self._anim_duration > 0 else 1.0

            # Smoothstep easing: S(t) = 3t^2 - 2t^3 (zero acceleration at boundaries)
            ease = t * t * (3.0 - 2.0 * t)

            self._exploded_factor = self._anim_start_factor + (self._anim_target_factor - self._anim_start_factor) * ease

            for k in self._step_progress.keys():
                s0 = self._start_step_progress.get(k, 0.0)
                s1 = self._target_step_progress.get(k, 0.0)
                self._step_progress[k] = s0 + (s1 - s0) * ease

            self._apply_step_transforms()

            if t >= 1.0:
                self._is_animating = False
                self._exploded_factor = self._anim_target_factor
                for k in self._step_progress.keys():
                    self._step_progress[k] = self._target_step_progress.get(k, 0.0)
                self._apply_step_transforms()

    def set_exploded_view(self, factor: float, animate: bool = True, duration: float = 0.8):
        """Interpolates local translation for all assembly components between 0 (assembled) and 1 (fully exploded)."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        self._ensure_base_transforms()
        factor = max(0.0, min(1.0, float(factor)))
        duration = max(0.05, float(duration))

        if animate:
            self._anim_duration = duration
            self._anim_start_time = time.time()
            self._anim_start_factor = self._exploded_factor
            self._anim_target_factor = factor
            for k in self._step_progress.keys():
                self._start_step_progress[k] = self._step_progress.get(k, 0.0)
                self._target_step_progress[k] = factor
            self._is_animating = True
            self._ensure_update_subscription()
        else:
            self._is_animating = False
            self._exploded_factor = factor
            self._anim_target_factor = factor
            for k in self._step_progress.keys():
                self._step_progress[k] = factor
                self._target_step_progress[k] = factor
            self._apply_step_transforms()

        return {
            "status": "success",
            "exploded_factor": factor,
            "animated": animate,
            "duration": duration,
            "step_progress": self._target_step_progress,
        }

    def get_exploded_view_state(self):
        """Returns the current exploded factor, step progress, and rotor kinematics state."""
        return {
            "exploded_factor": self._exploded_factor,
            "target_exploded_factor": self._anim_target_factor,
            "is_animating": self._is_animating,
            "kinematics_enabled": self._rotor_kinematics_enabled,
            "rotor_rpm": self._rotor_rpm,
            "step_progress": self._step_progress,
            "target_step_progress": self._target_step_progress,
        }

    def disassemble_step(self, step: str, progress: float = 1.0, animate: bool = True, duration: float = 0.8):
        """Applies selective disassembly or assembly to a specific component group:
        'bolts', 'caliper', 'pads', 'hub', 'step_explode', 'step_assemble', 'all', or 'reset'.
        progress=1.0 explodes the part; progress=0.0 assembles the part back in place.
        """
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        self._ensure_base_transforms()
        duration = max(0.05, float(duration))

        # Support step-by-step sequential explode or assemble
        if step in ["next_explode", "step_explode", "explode_next"]:
            target_step = None
            for s in self.DISASSEMBLY_ORDER:
                if self._target_step_progress.get(s, 0.0) < 0.9:
                    target_step = s
                    break
            if not target_step:
                return {"status": "noop", "message": "All components are already fully exploded", "step_progress": self._target_step_progress}
            step = target_step
            progress = 1.0

        elif step in ["next_assemble", "step_assemble", "assemble_next"]:
            target_step = None
            for s in self.ASSEMBLY_ORDER:
                if self._target_step_progress.get(s, 0.0) > 0.1:
                    target_step = s
                    break
            if not target_step:
                return {"status": "noop", "message": "All components are already fully assembled", "step_progress": self._target_step_progress}
            step = target_step
            progress = 0.0

        progress = max(0.0, min(1.0, float(progress)))

        target_map = dict(self._target_step_progress)
        if step == "reset":
            for k in target_map.keys():
                target_map[k] = 0.0
            target_factor = 0.0
        elif step == "all":
            for k in target_map.keys():
                target_map[k] = progress
            target_factor = progress
        elif step in target_map:
            target_map[step] = progress
            target_factor = max(target_map.values())
        else:
            return {
                "error": f"Unknown disassembly step: '{step}'. Valid steps: 'bolts', 'caliper', 'pads', 'hub', 'all', 'reset', 'step_explode', 'step_assemble'"
            }

        if animate:
            self._anim_duration = duration
            self._anim_start_time = time.time()
            self._anim_start_factor = self._exploded_factor
            self._anim_target_factor = target_factor
            for k in self._step_progress.keys():
                self._start_step_progress[k] = self._step_progress.get(k, 0.0)
                self._target_step_progress[k] = target_map.get(k, 0.0)
            self._is_animating = True
            self._ensure_update_subscription()
        else:
            self._is_animating = False
            self._exploded_factor = target_factor
            self._anim_target_factor = target_factor
            for k in self._step_progress.keys():
                self._step_progress[k] = target_map.get(k, 0.0)
                self._target_step_progress[k] = target_map.get(k, 0.0)
            self._apply_step_transforms()

        return {
            "status": "success",
            "step": step,
            "progress": progress,
            "action": "disassemble" if progress > 0.5 else "assemble",
            "animated": animate,
            "step_progress": self._target_step_progress,
        }

    def set_rotor_kinematics(self, enabled: bool, rpm: float = 120.0):
        """Toggles continuous rotation of the rotor disc around its local axle axis."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found"}

        self._ensure_base_transforms()
        self._rotor_kinematics_enabled = bool(enabled)
        self._rotor_rpm = float(rpm)

        if self._rotor_kinematics_enabled:
            self._ensure_update_subscription()
            carb.log_info(f"Rotor kinematics enabled at {self._rotor_rpm} RPM")
        else:
            carb.log_info("Rotor kinematics disabled")

        return {
            "status": "success",
            "kinematics_enabled": self._rotor_kinematics_enabled,
            "rpm": self._rotor_rpm,
        }

    def _on_set_exploded_view(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received setExplodedViewRequest")
        try:
            p = _safe_get_payload(event)
            factor = float(p.get("factor", p.get("explosion_factor", 0.0)))
            animate = bool(p.get("animate", True))
            duration = float(p.get("duration", 0.8))
            res = self.set_exploded_view(factor, animate=animate, duration=duration)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"setExplodedView handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("setExplodedViewResponse", payload=payload)

    def _on_get_exploded_view_state(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received getExplodedViewStateRequest")
        try:
            res = self.get_exploded_view_state()
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"getExplodedViewState handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("getExplodedViewStateResponse", payload=payload)

    def _on_disassemble_step(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received disassembleStepRequest")
        try:
            p = _safe_get_payload(event)
            step = str(p.get("step", p.get("component", "all")))
            action = p.get("action", None)
            if action == "assemble":
                progress = 0.0
            elif action in ["disassemble", "explode"]:
                progress = 1.0
            else:
                progress = float(p.get("progress", 1.0))
            animate = bool(p.get("animate", True))
            duration = float(p.get("duration", 0.8))
            res = self.disassemble_step(step, progress, animate=animate, duration=duration)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"disassembleStep handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("disassembleStepResponse", payload=payload)

    def _on_set_rotor_kinematics(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received setRotorKinematicsRequest")
        try:
            p = _safe_get_payload(event)
            enabled = bool(p.get("enabled", True))
            rpm = float(p.get("rpm", 120.0))
            res = self.set_rotor_kinematics(enabled, rpm)
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"setRotorKinematics handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("setRotorKinematicsResponse", payload=payload)

    def get_bill_of_materials(self):
        """Returns the authoritative engineering Bill of Materials (BOM) with live bounding box dimensions."""
        stage = omni.usd.get_context().get_stage()
        meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage) if stage else 0.01
        scale_to_mm = meters_per_unit * 1000.0

        items = []
        total_cost = 0.0
        total_weight = 0.0
        total_qty = 0

        bbox_cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_]) if stage else None

        for prim_path, spec in BILL_OF_MATERIALS_SPEC.items():
            item_data = dict(spec)
            item_data["prim_path"] = prim_path

            # Enrich with live bounding box dimensions in mm if prim exists
            if stage and bbox_cache:
                prim = stage.GetPrimAtPath(prim_path)
                if prim and prim.IsValid():
                    try:
                        bbox = bbox_cache.ComputeWorldBound(prim)
                        size = bbox.ComputeAlignedRange().GetSize()
                        item_data["dimensions_mm"] = {
                            "width_x": round(size[0] * scale_to_mm, 1),
                            "height_y": round(size[1] * scale_to_mm, 1),
                            "depth_z": round(size[2] * scale_to_mm, 1),
                            "formatted": f"{round(size[0]*scale_to_mm, 1)} x {round(size[1]*scale_to_mm, 1)} x {round(size[2]*scale_to_mm, 1)} mm"
                        }
                    except Exception:
                        item_data["dimensions_mm"] = None
                else:
                    item_data["dimensions_mm"] = None
            else:
                item_data["dimensions_mm"] = None

            total_cost += item_data["unit_price"] * item_data["qty"]
            total_weight += item_data["weight_kg"] * item_data["qty"]
            total_qty += item_data["qty"]
            items.append(item_data)

        items.sort(key=lambda x: x["item_no"])

        return {
            "assembly_name": "Disc Brake Assembly",
            "root_prim": "/World/Disc_Brake_Assembly",
            "total_items": len(items),
            "total_qty": total_qty,
            "total_weight_kg": round(total_weight, 2),
            "total_cost_usd": round(total_cost, 2),
            "currency": "USD",
            "certification": "ISO/TS 16949 / SAE J431 Compliant",
            "items": items,
        }

    def get_spatial_callouts(self):
        """Computes live 3D bounding centers of components and projects them to screen percentages (0% to 100%)."""
        stage = omni.usd.get_context().get_stage()
        if not stage:
            return {"error": "No active USD stage found", "callouts": []}

        cam_path = get_active_viewport_camera_string()
        cam_prim = stage.GetPrimAtPath(cam_path) if cam_path else None
        if not cam_prim or not cam_prim.IsValid():
            cam_path = "/World/Camera"
            cam_prim = stage.GetPrimAtPath(cam_path)

        if not cam_prim or not cam_prim.IsValid():
            return {"error": "No valid camera found", "callouts": []}

        cam_geom = UsdGeom.Camera(cam_prim)
        fl = cam_geom.GetFocalLengthAttr().Get() if cam_geom.GetFocalLengthAttr().IsValid() else 18.15
        hap = cam_geom.GetHorizontalApertureAttr().Get() if cam_geom.GetHorizontalApertureAttr().IsValid() else 20.95
        vap = cam_geom.GetVerticalApertureAttr().Get() if cam_geom.GetVerticalApertureAttr().IsValid() else 15.29

        cam_xform = UsdGeom.Xformable(cam_prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        inv_cam = cam_xform.GetInverse()

        bbox_cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])

        callouts = []
        for prim_path, spec in BILL_OF_MATERIALS_SPEC.items():
            prim = stage.GetPrimAtPath(prim_path)
            if not prim or not prim.IsValid():
                continue

            try:
                b = bbox_cache.ComputeWorldBound(prim).ComputeAlignedRange()
                min_pt, max_pt = b.GetMin(), b.GetMax()
                center = [(min_pt[i] + max_pt[i]) / 2.0 for i in range(3)]

                p_cam = inv_cam.Transform(Gf.Vec3d(*center))
                x_cam, y_cam, z_cam = p_cam[0], p_cam[1], p_cam[2]
                depth = -z_cam

                if depth > 0.01:
                    x_film = (x_cam / depth) * (fl / hap)
                    y_film = (y_cam / depth) * (fl / vap)
                    u_pct = round(50.0 + x_film * 100.0, 2)
                    v_pct = round(50.0 - y_film * 100.0, 2)
                    visible = (0.0 <= u_pct <= 100.0) and (0.0 <= v_pct <= 100.0)
                else:
                    u_pct, v_pct, visible = 50.0, 50.0, False

                callouts.append({
                    "item_no": spec["item_no"],
                    "name": spec["name"],
                    "part_number": spec["part_number"],
                    "category": spec["category"],
                    "material": spec["material"],
                    "unit_price": spec["unit_price"],
                    "weight_kg": spec["weight_kg"],
                    "torque_nm": spec["torque_nm"],
                    "prim_path": prim_path,
                    "screen_x_pct": u_pct,
                    "screen_y_pct": v_pct,
                    "depth_m": round(depth, 3),
                    "visible": visible,
                    "world_pos": [round(c, 4) for c in center],
                })
            except Exception as e:
                carb.log_warn(f"Failed to project spatial callout for {prim_path}: {e}")

        callouts.sort(key=lambda x: x["item_no"])

        return {
            "status": "success",
            "camera_path": cam_path,
            "callouts": callouts,
            "exploded_factor": self._exploded_factor
        }

    def _on_get_bill_of_materials(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received getBillOfMaterialsRequest")
        try:
            res = self.get_bill_of_materials()
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"getBillOfMaterials handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("getBillOfMaterialsResponse", payload=payload)

    def _on_get_spatial_callouts(self, event: carb.events.IEvent) -> None:
        carb.log_info("Received getSpatialCalloutsRequest")
        try:
            res = self.get_spatial_callouts()
            payload = {"result": "success", "data": res}
        except Exception as e:
            carb.log_error(f"getSpatialCallouts handler failed: {traceback.format_exc()}")
            payload = {"result": "error", "error": str(e)}
        get_eventdispatcher().dispatch_event("getSpatialCalloutsResponse", payload=payload)

    def on_shutdown(self):
        """This is called every time the extension is deactivated. It is used
        to clean up the extension state."""
        # Stop kinematics subscription if active
        if self._kinematics_sub:
            self._kinematics_sub = None
        self._rotor_kinematics_enabled = False
        self._is_animating = False
        # Reseting the state.
        self._subscriptions.clear()
        self._is_external_update: bool = False
        self._camera_attrs.clear()
        self._base_transforms.clear()
