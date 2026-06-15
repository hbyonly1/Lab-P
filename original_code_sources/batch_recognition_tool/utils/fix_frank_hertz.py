import os
import json
import re

def fix_frank_hertz_data(base_dir):
    personal_data_dir = os.path.join(base_dir, 'personalData')
    if not os.path.exists(personal_data_dir):
        print(f"Directory not found: {personal_data_dir}")
        return

def fix_json_file(file_path, student_id="Unknown"):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        modified = False
        target_exp = "弗兰克赫兹实验"
        
        if target_exp in data:
            exp_data = data[target_exp]
            if 'fill' in exp_data and isinstance(exp_data['fill'], list):
                for item in exp_data['fill']:
                    # item structure: {"id": "F19-0", "value": "10"}
                    item_id = item.get('id', '')
                    
                    # Match F{num}-{suffix}
                    match = re.match(r'^F(\d+)(-.*)?$', item_id)
                    if match:
                        num_str = match.group(1)
                        suffix = match.group(2) or ''
                        num = int(num_str)
                        
                        # Logic: if num >= 20 and num < 90 (sanity check), add 90
                        if 20 <= num < 90:
                            new_num = num + 90
                            new_id = f"F{new_num}{suffix}"
                            
                            print(f"[{student_id}] Changing {item_id} -> {new_id}")
                            item['id'] = new_id
                            modified = True
        
        if modified:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"Saved updates to {os.path.basename(file_path)}")
            return True
            
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
    
    return False

def fix_frank_hertz_data(base_dir):
    personal_data_dir = os.path.join(base_dir, 'personalData')
    if not os.path.exists(personal_data_dir):
        print(f"Directory not found: {personal_data_dir}")
        return

    count = 0
    # Walk through all student directories
    for student_id in os.listdir(personal_data_dir):
        student_dir = os.path.join(personal_data_dir, student_id)
        if not os.path.isdir(student_dir):
            continue

        for filename in os.listdir(student_dir):
            if filename.endswith('.json') and 'apiRecognizedData' in filename:
                file_path = os.path.join(student_dir, filename)
                if fix_json_file(file_path, student_id):
                    count += 1

    print(f"Done. Fixed {count} files.")

if __name__ == "__main__":
    # Assuming script is run from project root or utils
    # If run from utils, parent is root
    # Adjust as needed. Let's assume current working dir is project root
    base_dir = os.getcwd()
    if os.path.basename(base_dir) == 'utils':
        base_dir = os.path.dirname(base_dir)
        
    print(f"Scanning {base_dir}...")
    fix_frank_hertz_data(base_dir)
