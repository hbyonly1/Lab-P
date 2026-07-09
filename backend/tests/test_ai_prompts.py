import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.ai_prompts import build_generation_answers_prompt, build_recognition_prompt
from services.ai_provider import model_supports_json_mode, normalize_image_recognition_model
from services.ai_service import image_path_to_model_url, parse_json_object_from_ai_response
from services.experimentConfigStore import collect_ai_recognition_groups


def test_recognition_prompt_maps_meter_columns_to_node_ids():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_meter_modification.json"
    config = json.loads(config_path.read_text())

    prompt = build_recognition_prompt(config, ["DBGZ10-0", "DBGZ10-1"])

    assert "target=I" in prompt
    assert "by=Rₓ" in prompt
    assert "cols=[200,400]" in prompt
    assert "nodes=[DBGZ10-0,DBGZ10-1]" in prompt


def test_recognition_prompt_maps_multi_row_multi_column_cells():
    config = {
        "meta": {"name": "多行多列表格实验"},
        "inputs": {
            "fields": [
                {"id": "A1", "type": "ai_recognize"},
                {"id": "A2", "type": "ai_recognize"},
            ]
        },
        "ui": {
            "dataTables": [
                {
                    "caption": "位移数据表",
                    "rows": [
                        {
                            "isHeader": True,
                            "cells": [
                                {"text": "砝码/kg"},
                                {"text": "上行读数/cm"},
                                {"text": "下行读数/cm"},
                            ],
                        },
                        {
                            "cells": [
                                {"text": "1"},
                                {"nodeId": "A1"},
                                {"nodeId": "A2"},
                            ],
                        },
                    ],
                }
            ]
        },
    }

    prompt = build_recognition_prompt(config, ["A1", "A2"])

    assert "row_axis=砝码" in prompt
    assert "rows=[1]" in prompt
    assert "cols=[上行读数,下行读数]" in prompt
    assert "node_matrix=[[A1,A2]]" in prompt


def test_photoelectric_prompt_uses_table_mapping_and_experiment_extra_prompt():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_photoelectric_planck.json"
    config = json.loads(config_path.read_text())
    recognition_ids = [
        field["id"]
        for field in config["inputs"]["fields"]
        if field.get("type") == "ai_recognize"
    ]

    prompt = build_recognition_prompt(config, recognition_ids)

    assert "注意单位" in prompt
    assert "row_axis_label=UAK（V）" in prompt
    assert "cols=[-1.5,-1,-0.5,0,1,2,3,4,5]" in prompt
    assert "cols=[6,8,10,13,16,19,22,26,30]" in prompt
    assert "row_labels=[I（10⁻¹¹A）]" in prompt
    assert "row_labels=[I（10⁻¹⁰A）]" in prompt
    assert "row_labels=[截止电压U₀（V）]" in prompt
    assert "node_matrix=[[G10-0,G10-1,G10-2,G10-3,G10-4,G10-5,G10-6,G10-7,G10-8]]" in prompt
    assert "node_matrix=[[G12-0,G12-1,G12-2,G12-3,G12-4,G12-5,G12-6,G12-7,G12-8]]" in prompt
    assert "node_matrix=[[G20-0,G20-1,G20-2]]" in prompt
    assert "node_matrix=[[G61-0,G61-1,G61-2,G61-3,G61-4]]" in prompt
    assert "cols=[365/8.214,405/7.408,436/6.879,546/5.490,577/5.196]" in prompt
    assert '"G7": ""' in prompt
    assert '"G8": ""' in prompt
    assert "G7: 单位按 10^-34 J·S" in prompt
    assert "G8: 单位按 %" in prompt
    assert "若手写为 A 单位科学计数法" in prompt
    assert "U0 保留手写正负号" in prompt
    assert "G7 单位按 10^-34 J·S；G8 单位按 %" not in prompt
    assert set(config["formulas"]) == {"G3", "G4", "G5"}
    assert {"G7", "G8"} <= set(config["archivedFormulas"])
    assert "G10-0:" not in prompt


