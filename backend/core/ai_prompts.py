import re
from typing import List, Dict, Any

DEFAULT_RECOGNITION_SYSTEM = """
不推断、不补全、不计算；看不清填""；注意单位，按表头和行名要求换算成目标表格数值，不带单位；只返回 JSON object。
"""

DEFAULT_GENERATION_SYSTEM = """
回答问题时直接输出答案即可，不要输出“原因是：”的字样，不要采用任何markdown和序号，每一点用句号分割即可。
"""

def resolve(db_val: str, default_val: str) -> str:
    """Prompt fallback: database system prompt -> Python default."""
    return db_val or default_val

def _plain_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()

def _recognition_extra_prompt(exp_config: dict) -> str:
    return _plain_text(exp_config.get("ai", {}).get("recognition", {}).get("extraPrompt"))

def _generation_extra_prompt(exp_config: dict) -> str:
    return _plain_text(exp_config.get("ai", {}).get("generation", {}).get("extraPrompt"))

def _compact_label(value: Any) -> str:
    text = _plain_text(value)
    if not text:
        return ""
    text = re.sub(r"[（(][^）)]*[）)]", "", text)
    text = re.sub(r"/[A-Za-zμΩ℃°·^0-9-]+$", "", text)
    return text.strip()

def _recognition_field_map(exp_config: dict) -> Dict[str, Dict[str, Any]]:
    return {
        field.get("id"): field
        for field in exp_config.get("inputs", {}).get("fields", [])
        if field.get("id")
    }

def _iter_data_tables(exp_config: dict) -> List[dict]:
    ui = exp_config.get("ui", {})
    tables = []
    data_tables = ui.get("dataTables")
    if isinstance(data_tables, list):
        tables.extend(item for item in data_tables if isinstance(item, dict))

    data_table = ui.get("dataTable")
    if isinstance(data_table, list):
        tables.extend(item for item in data_table if isinstance(item, dict))
    elif isinstance(data_table, dict):
        tables.append(data_table)

    return tables

def _expand_cells(cells: List[dict]) -> List[dict]:
    expanded = []
    for cell in cells or []:
        if not isinstance(cell, dict):
            continue
        span = int(cell.get("colSpan") or 1)
        span = max(span, 1)
        for span_idx in range(span):
            expanded.append({
                **cell,
                "_span_index": span_idx,
                "_is_span_shadow": span_idx > 0,
            })
    return expanded

def _format_axis_list(items: List[Any]) -> str:
    return "[" + ",".join(_compact_label(item) for item in items) + "]"

def _format_raw_axis_list(items: List[Any]) -> str:
    return "[" + ",".join(_plain_text(item) for item in items) + "]"

def _format_node_list(items: List[Any]) -> str:
    return "[" + ",".join(_plain_text(item) for item in items) + "]"

def _raw_labels_differ(raw_items: List[Any], compact_items: List[Any]) -> bool:
    if len(raw_items) != len(compact_items):
        return True
    return any(_plain_text(raw) != _compact_label(compact) for raw, compact in zip(raw_items, compact_items))

def _format_node_matrix(rows: List[List[str]]) -> str:
    if len(rows) == 1:
        return "[" + _format_node_list(rows[0]) + "]"
    return "[" + ",".join(_format_node_list(row) for row in rows) + "]"

def _row_has_node(row: dict) -> bool:
    return any(
        isinstance(cell, dict) and bool(cell.get("nodeId"))
        for cell in row.get("cells") or []
    )

def _row_is_local_axis_header(row: dict) -> bool:
    if not isinstance(row, dict) or row.get("isHeader") or _row_has_node(row):
        return False
    text_cells = [
        cell for cell in row.get("cells") or []
        if isinstance(cell, dict) and _plain_text(cell.get("text"))
    ]
    return len(text_cells) > 1

def _split_rows_by_local_axis_headers(rows: List[dict]) -> List[List[dict]]:
    groups = []
    current_headers = []
    current_data_rows = []

    def flush_current():
        nonlocal current_headers, current_data_rows
        if current_headers and current_data_rows:
            groups.append(current_headers + current_data_rows)
        current_data_rows = []

    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if row.get("isHeader"):
            if current_data_rows:
                flush_current()
                current_headers = []
            current_headers.append({**row, "isHeader": True})
            continue
        if _row_is_local_axis_header(row) and not current_data_rows:
            current_headers.append({**row, "isHeader": True})
            continue
        if _row_is_local_axis_header(row):
            flush_current()
            current_headers = [{**row, "isHeader": True}]
            continue
        current_data_rows.append(row)

    flush_current()
    if groups:
        return groups
    return [rows] if rows else []

