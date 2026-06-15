$ports = 8888..8907
foreach ($port in $ports) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop
        foreach ($conn in $connections) {
            $pid_ = $conn.OwningProcess
            if ($pid_) {
                Write-Host "Killing PID $pid_ on port $port"
                Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # Port not in use, skip
    }
}
Write-Host "Port cleanup finished."