def test_sound_velocity_prompt_only_requests_raw_ppt_values():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_sound_velocity.json"
    config = json.loads(config_path.read_text())
    recognition_ids = [
        field["id"]
        for field in config["inputs"]["fields"]
        if field.get("type") == "ai_recognize"
    ]

    prompt = build_recognition_prompt(config, recognition_ids)

    assert "node_matrix=[[S10-0,S10-1,S10-2,S10-3,S10-4],[S12-0,S12-1,S12-2,S12-3,S12-4]]" in prompt
    assert "node_matrix=[[S50-0,S50-1,S50-2,S50-3],[S52-0,S52-1,S52-2,S52-3]]" in prompt
    assert "S2: 单位按 kHz" in prompt
    assert "S6: 单位按 kHz" in prompt
    assert "S11-0" not in prompt
    assert "S51-0" not in prompt
    assert "S13-0" not in prompt
    assert "S53-0" not in prompt
    assert "S3" not in prompt
    assert "S4" not in prompt
    assert "S7" not in prompt
    assert "S8" not in prompt


def test_air_heat_capacity_ratio_prompt_requests_full_table2_values():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_air_heat_capacity_ratio.json"
    config = json.loads(config_path.read_text())
    recognition_ids = [
        field["id"]
        for field in config["inputs"]["fields"]
        if field.get("type") == "ai_recognize"
    ]

    prompt = build_recognition_prompt(config, recognition_ids)

    assert "K35-0" in recognition_ids
    assert "K36-0" in recognition_ids
    assert "K37-0" in recognition_ids
    assert "node_matrix=[[K30-0,K30-1,K30-2,K30-3,K30-4,K30-5],[K31-0,K31-1,K31-2,K31-3,K31-4,K31-5],[K32-0,K32-1,K32-2,K32-3,K32-4,K32-5],[K33-0,K33-1,K33-2,K33-3,K33-4,K33-5],[K34-0,K34-1,K34-2,K34-3,K34-4,K34-5],[K35-0,K35-1,K35-2,K35-3,K35-4,K35-5],[K36-0,K36-1,K36-2,K36-3,K36-4,K36-5],[K37-0,K37-1,K37-2,K37-3,K37-4,K37-5]]" in prompt
    assert set(config["formulas"]) == {"K2", "K4", "K5"}
    assert {"K35-0", "K36-0", "K37-0"} <= set(config["archivedFormulas"])


def test_three_line_torsion_prompt_excludes_computed_average_and_period_rows():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_three_line_torsion_pendulum.json"
    config = json.loads(config_path.read_text())
    recognition_ids = [
        field["id"]
        for field in config["inputs"]["fields"]
        if field.get("type") == "ai_recognize"
    ]

    prompt = build_recognition_prompt(config, recognition_ids)

    assert "node_matrix=[[S20-0,S20-1],[S21-0,S21-1],[S22-0,S22-1]]" in prompt
    assert "node_matrix=[[S2220-0,S2220-1],[S2221-0,S2221-1],[S2222-0,S2222-1]]" in prompt
    assert "S23-0" not in prompt
    assert "S23-1" not in prompt
    assert "S24-0" not in prompt
    assert "S24-1" not in prompt
    assert "S2223-0" not in prompt
    assert "S2223-1" not in prompt
    assert "S2224-0" not in prompt
    assert "S2224-1" not in prompt
    assert "S4: 三线摆悬盘转动惯量 J0" in prompt
    assert "S7: 扭摆钢丝切变模量 G" in prompt


def test_steel_wire_young_modulus_prompt_requests_raw_values_only():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_steel_wire_young_modulus.json"
    config = json.loads(config_path.read_text())
    recognition_ids = [
        field["id"]
        for field in config["inputs"]["fields"]
        if field.get("type") == "ai_recognize"
    ]

    prompt = build_recognition_prompt(config, recognition_ids)

    assert "row_axis=测量量" in prompt
    assert "rows=[钢丝长度 L,光杠杆镜面到标尺的距离 D,钢丝直径 d,光杠杆前后足垂直距离 b]" in prompt
    assert "cols=[测量值]" in prompt
    assert "node_matrix=[[L1],[L2],[L3],[L4]]" in prompt
    assert "row_axis=增重" in prompt
    assert "cols=[标尺读数rᵢ',标尺读数rᵢ'']" in prompt
    assert "node_matrix=[[L50-0,L50-1],[L51-0,L51-1],[L52-0,L52-1],[L53-0,L53-1],[L54-0,L54-1],[L55-0,L55-1],[L56-0,L56-1],[L57-0,L57-1]]" in prompt
    assert "L1: 单位按 cm" in prompt
    assert "L2: 单位按 cm" in prompt
    assert "L3: 单位按 mm" in prompt
    assert "L4: 单位按 cm" in prompt
    assert '"L50-2": ""' not in prompt
    assert '"L60-0": ""' not in prompt
    assert '"L64-0": ""' not in prompt
    assert '"L7": ""' not in prompt
    assert '"L8": ""' not in prompt


