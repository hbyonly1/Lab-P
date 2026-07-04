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

def resolve(db_val: str, default_val: str) -> str:
    """Prompt 降级: DB → 系统默认"""
    return db_val or default_val

def format_generation_data_values(form_values: Dict[str, Any], allowed_nodes=None) -> str:
    values = []
    for k, v in form_values.items():
        if v and (allowed_nodes is None or k in allowed_nodes):
            values.append(str(v))
    return "，".join(values)

def build_recognition_prompt(exp_config: dict, recognition_node_ids: List[str], db_template=None) -> str:
    """
    3 段拼接，第3段为自动生成的空 JSON Schema
    """
    system = resolve(
        db_template.recognition_system_prompt if db_template else None,
        DEFAULT_RECOGNITION_SYSTEM
    )
    
    extra = resolve(
        db_template.recognition_extra_prompt if db_template else None,
        ""
    )
    
    schema_str = "{\n" + ",\n".join(f'  "{nid}": ""' for nid in recognition_node_ids) + "\n}"
    
    prompt = f"{system.strip()}\n\n"
    prompt += f"实验名称：{exp_config.get('meta', {}).get('name', '未知')}\n\n"
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
    
    extra = resolve(
        db_template.generation_extra_prompt if db_template else None,
        ""
    )
    
    recognition_nodes = {
        field.get("id")
        for field in exp_config.get("inputs", {}).get("fields", [])
        if field.get("type") == "ai_recognize" and field.get("id")
    }
    allowed_nodes = recognition_nodes
    if db_template and db_template.generation_data_nodes:
        allowed_nodes = {
            n.strip()
            for n in db_template.generation_data_nodes.split(",")
            if n.strip() in recognition_nodes
        }
        
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
    Build one prompt for all experiment questions. The generation prompt template
    still follows the same DB -> JSON -> default precedence as the single-answer
    flow did.
    """
    system = resolve(
        db_template.generation_system_prompt if db_template else None,
        DEFAULT_GENERATION_SYSTEM
    )

    extra = resolve(
        db_template.generation_extra_prompt if db_template else None,
        ""
    )

    recognition_nodes = {
        field.get("id")
        for field in exp_config.get("inputs", {}).get("fields", [])
        if field.get("type") == "ai_recognize" and field.get("id")
    }
    allowed_nodes = recognition_nodes
    if db_template and db_template.generation_data_nodes:
        allowed_nodes = {
            n.strip()
            for n in db_template.generation_data_nodes.split(",")
            if n.strip() in recognition_nodes
        }

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
