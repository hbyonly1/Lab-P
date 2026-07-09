export function resolveStudentNo(...sources) {
  for (const source of sources) {
    const value = source?.student_no
      || source?.studentNo
      || source?.student_username
      || source?.studentUsername
      || source?.student?.student_no
      || source?.student?.studentNo
      || source?.student?.student_username
      || source?.student?.studentUsername
      || source?.user?.student_no
      || source?.user?.studentNo
      || source?.user?.student_username
      || source?.user?.studentUsername
      || source?.messageParams?.studentNo
      || source?.messageParams?.student_no
      || source?.messageParams?.studentUsername
      || source?.messageParams?.student_username
      || source?.message_params?.student_no;
    if (value) return String(value);
  }
  return '';
}

export function formatStudentTaskTitle(...parts) {
  return parts
    .flat()
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}