def _legacy_pattern_node_id(pattern: str, row_idx: int, col_idx: int, row_count: int) -> str:
    if not pattern:
        return ""
    node_id = pattern.replace("{r}", str(row_idx)).replace("{c}", str(col_idx))
    if "{" not in node_id and row_count == 1:
        return node_id
    if "{" not in node_id and row_count > 1 and node_id != pattern:
        return node_id
    return node_id if "{" not in node_id else ""

def _build_rows_axis_mapping(table: dict, recognition_set: set[str]) -> tuple[str, set[str]]:
    rows = table.get("rows") or []
    expanded_rows = [_expand_cells(row.get("cells") or []) for row in rows if isinstance(row, dict)]
    header_by_col: Dict[int, List[str]] = {}
    header_raw_by_col: Dict[int, List[str]] = {}

    for row, expanded in zip(rows, expanded_rows):
        if not isinstance(row, dict) or not row.get("isHeader"):
            continue
        for col_idx, cell in enumerate(expanded):
            if cell.get("_is_span_shadow"):
                continue
            raw_text = _plain_text(cell.get("text"))
            text = _compact_label(raw_text)
            if text:
                header_by_col.setdefault(col_idx, []).append(text)
                header_raw_by_col.setdefault(col_idx, []).append(raw_text or text)

    row_labels = []
    row_raw_labels = []
    col_order = []
    col_raw_by_label = {}
    matrix = []
    covered = set()

    for row, expanded in zip(rows, expanded_rows):
        if not isinstance(row, dict) or row.get("isHeader"):
            continue

        row_label = _compact_label(row.get("label"))
        row_raw_label = _plain_text(row.get("label"))
        if not row_label:
            for cell in expanded:
                if not cell.get("nodeId"):
                    raw_text = _plain_text(cell.get("text"))
                    row_label = _compact_label(raw_text)
                    if row_label:
                        row_raw_label = raw_text
                        break

        row_nodes_by_col = {}
        for col_idx, cell in enumerate(expanded):
            node_id = cell.get("nodeId")
            if not node_id or node_id not in recognition_set or cell.get("_is_span_shadow"):
                continue
            header = "/".join(_compact_label(item) for item in header_by_col.get(col_idx, []) if item)
            header = header or f"c{col_idx + 1}"
            raw_header = "/".join(_plain_text(item) for item in header_raw_by_col.get(col_idx, []) if item)
            raw_header = raw_header or header
            row_nodes_by_col[header] = node_id
            if header not in col_order:
                col_order.append(header)
                col_raw_by_label[header] = raw_header

        if row_nodes_by_col:
            resolved_row_label = row_label or str(len(row_labels) + 1)
            row_labels.append(resolved_row_label)
            row_raw_labels.append(row_raw_label or resolved_row_label)
            matrix.append(row_nodes_by_col)

    if not matrix or not col_order:
        return "", covered

    node_matrix = []
    for row_nodes_by_col in matrix:
        row_nodes = []
        for col in col_order:
            node_id = row_nodes_by_col.get(col, "")
            row_nodes.append(node_id)
            if node_id:
                covered.add(node_id)
        node_matrix.append(row_nodes)

    row_axis = "/".join(header_by_col.get(0, [])) or "row"
    row_axis_raw = "/".join(header_raw_by_col.get(0, [])) or row_axis
    col_raw_labels = [col_raw_by_label.get(col, col) for col in col_order]
    lines = [
        "table:",
        f"row_axis={_compact_label(row_axis) or 'row'}",
    ]
    if _plain_text(row_axis_raw) != _compact_label(row_axis):
        lines.append(f"row_axis_label={_plain_text(row_axis_raw)}")
    lines.append(f"rows={_format_axis_list(row_labels)}")
    if _raw_labels_differ(row_raw_labels, row_labels):
        lines.append(f"row_labels={_format_raw_axis_list(row_raw_labels)}")
    lines.append(f"cols={_format_axis_list(col_order)}")
    if _raw_labels_differ(col_raw_labels, col_order):
        lines.append(f"col_labels={_format_raw_axis_list(col_raw_labels)}")
    lines.append(f"node_matrix={_format_node_matrix(node_matrix)}")
    return "\n".join(lines), covered

