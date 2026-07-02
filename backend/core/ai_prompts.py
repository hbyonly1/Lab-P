from typing import List, Dict, Any

DEFAULT_RECOGNITION_SYSTEM = """
你是一个严格的实验手写数据提取器。
- 只从图片提取，不得推断、猜测、虚构
- 字段看不清则保持为空字符串""
- 只返回 JSON，不输出任何说明文字
"""

DEFAULT_GENERATION_SYSTEM = """
你是一名物理实验助教。用中文学术性语言回答实验思考题，每次视角和侧重点不同。
"""

def resolve(db_val: str, json_val: str, default_val: str) -> str:
    """Prompt 降级: DB → JSON → 系统默认"""
    return db_val or json_val or default_val

def build_recognition_prompt(exp_config: dict, extract_node_ids: List[str], db_template=None) -> str:
    """
    3 段拼接，第3段为自动生成的空 JSON Schema
    """
    json_config = exp_config.get("ai", {}).get("recognition", {})
    
    system = resolve(
        db_template.recognition_system_prompt if db_template else None,
        json_config.get("system_prompt"),
        DEFAULT_RECOGNITION_SYSTEM
    )
    
    extra = resolve(
        db_template.recognition_extra_prompt if db_template else None,
        json_config.get("extra_prompt"),
        ""
    )
    
    # 将所有需提取的节点序列化为空 JSON Schema
    schema_str = "{\n" + ",\n".join(f'  "{nid}": ""' for nid in extract_node_ids) + "\n}"
    
    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n\n"
    prompt += f"请从图片中提取数据，按以下 JSON 格式返回，不得输出其他内容：\n{schema_str}\n\n"
    if extra:
        prompt += f"{extra.strip()}"
        
    return prompt.strip()

def build_generation_prompt(question: str, form_values: Dict[str, Any], exp_config: dict, db_template=None) -> str:
    """
    3 段拼接，注入真实数据
    """
    json_config = exp_config.get("ai", {}).get("generation", {})
    
    system = resolve(
        db_template.generation_system_prompt if db_template else None,
        json_config.get("system_prompt"),
        DEFAULT_GENERATION_SYSTEM
    )
    
    extra = resolve(
        db_template.generation_extra_prompt if db_template else None,
        json_config.get("extra_prompt"),
        ""
    )
    
    allowed_nodes = None
    if db_template and db_template.generation_data_nodes:
        allowed_nodes = [n.strip() for n in db_template.generation_data_nodes.split(",") if n.strip()]
        
    filtered_values = {}
    for k, v in form_values.items():
        if v and (allowed_nodes is None or k in allowed_nodes):
            filtered_values[k] = v
            
    data_lines = "\n".join(f"- {k} = {v}" for k, v in filtered_values.items())
    
    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n"
    if data_lines:
        prompt += f"本次实验关键数据：\n{data_lines}\n\n"
    prompt += f"问题：\n{question}\n\n"
    if extra:
        prompt += f"附加说明：\n{extra.strip()}"
        
    return prompt.strip()

def build_generation_answers_prompt(questions: List[Dict[str, Any]], form_values: Dict[str, Any], exp_config: dict, db_template=None) -> str:
    """
    Build one prompt for all experiment questions. The generation prompt template
    still follows the same DB -> JSON -> default precedence as the single-answer
    flow did.
    """
    json_config = exp_config.get("ai", {}).get("generation", {})

    system = resolve(
        db_template.generation_system_prompt if db_template else None,
        json_config.get("system_prompt"),
        DEFAULT_GENERATION_SYSTEM
    )

    extra = resolve(
        db_template.generation_extra_prompt if db_template else None,
        json_config.get("extra_prompt"),
        ""
    )

    allowed_nodes = None
    if db_template and db_template.generation_data_nodes:
        allowed_nodes = [n.strip() for n in db_template.generation_data_nodes.split(",") if n.strip()]

    filtered_values = {}
    for k, v in form_values.items():
        if v and (allowed_nodes is None or k in allowed_nodes):
            filtered_values[k] = v

    data_lines = "\n".join(f"- {k} = {v}" for k, v in filtered_values.items())
    question_lines = "\n".join(
        f"{q.get('index')}. [{q.get('nodeId')}] {q.get('title') or ''}"
        for q in questions
    )

    schema_lines = ",\n".join(
        f'    {{"index": {q.get("index")}, "answer": ""}}'
        for q in questions
    )

    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n"
    if data_lines:
        prompt += f"本次实验关键数据：\n{data_lines}\n\n"
    prompt += f"请一次性回答以下全部实验分析与拓展问题：\n{question_lines}\n\n"
    prompt += "必须按题号对应回答，不要合并题目，不要改变题号。\n"
    prompt += "只返回 JSON object，不输出其他文字。格式如下：\n"
    prompt += "{\n"
    prompt += '  "answers": [\n'
    prompt += schema_lines
    prompt += "\n  ]\n}\n\n"
    if extra:
        prompt += f"附加说明：\n{extra.strip()}"

    return prompt.strip()
