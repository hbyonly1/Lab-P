"""
结果导出工具
"""
import csv
import json
from datetime import datetime
from typing import List
from core.models import ProcessingResult
from core.logger import logger


def export_results_to_csv(results: List[ProcessingResult], output_path: str):
    """导出处理结果为CSV"""
    try:
        with open(output_path, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            
            # 写入表头
            writer.writerow([
                '学号', '状态', '处理时长(秒)',
                '成功配置数', '失败配置数', '错误详情'
            ])
            
            # 写入数据
            for result in results:
                data = result.to_dict()
                
                # 格式化错误详情
                error_details = '; '.join([
                    f"配置{e['profile_index']}({e['profile_name']}): "
                    f"{e['error_type']} - {e['error_message']}"
                    for e in data['errors']
                ]) if data['errors'] else '无'
                
                writer.writerow([
                    data['student_id'],
                    data['status'],
                    f"{data['duration_seconds']:.2f}" if data['duration_seconds'] else 'N/A',
                    data['success_count'],
                    data['error_count'],
                    error_details
                ])
        
        logger.log_simple(f"[成功] 结果已导出到: {output_path}", status='success')
        return True
        
    except Exception as e:
        logger.log_simple(f"[失败] 导出CSV失败: {str(e)}", status='error')
        return False


def export_results_to_json(results: List[ProcessingResult], output_path: str):
    """导出详细结果为JSON"""
    try:
        export_data = {
            'export_time': datetime.now().isoformat(),
            'total_students': len(results),
            'summary': {
                'success': sum(1 for r in results if r.status == 'success'),
                'failed': sum(1 for r in results if r.status == 'failed'),
                'pending': sum(1 for r in results if r.status == 'pending')
            },
            'details': [r.to_dict() for r in results]
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        
        logger.log_simple(f"[成功] 详细结果已导出到: {output_path}", status='success')
        return True
        
    except Exception as e:
        logger.log_simple(f"[失败] 导出JSON失败: {str(e)}", status='error')
        return False
