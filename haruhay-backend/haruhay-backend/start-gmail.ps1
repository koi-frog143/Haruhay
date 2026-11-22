param(
    [string]$SenderEmail = 'earldomingo165@gmail.com'
)
$ErrorActionPreference = 'Stop'

# Process-local environment only; never write passwords to a file or pass them in command arguments.
$names = @('GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD', 'DEV_OWNER_EMAIL', 'DEV_OWNER_PASSWORD')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$gmailSecret = $null
$ownerSecret = $null
Push-Location $PSScriptRoot
try {
    $env:GMAIL_ADDRESS = $SenderEmail
    if (-not $env:GMAIL_APP_PASSWORD) {
        $gmailSecret = Read-Host 'Google app password (16 characters, not your normal Gmail password)' -AsSecureString
        $env:GMAIL_APP_PASSWORD = ([System.Net.NetworkCredential]::new('', $gmailSecret)).Password -replace '\s', ''
    }
    if ($env:GMAIL_APP_PASSWORD.Length -ne 16) { throw 'Use the 16-character Google app password. Generate it at https://myaccount.google.com/apppasswords.' }
    if (-not $env:DEV_OWNER_EMAIL) { $env:DEV_OWNER_EMAIL = $SenderEmail }
    if (-not $env:DEV_OWNER_PASSWORD) {
        $ownerSecret = Read-Host 'Haruhay owner password (separate from Gmail; 12+ characters)' -AsSecureString
        $env:DEV_OWNER_PASSWORD = ([System.Net.NetworkCredential]::new('', $ownerSecret)).Password
    }
    if ($env:DEV_OWNER_PASSWORD.Length -lt 12 -or [System.Text.Encoding]::UTF8.GetByteCount($env:DEV_OWNER_PASSWORD) -gt 72) {
        throw 'The Haruhay owner password must be at least 12 characters, at most 72 UTF-8 bytes.'
    }
    Write-Host "Starting Haruhay with real Gmail delivery from $SenderEmail."
    Write-Host 'An existing Haruhay account keeps its stored password. This does not reset that password.'
    & .\mvnw.cmd spring-boot:run '-Dspring-boot.run.profiles=dev,gmail'
    if ($LASTEXITCODE -ne 0) { throw 'The backend did not start successfully. Check the startup error above.' }
}
finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    if ($gmailSecret) { $gmailSecret.Dispose() }
    if ($ownerSecret) { $ownerSecret.Dispose() }
    Pop-Location
}
