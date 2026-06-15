"""
测试文件服务器
验证所有文件是否可访问
"""
import os
import json
import http.server
import socketserver
import threading
import time


def test_file_server():
    """测试文件服务器"""
    
    # 读取配置
    with open('config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    data_directory = config['data_directory']
    port = config['file_server_port']
    
    print(f"测试文件服务器")
    print(f"{'='*60}")
    print(f"数据目录: {data_directory}")
    print(f"端口: {port}")
    print(f"{'='*60}\n")
    
    # 检查目录是否存在
    if not os.path.exists(data_directory):
        print(f"❌ 错误: 目录不存在: {data_directory}")
        return
    
    print(f"✓ 目录存在\n")
    
    # 列出目录内容
    print("目录结构:")
    print("-" * 60)
    
    # data.json
    data_json_path = os.path.join(data_directory, "data.json")
    if os.path.exists(data_json_path):
        print(f"✓ data.json ({os.path.getsize(data_json_path)} bytes)")
    else:
        print(f"❌ data.json 不存在")
    
    # personalData 目录
    personal_data_dir = os.path.join(data_directory, "personalData")
    if os.path.exists(personal_data_dir):
        print(f"✓ personalData/")
        
        # 列出学号目录
        student_dirs = [d for d in os.listdir(personal_data_dir) 
                       if os.path.isdir(os.path.join(personal_data_dir, d))]
        
        for student_id in student_dirs[:5]:  # 只显示前5个
            student_dir = os.path.join(personal_data_dir, student_id)
            files = os.listdir(student_dir)
            
            # 统计文件类型
            jpg_count = sum(1 for f in files if f.endswith('.jpg'))
            json_count = sum(1 for f in files if f.endswith('.json'))
            
            print(f"  ✓ {student_id}/ ({jpg_count} 图片, {json_count} JSON)")
            
            # 检查 apiRecognizedData.json
            api_json = f"{student_id}_apiRecognizedData.json"
            if api_json in files:
                print(f"    ✓ {api_json}")
        
        if len(student_dirs) > 5:
            print(f"  ... 还有 {len(student_dirs) - 5} 个学号目录")
    else:
        print(f"❌ personalData/ 不存在")
    
    print("-" * 60)
    print(f"\n启动文件服务器...")
    
    # 启动服务器
    original_dir = os.getcwd()
    os.chdir(data_directory)
    
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("", port), handler)
    
    thread = threading.Thread(target=httpd.serve_forever)
    thread.daemon = True
    thread.start()
    
    os.chdir(original_dir)
    
    print(f"✓ 文件服务器已启动: http://localhost:{port}")
    print(f"\n可访问的 URL:")
    print(f"  - http://localhost:{port}/data.json")
    print(f"  - http://localhost:{port}/personalData/")
    
    if student_dirs:
        example_student = student_dirs[0]
        print(f"  - http://localhost:{port}/personalData/{example_student}/")
        print(f"  - http://localhost:{port}/personalData/{example_student}/{example_student}_apiRecognizedData.json")
    
    print(f"\n按 Ctrl+C 停止服务器...")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n停止服务器...")
        httpd.shutdown()
        print("✓ 服务器已停止")


if __name__ == "__main__":
    test_file_server()
