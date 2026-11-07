param([int]$WaitMaxSec = 900)
$ErrorActionPreference = 'Continue'
$ESC = [char]27
function Strip($s) {
  $a = ($s -replace '^\S+Z\s*', '')
  $a = $a -replace ($ESC + '\[[0-9;]*m'), ''
  return $a.TrimEnd()
}
$sec = 'F:\dsh-admited\data\portable-secrets.env'
$token = $null
foreach ($line in (Get-Content $sec -Encoding UTF8)) { if ($line -match 'set\s+"GH_TOKEN=(.+)"\s*$') { $token = $Matches[1] } }
$h = @{ Authorization = "token $token"; 'User-Agent' = 'wordo' }
$proxy = 'http://127.0.0.1:7890'

$waited = 0
while ($waited -lt $WaitMaxSec) {
  $runs = Invoke-RestMethod 'https://api.github.com/repos/WindyPro-rourou/wordo/actions/runs?per_page=1' -Headers $h -Proxy $proxy -TimeoutSec 30
  $r = $runs.workflow_runs[0]
  Write-Output ("run {0} sha={1} status={2} conclusion={3}" -f $r.id, $r.head_sha.Substring(0,7), $r.status, $r.conclusion)
  if ($r.status -eq 'completed') { break }
  Start-Sleep -Seconds 25
  $waited += 25
}
if ($r.status -ne 'completed') { Write-Output 'TIMEOUT waiting'; exit 0 }

$jobs = Invoke-RestMethod ("https://api.github.com/repos/WindyPro-rourou/wordo/actions/runs/{0}/jobs" -f $r.id) -Headers $h -Proxy $proxy -TimeoutSec 30
foreach ($j in $jobs.jobs) { Write-Output ("JOB {0} => {1} (id={2})" -f $j.name, $j.conclusion, $j.id) }

foreach ($j in ($jobs.jobs | Where-Object { $_.conclusion -eq 'failure' })) {
  $out = "$env:TEMP\ci-$($j.id).log"
  try {
    Invoke-WebRequest ("https://api.github.com/repos/WindyPro-rourou/wordo/actions/jobs/{0}/logs" -f $j.id) -Headers $h -Proxy $proxy -OutFile $out -MaximumRedirection 5 -TimeoutSec 120
    $txt = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($out))
    $lines = $txt -split "`r?`n"
    Write-Output ("----- {0} : errors -----" -f $j.name)
    $errs = $lines | Where-Object { $_ -match 'error(\[E\d+\])?:|error: could not compile|panicked at|cannot find|note: ' } | Select-Object -First 30
    if ($errs) { $errs | ForEach-Object { Strip $_ } }
    else { Write-Output '(no error keywords; tail 25)'; $lines | Select-Object -Last 25 | ForEach-Object { Strip $_ } }
  } catch { Write-Output ("fetch log failed for {0}: {1}" -f $j.name, $_.Exception.Message) }
}
