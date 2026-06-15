"""
Local Web Server for Data Verification
"""
import os
import json
import socket
import threading
try:
    from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
except ImportError:
    from http.server import HTTPServer, SimpleHTTPRequestHandler
    import socketserver
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        pass

from urllib.parse import urlparse, parse_qs, unquote
from utils.file_utils import load_json, save_json
from core import logger

class VerificationRequestHandler(SimpleHTTPRequestHandler):
    
    # Define paths
    WEB_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'web')
    
    def do_GET(self):
        # Parse URL
        parsed_path = urlparse(self.path)
        path = unquote(parsed_path.path)
        query = parse_qs(parsed_path.query)
        
        # API: Get student data
        if path == '/api/data':
            self.handle_api_data(query)
            return
            
        # API: Get history
        if path == '/api/history':
            self.handle_api_history()
            return

        # API: Get student images list
        if path == '/api/images':
            self.handle_api_images(query)
            return
            
        # Serve student images/data (from personalData)
        if path.startswith('/personalData/'):
            # Construct absolute path to personalData
            root_dir = self.server.base_dir # Passed from server instance
            file_path = os.path.join(root_dir, path.lstrip('/'))
            
            if os.path.exists(file_path) and os.path.isfile(file_path):
                self.serve_file(file_path)
            else:
                self.send_error(404, "File not found")
            return

        # Serve config (data.json)
        if path == '/data.json':
             config_path = os.path.join(self.server.base_dir, 'data.json')
             if os.path.exists(config_path):
                 self.serve_file(config_path)
             else:
                 self.send_error(404, "Config not found")
             return

        # Default: Serve static web files
        if path == '/':
            path = '/verification.html'
            
        file_path = os.path.join(self.WEB_ROOT, path.lstrip('/'))
        
        if os.path.exists(file_path) and os.path.isfile(file_path):
            self.serve_file(file_path)
        else:
            self.send_error(404, "File not found")

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        
        if path == '/api/save':
            self.handle_api_save()
            return
            
        if path == '/api/verify':
            self.handle_api_verify()
            return

        if path == '/api/complete':
            self.handle_api_complete()
            return
            
        if path == '/api/run_automation':
            self.handle_api_run_automation()
            return
            
        if path == '/api/fix_data':
            self.handle_api_fix_data()
            return

        if path == '/api/save_image':
            self.handle_api_save_image()
            return

        if path == '/api/restart':
            self.handle_api_restart()
            return

        self.send_error(404, "Endpoint not found")

    def handle_api_verify(self):
        """Handle verification status update"""
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            req_data = json.loads(post_data.decode('utf-8'))
            student_id = req_data.get('student_id')
            verified = req_data.get('verified')
            
            if not student_id or verified is None:
                self.send_error(400, "Missing student_id or verified status")
                return

            from utils.history_manager import HistoryManager
            history_mgr = HistoryManager()
            history_mgr.update_verification_status(student_id, verified)
            
            logger.log_simple(f"API: Updated verification status for {student_id} to {verified}", status="info")
            self.send_json({"status": "success"})
            
        except Exception as e:
            logger.log_simple(f"API Error Verify: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_data(self, query):
        """Handle request for student data"""
        student_id = query.get('student_id', [None])[0]
        if not student_id:
            logger.log_simple("API Error: Missing student_id", status="error")
            self.send_error(400, "Missing student_id")
            return
            
        # Construct path
        # Ensure base_dir is effective
        base_dir = getattr(self.server, 'base_dir', os.getcwd())
        
        # Get suffix
        suffix = query.get('suffix', [''])[0]
        
        data_file = os.path.join(base_dir, 'personalData', student_id, f'{student_id}_apiRecognizedData{suffix}.json')
        
        logger.log_simple(f"API: Accessing data file: {data_file}", status="info")
        
        if os.path.exists(data_file):
            try:
                data = load_json(data_file)
                self.send_json(data)
            except Exception as e:
                logger.log_simple(f"API Error loading JSON: {e}", status="error")
                self.send_error(500, str(e))
        else:
            logger.log_simple(f"API Error: File not found: {data_file}", status="warning")
            self.send_error(404, "Data file not found")

    def handle_api_history(self):
        """Handle request for history list"""
        try:
            from utils.history_manager import HistoryManager
            history_mgr = HistoryManager() 
            records = history_mgr.get_all_records()
            self.send_json(records)
        except Exception as e:
            logger.log_simple(f"API Error History: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_save(self):
        """Handle data save"""
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            req_data = json.loads(post_data.decode('utf-8'))
            student_id = req_data.get('student_id')
            data = req_data.get('data')
            suffix = req_data.get('suffix', '')
            
            if not student_id or data is None:
                self.send_error(400, "Missing student_id or data")
                return

            base_dir = getattr(self.server, 'base_dir', os.getcwd())
            data_file = os.path.join(base_dir, 'personalData', student_id, f'{student_id}_apiRecognizedData{suffix}.json')
            
            logger.log_simple(f"API: Saving data to: {data_file}", status="info")
            
            # Ensure directory exists (it should)
            os.makedirs(os.path.dirname(data_file), exist_ok=True)
            
            save_json(data_file, data)
            self.send_json({"status": "success"})
            
        except Exception as e:
            logger.log_simple(f"API Error Save: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_complete(self):
        """Handle completion status update"""
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            req_data = json.loads(post_data.decode('utf-8'))
            student_id = req_data.get('student_id')
            completed = req_data.get('completed')
            
            if not student_id or completed is None:
                self.send_error(400, "Missing student_id or completed status")
                return

            from utils.history_manager import HistoryManager
            history_mgr = HistoryManager()
            history_mgr.update_completion_status(student_id, completed)
            
            logger.log_simple(f"API: Updated completion status for {student_id} to {completed}", status="info")
            self.send_json({"status": "success"})
            
        except Exception as e:
            logger.log_simple(f"API Error Complete: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_run_automation(self):
        """Handle request to run automation script"""
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            req_data = json.loads(post_data.decode('utf-8'))
            student_id = req_data.get('student_id')
            
            if not student_id:
                self.send_error(400, "Missing student_id")
                return

            import subprocess
            
            # Python Path provided by user
            python_path = r"C:\Users\hbyan\AppData\Local\Programs\Python\Python39\python.exe"
            
            # Script directory provided by user
            script_dir = r"D:\Users\hbyan\Downloads\edit\playwright_automation"
            script_name = "parallel_automation.py"
            
            cmd = [python_path, script_name, str(student_id)]
            
            logger.log_simple(f"API: Running automation for {student_id} in {script_dir}", status="info")
            
            # Run in the script's directory so it can find its dependencies/configs
            subprocess.Popen(cmd, cwd=script_dir)
            
            self.send_json({"status": "success", "message": "Automation started"})
            
        except Exception as e:
            logger.log_simple(f"API Error Automation: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_images(self, query):
        """Handle request for student images listing"""
        student_id = query.get('student_id', [None])[0]
        if not student_id:
            logger.log_simple("API Error: Missing student_id for images", status="error")
            self.send_error(400, "Missing student_id")
            return

        base_dir = getattr(self.server, 'base_dir', os.getcwd())
        student_dir = os.path.join(base_dir, 'personalData', student_id)
        
        logger.log_simple(f"API: Listing images in: {student_dir}", status="info")
        
        images = []
        if os.path.exists(student_dir):
            try:
                # Common image extensions
                valid_exts = {'.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'}
                for filename in os.listdir(student_dir):
                    ext = os.path.splitext(filename)[1].lower()
                    if ext in valid_exts:
                        images.append(filename)
                
                # Sort numerically if possible (1.jpg, 2.jpg)
                try:
                    images.sort(key=lambda x: int(os.path.splitext(x)[0]))
                except ValueError:
                    images.sort()
                    
                self.send_json(images)
            except Exception as e:
                logger.log_simple(f"API Error listing images: {e}", status="error")
                self.send_error(500, str(e))
        else:
             logger.log_simple(f"API: Student dir not found: {student_dir}", status="warning")
             self.send_json([]) # Return empty list if dir doesn't exist

    def serve_file(self, file_path):
        """Helper to serve a file"""
        try:
            if not os.path.exists(file_path):
                 logger.log_simple(f"File serve error: Not found {file_path}", status="warning")
                 self.send_error(404, "File not found")
                 return
                 
            with open(file_path, 'rb') as f:
                content = f.read()
            
            self.send_response(200)
            
            # MIME types
            if file_path.endswith('.html'):
                self.send_header('Content-Type', 'text/html; charset=utf-8')
            elif file_path.endswith('.css'):
                self.send_header('Content-Type', 'text/css; charset=utf-8')
            elif file_path.endswith('.js'):
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            elif file_path.endswith('.json'):
                self.send_header('Content-Type', 'application/json; charset=utf-8')
            elif file_path.endswith('.png'):
                self.send_header('Content-Type', 'image/png')
            elif file_path.endswith('.jpg') or file_path.endswith('.jpeg'):
                self.send_header('Content-Type', 'image/jpeg')
            
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, str(e))

    
    def handle_api_fix_data(self):
        """Handle request to fix data for Frank-Hertz experiment"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            req_data = json.loads(post_data.decode('utf-8'))
            
            student_id = req_data.get('student_id')
            suffix = req_data.get('suffix', '') # Should be empty or match _2 etc.
            
            if not student_id:
                self.send_error(400, "Missing student_id")
                return
            
            # Construct path
            base_dir = getattr(self.server, 'base_dir', os.getcwd())
            filename = f'{student_id}_apiRecognizedData{suffix}.json'
            data_file = os.path.join(base_dir, 'personalData', student_id, filename)
            
            if not os.path.exists(data_file):
                 self.send_error(404, "Data file not found")
                 return
                 
            # Fix data
            try:
                from utils.fix_frank_hertz import fix_json_file
                changed = fix_json_file(data_file, student_id)
                self.send_json({"status": "success", "changed": changed})
            except ImportError:
                 self.send_error(500, "Fix module not found")
                 
        except Exception as e:
            logger.log_simple(f"API Error Fix Data: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_save_image(self):
        """Handle request to save chart image"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            req_data = json.loads(post_data.decode('utf-8'))
            
            student_id = req_data.get('student_id')
            image_data = req_data.get('image_data') # Base64 string
            filename = req_data.get('filename', '8.1.jpg')
            
            if not student_id or not image_data:
                self.send_error(400, "Missing student_id or image_data")
                return
            
            base_dir = getattr(self.server, 'base_dir', os.getcwd())
            student_dir = os.path.join(base_dir, 'personalData', student_id)
            
            if not os.path.exists(student_dir):
                 self.send_error(404, "Student dir not found")
                 return
                 
            # Decode image
            import base64
            # Remove header if present (data:image/png;base64,...)
            if 'base64,' in image_data:
                image_data = image_data.split('base64,')[1]
                
            img_bytes = base64.b64decode(image_data)
            
            save_path = os.path.join(student_dir, filename)
            with open(save_path, 'wb') as f:
                f.write(img_bytes)
                
            logger.log_simple(f"API: Saved image to {save_path}", status="info")
            self.send_json({"status": "success", "path": save_path})
            
        except Exception as e:
            logger.log_simple(f"API Error Save Image: {e}", status="error")
            self.send_error(500, str(e))

    def handle_api_restart(self):
        """Restart the application"""
        self.send_json({"status": "restarting"})
        
        def restart():
            import time
            time.sleep(0.5)
            logger.log_simple("Restarting application...", status="warning")
            import sys
            import subprocess
            # Restart using the same python executable and arguments
            # Note: This works best if main.py is the entry point
            # We assume sys.argv[0] is the script
            # If running via IDE/Debugger, this might detach
            subprocess.Popen([sys.executable] + sys.argv)
            os._exit(0)
            
        threading.Thread(target=restart, daemon=True).start()

    def send_json(self, data):
        """Helper to send JSON response"""
        content = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(content))
        self.end_headers()
        self.wfile.write(content)


class VerificationServer:
    """Web Server Controller"""
    
    def __init__(self, base_dir, port=0):
        self.base_dir = base_dir
        self.port = port
        self.httpd = None
        self.thread = None
        self.is_running = False

    def start(self):
        """Start server in a background thread"""
        if self.is_running:
            return

        def run_server():
            # Find a free port if 0
            if self.port == 0:
                # Use socket to find free port
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(('', 0))
                    self.port = s.getsockname()[1]
            
            # Use ThreadingHTTPServer to handle requests concurrently
            # This prevents blocking when one request hangs (e.g. file lock)
            self.httpd = ThreadingHTTPServer(('localhost', self.port), VerificationRequestHandler)
            # Inject base_dir into server instance so handler can access it
            self.httpd.base_dir = self.base_dir
            
            self.is_running = True
            logger.log_simple(f"Web Server started at http://localhost:{self.port}", status='success')
            
            try:
                self.httpd.serve_forever()
            except Exception as e:
                # Expected when shutting down
                pass
            finally:
                self.is_running = False

        self.thread = threading.Thread(target=run_server, daemon=True)
        self.thread.start()
        
        # Wait a bit or return URL
        import time
        # wait for port to be assigned if it was 0
        timeout = 2
        start = time.time()
        while self.port == 0 and time.time() - start < timeout:
            time.sleep(0.1)

    def stop(self):
        """Stop the server"""
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
            self.is_running = False
            logger.log_simple("Web Server stopped", status='info')

    def get_url(self):
        if self.is_running and self.port > 0:
            return f"http://localhost:{self.port}"
        return None