def _build_legacy_columns_axis_mapping(table: dict, recognition_set: set[str]) -> tuple[str, set[str]]:
    row_count = max(int(table.get("rowCount") or 0), 1)
    row_labels = table.get("rowLabels") or []
    columns = table.get("columns") or []
    first_column_label = _compact_label(columns[0].get("text")) if columns and isinstance(columns[0], dict) else ""
    cols = []
    matrix = []
    covered = set()

    for row_idx in range(1, row_count + 1):
        row_nodes = []
        row_has_node = False
        for col_idx, column in enumerate(columns[1:], start=1):
            if not isinstance(column, dict):
                continue
            pattern = column.get("nodePattern") or column.get("nodeId") or table.get("nodePattern")
            node_id = _legacy_pattern_node_id(_plain_text(pattern), row_idx, col_idx - 1, row_count)
            if not node_id or node_id not in recognition_set:
                continue
            if row_idx == 1:
                cols.append(_compact_label(column.get("text")) or f"c{col_idx + 1}")
            row_nodes.append(node_id)
            row_has_node = True
            covered.add(node_id)
        if row_has_node:
            matrix.append(row_nodes)

    if not matrix or not cols:
        return "", covered

    resolved_rows = [
        _compact_label(row_labels[idx]) if idx < len(row_labels) else str(idx + 1)
        for idx in range(len(matrix))
    ]

    if len(matrix) == 1:
        target = resolved_rows[0] if resolved_rows else "value"
        lines = [
            "table:",
            f"target={target}",
            f"by={first_column_label or 'col'}",
            f"cols={_format_axis_list(cols)}",
            f"nodes={_format_node_list(matrix[0])}",
        ]
        return "\n".join(lines), covered

    lines = [
        "table:",
        f"row_axis={first_column_label or 'row'}",
        f"rows={_format_axis_list(resolved_rows)}",
        f"cols={_format_axis_list(cols)}",
        f"node_matrix={_format_node_matrix(matrix)}",
    ]
    return "\n".join(lines), covered

def _build_data_table_axis_mappings(exp_config: dict, recognition_node_ids: List[str]) -> tuple[str, set[str]]:
    recognition_set = set(recognition_node_ids)
    sections = []
    covered = set()

    for table in _iter_data_tables(exp_config):
        text = ""
        table_covered = set()
        if isinstance(table.get("rows"), list):
            sections_for_table = []
            covered_for_table = set()
            for group_rows in _split_rows_by_local_axis_headers(table.get("rows") or []):
                group_text, group_covered = _build_rows_axis_mapping(
                    {**table, "rows": group_rows},
                    recognition_set,
                )
                if group_text:
                    sections_for_table.append(group_text)
                    covered_for_table.update(group_covered)
            text = "\n".join(sections_for_table)
            table_covered = covered_for_table
        if not text and isinstance(table.get("columns"), list):
            text, table_covered = _build_legacy_columns_axis_mapping(table, recognition_set)
        if text:
            sections.append(text)
            covered.update(table_covered)

    return "\n".join(sections), covered

def _build_recognition_mapping(exp_config: dict, recognition_node_ids: List[str]) -> str:
    fields = _recognition_field_map(exp_config)
    explicit_hints = exp_config.get("ai", {}).get("recognition", {}).get("nodeHints") or {}
    axis_mapping, covered_node_ids = _build_data_table_axis_mappings(exp_config, recognition_node_ids)

    lines = []
    if axis_mapping:
        lines.append(axis_mapping)

    for node_id in recognition_node_ids:
        field = fields.get(node_id) or {}
        hint = (
            _plain_text(field.get("recognitionHint"))
            or _plain_text(explicit_hints.get(node_id))
        )
        if not hint and node_id in covered_node_ids:
            continue
        if not hint:
            node_type = field.get("type") or "ai_recognize"
            label = _plain_text(field.get("label") or field.get("title"))
            if label:
                hint = f"{label}，{node_type}字段，请按图片上下文提取对应值"
            else:
                hint = f"{node_type}字段，请按实验配置和图片上下文提取对应值"
        lines.append(f"{node_id}: {hint}")

    return "\n\n".join(lines)