def test_potentiometer_prompt_uses_ppt_raw_values_only():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_potentiometer.json"
    config = json.loads(config_path.read_text())
    recognition_ids = [
        field["id"]
        for field in config["inputs"]["fields"]
        if field.get("type") == "ai_recognize"
    ]

    prompt = build_recognition_prompt(config, recognition_ids)

    assert "row_axis=n" in prompt
    assert "row_labels=[t（℃）,U（mV）]" in prompt
    assert "cols=[1,2,3,4,5,6]" in prompt
    assert "node_matrix=[[D30-0,D30-1,D30-2,D30-3,D30-4,D30-5],[D31-0,D31-1,D31-2,D31-3,D31-4,D31-5]]" in prompt
    assert "D2: 单位按 mV" in prompt
    assert "D11: 单位按 ℃" in prompt
    assert "D7" not in prompt
    assert "D8" not in prompt
    assert "D9" not in prompt
    assert "D12" not in prompt
    assert "SYBZ_Fill_0" not in prompt


def test_liquid_crystal_recognition_groups_split_raw_and_response_images():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_liquid_crystal_0625.json"
    config = json.loads(config_path.read_text())
    groups = collect_ai_recognition_groups(config)
    by_id = {group["id"]: group for group in groups}

    assert by_id["avg_transmittance"]["imageRef"] == "IMG_LC_SIGNED_RAW"
    assert by_id["avg_transmittance"]["nodeIds"] == [
        "Y10-1", "Y11-1", "Y12-1", "Y13-1", "Y14-1",
        "Y15-1", "Y16-1", "Y17-1", "Y18-1", "Y19-1",
        "Y110-1", "Y111-1", "Y112-1", "Y113-1", "Y114-1",
    ]
    assert by_id["fall_time"]["imageRef"] == "IMG_LC_FALL_CURVE"
    assert by_id["fall_time"]["nodeIds"] == ["Y6"]
    assert by_id["rise_time"]["imageRef"] == "IMG_LC_RISE_CURVE"
    assert by_id["rise_time"]["nodeIds"] == ["Y8"]

    fall_prompt_config = dict(config)
    fall_prompt_config["ai"] = {
        **config["ai"],
        "recognition": {
            **config["ai"]["recognition"],
            "extraPrompt": by_id["fall_time"].get("extraPrompt", ""),
        },
    }
    fall_prompt = build_recognition_prompt(fall_prompt_config, by_id["fall_time"]["nodeIds"])

    assert '"Y6": ""' in fall_prompt
    assert '"Y10-1": ""' not in fall_prompt
    assert "Y6: 单位按 ms" in fall_prompt
    assert "液晶光开关表格中电压为PPT固定序列" not in fall_prompt


def test_recognition_prompt_ignores_database_extra_prompt():
    class LegacyTemplate:
        recognition_system_prompt = None
        recognition_extra_prompt = "数据库识别附加说明不应出现"

    config = {
        "meta": {"name": "识别附加说明来源实验"},
        "inputs": {
            "fields": [
                {"id": "A1", "type": "ai_recognize", "label": "读数"},
            ]
        },
        "ai": {
            "recognition": {
                "extraPrompt": "JSON 识别附加说明应出现"
            }
        },
    }

    prompt = build_recognition_prompt(config, ["A1"], LegacyTemplate())

    assert "JSON 识别附加说明应出现" in prompt
    assert "数据库识别附加说明不应出现" not in prompt


def test_ai_response_parser_extracts_boxed_json_object():
    content = '<|begin_of_box|>{"DBGZ10-0":"83.0","DBGZ10-1":"71.0"}<|end_of_box|>'

    assert parse_json_object_from_ai_response(content) == {
        "DBGZ10-0": "83.0",
        "DBGZ10-1": "71.0",
    }


