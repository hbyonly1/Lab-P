import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.ai_prompts import build_generation_answers_prompt, build_recognition_prompt
from services.ai_provider import model_supports_json_mode, normalize_image_recognition_model
from services.ai_service import image_path_to_model_url, parse_json_object_from_ai_response


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