def format_generation_data_values(form_values: Dict[str, Any], allowed_nodes=None) -> str:
    values = []
    for k, v in form_values.items():
        if v and (allowed_nodes is None or k in allowed_nodes):
            values.append(str(v))
    return "，".join(values)

def _configured_generation_data_nodes(exp_config: dict, recognition_node_ids: List[str]) -> set[str]:
    fields = {
        field.get("id")
        for field in exp_config.get("inputs", {}).get("fields", [])
        if field.get("id")
    }
    config_nodes = exp_config.get("ai", {}).get("generation", {}).get("dataNodes")
    if isinstance(config_nodes, list):
        selected = {
            _plain_text(node_id)
            for node_id in config_nodes
            if _plain_text(node_id) in fields
        }
        if selected:
            return selected

    return set(recognition_node_ids[:3])

def build_recognition_prompt(exp_config: dict, recognition_node_ids: List[str], db_template=None) -> str:
    """
    3 段拼接，第3段为自动生成的空 JSON Schema
    """
    system = resolve(
        db_template.recognition_system_prompt if db_template else None,
        DEFAULT_RECOGNITION_SYSTEM
    )
    
    extra = _recognition_extra_prompt(exp_config)
    
    schema_str = "{\n" + ",\n".join(f'  "{nid}": ""' for nid in recognition_node_ids) + "\n}"
    node_hints = _build_recognition_mapping(exp_config, recognition_node_ids)
    
    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n\n"
    if node_hints:
        prompt += "字段映射：\n"
        prompt += f"{node_hints}\n\n"
    prompt += "按字段映射把图片中的对应手写值填入 nodeId。\n\n"
    prompt += f"返回格式如下：\n{schema_str}\n\n"
    if extra:
        prompt += f"{extra.strip()}"
        
    return prompt.strip()

def build_generation_prompt(question: str, form_values: Dict[str, Any], exp_config: dict, db_template=None) -> str:
    """
    3 段拼接，注入真实数据
    """
    system = resolve(
        db_template.generation_system_prompt if db_template else None,
        DEFAULT_GENERATION_SYSTEM
    )
    
    extra = _generation_extra_prompt(exp_config)
    
    recognition_node_ids = [
        field.get("id")
        for field in exp_config.get("inputs", {}).get("fields", [])
        if field.get("type") == "ai_recognize" and field.get("id")
    ]
    allowed_nodes = _configured_generation_data_nodes(exp_config, recognition_node_ids)
        
    data_values = format_generation_data_values(form_values, allowed_nodes)
    
    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n"
    if data_values:
        prompt += f"本次实验关键数据：{data_values}\n\n"
    prompt += f"问题：\n{question}\n\n"
    if extra:
        prompt += f"附加说明：\n{extra.strip()}"
        
    return prompt.strip()

def build_generation_answers_prompt(questions: List[Dict[str, Any]], form_values: Dict[str, Any], exp_config: dict, db_template=None) -> str:
    """
    Build one prompt for all experiment questions.
    """
    system = resolve(
        db_template.generation_system_prompt if db_template else None,
        DEFAULT_GENERATION_SYSTEM
    )

    extra = _generation_extra_prompt(exp_config)

    recognition_node_ids = [
        field.get("id")
        for field in exp_config.get("inputs", {}).get("fields", [])
        if field.get("type") == "ai_recognize" and field.get("id")
    ]
    allowed_nodes = _configured_generation_data_nodes(exp_config, recognition_node_ids)

    data_values = format_generation_data_values(form_values, allowed_nodes)
    question_lines = "\n".join(
        f"{q.get('index')}. [{q.get('nodeId')}] {q.get('title') or ''}"
        for q in questions
    ) or "当前实验配置中暂无实验分析与拓展问题。"

    schema_lines = ",\n".join(
        f'  "{q.get("index")}": ""'
        for q in questions
    ) or '  "1": ""'

    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n"
    if data_values:
        prompt += f"{data_values}\n\n"
    prompt += f"请回答以下实验分析与拓展问题：\n{question_lines}\n\n"
    prompt += "只返回 JSON object。格式如下：\n"
    prompt += "{\n"
    prompt += schema_lines
    prompt += "\n}\n\n"
    if extra:
        prompt += f"附加说明：\n{extra.strip()}"

    return prompt.strip()
