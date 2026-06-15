"""
配置格式解析器
"""
import re
from typing import List, Dict


def parse_format(format_str: str) -> List[str]:
    """解析配置格式字符串
    
    支持的格式：
    - DXYJ10-{0..10} -> ['DXYJ10-0', 'DXYJ10-1', ..., 'DXYJ10-10']
    - V{1..5} -> ['V1', 'V2', 'V3', 'V4', 'V5']
    - I{0..3} -> ['I0', 'I1', 'I2', 'I3']
    
    Args:
        format_str: 格式字符串
        
    Returns:
        展开后的字符串列表
    """
    # 匹配 {start..end} 格式
    pattern = r'\{(\d+)\.\.(\d+)\}'
    match = re.search(pattern, format_str)
    
    if not match:
        # 如果没有匹配到，直接返回原字符串
        return [format_str]
    
    start = int(match.group(1))
    end = int(match.group(2))
    
    # 展开范围
    result = []
    for i in range(start, end + 1):
        expanded = format_str.replace(match.group(0), str(i))
        result.append(expanded)
    
    return result


def group_by_prefix(keys: List[str], separator: str = '-') -> Dict[str, List[str]]:
    """按前缀分组键名
    
    例如：
    ['DXYJ10-0', 'DXYJ10-1', 'DXYJ11-0', 'DXYJ11-1']
    -> {
        'DXYJ10': ['DXYJ10-0', 'DXYJ10-1'],
        'DXYJ11': ['DXYJ11-0', 'DXYJ11-1']
    }
    
    Args:
        keys: 键名列表
        separator: 分隔符，默认为'-'
        
    Returns:
        按前缀分组的字典
    """
    groups = {}
    
    for key in keys:
        if separator in key:
            prefix = key.split(separator)[0]
        else:
            prefix = key
        
        if prefix not in groups:
            groups[prefix] = []
        
        groups[prefix].append(key)
    
    return groups


def parse_and_group(format_str: str, separator: str = '-') -> Dict[str, List[str]]:
    """解析格式并分组
    
    Args:
        format_str: 格式字符串
        separator: 分隔符
        
    Returns:
        按前缀分组的字典
    """
    keys = parse_format(format_str)
    return group_by_prefix(keys, separator)
