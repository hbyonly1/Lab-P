import json
import sys
from pathlib import Path

import simpleeval

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.experiment_formulas import build_formula_functions, format_sig


def test_format_sig_preserves_significant_trailing_zeroes():
    assert format_sig(0.9998908068387943, 3) == "1.00"


def test_meter_modification_formula_outputs_plain_table_values():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_meter_modification.json"
    config = json.loads(config_path.read_text())
    values = {
        "DBGZ10-0": 83.0,
        "DBGZ10-1": 71.0,
        "DBGZ10-2": 62.0,
        "DBGZ10-3": 55.0,
        "DBGZ10-4": 33.0,
        "DBGZ10-5": 19.5,
        "DBGZ10-6": 14.0,
        "DBGZ10-7": 11.0,
    }

    evaluator = simpleeval.SimpleEval()
    evaluator.names = values
    evaluator.functions.update(build_formula_functions(values))
    formulas = config["formulas"]

    assert evaluator.eval(formulas["DBGZ2"]) == "98394"
    assert evaluator.eval(formulas["DBGZ3"]) == "993.5"
    assert evaluator.eval(formulas["DBGZ4"]) == "1.00"


def test_sound_velocity_formulas_follow_ppt_difference_method():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_sound_velocity.json"
    config = json.loads(config_path.read_text())
    values = {
        "S10-0": 10.00,
        "S10-1": 18.50,
        "S10-2": 27.00,
        "S10-3": 35.50,
        "S10-4": 44.00,
        "S12-0": 52.50,
        "S12-1": 61.00,
        "S12-2": 69.50,
        "S12-3": 78.00,
        "S12-4": 86.50,
        "S2": 40.00,
        "S50-0": 10.00,
        "S50-1": 18.50,
        "S50-2": 27.00,
        "S50-3": 35.50,
        "S52-0": 27.00,
        "S52-1": 35.50,
        "S52-2": 44.00,
        "S52-3": 52.50,
        "S6": 40.00,
    }

    evaluator = simpleeval.SimpleEval()
    formulas = config["formulas"]
    for target in ["S13-0", "S13-1", "S13-2", "S13-3", "S13-4", "S3", "S4", "S53-0", "S53-1", "S53-2", "S53-3", "S7", "S8"]:
        evaluator.names = values
        evaluator.functions.update(build_formula_functions(values))
        values[target] = evaluator.eval(formulas[target])

    assert values["S13-0"] == "8.500"
    assert values["S3"] == "8.50"
    assert values["S4"] == "340.0"
    assert values["S53-0"] == "8.500"
    assert values["S7"] == "8.50"
    assert values["S8"] == "340.0"

    reversed_values = {
        **values,
        "S10-0": 52.50,
        "S12-0": 10.00,
        "S50-0": 27.00,
        "S52-0": 10.00,
    }
    evaluator.names = reversed_values
    evaluator.functions.update(build_formula_functions(reversed_values))
    assert evaluator.eval(formulas["S13-0"]) == "8.500"
    assert evaluator.eval(formulas["S53-0"]) == "8.500"


def test_three_line_torsion_pendulum_period_formulas_follow_30_cycle_method():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_three_line_torsion_pendulum.json"
    config = json.loads(config_path.read_text())
    values = {
        "S20-0": 31.20,
        "S21-0": 31.26,
        "S22-0": 31.23,
        "S20-1": 41.40,
        "S21-1": 41.46,
        "S22-1": 41.43,
        "S2220-0": 28.50,
        "S2221-0": 28.56,
        "S2222-0": 28.53,
        "S2220-1": 37.80,
        "S2221-1": 37.86,
        "S2222-1": 37.83,
    }

    evaluator = simpleeval.SimpleEval()
    formulas = config["formulas"]
    for target in ["S23-0", "S23-1", "S24-0", "S24-1", "S2223-0", "S2223-1", "S2224-0", "S2224-1"]:
        evaluator.names = values
        evaluator.functions.update(build_formula_functions(values))
        values[target] = evaluator.eval(formulas[target])

    assert values["S23-0"] == "31.23"
    assert values["S23-1"] == "41.43"
    assert values["S24-0"] == "1.041"
    assert values["S24-1"] == "1.381"
    assert values["S2223-0"] == "28.53"
    assert values["S2223-1"] == "37.83"
    assert values["S2224-0"] == "0.951"
    assert values["S2224-1"] == "1.261"

    fixed_values = {
        field["id"]: field.get("value")
        for field in config["inputs"]["fields"]
        if field.get("type") == "fixed"
    }
    assert fixed_values == {
        "OP1_Fill_0": "B",
        "OP2_Fill_0": "D",
        "OP3_Fill_0": "B",
        "OP4_Fill_0": "A",
        "OP5_Fill_0": "B",
        "OP6_Fill_0": "B",
        "OP7_Fill_0": "C",
        "OP8_Fill_0": "B",
        "OP9_Fill_0": "C",
        "OP11_Fill_0": "ABCD",
        "OP22_Fill_0": "ABCD",
        "OP33_Fill_0": "ABC",
    }


