from typing import Any, Dict, List

import simpleeval

from services.experiment_formulas import FormulaInputError, build_formula_functions


class FormulaComputeError(Exception):
    pass


class FormulaInputIncomplete(FormulaComputeError):
    def __init__(self, missing_node_ids: List[str]):
        self.missing_node_ids = missing_node_ids
        super().__init__("FORMULA_INPUT_INCOMPLETE")


class FormulaDependencyUnresolved(FormulaComputeError):
    def __init__(self, unresolved_targets: List[str], missing_computed_node_ids: List[str]):
        self.unresolved_targets = unresolved_targets
        self.missing_computed_node_ids = missing_computed_node_ids
        super().__init__("FORMULA_DEPENDENCY_UNRESOLVED")


def compute_formula_values(formulas: Dict[str, str], current_form_values: Dict[str, Any]) -> Dict[str, Any]:
    formulas = formulas or {}
    formula_targets = {target for target, formula in formulas.items() if formula}
    form_values = {
        key: value
        for key, value in dict(current_form_values or {}).items()
        if key not in formula_targets
    }
    pending_formulas = {
        target: formula
        for target, formula in formulas.items()
        if formula
    }
    unresolved_missing: Dict[str, List[str]] = {}
    evaluator = simpleeval.SimpleEval()

    max_iterations = max(len(pending_formulas) + 1, 1)
    for _ in range(max_iterations):
        if not pending_formulas:
            break
        progressed = False
        names = {}
        for key, value in form_values.items():
            try:
                if isinstance(value, str) and value.strip() != "":
                    names[key] = float(value)
                else:
                    names[key] = value
            except ValueError:
                names[key] = value
        evaluator.names = names
        evaluator.functions.update(build_formula_functions(names))

        for target_node, formula_str in list(pending_formulas.items()):
            try:
                result = evaluator.eval(formula_str)
                result_str = f"{result:.4g}" if isinstance(result, float) else str(result)
                if form_values.get(target_node) != result_str:
                    form_values[target_node] = result_str
                pending_formulas.pop(target_node, None)
                unresolved_missing.pop(target_node, None)
                progressed = True
            except FormulaInputError as exc:
                unresolved_missing[target_node] = exc.missing_node_ids
            except KeyError as exc:
                missing_node = str(exc.args[0]) if exc.args else ""
                unresolved_missing[target_node] = [missing_node] if missing_node else []
            except Exception as exc:
                raise FormulaComputeError(str(exc)) from exc

        if not progressed:
            break

    if pending_formulas:
        missing_raw_node_ids = []
        missing_computed_node_ids = []
        for target_node in pending_formulas:
            for node_id in unresolved_missing.get(target_node, []):
                if node_id in formula_targets:
                    missing_computed_node_ids.append(node_id)
                else:
                    missing_raw_node_ids.append(node_id)
        missing_raw_node_ids = list(dict.fromkeys(missing_raw_node_ids))
        missing_computed_node_ids = list(dict.fromkeys(missing_computed_node_ids))

        if missing_raw_node_ids:
            raise FormulaInputIncomplete(missing_raw_node_ids)
        raise FormulaDependencyUnresolved(sorted(pending_formulas), missing_computed_node_ids)

    return form_values
