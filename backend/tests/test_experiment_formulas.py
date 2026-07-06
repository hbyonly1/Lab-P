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