def test_steel_wire_young_modulus_formulas_follow_ppt_difference_method():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_steel_wire_young_modulus.json"
    config = json.loads(config_path.read_text())
    values = {
        "L1": 80,
        "L2": 120,
        "L3": 0.5,
        "L4": 8,
        "L50-0": 10.00,
        "L50-1": 10.10,
        "L51-0": 10.50,
        "L51-1": 10.60,
        "L52-0": 11.00,
        "L52-1": 11.10,
        "L53-0": 11.50,
        "L53-1": 11.60,
        "L54-0": 12.00,
        "L54-1": 12.10,
        "L55-0": 12.50,
        "L55-1": 12.60,
        "L56-0": 13.00,
        "L56-1": 13.10,
        "L57-0": 13.50,
        "L57-1": 13.60,
    }

    evaluator = simpleeval.SimpleEval()
    formulas = config["formulas"]
    for target in [
        "L50-2",
        "L51-2",
        "L52-2",
        "L53-2",
        "L54-2",
        "L55-2",
        "L56-2",
        "L57-2",
        "L60-0",
        "L61-0",
        "L62-0",
        "L63-0",
        "L64-0",
        "L7",
        "L8",
    ]:
        numeric_values = {}
        for key, value in values.items():
            try:
                numeric_values[key] = float(value) if isinstance(value, str) and value.strip() else value
            except ValueError:
                numeric_values[key] = value
        evaluator.names = numeric_values
        evaluator.functions.update(build_formula_functions(numeric_values))
        values[target] = evaluator.eval(formulas[target])

    assert values["L50-2"] == "10.05"
    assert values["L57-2"] == "13.55"
    assert values["L60-0"] == "2.00"
    assert values["L64-0"] == "2.00"
    assert values["L7"] == "2.40"
    assert values["L8"] == "2.00"

    fixed_values = {
        field["id"]: field.get("value")
        for field in config["inputs"]["fields"]
        if field.get("type") == "fixed"
    }
    assert fixed_values == {
        "SYMD_Fill_0": "杨氏模量",
        "SYMD_Fill_1": "光杠杆",
        "SYMD_Fill_2": "逐差法",
        "SYMD_Fill_3": "误差均分原则",
        "SYMD_Fill_4": "杨氏模量仪",
        "SYYL_Fill_0": "应力",
        "SYYL_Fill_1": "应变",
        "SYYL_Fill_2": "杨氏模量",
        "SYYL_Fill_3": "光杠杆",
        "SYYL_Fill_4": "卷尺",
        "SYYL_Fill_5": "卷尺",
        "SYYL_Fill_6": "螺旋测微器",
        "SYYL_Fill_7": "游标卡尺",
    }


def test_potentiometer_formulas_follow_ppt_linear_fit():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_potentiometer.json"
    config = json.loads(config_path.read_text())
    values = {
        "D30-0": 1.0,
        "D30-1": 2.0,
        "D30-2": 3.0,
        "D30-3": 4.0,
        "D30-4": 5.0,
        "D30-5": 6.0,
        "D31-0": 2.0,
        "D31-1": 4.0,
        "D31-2": 6.0,
        "D31-3": 8.0,
        "D31-4": 10.0,
        "D31-5": 12.0,
        "D11": 25.0,
    }

    evaluator = simpleeval.SimpleEval()
    formulas = config["formulas"]
    for target in ["D7", "D8", "D9", "D12"]:
        evaluator.names = values
        evaluator.functions.update(build_formula_functions(values))
        values[target] = evaluator.eval(formulas[target])

    assert values["D7"] == "2.000"
    assert values["D8"] == "0.000"
    assert values["D9"] == "1.00"
    assert values["D12"] == "50.00"