def test_ai_response_parser_rejects_non_object_json():
    try:
        parse_json_object_from_ai_response("[]")
    except ValueError as exc:
        assert "not an object" in str(exc)
    else:
        raise AssertionError("Expected non-object JSON to be rejected")


def test_image_recognition_model_defaults_to_glm_and_skips_json_mode():
    assert normalize_image_recognition_model("deepseek-ai/DeepSeek-OCR") == "zai-org/GLM-4.5V"
    assert model_supports_json_mode("zai-org/GLM-4.5V") is False


def test_upload_image_path_is_converted_to_data_url(tmp_path, monkeypatch):
    upload_dir = tmp_path / "uploads" / "2026-07"
    upload_dir.mkdir(parents=True)
    image_path = upload_dir / "meter.JPG"
    image_path.write_bytes(b"fake-image")
    monkeypatch.chdir(tmp_path)

    url = image_path_to_model_url("/uploads/2026-07/meter.JPG")

    assert url.startswith("data:image/jpeg;base64,")
    assert "/uploads/2026-07/meter.JPG" not in url


def test_generation_prompt_uses_configured_data_nodes_with_computed_values():
    config = {
        "meta": {"name": "电表的改装"},
        "inputs": {
            "fields": [
                {"id": "A1", "type": "ai_recognize"},
                {"id": "C1", "type": "computed"},
                {"id": "G1", "type": "generated"},
            ]
        },
        "ai": {
            "generation": {
                "dataNodes": ["C1"]
            }
        },
    }

    prompt = build_generation_answers_prompt(
        [{"index": 1, "nodeId": "G1", "title": "分析误差。"}],
        {"A1": "83.0", "C1": "1.00", "G1": "旧回答"},
        config,
    )

    assert "1.00" in prompt
    assert "83.0" not in prompt
    assert "旧回答" not in prompt


def test_generation_prompt_ignores_legacy_database_data_nodes():
    class LegacyTemplate:
        generation_system_prompt = None
        generation_extra_prompt = "数据库思考题附加说明不应出现"
        generation_data_nodes = "A1"

    config = {
        "meta": {"name": "配置节点优先实验"},
        "inputs": {
            "fields": [
                {"id": "A1", "type": "ai_recognize"},
                {"id": "C1", "type": "computed"},
                {"id": "G1", "type": "generated"},
            ]
        },
        "ai": {
            "generation": {
                "dataNodes": ["C1"]
            }
        },
    }

    prompt = build_generation_answers_prompt(
        [{"index": 1, "nodeId": "G1", "title": "分析误差。"}],
        {"A1": "识别值", "C1": "配置值"},
        config,
        LegacyTemplate(),
    )

    assert "配置值" in prompt
    assert "识别值" not in prompt
    assert "数据库思考题附加说明不应出现" not in prompt


def test_generation_prompt_uses_json_extra_prompt():
    config = {
        "meta": {"name": "思考题附加说明来源实验"},
        "inputs": {
            "fields": [
                {"id": "C1", "type": "computed"},
                {"id": "G1", "type": "generated"},
            ]
        },
        "ai": {
            "generation": {
                "dataNodes": ["C1"],
                "extraPrompt": "JSON 思考题附加说明应出现"
            }
        },
    }

    prompt = build_generation_answers_prompt(
        [{"index": 1, "nodeId": "G1", "title": "分析误差。"}],
        {"C1": "1.00"},
        config,
    )

    assert "JSON 思考题附加说明应出现" in prompt


def test_generation_prompt_defaults_to_first_three_recognition_nodes():
    config = {
        "meta": {"name": "默认三节点实验"},
        "inputs": {
            "fields": [
                {"id": "A1", "type": "ai_recognize"},
                {"id": "A2", "type": "ai_recognize"},
                {"id": "A3", "type": "ai_recognize"},
                {"id": "A4", "type": "ai_recognize"},
                {"id": "G1", "type": "generated"},
            ]
        },
    }

    prompt = build_generation_answers_prompt(
        [{"index": 1, "nodeId": "G1", "title": "分析误差。"}],
        {"A1": "值1", "A2": "值2", "A3": "值3", "A4": "值4"},
        config,
    )

    assert "值1" in prompt
    assert "值2" in prompt
    assert "值3" in prompt
    assert "值4" not in prompt
