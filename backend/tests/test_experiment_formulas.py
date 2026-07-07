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