def test_liquid_crystal_formulas_interpolate_switch_voltages():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_liquid_crystal_0625.json"
    config = json.loads(config_path.read_text())
    values = {
        "Y10-1": 100,
        "Y11-1": 96,
        "Y12-1": 84,
        "Y13-1": 74,
        "Y14-1": 62,
        "Y15-1": 55,
        "Y16-1": 49,
        "Y17-1": 43,
        "Y18-1": 36,
        "Y19-1": 29,
        "Y110-1": 23,
        "Y111-1": 18,
        "Y112-1": 6,
        "Y113-1": 3,
        "Y114-1": 1,
    }

    evaluator = simpleeval.SimpleEval()
    formulas = config["formulas"]
    for target in ["Y3", "Y4"]:
        evaluator.names = values
        evaluator.functions.update(build_formula_functions(values))
        values[target] = evaluator.eval(formulas[target])

    assert values["Y3"] == "0.650"
    assert values["Y4"] == "3.67"

    asset = config["computedAssets"]["Y2Area"]
    assert asset["generator"] == "excel_style_chart"
    assert asset["plot"]["xAxis"]["values"] == [0.0, 0.5, 0.8, 1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.0, 3.0, 4.0, 5.0, 6.0]
    assert asset["plot"]["xAxis"]["ticks"] == [0, 1, 2, 3, 4, 5, 6]
    assert asset["plot"]["yAxis"]["ticks"] == [0, 20, 40, 60, 80, 100]
    assert [line["value"] for line in asset["plot"]["referenceLines"]] == [90, 10]
    assert [layer["type"] for layer in asset["plot"]["layers"]] == ["polyline"]


def test_air_heat_capacity_ratio_archives_pressure_and_gamma_formulas():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_air_heat_capacity_ratio.json"
    config = json.loads(config_path.read_text())
    values = {
        "K10-0": 40,
        "K10-1": 60,
        "K10-2": 80,
        "K10-3": 100,
        "K10-4": 120,
        "K10-5": 140,
        "K10-6": 160,
        "K2": "20.00",
        "K30-0": 60,
        "K30-1": 58,
        "K30-2": 62,
        "K30-3": 61,
        "K30-4": 59,
        "K30-5": 60,
        "K32-0": 30,
        "K32-1": 29,
        "K32-2": 31,
        "K32-3": 30.5,
        "K32-4": 29.5,
        "K32-5": 30,
        "K34-0": 101.325,
        "K34-1": 101.325,
        "K34-2": 101.325,
        "K34-3": 101.325,
        "K34-4": 101.325,
        "K34-5": 101.325,
    }

    evaluator = simpleeval.SimpleEval()
    formulas = config["archivedFormulas"]
    for target in [
        "K35-0",
        "K35-1",
        "K35-2",
        "K35-3",
        "K35-4",
        "K35-5",
        "K36-0",
        "K36-1",
        "K36-2",
        "K36-3",
        "K36-4",
        "K36-5",
        "K37-0",
        "K37-1",
        "K37-2",
        "K37-3",
        "K37-4",
        "K37-5",
    ]:
        numeric_values = {}
        for key, value in values.items():
            try:
                numeric_values[key] = float(value) if isinstance(value, str) and value.strip() else value
            except ValueError:
                numeric_values[key] = value
        evaluator.names = numeric_values
        evaluator.functions.update(build_formula_functions(numeric_values))
        values[target] = evaluator.eval(formulas[target])

    assert values["K2"] == "20.00"
    assert values["K35-0"] == "104.325"
    assert values["K36-0"] == "102.825"
    assert values["K37-0"] == "2.015"


def test_air_heat_capacity_ratio_formulas_only_compute_k_and_gamma_summary():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_air_heat_capacity_ratio.json"
    config = json.loads(config_path.read_text())

    assert set(config["formulas"]) == {"K2", "K4", "K5"}
    for target in ["K35-0", "K36-0", "K37-0"]:
        assert target not in config["formulas"]
        assert target in config["archivedFormulas"]
